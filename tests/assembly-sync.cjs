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
    let cloud = remote, writes = [], deletions = [];
    context.window.SupabaseSync.carregarAssembleiaAnotacoes = async () => cloud;
    context.window.SupabaseSync.salvarAssembleiaAnotacoes = async (year, value) => { cloud = { ...value }; writes.push(value); return { success: true }; };
    context.window.SupabaseSync.apagarAssembleiaCompleto = async (year, options) => { cloud = {}; deletions.push({ year, options }); return { success: true }; };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(root, 'save/asmb-sync.js'), 'utf8'), context);
    const sync = context.window.assembleiaSync;
    sync.initialLoadComplete = true; sync.isLoggedIn = true;
    return { context, sync, storage, data, timers, events, writes, deletions, cloud: () => cloud };
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
    await test('manual merge download clears pending upload and remains read-only on resume', async () => {
        const key = 'ca-copgm27:nota:confiar-de-todo-coracao';
        const h = harness({ [key]: note('older cloud', 1) });
        h.storage.setItem(key, note('new local', 2));
        h.sync.scheduleAutoSave(); assert.equal(h.timers.size, 1);
        assert.equal((await h.sync.loadFromSupabase(true)).success, true);
        assert.equal(h.timers.size, 0); assert.equal(h.writes.length, 0);
        h.sync.resume(); await h.sync.executeAutoSave();
        assert.equal(h.writes.length, 0);
        assert.ok(h.storage.getItem(key).includes('new local'));
        assert.ok(h.cloud()[key].includes('older cloud'));
    });
    await test('intentional local/cloud differences survive reopening the page', async () => {
        for (const operation of ['pullMerge', 'pullMissing', 'pushMissing']) {
            const h = harness({ 'ca-copgm27:nota:a': note('cloud', 1) });
            h.storage.setItem('ca-copgm27:nota:a', note('local', 10));
            h.storage.setItem('ca-copgm27:nota:b', note('local only', 10));
            assert.equal((await h.sync[operation]()).success, true);
            const writes = h.writes.length;
            const reopened = vm.runInContext('new AssembleiaSync()', h.context);
            assert.equal((await reopened.loadFromSupabase()).success, true);
            await reopened.executeAutoSave();
            assert.equal(h.writes.length, writes, operation);
            assert.ok(h.storage.getItem('ca-copgm27:nota:a').includes('local'));
            assert.ok(h.cloud()['ca-copgm27:nota:a'].includes('cloud'));
            h.storage.setItem('ca-copgm27:nota:a', note('new edit after reopening', 20));
            await reopened.executeAutoSave();
            assert.ok(h.cloud()['ca-copgm27:nota:a'].includes('new edit after reopening'));
        }
    });
    await test('persisted checkpoint does not hide a genuine offline edit or newer remote update', async () => {
        const h = harness({ 'ca-copgm27:nota:a': note('cloud', 1) });
        h.storage.setItem('ca-copgm27:nota:a', note('local', 10));
        await h.sync.pushMissing();
        h.storage.setItem('ca-copgm27:nota:a', note('offline newer', 20));
        const reopened = vm.runInContext('new AssembleiaSync()', h.context);
        await reopened.loadFromSupabase(); await reopened.executeAutoSave();
        assert.ok(h.cloud()['ca-copgm27:nota:a'].includes('offline newer'));
        h.cloud()['ca-copgm27:nota:a'] = note('newest remote', 30);
        const secondReopen = vm.runInContext('new AssembleiaSync()', h.context);
        await secondReopen.loadFromSupabase();
        assert.ok(h.storage.getItem('ca-copgm27:nota:a').includes('newest remote'));
    });
    await test('a remote deletion of unchanged synced notes is not resurrected on reopen', async () => {
        const h = harness({ 'ca-copgm27:nota:a': note('cloud', 1) });
        await h.sync.pullOverwrite();
        delete h.cloud()['ca-copgm27:nota:a'];
        const reopened = vm.runInContext('new AssembleiaSync()', h.context);
        assert.equal((await reopened.loadFromSupabase()).success, true);
        await reopened.executeAutoSave();
        assert.equal(h.storage.getItem('ca-copgm27:nota:a'), null);
        assert.equal(h.writes.length, 0);
        assert.ok(reopened.getRecoveries().some(copy => copy.values['ca-copgm27:nota:a']?.includes('cloud')));
    });
    await test('missing-only download preserves existing and explicitly empty local entries', async () => {
        const h = harness({ 'ca-copgm27:nota:a': note('remote', 5), 'ca-copgm27:nota:b': note('remote B', 5), 'cor-assembleia': '#111111' });
        h.storage.setItem('ca-copgm27:nota:a', ''); h.storage.setItem('cor-assembleia', '#222222');
        assert.equal((await h.sync.pullMissing()).success, true);
        assert.equal(h.storage.getItem('ca-copgm27:nota:a'), '');
        assert.ok(h.storage.getItem('ca-copgm27:nota:b').includes('remote B'));
        assert.equal(h.storage.getItem('cor-assembleia'), '#222222');
        await h.sync.executeAutoSave(); assert.equal(h.writes.length, 0);
    });
    await test('missing-only upload preserves cloud contents even after an unrelated later edit', async () => {
        const h = harness({ 'ca-copgm27:nota:a': '', 'ca-copgm27:nota:b': note('cloud B', 1) });
        h.storage.setItem('ca-copgm27:nota:a', note('local A', 10));
        h.storage.setItem('ca-copgm27:nota:b', note('local B', 10));
        h.storage.setItem('ca-copgm27:nota:c', note('new C', 10));
        assert.equal((await h.sync.pushMissing()).success, true);
        assert.equal(h.cloud()['ca-copgm27:nota:a'], '');
        assert.ok(h.cloud()['ca-copgm27:nota:b'].includes('cloud B'));
        assert.ok(h.cloud()['ca-copgm27:nota:c'].includes('new C'));
        await h.sync.executeAutoSave(); assert.equal(h.writes.length, 1);
        h.storage.setItem('ca-copgm27:nota:c', note('edited C', 20));
        await h.sync.executeAutoSave();
        assert.equal(h.cloud()['ca-copgm27:nota:a'], '');
        assert.ok(h.cloud()['ca-copgm27:nota:b'].includes('cloud B'));
        assert.ok(h.cloud()['ca-copgm27:nota:c'].includes('edited C'));
        assert.ok(h.storage.getItem('ca-copgm27:nota:b').includes('local B'));
        h.storage.setItem('ca-copgm27:nota:b', note('deliberately edited B', 30));
        await h.sync.executeAutoSave();
        assert.ok(h.cloud()['ca-copgm27:nota:b'].includes('deliberately edited B'));
    });
    await test('manual merge chooses newer conflicting note and backs up replaced local text', async () => {
        const h = harness({ 'ca-copgm27:nota:a': note('new cloud', 20), 'ca-copgm27:nota:b': note('cloud only', 20) });
        h.storage.setItem('ca-copgm27:nota:a', note('old local', 10));
        h.storage.setItem('ca-copgm27:nota:c', note('local only', 10));
        assert.equal((await h.sync.pushMerge()).success, true);
        assert.ok(h.cloud()['ca-copgm27:nota:a'].includes('new cloud'));
        assert.ok(h.cloud()['ca-copgm27:nota:b'].includes('cloud only'));
        assert.ok(h.cloud()['ca-copgm27:nota:c'].includes('local only'));
        assert.ok(h.sync.getRecoveries().some(copy => copy.values['ca-copgm27:nota:a']?.includes('old local')));
    });
    await test('overwrite uploads exact current programme snapshot and keeps displaced cloud backup', async () => {
        const h = harness({ 'ca-copgm27:nota:old': note('only cloud', 20) });
        h.storage.setItem('ca-copgm27:nota:new', note('only local', 10));
        h.storage.setItem('foreign-app', 'never send');
        assert.equal((await h.sync.pushOverwrite()).success, true);
        assert.deepEqual(Object.keys(h.cloud()), ['ca-copgm27:nota:new']);
        assert.ok(h.sync.getRecoveries().some(copy => copy.values['ca-copgm27:nota:old']?.includes('only cloud')));
    });
    await test('explicit empty cloud is an intentional restore, unlike absent cloud', async () => {
        const h = harness({}); h.storage.setItem('ca-copgm27:nota:a', note('local', 20));
        h.storage.setItem('foreign-app', 'keep');
        assert.equal((await h.sync.pullOverwrite()).success, true);
        assert.equal(h.storage.getItem('ca-copgm27:nota:a'), null);
        assert.equal(h.storage.getItem('foreign-app'), 'keep');
        assert.equal(h.sync.getRecoveries().length, 1);
        assert.equal(h.writes.length, 0);
    });
    await test('an explicitly cleared newer note remains authoritative during merge', async () => {
        const h = harness({ 'ca-copgm27:nota:a': note('old text', 10) });
        h.storage.setItem('ca-copgm27:nota:a', note('', 20));
        assert.equal((await h.sync.pushMerge()).success, true);
        assert.equal(JSON.parse(h.cloud()['ca-copgm27:nota:a']).fullText, '');
    });
    await test('delete is serialized against an ongoing upload', async () => {
        const h = harness(); let release;
        h.storage.setItem('ca-copgm27:nota:a', note('local', 1));
        h.context.window.SupabaseSync.salvarAssembleiaAnotacoes = () => new Promise(resolve => { release = () => resolve({ success: true }); });
        const pending = h.sync.executeAutoSave(); await new Promise(setImmediate);
        assert.equal((await h.sync.deleteAll()).success, false);
        assert.equal(h.deletions.length, 0);
        release(); await pending;
    });
    await test('delete clears pending automatic uploads, preserves preferences, and does not recreate cloud notes', async () => {
        const remote = { 'ca-copgm27:nota:a': note('cloud', 1) };
        const h = harness(remote);
        h.storage.setItem('ca-copgm27:nota:a', note('local', 2)); h.storage.setItem('cor-assembleia', '#604184');
        h.storage.setItem('other-system', 'untouched'); h.sync.scheduleAutoSave();
        assert.equal((await h.sync.deleteAll()).success, true);
        assert.equal(h.storage.getItem('ca-copgm27:nota:a'), null);
        assert.equal(h.storage.getItem('cor-assembleia'), '#604184');
        assert.equal(h.storage.getItem('other-system'), 'untouched');
        assert.equal(h.timers.size, 0);
        assert.deepEqual(JSON.parse(JSON.stringify(h.deletions[0].options.expectedRemote)), remote);
        h.sync.resume(); await h.sync.executeAutoSave();
        assert.equal(h.writes.length, 0); assert.deepEqual(h.cloud(), {});
        const backups = JSON.stringify(h.sync.getRecoveries());
        assert.ok(backups.includes('cloud')); assert.ok(backups.includes('local'));
    });
    await test('failed cloud deletion never removes local notes', async () => {
        const h = harness({ 'ca-copgm27:nota:a': note('cloud', 1) });
        h.storage.setItem('ca-copgm27:nota:a', note('local', 2));
        h.context.window.SupabaseSync.apagarAssembleiaCompleto = async () => ({ success: false, error: 'offline' });
        assert.equal((await h.sync.deleteAll()).success, false);
        assert.ok(h.storage.getItem('ca-copgm27:nota:a').includes('local'));
        assert.equal(h.sync.isSyncing, false);
    });
    await test('edits made during cloud deletion stay local without automatically recreating the deleted backup', async () => {
        const h = harness({ 'ca-copgm27:nota:a': note('cloud', 1) }); let release;
        h.storage.setItem('ca-copgm27:nota:a', note('local', 2));
        h.context.window.SupabaseSync.apagarAssembleiaCompleto = () => new Promise(resolve => { release = () => resolve({ success: true }); });
        const pending = h.sync.deleteAll(); await new Promise(setImmediate);
        h.storage.setItem('ca-copgm27:nota:a', note('new editing', 3)); h.sync.scheduleAutoSave();
        release(); const result = await pending;
        assert.equal(result.success, true); assert.equal(result.preservedLocalChanges, true);
        assert.ok(h.storage.getItem('ca-copgm27:nota:a').includes('new editing'));
        await h.sync.executeAutoSave(); assert.equal(h.writes.length, 0);
    });
    await test('switching account or login generation during reads cannot apply or send another session data', async () => {
        for (const user of [{ id: 'new-user' }, { id: 'qa-user', loginId: 'new-login' }]) {
            const h = harness(); let release;
            h.storage.setItem('ca-copgm27:nota:a', note('local', 1));
            h.context.window.SupabaseSync.carregarAssembleiaAnotacoes = () => new Promise(resolve => release = resolve);
            const pending = h.sync.pushOverwrite();
            h.storage.setItem('supabase_user', JSON.stringify(user));
            release({ 'ca-copgm27:nota:a': note('remote', 2) });
            assert.equal((await pending).success, false);
            assert.equal(h.writes.length, 0); assert.ok(h.storage.getItem('ca-copgm27:nota:a').includes('local'));
        }
    });
    await test('account switch resets sync baseline and does not automatically upload the previous account notes', async () => {
        const h = harness({ 'ca-copgm27:nota:a': note('other account cloud', 1) });
        h.storage.setItem('ca-copgm27:nota:a', note('previous account local', 10));
        h.sync.lastSavedDataJSON = h.sync.stable({ 'ca-copgm27:nota:a': note('previous account local', 10) });
        h.storage.setItem('supabase_user', JSON.stringify({ id: 'new-user' }));
        h.sync.checkLoginStatus(); assert.equal(h.sync.initialLoadComplete, false);
        assert.equal(h.sync.lastSavedDataJSON, '{}');
        assert.equal((await h.sync.loadFromSupabase()).success, true);
        await h.sync.executeAutoSave(); assert.equal(h.writes.length, 0);
        assert.ok(h.storage.getItem('ca-copgm27:nota:a').includes('previous account local'));
    });
    await test('unsaved in-memory draft blocks upload, restore, and deletion safely', async () => {
        for (const operation of ['pushOverwrite', 'pullOverwrite', 'deleteAll', 'executeAutoSave']) {
            const h = harness({ 'ca-copgm27:nota:a': note('remote', 1) });
            h.storage.setItem('ca-copgm27:nota:a', note('outdated storage', 1));
            h.context.window.AssembleiaIA = { flushPendingWrites: () => false };
            assert.equal((await h.sync[operation]()).success, false);
            assert.equal(h.writes.length, 0); assert.equal(h.deletions.length, 0);
            assert.equal(h.sync.isSyncing, false);
            assert.ok(h.storage.getItem('ca-copgm27:nota:a').includes('outdated storage'));
        }
    });
    await test('pending local draft is flushed before the cloud snapshot is assembled', async () => {
        const h = harness(); let pending = true;
        h.storage.setItem('ca-copgm27:nota:a', note('outdated storage', 1));
        h.context.window.AssembleiaIA = { flushPendingWrites() {
            if (pending) h.storage.setItem('ca-copgm27:nota:a', note('latest in-memory draft', 2));
            pending = false; return true;
        } };
        assert.equal((await h.sync.pushOverwrite()).success, true);
        assert.ok(h.cloud()['ca-copgm27:nota:a'].includes('latest in-memory draft'));
    });
    await test('storage failure while collecting notes releases operation lock', async () => {
        const h = harness(); h.storage.key = () => { throw new Error('storage unavailable'); };
        assert.equal((await h.sync.loadFromSupabase()).success, false); assert.equal(h.sync.isSyncing, false);
        assert.equal((await h.sync.pullOverwrite()).success, false); assert.equal(h.sync.isSyncing, false);
    });
    await test('unknown manual modes never mutate cloud or local data', async () => {
        const h = harness({ 'ca-copgm27:nota:a': note('cloud', 1) });
        assert.equal((await h.sync.push('unknown')).success, false);
        assert.equal((await h.sync.pull('unknown')).success, false);
        assert.equal(h.writes.length, 0); assert.equal(h.sync.getRecoveries().length, 0);
    });
    await test('failed Supabase preflight prevents writing and uses assembly cloud type', async () => {
        const filters = []; let mutated = false;
        const builder = { select() { return this; }, eq(key, value) { filters.push([key, value]); return this; }, maybeSingle: async () => ({ data: null, error: new Error('query failed') }), update() { mutated = true; return this; }, insert() { mutated = true; return this; } };
        const ctx = { window: { SupabaseSync: {} }, navigator: {}, console };
        vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(root, 'save/supabase.js'), 'utf8') + '\nwindow.TestClass = SupabaseSync;', ctx);
        const client = Object.create(ctx.window.TestClass.prototype);
        Object.assign(client, { currentUser: { id: 'qa-user' }, isOnline: true, supabase: { from: () => builder }, ensureInitialized: async () => true,
            checkExistingSession() { return { status: 'signed-in', raw: 'qa-session', user: { id: 'qa-user' } }; } });
        assert.equal((await client.salvarAssembleiaAnotacoes('ca-copgm27', {})).success, false);
        assert.equal(mutated, false); assert.ok(filters.some(([key, val]) => key === 'tipo' && val === 'ass26:programacao'));
        await assert.rejects(() => client.carregarAssembleiaAnotacoes('ca-copgm27'), /query failed/);
    });
    await test('100 KB notes are sent in the body, never in query filters', async () => {
        const filters = [], previous = { 'ca-copgm27:nota:confiar-de-todo-coracao': note('x'.repeat(100000), 100) };
        let payload, writing = false;
        const builder = { select() { return this; }, eq(key, value) { filters.push([key, value]); return this; },
            update(value) { payload = value; writing = true; return this; },
            maybeSingle: async () => ({ data: writing ? { id: 'row1', conteudo_html: payload.conteudo_html, xmin: '102' } : { id: 'row1', conteudo_html: JSON.stringify(previous), xmin: '101' }, error: null }) };
        const ctx = { window: { SupabaseSync: {} }, navigator: {}, console };
        vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(root, 'save/supabase.js'), 'utf8') + '\nwindow.TestClass = SupabaseSync;', ctx);
        const client = Object.create(ctx.window.TestClass.prototype);
        Object.assign(client, { currentUser: { id: 'qa-user' }, isOnline: true, supabase: { from: () => builder }, ensureInitialized: async () => true,
            checkExistingSession() { return { status: 'signed-in', raw: 'qa-session', user: { id: 'qa-user' } }; } });
        const result = await client.salvarAssembleiaAnotacoes('ca-copgm27', previous, { expectedRemote: previous });
        assert.equal(result.success, true);
        assert.ok(payload.conteudo_html.length > 100000);
        assert.ok(filters.every(([key, value]) => key !== 'conteudo_html' && String(value).length < 100));
        assert.ok(filters.some(([key, value]) => key === 'xmin' && value === '101'));
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
            maybeSingle: async () => ({data: filters.at(-1)==='assembleia2026:richtext' ? {id:'row1',conteudo_html:'preserved note',xmin:'101'} : response, error:null}) };
        const client = Object.create(ctx.window.TestClass.prototype);
        Object.assign(client, {currentUser:{id:'qa-user'},isOnline:true,supabase:{from:()=>builder},ensureInitialized:async()=>true,
            checkExistingSession(){ return {status:'signed-in',raw:'qa-session',user:{id:'qa-user'}}; }});
        assert.equal(await client.carregarRichtextAnotacoes('07-11'), 'preserved note');
        assert.deepEqual(filters,['ass26:richtext','assembleia2026:richtext']);
        filters.length=0;response={id:'row1',conteudo_html:'',xmin:'102'};
        assert.equal(await client.carregarRichtextAnotacoes('07-11'), '');
        assert.deepEqual(filters,['ass26:richtext']);
        assert.equal((await client.salvarAssembleiaAnotacoes('2026', {})).success,false);
    });
    console.log(`${count} persistence checks passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
