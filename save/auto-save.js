// Local persistence is synchronous and independent of network latency. Only the
// newest pending revision is queued behind an active cloud request.
class AutoSaveManager {
    constructor() {
        this.editor = null; this.currentSemana = null; this.isLoggedIn = false;
        this.lastSavedContent = ''; this.lastCloudKey = null;
        this.saveInProgress = false; this.isPaused = false; this.SAVE_DELAY = 350;
        this.pending = null; this.sending = null;
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
        if (!this.store.hasPending(initial)) this.lastCloudKey = initial.key;
        this.lastSavedContent = JSON.stringify(initial.payload);
        window.addEventListener('notes:stored', event => this.acceptSnapshot(event.detail));
        window.addEventListener('notes:save-error', () => this.triggerFeedbackEvent('Não foi possível salvar neste aparelho. Mantenha esta página aberta ou baixe uma cópia.', 'error', 0));
        window.addEventListener('notes:conflict', () => { this.pending = null; });
        window.addEventListener('notes:external-updated', () => { this.pending = null; this.showLocalSaveFeedback(); });
        window.addEventListener('notes:conflict-resolved', event => this.acceptSnapshot(event.detail));
        const retry = () => { this.checkLoginStatus(); this.executeAutoSave('resume'); };
        window.addEventListener('online', retry);
        window.addEventListener('pageshow', retry);
        window.addEventListener('storage', event => { if (event.key === 'supabase_user') retry(); });
        for (const name of ['pagehide', 'beforeunload', 'blur']) window.addEventListener(name, () => this.onPageUnload());
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') this.onPageUnload(); });
        if (this.store.hasPending(initial)) this.acceptSnapshot(initial);
    }
    checkLoginStatus() {
        try { this.isLoggedIn = typeof window.SupabaseSync?.isLoggedIn === 'function' ? window.SupabaseSync.isLoggedIn() : !!localStorage.getItem('supabase_user'); }
        catch (_) { this.isLoggedIn = false; }
        return this.isLoggedIn;
    }
    obterRaizesEditor() { return Array.from(this.editor?.children || []).filter(node => node.matches('.node-paragraph,.node-text,.node-toggle')); }
    exportTree() { return this.store?.snapshot()?.payload.tree || []; }
    exportHTML() { return this.store?.snapshot()?.payload.html || ''; }
    serializePayload() { return this.store?.snapshot()?.payload || null; }
    serializeForRemote() { return JSON.stringify(this.serializePayload()); }
    parseSavedContent(raw) { return this.store?.parse(raw); }
    applySavedContent(raw) { return this.store?.applyContent(raw, { remote: true }); }
    acknowledgeRemote(snapshot) {
        if (!snapshot || !this.store.isStored(snapshot)) return;
        this.lastCloudKey = snapshot.key;
        this.lastSavedContent = JSON.stringify(snapshot.payload);
        this.store.acknowledge(snapshot);
        if (this.pending?.key === snapshot.key) this.pending = null;
    }
    uploadCurrent() {
        // A legacy local document has no revision token. If the server has no
        // document yet, still preserve the old behavior of uploading that copy.
        const snapshot = this.store?.flush();
        if (!snapshot || !this.store.isStored(snapshot)) return;
        this.lastCloudKey = null;
        this.pending = snapshot;
        return this.drain();
    }
    acceptSnapshot(snapshot) {
        if (!snapshot || !this.store.isStored(snapshot)) return;
        this.lastSavedContent = JSON.stringify(snapshot.payload);
        if (!this.store.hasPending(snapshot)) {
            this.lastCloudKey = snapshot.key;
            return;
        }
        this.pending = snapshot;
        this.showLocalSaveFeedback();
        return this.drain();
    }
    async drain() {
        if (this.sending || this.isPaused || this.store.getConflict?.() || navigator.onLine === false || !this.checkLoginStatus()) return this.sending;
        if (!this.pending || typeof window.SupabaseSync?.salvarRichtextAnotacoes !== 'function') return;
        this.saveInProgress = true;
        let failed = false;
        this.sending = (async () => {
            while (this.pending && !this.isPaused && !this.store.getConflict?.() && navigator.onLine !== false && this.checkLoginStatus()) {
                const next = this.pending; this.pending = null;
                if (!this.store.isStored(next)) continue;
                if (next.key === this.lastCloudKey && !this.store.hasPending(next)) continue;
                this.showSavingFeedback();
                try {
                    const user = localStorage.getItem('supabase_user');
                    const send = async () => {
                        if (!this.store.isStored(next) || user !== localStorage.getItem('supabase_user')) return null;
                        return window.SupabaseSync.salvarRichtextAnotacoes(this.currentSemana, JSON.stringify(next.payload));
                    };
                    // Serialize uploads by week across v2 tabs when Web Locks is
                    // available; recheck the stored revision after acquiring it.
                    const result = navigator.locks?.request
                        ? await navigator.locks.request('notes-cloud-' + this.currentSemana, send)
                        : await send();
                    if (!result) continue;
                    if (result.success === false) throw new Error(result.error || 'Falha na sincronização.');
                    if (user !== localStorage.getItem('supabase_user') || !this.store.isStored(next)) continue;
                    this.lastCloudKey = next.key;
                    this.store.acknowledge(next);
                    this.showSavedFeedback();
                } catch (_) {
                    // A newer edit wins the queue. The full local document remains
                    // saved even when this request fails or the app is suspended.
                    if (!this.pending) this.pending = next;
                    failed = true;
                    this.showErrorFeedback(); break;
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
        const result = await window.SupabaseSync?.salvarRichtextAnotacoes(this.currentSemana, content);
        if (result?.success === false) throw new Error(result.error || 'Falha na sincronização.');
        return result;
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
