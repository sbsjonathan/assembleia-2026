/* Synthetic custom-account sessions only; no backend or user credentials. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto').webcrypto;
const source = fs.readFileSync(path.join(__dirname, '../save/supabase.js'), 'utf8');
const USER = {id:'synthetic-a',usuario:'synthetic',nome:'Synthetic'};
const remoteUser = id => ({id,usuario:'synthetic',nome_completo:'Synthetic',senha_hash:'not-stored'});
function deferred() { let resolve, reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject}; }
function harness(saved = USER, {loadFailure = false} = {}) {
  const values = new Map(saved === null ? [] : [['supabase_user', JSON.stringify(saved)]]);
  const events = [], listeners = new Map();
  let failRead=false,failWrite=false,failRemove=false,requests=0,loads=0;
  let reply = async () => ({data:{id:USER.id},error:null});
  const localStorage = {
    getItem(key) {if(failRead)throw new Error('temporary read failure');return values.get(key) ?? null;},
    setItem(key,value) {if(failWrite)throw new Error('quota');values.set(key,String(value));},
    removeItem(key) {if(failRemove)throw new Error('temporary remove failure');values.delete(key);}
  };
  const builder = {select(){return this;},eq(){return this;},insert(){return this;},
    single(){requests++;return reply();},maybeSingle(){requests++;return reply();}};
  const sdk={createClient:()=>({from:()=>builder})};
  const window={SUPABASE_CONFIG:{url:'https://synthetic.invalid',anonKey:'synthetic'},
    addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(fn);},
    dispatchEvent(event){events.push(event.type);for(const fn of listeners.get(event.type)||[])fn(event);}};
  const context={window,localStorage,navigator:{onLine:true},console,Event,crypto,TextEncoder};
  if(!loadFailure)context.supabase=sdk;
  context.document={createElement(){return {remove(){}};},head:{appendChild(script){loads++;queueMicrotask(()=>{if(loads===1)script.onerror(new Error('CDN offline'));else{context.supabase=sdk;script.onload();}});}}};
  vm.createContext(context);vm.runInContext(source,context);
  return {client:window.SupabaseSync,values,events,localStorage,window,context,
    setReply(fn){reply=fn;},readFailure(value){failRead=value;},writeFailure(value){failWrite=value;},removeFailure(value){failRemove=value;},
    get requests(){return requests;},get loads(){return loads;},get listeners(){return listeners;}};
}
let count=0;
async function test(name,fn){await fn();count++;console.log('PASS',name);}
(async()=>{
 await test('network, ambiguous cardinality and service errors do not delete a stored account',async()=>{
   for(const error of [{code:'PGRST116'},{code:'PGRST301'},{message:'Failed to fetch'},{code:'500'}]){
     const h=harness();const before=h.values.get('supabase_user');h.setReply(async()=>({data:null,error}));
     assert.equal((await h.client.validateExistingSession()).status,'unavailable');
     assert.equal(h.values.get('supabase_user'),before);assert.equal(h.client.getCurrentUser().id,USER.id);
   }
 });
 await test('login service failure is distinct from rejected credentials and preserves previous identity',async()=>{
   const h=harness(),before=h.values.get('supabase_user');h.setReply(async()=>({data:null,error:{code:'503'}}));
   assert.match((await h.client.logarUsuario('synthetic','synthetic-password')).error,/verificar/);
   h.setReply(async()=>({data:null,error:null}));
   assert.equal((await h.client.logarUsuario('synthetic','wrong-password')).error,'Usuário ou senha incorretos');
   assert.equal(h.values.get('supabase_user'),before);
 });
 await test('malformed backend identity never replaces a valid saved account or announces success',async()=>{
   for(const value of [{},[],{id:null},{id:''},{id:' '},{id:{}},{id:Infinity}]){
     const h=harness(),before=h.values.get('supabase_user');h.setReply(async()=>({data:value,error:null}));
     const result=await h.client.logarUsuario('synthetic','synthetic-password');
     assert.equal(result.success,false);assert.match(result.error,/confirmar/);
     assert.equal(h.values.get('supabase_user'),before);assert.equal(h.client.getCurrentUser().id,USER.id);
     assert.equal(h.events.includes('supabaseSessionChanged'),false);
   }
 });
 await test('only successful absence of the current account revokes it',async()=>{
   const h=harness();h.setReply(async()=>({data:null,error:null}));
   assert.equal((await h.client.validateExistingSession()).status,'removed');
   assert.equal(h.values.has('supabase_user'),false);assert.equal(h.client.getCurrentUser(),null);
 });
 await test('a late validation cannot remove a newer login, including same account',async()=>{
   for(const id of ['synthetic-b',USER.id]){
     const h=harness(),query=deferred();h.setReply(()=>query.promise);
     const validating=h.client.validateExistingSession();await new Promise(setImmediate);
     h.client.storeSession(remoteUser(id),h.client.authGeneration);const newer=h.values.get('supabase_user');
     query.resolve({data:null,error:null});assert.equal((await validating).status,'changed');
     assert.equal(h.values.get('supabase_user'),newer);assert.equal(h.client.getCurrentUser().id,id);
   }
 });
 await test('late failure or success after explicit logout cannot restore session or report it retained',async()=>{
   for(const failure of [false,true]){
     const h=harness(),query=deferred();h.setReply(()=>query.promise);
     const validating=h.client.validateExistingSession();await new Promise(setImmediate);
     h.client.logout();if(failure)query.reject(new Error('network'));else query.resolve({data:{id:USER.id},error:null});
     assert.equal((await validating).status,'changed');assert.equal(h.values.has('supabase_user'),false);assert.equal(h.client.getCurrentUser(),null);
   }
 });
 await test('logout cancels a login request still awaiting credentials',async()=>{
   const h=harness(null),query=deferred();h.setReply(()=>query.promise);
   const login=h.client.logarUsuario('synthetic','synthetic-password');
   while(!h.requests)await new Promise(setImmediate);
   h.client.logout();query.resolve({data:remoteUser(USER.id),error:null});
   assert.equal((await login).success,false);assert.equal(h.values.has('supabase_user'),false);
 });
 await test('storage read/write failures preserve a known account without cloud writes or fake login success',async()=>{
   const h=harness(),before=h.values.get('supabase_user');h.readFailure(true);
   assert.equal(h.client.checkExistingSession().status,'unavailable');assert.equal(h.client.getCurrentUser().id,USER.id);
   assert.equal((await h.client.validateExistingSession()).status,'unavailable');
   assert.equal((await h.client.salvarAssembleiaAnotacoes('ca-copgm27',{})).success,false);assert.equal(h.requests,0);
   h.readFailure(false);h.writeFailure(true);h.setReply(async()=>({data:remoteUser('synthetic-b'),error:null}));
   assert.equal((await h.client.logarUsuario('synthetic','synthetic-password')).success,false);
   assert.equal(h.values.get('supabase_user'),before);assert.equal(h.client.getCurrentUser().id,USER.id);
 });
 await test('successful logout cannot be resurrected by a later storage error or reload',async()=>{
   const h=harness();h.client.logout();h.readFailure(true);assert.equal(h.client.getCurrentUser(),null);
   h.readFailure(false);assert.equal(h.client.checkExistingSession().status,'signed-out');
   assert.equal(harness(null).client.getCurrentUser(),null);
 });
 await test('malformed saved value stays available for recovery instead of being deleted',async()=>{
   const h=harness();h.values.set('supabase_user','{broken');
   assert.equal(h.client.checkExistingSession().status,'invalid');assert.equal(h.values.get('supabase_user'),'{broken');
 });
 await test('SDK failure does not hide saved identity and concurrent reconnect requests share one retry',async()=>{
   const h=harness(USER,{loadFailure:true});assert.equal(h.client.getCurrentUser().id,USER.id);
   assert.equal(await h.client.initPromise,false);assert.ok(h.listeners.has('online'));
   assert.deepEqual(await Promise.all([h.client.ensureInitialized(),h.client.ensureInitialized()]),[true,true]);
   assert.equal(h.loads,2);assert.equal(h.client.getCurrentUser().id,USER.id);
 });
 await test('storage logout in another page clears memory even when the next read fails',async()=>{
   const h=harness();h.values.delete('supabase_user');h.readFailure(true);
   h.window.dispatchEvent({type:'storage',key:'supabase_user',storageArea:h.localStorage,newValue:null});
   assert.equal(h.client.getCurrentUser(),null);
 });
 await test('stored login contains public identity only and a fresh generation for each login',async()=>{
   const h=harness(null);h.setReply(async()=>({data:remoteUser(USER.id),error:null}));
   assert.equal((await h.client.logarUsuario('synthetic','synthetic-password')).success,true);
   const first=JSON.parse(h.values.get('supabase_user'));assert.equal(first.senha_hash,undefined);assert.ok(first.loginId);
   assert.equal((await h.client.logarUsuario('synthetic','synthetic-password')).success,true);
   assert.notEqual(JSON.parse(h.values.get('supabase_user')).loginId,first.loginId);
 });
 console.log(`${count} auth/session regression checks passed`);
})().catch(error=>{console.error(error);process.exitCode=1;});
