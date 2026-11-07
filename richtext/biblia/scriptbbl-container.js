(function() {
  'use strict';
  if (window.bibleSystemInitialized) return;
  window.bibleSystemInitialized = true;
  const scriptURL = document.currentScript.src;
  const readerRoutes = import(new URL('../../biblia/legacy-routes.js', scriptURL).href).catch(() => null);
  const aliases = typeof ABREVIACOES === 'object' ? ABREVIACOES : {};
  const references = new window.NotesBibleReferenceModel({
    baseURL: new URL('../../sentinela/biblia/data/', scriptURL), aliases
  });
  let current = null, session = 0, previewVersion = 0, closeTimer = 0;
  let bodyOverflow = null, returnFocus = null, sequence = 0;
  const bindings = new WeakSet();
  const byId = id => document.getElementById(id);
  const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const editableOf = node => (node?.nodeType === 1 ? node : node?.parentElement)?.closest('.editable');
  const sourceId = () => window.crypto?.randomUUID?.() || `bbl-${Date.now().toString(36)}-${++sequence}-${Math.random().toString(36).slice(2)}`;

  function ensureModalExists() {
    if (byId('modal-biblia')) return;
    const modal = document.createElement('div');
    modal.id = 'modal-biblia'; modal.hidden = true;
    modal.innerHTML = `<section class="modal-biblia-content" role="dialog" aria-modal="true" aria-labelledby="modal-biblia-heading" tabindex="-1">
      <header class="modal-biblia-toolbar"><span id="modal-biblia-heading">Texto bíblico</span><div>
        <button id="modal-biblia-expandir" type="button" aria-label="Ajustar versículos" aria-controls="modal-biblia-ajustes" aria-expanded="false">+</button>
        <button id="modal-biblia-transcrever" type="button" title="Transcrever a prévia" aria-label="Transcrever a prévia">T</button>
        <button id="modal-biblia-fechar" type="button" aria-label="Fechar prévia">×</button>
      </div></header>
      <div id="modal-biblia-ajustes" hidden>
        <div class="modal-biblia-stepper" role="group" aria-label="Versículos na prévia"><button id="modal-biblia-menos" type="button" aria-label="Remover último versículo">−</button><button id="modal-biblia-mais" type="button" aria-label="Acrescentar próximo versículo">+</button></div>
        <form id="modal-biblia-form"><label class="modal-biblia-label" for="modal-biblia-campo">Acrescentar versículos, por exemplo: 2-5, 8 ou 2:1-3</label><div><input id="modal-biblia-campo" type="text" inputmode="text" enterkeyhint="done" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Ex.: 2-5, 8"><button id="modal-biblia-aplicar" type="submit" aria-label="Aplicar versículos à prévia">✓</button></div></form>
      </div>
      <p id="modal-biblia-erro" role="status" hidden></p>
      <div id="modal-biblia-corpo" aria-live="polite"></div>
    </section>`;
    document.body.append(modal);
    byId('modal-biblia-fechar').onclick = () => fecharModal();
    byId('modal-biblia-transcrever').onclick = transcreverVersiculo;
    byId('modal-biblia-expandir').onclick = () => {
      const panel = byId('modal-biblia-ajustes'); panel.hidden = !panel.hidden;
      byId('modal-biblia-expandir').setAttribute('aria-expanded', String(!panel.hidden));
      if (panel.hidden) { byId('modal-biblia-campo').value = ''; setError(''); }
      syncViewport();
    };
    byId('modal-biblia-mais').onclick = () => adjust(1);
    byId('modal-biblia-menos').onclick = () => adjust(-1);
    byId('modal-biblia-form').onsubmit = event => {
      event.preventDefault();
      if (!current?.model) return;
      try {
        const next = references.parseSelection(current.model, byId('modal-biblia-campo').value);
        current.model = next; byId('modal-biblia-campo').value = ''; byId('modal-biblia-campo').blur(); renderPreview();
      } catch (error) { setError(error.message); }
    };
    modal.onclick = event => { if (event.target === modal) fecharModal(); };
    modal.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); fecharModal(); return; }
      if (event.key !== 'Tab') return;
      const nodes = Array.from(modal.querySelectorAll('button:not(:disabled),input:not(:disabled),a[href]')).filter(el => el.getClientRects().length);
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    });
  }

  function syncViewport() {
    const modal = byId('modal-biblia'); if (!current || !modal) return;
    const view = window.visualViewport;
    const surface = window.NotesViewport?.enabled ? window.NotesViewport.measure() : null;
    let height = view?.height || innerHeight, top = view?.offsetTop || 0;
    // The backdrop must reach the same bottom as the border after dismissal.
    // Keep the reduced visual viewport while a keyboard or pinch zoom needs it.
    if (surface && (!view || Math.abs(view.scale - 1) < 0.01) &&
        surface.height - (height + Math.max(0, top)) <= 100) {
      height = surface.height; top = 0;
    }
    modal.classList.toggle('is-compact', height < 420);
    modal.style.setProperty('--notes-bible-viewport-height', height + 'px');
    modal.style.setProperty('--notes-bible-viewport-top', top + 'px');
  }
  function setError(message) {
    if (!current) return;
    current.invalid = !!message;
    const error = byId('modal-biblia-erro'); error.textContent = message; error.hidden = !message;
    updateControls();
  }
  function updateControls() {
    const model = current?.model;
    const writable = !!current?.trigger?.isConnected && !!editableOf(current.trigger);
    byId('modal-biblia-transcrever').hidden = !writable;
    byId('modal-biblia-transcrever').disabled = !model || current.invalid;
    byId('modal-biblia-expandir').disabled = !model;
    byId('modal-biblia-menos').disabled = !model || !references.canRemove(model);
    byId('modal-biblia-mais').disabled = !model || !references.canAdd(model);
    byId('modal-biblia-aplicar').disabled = !model;
  }
  function adjust(delta) {
    if (!current?.model) return;
    try { current.model = references.adjust(current.model, delta); renderPreview(); }
    catch (error) { setError(error.message); }
  }
  function verseContent(model) {
    const fragment = document.createDocumentFragment();
    let paragraph, chapter = null;
    const severalChapters = new Set(model.verses.map(v => v.chapter)).size > 1;
    for (const verse of model.verses) {
      if (!paragraph || chapter !== verse.chapter || verse.newParagraph) {
        paragraph = document.createElement('p'); fragment.append(paragraph);
      } else paragraph.append(' ');
      const number = document.createElement('strong');
      number.textContent = severalChapters ? `${verse.chapter}:${verse.verse}` : String(verse.verse);
      paragraph.append(number, ' ' + verse.text); chapter = verse.chapter;
    }
    return fragment;
  }
  function renderPreview() {
    if (!current?.model) return;
    const model = current.model, version = ++previewVersion, openSession = session;
    const body = byId('modal-biblia-corpo'), heading = document.createElement('h3');
    heading.textContent = model.title;
    body.replaceChildren(heading, verseContent(model)); body.scrollTop = 0;
    body.dataset.reference = model.title; setError('');
    readerRoutes.then(routes => {
      if (routes && current && session === openSession && previewVersion === version)
        routes.appendBibleChapterLink(body, model.title, aliases);
    });
  }
  async function abrirModalBibl(reference, triggerElement = null) {
    ensureModalExists(); clearTimeout(closeTimer);
    const wasOpen = !!current, openSession = ++session;
    current = { trigger: triggerElement, model: null, invalid: false };
    if (!wasOpen) {
      returnFocus = document.activeElement;
      bodyOverflow = { value: document.body.style.getPropertyValue('overflow'), priority: document.body.style.getPropertyPriority('overflow') };
      document.body.style.setProperty('overflow', 'hidden');
    }
    const modal = byId('modal-biblia'); modal.hidden = false; modal.classList.remove('is-closing');
    byId('modal-biblia-ajustes').hidden = true; byId('modal-biblia-expandir').setAttribute('aria-expanded', 'false');
    byId('modal-biblia-campo').value = ''; byId('modal-biblia-erro').hidden = true;
    byId('modal-biblia-corpo').textContent = 'Carregando o texto…'; updateControls(); syncViewport();
    requestAnimationFrame(() => { if (current && session === openSession) modal.classList.add('is-open'); });
    modal.querySelector('.modal-biblia-content').focus({ preventScroll: true });
    try {
      const model = await references.parse(reference);
      if (!current || session !== openSession) return;
      if (triggerElement && !triggerElement.isConnected) { fecharModal({ restoreFocus: false }); return; }
      current.model = model; renderPreview();
    } catch (error) {
      if (!current || session !== openSession) return;
      byId('modal-biblia-corpo').textContent = '';
      setError(error.message || 'Não foi possível carregar esta referência.');
    }
  }
  function fecharModal({ restoreFocus = true } = {}) {
    if (!current) return;
    ++session; current = null;
    const modal = byId('modal-biblia'); modal.classList.remove('is-open'); modal.classList.add('is-closing');
    if (bodyOverflow?.value) document.body.style.setProperty('overflow', bodyOverflow.value, bodyOverflow.priority);
    else document.body.style.removeProperty('overflow');
    bodyOverflow = null;
    const active = document.activeElement;
    if (active && modal.contains(active)) active.blur();
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      if (current) return;
      modal.hidden = true; modal.classList.remove('is-closing');
    }, reducedMotion() ? 0 : 220);
    if (restoreFocus && returnFocus?.isConnected && !returnFocus.closest?.('#editor')) returnFocus.focus?.({ preventScroll: true });
    returnFocus = null;
  }

  function persistentSource(node, title) {
    const element = node.nodeType === 1 ? node : node.parentElement;
    let wrapper = element?.closest('.versiculo-ref-toggle,.versiculo-ref');
    // A user may have typed another reference or comment inside an old bold
    // source. Never replace that surrounding text as part of this selection.
    if (wrapper && wrapper.textContent.trim() !== node.textContent.trim()) {
      wrapper.classList.remove('versiculo-ref-toggle', 'versiculo-ref');
      delete wrapper.dataset.bblSourceId; wrapper = null;
    }
    if (!wrapper) {
      wrapper = document.createElement('b'); wrapper.className = title ? 'versiculo-ref-toggle' : 'versiculo-ref';
      node.replaceWith(wrapper); wrapper.append(node);
    }
    wrapper.className = title ? 'versiculo-ref-toggle' : 'versiculo-ref';
    return wrapper;
  }
  function identityFor(source, scope) {
    let id = source.dataset.bblSourceId;
    if (id) {
      const same = Array.from(scope.querySelectorAll('.versiculo-ref-toggle[data-bbl-source-id],.versiculo-ref[data-bbl-source-id]')).filter(el => el.dataset.bblSourceId === id);
      if (same[0] !== source) id = null;
    }
    id ||= sourceId(); source.dataset.bblSourceId = id; return id;
  }
  function directGenerated(toggle) {
    return M2_Query.childs(M2_Query.getChil(toggle)).filter(n => n.classList.contains('node-text'))
      .flatMap(n => Array.from(M2_Query.getTxtC(n).querySelectorAll('.versiculo-filho')));
  }
  function transcriptionMarkup() {
    const fragment = document.createDocumentFragment();
    Array.from(byId('modal-biblia-corpo').querySelectorAll('p')).forEach((p, index) => {
      if (index) fragment.append(' ');
      Array.from(p.childNodes).forEach(child => fragment.append(child.cloneNode(true)));
    });
    return fragment;
  }
  function transcreverVersiculo() {
    if (!current?.model || current.invalid || !current.trigger?.isConnected) return;
    if (typeof M5_Factory === 'undefined' || typeof M2_Query === 'undefined') return;
    const model = current.model, trigger = current.trigger, editable = editableOf(trigger);
    if (!editable) return;
    const title = editable.classList.contains('toggle-title'), toggle = title ? editable.closest('.node-toggle') : null;
    const referenceCount = title ? editable.querySelectorAll('.bbl').length : 0;
    const markup = transcriptionMarkup(); if (!markup.childNodes.length) return;
    // Remove the temporary read-mode links before history captures the edit.
    const anchor = window.LeitorMode?.desativar?.({ reference: trigger }) || trigger;
    if (!anchor.isConnected) return;
    const history = window.M12_History; history?.beforeChange?.();
    const source = persistentSource(anchor, title);
    const alreadyIdentified = !!source.dataset.bblSourceId;
    const id = identityFor(source, editable);
    source.textContent = model.title;
    let cursorNode, cursorAfter = false;
    if (toggle) {
      const children = directGenerated(toggle);
      let generated = children.find(el => el.dataset.bblSourceId === id);
      if (!generated && !alreadyIdentified && referenceCount === 1) {
        const legacy = children.filter(el => !el.dataset.bblSourceId);
        if (legacy.length === 1) generated = legacy[0];
      }
      if (!generated) {
        const node = M5_Factory.text('', M2_Query.getLvl(toggle) + 1);
        generated = document.createElement('span'); generated.className = 'versiculo-filho';
        M2_Query.getTxtC(node).append(generated); M2_Query.getChil(toggle).append(node);
      }
      generated.dataset.bblSourceId = id;
      const italic = document.createElement('i'); italic.className = 'versiculo-transc'; italic.append(markup);
      generated.replaceChildren(italic); M6_Tree.setOpen(toggle, true, false);
      cursorNode = generated;
    } else {
      let block = source.closest('.versiculo-bloco');
      if (!block) {
        block = document.createElement('span'); block.className = 'versiculo-bloco';
        source.replaceWith(block); block.append(source, ' — ');
      }
      let generated = Array.from(block.querySelectorAll('.versiculo-transc')).find(el => el.dataset.bblSourceId === id);
      if (!generated && block.querySelectorAll('.versiculo-ref').length === 1) {
        const legacy = Array.from(block.querySelectorAll('.versiculo-transc')).filter(el => !el.dataset.bblSourceId);
        if (legacy.length === 1) generated = legacy[0];
      }
      if (!generated) { generated = document.createElement('i'); generated.className = 'versiculo-transc'; block.append(generated); }
      generated.dataset.bblSourceId = id; generated.replaceChildren(markup);
      cursorNode = block; cursorAfter = true;
    }
    fecharModal({ restoreFocus: false });
    M3_TextModel.syncAll();
    const editor = byId('editor'); editor.setAttribute('contenteditable', 'true'); editor.focus({ preventScroll: true });
    const range = document.createRange();
    if (cursorAfter) range.setStartAfter(cursorNode);
    else { range.selectNodeContents(cursorNode); range.collapse(false); }
    range.collapse(true); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    M4_Caret.saveR(); window.M13_Negrita?.clearTypingState?.(); M4_Caret.updateFocus(true); M11_Layout.schedule(2);
    history?.afterChange?.(2); editor.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function setupBblLinkListeners(link) {
    if (bindings.has(link)) return; bindings.add(link);
    link.dataset.bblBound = 'true'; link.setAttribute('role', 'button'); link.tabIndex = 0;
    link.setAttribute('aria-label', `Abrir ${link.textContent.trim()}`);
    let point = null, opened = false, moved = false, hold = 0;
    const reset = () => { clearTimeout(hold); point = null; link.classList.remove('pressionando'); };
    link.addEventListener('pointerdown', event => {
      if (event.isPrimary === false || event.button > 0) return;
      point = {x:event.clientX,y:event.clientY}; opened = false; moved = false;
      hold = setTimeout(() => { if (point) { opened = true; abrirModalBibl(link.textContent.trim(),link); } }, 300);
    }, {passive:true});
    link.addEventListener('pointermove', event => { if (point && Math.hypot(event.clientX-point.x,event.clientY-point.y)>10) { moved = true; reset(); } }, {passive:true});
    link.addEventListener('pointercancel', () => { moved = true; reset(); }, {passive:true});
    link.addEventListener('pointerup', reset, {passive:true});
    link.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); if (!opened && !moved) abrirModalBibl(link.textContent.trim(),link); opened = false; moved = false; });
    link.addEventListener('keydown', event => { if (['Enter',' '].includes(event.key)) { event.preventDefault(); abrirModalBibl(link.textContent.trim(),link); } });
  }
  function normalizeBblLinks(root = document) { root.querySelectorAll('.bbl').forEach(setupBblLinkListeners); }
  window.addEventListener('resize', syncViewport, {passive:true});
  document.addEventListener('notes:surface-resize', syncViewport);
  window.visualViewport?.addEventListener('resize', syncViewport, {passive:true});
  window.visualViewport?.addEventListener('scroll', syncViewport, {passive:true});
  window.addEventListener('notes:restored', () => { if (current?.trigger && !current.trigger.isConnected) fecharModal({restoreFocus:false}); });
  document.addEventListener('DOMContentLoaded', () => { ensureModalExists(); normalizeBblLinks(); });
  window.abrirModalBibl = abrirModalBibl;
  window.setupBblLinkListeners = setupBblLinkListeners;
  window.normalizeBblLinks = normalizeBblLinks;
})();
