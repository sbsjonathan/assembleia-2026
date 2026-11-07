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
  flush() {
    clearTimeout(this.timeout); this.timeout = 0;
    if (this.isApplyingCache) return this.current;
    const snapshot = this.snapshot();
    if (!snapshot || snapshot.key === this.lastWrittenKey) return snapshot;
    try {
      localStorage.setItem(this.obterChaveCache(), JSON.stringify(snapshot.payload));
      this.lastWrittenKey = snapshot.key;
      this.metrics.writes++;
      window.dispatchEvent(new CustomEvent('notes:stored', { detail: snapshot }));
    } catch (error) {
      window.dispatchEvent(new CustomEvent('notes:save-error', { detail: { message: error.message } }));
    }
    return snapshot;
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
    if (!token) return;
    try { localStorage.setItem(this.syncKey(), token); } catch (_) {}
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
  applyContent(raw, { remote = false, initial = false } = {}) {
    const data = this.parse(raw);
    if (!data || !this.editor) return false;
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
      if (initial) {
        snapshot.payload.timestamp = Number(data.timestamp) || Date.now();
        if (typeof data.localRevision === 'string') snapshot.payload.localRevision = data.localRevision;
        else delete snapshot.payload.localRevision;
        this.lastWrittenKey = snapshot.key;
      }
      if (remote) this.acknowledge(snapshot);
      const history = window.M12_History;
      if (history) { clearTimeout(history.timer); cancelAnimationFrame(history.raf); history.timer = 0; history.stack = []; history.index = -1; history.commit(true); }
      this.metrics.restores++;
      window.dispatchEvent(new CustomEvent('notes:restored', { detail: { initial, remote } }));
      return true;
    } finally {
      this.isApplyingCache = false;
      this.observe();
      if (applied && remote) this.flush();
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
    if (!this.aplicarCacheSalvo()) {
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
      setDelay: value => { this.delay = value; }, stats: () => ({ ...this.metrics })
    };
  }
}
const cacheRichText = new CacheRichText();
window.CacheRichText = CacheRichText;
