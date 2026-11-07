/* Notes stay local first; cloud reads never erase local drafts on failure. */
class AssembleiaSync {
    constructor() {
        this.ano = document.documentElement.dataset.programId || 'ca-copgm27';
        this.isLoggedIn = false;
        this.isSyncing = false;
        this.initialLoadComplete = false;
        this.autoSaveTimeout = null;
        this.lastSavedDataJSON = '{}';
        this.SAVE_DELAY = 2500;
        this.dirty = false;
        this.lastError = '';
        this.prefs = ['tema-interface', 'tamanho-fonte-global', 'editor-performance-mode', 'cor-assembleia'];
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
        window.addEventListener('supabaseLogout', () => { this.initialLoadComplete = false; this.checkLoginStatus(); });
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') this.flushPendingSave();
        });
        window.addEventListener('pagehide', () => this.flushPendingSave());
    }

    account() { try { return JSON.parse(localStorage.getItem('supabase_user'))?.id || null; } catch (_) { return null; } }
    checkLoginStatus() { this.isLoggedIn = !!this.account(); return this.isLoggedIn; }
    validKey(key) { return key.startsWith(`${this.ano}:`) || this.prefs.includes(key); }
    stable(value) { return JSON.stringify(Object.fromEntries(Object.entries(value || {}).sort(([a], [b]) => a.localeCompare(b)))); }
    fail(error) {
        this.lastError = error?.message || String(error || 'Não foi possível sincronizar.');
        window.dispatchEvent(new CustomEvent('assembleia:syncstatus', { detail: { status: 'error', message: this.lastError } }));
        return { success: false, error: this.lastError };
    }
    success() {
        this.lastError = '';
        window.dispatchEvent(new CustomEvent('assembleia:syncstatus', { detail: { status: 'saved' } }));
        return { success: true };
    }
    notReady() {
        return !this.checkLoginStatus() || !window.SupabaseSync?.carregarAssembleiaAnotacoes || !window.SupabaseSync?.salvarAssembleiaAnotacoes;
    }
    resume() {
        if (!this.checkLoginStatus()) return;
        if (!this.initialLoadComplete) this.loadFromSupabase();
        else this.scheduleAutoSave();
    }
    scheduleAutoSave() {
        this.dirty = true;
        if (!this.checkLoginStatus() || !this.initialLoadComplete) return;
        clearTimeout(this.autoSaveTimeout);
        this.autoSaveTimeout = setTimeout(() => { this.autoSaveTimeout = null; this.executeAutoSave(); }, this.SAVE_DELAY);
    }
    flushPendingSave() {
        clearTimeout(this.autoSaveTimeout);
        this.autoSaveTimeout = null;
        if (this.dirty) this.executeAutoSave();
    }
    collectAnnotationsFromLocalStorage() {
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
    merge(local, remote, started = local) {
        const result = { ...remote };
        const baseline = JSON.parse(this.lastSavedDataJSON || '{}');
        for (const [key, value] of Object.entries(local)) {
            if (!(key in remote) || value === remote[key] || value !== started[key]) result[key] = value;
            else if (baseline[key] === value) result[key] = remote[key];
            else if (baseline[key] === remote[key]) result[key] = value;
            else result[key] = this.timestamp(remote[key]) > this.timestamp(value) ? remote[key] : value;
        }
        return result;
    }
    backup(values, reason) {
        if (!Object.keys(values).length) return;
        const key = `ass26_recovery_${this.ano}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        // A failed backup aborts the replacement instead of risking the only copy.
        localStorage.setItem(key, JSON.stringify({ at: new Date().toISOString(), reason, values }));
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
    apply(values, original, replace = false) {
        const current = this.collectAnnotationsFromLocalStorage();
        const changed = Object.keys(values).filter(key => current[key] !== values[key] && (original[key] === current[key]));
        const removed = replace ? Object.keys(current).filter(key => !(key in values) && original[key] === current[key]) : [];
        const previous = Object.fromEntries([...changed, ...removed].filter(key => key in current).map(key => [key, current[key]]));
        this.backup(previous, replace ? 'Antes de substituir pela nuvem' : 'Antes de atualizar com a nuvem');
        // Set first, remove last. An unavailable store never causes a blind bulk delete.
        changed.forEach(key => localStorage.setItem(key, values[key]));
        removed.forEach(key => localStorage.removeItem(key));
        if (changed.length || removed.length) {
            window.GlobalFontScale?.refresh?.();
            window.AssembleiaClickables?.refresh?.();
            window.dispatchEvent(new CustomEvent('assembleia:cloudapplied', { detail: { keys: [...changed, ...removed] } }));
        }
    }
    async readRemote(account) {
        const raw = await window.SupabaseSync.carregarAssembleiaAnotacoes(this.ano);
        if (this.account() !== account) throw new Error('A conta mudou durante a sincronização.');
        return { raw, values: this.validateRemote(raw) };
    }
    async loadFromSupabase(force = false) {
        if (this.isSyncing) return this.fail('Aguarde o salvamento em andamento.');
        if (this.notReady()) return this.fail('Nuvem indisponível. Suas notas continuam neste aparelho.');
        this.isSyncing = true;
        const account = this.account(), before = this.collectAnnotationsFromLocalStorage();
        try {
            const { values: remote } = await this.readRemote(account);
            const current = this.collectAnnotationsFromLocalStorage();
            const merged = this.merge(current, remote, before);
            const remoteCopies = Object.fromEntries(Object.entries(remote).filter(([key, value]) => key in current && value !== current[key] && merged[key] !== value));
            this.backup(remoteCopies, 'Versão da nuvem preservada ao mesclar');
            this.apply(merged, current);
            this.lastSavedDataJSON = this.stable(remote);
            this.initialLoadComplete = true;
            this.dirty = this.stable(this.collectAnnotationsFromLocalStorage()) !== this.lastSavedDataJSON;
            this.success();
            if (this.dirty) this.scheduleAutoSave();
            return { success: true };
        } catch (error) { return this.fail(error); }
        finally { this.isSyncing = false; }
    }
    async executeAutoSave() {
        if (this.isSyncing) { this.dirty = true; return; }
        if (!this.initialLoadComplete || this.notReady()) return;
        clearTimeout(this.autoSaveTimeout); this.autoSaveTimeout = null;
        this.isSyncing = true;
        try {
            do {
                this.dirty = false;
                const account = this.account(), before = this.collectAnnotationsFromLocalStorage();
                if (this.stable(before) === this.lastSavedDataJSON) continue;
                const { raw, values: remote } = await this.readRemote(account);
                const local = this.collectAnnotationsFromLocalStorage();
                const merged = this.merge(local, remote, before);
                this.backup(Object.fromEntries(Object.entries(remote).filter(([key, value]) => key in local && local[key] !== value && merged[key] !== value)), 'Versão da nuvem preservada antes de enviar');
                const result = await window.SupabaseSync.salvarAssembleiaAnotacoes(this.ano, merged, { expectedRemote: raw });
                if (!result?.success) throw new Error(result?.error || 'Não foi possível enviar as notas.');
                if (this.account() !== account) throw new Error('A conta mudou durante o salvamento.');
                this.apply(merged, local);
                this.lastSavedDataJSON = this.stable(merged);
                this.dirty = this.dirty || this.stable(this.collectAnnotationsFromLocalStorage()) !== this.lastSavedDataJSON;
            } while (this.dirty);
            return this.success();
        } catch (error) { this.dirty = true; return this.fail(error); }
        finally { this.isSyncing = false; }
    }
    async push(mode, day) {
        if (this.isSyncing) return this.fail('Aguarde o salvamento em andamento.');
        if (this.notReady()) return this.fail('Nuvem indisponível.');
        if (mode === 'day' && day !== 'unico') return this.fail('Dia inválido.');
        this.isSyncing = true;
        try {
            const account = this.account();
            const { raw, values: remote } = await this.readRemote(account);
            const local = this.collectAnnotationsFromLocalStorage();
            const selected = mode === 'day' ? Object.fromEntries(Object.entries(local).filter(([key]) => key.startsWith(`${this.ano}:`) || this.prefs.includes(key))) : local;
            const merged = mode === 'overwrite' ? local : { ...remote, ...selected };
            this.backup(remote, 'Antes do envio manual para a nuvem');
            const result = await window.SupabaseSync.salvarAssembleiaAnotacoes(this.ano, merged, { expectedRemote: raw });
            if (!result?.success) throw new Error(result?.error || 'Não foi possível enviar as notas.');
            if (this.account() !== account) throw new Error('A conta mudou durante o salvamento.');
            this.apply(merged, local);
            this.lastSavedDataJSON = this.stable(merged);
            this.initialLoadComplete = true;
            if (this.stable(this.collectAnnotationsFromLocalStorage()) !== this.lastSavedDataJSON) this.scheduleAutoSave();
            return this.success();
        } catch (error) { return this.fail(error); }
        finally { this.isSyncing = false; }
    }
    pushOverwrite() { return this.push('overwrite'); }
    pushMerge() { return this.push('merge'); }
    pushDay(day) { return this.push('day', day); }
    async pullOverwrite() {
        if (this.isSyncing) return this.fail('Aguarde o salvamento em andamento.');
        if (this.notReady()) return this.fail('Nuvem indisponível.');
        this.isSyncing = true;
        const before = this.collectAnnotationsFromLocalStorage();
        try {
            const { raw, values: remote } = await this.readRemote(this.account());
            if (raw === null || !Object.keys(remote).length) throw new Error('Não há backup na nuvem para baixar. As notas locais foram mantidas.');
            if (this.stable(before) !== this.stable(this.collectAnnotationsFromLocalStorage())) throw new Error('Você editou as notas durante o download. Tente novamente.');
            this.apply(remote, before, true);
            this.lastSavedDataJSON = this.stable(remote);
            this.initialLoadComplete = true;
            this.dirty = false;
            return this.success();
        } catch (error) { return this.fail(error); }
        finally { this.isSyncing = false; }
    }
}
window.assembleiaSync = new AssembleiaSync();
