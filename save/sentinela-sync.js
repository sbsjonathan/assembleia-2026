/* Article annotations are scoped to this study; cloud failures never erase drafts. */
class SentinelaSync {
    constructor() {
        this.semanaAtual = null; this.estudoId = null; this.isLoggedIn = false;
        this.isSyncing = false; this.initialLoadComplete = false; this.accountId = null;
        this.autoSaveTimeout = null; this.lastSavedDataJSON = '{}'; this.lastObservedLocalJSON = null; this.dirty = false;
        this.SAVE_DELAY = 2500;
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => this.setup(), { once: true });
        else this.setup();
    }
    setup() {
        this.detectSemanaEEstudo(); this.interceptCacheSalvar();
        ['online', 'pageshow', 'supabaseSessionChanged', 'supabaseLogout'].forEach(name => window.addEventListener(name, () => this.resume()));
        window.addEventListener('storage', event => {
            if (event.key === 'supabase_user') this.resume();
            else if (this.validKey(event.key)) this.scheduleAutoSave();
        });
        window.addEventListener('pagehide', () => this.flushPendingSave());
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') this.flushPendingSave(); });
        this.resume();
    }
    detectSemanaEEstudo() {
        this.semanaAtual = window.semanaAtual || new URLSearchParams(window.location.search).get('semana');
        this.estudoId = String(window.estudoId || document.body.dataset.estudo || '');
    }
    account() {
        try {
            if (window.SupabaseSync?.isLoggedIn && !window.SupabaseSync.isLoggedIn()) return null;
            const raw = localStorage.getItem('supabase_user');
            return JSON.parse(raw)?.id ? raw : null;
        } catch (_) { return null; }
    }
    checkLoginStatus() {
        const account = this.account();
        if (account !== this.accountId) {
            this.accountId = account; this.initialLoadComplete = false; this.lastSavedDataJSON = '{}'; this.lastObservedLocalJSON = null; this.pendingConflict = null;
            if (account) {
                try {
                    const state = JSON.parse(localStorage.getItem(this.manualKey()) || 'null');
                    if (state) { this.lastSavedDataJSON = this.stable(this.validateAnnotations(state.remote)); this.lastObservedLocalJSON = this.stable(this.validateAnnotations(state.local)); }
                } catch (_) {}
            }
            clearTimeout(this.autoSaveTimeout);
        }
        this.isLoggedIn = !!account; return this.isLoggedIn;
    }
    validKey(key) {
        if (!key || !this.estudoId) return false;
        const study = this.estudoId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`^(?:[crp]-${study}-\\d+(?:-pg-\\d+)?|[crp]-rcp-\\d+-${study}|(?:r-)?obj-${study}|(?:r-)?sub-h1-${study}|(?:r-)?sub-h2-\\d+-${study})$`).test(key);
    }
    stable(value) { return JSON.stringify(Object.fromEntries(Object.entries(value || {}).sort(([a], [b]) => a.localeCompare(b)))); }
    manualKey() {
        const id = JSON.parse(this.accountId)?.id || '';
        return `ass26_sentinela_manual_${encodeURIComponent(id)}_${this.semanaAtual}_${this.estudoId}`;
    }
    remember(local, remote) {
        this.lastSavedDataJSON = this.stable(remote);
        this.lastObservedLocalJSON = this.stable(local);
        localStorage.setItem(this.manualKey(), JSON.stringify({ local, remote }));
    }
    collectAnnotationsFromLocalStorage() {
        const values = {};
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (this.validKey(key)) values[key] = localStorage.getItem(key);
        }
        return values;
    }
    validateAnnotations(value) {
        if (value === null) return {};
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('As anotações da nuvem estão inválidas.');
        const scoped = {};
        for (const [key, text] of Object.entries(value)) {
            if (typeof text !== 'string') throw new Error('Uma anotação da nuvem está inválida.');
            // Old releases uploaded every study. Keep compatibility without
            // allowing another study, account key or setting into this document.
            if (this.validKey(key)) scoped[key] = text;
        }
        return scoped;
    }
    interceptCacheSalvar() {
        const cache = window.CacheAnotacao;
        if (!cache?.salvar) { setTimeout(() => this.interceptCacheSalvar(), 200); return; }
        if (cache.salvar.sentinelaSync) return;
        const original = cache.salvar.bind(cache);
        const wrapper = (id, content) => {
            const result = original(id, content);
            if (this.validKey(id) && localStorage.getItem(id) === String(content)) this.scheduleAutoSave();
            return result;
        };
        wrapper.sentinelaSync = true; cache.salvar = wrapper;
    }
    resume() {
        if (!this.checkLoginStatus() || navigator.onLine === false) return;
        if (!this.initialLoadComplete) return this.loadFromSupabase();
        if (this.dirty) this.scheduleAutoSave();
    }
    scheduleAutoSave() {
        this.dirty = true;
        if (!this.checkLoginStatus() || !this.initialLoadComplete) return;
        clearTimeout(this.autoSaveTimeout);
        this.autoSaveTimeout = setTimeout(() => this.executeAutoSave(), this.SAVE_DELAY);
    }
    flushPendingSave() { clearTimeout(this.autoSaveTimeout); if (this.dirty) this.executeAutoSave(); }
    assertAccount(account) { if (!account || this.account() !== account) throw new Error('A conta mudou. As anotações locais foram mantidas.'); }
    fail(error) {
        const message = error?.message || String(error || 'Não foi possível sincronizar.');
        const code = error?.code;
        window.dispatchEvent(new CustomEvent('sentinela:syncstatus', { detail: { status: code === 'SYNC_CONFLICT' ? 'conflict' : 'error', message, code } }));
        return { success: false, error: message, ...(code ? { code } : {}) };
    }
    syncError(result, fallback) { return Object.assign(new Error(result?.error || fallback), { code: result?.code }); }
    conflictKey() { return this.manualKey() + '_conflict'; }
    recordConflict(local, remote, manual = false) {
        const value = { local, remote, manual };
        this.pendingConflict = value;
        localStorage.setItem(this.conflictKey(), JSON.stringify(value));
    }
    clearConflict() { localStorage.removeItem(this.conflictKey()); this.pendingConflict = null; }
    hasConflict() { const key = this.conflictKey(); return !!this.pendingConflict || !!(key && localStorage.getItem(key)); }
    async reconcileConflict(account) {
        const conflict = this.pendingConflict || JSON.parse(localStorage.getItem(this.conflictKey()) || 'null');
        if (!conflict) return null;
        const attempted = this.validateAnnotations(conflict.local), prior = this.validateAnnotations(conflict.remote);
        const { values: remote } = await this.readRemote(account);
        const local = this.collectAnnotationsFromLocalStorage();
        const baseline = JSON.parse(this.lastSavedDataJSON), observed = JSON.parse(this.lastObservedLocalJSON ?? this.lastSavedDataJSON);
        const preserved = {};
        for (const [name, value] of Object.entries(local)) {
            if (value !== attempted[name] || value === remote[name] || (!conflict.manual && (prior[name] === remote[name] || value === prior[name]))) continue;
            preserved[name] = value;
            observed[name] = value;
            if (name in remote) baseline[name] = remote[name]; else delete baseline[name];
        }
        this.backup(preserved, 'Edição local preservada após alteração simultânea em outro aparelho');
        this.remember(observed, baseline);
        this.clearConflict();
        return { preserved: Object.keys(preserved).length };
    }
    conflictNotice() {
        return this.syncError({ code: 'SYNC_CONFLICT', error: 'Outro aparelho alterou a mesma anotação. Sua versão ficou neste aparelho e a outra foi mantida na nuvem. Use Enviar / Substituir se quiser escolher sua versão.' });
    }
    success() { return { success: true }; }
    backup(values, reason) {
        if (!Object.keys(values).length) return;
        localStorage.setItem(`ass26_recovery_sentinela_${this.semanaAtual}_${this.estudoId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            JSON.stringify({ at: new Date().toISOString(), reason, values }));
    }
    async readRemote(account) {
        if (!window.SupabaseSync?.carregarSentinelaAnotacoes) throw new Error('Nuvem indisponível. Tente novamente.');
        const raw = await window.SupabaseSync.carregarSentinelaAnotacoes(this.semanaAtual, this.estudoId);
        this.assertAccount(account);
        return { raw, values: this.validateAnnotations(raw) };
    }
    merge(local, remote) {
        const baseline = JSON.parse(this.lastSavedDataJSON), merged = { ...remote };
        for (const [key, value] of Object.entries(local)) {
            if (this.acknowledgedDifference(key, value, remote)) continue;
            if (key in baseline && !(key in remote) && value === baseline[key]) continue;
            // Only a known, unchanged local version may be refreshed remotely.
            merged[key] = key in remote && value === baseline[key] ? remote[key] : value;
        }
        return merged;
    }
    acknowledgedDifference(key, value, remote) {
        if (this.lastObservedLocalJSON === null) return false;
        const observed = JSON.parse(this.lastObservedLocalJSON), baseline = JSON.parse(this.lastSavedDataJSON);
        return observed[key] === value && value !== baseline[key] && baseline[key] === remote[key];
    }
    preserveAcknowledgedLocal(merged, local, remote) {
        const values = { ...merged };
        for (const [key, value] of Object.entries(local)) if (this.acknowledgedDifference(key, value, remote)) values[key] = value;
        return values;
    }
    apply(values, before, replace = false) {
        const current = this.collectAnnotationsFromLocalStorage();
        const changes = Object.keys(values).filter(key => current[key] !== values[key] && current[key] === before[key]);
        const removals = replace ? Object.keys(current).filter(key => !(key in values) && current[key] === before[key]) : [];
        this.backup(Object.fromEntries([...changes, ...removals].filter(key => key in current).map(key => [key, current[key]])), 'Antes de restaurar a nuvem');
        for (const key of changes) localStorage.setItem(key, values[key]);
        for (const key of removals) localStorage.removeItem(key);
        for (const key of [...changes, ...removals]) {
            const node = document.getElementById(key);
            if (node && node !== document.activeElement && !node.contains(document.activeElement)) node.innerHTML = values[key] ?? '';
        }
        if (changes.length || removals.length) document.dispatchEvent(new CustomEvent('cacheRestored'));
    }
    async loadFromSupabase() {
        if (this.isSyncing || !this.checkLoginStatus()) return;
        this.isSyncing = true;
        const account = this.account();
        try {
            const resolved = this.hasConflict() ? await this.reconcileConflict(account) : null;
            const before = this.collectAnnotationsFromLocalStorage();
            const { values: remote } = await this.readRemote(account);
            const current = this.collectAnnotationsFromLocalStorage();
            const merged = this.merge(current, remote);
            this.backup(Object.fromEntries(Object.entries(remote).filter(([key, value]) => key in current && value !== merged[key])), 'Cópia da nuvem antes de mesclar');
            this.apply(this.preserveAcknowledgedLocal(merged, current, remote), before, true);
            const after = this.collectAnnotationsFromLocalStorage();
            this.lastSavedDataJSON = this.stable(remote); this.initialLoadComplete = true;
            this.dirty = this.stable(merged) !== this.stable(remote);
            if (!this.dirty) this.remember(after, remote);
            if (this.dirty) this.scheduleAutoSave();
            return resolved?.preserved ? this.fail(this.conflictNotice()) : this.success();
        } catch (error) { return this.fail(error); }
        finally { this.isSyncing = false; }
    }
    async executeAutoSave() {
        if (this.isSyncing) { this.dirty = true; return; }
        if (!this.checkLoginStatus() || !this.initialLoadComplete || navigator.onLine === false) return;
        clearTimeout(this.autoSaveTimeout); this.isSyncing = true;
        const account = this.account();
        let conflicts = 0, preserved = 0, forceMerge = false;
        try {
            const resolved = this.hasConflict() ? await this.reconcileConflict(account) : null;
            if (resolved) { preserved += resolved.preserved; forceMerge = true; }
            do {
                this.dirty = false;
                this.assertAccount(account);
                const before = this.collectAnnotationsFromLocalStorage();
                if (!forceMerge && this.stable(before) === (this.lastObservedLocalJSON ?? this.lastSavedDataJSON)) continue;
                forceMerge = false;
                const { raw, values: remote } = await this.readRemote(account);
                const local = this.collectAnnotationsFromLocalStorage(), merged = this.merge(local, remote);
                this.backup(Object.fromEntries(Object.entries(remote).filter(([key, value]) => key in local && value !== merged[key])), 'Cópia da nuvem antes de enviar');
                const result = await window.SupabaseSync.salvarSentinelaAnotacoes(this.semanaAtual, this.estudoId, merged, { expectedRemote: raw });
                this.assertAccount(account);
                if (result?.success !== true) {
                    const error = this.syncError(result, 'Não foi possível enviar as anotações.');
                    if (error.code !== 'SYNC_CONFLICT') throw error;
                    this.recordConflict(local, remote);
                    const resolved = this.hasConflict() ? await this.reconcileConflict(account) : null;
                    preserved += resolved?.preserved || 0;
                    if (++conflicts >= 3) throw error;
                    this.dirty = true; forceMerge = true;
                    continue;
                }
                this.apply(this.preserveAcknowledgedLocal(merged, local, remote), local, true);
                const after = this.collectAnnotationsFromLocalStorage();
                const observed = this.preserveAcknowledgedLocal(merged, local, remote);
                this.remember(observed, merged);
                this.dirty = this.stable(after) !== this.lastObservedLocalJSON;
            } while (this.dirty);
            return preserved ? this.fail(this.conflictNotice()) : this.success();
        } catch (error) { this.dirty = true; return this.fail(error); }
        finally { this.isSyncing = false; }
    }
    async manual(action, replace = false) {
        if (this.isSyncing) return this.fail('Aguarde a sincronização em andamento.');
        if (!this.checkLoginStatus()) return this.fail('Entre na sua conta antes de sincronizar.');
        clearTimeout(this.autoSaveTimeout); this.isSyncing = true;
        const account = this.account(), before = this.collectAnnotationsFromLocalStorage();
        let completed = false;
        let attemptedLocal, attemptedRemote;
        try {
            const { raw, values: remote } = await this.readRemote(account);
            const local = this.collectAnnotationsFromLocalStorage();
            if (this.stable(local) !== this.stable(before)) throw new Error('As notas mudaram durante a consulta. Tente novamente.');
            if (action === 'pull') {
                if (raw === null) throw new Error('Nenhuma anotação encontrada na nuvem para este artigo.');
                const values = replace ? remote : { ...remote, ...local };
                this.apply(values, local, replace);
                this.remember(this.collectAnnotationsFromLocalStorage(), remote);
            } else {
                const values = action === 'delete' ? {} : replace ? local : { ...local, ...remote };
                attemptedLocal = local; attemptedRemote = remote;
                this.backup(remote, action === 'delete' ? 'Antes de apagar da nuvem' : 'Antes de enviar manualmente');
                const result = await window.SupabaseSync.salvarSentinelaAnotacoes(this.semanaAtual, this.estudoId, values, { expectedRemote: raw });
                this.assertAccount(account);
                if (result?.success !== true) throw this.syncError(result, 'Não foi possível concluir.');
                // A manual command changes only its chosen destination. Avoid
                // automatically reversing a cloud deletion/missing-only upload.
                this.remember(local, values);
            }
            this.initialLoadComplete = true;
            this.clearConflict();
            this.dirty = this.stable(this.collectAnnotationsFromLocalStorage()) !== this.lastObservedLocalJSON;
            completed = true;
            return this.success();
        } catch (error) {
            if (error.code === 'SYNC_CONFLICT' && this.account() === account && attemptedLocal) {
                try { this.recordConflict(attemptedLocal, attemptedRemote, true); await this.reconcileConflict(account); } catch (_) {}
                this.dirty = false;
            }
            return this.fail(error);
        }
        finally { this.isSyncing = false; if (completed && this.dirty) this.scheduleAutoSave(); }
    }
    pushOverwrite() { return this.manual('push', true); }
    pushMissing() { return this.manual('push', false); }
    pullOverwrite() { return this.manual('pull', true); }
    pullMissing() { return this.manual('pull', false); }
    deleteRemote() { return this.manual('delete'); }
}
window.sentinelaSync = new SentinelaSync();
