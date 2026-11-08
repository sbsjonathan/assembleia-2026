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
        // Pending drafts use the upload queue, which reads and preserves a
        // divergent cloud copy before sending. Never replace them during loading.
        await window.AutoSaveManager?.ready;
        if (window.AutoSaveManager?.getCloudConflict?.()) { window.AutoSaveManager.announceCloudConflict(); return; }
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
                await window.AutoSaveManager?.ready;
                const raw = await window.SupabaseSync.carregarRichtextAnotacoes(this.currentSemana);
                const current = this.store.snapshot();
                if (requestUser !== localStorage.getItem('supabase_user') || this.store.getConflict?.()) return;
                if (current.revision !== before.revision || current.key !== before.key || this.store.hasPending(current)) {
                    this.showFeedback('Alterações locais preservadas', 'local');
                    window.AutoSaveManager?.forceAutoSave(); return;
                }
                if (raw === null) {
                    this.showFeedback('Salvo localmente', 'local');
                    if (this.editor.textContent.trim()) {
                        await window.AutoSaveManager?.ready;
                        await window.AutoSaveManager?.uploadCurrent();
                    }
                    return;
                }
                const data = typeof raw === 'string' && !raw.trim()
                    ? { html: '', formato: 'legacy-html' } : this.store.parse(raw);
                if (!data || typeof raw !== 'string') throw new Error('Anotação da nuvem inválida.');
                if (this.store.contentKey(data) !== current.key) {
                    // Keep a recoverable local copy before adopting a different
                    // device's document, including an intentionally empty one.
                    window.AutoSaveManager?.preserveCopy(current.payload, data, 'Antes de restaurar a nuvem');
                    if (!this.store.applyContent(data, { remote: true })) return;
                }
                const applied = this.store.snapshot();
                if (!this.store.isStored(applied)) throw new Error('Não foi possível salvar a cópia da nuvem neste aparelho.');
                window.AutoSaveManager?.acknowledgeRemote(applied, this.store.contentKey(data));
                this.showFeedback('✅ Sincronizado', 'success');
            } catch (_) { this.showFeedback('Não foi possível ler a nuvem. Sua cópia local foi mantida.', 'error'); }
        })();
        try { await this.syncing; } finally { this.syncing = null; }
    }
    setupListeners() {
        window.addEventListener('storage', event => { if (event.key === 'supabase_user') this.syncWithSupabase(); });
        window.addEventListener('online', () => this.syncWithSupabase());
        window.addEventListener('pageshow', () => this.syncWithSupabase());
        window.addEventListener('supabaseSessionChanged', () => this.syncWithSupabase());
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
