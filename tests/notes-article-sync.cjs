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
    context.document = { readyState: 'loading', body: { dataset: {} }, activeElement: null, getElementById() { return null; }, querySelectorAll() { return []; }, addEventListener() {}, dispatchEvent() {} };
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
    await test('article grouped questions and their source marks belong to the cloud document', async () => {
        const h = article();
        for (const key of ['c-35-1-2', 'r-35-3–5', 'p-35-1-2-pg-0', 'p-35-1-2-pg-1', 'p-35-1-2-pg-extra-2', 'c-35-1 e 2']) {
            assert.equal(h.sync.validKey(key), true, key); h.storage.setItem(key, key);
        }
        assert.equal(h.sync.validKey('p-350-1-2-pg-0'), false);
        assert.equal((await h.sync.pushOverwrite()).success, true);
        assert.equal(Object.keys(h.cloud()).length, 6);
    });
    await test('local clear removes all article kinds, not another study, programme, login or preferences', async () => {
        const h = article();
        const deleted = ['c-35-1-2', 'r-35-1-2', 'p-35-1-2-pg-0', 'p-35-1-2-pg-1', 'c-35-3',
            'p-35-3-pg-0', 'c-rcp-1-35', 'r-obj-35', 'sub-h1-35', 'r-sub-h2-2-35', 'qa:obj:35',
            'qa:recap:35:p-rcp-1-35', 'qa:sub:sub-h2-2-35', 'paragrafo-geral-0',
            'ass26_sentinela_manual_test-user_02-11_35', 'ass26_recovery_sentinela_02-11_35_123_a',
            'cloud_conflict_notice_sentinela_test-user_02-11_35'];
        const kept = ['c-350-1-2', 'p-36-1-pg-0', 'qa:obj:350', 'ca-copgm27:note-1', 'richtext_cache_02-11', 'tema-interface'];
        h.context.document.querySelectorAll = () => [{id:'paragrafo-geral-0'}];
        for (const key of [...deleted, ...kept]) h.storage.setItem(key, 'saved');
        h.sync.clearLocal();
        for (const key of deleted) assert.equal(h.storage.getItem(key), null, key);
        for (const key of kept) assert.equal(h.storage.getItem(key), 'saved', key);
        assert.ok(h.storage.getItem('supabase_user'));
        assert.equal(h.sync.localClearInProgress, true);
    });
    await test('local clear survives cloud startup and new edits sync without restoring deleted fields', async () => {
        const remote = {'c-35-1-2':'old comment','p-35-1-2-pg-0':'old mark','p-35-3-pg-0':'old single mark'};
        const h = article(remote); for (const [key,value] of Object.entries(remote)) h.storage.setItem(key,value);
        h.sync.clearLocal();
        const sync = vm.runInContext('new SentinelaSync()',h.context);
        sync.detectSemanaEEstudo(); await sync.loadFromSupabase(); await sync.executeAutoSave();
        assert.equal(Object.keys(sync.collectAnnotationsFromLocalStorage()).length, 0); assert.equal(h.writes.length, 0);
        h.storage.setItem('c-35-7','new deliberate note'); await sync.executeAutoSave();
        assert.equal(h.cloud()['c-35-7'],'new deliberate note'); assert.equal(h.cloud()['p-35-3-pg-0'],'old single mark');
        assert.equal(h.storage.getItem('p-35-3-pg-0'), null); assert.equal(h.storage.getItem('c-35-7'),'new deliberate note');
        h.storage.setItem('c-35-1-2','new comment at cleared question'); await sync.executeAutoSave();
        assert.equal(h.cloud()['c-35-1-2'],'new comment at cleared question');
        assert.equal((await sync.pullMissing()).success,true); assert.equal(h.storage.getItem('p-35-3-pg-0'),'old single mark');
        assert.equal(sync.locallyCleared(),false);
    });
    await test('global local clear covers future article visits and explicit restore applies only to chosen article', async () => {
        const h = article(); h.storage.setItem('c-35-1','this'); h.storage.setItem('c-36-2','other'); h.storage.setItem('ca-copgm27:note-1','programme');
        h.sync.clearLocal(true); assert.equal(h.storage.getItem('c-36-2'),null);
        const next = vm.runInContext('new SentinelaSync()',h.context);
        next.estudoId='36'; next.semanaAtual='09-11';
        h.api.carregarSentinelaAnotacoes=async()=>({'c-36-2':'cloud old'});
        await next.loadFromSupabase(); assert.equal(h.storage.getItem('c-36-2'),null);
        await next.pullOverwrite(); assert.equal(h.storage.getItem('c-36-2'),'cloud old'); assert.equal(next.locallyCleared(),false);
        const first = vm.runInContext('new SentinelaSync()',h.context);
        first.detectSemanaEEstudo(); assert.equal(first.locallyCleared(),true);
        h.storage.setItem('ass26_sentinela_restore_36', String(Date.now()+100));
        first.clearLocal(true); assert.equal(next.locallyCleared(),true);
        assert.equal(h.storage.getItem('ca-copgm27:note-1'),'programme');
    });
    await test('local clear stops in-flight download and unload upload from repopulating cache', async () => {
        const h=article({'c-35-1':'old cloud'}); let finish;
        h.storage.setItem('c-35-1','old local'); h.api.carregarSentinelaAnotacoes=()=>new Promise(resolve=>finish=resolve);
        const loading=h.sync.loadFromSupabase(); h.sync.clearLocal(); finish({'c-35-1':'old cloud'});
        assert.equal((await loading).success,false); assert.equal(h.storage.getItem('c-35-1'),null);
        h.sync.dirty=true; h.sync.flushPendingSave(); await tick(); assert.equal(h.writes.length,0);
    });
    await test('failed explicit restore leaves local deletion active', async () => {
        const h=article(); h.sync.clearLocal(); const sync=vm.runInContext('new SentinelaSync()',h.context);
        sync.detectSemanaEEstudo(); h.api.carregarSentinelaAnotacoes=async()=>{throw Error('offline');};
        assert.equal((await sync.pullOverwrite()).success,false); assert.equal(sync.locallyCleared(),true);
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
    await test('richtext offline draft keeps both versions and requires an explicit choice', async () => {
        const h = notes(); const raw = JSON.stringify({ html: 'other device' }); h.remote(raw); h.run('save/auto-save.js'); await h.context.window.AutoSaveManager.ready; await tick();
        const manager = h.context.window.AutoSaveManager;
        assert.equal(h.writes.length, 0); assert.equal(h.dirty(), true); assert.ok(manager.getCloudConflict());
        assert.ok([...h.data.values()].some(value => value.includes('notes-cloud-recovery') && value.includes('other device')));
        await manager.forceAutoSave(); assert.equal(h.writes.length, 0);
        assert.equal(await manager.resolveCloudConflict('local'), true);
        assert.equal(h.writes.length, 1); assert.equal(h.writes[0].options.expectedRemote, raw); assert.equal(h.dirty(), false); assert.equal(manager.getCloudConflict(), null);
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
        h.api.carregarRichtextAnotacoes = async () => JSON.stringify({ html: 'cloud' }); await h.context.window.AutoSaveManager.resumeAutoSave();
        assert.equal(h.writes.length, 0); assert.ok(h.context.window.AutoSaveManager.getCloudConflict());
        await h.context.window.AutoSaveManager.resolveCloudConflict('local'); assert.equal(JSON.parse(h.writes[0].raw).html, 'typed');
    });
    await test('richtext atomic conflict persists and blocks automatic retries after reload', async () => {
        const h = notes('draft'); let cloud = null, attempts = 0;
        h.api.carregarRichtextAnotacoes = async () => cloud;
        h.api.salvarRichtextAnotacoes = async () => { attempts++; cloud = JSON.stringify({ html: 'winning device' }); return { success: false, code: 'SYNC_CONFLICT', error: 'changed' }; };
        h.run('save/auto-save.js'); await h.context.window.AutoSaveManager.ready; await tick();
        assert.equal(attempts, 1); assert.ok(h.context.window.AutoSaveManager.getCloudConflict()); assert.equal(h.value(), 'draft');
        await h.context.window.AutoSaveManager.forceAutoSave(); assert.equal(attempts, 1);
        const reopened = notes('draft'); for (const [key, value] of h.data) reopened.data.set(key, value);
        reopened.remote(cloud); reopened.run('save/auto-save.js'); await reopened.context.window.AutoSaveManager.ready; await tick();
        reopened.run('save/unified-load.js'); await reopened.context.window.UnifiedLoadManager.ready; await tick();
        assert.ok(reopened.context.window.AutoSaveManager.getCloudConflict()); assert.equal(reopened.writes.length, 0); assert.equal(reopened.value(), 'draft');
    });
    await test('richtext comparison refreshes before a choice when the cloud changed again', async () => {
        const h = notes('local draft'); h.remote(JSON.stringify({ html: 'remote first' })); h.run('save/auto-save.js');
        const manager = h.context.window.AutoSaveManager; await manager.ready; await tick();
        h.remote(JSON.stringify({ html: 'remote second' }));
        assert.equal(await manager.resolveCloudConflict('local'), false); assert.equal(h.writes.length, 0);
        assert.equal(manager.getCloudConflict().external.html, 'remote second');
        h.edit('typed while comparison was open');
        assert.equal(await manager.resolveCloudConflict('external'), true); assert.equal(h.value(), 'remote second'); assert.equal(h.writes.length, 0);
        assert.ok([...h.data.values()].some(value => value.includes('typed while comparison was open') && value.includes('remote second')));
    });
    await test('richtext stores acknowledged cloud baseline and does not prompt for an ordinary local edit', async () => {
        const h = notes('baseline', false); h.remote(JSON.stringify({ html: 'baseline' })); h.run('save/auto-save.js');
        const manager = h.context.window.AutoSaveManager; await manager.ready; manager.acknowledgeRemote(h.store.snapshot());
        h.edit('next edit'); await tick();
        assert.equal(h.writes.length, 1); assert.equal(manager.getCloudConflict(), null); assert.equal(h.dirty(), false);
        assert.ok([...h.data.keys()].some(key => key.includes('cloud_baseline')));
    });
    await test('richtext conflict choice cannot affect a new login during its read', async () => {
        const h = notes('draft'); const raw = JSON.stringify({ html: 'cloud' }); h.remote(raw); h.run('save/auto-save.js');
        const manager = h.context.window.AutoSaveManager; await manager.ready; await tick();
        h.api.carregarRichtextAnotacoes = async () => { h.storage.setItem('supabase_user', JSON.stringify({ id: 'test-user', loginId: 'two' })); return raw; };
        assert.equal(await manager.resolveCloudConflict('external'), false); assert.equal(h.value(), 'draft'); assert.equal(h.writes.length, 0);
    });
    await test('richtext cloud choice cannot replace typing made while its read was pending', async () => {
        const h = notes('draft'); const raw = JSON.stringify({ html: 'cloud' }); h.remote(raw); h.run('save/auto-save.js');
        const manager = h.context.window.AutoSaveManager; await manager.ready; await tick();
        let finish; h.api.carregarRichtextAnotacoes = () => new Promise(resolve => { finish = resolve; });
        const choosing = manager.resolveCloudConflict('external'); await tick(); h.edit('new typing after choice'); finish(raw);
        assert.equal(await choosing, false); assert.equal(h.value(), 'new typing after choice'); assert.equal(h.writes.length, 0);
        assert.equal(manager.getCloudConflict().local.html, 'new typing after choice');
    });
    await test('richtext adopting an absent cloud document allows the next deliberate edit', async () => {
        const h = notes('draft'); h.remote(JSON.stringify({ html: 'remote' })); h.run('save/auto-save.js');
        const manager = h.context.window.AutoSaveManager; await manager.ready; await tick();
        h.remote(null); assert.equal(await manager.resolveCloudConflict('external'), false);
        assert.equal(await manager.resolveCloudConflict('external'), true); assert.equal(h.value(), ''); assert.equal(manager.lastCloudKey, null);
        h.edit('new deliberate note'); await tick();
        assert.equal(h.writes.length, 1); assert.equal(manager.getCloudConflict(), null);
    });
    await test('richtext account switch clears the old notice without deleting that accounts recovery', async () => {
        const h = notes('draft'); h.remote(JSON.stringify({ html: 'remote' })); h.run('save/auto-save.js');
        const manager = h.context.window.AutoSaveManager; await manager.ready; await tick();
        const marker = manager.cloudStateKey('conflict'); assert.ok(h.storage.getItem(marker));
        h.storage.setItem('supabase_user', JSON.stringify({ id: 'other', loginId: 'new' })); manager.checkLoginStatus();
        assert.equal(manager.getCloudConflict(), null); assert.ok(h.storage.getItem(marker));
        assert.ok(h.events.some(event => event.type === 'notes:cloud-conflict-resolved'));
    });
    console.log(`${count} article and notes sync cases passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
