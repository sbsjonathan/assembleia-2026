const PERF_LOW = !!(window.EditorPerfProfile?.isLow?.() || document.documentElement.classList.contains('perf-low'));

const M1_Config = {
  editor: document.getElementById('editor'),
  btn: document.getElementById('addToggleBtn'),
  scroll: document.getElementById('editorScroll'),
  toolbar: document.getElementById('kbdToolbar'),
  MIME: 'application/x-toggle-tree',
  MAX_LVL: 4,
  state: { lastR: null, internalClipboard: null }
};

const M2_Query = {
  selObj: () => window.getSelection(),
  curRange() { const s = this.selObj(); return s?.rangeCount ? s.getRangeAt(0) : null; },
  closest: (n, sel) => (n?.nodeType === 3 ? n.parentElement : n)?.closest?.(sel),
  curEd() { return this.closest(this.curRange()?.startContainer, '.editable'); },
  curNode() { return this.curEd()?.closest('.node-toggle, .node-text, .node-paragraph'); },
  rootNode(start = null) {
    let n = start || this.curNode();
    while (n && n.parentElement && n.parentElement !== M1_Config.editor) {
      n = n.parentElement.closest('.node-toggle, .node-text, .node-paragraph');
    }
    return n || null;
  },
  topNode() { return this.rootNode(); },
  getLvl: n => +(n?.dataset?.level || 0),
  childs: c => Array.from(c.children).filter(e => e.classList.contains('node-toggle') || e.classList.contains('node-text')),
  getArr: t => t.querySelector('.toggle-arrow'),
  getTit: t => t.querySelector('.toggle-title'),
  getChil: t => t.querySelector('.children'),
  getTxtC: t => t.querySelector('.text-content'),
  getTxtP: t => t.querySelector('.text-plus'),
  getParC: t => t.querySelector('.paragraph-content'),
  getEdFor: n => n?.classList.contains('node-toggle') ? M2_Query.getTit(n) : n?.classList.contains('node-text') ? M2_Query.getTxtC(n) : M2_Query.getParC(n),
  visibles() { return Array.from(M1_Config.editor.querySelectorAll('.editable')).filter(e => e.getClientRects().length > 0); },
  prevVis(ed) { const v = this.visibles(); return v[v.indexOf(ed) - 1] || null; },
  getAll() { return Array.from(M1_Config.editor.querySelectorAll('.node-toggle, .node-text, .node-paragraph')); },
  getPrev(n) { const a = this.getAll(); return a[a.indexOf(n) - 1] || null; }
};

const M3_TextModel = {
  read(el) { return el.innerText?.replace(/\r/g, '').replace(/\n$/, '') || ''; },
  readHTML(el) { return el?.innerHTML || ''; },
  isEmpty(el) {
    if (!el) return true;
    if (el.querySelector?.('ul, ol')) return false;
    return !el.textContent.replace(/\u200B/g, '').trim();
  },
  sync(el) { if (el) el.dataset.empty = this.isEmpty(el) ? 'true' : 'false'; },
  syncAll() {
    M1_Config.editor.querySelectorAll('.editable').forEach(e => this.sync(e));
    M1_Config.editor.querySelectorAll('.node-text').forEach(n => {
      const p = M2_Query.getTxtP(n);
      if (p) p.disabled = M2_Query.getLvl(n) > M1_Config.MAX_LVL;
    });
    M4_Caret.updateFocus();
    M11_Layout.schedule();
  }
};

const M4_Caret = {
  _suppressSelectionFocusUntil: 0,
  zombieToolbar: false,

  clearFocusSuppression() {
    this._suppressSelectionFocusUntil = 0;
  },
  forceToolbarOff() {
    this.zombieToolbar = false;
    document.body.classList.remove('zombie-toolbar-active');
    
    const clear = () => {
      M1_Config.editor.querySelectorAll('.is-focused').forEach(n => n.classList.remove('is-focused'));
      document.body.classList.remove('editor-has-focus');

      try {
        const sel = window.getSelection?.();
        if (sel && sel.rangeCount) sel.removeAllRanges();
      } catch (e) {}

      const ae = document.activeElement;
      if (ae && (ae === M1_Config.editor || M1_Config.editor.contains(ae))) {
        try { ae.blur?.(); } catch (e) {}
      }
      try { M1_Config.editor.blur?.(); } catch (e) {}
    };

    this._suppressSelectionFocusUntil = (typeof performance !== 'undefined' ? performance.now() : Date.now()) + 180;
    clear();
    requestAnimationFrame(() => {
      clear();
      this.updateFocus(true);
    });
    setTimeout(() => {
      clear();
      this.updateFocus(true);
    }, 60);
  },
  saveR() {
    const r = M2_Query.curRange();
    if (r && M1_Config.editor.contains(r.startContainer)) M1_Config.state.lastR = r.cloneRange();
  },
  restR() {
    if (!M1_Config.state.lastR) return;
    const s = M2_Query.selObj();
    s.removeAllRanges();
    s.addRange(M1_Config.state.lastR);
  },
  place(el, start = true) {
    if (!el) return;
    try {
      M1_Config.editor.focus({ preventScroll: true });
    } catch (e) {
      M1_Config.editor.focus();
    }
    const r = document.createRange();
    const s = M2_Query.selObj();
    r.selectNodeContents(el);
    r.collapse(start);
    s.removeAllRanges();
    s.addRange(r);
    this.updateFocus();
    M11_Layout.run();
    M11_Layout.schedule(2);
  },
  updateFocus(forceRecalc = false) {
    M1_Config.editor.querySelectorAll('.is-focused').forEach(n => n.classList.remove('is-focused'));

    if (this.zombieToolbar) {
      document.body.classList.add('zombie-toolbar-active');
    } else {
      document.body.classList.remove('zombie-toolbar-active');
    }

    const forceToolbarVisible = document.body.classList.contains('leitor-keep-toolbar') || this.zombieToolbar;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const suppressSelectionFocus = !forceToolbarVisible && !forceRecalc && now < (this._suppressSelectionFocusUntil || 0);

    let hasFocus = !!forceToolbarVisible;
    const ed = suppressSelectionFocus ? null : M2_Query.curEd();

    if (ed && M1_Config.editor.contains(ed)) {
      ed.closest('.node-toggle, .node-text, .node-paragraph')?.classList.add('is-focused');
      hasFocus = true;
    }

    if (!suppressSelectionFocus && document.activeElement === M1_Config.editor) {
      hasFocus = true;
    }

    const s = suppressSelectionFocus ? null : window.getSelection();
    if (s && s.rangeCount > 0 && M1_Config.editor.contains(s.anchorNode)) {
      hasFocus = true;
    }

    if (hasFocus) {
      document.body.classList.add('editor-has-focus');
    } else {
      document.body.classList.remove('editor-has-focus');
    }
  }
};

