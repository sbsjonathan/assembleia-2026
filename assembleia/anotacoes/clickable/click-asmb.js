(function () {
  function slug(text) {
    return (text || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);
  }

  function getCurrentWatchtowerWeek() {
    const fromWindow = String(window.semanaAtual || '').trim();
    if (/^\d{2}-\d{2}$/.test(fromWindow)) return fromWindow;

    const hoje = new Date();
    const diaDaSemana = hoje.getDay();
    const diasParaSegunda = diaDaSemana === 0 ? -6 : 1 - diaDaSemana;

    const segundaFeira = new Date(hoje);
    segundaFeira.setDate(hoje.getDate() + diasParaSegunda);
    segundaFeira.setHours(0, 0, 0, 0);

    const dia = String(segundaFeira.getDate()).padStart(2, '0');
    const mes = String(segundaFeira.getMonth() + 1).padStart(2, '0');
    const semana = `${dia}-${mes}`;

    try { window.semanaAtual = semana; } catch {}
    return semana;
  }

  function buildCurrentWatchtowerUrl() {
    const semana = getCurrentWatchtowerWeek();
    const url = new URL('./sentinela/artigos/estudo.html', location.href);
    url.searchParams.set('semana', semana);
    return url.toString();
  }

  function getSpecialNoteConfig(trigger) {
    if (!trigger) return null;
    const pageKey = getPageKey();
    const text = normalizeText(getTextWithoutHour(trigger));
    if (pageKey === 'dom' && text.startsWith('resumo de a sentinela')) {
      return {
        kind: 'watchtower-shortcut',
        url: buildCurrentWatchtowerUrl(),
        handleLabel: 'Abrir o artigo de A Sentinela',
        messageHtml: '<div class="asmb-shortcut-message">Clique para abrir o artigo de <em>A Sentinela</em>.</div>'
      };
    }
    return null;
  }

  function getPageKey() {
    const explicit = document.documentElement?.dataset?.programDay || document.body?.dataset?.programDay || '';
    if (explicit) return slug(explicit);
    const file = (location.pathname.split('/').pop() || 'index').replace(/\.html?$/i, '');
    return slug(file || 'index');
  }

  function getTextWithoutHour(el) {
    const clone = el.cloneNode(true);
    clone.querySelectorAll('.hora').forEach((n) => n.remove());
    return (clone.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function normalizeText(text) {
    return (text || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isSymposiumTitle(el) {
    const strong = el.querySelector('strong');
    if (!strong) return false;
    const txt = strong.textContent.toLowerCase().trim();
    return txt.includes('série de discursos');
  }

  function isExcludedTrigger(el) {
    const text = normalizeText(getTextWithoutHour(el));
    const padded = ` ${text} `;
    return (
      padded.includes(' cantico ') ||
      padded.includes(' oracao ') ||
      padded.includes(' anuncios ') ||
      padded.includes(' intervalo ') ||
      padded.includes(' video musical ') ||
      text === 'musica' ||
      text.startsWith('musica ') ||
      text.endsWith(' musica') ||
      isSymposiumTitle(el)
    );
  }

  function getSymposiumGroup(li) {
    let node = li.parentElement;
    while (node) {
      let prev = node.previousElementSibling;
      while (prev) {
        if (prev.matches('p')) {
          if (isSymposiumTitle(prev)) return prev;
          if (prev.querySelector('.hora')) return null;
        }
        prev = prev.previousElementSibling;
      }
      node = node.parentElement;
      if (!node || node === document.body) break;
    }
    return null;
  }

  function buildId(el, idx) {
    const year = document.documentElement?.dataset?.programYear || '2026';
    const pageKey = getPageKey();
    if (el.matches('li')) {
      const group = getSymposiumGroup(el);
      const groupHour = group?.querySelector('.hora')?.textContent.replace(/:/g, '') || 'symp';
      // Legacy notes used odd positions after inserting each note between list items.
      // Preserve those keys while computing from the original items, not mutated DOM.
      const liIndex = Array.from(el.parentElement.children).filter(node => node.matches('li')).indexOf(el) * 2 + 1;
      return `${year}-${pageKey}-${groupHour}-b${liIndex}`;
    }

    const hour = el.querySelector('.hora')?.textContent.replace(/:/g, '');
    if (hour) return `${year}-${pageKey}-${hour}`;
    return `${year}-${pageKey}-item${idx + 1}`;
  }

  function updateBodyOpenState() {
    const hasOpen = !!document.querySelector('.anotacao-asmb.ativa');
    document.body.classList.toggle('clickable-asmb-open', hasOpen);
  }

  function blurEditor(editor) {
    if (!editor) return;
    try { editor.blur(); } catch {}
    try {
      const sel = window.getSelection?.();
      if (sel && sel.rangeCount) sel.removeAllRanges();
    } catch {}
  }

  function readRecord(id) {
    if (window.AssembleiaIA?.readRecord) return window.AssembleiaIA.readRecord(id);
    return { fullHtml: '', fullText: '', summaryText: '', hasSummary: false, status: 'idle', isVirgin: true };
  }

  function saveInlineDraft(id, html) {
    try {
      if (window.AssembleiaIA?.saveInlineDraft) return window.AssembleiaIA.saveInlineDraft(id, html);
    } catch (_) { /* The storage warning keeps the unsaved draft visible. */ }
    return null;
  }

  function getInlineHTML(recordOrId) {
    if (window.AssembleiaIA?.getInlineHTML) return window.AssembleiaIA.getInlineHTML(recordOrId);
    return '';
  }

  function isSummaryMode(recordOrId) {
    if (window.AssembleiaIA?.isSummaryMode) return window.AssembleiaIA.isSummaryMode(recordOrId);
    return false;
  }

  function getRecordStatus(recordOrId) {
    if (window.AssembleiaIA?.getRecordStatus) return window.AssembleiaIA.getRecordStatus(recordOrId);
    return isSummaryMode(recordOrId) ? 'summarized' : 'idle';
  }

  function isVirginRecord(recordOrId) {
    if (window.AssembleiaIA?.isVirginRecord) return window.AssembleiaIA.isVirginRecord(recordOrId);
    const record = typeof recordOrId === 'string' ? readRecord(recordOrId) : (recordOrId || {});
    return !!record.isVirgin;
  }

  function normalizeRichInline(editor) {
    if (!editor) return;
    editor.querySelectorAll('.node-toggle').forEach((node) => {
      const arrow = node.querySelector('.toggle-arrow');
      const children = node.querySelector('.children');
      if (!arrow) return;
      try { arrow.setAttribute('type', 'button'); } catch {}
      try { arrow.setAttribute('contenteditable', 'false'); } catch {}
      try { arrow.setAttribute('tabindex', '-1'); } catch {}
      const expanded = children ? !children.hasAttribute('hidden') : (arrow.getAttribute('aria-expanded') === 'true');
      arrow.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      node.classList.toggle('is-collapsed', !expanded);
      if (children) {
        if (expanded) children.removeAttribute('hidden');
        else children.setAttribute('hidden', '');
      }
    });
  }

  function toggleInlineNode(arrow, editor, id) {
    const node = arrow?.closest('.node-toggle');
    if (!node) return false;
    const children = node.querySelector('.children');
    const expanded = arrow.getAttribute('aria-expanded') === 'true';
    arrow.setAttribute('aria-expanded', expanded ? 'false' : 'true');
    node.classList.toggle('is-collapsed', expanded);
    if (children) {
      if (expanded) children.setAttribute('hidden', '');
      else children.removeAttribute('hidden');
    }
    pruneGhostRichNodes(editor);
    markEditableEmpties(editor);
    saveInlineDraft(id, editor.innerHTML);
    setEmptyState(editor);
    return true;
  }

  function getMeaningfulText(root) {
    if (!root) return '';
    const clone = root.cloneNode(true);
    clone.querySelectorAll('.toggle-arrow, .text-plus, .expand-handle-asmb, .asmb-status-badge, [hidden], script, style').forEach((n) => n.remove());
    return (clone.textContent || '')
      .replace(/\u200B/g, '')
      .replace(/\u00A0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function markEditableEmpties(editor) {
    if (!editor) return;
    editor.querySelectorAll('.toggle-title, .text-content, .paragraph-content').forEach((editable) => {
      editable.setAttribute('data-empty', getMeaningfulText(editable) ? 'false' : 'true');
    });
  }

  function pruneGhostRichNodes(editor) {
    if (!editor) return;

    const isNodeEmpty = (node) => {
      if (!node) return true;
      const own = node.cloneNode(true);
      own.querySelectorAll('.children, .toggle-arrow, .text-plus, script, style').forEach((n) => n.remove());
      const ownText = getMeaningfulText(own);
      const children = node.querySelector(':scope > .children');
      const childText = children ? getMeaningfulText(children) : '';
      return !ownText && !childText;
    };

    let changed = true;
    while (changed) {
      changed = false;
      const nodes = Array.from(editor.querySelectorAll('.node-toggle, .node-text, .node-paragraph'));
      for (let i = nodes.length - 1; i >= 0; i -= 1) {
        const node = nodes[i];
        if (!editor.contains(node)) continue;
        if (isNodeEmpty(node)) {
          node.remove();
          changed = true;
        }
      }
    }
  }

  function isEffectivelyEmpty(editor) {
    return getMeaningfulText(editor) === '';
  }

  function setEmptyState(editor) {
    editor.classList.toggle('is-empty', isEffectivelyEmpty(editor));
  }

  function cleanEditorIfEmpty(editor) {
    if (!isEffectivelyEmpty(editor)) return false;
    editor.innerHTML = '';
    setEmptyState(editor);
    return true;
  }

  function placeCaretAtEnd(editor) {
    try {
      editor.focus({ preventScroll: true });
      const sel = window.getSelection();
      if (!sel) return;
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch {}
  }

  function getStatusMarkup(status) {
    switch (status) {
      case 'pending':
        return `<svg viewBox="0 0 24 24" aria-hidden="true" class="status-svg status-svg--spinner"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2.2" opacity=".22"></circle><path d="M12 4a8 8 0 0 1 8 8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"></path></svg>`;
      case 'summarized':
        return `<svg viewBox="0 0 24 24" aria-hidden="true" class="status-svg"><path d="M12 2C12 7.52 16.48 12 22 12C16.48 12 12 16.48 12 22C12 16.48 7.52 12 2 12C7.52 12 12 7.52 12 2Z" fill="currentColor"></path></svg>`;
      case 'error_network':
        return `<svg viewBox="0 0 24 24" aria-hidden="true" class="status-svg"><path d="M4.5 9.5A12.5 12.5 0 0 1 12 7a12.5 12.5 0 0 1 7.5 2.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path><path d="M7.5 12.5A8.2 8.2 0 0 1 12 11a8.2 8.2 0 0 1 4.5 1.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path><path d="M10.4 15.5A3.7 3.7 0 0 1 12 15a3.7 3.7 0 0 1 1.6.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path><path d="M4 4l16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path></svg>`;
      case 'error_api':
        return `<svg viewBox="0 0 24 24" aria-hidden="true" class="status-svg"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"></circle><path d="M12 8v4.7l3 1.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>`;
      default:
        return '';
    }
  }

  function getStatusTitle(status, record) {
    switch (status) {
      case 'pending': return 'Gerando resumo';
      case 'summarized': return record?.summaryModel ? `Resumo gerado por IA (${record.summaryModel})` : 'Resumo gerado por IA';
      case 'error_network': return 'Falha de rede';
      case 'error_api': return record?.errorMessage || 'Resumo indisponível';
      default: return '';
    }
  }

  function updateStatusBadge(note, status, record) {
    const badge = note?.querySelector('.asmb-status-badge');
    if (!badge) return;
    badge.dataset.status = status || 'idle';
    badge.innerHTML = getStatusMarkup(status);
    const title = getStatusTitle(status, record);
    badge.hidden = !title;
    badge.setAttribute('aria-hidden', title ? 'false' : 'true');
    if (title) badge.setAttribute('title', title);
    else badge.removeAttribute('title');
  }

  function applyRecordToEditor(editor, note, record) {
    const status = getRecordStatus(record);
    const summaryMode = status === 'summarized';
    const pendingMode = status === 'pending';
    const errorMode = status === 'error_network' || status === 'error_api';

    editor.innerHTML = getInlineHTML(record);
    normalizeRichInline(editor);
    pruneGhostRichNodes(editor);
    markEditableEmpties(editor);
    editor.setAttribute('contenteditable', summaryMode || pendingMode ? 'false' : 'true');
    editor.setAttribute('spellcheck', summaryMode || pendingMode ? 'false' : 'true');
    editor.dataset.rich = /class\s*=\s*["'][^"']*(node-paragraph|node-toggle|node-text)/i.test(editor.innerHTML) ? '1' : '0';
    editor.dataset.virgin = isVirginRecord(record) ? '1' : '0';
    editor.classList.toggle('is-summary', summaryMode);
    editor.classList.toggle('is-pending', pendingMode);
    editor.classList.toggle('has-error-state', errorMode);
    editor.classList.toggle('is-rich-inline', editor.dataset.rich === '1');
    editor.classList.toggle('is-not-virgin', editor.dataset.virgin === '0');

    note.classList.toggle('has-summary', summaryMode);
    note.classList.toggle('is-pending', pendingMode);
    note.classList.toggle('has-error', errorMode);
    note.dataset.status = status;
    updateStatusBadge(note, status, record);
    setEmptyState(editor);
  }

  function getTriggerLabel(trigger) {
    if (!trigger) return '';
    const clone = trigger.cloneNode(true);
    clone.querySelectorAll('.hora').forEach((n) => n.remove());
    return (clone.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function getSymposiumMeta(trigger) {
    if (!trigger || !trigger.matches('li')) {
      return { isSymposium: false, symposiumTitle: '' };
    }
    const group = getSymposiumGroup(trigger);
    if (!group) return { isSymposium: false, symposiumTitle: '' };
    return {
      isSymposium: true,
      symposiumTitle: getTriggerLabel(group)
    };
  }

  function openFullScreen(note) {
    if (!note || note.classList.contains('is-pending')) return;
    if (window.AssembleiaIA?.flushPendingWrites?.() === false) return;
    const special = note.__specialConfig || null;
    if (special?.kind === 'watchtower-shortcut' && special.url) {
      location.href = special.url;
      return;
    }
    const trigger = note.__trigger || note.previousElementSibling || null;
    const editor = note.querySelector('.clickable-asmb[data-id]');
    const id = editor?.dataset.id || '';
    const title = getTriggerLabel(trigger) || 'Anotação';
    const { isSymposium, symposiumTitle } = getSymposiumMeta(trigger);
    const from = location.pathname + location.search + location.hash;
    const url = new URL('./assembleia/anotacoes/clickable/fullsc.html', location.href);
    url.searchParams.set('id', id);
    url.searchParams.set('title', title);
    url.searchParams.set('from', from);
    if (isSymposium) {
      url.searchParams.set('isSymposium', '1');
      url.searchParams.set('symposiumTitle', symposiumTitle);
    }
    const corAtual = getComputedStyle(document.documentElement)
      .getPropertyValue('--cor-global').trim();
    if (corAtual) url.searchParams.set('cor', corAtual);
    location.href = url.toString();
  }

  function bindHandle(note) {
    const handle = note?.querySelector('.expand-handle-asmb');
    if (!handle) return;

    let touchingHandle = false;
    let lastOpenAt = 0;

    const openFromHandle = (event) => {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      const now = Date.now();
      if (now - lastOpenAt < 650) return;
      lastOpenAt = now;
      if (!note.isConnected) return;
      if (note.classList.contains('is-pending') && !(note.__specialConfig?.kind === 'watchtower-shortcut')) return;
      openFullScreen(note);
    };

    handle.addEventListener('touchstart', (e) => {
      touchingHandle = true;
      e.preventDefault();
      e.stopPropagation();
    }, { passive: false });

    handle.addEventListener('touchend', (e) => {
      if (!touchingHandle) return;
      touchingHandle = false;
      openFromHandle(e);
    }, { passive: false });

    handle.addEventListener('touchcancel', () => {
      touchingHandle = false;
    }, { passive: true });

    handle.addEventListener('click', (e) => {
      openFromHandle(e);
    });
  }

  function processPendingForId(id) {
    if (!id) return;
    window.AssembleiaIA?.processPendingSummary?.(id);
  }

  function toggleAnnotationFromTrigger(trigger, note, editor) {
    const willOpen = !note.classList.contains('ativa');

    note.classList.toggle('ativa', willOpen);
    trigger.classList.toggle('ativo', willOpen);

    if (!willOpen) {
      blurEditor(editor);
    } else if (note.__specialConfig?.kind === 'watchtower-shortcut') {
      blurEditor(editor);
    } else {
      const record = readRecord(editor?.dataset?.id || trigger?.getAttribute('data-clickable-id'));
      applyRecordToEditor(editor, note, record);
      if (getRecordStatus(record) === 'pending') processPendingForId(editor?.dataset?.id);
    }

    updateBodyOpenState();
  }

  function makeAnnotation(trigger, idx) {
    const id = buildId(trigger, idx);
    const special = getSpecialNoteConfig(trigger);
    const note = document.createElement('div');
    note.className = 'anotacao-asmb';
    note.__trigger = trigger;
    note.__specialConfig = special || null;

    if (special?.kind === 'watchtower-shortcut') {
      note.classList.add('is-shortcut-note');
      note.setAttribute('data-special-kind', special.kind);
      note.innerHTML = `
        <div class="anotacao-asmb-inner">
          <div class="clickable-asmb-wrap">
            <div class="clickable-asmb clickable-asmb--shortcut is-summary" contenteditable="false" spellcheck="false" data-id="${id}" data-special-kind="${special.kind}" data-placeholder="" aria-readonly="true" tabindex="-1">${special.messageHtml}</div>
            <button class="expand-handle-asmb" type="button" aria-label="${special.handleLabel || 'Abrir atalho'}"></button>
            <span class="asmb-status-badge" hidden aria-hidden="true"></span>
          </div>
        </div>
      `;

      const editor = note.querySelector('.clickable-asmb');
      bindHandle(note);

      editor.addEventListener('beforeinput', (e) => {
        e.preventDefault();
      });
      editor.addEventListener('keydown', (e) => {
        e.preventDefault();
      });
      editor.addEventListener('focus', () => {
        blurEditor(editor);
      });
      editor.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        blurEditor(editor);
      });

      trigger.classList.add('click-trigger-asmb');
      trigger.classList.add('click-trigger-asmb--shortcut');
      trigger.setAttribute('data-clickable-id', id);
      trigger.insertAdjacentElement('afterend', note);

      let sx = 0, sy = 0, st = 0;
      trigger.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) return;
        sx = e.touches[0].clientX;
        sy = e.touches[0].clientY;
        st = Date.now();
      }, { passive: true });

      trigger.addEventListener('touchend', (e) => {
        if (e.changedTouches.length !== 1) return;
        if (e.target.closest('.bbl, a')) return;
        const dx = Math.abs(e.changedTouches[0].clientX - sx);
        const dy = Math.abs(e.changedTouches[0].clientY - sy);
        const dt = Date.now() - st;
        if (dx > 6 || dy > 6 || dt > 450) return;

        toggleAnnotationFromTrigger(trigger, note, editor);
        e.preventDefault();
      }, { passive: false });

      trigger.addEventListener('click', (e) => {
        if (e.target.closest('.bbl, a, .expand-handle-asmb')) return;
        if (Date.now() - st < 600) return;
        toggleAnnotationFromTrigger(trigger, note, editor);
        e.preventDefault();
      });
      return;
    }

    // ATENÇÃO: a estrutura foi alterada para suportar a animação nativa do CSS Grid
    note.innerHTML = `
      <div class="anotacao-asmb-inner">
        <div class="clickable-asmb-wrap">
          <div class="clickable-asmb" contenteditable="true" spellcheck="true" data-id="${id}" data-placeholder="Digite sua anotação"></div>
          <button class="expand-handle-asmb" type="button" aria-label="Expandir anotação"></button>
          <span class="asmb-status-badge" hidden aria-hidden="true"></span>
        </div>
      </div>
    `;

    const editor = note.querySelector('.clickable-asmb');
    applyRecordToEditor(editor, note, readRecord(id));
    bindHandle(note);

    editor.addEventListener('input', () => {
      if (editor.classList.contains('is-summary') || editor.classList.contains('is-pending')) return;

      const isEmpty = isEffectivelyEmpty(editor);

      if (isEmpty) {
        editor.innerHTML = '';
        editor.dataset.virgin = '1';
        editor.classList.remove('is-not-virgin', 'is-rich-inline');

        const record = readRecord(id);
        record.isVirgin = true;
        record.fullHtml = '';
        record.fullText = '';
        try { window.AssembleiaIA.writeRecord(id, record); } catch (_) { return; }
      }

      pruneGhostRichNodes(editor);
      markEditableEmpties(editor);
      setEmptyState(editor);

      const saved = saveInlineDraft(id, editor.innerHTML);
      if (saved && saved.isVirgin && isEmpty) {
        applyRecordToEditor(editor, note, saved);
      }
    });

    editor.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      if (editor.classList.contains('is-summary') || editor.classList.contains('is-pending')) {
        e.preventDefault();
        return;
      }

      const isVirgin = editor.dataset.virgin === '1';

      if (isVirgin) {
        return;
      } else {
        e.preventDefault();
        e.stopPropagation();
        cleanEditorIfEmpty(editor);
        if (!saveInlineDraft(id, editor.innerHTML)) return;
        blurEditor(editor);
        openFullScreen(note);
      }
    });

    editor.addEventListener('blur', () => {
      if (editor.classList.contains('is-summary') || editor.classList.contains('is-pending')) return;
      cleanEditorIfEmpty(editor);
      const saved = saveInlineDraft(id, editor.innerHTML);
      if (saved && saved.isVirgin && isEffectivelyEmpty(editor)) {
        applyRecordToEditor(editor, note, saved);
        return;
      }
      setEmptyState(editor);
    });

    editor.addEventListener('focus', () => {
      setEmptyState(editor);
    });

    editor.addEventListener('click', (e) => {
      const arrow = e.target.closest('.toggle-arrow');
      if (arrow && !editor.classList.contains('is-summary') && !editor.classList.contains('is-pending')) {
        e.preventDefault();
        e.stopPropagation();
        toggleInlineNode(arrow, editor, id);
        return;
      }
      if (e.target.closest('.text-plus')) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (editor.classList.contains('is-summary') || editor.classList.contains('is-pending')) {
        e.preventDefault();
        blurEditor(editor);
        return;
      }
      if (isEffectivelyEmpty(editor)) placeCaretAtEnd(editor);
    });

    trigger.classList.add('click-trigger-asmb');
    trigger.setAttribute('data-clickable-id', id);
    trigger.insertAdjacentElement('afterend', note);

    let sx = 0, sy = 0, st = 0;
    trigger.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      sx = e.touches[0].clientX;
      sy = e.touches[0].clientY;
      st = Date.now();
    }, { passive: true });

    trigger.addEventListener('touchend', (e) => {
      if (e.changedTouches.length !== 1) return;
      if (e.target.closest('.bbl, a')) return;
      const dx = Math.abs(e.changedTouches[0].clientX - sx);
      const dy = Math.abs(e.changedTouches[0].clientY - sy);
      const dt = Date.now() - st;
      if (dx > 6 || dy > 6 || dt > 450) return;

      toggleAnnotationFromTrigger(trigger, note, editor);
      e.preventDefault();
    }, { passive: false });

    trigger.addEventListener('click', (e) => {
      if (e.target.closest('.bbl, a, .expand-handle-asmb')) return;
      if (Date.now() - st < 600) return;
      toggleAnnotationFromTrigger(trigger, note, editor);
      e.preventDefault();
    });
  }

  function collectTriggers(root) {
    const scope = root && root.querySelectorAll ? root : document;
    const triggers =[];
    scope.querySelectorAll('p, li').forEach((el) => {
      if (el.matches('li')) {
        if (getSymposiumGroup(el)) triggers.push(el);
        return;
      }

      if (!el.querySelector('.hora')) return;
      if (el.classList.contains('sec')) return;
      if (el.querySelector('.txt-tema')) return;
      if (isExcludedTrigger(el)) return;
      triggers.push(el);
    });
    return triggers;
  }

  function isShortcutNoteEditor(editor) {
    return !!(editor?.dataset?.specialKind || editor?.closest('.anotacao-asmb')?.classList.contains('is-shortcut-note'));
  }

  function refreshAnnotationsFromStorage() {
    document.querySelectorAll('.clickable-asmb[data-id]').forEach((editor) => {
      if (isShortcutNoteEditor(editor)) return;
      const id = editor.dataset.id;
      const note = editor.closest('.anotacao-asmb');
      // Background cloud refresh must not replace the focused editable DOM/caret.
      if (document.activeElement === editor && editor.getAttribute('contenteditable') === 'true') return;
      applyRecordToEditor(editor, note, readRecord(id));
    });
    triggerPendingSummaries();
  }

  function triggerPendingSummaries() {
    document.querySelectorAll('.clickable-asmb[data-id]').forEach((editor) => {
      if (isShortcutNoteEditor(editor)) return;
      const id = editor.dataset.id;
      const record = readRecord(id);
      if (getRecordStatus(record) === 'pending') processPendingForId(id);
    });
  }

  function syncRecordChange(event) {
    const id = event?.detail?.id;
    if (!id) return;
    const editor = document.querySelector(`.clickable-asmb[data-id="${CSS.escape(id)}"]`);
    if (!editor || isShortcutNoteEditor(editor)) return;
    const note = editor.closest('.anotacao-asmb');
    applyRecordToEditor(editor, note, event.detail.record || readRecord(id));
    if (getRecordStatus(event.detail.record) === 'pending') processPendingForId(id);
  }

  function init(root) {
    const scope = root && root.querySelectorAll ? root : document;
    collectTriggers(scope).forEach((trigger, index) => {
      if (trigger.dataset.asmbBound === 'true') return;
      trigger.dataset.asmbBound = 'true';
      makeAnnotation(trigger, index);
    });
    updateBodyOpenState();
    refreshAnnotationsFromStorage();
  }

  window.AssembleiaClickables = { init, refresh: refreshAnnotationsFromStorage };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => init(document), { once: true });
  } else {
    init(document);
  }

  window.addEventListener('pageshow', refreshAnnotationsFromStorage);
  window.addEventListener('focus', refreshAnnotationsFromStorage);
  window.addEventListener('assembleia:recordchange', syncRecordChange);
})();