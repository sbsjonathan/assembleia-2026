(function () {
  let editorRef = null;
  let leaving = false;
  let saveTimer = null;
  let saveFailed = false;

  function isPerfLow() {
    return !!(window.EditorPerfProfile?.isLow?.() || document.documentElement.classList.contains('perf-low'));
  }

  // ── COR GLOBAL + CONTRASTE ──────────────────────────────────────────────
  function applyCorGlobal() {
    const params = new URLSearchParams(location.search);
    const cor = (params.get('cor') || '').trim();
    if (!cor) return;

    document.documentElement.style.setProperty('--cor-global', cor);

    // Converte a cor para RGB via canvas (aceita hex, rgb, hsl, named colors...)
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillStyle = cor;
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;

    // Luminância relativa WCAG 2.1
    function linearize(c) {
      const s = c / 255;
      return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    }
    const L = 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);

    // Qual contraste é maior — texto branco ou texto preto?
    const contrasteComBranco = 1.05 / (L + 0.05);
    const contrasteComPreto  = (L + 0.05) / 0.05;

    const textoClaro  = '#ffffff';
    const textoEscuro = '#1a1a1a';
    const texto = contrasteComBranco >= contrasteComPreto ? textoClaro : textoEscuro;

    // Opacidade para elementos secundários (kicker, status)
    const textoParcial = texto === textoClaro
      ? 'rgba(255,255,255,0.55)'
      : 'rgba(0,0,0,0.42)';

    const backBg = texto === textoClaro
      ? 'rgba(255,255,255,0.14)'
      : 'rgba(0,0,0,0.10)';

    document.documentElement.style.setProperty('--fullsc-topbar-text', texto);
    document.documentElement.style.setProperty('--fullsc-topbar-text-muted', textoParcial);
    document.documentElement.style.setProperty('--fullsc-back-bg', backBg);
  }

  applyCorGlobal();
  // ────────────────────────────────────────────────────────────────────────

  function qs(name) {
    return new URLSearchParams(location.search).get(name) || '';
  }

  function decode(value) {
    try {
      return decodeURIComponent(value);
    } catch {
      return value || '';
    }
  }

  function getStorageKey() {
    return qs('id') || 'asmb-fullsc-temp';
  }

  function stripTrailingScriptureRefs(title) {
    const raw = String(title || '').trim();
    if (!raw) return raw;

    const match = raw.match(/\s*\(([^()]*)\)\s*$/);
    if (!match) return raw;

    const refs = (match[1] || '').trim();
    const looksLikeBibleRefs =
      /\d/.test(refs) &&
      /[:;,-–—]/.test(refs) &&
      /[A-Za-zÀ-ÿ]/.test(refs);

    if (!looksLikeBibleRefs) return raw;
    return raw.slice(0, match.index).trim();
  }

  function titleFromId(id) {
    return String(id || '')
      .replace(/^asmb-/, '')
      .replace(/-/g, ' ')
      .trim() || 'Anotação';
  }

  function getAgent() {
    return window.AssembleiaIA || null;
  }

  function waitForEditor() {
    return new Promise((resolve) => {
      const check = () => {
        const editor = document.getElementById('editor');
        const ready = editor && typeof M6_Tree !== 'undefined' && typeof M5_Factory !== 'undefined' && typeof M3_TextModel !== 'undefined';
        if (ready) resolve(editor);
        else setTimeout(check, 80);
      };
      check();
    });
  }

  function looksLikeV23Markup(html) {
    return /class\s*=\s*["'][^"']*(node-paragraph|node-toggle|node-text)/i.test(html || '');
  }

  function ensureRoot(editor) {
    if (!editor) return;
    if (editor.children.length) return;
    const bloco = typeof M5_Factory !== 'undefined' ? M5_Factory.para('') : null;
    if (bloco) editor.appendChild(bloco);
    if (typeof M3_TextModel !== 'undefined') M3_TextModel.syncAll();
    if (typeof M11_Layout !== 'undefined') M11_Layout.schedule(2);
  }

  function applyHTML(editor, html) {
    const trimmed = (html || '').trim();
    editor.innerHTML = '';
    if (!trimmed) {
      ensureRoot(editor);
      return;
    }

    if (looksLikeV23Markup(trimmed)) {
      editor.innerHTML = trimmed;
    } else if (typeof M5_Factory !== 'undefined' && typeof M2_Query !== 'undefined') {
      const bloco = M5_Factory.para('');
      const editable = M2_Query.getParC(bloco);
      if (editable) editable.innerHTML = trimmed;
      editor.appendChild(bloco);
    } else {
      editor.innerHTML = trimmed;
    }

    ensureRoot(editor);
    if (typeof M3_TextModel !== 'undefined') M3_TextModel.syncAll();
    if (typeof M11_Layout !== 'undefined') M11_Layout.schedule(2);
  }

  function exportHTML(editor) {
    return editor ? editor.innerHTML : '';
  }

  function showSaveError(error) {
    saveFailed = true;
    const status = document.getElementById('fullscStatus');
    if (status) {
      status.hidden = false;
      status.textContent = 'Não foi possível salvar neste aparelho. Mantenha esta anotação aberta e copie o texto.';
      status.setAttribute('role', 'alert');
    }
  }

  function clearSaveError() {
    if (!saveFailed) return;
    saveFailed = false;
    const status = document.getElementById('fullscStatus');
    if (status) { status.hidden = true; status.textContent = ''; status.removeAttribute('role'); }
  }

  function saveDraft() {
    clearTimeout(saveTimer);
    if (!editorRef || leaving) return true;
    try {
      const result = getAgent()?.saveFullDraft?.(getStorageKey(), exportHTML(editorRef));
      if (!result) throw new Error('Gravação indisponível');
      clearSaveError();
      return true;
    } catch (error) { showSaveError(error); return false; }
  }

  function goBack() {
    const project = new URL('../../../', location.href);
    let target = new URL('index.html', project);
    try {
      const candidate = new URL(qs('from'), location.href);
      if (qs('from') && candidate.origin === project.origin && candidate.pathname.startsWith(project.pathname)) target = candidate;
    } catch (_) {}
    let fromApp = false;
    try { const referrer = new URL(document.referrer); fromApp = referrer.origin === project.origin && referrer.pathname.startsWith(project.pathname); } catch (_) {}
    if (history.length > 1 && fromApp) history.back();
    else location.href = target.href;
  }

  function prepareExit() {
    if (leaving || !editorRef) return true;
    clearTimeout(saveTimer);
    const agent = getAgent();
    try {
      // Persist the job before navigation; the programme runs it after return.
      // This also covers the iPhone Back gesture and browser history buttons.
      const result = agent?.queueSummaryFromFull
        ? agent.queueSummaryFromFull(getStorageKey(), exportHTML(editorRef))
        : agent?.saveFullDraft?.(getStorageKey(), exportHTML(editorRef));
      if (!result) throw new Error('Gravação indisponível');
      try {
        sessionStorage.setItem('assembleia-fullsc-return', JSON.stringify({
          id: getStorageKey(), from: qs('from'), at: Date.now()
        }));
      } catch (_) { /* The saved note is independent of optional return position. */ }
      clearSaveError();
      return true;
    } catch (error) { showSaveError(error); return false; }
  }

  function queueSummaryAndLeave() {
    if (leaving || !editorRef || !prepareExit()) return;
    leaving = true;
    goBack();
  }

  function setupBack() {
    const btn = document.getElementById('fullscBack');
    if (!btn) return;
    btn.addEventListener('click', () => {
      queueSummaryAndLeave();
    });
  }

  function setupTitle() {
    const titleEl = document.getElementById('fullscTitle');
    const kickerEl = document.querySelector('.fullsc-kicker');
    if (!titleEl) return;

    const rawTitle = decode(qs('title')) || titleFromId(getStorageKey());
    const title = stripTrailingScriptureRefs(rawTitle);
    const isSymposium = qs('isSymposium') === '1';
    const symposiumTitle = decode(qs('symposiumTitle'));

    titleEl.textContent = title;

    if (kickerEl) {
      if (isSymposium && symposiumTitle) {
        kickerEl.textContent = symposiumTitle;
        kickerEl.hidden = false;
        kickerEl.classList.remove('is-hidden');
      } else {
        kickerEl.textContent = '';
        kickerEl.hidden = true;
        kickerEl.classList.add('is-hidden');
      }
    }

    document.title = title + ' — Assembleia 2026';
  }

  function bootAnim() {
    if (isPerfLow()) {
      document.body.classList.remove('fullsc-boot');
      document.body.classList.add('fullsc-ready');
      return;
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.body.classList.remove('fullsc-boot');
        document.body.classList.add('fullsc-ready');
      });
    });
  }

  function syncToolbarFocusState(editor) {
    if (!editor || !document.body) return;

    const sel = window.getSelection?.();
    const selectionInside = !!(sel && sel.rangeCount > 0 && editor.contains(sel.anchorNode));
    const activeInside = document.activeElement === editor || editor.contains(document.activeElement);
    const keepVisible = document.body.classList.contains('leitor-keep-toolbar') || document.body.classList.contains('zombie-toolbar-active');

    if (selectionInside || activeInside || keepVisible) {
      document.body.classList.add('editor-has-focus');
    } else {
      document.body.classList.remove('editor-has-focus');
    }
  }


  function bindToolbarSafety(editor) {
    if (!editor) return;

    const refresh = () => {
      requestAnimationFrame(() => syncToolbarFocusState(editor));
    };

    editor.addEventListener('focus', refresh);
    editor.addEventListener('pointerdown', refresh, true);
    editor.addEventListener('touchstart', refresh, { passive: true });
    editor.addEventListener('click', refresh, true);
    document.addEventListener('selectionchange', refresh);
    window.addEventListener('pageshow', refresh);

    setTimeout(refresh, 0);
    requestAnimationFrame(refresh);
  }


  function setupFullscRichtextToolbarBridge(editor) {
    const toolbar = document.getElementById('kbdToolbar');
    if (!toolbar) return;

    const glass = document.getElementById('glassFx');
    const leitorBtn = toolbar.querySelector('[aria-label="Modo Bíblia"]');

    document.body.classList.add('fullsc-richtext-toolbar');
    toolbar.setAttribute('data-fullsc-toolbar', 'true');

    // No fullsc, .fullsc-app recebe transform e vira stacking-context.
    // O modal bíblico é inserido direto no body; por isso a barra ficava presa atrás dele.
    // Tirando a barra do .fullsc-app, ela passa a flutuar igual à barra original do richtext.
    if (glass && glass.parentElement !== document.body) document.body.appendChild(glass);
    if (toolbar.parentElement !== document.body) document.body.appendChild(toolbar);

    let raf = 0;

    const modalIsOpen = () => {
      const modal = document.getElementById('modal-biblia');
      if (!modal) return false;
      const style = window.getComputedStyle(modal);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    };

    const readerIsActive = () => {
      return document.body.classList.contains('leitor-keep-toolbar') ||
        toolbar.classList.contains('leitor-toolbar-locked') ||
        editor?.getAttribute('contenteditable') === 'false' ||
        leitorBtn?.getAttribute('aria-pressed') === 'true';
    };

    const sync = () => {
      raf = 0;

      // The shared v2 editor owns the body/keyboard viewport. Measuring the
      // layout height avoids feeding transform animation back into its geometry.
      const toolbarHeight = Math.max(68, toolbar.offsetHeight || 68);
      const value = `${toolbarHeight}px`;
      if (document.documentElement.style.getPropertyValue('--kbd-toolbar-real-height') !== value) {
        document.documentElement.style.setProperty('--kbd-toolbar-real-height', value);
      }

      const active = readerIsActive();
      const modalOpen = modalIsOpen();

      document.body.classList.toggle('fullsc-reader-active', active);
      document.body.classList.toggle('fullsc-bible-modal-open', modalOpen);

      if (active || modalOpen) {
        document.body.classList.add('editor-has-focus');
      }
    };

    const queueSync = () => {
      if (raf) return;
      raf = requestAnimationFrame(sync);
    };

    const observeModal = () => {
      const modal = document.getElementById('modal-biblia');
      if (!modal || modal.__fullscToolbarObserved) return;
      modal.__fullscToolbarObserved = true;
      modalObserver.observe(modal, { attributes: true, attributeFilter: ['style', 'class'] });
    };

    const modalObserver = new MutationObserver(queueSync);
    const stateObserver = new MutationObserver(() => {
      observeModal();
      queueSync();
    });

    stateObserver.observe(document.body, { attributes: true, attributeFilter: ['class'], childList: true });
    stateObserver.observe(toolbar, { attributes: true, attributeFilter: ['class'] });
    if (editor) stateObserver.observe(editor, { attributes: true, attributeFilter: ['contenteditable', 'class'] });
    if (leitorBtn) stateObserver.observe(leitorBtn, { attributes: true, attributeFilter: ['aria-pressed', 'class'] });

    observeModal();

    const originalAbrirModalBibl = window.abrirModalBibl;
    if (typeof originalAbrirModalBibl === 'function' && !originalAbrirModalBibl.__fullscToolbarWrapped) {
      const wrappedAbrirModalBibl = function (...args) {
        document.body.classList.add('fullsc-reader-active', 'fullsc-bible-modal-open', 'editor-has-focus');
        const result = originalAbrirModalBibl.apply(this, args);
        setTimeout(queueSync, 0);
        setTimeout(queueSync, 80);
        return result;
      };
      wrappedAbrirModalBibl.__fullscToolbarWrapped = true;
      window.abrirModalBibl = wrappedAbrirModalBibl;
    }

    document.addEventListener('editor:viewport-layout', queueSync);
    document.addEventListener('notes:surface-resize', queueSync);
    window.addEventListener('resize', queueSync, { passive: true });
    window.addEventListener('orientationchange', queueSync, { passive: true });
    window.visualViewport?.addEventListener('resize', queueSync, { passive: true });
    window.visualViewport?.addEventListener('scroll', queueSync, { passive: true });

    queueSync();
    setTimeout(queueSync, 80);
  }

  async function init() {
    setupBack();
    setupTitle();
    bootAnim();

    const key = getStorageKey();
    const editor = await waitForEditor();
    editorRef = editor;

    const agent = getAgent();
    const fullHtml = agent?.getFullHTML ? agent.getFullHTML(key) : '';
    applyHTML(editor, fullHtml);
    // Loading a saved talk establishes the undo baseline; it is not an edit
    // that should let Undo erase the entire pre-existing annotation.
    const history = window.M12_History;
    if (history) {
      clearTimeout(history.timer); cancelAnimationFrame(history.raf);
      history.timer = 0; history.stack = []; history.index = -1; history.commit(true);
    }
    setupFullscRichtextToolbarBridge(editor);
    bindToolbarSafety(editor);
    syncToolbarFocusState(editor);
    if (typeof M4_Caret !== 'undefined' && typeof M4_Caret.updateFocus === 'function') {
      requestAnimationFrame(() => {
        try { M4_Caret.updateFocus(true); } catch (_) {}
        syncToolbarFocusState(editor);
      });
    }

    const queueSave = () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(saveDraft, 180);
    };

    editor.addEventListener('input', queueSave);
    if (!isPerfLow()) editor.addEventListener('keyup', queueSave);
    editor.addEventListener('paste', queueSave);
    editor.addEventListener('cut', queueSave);
    editor.addEventListener('blur', saveDraft, true);
    window.addEventListener('beforeunload', event => {
      if (!prepareExit()) { event.preventDefault(); event.returnValue = ''; }
    });
    window.addEventListener('pagehide', prepareExit);
    window.addEventListener('pageshow', () => { leaving = false; });

  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();