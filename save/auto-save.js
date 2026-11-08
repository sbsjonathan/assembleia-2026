// Local persistence is synchronous and independent of network latency. Only the
// newest pending revision is queued behind an active cloud request.
class AutoSaveManager {
    constructor() {
        this.editor = null; this.currentSemana = null; this.isLoggedIn = false;
        this.lastSavedContent = ''; this.lastCloudKey = null;
        this.saveInProgress = false; this.isPaused = false; this.SAVE_DELAY = 350;
        this.pending = null; this.sending = null; this.accountId = null;
        this.cloudConflict = null; this.resolvingCloud = false;
        this.ready = this.setup();
    }
    async setup() {
        if (!window.cacheRichText) return;
        this.store = window.cacheRichText;
        await this.store.ready;
        this.editor = document.getElementById('editor');
        this.currentSemana = this.store.semanaAtual();
        this.checkLoginStatus();
        const initial = this.store.snapshot();
        this.lastSavedContent = JSON.stringify(initial.payload);
        window.addEventListener('notes:stored', event => this.acceptSnapshot(event.detail));
        window.addEventListener('notes:save-error', () => this.triggerFeedbackEvent('Não foi possível salvar neste aparelho. Mantenha esta página aberta ou baixe uma cópia.', 'error', 0));
        window.addEventListener('notes:conflict', () => { this.pending = null; });
        window.addEventListener('notes:external-updated', () => { this.pending = null; this.showLocalSaveFeedback(); });
        window.addEventListener('notes:conflict-resolved', event => this.acceptSnapshot(event.detail));
        const retry = () => { this.checkLoginStatus(); this.executeAutoSave('resume'); };
        window.addEventListener('online', retry);
        window.addEventListener('pageshow', retry);
        window.addEventListener('supabaseSessionChanged', retry);
        window.addEventListener('supabaseLogout', () => this.checkLoginStatus());
        window.addEventListener('storage', event => { if (event.key === 'supabase_user') retry(); });
        for (const name of ['pagehide', 'beforeunload', 'blur']) window.addEventListener(name, () => this.onPageUnload());
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') this.onPageUnload(); });
        if (this.store.hasPending(initial)) this.acceptSnapshot(initial);
    }
    checkLoginStatus() {
        try { this.isLoggedIn = typeof window.SupabaseSync?.isLoggedIn === 'function' ? window.SupabaseSync.isLoggedIn() : !!localStorage.getItem('supabase_user'); }
        catch (_) { this.isLoggedIn = false; }
        let account = null;
        try { if (this.isLoggedIn) account = JSON.parse(localStorage.getItem('supabase_user'))?.id || null; } catch (_) {}
        if (account !== this.accountId) {
            const hadConflict = !!this.cloudConflict;
            this.accountId = account; this.lastCloudKey = null; this.cloudConflict = null;
            if (account && this.currentSemana) {
                try {
                    const baseline = JSON.parse(localStorage.getItem(this.cloudStateKey('baseline')));
                    if (typeof baseline?.key === 'string') this.lastCloudKey = baseline.key;
                    const raw = localStorage.getItem(this.cloudStateKey('conflict'));
                    if (raw !== null) {
                        const saved = JSON.parse(raw);
                        if (!saved || saved.account !== account || !Object.prototype.hasOwnProperty.call(saved, 'externalRaw')) throw Error('Comparação inválida');
                        this.cloudConflict = saved;
                    }
                } catch (_) { this.cloudConflict = { account, unavailable: true }; }
                if (this.cloudConflict) this.announceCloudConflict();
            }
            if (hadConflict && !this.cloudConflict) window.dispatchEvent(new CustomEvent('notes:cloud-conflict-resolved'));
        }
        return this.isLoggedIn;
    }
    cloudStateKey(kind) { return `richtext_cloud_${kind}_${encodeURIComponent(this.accountId)}_${this.currentSemana}`; }
    rememberCloudKey(key) {
        localStorage.setItem(this.cloudStateKey('baseline'), JSON.stringify({ key }));
        this.lastCloudKey = key;
    }
    getCloudConflict() { return this.cloudConflict; }
    announceCloudConflict() {
        window.dispatchEvent(new CustomEvent('notes:cloud-conflict', { detail: this.cloudConflict }));
    }
    setCloudConflict(raw, snapshot = this.store.snapshot()) {
        const external = this.parseRemote(raw) || { html: '', formato: 'legacy-html' };
        const conflict = { account: this.accountId, semana: this.currentSemana, createdAt: Date.now(),
            local: snapshot.payload, externalRaw: raw, external, saved: false };
        this.cloudConflict = conflict;
        // Persist the stop marker before any retry. Recovery survives reload and
        // is separate from the editor's local-tab conflict mechanism.
        localStorage.setItem(this.cloudStateKey('conflict'), JSON.stringify(conflict));
        this.preserveCopy(snapshot.payload, external, 'Edições simultâneas em aparelhos diferentes');
        conflict.saved = true;
        localStorage.setItem(this.cloudStateKey('conflict'), JSON.stringify(conflict));
        this.announceCloudConflict();
    }
    clearCloudConflict() {
        localStorage.removeItem(this.cloudStateKey('conflict'));
        this.cloudConflict = null;
        window.dispatchEvent(new CustomEvent('notes:cloud-conflict-resolved'));
    }
    async resolveCloudConflict(choice) {
        if (!['local', 'external'].includes(choice) || this.resolvingCloud || !this.checkLoginStatus() ||
            !this.cloudConflict || this.store.getConflict?.()) return false;
        const user = localStorage.getItem('supabase_user');
        this.resolvingCloud = true;
        try {
            const current = this.store.flush();
            if (!current || !this.store.isStored(current)) return false;
            const raw = await window.SupabaseSync.carregarRichtextAnotacoes(this.currentSemana);
            if (user !== localStorage.getItem('supabase_user')) return false;
            if (this.cloudConflict.unavailable || raw !== this.cloudConflict.externalRaw) {
                this.setCloudConflict(raw, this.store.snapshot());
                return false; // The displayed comparison changed; choose again.
            }
            const latest = this.store.flush();
            if (!latest || !this.store.isStored(latest)) return false;
            if (choice === 'external' && (latest.key !== current.key || latest.revision !== current.revision)) {
                this.setCloudConflict(raw, latest); return false;
            }
            const external = this.parseRemote(raw) || { html: '', formato: 'legacy-html' };
            this.preserveCopy(latest.payload, external, 'Antes de resolver edições simultâneas');
            if (choice === 'external') {
                if (!this.store.applyContent(external, { remote: true })) return false;
                const applied = this.store.snapshot();
                if (!this.store.isStored(applied)) return false;
                this.acknowledgeRemote(applied, raw === null ? null : this.store.contentKey(external));
            } else {
                const result = await window.SupabaseSync.salvarRichtextAnotacoes(this.currentSemana,
                    JSON.stringify(latest.payload), { expectedRemote: raw });
                if (user !== localStorage.getItem('supabase_user')) return false;
                if (result?.success !== true) {
                    if (result?.code === 'SYNC_CONFLICT') {
                        const newest = await window.SupabaseSync.carregarRichtextAnotacoes(this.currentSemana);
                        if (user === localStorage.getItem('supabase_user')) this.setCloudConflict(newest);
                    }
                    throw Error(result?.error || 'Não foi possível concluir.');
                }
                this.rememberCloudKey(latest.key);
                this.acknowledgeRemote(latest);
            }
            this.clearCloudConflict();
            const after = this.store.snapshot();
            this.pending = this.store.hasPending(after) ? after : null;
            this.showSavedFeedback();
            return true;
        } catch (_) { this.announceCloudConflict(); return false; }
        finally { this.resolvingCloud = false; if (!this.cloudConflict && this.pending) this.drain(); }
    }
    downloadCloudConflict() {
        const payload = this.cloudConflict
            ? { type: 'notes-cloud-conflict', ...this.cloudConflict, local: this.store.snapshot().payload }
            : { type: 'notes-backup', semana: this.currentSemana, local: this.store.snapshot().payload };
        const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a'); link.href = url; link.download = `anotacoes-conflito-${this.currentSemana}.json`;
        document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    parseRemote(raw) {
        if (raw === null) return null;
        if (typeof raw !== 'string') throw new Error('A anotação da nuvem está inválida.');
        // An existing empty document is an intentional deletion, not a missing row.
        const value = raw.trim() ? this.store.parse(raw) : { html: '', formato: 'legacy-html' };
        if (!value) throw new Error('A anotação da nuvem está inválida.');
        return value;
    }
    preserveCopy(local, external, reason) {
        const id = `richtext_recovery_${this.currentSemana}_${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        localStorage.setItem(id, JSON.stringify({ type: 'notes-cloud-recovery', semana: this.currentSemana,
            createdAt: Date.now(), reason, local, external }));
    }
    obterRaizesEditor() { return Array.from(this.editor?.children || []).filter(node => node.matches('.node-paragraph,.node-text,.node-toggle')); }
    exportTree() { return this.store?.snapshot()?.payload.tree || []; }
    exportHTML() { return this.store?.snapshot()?.payload.html || ''; }
    serializePayload() { return this.store?.snapshot()?.payload || null; }
    serializeForRemote() { return JSON.stringify(this.serializePayload()); }
    parseSavedContent(raw) { return this.store?.parse(raw); }
    applySavedContent(raw) { return this.store?.applyContent(raw, { remote: true }); }
    acknowledgeRemote(snapshot, remoteKey = snapshot?.key) {
        if (!snapshot || !this.store.isStored(snapshot)) return;
        this.rememberCloudKey(remoteKey);
        this.lastSavedContent = JSON.stringify(snapshot.payload);
        this.store.acknowledge(snapshot);
        if (this.pending?.key === snapshot.key) this.pending = null;
    }
    uploadCurrent() {
        // A legacy local document has no revision token. If the server has no
        // document yet, still preserve the old behavior of uploading that copy.
        const snapshot = this.store?.flush();
        if (!snapshot || !this.store.isStored(snapshot)) return;
        this.pending = snapshot;
        return this.drain();
    }
    acceptSnapshot(snapshot) {
        if (!snapshot || !this.store.isStored(snapshot)) return;
        this.lastSavedContent = JSON.stringify(snapshot.payload);
        if (!this.store.hasPending(snapshot)) return;
        this.pending = snapshot;
        if (this.cloudConflict) {
            this.cloudConflict.local = snapshot.payload;
            try { localStorage.setItem(this.cloudStateKey('conflict'), JSON.stringify(this.cloudConflict)); } catch (_) {}
            this.announceCloudConflict(); return;
        }
        this.showLocalSaveFeedback();
        return this.drain();
    }
    async drain() {
        if (this.sending || this.isPaused || this.store.getConflict?.() || navigator.onLine === false || !this.checkLoginStatus()) return this.sending;
        if (this.cloudConflict || this.resolvingCloud) { this.announceCloudConflict(); return; }
        if (!this.pending || typeof window.SupabaseSync?.salvarRichtextAnotacoes !== 'function' ||
            typeof window.SupabaseSync?.carregarRichtextAnotacoes !== 'function') return;
        this.saveInProgress = true;
        let failed = false;
        this.sending = (async () => {
            while (this.pending && !this.isPaused && !this.store.getConflict?.() && navigator.onLine !== false && this.checkLoginStatus() && !this.cloudConflict) {
                const next = this.pending; this.pending = null;
                if (!this.store.isStored(next)) continue;
                if (next.key === this.lastCloudKey && !this.store.hasPending(next)) continue;
                this.showSavingFeedback();
                try {
                    const user = localStorage.getItem('supabase_user');
                    const send = async () => {
                        if (!this.store.isStored(next) || user !== localStorage.getItem('supabase_user')) return { skipped: true };
                        const raw = await window.SupabaseSync.carregarRichtextAnotacoes(this.currentSemana);
                        if (!this.store.isStored(next) || user !== localStorage.getItem('supabase_user')) return { skipped: true };
                        const remote = this.parseRemote(raw);
                        const remoteKey = remote === null ? null : this.store.contentKey(remote);
                        if (remoteKey === next.key) return { success: true };
                        if (remoteKey !== this.lastCloudKey && (remote !== null || this.lastCloudKey !== null)) {
                            this.setCloudConflict(raw, next);
                            return { conflict: true };
                        }
                        const result = await window.SupabaseSync.salvarRichtextAnotacoes(this.currentSemana, JSON.stringify(next.payload), { expectedRemote: raw });
                        if (result?.code === 'SYNC_CONFLICT' && user === localStorage.getItem('supabase_user')) {
                            this.setCloudConflict(raw, this.store.snapshot());
                            try {
                                const newest = await window.SupabaseSync.carregarRichtextAnotacoes(this.currentSemana);
                                if (user === localStorage.getItem('supabase_user')) this.setCloudConflict(newest);
                            } catch (_) {} // Keep the durable stop marker until the cloud is readable.
                            return { conflict: true };
                        }
                        return result;
                    };
                    // Serialize uploads by week across v2 tabs when Web Locks is
                    // available; recheck the stored revision after acquiring it.
                    const result = navigator.locks?.request
                        ? await navigator.locks.request('notes-cloud-' + this.currentSemana, send)
                        : await send();
                    if (result?.skipped) continue;
                    if (result?.conflict) { if (!this.pending) this.pending = next; failed = true; break; }
                    if (result?.success !== true) throw new Error(result?.error || 'Falha na sincronização.');
                    if (user !== localStorage.getItem('supabase_user') || !this.store.isStored(next)) continue;
                    this.rememberCloudKey(next.key);
                    this.store.acknowledge(next);
                    this.showSavedFeedback();
                } catch (_) {
                    // A newer edit wins the queue. The full local document remains
                    // saved even when this request fails or the app is suspended.
                    if (!this.pending) this.pending = next;
                    failed = true;
                    if (this.cloudConflict) this.announceCloudConflict(); else this.showErrorFeedback(); break;
                }
            }
        })();
        try { await this.sending; }
        finally {
            this.sending = null; this.saveInProgress = false;
            // Include an edit queued in the microtask that finishes the request.
            // A failed request waits for an explicit retry/reconnection.
            if (this.pending && !failed) this.drain();
        }
    }
    executeAutoSave() {
        if (!this.store || !this.editor) return Promise.resolve();
        const snapshot = this.store.flush();
        if (snapshot && this.store.isStored(snapshot) && this.store.hasPending(snapshot)) this.pending = snapshot;
        return this.drain();
    }
    onContentChange() { return this.executeAutoSave('input'); }
    onFocusLost() { return this.executeAutoSave('blur'); }
    onPageUnload() { return this.executeAutoSave('unload'); }
    saveToLocal() { return this.store?.flush(); }
    async saveToSupabase(content) {
        // Compatibility callers must use the same guarded queue as editor input.
        const snapshot = this.store?.flush();
        if (!snapshot || content !== JSON.stringify(snapshot.payload)) throw new Error('O conteúdo mudou. Salve a versão atual do editor.');
        return this.uploadCurrent();
    }
    triggerFeedbackEvent(message, type, duration = null) {
        window.dispatchEvent(new CustomEvent('editor:save-status', { detail: { message, type, duration } }));
    }
    showSavingFeedback() { this.triggerFeedbackEvent('Sincronizando…', 'saving'); }
    showSavedFeedback() { this.triggerFeedbackEvent('Salvo na nuvem', 'success', 1800); }
    showLocalSaveFeedback() { this.triggerFeedbackEvent('Salvo neste aparelho', 'local', 1600); }
    showErrorFeedback() { this.triggerFeedbackEvent('Salvo neste aparelho. A sincronização será tentada novamente quando houver conexão.', 'error', 0); }
    forceAutoSave() { return this.executeAutoSave('force'); }
    pauseAutoSave() { this.isPaused = true; this.triggerFeedbackEvent('⏸️ Sincronização pausada', 'local', 2000); }
    resumeAutoSave() { this.isPaused = false; return this.executeAutoSave('resume'); }
    setDelay(ms) {
        const value = Number(ms); if (!Number.isFinite(value) || value < 0) return;
        this.SAVE_DELAY = Math.floor(value); this.store?.setDelay(this.SAVE_DELAY);
    }
    getStatus() { return { semana: this.currentSemana, loggedIn: this.isLoggedIn, paused: this.isPaused, saveInProgress: this.saveInProgress, delay: this.SAVE_DELAY }; }
    debug() { return { ...this.getStatus(), editorFound: !!this.editor, lastSavedLength: this.lastSavedContent.length, roots: this.obterRaizesEditor().length, local: this.store?.stats() }; }
}
window.AutoSaveManager = new AutoSaveManager();
window.forceAutoSave = () => window.AutoSaveManager.forceAutoSave();
window.pauseAutoSave = () => window.AutoSaveManager.pauseAutoSave();
window.resumeAutoSave = () => window.AutoSaveManager.resumeAutoSave();
window.autoSaveStatus = () => window.AutoSaveManager.getStatus();
window.debugAutoSave = () => window.AutoSaveManager.debug();