const M4A_Placeholder = {
  getSemanaDDMM() {
    if (window.semanaAtual) return window.semanaAtual;

    const params = new URLSearchParams(window.location.search);
    const semanaURL = params.get('semana');
    if (semanaURL) {
      window.semanaAtual = semanaURL;
      return semanaURL;
    }

    const hoje = new Date();
    const diaDaSemana = hoje.getDay();
    const diasParaSegunda = diaDaSemana === 0 ? -6 : 1 - diaDaSemana;

    const segundaFeira = new Date(hoje);
    segundaFeira.setDate(hoje.getDate() + diasParaSegunda);
    segundaFeira.setHours(0, 0, 0, 0);

    const dia = String(segundaFeira.getDate()).padStart(2, '0');
    const mes = String(segundaFeira.getMonth() + 1).padStart(2, '0');

    const semana = `${dia}-${mes}`;
    window.semanaAtual = semana;
    return semana;
  },

  formatSemanaAmigavel() {
    const semana = this.getSemanaDDMM();
    const [diaRaw, mesRaw] = String(semana).split('-');
    const meses =[
      'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
      'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'
    ];

    const dia = String(parseInt(diaRaw, 10) || diaRaw);
    const mesIndex = (parseInt(mesRaw, 10) || 1) - 1;
    const mes = meses[mesIndex] || mesRaw;

    return `${dia} de ${mes}`;
  },

  main() {
    return `Anotie aqui o discurso da semana de ${this.formatSemanaAmigavel()}`;
  }
};

const M5_Factory = {
  mk(tag, cls, attrs = {}) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    for (let k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  },
  arr(open) {
    const a = this.mk('button', 'toggle-arrow', { type: 'button', contenteditable: 'false', tabindex: '-1', 'aria-expanded': open });
    a.innerHTML = '<span class="triangle"></span>';
    return a;
  },
  plus() {
    const p = this.mk('button', 'text-plus', { type: 'button', contenteditable: 'false', tabindex: '-1' });
    p.innerHTML = '<svg viewBox="0 0 16 16"><path d="M8 3v10M3 8h10"></path></svg>';
    return p;
  },
  para(txt = '') {
    const n = this.mk('div', 'node-paragraph', { 'data-level': '0' });
    const r = this.mk('div', 'row');
    const c = this.mk('div', 'paragraph-content editable', { 'data-placeholder': M4A_Placeholder.main() });
    c.textContent = txt;
    r.append(c);
    n.append(r);
    M3_TextModel.sync(c);
    return n;
  },
  text(txt = '', lvl = 1) {
    const n = this.mk('div', 'node-text', { 'data-level': lvl });
    const r = this.mk('div', 'row');
    const c = this.mk('div', 'text-content editable', { 'data-placeholder': 'Escreva ou aperte +' });
    const spacer = this.mk('div', 'toggle-spacer', { contenteditable: 'false' });
    c.textContent = txt;
    r.append(spacer, c, this.plus());
    n.append(r);
    M3_TextModel.sync(c);
    return n;
  },
  toggle(txt = '', lvl = 0, open = false) {
    const n = this.mk('div', 'node-toggle', { 'data-level': lvl });
    const r = this.mk('div', 'row');
    const t = this.mk('div', 'toggle-title editable', { 'data-placeholder': 'Toggle' });
    const c = this.mk('div', 'children');
    t.textContent = txt;
    r.append(this.arr(open), t);
    n.append(r, c);
    M6_Tree.setOpen(n, open, false);
    M3_TextModel.sync(t);
    return n;
  }
};

const M6_Tree = {
  ensureSeed(t) {
    const c = M2_Query.getChil(t);
    if (c && !M2_Query.childs(c).length) c.appendChild(M5_Factory.text('', M2_Query.getLvl(t) + 1));
  },
  setOpen(t, open, seed = true) {
    if (open && seed) this.ensureSeed(t);
    const a = M2_Query.getArr(t);
    const c = M2_Query.getChil(t);
    if (a) a.setAttribute('aria-expanded', open);
    if (c) c.hidden = !open;
    t.dataset.open = open;
    M11_Layout.schedule();
  },
  applyRichContent(el, tree) {
    if (!el) return;
    if (typeof tree?.html === 'string') el.innerHTML = tree.html;
    else el.textContent = tree?.text || '';
    M3_TextModel.sync(el);
  },
  toTree(n) {
    const readFontClass = node => {
      if (!node?.classList) return null;
      if (node.classList.contains('font-h1')) return 'font-h1';
      if (node.classList.contains('font-h2')) return 'font-h2';
      if (node.classList.contains('font-h3')) return 'font-h3';
      return null;
    };

    if (n.classList.contains('node-paragraph')) {
      const tree = {
        type: 'paragraph',
        text: M3_TextModel.read(M2_Query.getParC(n)),
        html: M3_TextModel.readHTML(M2_Query.getParC(n))
      };
      const fontClass = readFontClass(n);
      if (fontClass) tree.fontClass = fontClass;
      return tree;
    }

    if (n.classList.contains('node-text')) return { type: 'text', text: M3_TextModel.read(M2_Query.getTxtC(n)), html: M3_TextModel.readHTML(M2_Query.getTxtC(n)) };
    if (n.classList.contains('node-toggle')) {
      return {
        type: 'toggle',
        text: M3_TextModel.read(M2_Query.getTit(n)),
        html: M3_TextModel.readHTML(M2_Query.getTit(n)),
        open: n.dataset.open === 'true',
        children: M2_Query.childs(M2_Query.getChil(n)).map(ch => this.toTree(ch)).filter(Boolean)
      };
    }
    return null;
  },
  fromTree(tree, pLvl = null, forceCol = false) {
    if (!tree) return null;
    if (tree.type === 'paragraph') {
      const n = pLvl === null ? M5_Factory.para('') : M5_Factory.text('', pLvl + 1);
      const ed = pLvl === null ? M2_Query.getParC(n) : M2_Query.getTxtC(n);
      this.applyRichContent(ed, tree);
      if (pLvl === null && tree.fontClass && /^(font-h1|font-h2|font-h3)$/.test(tree.fontClass)) {
        n.classList.add(tree.fontClass);
      }
      return n;
    }
    if (tree.type === 'text') {
      const n = pLvl === null ? M5_Factory.para('') : M5_Factory.text('', pLvl + 1);
      const ed = pLvl === null ? M2_Query.getParC(n) : M2_Query.getTxtC(n);
      this.applyRichContent(ed, tree);
      return n;
    }

    const lvl = pLvl === null ? 0 : pLvl + 1;
    if (lvl > M1_Config.MAX_LVL) {
      const n = M5_Factory.text('', lvl);
      this.applyRichContent(M2_Query.getTxtC(n), tree);
      return n;
    }

    const isOpen = forceCol ? false : (tree.open || false);
    const n = M5_Factory.toggle('', lvl, isOpen);
    const title = M2_Query.getTit(n);
    const wrap = M2_Query.getChil(n);

    this.applyRichContent(title, tree);

    (tree.children ||[]).forEach(c => {
      const b = this.fromTree(c, lvl, forceCol);
      if (b) wrap.appendChild(b);
    });

    this.setOpen(n, isOpen, false);
    return n;
  }
};

