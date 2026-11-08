/* Notes stay local first; failed cloud operations never erase local drafts. */
class AssembleiaSync {
    constructor() {
        this.ano = document.documentElement.dataset.programId || 'ca-copgm27';
        this.isLoggedIn = false;
        this.isSyncing = false;
        this.initialLoadComplete = false;
        this.autoSaveTimeout = null;
        this.lastSavedDataJSON = '{}';
        // A manual download/additions-only upload can intentionally leave different
        // local and cloud versions. Merely focusing the page must not undo that choice.
        this.lastObservedLocalJSON = null;
        this.sessionToken = this.identity();
        this.lastAccount = this.account();
        this.suppressInitialUpload = false;
        this.SAVE_DELAY = 2500;
        this.dirty = false;
        this.lastError = '';
        this.prefs = ['tema-interface', 'tamanho-fonte-global', 'editor-performance-mode', 'cor-assembleia'];
        this.restoreState();
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => this.setup(), { once: true });
        else this.setup();
    }

    setup() {
        this.checkLoginStatus();
        if (this.isLoggedIn) this.loadFromSupabase();
        else this.initialLoadComplete = true;
        ['assembleia:recordchange', 'assembleia:stored'].forEach(name => window.addEventListener(name, () => this.scheduleAutoSave()));
        ['input', 'focusout'].forEach(name => document.addEventListener(name, event => {
            if (event.target?.closest?.('.clickable-asmb, .editor, .assistencia-input')) this.scheduleAutoSave();
        }));
        window.addEventListener('online', () => this.resume());
        window.addEventListener('focus', () => this.resume());
        ['supabaseLogout', 'supabaseSessionChanged'].forEach(name => window.addEventListener(name, () => {
            this.checkLoginStatus();
            if (this.isLoggedIn && !this.isSyncing && !this.initialLoadComplete) this.loadFromSupabase();
        }));
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') this.flushPendingSave();
        });
        window.addEventListener('pagehide', () => this.flushPendingSave());
    }

    user() { try { return JSON.parse(localStorage.getItem('supabase_user')); } catch (_) { return null; } }
    account() { return this.user()?.id || null; }
    identity() { try { const raw = localStorage.getItem('supabase_user'); return JSON.parse(raw)?.id ? raw : null; } catch (_) { return null; } }
    assertSession(session) {
        if (this.identity() !== session) throw new Error('A conta mudou durante a sincronização. Suas alterações locais foram mantidas.');
    }
    checkLoginStatus() {
        const session = this.identity(), account = this.account();
        if (session !== this.sessionToken) {
            this.clearTimer();
            this.suppressInitialUpload = !!(account && this.lastAccount && account !== this.lastAccount);
            this.sessionToken = session;
            this.lastAccount = account || this.lastAccount;
            this.lastSavedDataJSON = '{}';
            this.lastObservedLocalJSON = null;
            this.initialLoadComplete = false;
            this.dirty = false;
            this.restoreState();
        }
        this.isLoggedIn = !!session;
        return this.isLoggedIn;
    }
    validKey(key) { return key.startsWith(`${this.ano}:`) || this.prefs.includes(key); }
    stable(value) { return JSON.stringify(Object.fromEntries(Object.entries(value || {}).sort(([a], [b]) => a.localeCompare(b)))); }
    stateKey() { const account = this.account(); return account ? `ass26_sync_state_${this.ano}_${encodeURIComponent(account)}` : null; }
    restoreState() {
        try {
            const key = this.stateKey(), raw = key && localStorage.getItem(key);
            if (!raw) return;
            const state = JSON.parse(raw);
            if (state.version !== 1 || state.account !== this.account()) return;
            this.lastSavedDataJSON = this.stable(this.validateRemote(state.remote));
            this.lastObservedLocalJSON = this.stable(this.validateRemote(state.local));
        } catch (_) { /* A damaged checkpoint is not a cloud backup. Preserve local notes. */ }
    }
    clearTimer() { clearTimeout(this.autoSaveTimeout); this.autoSaveTimeout = null; }
    fail(error) {
        this.lastError = error?.message || String(error || 'Não foi possível sincronizar.');
        window.dispatchEvent(new CustomEvent('assembleia:syncstatus', { detail: { status: 'error', message: this.lastError } }));
        return { success: false, error: this.lastError };
    }
    success(extra = {}) {
        this.lastError = '';
        window.dispatchEvent(new CustomEvent('assembleia:syncstatus', { detail: { status: 'saved' } }));
        return { success: true, ...extra };
    }
    notReady() {
        return !this.checkLoginStatus() || !window.SupabaseSync?.carregarAssembleiaAnotacoes || !window.SupabaseSync?.salvarAssembleiaAnotacoes;
    }
    resume() {
        if (!this.checkLoginStatus() || this.isSyncing) return;
        if (!this.initialLoadComplete) this.loadFromSupabase();
        else this.scheduleAutoSave();
    }
    scheduleAutoSave() {
        this.dirty = true;
        if (!this.checkLoginStatus() || !this.initialLoadComplete || this.isSyncing) return;
        this.clearTimer();
        this.autoSaveTimeout = setTimeout(() => { this.autoSaveTimeout = null; this.executeAutoSave(); }, this.SAVE_DELAY);
    }
    flushPendingSave() {
        this.clearTimer();
        if (this.dirty) this.executeAutoSave();
    }
    collectAnnotationsFromLocalStorage() {
        // The summarizer can retain a draft in memory after a storage failure.
        // Never replace/upload the older storage copy while such a draft exists.
        if (window.AssembleiaIA?.flushPendingWrites?.() === false) throw new Error('Há uma edição que ainda não pôde ser salva neste aparelho. Libere espaço e tente novamente.');
        const values = {};
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && this.validKey(key)) values[key] = localStorage.getItem(key);
        }
        return values;
    }
    validateRemote(value) {
        if (value === null) return {};
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('O backup da nuvem está inválido.');
        const result = {};
        for (const [key, text] of Object.entries(value)) {
            if (!this.validKey(key) || typeof text !== 'string') throw new Error('O backup da nuvem contém dados incompatíveis.');
            result[key] = text;
        }
        return result;
    }
    timestamp(value) { try { return Number(JSON.parse(value)?.updatedAt) || 0; } catch (_) { return 0; } }
    acknowledgedDifference(key, value, remote) {
        if (this.lastObservedLocalJSON === null) return false;
        const observed = JSON.parse(this.lastObservedLocalJSON), baseline = JSON.parse(this.lastSavedDataJSON);
        return observed[key] === value && value !== baseline[key] && baseline[key] === remote[key];
    }
    merge(local, remote, started = local, automatic = false) {
        const result = { ...remote };
        const baseline = JSON.parse(this.lastSavedDataJSON || '{}');
        for (const [key, value] of Object.entries(local)) {
            if (automatic && this.acknowledgedDifference(key, value, remote)) continue;
            // A previously synced, unchanged note removed by another device is
            // not a new local note. Do not resurrect a cloud deletion on reopen.
            if (automatic && key in baseline && !(key in remote) && value === baseline[key]) continue;
            if (!(key in remote) || value === remote[key] || value !== started[key]) result[key] = value;
            else if (baseline[key] === value) result[key] = remote[key];
            else if (baseline[key] === remote[key]) result[key] = value;
            else result[key] = this.timestamp(remote[key]) > this.timestamp(value) ? remote[key] : value;
        }
        return result;
    }
    preserveAcknowledgedLocal(merged, local, remote) {
        const values = { ...merged };
        for (const [key, value] of Object.entries(local)) {
            if (this.acknowledgedDifference(key, value, remote) || (this.prefs.includes(key) && !(key in merged))) values[key] = value;
        }
        return values;
    }
    backup(values, reason) {
        if (!Object.keys(values).length) return;
        const key = `ass26_recovery_${this.ano}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        // A failed backup aborts the replacement instead of risking the only copy.
        localStorage.setItem(key, JSON.stringify({ at: new Date().toISOString(), reason, values }));
    }
    backupRemote(remote, replacement) {
        this.backup(Object.fromEntries(Object.entries(remote).filter(([key, value]) => replacement[key] !== value)), 'Versão da nuvem preservada antes de substituir');
    }
    getRecoveries() {
        const copies = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key?.startsWith(`ass26_recovery_${this.ano}_`)) {
                try { copies.push({ key, ...JSON.parse(localStorage.getItem(key)) }); } catch (_) {}
            }
        }
        return copies.sort((a, b) => b.at.localeCompare(a.at));
    }
    apply(values, original, replace = false, alreadyBackedUp = false) {
        const current = this.collectAnnotationsFromLocalStorage();
        const changed = Object.keys(values).filter(key => current[key] !== values[key] && original[key] === current[key]);
        const removed = replace ? Object.keys(current).filter(key => !(key in values) && original[key] === current[key]) : [];
        const previous = Object.fromEntries([...changed, ...removed].filter(key => key in current).map(key => [key, current[key]]));
        if (!alreadyBackedUp) this.backup(previous, replace ? 'Antes de substituir pela nuvem' : 'Antes de atualizar com a nuvem');
        // Set first, remove last. An unavailable store never causes a blind bulk delete.
        changed.forEach(key => localStorage.setItem(key, values[key]));
        removed.forEach(key => localStorage.removeItem(key));
        if (changed.length || removed.length) {
            window.GlobalFontScale?.refresh?.();
            window.AssembleiaClickables?.refresh?.();
            window.dispatchEvent(new CustomEvent('assembleia:cloudapplied', { detail: { keys: [...changed, ...removed] } }));
        }
    }
    remember(remote, local) {
        this.lastSavedDataJSON = this.stable(remote);
        this.lastObservedLocalJSON = this.stable(local);
        this.initialLoadComplete = true;
        this.dirty = false;
        const key = this.stateKey();
        if (key) localStorage.setItem(key, JSON.stringify({ version: 1, account: this.account(), remote, local }));
    }
    async readRemote(session) {
        this.assertSession(session);
        const raw = await window.SupabaseSync.carregarAssembleiaAnotacoes(this.ano);
        this.assertSession(session);
        return { raw, values: this.validateRemote(raw) };
    }
    async writeRemote(values, raw, session) {
        this.assertSession(session);
        const result = await window.SupabaseSync.salvarAssembleiaAnotacoes(this.ano, values, { expectedRemote: raw });
        this.assertSession(session);
        if (!result?.success) throw new Error(result?.error || 'Não foi possível enviar as notas.');
    }
    async loadFromSupabase(force = false) {
        if (force) return this.pullMerge();
        if (this.isSyncing) return this.fail('Aguarde o salvamento em andamento.');
        if (this.notReady()) return this.fail('Nuvem indisponível. Suas notas continuam neste aparelho.');
        this.clearTimer();
        this.isSyncing = true;
        try {
            const session = this.identity(), before = this.collectAnnotationsFromLocalStorage();
            const { values: remote } = await this.readRemote(session);
            const current = this.collectAnnotationsFromLocalStorage();
            const merged = this.merge(current, remote, before, true);
            const localValues = this.preserveAcknowledgedLocal(merged, current, remote);
            this.backupRemote(remote, merged);
            this.apply(localValues, current, true);
            const local = this.collectAnnotationsFromLocalStorage();
            const observed = { ...local };
            if (!this.suppressInitialUpload) {
                for (const key of Object.keys(merged)) {
                    if (merged[key] === remote[key]) continue;
                    if (key in remote) observed[key] = remote[key];
                    else delete observed[key];
                }
            }
            this.remember(remote, observed);
            this.suppressInitialUpload = false;
            this.dirty = this.stable(local) !== this.lastObservedLocalJSON;
            return this.success();
        } catch (error) { return this.fail(error); }
        finally { this.isSyncing = false; if (this.dirty && this.initialLoadComplete) this.scheduleAutoSave(); }
    }
    async executeAutoSave() {
        if (this.isSyncing) { this.dirty = true; return; }
        if (this.notReady() || !this.initialLoadComplete) return;
        this.clearTimer();
        this.isSyncing = true;
        const session = this.identity();
        try {
            do {
                this.dirty = false;
                this.assertSession(session);
                const before = this.collectAnnotationsFromLocalStorage();
                if (this.stable(before) === (this.lastObservedLocalJSON ?? this.lastSavedDataJSON)) continue;
                const { raw, values: remote } = await this.readRemote(session);
                const local = this.collectAnnotationsFromLocalStorage();
                const merged = this.merge(local, remote, before, true);
                this.backupRemote(remote, merged);
                await this.writeRemote(merged, raw, session);
                // Keep an intentional local/cloud difference until that note itself
                // changes; editing another field must not undo an additions-only action.
                const localValues = this.preserveAcknowledgedLocal(merged, local, remote);
                this.apply(localValues, local, true);
                const after = this.collectAnnotationsFromLocalStorage();
                this.remember(merged, localValues);
                this.dirty = this.stable(after) !== this.lastObservedLocalJSON;
            } while (this.dirty);
            return this.success();
        } catch (error) {
            if (this.identity() === session) this.dirty = true;
            else this.checkLoginStatus();
            return this.fail(error);
        } finally { this.isSyncing = false; }
    }
    async push(mode, day) {
        if (!['overwrite', 'merge', 'missing', 'day'].includes(mode)) return this.fail('Modo de envio inválido.');
        if (mode === 'day' && day !== 'unico') return this.fail('Dia inválido.');
        if (this.isSyncing) return this.fail('Aguarde o salvamento em andamento.');
        if (this.notReady()) return this.fail('Nuvem indisponível.');
        this.clearTimer();
        this.isSyncing = true;
        let completed = false;
        try {
            const session = this.identity(), before = this.collectAnnotationsFromLocalStorage();
            const { raw, values: remote } = await this.readRemote(session);
            const local = this.collectAnnotationsFromLocalStorage();
            const merged = mode === 'overwrite' ? local : mode === 'missing' ? { ...local, ...remote } : this.merge(local, remote, before);
            this.backupRemote(remote, merged);
            await this.writeRemote(merged, raw, session);
            if (mode !== 'missing') this.apply(merged, local);
            const expectedLocal = mode === 'missing' ? local : { ...local, ...merged };
            this.remember(merged, expectedLocal);
            this.dirty = this.stable(this.collectAnnotationsFromLocalStorage()) !== this.lastObservedLocalJSON;
            completed = true;
            return this.success();
        } catch (error) { return this.fail(error); }
        finally { this.isSyncing = false; if (completed && this.dirty) this.scheduleAutoSave(); }
    }
    pushOverwrite() { return this.push('overwrite'); }
    pushMerge() { return this.push('merge'); }
    pushMissing() { return this.push('missing'); }
    pushDay(day) { return this.push('day', day); }
    async pull(mode) {
        if (!['overwrite', 'merge', 'missing'].includes(mode)) return this.fail('Modo de download inválido.');
        if (this.isSyncing) return this.fail('Aguarde o salvamento em andamento.');
        if (this.notReady()) return this.fail('Nuvem indisponível.');
        this.clearTimer();
        this.isSyncing = true;
        try {
            const session = this.identity(), before = this.collectAnnotationsFromLocalStorage();
            const { raw, values: remote } = await this.readRemote(session);
            if (raw === null) throw new Error('Não há backup na nuvem para baixar. As notas locais foram mantidas.');
            const local = this.collectAnnotationsFromLocalStorage();
            if (mode === 'overwrite' && this.stable(before) !== this.stable(local)) throw new Error('Você editou as notas durante o download. Tente novamente.');
            const merged = mode === 'overwrite' ? remote : mode === 'missing' ? { ...remote, ...local } : this.merge(local, remote, before);
            if (mode === 'merge') this.backupRemote(remote, merged);
            this.apply(merged, local, mode === 'overwrite');
            this.remember(remote, this.collectAnnotationsFromLocalStorage());
            return this.success();
        } catch (error) { return this.fail(error); }
        finally { this.isSyncing = false; }
    }
    pullOverwrite() { return this.pull('overwrite'); }
    pullMerge() { return this.pull('merge'); }
    pullMissing() { return this.pull('missing'); }
    async deleteAll() {
        if (this.isSyncing) return this.fail('Aguarde o salvamento em andamento.');
        if (this.notReady() || !window.SupabaseSync?.apagarAssembleiaCompleto) return this.fail('Nuvem indisponível.');
        this.clearTimer();
        this.isSyncing = true;
        try {
            const session = this.identity(), before = this.collectAnnotationsFromLocalStorage();
            const { raw, values: remote } = await this.readRemote(session);
            if (this.stable(before) !== this.stable(this.collectAnnotationsFromLocalStorage())) throw new Error('Você editou as notas durante a operação. Tente novamente.');
            this.backupRemote(remote, {});
            this.backup(before, 'Antes de apagar as anotações da Assembleia');
            this.assertSession(session);
            const result = await window.SupabaseSync.apagarAssembleiaCompleto(this.ano, { expectedRemote: raw });
            this.assertSession(session);
            if (!result?.success) throw new Error(result?.error || 'Não foi possível apagar as notas da nuvem.');
            const preferences = Object.fromEntries(Object.entries(before).filter(([key]) => this.prefs.includes(key)));
            this.apply(preferences, before, true, true);
            const after = this.collectAnnotationsFromLocalStorage();
            this.remember({}, after);
            return this.success({ preservedLocalChanges: Object.keys(after).some(key => key.startsWith(`${this.ano}:`)) });
        } catch (error) { return this.fail(error); }
        finally { this.isSyncing = false; }
    }
}
window.assembleiaSync = new AssembleiaSync();
