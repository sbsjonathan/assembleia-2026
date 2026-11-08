const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const tick = () => new Promise(setImmediate);
function base() {
    const data = new Map([['supabase_user', JSON.stringify({ id: 'test-user', loginId: 'one' })]]), handlers = new Map();
    const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)), removeItem: key => data.delete(key), key: i => [...data.keys()][i] ?? null, get length() { return data.size; } };
    const context = { console, URLSearchParams, Date, Math, JSON, Promise, setTimeout: () => 1, clearTimeout() {}, localStorage: storage, navigator: { onLine: true },
        CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } } };
    const events = [];
    context.window = { addEventListener(name, fn) { const list = handlers.get(name) || []; list.push(fn); handlers.set(name, list); },
        dispatchEvent(event) { events.push(event); for (const fn of handlers.get(event.type) || []) fn(event); },
        location: { search: '' }, semanaAtual: '02-11', estudoId: '35', SupabaseSync: { isLoggedIn: () => !!storage.getItem('supabase_user') } };
    context.document = { readyState: 'loading', body: { dataset: {} }, activeElement: null, getElementById() { return null; }, addEventListener() {}, dispatchEvent() {} };
    vm.createContext(context);
    const run = file => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
    return { data, storage, context, events, run };
}
function article(remote = null) {
    const h = base(); let cloud = remote; const writes = [];
    const api = h.context.window.SupabaseSync;
    api.carregarSentinelaAnotacoes = async () => cloud;
    api.salvarSentinelaAnotacoes = async (week, study, value, options) => { writes.push({ value: { ...value }, options }); cloud = { ...value }; return { success: true }; };
    h.run('save/sentinela-sync.js'); const sync = h.context.window.sentinelaSync;
    sync.detectSemanaEEstudo(); sync.checkLoginStatus(); sync.initialLoadComplete = true;
    return { ...h, sync, api, writes, cloud: () => cloud };
}
function notes(initial = 'local', pending = true) {
    const h = base(); let content = initial, revision = 1, dirty = pending;
    const store = { ready: Promise.resolve(), semanaAtual: () => '02-11', snapshot: () => ({ key: content, revision, payload: { html: content, localRevision: String(revision) } }),
        flush() { return this.snapshot(); }, isStored: snapshot => snapshot.key === content, hasPending: () => dirty,
        acknowledge() { dirty = false; }, getConflict: () => null, contentKey: value => value.html, parse: raw => typeof raw === 'object' ? raw : JSON.parse(raw),
        applyContent(value) { content = value.html; revision++; dirty = false; return true; } };
    const api = h.context.window.SupabaseSync, writes = []; let remote = null;
    api.carregarRichtextAnotacoes = async () => remote;
    api.salvarRichtextAnotacoes = async (week, raw, options) => { writes.push({ raw, options }); remote = raw; return { success: true }; };
    h.context.window.cacheRichText = store;
    h.context.document.getElementById = id => id === 'editor' ? { get textContent() { return content; }, children: [] } : null;
    return { ...h, store, api, writes, dirty: () => dirty, value: () => content, remote: raw => remote = raw,
        edit(value) { content = value; revision++; dirty = true; h.context.window.dispatchEvent({ type: 'notes:stored', detail: store.snapshot() }); } };
}
let count = 0;
async function test(name, run) { await run(); count++; console.log('PASS', name); }
(async () => {
    await test('article collection only includes this study and all its comment kinds', async () => {
        const h = article(); for (const key of ['c-35-1', 'r-35-1', 'p-35-1-pg-0', 'c-rcp-1-35', 'obj-35', 'r-obj-35', 'r-sub-h1-35', 'r-sub-h2-2-35']) h.storage.setItem(key, key);
        h.storage.setItem('c-350-1', 'other'); h.storage.setItem('c-34-1', 'other');
        const values = h.sync.collectAnnotationsFromLocalStorage(); assert.equal(Object.keys(values).length, 8); assert.equal(values['c-34-1'], undefined);
    });
    await test('article upload missing keeps existing remote; overwrite replaces it', async () => {
        const h = article({ 'c-35-1': 'cloud' }); h.storage.setItem('c-35-1', 'local'); h.storage.setItem('c-35-2', 'added');
        assert.equal((await h.sync.pushMissing()).success, true); assert.equal(h.cloud()['c-35-1'], 'cloud'); assert.equal(h.cloud()['c-35-2'], 'added');
        assert.equal((await h.sync.pushOverwrite()).success, true); assert.equal(h.cloud()['c-35-1'], 'local');
        assert.deepEqual(h.writes[0].options.expectedRemote, { 'c-35-1': 'cloud' });
    });
    await test('article missing download preserves local; overwrite removes only this study', async () => {
        const h = article({ 'c-35-1': 'cloud', 'c-35-3': 'remote only', 'c-34-1': 'foreign' });
        h.storage.setItem('c-35-1', 'local'); h.storage.setItem('c-35-2', 'local only'); h.storage.setItem('c-34-1', 'other study');
        assert.equal((await h.sync.pullMissing()).success, true); assert.equal(h.storage.getItem('c-35-1'), 'local'); assert.equal(h.storage.getItem('c-35-3'), 'remote only');
        assert.equal((await h.sync.pullOverwrite()).success, true); assert.equal(h.storage.getItem('c-35-1'), 'cloud'); assert.equal(h.storage.getItem('c-35-2'), null); assert.equal(h.storage.getItem('c-34-1'), 'other study');
    });
    await test('article download failure never changes local data or reports success', async () => {
        const h = article(); h.storage.setItem('c-35-1', 'local'); h.api.carregarSentinelaAnotacoes = async () => { throw Error('offline'); };
        assert.equal((await h.sync.pullOverwrite()).success, false); assert.equal((await h.sync.pushOverwrite()).success, false); assert.equal(h.writes.length, 0); assert.equal(h.storage.getItem('c-35-1'), 'local');
    });
    await test('article mutation failure and unavailable recovery storage abort manual operations', async () => {
        const h = article({ 'c-35-1': 'remote' }); h.storage.setItem('c-35-1', 'local'); h.api.salvarSentinelaAnotacoes = async () => ({ success: false, error: 'denied' });
        assert.equal((await h.sync.pushOverwrite()).success, false);
        const set = h.storage.setItem; h.storage.setItem = (key, value) => { if (key.startsWith('ass26_recovery')) throw Error('quota'); set(key, value); };
        assert.equal((await h.sync.pullOverwrite()).success, false); assert.equal(h.storage.getItem('c-35-1'), 'local');
    });
    await test('article startup preserves typing during cloud fetch, without reload', async () => {
        const h = article(); let resolve; h.api.carregarSentinelaAnotacoes = () => new Promise(r => resolve = r);
        h.storage.setItem('c-35-1', 'old'); const loading = h.sync.loadFromSupabase(); h.storage.setItem('c-35-1', 'typed'); resolve({ 'c-35-1': 'remote' }); await loading;
        assert.equal(h.storage.getItem('c-35-1'), 'typed'); assert.ok([...h.data.keys()].some(key => key.startsWith('ass26_recovery')));
    });
    await test('article edit during upload is queued and delivered', async () => {
        const h = article(); let release; h.storage.setItem('c-35-1', 'first');
        h.api.salvarSentinelaAnotacoes = async (week, study, value) => { h.writes.push(value); if (h.writes.length === 1) await new Promise(r => release = r); return { success: true }; };
        const sending = h.sync.executeAutoSave(); await tick(); h.storage.setItem('c-35-1', 'second'); h.sync.scheduleAutoSave(); release(); await sending;
        assert.equal(h.writes.length, 2); assert.equal(h.writes[1]['c-35-1'], 'second');
    });
    await test('article cloud delete leaves local copy and does not immediately reupload', async () => {
        const h = article({ 'c-35-1': 'remote' }); h.storage.setItem('c-35-1', 'local');
        assert.equal((await h.sync.deleteRemote()).success, true); assert.equal(h.storage.getItem('c-35-1'), 'local'); await h.sync.executeAutoSave(); assert.equal(h.writes.length, 1);
    });
    await test('article manual delete and missing-only directions survive reload', async () => {
        const h = article({ 'c-35-1': 'remote' }); h.storage.setItem('c-35-1', 'local');
        await h.sync.deleteRemote(); h.sync.initialLoadComplete = false; h.sync.accountId = null; h.sync.checkLoginStatus();
        await h.sync.loadFromSupabase(); await h.sync.executeAutoSave(); assert.equal(h.writes.length, 1); assert.equal(h.storage.getItem('c-35-1'), 'local');
        const missing = article({ 'c-35-1': 'remote' }); missing.storage.setItem('c-35-1', 'local'); missing.storage.setItem('c-35-2', 'local only');
        await missing.sync.pullMissing(); missing.sync.initialLoadComplete = false; missing.sync.accountId = null; missing.sync.checkLoginStatus();
        await missing.sync.loadFromSupabase(); await missing.sync.executeAutoSave(); assert.equal(missing.writes.length, 0); assert.equal(missing.storage.getItem('c-35-1'), 'local');
    });
    await test('article manual difference survives remote additions and unrelated local edits after reload', async () => {
        const h = article({ 'c-35-1': 'remote' }); h.storage.setItem('c-35-1', 'local');
        await h.sync.pullMissing(); h.cloud()['c-35-3'] = 'added remotely';
        h.sync.accountId = null; h.sync.checkLoginStatus(); await h.sync.loadFromSupabase();
        assert.equal(h.storage.getItem('c-35-1'), 'local'); assert.equal(h.storage.getItem('c-35-3'), 'added remotely');
        h.storage.setItem('c-35-2', 'new local edit'); await h.sync.executeAutoSave();
        assert.equal(h.cloud()['c-35-1'], 'remote'); assert.equal(h.cloud()['c-35-2'], 'new local edit');
        assert.equal(h.storage.getItem('c-35-1'), 'local');
        h.storage.setItem('c-35-1', 'explicit edit of previously different note'); await h.sync.executeAutoSave();
        assert.equal(h.cloud()['c-35-1'], 'explicit edit of previously different note');
    });
    await test('article same-account relogin invalidates an old read', async () => {
        const h = article(); h.storage.setItem('c-35-1', 'local'); h.api.carregarSentinelaAnotacoes = async () => {
            h.storage.setItem('supabase_user', JSON.stringify({ id: 'test-user', loginId: 'two' })); return { 'c-35-1': 'remote' };
        };
        assert.equal((await h.sync.pushOverwrite()).success, false); assert.equal(h.writes.length, 0);
    });
    await test('article menu propagates failure and dispatches the requested direction', async () => {
        const source = fs.readFileSync(path.join(root, 'sentinela/menu/menu.js'), 'utf8');
        const start = source.indexOf('const runSync = async () => {');
        const end = source.indexOf("\n      if (action === 'apagar') {", start);
        const body = source.slice(start, end) + '\nwindow.runSync = runSync;';
        const alerts = [], calls = [], button = { disabled: false };
        const h = base(); h.context.alert = text => alerts.push(text);
        h.context.document.getElementById = () => button;
        h.context.action = 'enviar'; h.context.actionValue = 'merge'; h.context.requestSession = h.storage.getItem('supabase_user');
        h.context.window.sentinelaSync = { pushMissing: async () => { calls.push('missing'); return { success: false, error: 'server denied' }; }, pushOverwrite: async () => { calls.push('overwrite'); return { success: true }; } };
        vm.runInContext(body, h.context); await h.context.window.runSync(); assert.deepEqual(alerts, ['server denied']); assert.equal(button.disabled, false);
        h.context.actionValue = 'overwrite'; await h.context.window.runSync(); assert.deepEqual(calls, ['missing', 'overwrite']); assert.equal(alerts[1], 'Anotações enviadas para a nuvem.');
    });
    await test('article menu binds confirmation to the original session', async () => {
        const source = fs.readFileSync(path.join(root, 'sentinela/menu/menu.js'), 'utf8');
        const start = source.indexOf("    document.getElementById('sentinelaSyncRun').addEventListener('click', async () => {");
        const end = source.indexOf('\n    // --- LOGIC: Limpeza Local ---', start);
        for (const [action, nextSession] of [['apagar', {id:'other-user', loginId:'two'}], ['enviar', {id:'test-user',loginId:'two'}]]) {
            const h = base(), alerts = [], calls = [];
            const button = { disabled: false, addEventListener(name, callback) { this.run = callback; } };
            h.context.document.getElementById = () => button;
            h.context.document.querySelector = () => ({ value: 'overwrite' });
            h.context.alert = message => alerts.push(message); h.context.syncActionRunning = false;
            h.context.activeSyncTab = action; h.context.syncOverlay = {classList:{remove() {}}};
            h.context.showCustomAlert = async () => { h.storage.setItem('supabase_user', JSON.stringify(nextSession)); return 'right'; };
            h.context.window.sentinelaSync = { deleteRemote: async () => { calls.push('delete'); return {success:true}; }, pushOverwrite: async () => { calls.push('replace'); return {success:true}; } };
            vm.runInContext(source.slice(start, end), h.context); await button.run();
            assert.equal(calls.length, 0); assert.equal(alerts.length, 1); assert.match(alerts[0], /conta mudou/);
            assert.equal(button.disabled, false); assert.equal(h.context.syncActionRunning, false);
        }
    });
    await test('v1 compatibility adapter rejects snapshots that were not persisted', async () => {
        const h = base(); const payload = { html: 'notes', localRevision: 'one' };
        h.context.window.cacheRichText = { semanaAtual: () => '02-11', parse: raw => JSON.parse(raw), contentKey: value => value.html };
        h.run('richtext/v1-cloud-bridge.js'); const store = h.context.window.cacheRichText, snapshot = { key: 'notes', payload };
        assert.equal(store.isStored(snapshot), false); h.storage.setItem('richtext_cache_02-11', JSON.stringify(payload)); assert.equal(store.isStored(snapshot), true);
        h.storage.setItem('richtext_cache_02-11', JSON.stringify({ ...payload, localRevision: 'other' })); assert.equal(store.isStored(snapshot), false);
    });
    await test('article account change during read aborts write and local replacement', async () => {
        const h = article(); h.storage.setItem('c-35-1', 'local'); h.api.carregarSentinelaAnotacoes = async () => { h.storage.setItem('supabase_user', JSON.stringify({ id: 'other' })); return { 'c-35-1': 'cloud' }; };
        assert.equal((await h.sync.pushOverwrite()).success, false); assert.equal(h.writes.length, 0); assert.equal(h.storage.getItem('c-35-1'), 'local');
    });
    await test('richtext remote read failure never uploads or acknowledges pending draft', async () => {
        const h = notes(); h.api.carregarRichtextAnotacoes = async () => { throw Error('offline'); }; h.run('save/auto-save.js'); await h.context.window.AutoSaveManager.ready; await tick();
        assert.equal(h.writes.length, 0); assert.equal(h.dirty(), true);
    });
    await test('richtext malformed save response is not acknowledged', async () => {
        const h = notes(); h.api.salvarRichtextAnotacoes = async () => ({}); h.run('save/auto-save.js'); await h.context.window.AutoSaveManager.ready; await tick(); assert.equal(h.dirty(), true); assert.ok(h.context.window.AutoSaveManager.pending);
    });
    await test('richtext offline draft keeps divergent cloud recovery and uses expected remote', async () => {
        const h = notes(); const raw = JSON.stringify({ html: 'other device' }); h.remote(raw); h.run('save/auto-save.js'); await h.context.window.AutoSaveManager.ready; await tick();
        assert.equal(h.writes.length, 1); assert.equal(h.writes[0].options.expectedRemote, raw); assert.equal(h.dirty(), false); assert.ok([...h.data.values()].some(value => value.includes('notes-cloud-recovery') && value.includes('other device')));
    });
    await test('richtext existing empty cloud clears acknowledged local content rather than resurrecting it', async () => {
        const h = notes('old local', false); h.remote(''); h.run('save/auto-save.js'); await h.context.window.AutoSaveManager.ready; h.run('save/unified-load.js'); await h.context.window.UnifiedLoadManager.ready; await tick();
        assert.equal(h.value(), ''); assert.equal(h.writes.length, 0); assert.ok([...h.data.values()].some(value => value.includes('notes-cloud-recovery') && value.includes('old local')));
    });
    await test('richtext missing row uploads legacy local document without a pending revision', async () => {
        const h = notes('legacy local', false); h.run('save/auto-save.js'); await h.context.window.AutoSaveManager.ready; h.run('save/unified-load.js'); await h.context.window.UnifiedLoadManager.ready; await tick();
        assert.equal(h.writes.length, 1); assert.equal(JSON.parse(h.writes[0].raw).html, 'legacy local');
    });
    await test('richtext edit during initial download stays local and is subsequently uploaded', async () => {
        const h = notes('old local', false); let resolve; h.run('save/auto-save.js'); await h.context.window.AutoSaveManager.ready;
        h.api.carregarRichtextAnotacoes = () => new Promise(r => resolve = r); h.run('save/unified-load.js'); await h.context.window.UnifiedLoadManager.ready; await tick();
        h.context.window.AutoSaveManager.pauseAutoSave(); h.edit('typed'); resolve(JSON.stringify({ html: 'cloud' })); await tick();
        assert.equal(h.value(), 'typed'); assert.equal(h.writes.length, 0);
        h.api.carregarRichtextAnotacoes = async () => JSON.stringify({ html: 'cloud' }); await h.context.window.AutoSaveManager.resumeAutoSave(); assert.equal(JSON.parse(h.writes[0].raw).html, 'typed');
    });
    console.log(`${count} article and notes sync cases passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