const M7_Actions = {
  anim(n) {
    if (n) {
      n.classList.add('is-entering');
      requestAnimationFrame(() => requestAnimationFrame(() => n.classList.remove('is-entering')));
    }
  },
  shake(n) {
    const r = n.querySelector('.row');
    r.classList.remove('shake');
    void r.offsetWidth;
    r.classList.add('shake');
    setTimeout(() => r.classList.remove('shake'), 400);
  },
  insAfter(ref, n) {
    if (ref?.parentElement) ref.after(n);
    else M1_Config.editor.appendChild(n);
  },
  newRootToggle() {
    const cur = M2_Query.curNode();
    const n = M5_Factory.toggle();

    if (cur?.classList.contains('node-paragraph') && M3_TextModel.isEmpty(M2_Query.getParC(cur))) {
      cur.replaceWith(n);
    } else if (
      M1_Config.editor.children.length === 1 &&
      M1_Config.editor.firstElementChild?.classList.contains('node-paragraph') &&
      M3_TextModel.isEmpty(M2_Query.getParC(M1_Config.editor.firstElementChild))
    ) {
      M1_Config.editor.firstElementChild.replaceWith(n);
    } else {
      this.insAfter(M2_Query.topNode(), n);
    }

    this.anim(n);
    M3_TextModel.syncAll();
    M4_Caret.place(M2_Query.getTit(n));
  },
  txtToToggle(txtNode) {
    const lvl = M2_Query.getLvl(txtNode);
    if (lvl > M1_Config.MAX_LVL) return;

    const rawTxt = M3_TextModel.read(M2_Query.getTxtC(txtNode));
    const rawHTML = M3_TextModel.readHTML(M2_Query.getTxtC(txtNode));
    const filledLines = rawTxt.split(/\r?\n/).filter(l => l.trim().length > 0);

    if (filledLines.length >= 2) return this.shake(txtNode);

    const t = M5_Factory.toggle('', lvl, false);

    txtNode.replaceWith(t);

    const title = M2_Query.getTit(t);
    if (title) {
      title.innerHTML = filledLines.length === 1 ? rawHTML : '';
      M3_TextModel.sync(title);
    }
    t.classList.add('is-focused');
    M4_Caret.place(title, false);
    M3_TextModel.syncAll();
  },
  ensureRoot() {
    if (!M1_Config.editor.querySelector('.node-paragraph, .node-toggle')) {
      const p = M5_Factory.para();
      M1_Config.editor.appendChild(p);
      M3_TextModel.syncAll();
      M4_Caret.place(M2_Query.getParC(p));
    }
  }
};

const M8_MultiSel = {
  intersects(r, n) {
    if (r.intersectsNode) {
      try { return r.intersectsNode(n); } catch (e) {}
    }
    const nr = document.createRange();
    nr.selectNode(n);
    return !(r.compareBoundaryPoints(Range.END_TO_START, nr) <= 0 || r.compareBoundaryPoints(Range.START_TO_END, nr) >= 0);
  },
  getNodes() {
    const s = M2_Query.selObj();
    if (!s || !s.rangeCount || s.isCollapsed) return[];
    const r = s.getRangeAt(0);
    const u = Array.from(new Set(
      Array.from(M1_Config.editor.querySelectorAll('.row'))
        .filter(rw => this.intersects(r, rw))
        .map(rw => rw.closest('.node-toggle, .node-text, .node-paragraph'))
        .filter(Boolean)
    ));
    return u.filter(n => !u.some(o => o !== n && o.contains(n)));
  }
};

const M11_Layout = {
  lines: 5,
  raf: 0,
  lineHeight() {
    const sample = M1_Config.editor.querySelector('.toggle-title, .text-content, .paragraph-content');
    return parseFloat(getComputedStyle(sample || M1_Config.editor).lineHeight) || 23.2;
  },
  toolbarHeight() {
    return M1_Config.toolbar.getBoundingClientRect().height || 0;
  },
  adjustViewport() {
    const vv = window.visualViewport;
    if (!vv) return;
    
    // A MÁGICA: No iOS PWA, ao fechar o teclado, o visualViewport.height 
    // pode vir encurtado, causando o Navbar a flutuar num falso chão.
    // Comparamos com a tela inteira (innerHeight). Se for perto, o teclado
    // fechou, então damos "100%" pro Navbar colar no chão de verdade.
    const isKeyboardOpen = (window.innerHeight - vv.height) > 100;
    
    if (isKeyboardOpen) {
        document.body.style.height = vv.height + 'px';
    } else {
        document.body.style.height = '100%';
    }
    
    window.scrollTo(0, 0);
  },
  adjustPadding() {
    const respiro = this.lineHeight() * this.lines;
    M1_Config.editor.style.paddingBottom = (respiro + this.toolbarHeight()) + 'px';
  },
  ensureCaretVisible() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !M1_Config.editor.contains(sel.anchorNode)) return;
    const range = sel.getRangeAt(0).cloneRange();
    range.collapse(true);
    let rect = range.getClientRects()[0];
    if (!rect) {
      const ed = M2_Query.curEd();
      rect = ed?.getBoundingClientRect();
      if (!rect) return;
    }
    const toolbarTop = M1_Config.toolbar.getBoundingClientRect().top;
    const margin = 14;
    if (rect.bottom > toolbarTop - margin) {
      M1_Config.scroll.scrollTop += rect.bottom - (toolbarTop - margin);
    }
  },
  run() {
    this.adjustViewport();
    this.adjustPadding();
    this.ensureCaretVisible();
  },
  schedule(frames = 1) {
    cancelAnimationFrame(this.raf);
    const tick = (n) => {
      if (n <= 0) return this.run();
      this.raf = requestAnimationFrame(() => tick(n - 1));
    };
    tick(frames);
  }
};

