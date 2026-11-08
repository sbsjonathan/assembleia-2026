/* Synthetic Supabase contract: no network, credentials or user documents. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto').webcrypto;
const source = fs.readFileSync(path.join(__dirname, '../save/supabase.js'), 'utf8');
const USER = { id: 'synthetic-a', usuario: 'synthetic', nome: 'Synthetic', loginId: 'login-a' };
const PROGRAM = 'ca-copgm27';
const WEEK = '2026-11-02';
const STUDY = 'study-1';
const NOTE = { [`${PROGRAM}:nota:confiar-de-todo-coracao`]: 'synthetic note' };
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const tick = () => new Promise(setImmediate);

function harness(initialRows = []) {
    const rows = clone(initialRows), requests = [], mutations = [];
    const storage = new Map([['supabase_user', JSON.stringify(USER)]]);
    let nextId = 1, interceptor = null, failStorageRead = false;
    const listeners = new Map();
    const localStorage = {
        getItem(key) { if (failStorageRead) throw new Error('temporary storage failure'); return storage.get(key) ?? null; },
        setItem(key, value) { storage.set(key, String(value)); },
        removeItem(key) { storage.delete(key); }
    };
    class Query {
        constructor(table) { this.table = table; this.op = 'read'; this.filters = []; this.columns = '*'; this.returning = false; }
        select(columns = '*') { this.columns = columns; this.returning = true; return this; }
        eq(key, value) { this.filters.push({ key, value, op: 'eq' }); return this; }
        in(key, value) { this.filters.push({ key, value, op: 'in' }); return this; }
        limit(value) { this.rowLimit = value; return this; }
        insert(value) { this.op = 'insert'; this.payload = clone(value); return this; }
        update(value) { this.op = 'update'; this.payload = clone(value); return this; }
        delete() { this.op = 'delete'; return this; }
        single() { this.cardinality = 'single'; return this.execute(); }
        maybeSingle() { this.cardinality = 'maybeSingle'; return this.execute(); }
        then(resolve, reject) { return this.execute().then(resolve, reject); }
        async execute() {
            const request = clone({ table: this.table, op: this.op, filters: this.filters, payload: this.payload, columns: this.columns });
            requests.push(request);
            if (interceptor) {
                const override = await interceptor(request);
                if (override !== undefined) return clone(override);
            }
            const matching = rows.filter(row => this.filters.every(filter => filter.op === 'in' ? filter.value.includes(row[filter.key]) : row[filter.key] === filter.value));
            let result = matching;
            if (this.op !== 'read') {
                assert.equal(this.table, 'richtext_anotacoes', 'unexpected table mutation');
                const check = candidate => {
                    for (const key of ['tipo', 'semana']) if (typeof candidate[key] === 'string' && candidate[key].length > 20) return { data: null, error: { code: '22001', message: 'value too long for type character varying(20)' } };
                };
                if (this.op === 'insert') {
                    const candidate = { id: `synthetic-row-${nextId++}`, ...this.payload };
                    const failure = check(candidate); if (failure) return failure;
                    if (rows.some(row => row.usuario_id === candidate.usuario_id && row.tipo === candidate.tipo && row.semana === candidate.semana)) return { data: null, error: { code: '23505', message: 'duplicate synthetic document' } };
                    rows.push(candidate); result = [candidate];
                } else if (this.op === 'update') {
                    for (const row of matching) { const failure = check({ ...row, ...this.payload }); if (failure) return failure; }
                    matching.forEach(row => Object.assign(row, this.payload));
                } else if (this.op === 'delete') {
                    matching.forEach(row => rows.splice(rows.indexOf(row), 1));
                }
                mutations.push(request);
            }
            if (this.rowLimit) result = result.slice(0, this.rowLimit);
            const columns = this.columns.split(',').map(part => part.trim());
            const projected = result.map(row => this.columns === '*' ? clone(row) : Object.fromEntries(columns.filter(key => key in row).map(key => [key, row[key]])));
            if (this.cardinality) {
                if (projected.length > 1 || (this.cardinality === 'single' && !projected.length)) return { data: null, error: { code: 'PGRST116', message: 'synthetic cardinality mismatch' } };
                return { data: projected[0] ?? null, error: null };
            }
            return { data: this.returning ? projected : null, error: null };
        }
    }
    const sdk = { createClient: () => ({ from: table => new Query(table) }) };
    const window = {
        SUPABASE_CONFIG: { url: 'https://synthetic.invalid', anonKey: 'synthetic' },
        addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(listener); },
        dispatchEvent(event) { for (const listener of listeners.get(event.type) || []) listener(event); }
    };
    const context = { window, supabase: sdk, localStorage, navigator: { onLine: true }, console, Event, crypto, TextEncoder };
    vm.createContext(context); vm.runInContext(source, context);
    return {
        client: window.SupabaseSync, rows, requests, mutations, storage, localStorage, window,
        intercept(fn) { interceptor = fn; },
        storageFailure(value) { failStorageRead = value; },
        relogin(id = USER.id) { storage.set('supabase_user', JSON.stringify({ ...USER, id, loginId: 'login-new' })); }
    };
}
function document(tipo, semana, value, extra = {}) {
    return { id: `row-${tipo}-${semana}`, usuario_id: USER.id, tipo, semana, conteudo_html: typeof value === 'string' ? value : JSON.stringify(value), ...extra };
}
const wrapper = (annotations = {}, estudo = STUDY) => ({ estudo, anotacoes: annotations, timestamp: '2026-11-08T00:00:00.000Z' });
const readSpecs = [
    { name: 'programme', tipo: 'ass26:programacao', semana: PROGRAM, read: client => client.carregarAssembleiaAnotacoes(PROGRAM), save: (client, value, options) => client.salvarAssembleiaAnotacoes(PROGRAM, value, options), value: NOTE, empty: {}, encode: value => value, legacy: ['ass26:programacao:ca-copgm27'] },
    { name: 'richtext', tipo: 'ass26:richtext', semana: WEEK, read: client => client.carregarRichtextAnotacoes(WEEK), save: (client, value, options) => client.salvarRichtextAnotacoes(WEEK, value, options), value: '<p>Synthetic note</p>', empty: '', encode: value => value, legacy: ['assembleia2026:richtext'] },
    { name: 'watchtower', tipo: 'ass26:sentinela', semana: WEEK, read: client => client.carregarSentinelaAnotacoes(WEEK, STUDY), save: (client, value, options) => client.salvarSentinelaAnotacoes(WEEK, STUDY, value, options), value: { 'anotacao_semana_2026-11-02_p1': 'Synthetic answer' }, empty: {}, encode: value => wrapper(value), legacy: ['ass26:sentinela_anotacoes', 'assembleia2026:sentinela_anotacoes'] }
];
let count = 0;
async function test(name, fn) { await fn(); count++; console.log('PASS', name); }

(async () => {
    await test('every active document writes identifiers accepted by varchar(20)', async () => {
        for (const spec of readSpecs) {
            const h = harness();
            const result = await spec.save(h.client, spec.value, { expectedRemote: null });
            assert.equal(result.success, true, `${spec.name}: ${result.error}`);
            assert.equal(h.rows.length, 1); assert.equal(h.rows[0].tipo, spec.tipo); assert.equal(h.rows[0].semana, spec.semana);
            assert.equal(h.rows[0].usuario_id, USER.id); assert.ok(h.rows[0].tipo.length <= 20);
            assert.deepEqual(clone(await spec.read(h.client)), spec.value);
        }
    });
    await test('document reads are scoped by account, week or programme, and application', async () => {
        for (const spec of readSpecs) {
            const target = document(spec.tipo, spec.semana, spec.encode(spec.value));
            const unrelated = [
                document(spec.tipo, spec.semana, spec.encode(spec.empty), { id: 'other-user', usuario_id: 'synthetic-b' }),
                document(spec.tipo, 'other-week', spec.encode(spec.empty), { id: 'other-week' }),
                document(spec.tipo.replace('ass26:', ''), spec.semana, spec.encode(spec.empty), { id: 'original-app' })
            ];
            const h = harness([target, ...unrelated]);
            assert.deepEqual(clone(await spec.read(h.client)), spec.value);
            assert.equal((await spec.save(h.client, spec.empty, { expectedRemote: spec.value })).success, true);
            assert.deepEqual(h.rows.filter(row => row.id !== target.id), unrelated);
            for (const request of h.requests.filter(query => query.op === 'read')) {
                assert.ok(request.filters.some(filter => filter.key === 'usuario_id' && filter.value === USER.id));
                assert.ok(request.filters.some(filter => filter.key === 'semana' && filter.value === spec.semana));
                assert.ok(request.filters.some(filter => filter.key === 'tipo'));
            }
        }
    });
    await test('legacy Assembly copies remain readable and migrate through short canonical keys', async () => {
        for (const spec of readSpecs) for (const legacy of spec.legacy) {
            const old = document(legacy, spec.semana, spec.encode(spec.value));
            const h = harness([old]);
            assert.deepEqual(clone(await spec.read(h.client)), spec.value, legacy);
            assert.equal((await spec.save(h.client, spec.empty, { expectedRemote: spec.value })).success, true);
            assert.deepEqual(clone(await spec.read(h.client)), spec.empty);
            assert.equal(h.rows.some(row => row.tipo === spec.tipo), true);
            assert.deepEqual(h.rows.find(row => row.id === old.id), old, 'legacy copy is preserved');
        }
    });
    await test('empty canonical documents are authoritative; only absent rows use legacy fallback', async () => {
        for (const spec of readSpecs) {
            const h = harness([document(spec.tipo, spec.semana, spec.encode(spec.empty)), document(spec.legacy[0], spec.semana, spec.encode(spec.value))]);
            assert.deepEqual(clone(await spec.read(h.client)), spec.empty);
            assert.equal(h.requests.length, 1, 'empty value must not trigger a legacy query');
            assert.equal(await spec.read(harness().client), null, spec.name);
        }
    });
    await test('query errors never become missing documents and never trigger writes', async () => {
        for (const spec of readSpecs) {
            const h = harness();
            h.intercept(query => query.op === 'read' ? { data: null, error: { code: '503', message: 'synthetic network outage' } } : undefined);
            await assert.rejects(() => spec.read(h.client));
            const result = await spec.save(h.client, spec.value);
            assert.equal(result.success, false); assert.equal(h.mutations.length, 0); assert.equal(h.rows.length, 0);
        }
    });
    await test('malformed read acknowledgements are failures and do not trigger legacy fallback', async () => {
        for (const spec of readSpecs) for (const data of [undefined, {}, [], { id: 'synthetic-row' }, { id: 'synthetic-row', conteudo_html: null }]) {
            const h = harness(); h.intercept(() => ({ data, error: null }));
            await assert.rejects(() => spec.read(h.client));
            assert.equal(h.requests.length, 1);
        }
    });
    await test('invalid JSON or wrong document shape cannot be silently overwritten', async () => {
        for (const spec of readSpecs.filter(item => item.name !== 'richtext')) {
            for (const value of ['{broken', 'null', '[]', '"not an object"']) {
                const row = document(spec.tipo, spec.semana, value), h = harness([row]);
                await assert.rejects(() => spec.read(h.client));
                assert.equal((await spec.save(h.client, spec.value, { expectedRemote: null })).success, false);
                assert.equal(h.mutations.length, 0); assert.deepEqual(h.rows[0], row);
            }
        }
    });
    await test('invalid outgoing payloads never create malformed cloud documents', async () => {
        for (const spec of readSpecs) {
            const invalid = spec.name === 'richtext' ? [null, undefined, {}, [], 5] : [null, undefined, [], 'text', 5];
            for (const value of invalid) {
                const h = harness();
                assert.equal((await spec.save(h.client, value)).success, false, `${spec.name}: ${String(value)}`);
                assert.equal(h.mutations.length, 0);
            }
        }
    });
    await test('a Watchtower document for another study is rejected within the same week', async () => {
        const h = harness([document('ass26:sentinela', WEEK, wrapper({ other: 'preserve' }, 'different-study'))]);
        await assert.rejects(() => h.client.carregarSentinelaAnotacoes(WEEK, STUDY));
        assert.equal((await h.client.salvarSentinelaAnotacoes(WEEK, STUDY, {}, { expectedRemote: null })).success, false);
        assert.equal(h.mutations.length, 0);
    });
    await test('missing Watchtower study identity cannot be written or accepted as a matching document', async () => {
        const h = harness([document('ass26:sentinela', WEEK, { anotacoes: {} })]);
        await assert.rejects(() => h.client.carregarSentinelaAnotacoes(WEEK, STUDY));
        assert.equal((await h.client.salvarSentinelaAnotacoes(WEEK, undefined, {})).success, false);
        assert.equal(h.mutations.length, 0);
    });
    await test('preflight distinguishes absent, explicitly empty and changed remote documents', async () => {
        for (const spec of readSpecs) {
            const missing = harness();
            assert.equal((await spec.save(missing.client, spec.value, { expectedRemote: spec.empty })).success, false);
            const empty = harness([document(spec.tipo, spec.semana, spec.encode(spec.empty))]);
            assert.equal((await spec.save(empty.client, spec.value, { expectedRemote: null })).success, false);
            const changed = harness([document(spec.tipo, spec.semana, spec.encode(spec.value))]);
            assert.equal((await spec.save(changed.client, spec.empty, { expectedRemote: spec.empty })).success, false);
            for (const h of [missing, empty, changed]) assert.equal(h.mutations.length, 0);
            assert.equal((await spec.save(changed.client, spec.empty, { expectedRemote: spec.value })).success, true);
        }
    });
    await test('semantic JSON comparison ignores object property order', async () => {
        for (const spec of readSpecs.filter(item => item.name !== 'richtext')) {
            const value = { a: { z: 1, b: 2 }, b: 'value' };
            const h = harness([document(spec.tipo, spec.semana, spec.encode(value))]);
            assert.equal((await spec.save(h.client, spec.empty, { expectedRemote: { b: 'value', a: { b: 2, z: 1 } } })).success, true);
        }
    });
    await test('failed or empty mutation responses never report a successful save', async () => {
        for (const spec of readSpecs) for (const error of [null, { code: '42501', message: 'synthetic denied write' }]) {
            const h = harness(); h.intercept(query => query.op === 'read' ? undefined : { data: null, error });
            const result = await spec.save(h.client, spec.value);
            assert.equal(result.success, false); assert.equal(h.rows.length, 0);
        }
    });
    await test('mutation acknowledgement must confirm the exact document sent', async () => {
        for (const spec of readSpecs) for (const data of [{}, [], { id: 'synthetic-row' }, { id: 'synthetic-row', conteudo_html: 'different document' }]) {
            const h = harness(); h.intercept(query => query.op === 'read' ? undefined : { data, error: null });
            assert.equal((await spec.save(h.client, spec.value)).success, false);
        }
    });
    await test('same-document writes are serialized and the next preflight sees the confirmed change', async () => {
        for (const spec of readSpecs) {
            const h = harness(), pending = deferred(); let started = false;
            h.intercept(async query => { if (query.op !== 'read') { started = true; await pending.promise; } });
            const first = spec.save(h.client, spec.value, { expectedRemote: null });
            while (!started) await tick();
            const requestCount = h.requests.length;
            const second = spec.save(h.client, spec.empty, { expectedRemote: null });
            await tick(); assert.equal(h.requests.length, requestCount, 'second write must await first acknowledgement');
            pending.resolve();
            assert.equal((await first).success, true); assert.equal((await second).success, false);
            assert.deepEqual(clone(await spec.read(h.client)), spec.value);
            assert.equal(h.mutations.length, 1);
        }
    });
    await test('same-account re-login cannot bypass a document write already in flight', async () => {
        for (const spec of readSpecs) {
            const h = harness(), pending = deferred(); let started = false;
            h.intercept(async query => { if (query.op !== 'read') { started = true; await pending.promise; } });
            const first = spec.save(h.client, spec.value, { expectedRemote: null });
            while (!started) await tick();
            const requestCount = h.requests.length;
            h.relogin();
            const second = spec.save(h.client, spec.empty, { expectedRemote: null });
            await tick(); const requestsBeforeAcknowledgement = h.requests.length;
            pending.resolve();
            const results = await Promise.all([first, second]);
            assert.equal(requestsBeforeAcknowledgement, requestCount, 'same account must retain document ordering across a fresh login');
            assert.equal(results[0].success, false, 'old session cannot acknowledge success');
            assert.equal(results[1].success, false, 'new session sees the now-changed document at preflight');
            assert.deepEqual(clone(await spec.read(h.client)), spec.value);
        }
    });
    await test('a changed account or fresh login invalidates pending reads and preflight writes', async () => {
        for (const spec of readSpecs) for (const nextAccount of [USER.id, 'synthetic-b']) {
            for (const action of ['read', 'save']) {
                const h = harness([document(spec.tipo, spec.semana, spec.encode(spec.value))]), pending = deferred();
                h.intercept(async query => { if (query.op === 'read') await pending.promise; });
                const task = action === 'read' ? spec.read(h.client).then(() => ({ success: true }), () => ({ success: false })) : spec.save(h.client, spec.empty);
                await tick(); h.relogin(nextAccount); pending.resolve();
                assert.equal((await task).success, false, `${spec.name} ${action} ${nextAccount}`);
                assert.equal(h.mutations.length, 0);
            }
        }
    });
    await test('account changes while SDK initialization waits cannot redirect a requested operation', async () => {
        for (const spec of readSpecs) for (const action of ['read', 'save']) {
            const h = harness(), pending = deferred();
            h.client.ensureInitialized = () => pending.promise;
            const task = action === 'read' ? spec.read(h.client).then(() => ({ success: true }), () => ({ success: false })) : spec.save(h.client, spec.value);
            h.relogin('synthetic-b'); pending.resolve(true);
            assert.equal((await task).success, false, `${spec.name} ${action}`);
            assert.equal(h.requests.length, 0);
        }
    });
    await test('a late acknowledgement after logout cannot announce saved data to a different session', async () => {
        for (const spec of readSpecs) {
            const h = harness(), pending = deferred(); let started = false;
            h.intercept(async query => { if (query.op !== 'read') { started = true; await pending.promise; } });
            const task = spec.save(h.client, spec.value); while (!started) await tick();
            h.client.logout(); pending.resolve();
            assert.equal((await task).success, false);
        }
    });
    await test('offline or unreadable local identity prevents document operations', async () => {
        for (const spec of readSpecs) for (const reason of ['offline', 'storage', 'logout']) {
            const h = harness(); if (reason === 'offline') h.client.isOnline = false;
            else if (reason === 'storage') h.storageFailure(true); else h.client.logout();
            await assert.rejects(() => spec.read(h.client));
            assert.equal((await spec.save(h.client, spec.value)).success, false);
            assert.equal(h.requests.length, 0);
        }
    });
    await test('programme deletion leaves an empty canonical document instead of reviving legacy content', async () => {
        const legacy = document('ass26:programacao:ca-copgm27', PROGRAM, NOTE);
        const h = harness([legacy]);
        assert.equal((await h.client.apagarAssembleiaCompleto(PROGRAM, { expectedRemote: NOTE })).success, true);
        assert.deepEqual(clone(await h.client.carregarAssembleiaAnotacoes(PROGRAM)), {});
        assert.equal(h.rows.some(row => row.tipo === 'ass26:programacao'), true);
        const changed = harness([document('ass26:programacao', PROGRAM, NOTE)]);
        assert.equal((await changed.client.apagarAssembleiaCompleto(PROGRAM, { expectedRemote: {} })).success, false);
        assert.equal(changed.mutations.length, 0);
    });
    await test('unsupported programme identity fails without a backend query', async () => {
        const h = harness();
        await assert.rejects(() => h.client.carregarAssembleiaAnotacoes('congresso-2026'));
        assert.equal((await h.client.salvarAssembleiaAnotacoes('congresso-2026', {})).success, false);
        assert.equal((await h.client.apagarAssembleiaCompleto('congresso-2026')).success, false);
        assert.equal(h.requests.length, 0);
    });
    await test('registration never inserts an account after a failed availability query', async () => {
        const h = harness(), before = h.storage.get('supabase_user');
        h.intercept(query => query.table === 'usuarios' && query.op === 'read' ? { data: null, error: { code: '503', message: 'synthetic service unavailable' } } : undefined);
        assert.equal((await h.client.cadastrarUsuario('synthetic-new', 'synthetic-password', 'Synthetic Person')).success, false);
        assert.equal(h.requests.filter(query => query.op !== 'read').length, 0);
        assert.equal(h.storage.get('supabase_user'), before);
    });
    console.log(`${count} document API regression checks passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
