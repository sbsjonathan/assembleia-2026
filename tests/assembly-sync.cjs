const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const note = (text, time) => JSON.stringify({ fullHtml: text, fullText: text, updatedAt: time });
function harness(remote = null) {
    const data = new Map([['supabase_user', JSON.stringify({ id: 'qa-user' })]]), timers = new Map();
    let timerId = 0;
    const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)), removeItem: key => data.delete(key), key: index => [...data.keys()][index] ?? null, get length() { return data.size; } };
    const events = [];
    const context = {
        console, Date, Math, setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id),
        localStorage: storage, sessionStorage: storage, navigator: { onLine: true },
        document: { readyState: 'loading', documentElement: { dataset: { programYear: '2026', programId: 'ca-copgm27' } }, addEventListener() {} },
        CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
        window: { addEventListener() {}, dispatchEvent: event => events.push(event), SupabaseSync: {} }
    };
    let cloud = remote, writes = [];
    context.window.SupabaseSync.carregarAssembleiaAnotacoes = async () => cloud;
    context.window.SupabaseSync.salvarAssembleiaAnotacoes = async (year, value) => { cloud = { ...value }; writes.push(value); return { success: true }; };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(root, 'save/asmb-sync.js'), 'utf8'), context);
    const sync = context.window.assembleiaSync;
    sync.initialLoadComplete = true; sync.isLoggedIn = true;
    return { context, sync, storage, data, timers, events, writes, cloud: () => cloud };
}
let count = 0;
async function test(name, run) { await run(); count++; console.log('PASS', name); }
(async () => {
    await test('empty cloud cannot wipe local notes', async () => {
        const h = harness(null); h.storage.setItem('ca-copgm27:nota:confiar-de-todo-coracao', note('local', 200));
        assert.equal((await h.sync.pullOverwrite()).success, false);
        assert.equal(JSON.parse(h.storage.getItem('ca-copgm27:nota:confiar-de-todo-coracao')).fullText, 'local');
    });
    await test('read failure cannot wipe local or upload one day over other days', async () => {
        const h = harness(); h.storage.setItem('ca-copgm27:nota:confiar-de-todo-coracao', note('local', 200));
        h.context.window.SupabaseSync.carregarAssembleiaAnotacoes = async () => { throw new Error('offline'); };
        assert.equal((await h.sync.pullOverwrite()).success, false);
        assert.equal((await h.sync.pushDay('unico')).success, false);
        assert.equal(h.writes.length, 0); assert.ok(h.storage.getItem('ca-copgm27:nota:confiar-de-todo-coracao'));
    });
    await test('startup preserves newer offline notes and backs up remote divergence', async () => {
        const h = harness({ 'ca-copgm27:nota:confiar-de-todo-coracao': note('old cloud', 1) }); h.storage.setItem('ca-copgm27:nota:confiar-de-todo-coracao', note('new local', 200));
        assert.equal((await h.sync.loadFromSupabase()).success, true);
        assert.equal(JSON.parse(h.storage.getItem('ca-copgm27:nota:confiar-de-todo-coracao')).fullText, 'new local');
        assert.equal(h.sync.getRecoveries().length, 1);
        assert.ok(h.sync.getRecoveries()[0].values['ca-copgm27:nota:confiar-de-todo-coracao'].includes('old cloud'));
    });
    await test('newer remote note retains a recovery of previous local contents', async () => {
        const h = harness({ 'ca-copgm27:nota:confiar-de-todo-coracao': note('new cloud', 300) }); h.storage.setItem('ca-copgm27:nota:confiar-de-todo-coracao', note('old local', 200));
        assert.equal((await h.sync.loadFromSupabase()).success, true);
        assert.ok(h.storage.getItem('ca-copgm27:nota:confiar-de-todo-coracao').includes('new cloud'));
        assert.ok(h.sync.getRecoveries()[0].values['ca-copgm27:nota:confiar-de-todo-coracao'].includes('old local'));
    });
    await test('edit made while initial download waits stays local', async () => {
        const h = harness(); let resolve;
        h.storage.setItem('ca-copgm27:nota:confiar-de-todo-coracao', note('before', 100));
        h.context.window.SupabaseSync.carregarAssembleiaAnotacoes = () => new Promise(r => resolve = r);
        const loading = h.sync.loadFromSupabase();
        h.storage.setItem('ca-copgm27:nota:confiar-de-todo-coracao', note('typed while waiting', 101));
        resolve({ 'ca-copgm27:nota:confiar-de-todo-coracao': note('cloud later clock', 999) }); await loading;
        assert.ok(h.storage.getItem('ca-copgm27:nota:confiar-de-todo-coracao').includes('typed while waiting'));
    });
    await test('edit during upload gets a second upload without another interaction', async () => {
        const h = harness(); let release, cloud = null, writes = [];
        h.storage.setItem('ca-copgm27:nota:confiar-de-todo-coracao', note('first', 100));
        h.context.window.SupabaseSync.carregarAssembleiaAnotacoes = async () => cloud;
        h.context.window.SupabaseSync.salvarAssembleiaAnotacoes = async (year, data) => {
            writes.push({ ...data });
            if (writes.length === 1) await new Promise(r => release = r);
            cloud = { ...data }; return { success: true };
        };
        const pending = h.sync.executeAutoSave(); await new Promise(setImmediate);
        h.storage.setItem('ca-copgm27:nota:confiar-de-todo-coracao', note('second', 200)); h.sync.scheduleAutoSave();
        await h.sync.executeAutoSave(); release(); await pending;
        assert.equal(writes.length, 2); assert.ok(cloud['ca-copgm27:nota:confiar-de-todo-coracao'].includes('second'));
    });
    await test('replacement aborts if a local backup cannot be saved', async () => {
        const h = harness({ 'ca-copgm27:nota:confiar-de-todo-coracao': note('cloud', 300) }); h.storage.setItem('ca-copgm27:nota:confiar-de-todo-coracao', note('local', 200));
        const setItem = h.storage.setItem;
        h.storage.setItem = (key, value) => { if (key.startsWith('ass26_recovery_')) throw new Error('quota'); setItem(key, value); };
        assert.equal((await h.sync.pullOverwrite()).success, false);
        assert.ok(h.storage.getItem('ca-copgm27:nota:confiar-de-todo-coracao').includes('local'));
    });
    await test('invalid cloud keys never enter local storage', async () => {
        const h = harness({ supabase_user: 'foreign account' });
        assert.equal((await h.sync.loadFromSupabase()).success, false);
        assert.equal(h.sync.account(), 'qa-user');
    });
    await test('failed Supabase preflight prevents writing and uses assembly cloud type', async () => {
        const filters = []; let mutated = false;
        const builder = { select() { return this; }, eq(key, value) { filters.push([key, value]); return this; }, maybeSingle: async () => ({ data: null, error: new Error('query failed') }), update() { mutated = true; return this; }, insert() { mutated = true; return this; } };
        const ctx = { window: { SupabaseSync: {} }, navigator: {}, console };
        vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(root, 'save/supabase.js'), 'utf8') + '\nwindow.TestClass = SupabaseSync;', ctx);
        const client = Object.create(ctx.window.TestClass.prototype);
        Object.assign(client, { currentUser: { id: 'qa-user' }, isOnline: true, supabase: { from: () => builder }, ensureInitialized: async () => true, checkExistingSession() {} });
        assert.equal((await client.salvarAssembleiaAnotacoes('ca-copgm27', {})).success, false);
        assert.equal(mutated, false); assert.ok(filters.some(([key, val]) => key === 'tipo' && val === 'ass26:programacao:ca-copgm27'));
        await assert.rejects(() => client.carregarAssembleiaAnotacoes('ca-copgm27'), /query failed/);
    });
    await test('100 KB notes are sent in the body, never in query filters', async () => {
        const filters = [], previous = { 'ca-copgm27:nota:confiar-de-todo-coracao': note('x'.repeat(100000), 100) };
        let payload, writing = false;
        const builder = { select() { return this; }, eq(key, value) { filters.push([key, value]); return this; },
            update(value) { payload = value; writing = true; return this; },
            maybeSingle: async () => ({ data: writing ? { id: 'row1' } : { id: 'row1', conteudo_html: JSON.stringify(previous) }, error: null }) };
        const ctx = { window: { SupabaseSync: {} }, navigator: {}, console };
        vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(root, 'save/supabase.js'), 'utf8') + '\nwindow.TestClass = SupabaseSync;', ctx);
        const client = Object.create(ctx.window.TestClass.prototype);
        Object.assign(client, { currentUser: { id: 'qa-user' }, isOnline: true, supabase: { from: () => builder }, ensureInitialized: async () => true, checkExistingSession() {} });
        const result = await client.salvarAssembleiaAnotacoes('ca-copgm27', previous, { expectedRemote: previous });
        assert.equal(result.success, true);
        assert.ok(payload.conteudo_html.length > 100000);
        assert.ok(filters.every(([key, value]) => key !== 'conteudo_html' && String(value).length < 100));
    });
    await test('Congress keys and archives never enter current assembly cloud payload', async () => {
        const h = harness();
        h.storage.setItem('2026-sex-940', note('old programme', 1));
        h.storage.setItem('legacy-congresso:2026-sex-940', note('archive', 1));
        h.storage.setItem('ca-copgm27:pergunta:sempre-confiar', note('answer', 2));
        h.storage.setItem('cor-assembleia', '#604184');
        const collected = h.sync.collectAnnotationsFromLocalStorage();
        assert.deepEqual(Object.keys(collected).sort(), ['ca-copgm27:pergunta:sempre-confiar', 'cor-assembleia']);
        assert.equal((await h.sync.pushDay('sex')).success, false);
        assert.equal((await h.sync.pushDay('unico')).success, true);
        assert.ok(h.cloud()['ca-copgm27:pergunta:sempre-confiar']);
        assert.equal(h.cloud()['2026-sex-940'], undefined);
    });
    await test('general-note cloud fallback reads only former Assembly namespace and preserves an explicit empty document', async () => {
        const filters = []; let response = null;
        const ctx = { window: { SupabaseSync: {} }, navigator: {}, console };
        vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(root, 'save/supabase.js'), 'utf8') + '\nwindow.TestClass = SupabaseSync;', ctx);
        const builder = { select() { return this; }, eq(key, value) { if (key === 'tipo') filters.push(value); return this; },
            maybeSingle: async () => ({data: filters.at(-1)==='assembleia2026:richtext' ? {conteudo_html:'preserved note'} : response, error:null}) };
        const client = Object.create(ctx.window.TestClass.prototype);
        Object.assign(client, {currentUser:{id:'qa-user'},isOnline:true,supabase:{from:()=>builder},ensureInitialized:async()=>true,checkExistingSession(){}});
        assert.equal(await client.carregarRichtextAnotacoes('07-11'), 'preserved note');
        assert.deepEqual(filters,['ass26:richtext','assembleia2026:richtext']);
        filters.length=0;response={conteudo_html:''};
        assert.equal(await client.carregarRichtextAnotacoes('07-11'), '');
        assert.deepEqual(filters,['ass26:richtext']);
        assert.equal((await client.salvarAssembleiaAnotacoes('2026', {})).success,false);
    });
    console.log(`${count} persistence checks passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