const M10_EditorEvents = {
  setInternalClipboard(payload) {
    M1_Config.state.internalClipboard = payload ? { ...payload, at: Date.now() } : null;
  },
  getInternalClipboard(dt) {
    const clip = M1_Config.state.internalClipboard;
    if (!clip) return null;
    if (Date.now() - (clip.at || 0) > 10 * 60 * 1000) return null;

    const plain = dt?.getData?.('text/plain') || '';
    const html = dt?.getData?.('text/html') || '';
    const custom = dt?.getData?.(M1_Config.MIME) || '';

    if (!plain && !html && !custom) return clip;
    if (custom && clip.kind === 'tree') return clip;
    if (html && clip.html && html.trim() === clip.html.trim()) return clip;
    if (plain && clip.plain && plain === clip.plain) return clip;

    return null;
  },
  selectionHTML(range) {
    if (!range) return '';
    const wrap = document.createElement('div');
    wrap.appendChild(range.cloneContents());
    return wrap.innerHTML;
  },
  setClipboardTreeData(dt, trs) {
    if (!trs?.length) return false;
    const exportRoot = document.createElement('div');
    exportRoot.setAttribute('data-toggle-export', '1');
    trs.forEach(t => {
      const b = M6_Tree.fromTree(t, null, false);
      if (b) exportRoot.appendChild(b);
    });

    const payload = {
      kind: 'tree',
      trs: JSON.parse(JSON.stringify(trs)),
      plain: trs.map(t => t.text || '').join('\n'),
      html: exportRoot.outerHTML
    };

    this.setInternalClipboard(payload);

    if (!dt) return true;
    dt.setData(M1_Config.MIME, JSON.stringify(trs));
    dt.setData('text/plain', payload.plain);
    dt.setData('text/html', payload.html);
    return true;
  },
  setClipboardFragmentData(dt, range) {
    if (!range || range.collapsed) return false;

    const html = this.selectionHTML(range).trim();
    const plain = range.toString();
    if (!html && !plain) return false;

    this.setInternalClipboard({ kind: 'html', html, plain });

    if (!dt) return true;
    if (plain) dt.setData('text/plain', plain);
    if (html) dt.setData('text/html', html);
    return true;
  },
  removeSelectedNodes(ns) {
    if (!ns?.length) return;
    const first = ns[0];
    const prev = first.previousElementSibling;
    const next = ns[ns.length - 1].nextElementSibling;

    ns.forEach(n => n.remove());

    M7_Actions.ensureRoot();
    M3_TextModel.syncAll();

    const target = next || prev || M1_Config.editor.querySelector('.node-toggle, .node-text, .node-paragraph');
    const ed = M2_Query.getEdFor(target);
    if (ed) M4_Caret.place(ed, !next);
  },
  sanitizeClipboardHTML(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script, style, meta, link').forEach(n => n.remove());
    return doc.body?.innerHTML || '';
  },
  selectionIsStructural(range) {
    const s = M2_Query.closest(range.startContainer, '.editable');
    const e = M2_Query.closest(range.endContainer, '.editable');
    if (s && e && s !== e) return true;
    if (s && e && s === e) return false;
    return M8_MultiSel.getNodes().length > 1;
  },
  treesFromSelection() {
    const ns = M8_MultiSel.getNodes();
    if (!ns.length) return null;
    const trs = ns.map(n => M6_Tree.toTree(n)).filter(Boolean);
    return trs.length ? trs : null;
  },
  fullyCoveredTopNodes(range) {
    const within = n => {
      const nr = document.createRange();
      nr.selectNode(n);
      return range.compareBoundaryPoints(Range.START_TO_START, nr) <= 0
          && range.compareBoundaryPoints(Range.END_TO_END, nr) >= 0;
    };
    const all = Array.from(M1_Config.editor.querySelectorAll('.node-toggle, .node-text, .node-paragraph')).filter(within);
    return all.filter(n => !all.some(o => o !== n && o.contains(n)));
  },
  reseedOpenToggles() {
    M1_Config.editor.querySelectorAll('.node-toggle').forEach(t => {
      const ch = M2_Query.getChil(t);
      if (t.dataset.open === 'true' && ch && !M2_Query.childs(ch).length) {
        ch.appendChild(M5_Factory.text('', M2_Query.getLvl(t) + 1));
      }
    });
  },
  flattenDeleteSelection() {
    const sel = M2_Query.selObj();
    if (!sel || !sel.rangeCount || sel.isCollapsed) return false;
    const range = sel.getRangeAt(0);
    if (!M1_Config.editor.contains(range.commonAncestorContainer)) return false;

    const startEd = M2_Query.closest(range.startContainer, '.editable');
    const endEd = M2_Query.closest(range.endContainer, '.editable');
    if (!startEd || !endEd) return false;

    if (startEd === endEd) {
      range.deleteContents();
      M3_TextModel.sync(startEd);
      const c = range.cloneRange();
      c.collapse(true);
      sel.removeAllRanges();
      sel.addRange(c);
      M3_TextModel.syncAll();
      M4_Caret.saveR();
      M4_Caret.updateFocus();
      M11_Layout.schedule(2);
      return true;
    }

    const startNode = startEd.closest('.node-toggle, .node-text, .node-paragraph');
    const endNode = endEd.closest('.node-toggle, .node-text, .node-paragraph');
    const fully = this.fullyCoveredTopNodes(range);
    const startWasFull = fully.includes(startNode);

    const rStart = document.createRange();
    rStart.setStart(range.startContainer, range.startOffset);
    rStart.setEnd(startEd, startEd.childNodes.length);
    rStart.deleteContents();

    const rEnd = document.createRange();
    rEnd.setStart(endEd, 0);
    rEnd.setEnd(range.endContainer, range.endOffset);
    rEnd.deleteContents();

    let removeEnd = !!(endNode && endNode !== startNode && !endNode.contains(startEd));
    if (removeEnd && endNode.classList.contains('node-toggle')) {
      const kids = M2_Query.childs(M2_Query.getChil(endNode));
      const survives = kids.some(k => !fully.includes(k) && !fully.some(f => f.contains(k)));
      if (survives) removeEnd = false;
    }

    const joinContainer = startEd;
    const joinOffset = startEd.childNodes.length;
    if (removeEnd) {
      const tail = document.createRange();
      tail.selectNodeContents(endEd);
      startEd.appendChild(tail.extractContents());
    }

    fully.forEach(n => { if (n !== startNode && !n.contains(startEd)) n.remove(); });
    if (removeEnd) endNode.remove();

    let caretEd = startEd;
    let useJoin = true;
    if (startWasFull && M3_TextModel.isEmpty(startEd)) {
      const prev = startNode.previousElementSibling;
      startNode.remove();
      caretEd = prev ? M2_Query.getEdFor(prev) : null;
      useJoin = false;
    }

    this.reseedOpenToggles();
    M7_Actions.ensureRoot();
    M3_TextModel.syncAll();

    if (useJoin && caretEd) {
      try { M1_Config.editor.focus({ preventScroll: true }); } catch (err) { M1_Config.editor.focus(); }
      const cr = document.createRange();
      const off = Math.min(joinOffset, joinContainer.childNodes.length);
      cr.setStart(joinContainer, off);
      cr.collapse(true);
      sel.removeAllRanges();
      sel.addRange(cr);
      M4_Caret.saveR();
      M4_Caret.updateFocus();
      M11_Layout.schedule(2);
    } else {
      const target = caretEd || M1_Config.editor.querySelector('.editable');
      if (target) M4_Caret.place(target, false);
    }
    return true;
  },
  bind() {
    
    document.addEventListener('touchmove', (e) => {
      const isAllowedArea = e.target.closest(
        '.editor-scroll, .picker-overlay, .leitor-container, .bbl-container,[id*="bbl"], [class*="modal"],[class*="sheet"],[class*="overlay"]'
      );
      if (!isAllowedArea) {
        e.preventDefault();
      }
    }, { passive: false });

    let selectionRaf = 0;
    const handleSelectionChange = () => {
      if (selectionRaf) return;
      selectionRaf = requestAnimationFrame(() => {
        selectionRaf = 0;
        M4_Caret.saveR();
        M4_Caret.updateFocus();
        M11_Layout.schedule(PERF_LOW ? 1 : undefined);
      });
    };

    document.addEventListener('selectionchange', handleSelectionChange);

    M1_Config.editor.addEventListener('focus', () => {
      M4_Caret.zombieToolbar = false; 
      M4_Caret.clearFocusSuppression();
      M4_Caret.updateFocus();
    });

    M1_Config.editor.addEventListener('pointerdown', () => {
      M4_Caret.zombieToolbar = false; 
      M4_Caret.clearFocusSuppression();
      M4_Caret.updateFocus();
    }, true);

    M1_Config.editor.addEventListener('blur', () => {
      setTimeout(() => M4_Caret.updateFocus(), 100);
    });

    let hadBibleToolbarLock = document.body.classList.contains('leitor-keep-toolbar');
    const bodyClassObserver = new MutationObserver(() => {
      const hasBibleToolbarLock = document.body.classList.contains('leitor-keep-toolbar');
      
      if (hadBibleToolbarLock && !hasBibleToolbarLock) {
        M4_Caret.zombieToolbar = true;
        try { document.activeElement?.blur?.(); } catch(e) {}
        window.getSelection()?.removeAllRanges();
        M4_Caret.updateFocus(true);
      }
      
      hadBibleToolbarLock = hasBibleToolbarLock;
    });
    bodyClassObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });

    const TAP_SLOP = 12;
    let scrollTap = null;
    let suppressScrollClickUntil = 0;

    const resolveTapIntent = target => {
      if (!target) return { kind: 'none' };

      const arr = target.closest?.('.toggle-arrow');
      if (arr) return { kind: 'toggle', node: arr.closest('.node-toggle'), arrow: arr };

      const plus = target.closest?.('.text-plus');
      if (plus) return { kind: 'plus', node: plus.closest('.node-text') };

      if (target.closest?.('.editable')) return { kind: 'native' };

      const row = target.closest?.('.row');
      if (row) return { kind: 'row', editable: row.querySelector('.editable') };

      if (
        target === M1_Config.editor ||
        target === M1_Config.scroll ||
        target.closest?.('.page') ||
        target.closest?.('#editor')
      ) {
        return { kind: 'blank' };
      }

      return { kind: 'none' };
    };

    const handleTapIntent = target => {
      const intent = resolveTapIntent(target);

      if (intent.kind === 'blank') {
        const v = M2_Query.visibles();
        if (v.length) M4_Caret.place(v[v.length - 1], false);
        else M7_Actions.ensureRoot();
        return true;
      }

      if (intent.kind === 'toggle') {
        M6_Tree.setOpen(intent.node, intent.arrow.getAttribute('aria-expanded') !== 'true');
        M3_TextModel.syncAll();
        return true;
      }

      if (intent.kind === 'plus') {
        M7_Actions.txtToToggle(intent.node);
        return true;
      }

      if (intent.kind === 'row') {
        M4_Caret.place(intent.editable, false);
        return true;
      }

      return false;
    };

    M1_Config.editor.addEventListener('pointerdown', e => {
      if (e.target.closest('.toggle-arrow, .text-plus')) e.preventDefault();
    });

    M1_Config.scroll.addEventListener('touchstart', e => {
      const t = e.changedTouches?.[0];
      if (!t) return;
      scrollTap = {
        id: t.identifier,
        x: t.clientX,
        y: t.clientY,
        moved: false,
        target: e.target
      };
    }, { passive: true });

    M1_Config.scroll.addEventListener('touchmove', e => {
      if (!scrollTap) return;
      const t = Array.from(e.changedTouches).find(t => t.identifier === scrollTap.id);
      if (!t) return;
      if (Math.hypot(t.clientX - scrollTap.x, t.clientY - scrollTap.y) > TAP_SLOP) {
        scrollTap.moved = true;
      }
    }, { passive: true });

    M1_Config.scroll.addEventListener('touchend', e => {
      if (!scrollTap) return;
      const t = Array.from(e.changedTouches).find(t => t.identifier === scrollTap.id);
      if (!t) return;

      const moved = scrollTap.moved;
      const target = document.elementFromPoint(t.clientX, t.clientY) || scrollTap.target;
      scrollTap = null;

      if (moved) return;

      const intent = resolveTapIntent(target);
      if (intent.kind === 'native') return;

      if (handleTapIntent(target)) {
        suppressScrollClickUntil = Date.now() + 400;
        e.preventDefault();
      }
    }, { passive: false });

    M1_Config.scroll.addEventListener('touchcancel', () => {
      scrollTap = null;
    }, { passive: true });

    M1_Config.scroll.addEventListener('click', e => {
      if (Date.now() < suppressScrollClickUntil) {
        e.preventDefault();
        return;
      }

      const intent = resolveTapIntent(e.target);
      if (intent.kind === 'native') return;

      if (handleTapIntent(e.target)) {
        e.preventDefault();
      }
    });

    M1_Config.editor.addEventListener('beforeinput', e => {
      const s = M2_Query.selObj();
      const ed = M2_Query.curEd();
      if (!s) return;

      if (!s.isCollapsed && (e.inputType.includes('delete') || e.inputType.startsWith('insert'))) {
        const ns = M8_MultiSel.getNodes();
        if (ns.length > 1) { 
          e.preventDefault();
          const r = s.getRangeAt(0);
          const sEd = M2_Query.closest(r.startContainer, '.editable') || M2_Query.getEdFor(ns[0]);
          const eEd = M2_Query.closest(r.endContainer, '.editable') || M2_Query.getEdFor(ns[ns.length - 1]);
          let st = '', et = '';

          if (sEd && sEd.contains(r.startContainer)) {
            const rs = document.createRange();
            rs.setStart(sEd, 0);
            rs.setEnd(r.startContainer, r.startOffset);
            st = rs.toString();
          }

          if (eEd && eEd.contains(r.endContainer)) {
            const re = document.createRange();
            re.setStart(r.endContainer, r.endOffset);
            re.setEnd(eEd, eEd.childNodes.length);
            et = re.toString();
          }

          const tEd = M2_Query.getEdFor(ns[0]);
          if (tEd) tEd.textContent = st + et;
          ns.slice(1).forEach(n => n.remove());

          if (tEd) {
            const nr = document.createRange();
            if (tEd.firstChild?.nodeType === 3) nr.setStart(tEd.firstChild, Math.min(st.length, tEd.firstChild.length));
            else nr.setStart(tEd, 0);
            nr.collapse(true);
            s.removeAllRanges();
            s.addRange(nr);
          }

          let d = e.data;
          if (e.inputType === 'insertFromPaste' && e.dataTransfer) d = e.dataTransfer.getData('text/plain');
          if (d && e.inputType.startsWith('insert')) document.execCommand('insertText', false, d);

          M3_TextModel.syncAll();
          return;
        }
      }

      if (!ed) return;

      const rNow = M2_Query.curRange();
      const insideListItem = !!M2_Query.closest(rNow?.startContainer, 'li');

      if (e.inputType === 'insertParagraph' && insideListItem) {
        return;
      }

      if (e.inputType === 'insertParagraph') {
        const curNode = M2_Query.curNode();

        const sourceIsHeadingParagraph = !!(
          ed.classList.contains('paragraph-content') &&
          curNode?.classList.contains('node-paragraph') &&
          (curNode.classList.contains('font-h1') || curNode.classList.contains('font-h2') || curNode.classList.contains('font-h3'))
        );

        const sourceIsToggleContext =
          ed.classList.contains('toggle-title') ||
          ed.classList.contains('text-content');

        const shouldResetForFreshParagraph = targetEditable => !!(
          targetEditable &&
          ((targetEditable.classList.contains('paragraph-content') &&
            (sourceIsHeadingParagraph || sourceIsToggleContext)) ||
           targetEditable.classList.contains('toggle-title'))
        );

        const safeQueryState = cmd => {
          try { return !!document.queryCommandState(cmd); } catch (_) { return false; }
        };

        const defaultTextColor = () => {
          const cssVar = getComputedStyle(document.documentElement).getPropertyValue('--text-color').trim();
          if (cssVar) return cssVar;
          const editorColor = getComputedStyle(M1_Config.editor).color;
          return editorColor && editorColor !== 'rgba(0, 0, 0, 0)' ? editorColor : '#37352f';
        };

        const clearInlineCarryover = editable => {
          if (!editable) return;
          editable.querySelectorAll('[style]').forEach(n => {
            n.style.removeProperty('color');
            n.style.removeProperty('background-color');
            n.style.removeProperty('font-weight');
            n.style.removeProperty('font-style');
            n.style.removeProperty('text-decoration');
            const styleAttr = n.getAttribute('style');
            if (!styleAttr || !styleAttr.trim()) n.removeAttribute('style');
          });
        };

        const formatState = {
          b: safeQueryState('bold'),
          i: safeQueryState('italic'),
          u: safeQueryState('underline'),
          fore: document.queryCommandValue('foreColor'),
          back: document.queryCommandValue('hiliteColor') || document.queryCommandValue('backColor')
        };

        const restoreFormat = targetEditable => {
          if (shouldResetForFreshParagraph(targetEditable)) return;
          if (safeQueryState('bold')) document.execCommand('bold', false, null);
          if (safeQueryState('italic')) document.execCommand('italic', false, null);
          if (formatState.u) document.execCommand('underline', false, null);
          if (formatState.fore && formatState.fore !== 'transparent' && formatState.fore !== 'rgba(0, 0, 0, 0)') {
            document.execCommand('foreColor', false, formatState.fore);
          }
          if (formatState.back && formatState.back !== 'transparent' && formatState.back !== 'rgba(0, 0, 0, 0)') {
            if (!document.execCommand('hiliteColor', false, formatState.back)) {
              document.execCommand('backColor', false, formatState.back);
            }
          }
          window.M13_Negrita?.clearTypingState?.();
          requestAnimationFrame(() => window.M13_Negrita?.syncButtons?.());
        };

        const resetFormatForFreshParagraph = targetEditable => {
          if (!shouldResetForFreshParagraph(targetEditable)) return;

          try { targetEditable.focus({ preventScroll: true }); } catch (_) { targetEditable.focus(); }

          if (safeQueryState('bold')) document.execCommand('bold', false, null);
          if (safeQueryState('italic')) document.execCommand('italic', false, null);
          if (safeQueryState('underline')) document.execCommand('underline', false, null);

          document.execCommand('foreColor', false, defaultTextColor());
          if (!document.execCommand('hiliteColor', false, 'transparent')) {
            document.execCommand('backColor', false, 'transparent');
          }

          // Reset future typing without stripping formatting from text moved
          // after the caret into this new block.
          if (M3_TextModel.isEmpty(targetEditable)) clearInlineCarryover(targetEditable);
          window.M13_Negrita?.clearTypingState?.();
          requestAnimationFrame(() => window.M13_Negrita?.syncButtons?.());
        };

        const finalizeParagraphTransition = targetEditable => {
          if (shouldResetForFreshParagraph(targetEditable)) {
            resetFormatForFreshParagraph(targetEditable);
          } else {
            restoreFormat(targetEditable);
          }
          M11_Layout.run();
        };

        if (ed.classList.contains('toggle-title')) {
          e.preventDefault();
          const t = ed.closest('.node-toggle');

          if (M3_TextModel.isEmpty(ed)) {
            const root = M2_Query.rootNode(t);
            const lvl = M2_Query.getLvl(t);
            const p = M5_Factory.para();

            if (lvl > 1 && root && root !== t) {
              t.remove();
              M7_Actions.insAfter(root, p);
            } else if (t !== root && root) {
              t.remove();
              M7_Actions.insAfter(root, p);
            } else {
              t.replaceWith(p);
            }

            M7_Actions.anim(p);
            M3_TextModel.syncAll();
            const targetEditable = M2_Query.getParC(p);
            M4_Caret.place(targetEditable);
            finalizeParagraphTransition(targetEditable);
          } else {
            const range = M2_Query.curRange();
            let tail = null;
            if (range && ed.contains(range.startContainer)) {
              if (!range.collapsed && ed.contains(range.endContainer)) range.deleteContents();
              const rest = document.createRange();
              rest.setStart(range.startContainer, range.startOffset);
              rest.setEnd(ed, ed.childNodes.length);
              tail = rest.extractContents();
            }
            const n = M5_Factory.toggle('', M2_Query.getLvl(t));
            M7_Actions.insAfter(t, n);
            M7_Actions.anim(n);
            const targetEditable = M2_Query.getTit(n);
            if (tail) targetEditable.replaceChildren(tail);
            M3_TextModel.syncAll();
            M4_Caret.place(targetEditable, true);
            finalizeParagraphTransition(targetEditable);
          }
        } else if (ed.classList.contains('text-content') || ed.classList.contains('paragraph-content')) {
          if (M3_TextModel.isEmpty(ed)) {
            e.preventDefault();
            const cur = M2_Query.curNode();

            if (ed.classList.contains('text-content')) {
              const top = M2_Query.topNode();
              const nx = top?.nextElementSibling;
              if (nx) {
                const targetEditable = M2_Query.getEdFor(nx);
                M4_Caret.place(targetEditable, false);
                finalizeParagraphTransition(targetEditable);
              } else {
                const p = M5_Factory.para();
                M7_Actions.insAfter(top, p);
                M7_Actions.anim(p);
                M3_TextModel.syncAll();
                const targetEditable = M2_Query.getParC(p);
                M4_Caret.place(targetEditable, false);
                finalizeParagraphTransition(targetEditable);
              }
            } else {
              const p = M5_Factory.para();
              M7_Actions.insAfter(cur, p);
              M7_Actions.anim(p);
              M3_TextModel.syncAll();
              const targetEditable = M2_Query.getParC(p);
              M4_Caret.place(targetEditable, false);
              finalizeParagraphTransition(targetEditable);
            }
          } else {
            e.preventDefault();

            if (ed.classList.contains('text-content')) {
              document.execCommand('insertLineBreak');
              M3_TextModel.syncAll();
              M11_Layout.run();
            } else {
              const cur = M2_Query.curNode();
              const range = M2_Query.curRange();
              let tail = null;
              if (range && ed.contains(range.startContainer)) {
                if (!range.collapsed && ed.contains(range.endContainer)) range.deleteContents();
                const rest = document.createRange();
                rest.setStart(range.startContainer, range.startOffset);
                rest.setEnd(ed, ed.childNodes.length);
                tail = rest.extractContents();
              }
              const p = M5_Factory.para();
              M7_Actions.insAfter(cur, p);
              M7_Actions.anim(p);
              const targetEditable = M2_Query.getParC(p);
              if (tail) targetEditable.replaceChildren(tail);
              M3_TextModel.syncAll();
              M4_Caret.place(targetEditable, true);
              finalizeParagraphTransition(targetEditable);
            }
          }
        }
      }

      if (e.inputType === 'deleteContentBackward' && s.isCollapsed && M3_TextModel.isEmpty(ed)) {
        const n = M2_Query.curNode();

        if (ed.classList.contains('toggle-title')) {
          e.preventDefault();
          const lvl = M2_Query.getLvl(n);
          const prevNode = M2_Query.getPrev(n);

          if (lvl > 0 && prevNode && prevNode.classList.contains('node-text')) {
            const fb = M2_Query.prevVis(ed);
            n.remove();
            M3_TextModel.syncAll();
            if (fb) M4_Caret.place(fb, false);
          } else {
            const rep = lvl > 0 ? M5_Factory.text('', lvl) : M5_Factory.para();
            n.replaceWith(rep);
            M3_TextModel.syncAll();
            M4_Caret.place(M2_Query.getEdFor(rep));
          }
        } else if (ed.classList.contains('text-content')) {
          e.preventDefault();
          const parentToggle = n.parentElement.closest('.node-toggle');
          if (parentToggle) {
            M4_Caret.place(M2_Query.getTit(parentToggle), false);
          } else {
            const fb = M2_Query.prevVis(ed);
            if (fb) M4_Caret.place(fb, false);
          }
        } else if (ed.classList.contains('paragraph-content')) {
          if (M1_Config.editor.children.length > 1) {
            e.preventDefault();
            const fb = M2_Query.prevVis(ed);
            n.remove();
            M3_TextModel.syncAll();
            if (fb) M4_Caret.place(fb, false);
          }
        }
      }
    });

    M1_Config.editor.addEventListener('input', e => {
      if (!M1_Config.editor.children.length) M7_Actions.ensureRoot();

      const editable = e.target?.closest?.('.editable') || M2_Query.curEd();
      if (editable) {
        M3_TextModel.sync(editable);
        const textNode = editable.closest?.('.node-text');
        if (textNode) {
          const plusBtn = M2_Query.getTxtP(textNode);
          if (plusBtn) plusBtn.disabled = M2_Query.getLvl(textNode) > M1_Config.MAX_LVL;
        }
      } else {
        M3_TextModel.syncAll();
        return;
      }

      M4_Caret.updateFocus();
      M11_Layout.schedule(PERF_LOW ? 1 : undefined);
    });

    M1_Config.editor.addEventListener('copy', e => {
      const sel = M2_Query.selObj();
      if (!sel || !sel.rangeCount || sel.isCollapsed) return;

      const range = sel.getRangeAt(0);
      if (!M1_Config.editor.contains(range.commonAncestorContainer)) return;

      if (this.selectionIsStructural(range)) {
        const trs = this.treesFromSelection();
        if (trs) {
          e.preventDefault();
          this.setClipboardTreeData(e.clipboardData, trs);
          return;
        }
      }

      this.setClipboardFragmentData(e.clipboardData, range);
    });

    M1_Config.editor.addEventListener('cut', e => {
      const sel = M2_Query.selObj();
      if (!sel || !sel.rangeCount || sel.isCollapsed) return;

      const range = sel.getRangeAt(0);
      if (!M1_Config.editor.contains(range.commonAncestorContainer)) return;

      e.preventDefault();
      window.M12_History?.beforeChange?.();

      if (this.selectionIsStructural(range)) {
        const trs = this.treesFromSelection();
        if (trs) this.setClipboardTreeData(e.clipboardData, trs);
        else this.setClipboardFragmentData(e.clipboardData, range);
      } else {
        this.setClipboardFragmentData(e.clipboardData, range);
      }

      this.flattenDeleteSelection();
      window.M12_History?.afterChange?.(2);
    });

    M1_Config.editor.addEventListener('paste', e => {
      const dt = e.clipboardData;
      if (!dt) return;

      const internalClip = this.getInternalClipboard(dt);
      let trs = null;

      try { trs = JSON.parse(dt.getData(M1_Config.MIME)); } catch (err) {}

      if ((!trs || !trs.length) && internalClip?.kind === 'tree') {
        trs = JSON.parse(JSON.stringify(internalClip.trs ||[]));
      }

      if (!trs || !trs.length) {
        let html = dt.getData('text/html');

        if ((!html || !html.trim()) && internalClip?.kind === 'html') {
          html = internalClip.html || '';
        }

        if ((!html || !html.trim()) && internalClip?.kind === 'tree') {
          html = internalClip.html || '';
        }

        if (html) {
          const doc = new DOMParser().parseFromString(html, 'text/html');
          const r = doc.querySelector('[data-toggle-export]');
          if (r) trs = Array.from(r.children).map(n => M6_Tree.toTree(n)).filter(Boolean);
          else {
            const cleanHTML = this.sanitizeClipboardHTML(html).trim();
            if (cleanHTML) {
              e.preventDefault();
              document.execCommand('insertHTML', false, cleanHTML);
              M3_TextModel.syncAll();
              return;
            }
          }
        }
      }

      if (trs && trs.length) {
        e.preventDefault();
        const cur = M2_Query.curNode();
        const ed = M2_Query.curEd();
        const isEmptyLine = ed && M3_TextModel.isEmpty(ed);
        let cont = M1_Config.editor;
        let ref = cur;
        let pLvl = null;

        if (cur) {
          cont = cur.parentElement;
          pLvl = cont === M1_Config.editor ? null : M2_Query.getLvl(cont.closest('.node-toggle'));
        }

        const created = trs.map((t, i) => {
          const b = M6_Tree.fromTree(t, pLvl, false);
          if (b) {
            if (isEmptyLine && i === 0 && cur) {
              cur.replaceWith(b);
              ref = b;
            } else {
              if (ref) ref.after(b);
              else cont.appendChild(b);
              ref = b;
            }
            return b;
          }
          return null;
        }).filter(Boolean);

        M3_TextModel.syncAll();
        if (created.length) M4_Caret.place(M2_Query.getEdFor(created[created.length - 1]), false);
      } else {
        let plain = dt.getData('text/plain');

        if ((!plain || !plain.length) && internalClip?.plain) {
          plain = internalClip.plain;
        }

        if (plain) {
          e.preventDefault();
          const lines = plain.split(/\r?\n/);

          if (lines.length > 1) {
            let ref = M2_Query.curNode();
            let cont = ref ? ref.parentElement : M1_Config.editor;
            let pLvl = cont === M1_Config.editor ? null : M2_Query.getLvl(cont.closest('.node-toggle'));

            lines.forEach((l, i) => {
              if (i === 0) {
                document.execCommand('insertText', false, l);
              } else {
                const newNode = pLvl === null ? M5_Factory.para(l) : M5_Factory.text(l, pLvl + 1);
                if (ref) ref.after(newNode);
                else cont.appendChild(newNode);
                ref = newNode;
              }
            });
          } else {
            document.execCommand('insertText', false, plain);
          }

          M3_TextModel.syncAll();
        }
      }
    });

    window.addEventListener('resize', () => M11_Layout.schedule(), { passive: true });

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => M11_Layout.schedule(2), { passive: true });
      window.visualViewport.addEventListener('scroll', () => M11_Layout.schedule(2), { passive: true });
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  M1_Config.editor.appendChild(M5_Factory.para());
  M3_TextModel.syncAll();
  
  M10_EditorEvents.bind();
  M11_Layout.run();
  
  M4_Caret.updateFocus();
});
