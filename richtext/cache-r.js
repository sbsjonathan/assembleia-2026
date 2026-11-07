// One owner restores, observes and persists the local document. Cloud sync consumes
// these snapshots rather than rebuilding or writing the same document a second time.
class CacheRichText {
  constructor() {
    this.semanaAtual = this.obterSemanaURL() || window.semanaAtual || this.obterSemanaAtual();
    this.prefixoCache = 'richtext_cache_';
    this.editor = null;
    this.timeout = 0;
    this.delay = 350;
    this.observer = null;
    this.isApplyingCache = false;
    this.maybeDirty = true;
    this.revision = 0;
    this.current = null;
    this.lastWrittenKey = null;
    this.lastStorageRaw = null;
    this.lastSaveError = null;
    this.conflict = null;
    this.sessionId = Math.random().toString(36).slice(2, 10);
    this.metrics = { restores: 0, snapshots: 0, writes: 0 };
    this.ready = new Promise(resolve => { this.resolveReady = resolve; });
    this.exporAPI();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => this.integrarComEditor(), { once: true });
    else this.integrarComEditor();
  }

  obterSemanaURL() { return new URLSearchParams(location.search).get('semana'); }
  obterSemanaAtual() {
    const date = new Date(), day = date.getDay();
    date.setDate(date.getDate() + (day === 0 ? -6 : 1 - day));
    return `${String(date.getDate()).padStart(2, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }
  obterChaveCache() { return this.prefixoCache + this.semanaAtual; }
  syncKey() { return 'richtext_sync_' + this.semanaAtual; }
  obterRaizesEditor() {
    return Array.from(this.editor?.children || []).filter(node => node.matches('.node-paragraph,.node-text,.node-toggle'));
  }
  parse(raw) {
    if (raw && typeof raw === 'object') return raw;
    if (typeof raw !== 'string' || !raw.trim()) return null;
    try { const parsed = JSON.parse(raw); if (parsed && typeof parsed === 'object') return parsed; } catch (_) {}
    return { html: raw, formato: 'legacy-html' };
  }
  carregarDados() {
    try { return this.parse(localStorage.getItem(this.obterChaveCache())); } catch (_) { return null; }
  }
  carregarCache() { return this.carregarDados()?.html ?? null; }

  cleanHTML(html) {
    const template = document.createElement('template');
    template.innerHTML = html || '';
    // Bible-mode links are a presentation overlay, not an edit. Persistent
    // transcription wrappers and their data-bbl-source-id remain untouched.
    template.content.querySelectorAll('.bbl').forEach(node => node.replaceWith(...node.childNodes));
    template.content.querySelectorAll('*').forEach(node => {
      for (const name of ['is-focused', 'is-entering', 'shake', 'pressionando', 'ref-aberta', 'bbl--aura', 'is-read-only']) node.classList.remove(name);
      if (node.hasAttribute('class') && !node.className) node.removeAttribute('class');
      node.removeAttribute('data-bbl-bound');
      node.removeAttribute('data-empty');
    });
    return template.innerHTML;
  }
  cleanTree(tree) {
    return (tree || []).map(item => {
      const clean = { ...item };
      if (typeof clean.html === 'string') clean.html = this.cleanHTML(clean.html);
      if (Array.isArray(clean.children)) clean.children = this.cleanTree(clean.children);
      return clean;
    });
  }
  exportarTree() {
    return typeof M6_Tree === 'undefined' ? [] : this.cleanTree(this.obterRaizesEditor().map(node => M6_Tree.toTree(node)).filter(Boolean));
  }
  exportarHTML() { return this.cleanHTML(this.editor?.innerHTML || ''); }
  contentKey(payload, alreadyClean = false) {
    // text is redundant when rich HTML exists and can vary with rendering;
    // timestamp and localRevision describe persistence, not document content.
    const normalize = tree => tree.map(item => {
      const value = { ...item };
      if (typeof value.html === 'string') delete value.text;
      if (Array.isArray(value.children)) value.children = normalize(value.children);
      return value;
    });
    return Array.isArray(payload?.tree) && payload.tree.length
      ? JSON.stringify(normalize(alreadyClean ? payload.tree : this.cleanTree(payload.tree)))
      : this.cleanHTML(payload?.html || '');
  }
  meaningfulMutation(record) {
    if (record.type !== 'attributes') return true;
    if (record.target === this.editor) return false;
    if (record.attributeName !== 'class') return true;
    const stable = value => String(value || '').split(/\s+/).filter(name => name && !['is-focused','is-entering','shake','pressionando','ref-aberta','bbl--aura','is-read-only'].includes(name)).sort().join(' ');
    return stable(record.oldValue) !== stable(record.target.className);
  }
  takeMutations() {
    if (this.observer?.takeRecords().some(record => this.meaningfulMutation(record))) this.maybeDirty = true;
  }
  snapshot() {
    if (!this.editor) return null;
    this.takeMutations();
    if (!this.maybeDirty && this.current) return this.current;
    this.metrics.snapshots++;
    const tree = this.exportarTree(), html = this.exportarHTML();
    const payload = { formato: 'v23-tree', versao: '2.0', semana: this.semanaAtual, tree, html };
    const key = this.contentKey(payload, true);
    this.maybeDirty = false;
    if (this.current?.key === key) return this.current;
    const timestamp = Math.max(Date.now(), (this.current?.payload.timestamp || 0) + 1);
    payload.timestamp = timestamp;
    payload.localRevision = `${timestamp}-${Math.random().toString(36).slice(2, 9)}`;
    this.current = { key, payload, revision: ++this.revision };
    return this.current;
  }
  readStorage() { return localStorage.getItem(this.obterChaveCache()); }
  reportSaveError(error) {
    this.lastSaveError = error?.message || 'Não foi possível salvar neste aparelho.';
    window.dispatchEvent(new CustomEvent('notes:save-error', { detail: { message: this.lastSaveError } }));
  }
  preserveConflict(snapshot, raw) {
    const other = this.parse(raw) || { html: '', formato: 'legacy-html' };
    if (!this.conflict || this.conflict.externalRaw !== raw) {
      this.conflict = {
        id: `richtext_recovery_${this.semanaAtual}_${Date.now()}-${this.sessionId}`,
        semana: this.semanaAtual, createdAt: Date.now(), externalRaw: raw,
        external: other, local: snapshot.payload, saved: false, exported: false
      };
    } else this.conflict.local = snapshot.payload;
    this.conflict.exported = this.conflict.exportedLocalKey === snapshot.key && this.conflict.exportedExternalRaw === raw;
    try {
      localStorage.setItem(this.conflict.id, JSON.stringify({
        type: 'notes-concurrent-edit', semana: this.semanaAtual, createdAt: this.conflict.createdAt,
        local: this.conflict.local, external: this.conflict.external
      }));
      this.conflict.saved = true;
    } catch (error) { this.conflict.saved = false; this.reportSaveError(error); }
    window.dispatchEvent(new CustomEvent('notes:conflict', { detail: this.conflict }));
    return null;
  }
  acceptExternal(raw, data = this.parse(raw)) {
    this.lastStorageRaw = raw;
    if (!data) return false;
    const applied = this.applyContent(data, { external: true });
    if (applied) {
      this.lastSaveError = null;
      window.dispatchEvent(new CustomEvent('notes:external-updated', { detail: this.current }));
    }
    return applied;
  }
  checkExternal(snapshot, raw) {
    if (this.conflict) return this.preserveConflict(snapshot, raw);
    if (raw === this.lastStorageRaw) return snapshot;
    const data = this.parse(raw);
    if (data && this.contentKey(data) === snapshot.key) {
      this.lastStorageRaw = raw; this.lastWrittenKey = snapshot.key;
      if (data.localRevision) snapshot.payload.localRevision = data.localRevision;
      else delete snapshot.payload.localRevision;
      return snapshot;
    }
    const previous = this.parse(this.lastStorageRaw);
    const concurrentWrite = previous?.writerSession === this.sessionId && data &&
      Object.prototype.hasOwnProperty.call(data, 'previousLocalRevision') && data.previousLocalRevision !== (previous.localRevision || null);
    if (data && snapshot.key === this.lastWrittenKey && !concurrentWrite) {
      this.acceptExternal(raw, data);
      return this.current;
    }
    return this.preserveConflict(snapshot, raw);
  }
  flush() {
    clearTimeout(this.timeout); this.timeout = 0;
    if (this.isApplyingCache) return this.current;
    let snapshot = this.snapshot();
    if (!snapshot) return null;
    try {
      snapshot = this.checkExternal(snapshot, this.readStorage());
      if (!snapshot) return null;
      if (snapshot.key === this.lastWrittenKey) { this.lastSaveError = null; return snapshot; }
      snapshot.payload.previousLocalRevision = this.parse(this.lastStorageRaw)?.localRevision || null;
      snapshot.payload.writerSession = this.sessionId;
      const raw = JSON.stringify(snapshot.payload);
      localStorage.setItem(this.obterChaveCache(), raw);
      this.lastStorageRaw = raw; this.lastWrittenKey = snapshot.key; this.lastSaveError = null;
      this.metrics.writes++;
      if (snapshot.acknowledgeAfterWrite) { delete snapshot.acknowledgeAfterWrite; this.acknowledge(snapshot); }
      window.dispatchEvent(new CustomEvent('notes:stored', { detail: snapshot }));
      return snapshot;
    } catch (error) { this.reportSaveError(error); return null; }
  }
  isStored(snapshot) {
    if (!snapshot || this.conflict || this.lastSaveError) return false;
    try {
      const raw = this.readStorage();
      if (raw !== this.lastStorageRaw) return false;
      return snapshot.key === this.lastWrittenKey;
    } catch (_) { return false; }
  }
  resolveConflict(choice) {
    if (!['local', 'external'].includes(choice) || !this.conflict) return false;
    // Preserve any typing performed while the comparison was open.
    const current = this.snapshot();
    let raw;
    try { raw = this.readStorage(); } catch (error) { this.reportSaveError(error); return false; }
    const changedAgain = raw !== this.conflict.externalRaw;
    this.preserveConflict(current, raw);
    if (changedAgain) return false;
    const conflict = this.conflict;
    if (!conflict.saved && !conflict.exported) return false;
    this.conflict = null; this.lastStorageRaw = raw;
    let snapshot;
    if (choice === 'external') {
      if (!this.acceptExternal(raw, conflict.external)) { this.conflict = conflict; return false; }
      snapshot = this.current;
    } else {
      // The user selected this copy after both versions were preserved.
      this.lastWrittenKey = this.contentKey(conflict.external);
      snapshot = this.flush();
      if (!snapshot) { this.conflict = conflict; return false; }
    }
    window.dispatchEvent(new CustomEvent('notes:conflict-resolved', { detail: snapshot }));
    return true;
  }
  listRecovery() {
    const entries = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key?.startsWith(`richtext_recovery_${this.semanaAtual}_`)) continue;
        try { entries.push({ id: key, ...JSON.parse(localStorage.getItem(key)) }); } catch (_) {}
      }
    } catch (_) {}
    return entries.sort((a, b) => b.createdAt - a.createdAt);
  }
  downloadRecovery() {
    const snapshot = this.snapshot();
    const data = this.conflict
      ? { type: 'notes-concurrent-edit', semana: this.semanaAtual, local: snapshot.payload, external: this.conflict.external }
      : { type: 'notes-backup', semana: this.semanaAtual, payload: snapshot.payload };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `anotacoes-${this.semanaAtual}-${Date.now()}.json`;
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    if (this.conflict) {
      this.conflict.exported = true; this.conflict.exportedLocalKey = snapshot.key;
      this.conflict.exportedExternalRaw = this.conflict.externalRaw;
    }
    return true;
  }
  salvarCache() {
    // The live document is authoritative: never pair stale supplied HTML with a
    // newer tree. Existing callers pass that same document through this method.
    return this.flush();
  }
  agendarSalvar() {
    if (this.isApplyingCache) return;
    this.maybeDirty = true;
    clearTimeout(this.timeout);
    this.timeout = setTimeout(() => this.flush(), this.delay);
  }
  acknowledge(snapshot = this.current) {
    const token = snapshot?.payload?.localRevision;
    if (!token || this.conflict) return;
    try {
      const stored = this.parse(this.readStorage());
      if (stored?.localRevision && stored.localRevision !== token) return;
      localStorage.setItem(this.syncKey(), token);
    } catch (_) {}
  }
  hasPending(snapshot = this.snapshot()) {
    const token = snapshot?.payload?.localRevision;
    if (!token) return false; // Older caches have no pending metadata.
    try { return localStorage.getItem(this.syncKey()) !== token; } catch (_) { return true; }
  }

  garantirRaiz() {
    if (!this.editor.children.length) this.editor.appendChild(M5_Factory.para(''));
  }
  aplicarTree(tree) {
    if (!Array.isArray(tree)) return false;
    const fragment = document.createDocumentFragment();
    for (const item of tree) { const node = M6_Tree.fromTree(item, null, false); if (node) fragment.append(node); }
    this.editor.replaceChildren(fragment); this.garantirRaiz(); return true;
  }
  aplicarHTML(html) {
    if (typeof html !== 'string') return false;
    if (/class\s*=\s*["'][^"']*(node-paragraph|node-toggle|node-text)/i.test(html)) this.editor.innerHTML = html;
    else {
      const node = M5_Factory.para('');
      M2_Query.getParC(node).innerHTML = html;
      this.editor.replaceChildren(node);
    }
    this.garantirRaiz(); return true;
  }
  applyContent(raw, { remote = false, initial = false, external = false } = {}) {
    const data = this.parse(raw);
    if (!data || !this.editor || (this.conflict && remote)) return false;
    this.isApplyingCache = true;
    clearTimeout(this.timeout); this.timeout = 0;
    this.observer?.disconnect();
    let applied = false;
    try {
      applied = Array.isArray(data.tree) && data.tree.length ? this.aplicarTree(data.tree) : this.aplicarHTML(data.html);
      if (!applied) return false;
      M3_TextModel.syncAll();
      M11_Layout?.schedule(2);
      this.maybeDirty = true;
      const snapshot = this.snapshot();
      if (initial || external) {
        snapshot.payload.timestamp = Number(data.timestamp) || Date.now();
        if (typeof data.localRevision === 'string') snapshot.payload.localRevision = data.localRevision;
        else delete snapshot.payload.localRevision;
        this.lastWrittenKey = snapshot.key;
      }
      if (remote) snapshot.acknowledgeAfterWrite = true;
      const history = window.M12_History;
      if (history) { clearTimeout(history.timer); cancelAnimationFrame(history.raf); history.timer = 0; history.stack = []; history.index = -1; history.commit(true); }
      this.metrics.restores++;
      window.dispatchEvent(new CustomEvent('notes:restored', { detail: { initial, remote } }));
      return true;
    } finally {
      this.isApplyingCache = false;
      this.observe();
      if (applied && remote) {
        const saved = this.flush();
        if (saved) this.acknowledge(saved);
      }
    }
  }
  aplicarCacheSalvo() { return this.applyContent(this.carregarDados(), { initial: true }); }
  observe() {
    this.observer?.observe(this.editor, { childList: true, subtree: true, characterData: true, attributes: true, attributeOldValue: true,
      attributeFilter: ['data-open', 'class', 'style', 'hidden', 'aria-expanded', 'data-bbl-source-id'] });
  }
  integrarComEditor() {
    const editor = document.getElementById('editor');
    if (!editor || typeof M6_Tree === 'undefined' || typeof M5_Factory === 'undefined' || typeof M3_TextModel === 'undefined') {
      setTimeout(() => this.integrarComEditor(), 100); return;
    }
    this.editor = editor;
    window.semanaAtual = this.semanaAtual;
    try { this.lastStorageRaw = this.readStorage(); } catch (error) { this.reportSaveError(error); }
    if (!this.applyContent(this.parse(this.lastStorageRaw), { initial: true })) {
      this.garantirRaiz(); const initial = this.snapshot();
      delete initial.payload.localRevision; this.lastWrittenKey = initial.key;
    }
    this.observer = new MutationObserver(records => {
      if (!this.isApplyingCache && records.some(record => this.meaningfulMutation(record))) this.agendarSalvar();
    });
    this.observe();
    editor.addEventListener('input', () => this.agendarSalvar());
    editor.addEventListener('blur', () => this.flush(), true);
    for (const event of ['pagehide', 'beforeunload', 'blur']) window.addEventListener(event, () => this.flush());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') this.flush(); });
    window.addEventListener('storage', event => {
      if (event.storageArea === localStorage && event.key === this.obterChaveCache()) this.flush();
    });
    window.addEventListener('focus', () => this.flush());
    this.resolveReady(this);
  }
  exporAPI() {
    window.cacheRichText = {
      ready: this.ready,
      salvar: () => this.flush(), salvarCache: () => this.flush(), flush: () => this.flush(),
      carregar: () => this.carregarCache(), carregarDados: () => this.carregarDados(), aplicar: () => this.aplicarCacheSalvo(),
      semanaAtual: () => this.semanaAtual, snapshot: () => this.snapshot(), contentKey: payload => this.contentKey(payload),
      parse: raw => this.parse(raw), applyContent: (raw, options) => this.applyContent(raw, options),
      hasPending: snapshot => this.hasPending(snapshot), acknowledge: snapshot => this.acknowledge(snapshot),
      isStored: snapshot => this.isStored(snapshot), getConflict: () => this.conflict,
      resolveConflict: choice => this.resolveConflict(choice), listRecovery: () => this.listRecovery(), downloadRecovery: () => this.downloadRecovery(),
      canLeave: () => { const saved = this.flush(); return !!saved && !this.conflict && !this.lastSaveError && saved.key === this.lastWrittenKey; },
      setDelay: value => { this.delay = value; }, stats: () => ({ ...this.metrics, saveError: this.lastSaveError, conflict: !!this.conflict })
    };
  }
}
const cacheRichText = new CacheRichText();
window.CacheRichText = CacheRichText;
