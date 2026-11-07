class UnifiedLoadManager {
    constructor() {
        this.editor = null; this.currentSemana = null; this.isLoggedIn = false;
        this.syncing = null; this.ready = this.setup();
    }
    async setup() {
        if (!window.cacheRichText) return;
        this.store = window.cacheRichText;
        await this.store.ready;
        // CacheRichText already restored the local document exactly once.
        this.editor = document.getElementById('editor');
        this.currentSemana = this.store.semanaAtual();
        this.updateSemanaIndicator();
        this.checkLoginStatus(); this.setupListeners();
        if (this.isLoggedIn) this.syncWithSupabase();
    }
    checkLoginStatus() {
        try { this.isLoggedIn = typeof window.SupabaseSync?.isLoggedIn === 'function' ? window.SupabaseSync.isLoggedIn() : !!localStorage.getItem('supabase_user'); }
        catch (_) { this.isLoggedIn = false; }
    }
    exportTree() { return this.store?.snapshot()?.payload.tree || []; }
    exportHTML() { return this.store?.snapshot()?.payload.html || ''; }
    serializePayload() { return this.store?.snapshot()?.payload || null; }
    serializeForCompare() { return this.store?.snapshot()?.key || ''; }
    parseSavedContent(raw) { return this.store?.parse(raw); }
    applyContentToEditor(raw) { return this.store?.applyContent(raw, { remote: true }); }
    loadInitialContentFromCache() { return this.store?.ready; }
    async syncWithSupabase() {
        if (!this.store || this.syncing) return this.syncing;
        this.checkLoginStatus();
        if (!this.isLoggedIn || navigator.onLine === false || typeof window.SupabaseSync?.carregarRichtextAnotacoes !== 'function') return;
        // An unsent local revision is authoritative. Send it instead of replacing
        // it with an older server document during startup or reconnection.
        const before = this.store.flush();
        if (!before || this.store.getConflict?.()) return;
        if (this.store.hasPending(before)) {
            await window.AutoSaveManager?.ready;
            return window.AutoSaveManager?.forceAutoSave();
        }
        const requestUser = localStorage.getItem('supabase_user');
        this.showFeedback('Sincronizando...', 'saving');
        this.syncing = (async () => {
            try {
                const raw = await window.SupabaseSync.carregarRichtextAnotacoes(this.currentSemana);
                const current = this.store.snapshot();
                if (requestUser !== localStorage.getItem('supabase_user') || this.store.getConflict?.()) return;
                if (current.revision !== before.revision || current.key !== before.key || this.store.hasPending(current)) {
                    this.showFeedback('Alterações locais preservadas', 'local');
                    window.AutoSaveManager?.forceAutoSave(); return;
                }
                if (!raw || !String(raw).trim()) {
                    this.showFeedback('Salvo localmente', 'local');
                    if (this.editor.textContent.trim()) {
                        await window.AutoSaveManager?.ready;
                        await window.AutoSaveManager?.uploadCurrent();
                    }
                    return;
                }
                const data = this.store.parse(raw);
                if (!data) return;
                if (this.store.contentKey(data) !== current.key) {
                    if (!this.store.applyContent(data, { remote: true })) return;
                }
                window.AutoSaveManager?.acknowledgeRemote(this.store.snapshot());
                this.showFeedback('✅ Sincronizado', 'success');
            } catch (_) { this.showFeedback('Não foi possível ler a nuvem. Sua cópia local foi mantida.', 'error'); }
        })();
        try { await this.syncing; } finally { this.syncing = null; }
    }
    setupListeners() {
        window.addEventListener('storage', event => { if (event.key === 'supabase_user') this.syncWithSupabase(); });
        window.addEventListener('online', () => this.syncWithSupabase());
    }
    updateSemanaIndicator() {
        const node = document.getElementById('semana-indicator');
        if (node) node.textContent = `Semana: ${this.currentSemana}`;
    }
    showFeedback(message, type) {
        window.dispatchEvent(new CustomEvent('editor:save-status', { detail: { message, type, duration: 3000 } }));
    }
}
window.UnifiedLoadManager = new UnifiedLoadManager();
