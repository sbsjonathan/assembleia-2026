/* Two-device conflict outcomes at the programme/article merge layer. No network. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
const conflict = () => ({ success: false, code: 'SYNC_CONFLICT', error: 'Outro aparelho alterou a nuvem.' });

function harness(kind) {
  const programme = kind === 'programme';
  const key = n => programme ? `ca-copgm27:note-${n}` : `c-35-${n}`;
  const data = new Map([['supabase_user', JSON.stringify({ id: 'synthetic', loginId: 'one' })]]);
  const storage = { get length() { return data.size; }, key: n => [...data.keys()][n] ?? null,
    getItem: k => data.get(k) ?? null, setItem: (k,v) => data.set(k,String(v)), removeItem: k => data.delete(k) };
  const events = [], writes = [];
  let remote = {}, readFailure = false, onWrite = null;
  const api = { isLoggedIn: () => !!storage.getItem('supabase_user') };
  const read = async () => { if (readFailure) throw Error('synthetic offline'); return copy(remote); };
  const write = async (...args) => {
    const value = args[programme ? 1 : 2];
    writes.push(copy(value));
    if (onWrite) { const result = await onWrite(value); if (result) return result; }
    remote = copy(value); return { success: true };
  };
  if (programme) Object.assign(api, { carregarAssembleiaAnotacoes: read, salvarAssembleiaAnotacoes: write,
    apagarAssembleiaCompleto: async () => { writes.push({}); if (onWrite) { const result = await onWrite({}); if (result) return result; } remote = {}; return { success: true }; } });
  else Object.assign(api, { carregarSentinelaAnotacoes: read, salvarSentinelaAnotacoes: write });
  const ctx = { console, JSON, Date, Math, URLSearchParams, setTimeout: () => 1, clearTimeout() {}, navigator: { onLine: true }, localStorage: storage,
    CustomEvent: class { constructor(type,options) { this.type=type;this.detail=options?.detail; } },
    document: { readyState: 'loading', documentElement: { dataset: { programId: 'ca-copgm27' } }, body: { dataset: {} }, activeElement: null,
      getElementById() { return null; }, addEventListener() {}, dispatchEvent() {} },
    window: { SupabaseSync: api, semanaAtual: '02-11', estudoId: '35', location: { search: '' }, addEventListener() {}, dispatchEvent: event => events.push(event) } };
  vm.createContext(ctx);
  const source = fs.readFileSync(path.join(__dirname, '../save/', programme ? 'asmb-sync.js' : 'sentinela-sync.js'), 'utf8');
  vm.runInContext(source, ctx);
  const create = () => {
    const instance = vm.runInContext(programme ? 'new AssembleiaSync()' : 'new SentinelaSync()',ctx);
    if (!programme) instance.detectSemanaEEstudo();
    instance.checkLoginStatus();instance.initialLoadComplete=true;
    return instance;
  };
  const h = { kind, key, data, storage, events, writes, api, context:ctx, create, sync:create(),
    cloud: () => copy(remote), setCloud: value => { remote=copy(value); }, failRead: value => { readFailure=value; },
    onWrite: value => { onWrite=value; }, local: (n,value) => storage.setItem(key(n),value), value: n => storage.getItem(key(n)),
    remember(local,cloud) { programme ? this.sync.remember(cloud,local) : this.sync.remember(local,cloud); },
    erase: () => programme ? h.sync.deleteAll() : h.sync.deleteRemote() };
  return h;
}

let count=0;
async function test(name, run) { await run(); count++;console.log('PASS',name); }
(async () => {
  for (const kind of ['programme','article']) {
    await test(`${kind}: same-field collision preserves both copies, reports conflict, and survives reopening`, async () => {
      const h=harness(kind), a=h.key(1), b=h.key(2), c=h.key(3);
      h.setCloud({[a]:'base'});h.local(1,'local draft');h.local(2,'local addition');h.remember({[a]:'base'},{[a]:'base'});
      h.onWrite(() => { if(h.writes.length===1) { h.setCloud({[a]:'other device',[c]:'remote addition'});return conflict(); } });
      const result=await h.sync.executeAutoSave();
      assert.equal(result.success,false);assert.equal(result.code,'SYNC_CONFLICT');assert.equal(h.writes.length,2);
      assert.deepEqual(h.cloud(),{[a]:'other device',[c]:'remote addition',[b]:'local addition'});
      assert.equal(h.value(1),'local draft');assert.equal(h.value(3),'remote addition');
      assert.ok(h.events.some(event=>event.detail?.status==='conflict'));
      h.sync=h.create();h.sync.initialLoadComplete=false;await h.sync.loadFromSupabase();await h.sync.executeAutoSave();
      assert.equal(h.writes.length,2);assert.equal(h.value(1),'local draft');assert.equal(h.cloud()[a],'other device');
      h.local(2,'later unrelated edit');await h.sync.executeAutoSave();
      assert.equal(h.cloud()[a],'other device');assert.equal(h.cloud()[b],'later unrelated edit');
      h.local(1,'deliberate later edit');await h.sync.executeAutoSave();assert.equal(h.cloud()[a],'deliberate later edit');
    });
    await test(`${kind}: different-field collision rereads and safely merges the first insertion`, async () => {
      const h=harness(kind), a=h.key(1), b=h.key(2);h.setCloud(null);h.local(1,'local');
      h.onWrite(()=>{if(h.writes.length===1){h.setCloud({[b]:'other device'});return conflict();}});
      assert.equal((await h.sync.executeAutoSave()).success,true);assert.equal(h.writes.length,2);
      assert.deepEqual(h.cloud(),{[a]:'local',[b]:'other device'});assert.equal(h.value(2),'other device');
    });
    await test(`${kind}: an unchanged local field adopts the remote winner while another field is sent`, async () => {
      const h=harness(kind), a=h.key(1), b=h.key(2);
      h.setCloud({[a]:'original A',[b]:'original B'});h.local(1,'original A');h.local(2,'edited B');
      h.remember({[a]:'original A',[b]:'original B'},{[a]:'original A',[b]:'original B'});
      h.onWrite(()=>{if(h.writes.length===1){h.setCloud({[a]:'new remote A',[b]:'original B'});return conflict();}});
      assert.equal((await h.sync.executeAutoSave()).success,true);assert.equal(h.writes.length,2);
      assert.deepEqual(h.cloud(),{[a]:'new remote A',[b]:'edited B'});assert.equal(h.value(1),'new remote A');
    });
    await test(`${kind}: a concurrent deletion of an unchanged field is not resurrected`, async () => {
      const h=harness(kind), a=h.key(1), b=h.key(2);
      h.setCloud({[a]:'original A',[b]:'original B'});h.local(1,'original A');h.local(2,'edited B');
      h.remember({[a]:'original A',[b]:'original B'},{[a]:'original A',[b]:'original B'});
      h.onWrite(()=>{if(h.writes.length===1){h.setCloud({[b]:'original B'});return conflict();}});
      assert.equal((await h.sync.executeAutoSave()).success,true);assert.equal(h.writes.length,2);
      assert.deepEqual(h.cloud(),{[b]:'edited B'});assert.equal(h.value(1),null);
    });
    await test(`${kind}: repeated collisions stop after three mutations`, async () => {
      const h=harness(kind),a=h.key(1);h.setCloud({[a]:'base'});h.local(1,'draft');h.remember({[a]:'base'},{[a]:'base'});
      h.onWrite(()=>{h.setCloud({[a]:'winner '+h.writes.length});return conflict();});
      const result=await h.sync.executeAutoSave();assert.equal(result.code,'SYNC_CONFLICT');assert.equal(h.writes.length,3);
      assert.equal(h.value(1),'draft');assert.equal(h.cloud()[a],'winner 3');
    });
    await test(`${kind}: manual overwrite conflicts never turn into automatic retries`, async () => {
      const h=harness(kind),a=h.key(1);h.local(1,'local');h.setCloud({[a]:'base'});h.sync.dirty=true;
      h.onWrite(()=>{h.setCloud({[a]:'winner'});return conflict();});
      assert.equal((await h.sync.pushOverwrite()).code,'SYNC_CONFLICT');assert.equal(h.writes.length,1);assert.equal(h.sync.dirty,false);
      h.onWrite(null);await h.sync.executeAutoSave();assert.equal(h.writes.length,1);assert.equal(h.cloud()[a],'winner');
      h.sync=h.create();h.sync.initialLoadComplete=false;await h.sync.loadFromSupabase();await h.sync.executeAutoSave();assert.equal(h.writes.length,1);
      assert.equal((await h.sync.pushOverwrite()).success,true);assert.equal(h.cloud()[a],'local');
    });
    await test(`${kind}: manual deletion collision cannot remove a competing update or local draft`, async () => {
      const h=harness(kind),a=h.key(1);h.local(1,'local');h.setCloud({[a]:'base'});
      h.onWrite(()=>{h.setCloud({[a]:'winner'});return conflict();});
      assert.equal((await h.erase()).code,'SYNC_CONFLICT');assert.equal(h.writes.length,1);assert.equal(h.value(1),'local');assert.equal(h.cloud()[a],'winner');
      h.onWrite(null);await h.sync.executeAutoSave();assert.equal(h.writes.length,1);
    });
    await test(`${kind}: failed post-conflict read leaves a persistent barrier until the next successful read`, async () => {
      const h=harness(kind),a=h.key(1);h.local(1,'local');h.setCloud({[a]:'base'});h.remember({[a]:'base'},{[a]:'base'});
      h.onWrite(()=>{h.setCloud({[a]:'winner'});h.failRead(true);return conflict();});
      assert.equal((await h.sync.executeAutoSave()).success,false);assert.equal(h.writes.length,1);assert.ok(h.storage.getItem(h.sync.conflictKey()));
      h.sync=h.create();await h.sync.executeAutoSave();assert.equal(h.writes.length,1);
      h.failRead(false);h.onWrite(null);h.sync.initialLoadComplete=false;await h.sync.loadFromSupabase();await h.sync.executeAutoSave();
      assert.equal(h.writes.length,1);assert.equal(h.value(1),'local');assert.equal(h.cloud()[a],'winner');
    });
  }
  console.log(`${count} programme/article conflict checks passed`);
})().catch(error=>{console.error(error);process.exitCode=1;});
