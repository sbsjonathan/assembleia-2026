'use strict';
/* Search is a normal document screen: the browser owns keyboard panning and scrolling. */
(() => {
  const defaultCategories = [
    ['all', 'Tudo'], ['verses', 'Versículos'], ['notes', 'Notas'],
    ['documents', 'Índices e artigos'], ['related', 'Relacionados']
  ];
  const kindNames = {verse:'Versículo', verses:'Versículo', note:'Nota', study:'Nota de estudo',
    footnote:'Nota de rodapé', document:'Texto de estudo', index:'Índice', topic:'Assunto',
    related:'Referência relacionada', reference:'Passagem', book:'Livro', outline:'Esboço'};
  const fold = text => String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
  const node = (tag, cls, text) => {
    const element = document.createElement(tag);
    if (cls) element.className = cls;
    if (text != null) element.textContent = text;
    return element;
  };
  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#i-' + name); svg.setAttribute('aria-hidden', 'true'); svg.append(use);
    return svg;
  }
  function appendHighlighted(element, text, terms) {
    text = String(text || '');
    const normalized = [], positions = [];
    let originalPosition = 0;
    for (const character of text) {
      const normalizedCharacter = fold(character);
      normalized.push(normalizedCharacter);
      for (let i = 0; i < normalizedCharacter.length; i++) positions.push([originalPosition, originalPosition + character.length]);
      originalPosition += character.length;
    }
    const candidates = [...new Set((terms || []).map(fold).map(term => term.trim()).filter(term => term.length > 1))]
      .sort((a, b) => b.length - a.length);
    if (!candidates.length) { element.textContent = text; return; }
    const expression = new RegExp('(^|[^\\p{L}\\p{N}])(' + candidates.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')(?=$|[^\\p{L}\\p{N}])', 'gu');
    const searchable = normalized.join(''); let match, cursor = 0;
    while ((match = expression.exec(searchable))) {
      const start = positions[match.index + match[1].length]?.[0];
      const end = positions[match.index + match[0].length - 1]?.[1];
      if (start == null || end == null || start < cursor) continue;
      element.append(document.createTextNode(text.slice(cursor, start)), node('mark', '', text.slice(start, end)));
      cursor = end;
    }
    element.append(document.createTextNode(text.slice(cursor)));
  }

  window.initBibleSearch = function initBibleSearch({view, getPublication, search, onOpen, getSuggestions, onEnter, onLeave}) {
    if (!view || typeof search !== 'function') throw new Error('A busca não conseguiu iniciar.');
    const state = {publication:null, query:'', category:'all', items:[], counts:{}, total:0,
      hasMore:false, nextOffset:0, epoch:0, busy:false, responseTerms:[], trigger:null,
      active:false, resultScroll:0, viewportBase:0};
    let debounceTimer, closingPromise, resolveClose, closeOptions, enterAnimation, reopenRequest, historyExitReady = false;
    const historyKey = 'bibleSearchView';
    const historyToken = String(Date.now()) + '-' + Math.random().toString(36).slice(2);
    // A reload starts on the saved Bible screen, never on a stale search entry.
    if (history.state?.[historyKey]) {
      const clean = {...history.state}; delete clean[historyKey]; history.replaceState(clean, '');
    }
    view.classList.add('bible-search-page');
    view.setAttribute('aria-labelledby', 'search-title');
    const surface = node('div', 'search-surface');
    const header = node('header', 'search-panel-header');
    const heading = node('h2', '', 'Buscar na Bíblia'); heading.id = 'search-title';
    const closeButton = node('button', 'search-close'); closeButton.type = 'button';
    closeButton.setAttribute('aria-label', 'Fechar busca'); closeButton.append(icon('close')); header.append(heading, closeButton);
    const form = node('form', 'search-query-form'); form.id = 'search-form'; form.setAttribute('role', 'search');
    const label = node('label', '', 'Palavra, assunto ou passagem'); label.htmlFor = 'search-input';
    const field = node('div', 'search-query-field');
    const input = node('input'); input.id = 'search-input'; input.type = 'text'; input.setAttribute('role', 'searchbox');
    input.placeholder = 'Sangue, fé ou João 3:16'; input.autocomplete = 'off'; input.spellcheck = false; input.maxLength = 180;
    input.setAttribute('autocapitalize', 'none'); input.setAttribute('enterkeyhint', 'search'); input.setAttribute('aria-describedby', 'search-message');
    const clearButton = node('button', 'search-clear'); clearButton.type = 'button'; clearButton.hidden = true;
    clearButton.setAttribute('aria-label', 'Limpar pesquisa'); clearButton.append(icon('close'));
    const submitButton = node('button', 'search-submit'); submitButton.type = 'submit';
    submitButton.setAttribute('aria-label', 'Buscar'); submitButton.append(icon('search')); field.append(input, clearButton, submitButton); form.append(label, field);
    const categories = node('div', 'search-categories'); categories.setAttribute('role', 'tablist'); categories.setAttribute('aria-label', 'Tipos de resultado');
    const categoryButtons = new Map();
    const status = node('p', 'search-status'); status.id = 'search-message'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const statusText = node('span', 'search-status-text'); status.append(statusText);
    const resultsScroll = node('div', 'search-results-scroll'); resultsScroll.setAttribute('role', 'tabpanel'); resultsScroll.id = 'search-results-panel';
    const results = node('div', 'search-result-list'); results.id = 'search-results';
    const moreButton = node('button', 'search-load-more', 'Mostrar mais resultados'); moreButton.type = 'button'; moreButton.hidden = true;
    const footer = node('p', 'search-coverage', 'Versículos, notas, índices e apêndices desta Bíblia.');
    resultsScroll.append(results, moreButton, footer); surface.append(header, form, categories, status, resultsScroll); view.replaceChildren(surface);

    function addCategory(key, title) {
      const tab = node('button', 'search-category'); tab.type = 'button'; tab.id = 'search-category-' + key;
      tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', resultsScroll.id);
      const count = node('span', 'search-category-count'); tab.append(node('span', '', title), count);
      tab.onclick = () => { if (state.category !== key) { state.category = key; updateCategories(); runSearch(false); } };
      tab.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); const visible = [...categoryButtons.values()].filter(item => !item.tab.hidden);
        const index = visible.findIndex(item => item.tab === tab);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? visible.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + visible.length) % visible.length;
        visible[next].tab.focus({preventScroll:true}); visible[next].tab.click();
      });
      categories.append(tab); categoryButtons.set(key, {tab, count});
    }
    defaultCategories.forEach(([key, title]) => addCategory(key, title));
    function updateCategories() {
      for (const [key, {tab, count}] of categoryButtons) {
        const active = key === state.category; tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
        const number = key === 'all' ? (state.counts.all ?? state.counts.total) : state.counts[key];
        count.textContent = Number.isFinite(number) ? Number(number).toLocaleString('pt-BR') : '';
        count.hidden = !Number.isFinite(number);
      }
      resultsScroll.setAttribute('aria-labelledby', 'search-category-' + state.category);
      const selected = categoryButtons.get(state.category)?.tab;
      if (selected) categories.scrollTo({left:Math.max(0, selected.offsetLeft - categories.offsetLeft - 16), behavior:'auto'});
    }
    function showMessage(message, error = false) { statusText.textContent = message; status.classList.toggle('is-error', error); }
    function updateBusy(busy) {
      state.busy = busy; resultsScroll.setAttribute('aria-busy', String(busy)); status.classList.toggle('is-loading', busy);
      moreButton.disabled = busy; moreButton.textContent = busy ? 'Buscando…' : 'Mostrar mais resultados';
    }
    async function selectResult(item) {
      if(closingPromise || !await close({restoreScroll:false, restoreFocus:false}))return;
      try { await onOpen?.(item); }
      catch (error) { open(state.trigger, {focus:false}); showMessage(error?.message || 'Não foi possível abrir este resultado.', true); }
    }
    function renderItem(item) {
      const card = node('button', 'search-result'); card.type = 'button';
      const meta = node('span', 'search-result-meta');
      const kind = node('span', 'search-result-kind', kindNames[item.kind] || 'Texto');
      meta.append(kind);
      if (item.source) meta.append(node('span', 'search-result-source', item.source));
      const title = node('strong', 'search-result-title');
      const terms = item.terms || state.responseTerms;
      appendHighlighted(title, item.title || 'Abrir texto', terms);
      card.append(meta, title);
      if (item.snippet) { const snippet = node('span', 'search-result-snippet'); appendHighlighted(snippet, item.snippet, terms); card.append(snippet); }
      const reason = typeof item.related === 'string' ? item.related : item.related?.reason || item.reason;
      if (reason) card.append(node('span', 'search-result-reason', reason));
      card.onclick = () => selectResult(item); return card;
    }
    function renderItems(appendFrom = 0) {
      if (appendFrom) results.append(...state.items.slice(appendFrom).map(renderItem));
      else results.replaceChildren(...state.items.map(renderItem));
      moreButton.hidden = !state.hasMore;
    }
    function renderSuggestions() {
      state.items = []; state.counts = {}; state.total = 0; state.hasMore = false; state.nextOffset = 0; state.responseTerms = []; state.resultScroll = 0;
      updateCategories(); updateBusy(false); results.replaceChildren(); moreButton.hidden = true;
      if (state.active && document.activeElement !== input) window.scrollTo({top:0,left:0,behavior:'instant'});
      showMessage('Pesquise uma palavra ou abra uma passagem.');
      const examples = node('div', 'search-examples');
      for (const term of ['Sangue', 'Amor', 'Fé', 'João 3:16']) {
        const example = node('button', 'search-example', term); example.type = 'button';
        example.onclick = () => { input.value = term; inputChanged(true); }; examples.append(example);
      }
      results.append(examples);
      const suggestions = getSuggestions?.() || [];
      if (suggestions.length) { results.append(node('h3', 'search-suggestions-title', 'Livros da Bíblia')); results.append(...suggestions.map(renderItem)); }
    }
    async function runSearch(append = false) {
      clearTimeout(debounceTimer);
      const query = input.value.trim(); state.query = query; clearButton.hidden = !query;
      const epoch = ++state.epoch;
      if (!query) { renderSuggestions(); return; }
      if (!append) { state.items = []; state.counts = {}; state.hasMore = false; state.nextOffset = 0; state.resultScroll = 0; results.replaceChildren(); if (state.active && document.activeElement !== input) window.scrollTo({top:0,left:0,behavior:'instant'}); moreButton.hidden = true; updateCategories(); }
      updateBusy(true); showMessage(append ? 'Buscando mais resultados…' : 'Buscando em versículos, notas e índices…');
      try {
        const publication = getPublication?.();
        const response = await search({query, category:state.category, offset:append ? state.nextOffset : 0, limit:40,
          onProgress:message => { if (epoch === state.epoch && state.active) showMessage(typeof message === 'string' ? message : message?.message || 'Preparando a busca…'); }});
        if (epoch !== state.epoch || !state.active || publication !== getPublication?.()) return;
        state.responseTerms = response.queryTerms || response.terms || query.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
        const nextItems = Array.isArray(response.items) ? response.items : [];
        const appendFrom = append ? state.items.length : 0;
        state.items = append ? state.items.concat(nextItems) : nextItems;
        state.counts = response.counts || {}; state.total = Number(response.total) || 0;
        state.nextOffset = Number.isFinite(response.nextOffset) ? response.nextOffset : (append ? state.nextOffset : 0) + nextItems.length;
        state.hasMore = response.hasMore == null ? state.nextOffset < state.total : Boolean(response.hasMore);
        renderItems(appendFrom); updateCategories();
        if (state.total) showMessage(response.message || `${state.total.toLocaleString('pt-BR')} ${state.total === 1 ? 'resultado' : 'resultados'} para “${query}”.`);
        else {
          showMessage(response.message || `Nenhum resultado para “${query}”.`);
          const hint = node('p', 'search-empty', 'Tente outra palavra, uma expressão mais curta ou uma referência como João 3:16.'); results.append(hint);
        }
      } catch (error) {
        if (epoch !== state.epoch || !state.active) return;
        showMessage(error?.message || 'Não foi possível concluir a busca. Tente novamente.', true);
        if (!append) { const retry = node('button', 'search-retry', 'Tentar novamente'); retry.type = 'button'; retry.onclick = () => runSearch(false); results.replaceChildren(retry); }
      } finally { if (epoch === state.epoch) updateBusy(false); }
    }
    function inputChanged(immediate = false) {
      ++state.epoch; clearTimeout(debounceTimer); state.category = 'all'; clearButton.hidden = !input.value;
      if (immediate || !input.value.trim()) runSearch(false); else debounceTimer = setTimeout(() => runSearch(false), 220);
    }
    function open(trigger, {focus = true, fromHistory = false} = {}) {
      if (closingPromise) { reopenRequest = {trigger, fromHistory}; return; }
      const publication = getPublication?.();
      if (state.publication !== publication) { reset(); state.publication = publication; }
      if (state.active) { if (focus) input.focus({preventScroll:true}); return; }
      state.trigger = trigger || document.activeElement;
      state.viewportBase = Math.max(innerHeight, window.visualViewport?.height || 0);
      // Save the reading entry before changing the DOM or focusing an input.
      if (!fromHistory) history.pushState({...history.state, [historyKey]:historyToken}, '');
      onEnter?.(); view.hidden = false; state.active = true;
      if (input.value.trim()) {
        if (!state.items.length || state.query !== input.value.trim()) runSearch(false);
        else { renderItems(); updateCategories(); }
      } else renderSuggestions();
      const resumeResults = state.items.length > 0 && state.resultScroll > 0;
      if (!resumeResults) state.resultScroll = 0;
      window.scrollTo({top:state.resultScroll,left:0,behavior:'instant'});
      // Focusing an off-screen input makes iOS pan even with preventScroll.
      // Resume a scrolled result list without reopening the keyboard.
      if (focus && !resumeResults) input.focus({preventScroll:true});
      else closeButton.focus({preventScroll:true});
      enterAnimation?.cancel();
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches && view.animate)
        enterAnimation = view.animate([{opacity:0},{opacity:1}], {duration:160,easing:'ease-out'});
    }
    function keyboardReleased() {
      // No viewport position/height writes. Wait only when leaving a keyboard
      // session, so the restored reading isn't clamped before the navbar returns.
      return new Promise(resolve => {
        let timer, frame, finished = false;
        const events = new AbortController();
        const done = () => {
          if (finished) return; finished = true;
          events.abort(); clearTimeout(timer); cancelAnimationFrame(frame);
          window.UnifiedNavbar?.instance?.syncBottomUI();
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        };
        const check = () => {
          const viewport = window.visualViewport;
          if (!viewport || viewport.height >= state.viewportBase - 120) {
            if (!frame) frame = requestAnimationFrame(done);
          }
        };
        window.visualViewport?.addEventListener('resize', check, {passive:true,signal:events.signal});
        window.visualViewport?.addEventListener('scroll', check, {passive:true,signal:events.signal});
        // A WebKit viewport may never report its final resize; never trap Back.
        timer = setTimeout(done, 700);
        check();
      });
    }
    function finishClose(options = {restoreScroll:true, restoreFocus:true}) {
      if (!state.active) return;
      state.active = false;
      ++state.epoch; clearTimeout(debounceTimer); updateBusy(false);
      if (view.contains(document.activeElement)) document.activeElement.blur();
      enterAnimation?.cancel(); view.hidden = true;
      onLeave?.(options);
      if (options.restoreFocus && state.trigger?.isConnected) state.trigger.focus({preventScroll:true});
      // Let same-document history restoration complete before opening a result.
      requestAnimationFrame(() => {
        const resolve = resolveClose;
        resolveClose = null; closingPromise = null; closeOptions = null; historyExitReady = false;
        resolve?.(true);
        if (reopenRequest) { const pending = reopenRequest; reopenRequest = null; open(pending.trigger, {focus:false, fromHistory:pending.fromHistory}); }
      });
    }
    function close({restoreScroll = true, restoreFocus = true, fromHistory = false} = {}) {
      if (closingPromise) return closingPromise;
      if (!state.active) return Promise.resolve(false);
      state.resultScroll = window.scrollY;
      ++state.epoch; clearTimeout(debounceTimer); updateBusy(false);
      closeOptions = {restoreScroll, restoreFocus, fromHistory};
      closingPromise = new Promise(resolve => { resolveClose = resolve; });
      const result = closingPromise;
      if (view.contains(document.activeElement)) document.activeElement.blur();
      keyboardReleased().then(() => {
        if (!state.active || closingPromise !== result) return;
        if (closeOptions.fromHistory || history.state?.[historyKey] !== historyToken) finishClose(closeOptions);
        else { historyExitReady = true; history.back(); }
      });
      return result;
    }
    window.addEventListener('popstate', event => {
      if (event.state?.[historyKey] === historyToken) {
        if (!state.active) open(state.trigger, {focus:false, fromHistory:true});
        else if (closingPromise) {
          // Forward can reverse a Back gesture before the keyboard settles.
          const resolve = resolveClose;
          resolveClose = null; closingPromise = null; closeOptions = null; historyExitReady = false;
          resolve?.(false);
        }
      } else if (state.active) {
        if (historyExitReady) finishClose(closeOptions);
        else if (closingPromise) closeOptions.fromHistory = true;
        else close({fromHistory:true});
      }
    });
    function reset() {
      ++state.epoch; clearTimeout(debounceTimer); state.query = ''; state.category = 'all'; state.items = []; state.responseTerms = [];
      input.value = ''; clearButton.hidden = true; renderSuggestions();
    }
    window.addEventListener('scroll', () => { if (state.active && !closingPromise) state.resultScroll = window.scrollY; }, {passive:true});
    input.addEventListener('input', () => inputChanged());
    form.addEventListener('submit', event => { event.preventDefault(); runSearch(false); });
    clearButton.onclick = () => { input.value = ''; inputChanged(true); input.focus({preventScroll:true}); };
    closeButton.onclick = () => close(); moreButton.onclick = () => { if (!state.busy) runSearch(true); };
    view.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !event.isComposing) { event.preventDefault(); close(); }
    });
    updateCategories();
    return {open, close, reset, isOpen:() => state.active};
  };
})();
