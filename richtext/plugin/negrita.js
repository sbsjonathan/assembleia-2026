document.addEventListener('DOMContentLoaded', () => {
  if (typeof M1_Config === 'undefined' || !M1_Config.editor || !M1_Config.toolbar) return;

  const editor = M1_Config.editor;
  const PERF_LOW = !!(window.EditorPerfProfile?.isLow?.() || document.documentElement.classList.contains('perf-low'));
  const toolbar = M1_Config.toolbar;
  const boldBtn = toolbar.querySelector('[aria-label="Negrito"]');
  const italicBtn = toolbar.querySelector('[aria-label="Itálico"]');

  if (!boldBtn || !italicBtn) return;

  const typingState = {
    bold: null,
    italic: null
  };

  const typingRef = {
    editable: null,
    container: null,
    offset: 0
  };

  const insideEditor = node => {
    const base = node?.nodeType === 3 ? node.parentNode : node;
    return !!base && editor.contains(base);
  };

  const getEditorRange = () => {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    if (!insideEditor(range.startContainer) || !insideEditor(range.endContainer)) return null;
    const startEditable = M2_Query.closest(range.startContainer, '.editable');
    const endEditable = M2_Query.closest(range.endContainer, '.editable');
    if (!startEditable || !endEditable || startEditable !== endEditable) return null;
    return range;
  };

  const getActiveEditable = () => {
    const range = getEditorRange();
    if (!range) return null;
    return M2_Query.closest(range.startContainer, '.editable');
  };

  const ensureSelection = () => {
    if (getEditorRange()) return true;
    M4_Caret.restR();
    return !!getEditorRange();
  };

  const clearTypingState = () => {
    typingState.bold = null;
    typingState.italic = null;
    typingRef.editable = null;
    typingRef.container = null;
    typingRef.offset = 0;
  };

  const saveTypingStateRef = range => {
    if (!range || !range.collapsed) {
      clearTypingState();
      return;
    }
    typingRef.editable = M2_Query.closest(range.startContainer, '.editable');
    typingRef.container = range.startContainer;
    typingRef.offset = range.startOffset;
  };

  const typingStateStillValid = range => {
    if (!range || !range.collapsed) return false;
    const editable = M2_Query.closest(range.startContainer, '.editable');
    return !!editable &&
      editable === typingRef.editable &&
      range.startContainer === typingRef.container &&
      range.startOffset === typingRef.offset;
  };

  const stateFromAncestors = (command, range) => {
    const editable = M2_Query.closest(range?.startContainer, '.editable');
    if (!editable) return false;

    const tags = command === 'bold'
      ? ['B', 'STRONG']
      : ['I', 'EM'];

    let node = range.startContainer?.nodeType === 3 ? range.startContainer.parentNode : range.startContainer;
    while (node && node !== editable) {
      if (node.nodeType === 1 && tags.includes(node.tagName)) return true;
      node = node.parentNode;
    }

    const probe = range.startContainer?.nodeType === 1
      ? range.startContainer
      : range.startContainer?.parentElement;

    if (!probe) return false;

    const style = window.getComputedStyle(probe);

    if (command === 'bold') {
      const weight = style.fontWeight;
      return weight === 'bold' || parseInt(weight, 10) >= 600;
    }

    return style.fontStyle === 'italic';
  };

  const queryNativeState = command => {
    try {
      return !!document.queryCommandState(command);
    } catch (err) {
      return false;
    }
  };

  const getComputedCommandState = command => {
    const range = getEditorRange();
    if (!range) return false;

    if (range.collapsed && typingStateStillValid(range) && typeof typingState[command] === 'boolean') {
      return typingState[command];
    }

    if (queryNativeState(command)) return true;
    return stateFromAncestors(command, range);
  };

  const getBothStates = () => ({
    bold: getComputedCommandState('bold'),
    italic: getComputedCommandState('italic')
  });

  const setPressed = (button, active) => {
    button.classList.toggle('is-active', !!active);
    button.setAttribute('aria-pressed', String(!!active));
  };

  const syncButtons = () => {
    const state = getBothStates();
    setPressed(boldBtn, state.bold);
    setPressed(italicBtn, state.italic);
  };

  const exec = command => {
    try {
      document.execCommand('styleWithCSS', false, false);
    } catch (err) {}

    try {
      document.execCommand(command, false, null);
    } catch (err) {}
  };

  const enforceCollapsedState = desired => {
    const order = ['bold', 'italic'];

    order.forEach(command => {
      const current = queryNativeState(command);
      const want = !!desired[command];
      if (current !== want) {
        exec(command);
      }
    });
  };

  const updateTypingStateFromRange = () => {
    const range = getEditorRange();
    if (!range || !range.collapsed) {
      clearTypingState();
      return;
    }

    saveTypingStateRef(range);
    typingState.bold = queryNativeState('bold') || stateFromAncestors('bold', range);
    typingState.italic = queryNativeState('italic') || stateFromAncestors('italic', range);
  };

  const applyCommand = command => {
    if (!ensureSelection()) return;

    const editable = getActiveEditable();
    const rangeBefore = getEditorRange();

    if (!editable || !rangeBefore) return;

    const collapsed = rangeBefore.collapsed;
    const beforeState = getBothStates();

    window.M12_History?.beforeChange?.();

    try {
      editable.focus({ preventScroll: true });
    } catch (err) {
      editable.focus();
    }

    M4_Caret.restR();

    if (!collapsed) {
      exec(command);
      M3_TextModel.sync(editable);
      M4_Caret.saveR();
      M4_Caret.updateFocus();
      clearTypingState();
      window.M12_History?.afterChange?.(2);
      queueSyncUI()
      setTimeout(syncButtons, 0);
      return;
    }

    const desired = {
      bold: beforeState.bold,
      italic: beforeState.italic
    };

    desired[command] = !beforeState[command];

    exec(command);

    M3_TextModel.sync(editable);
    M4_Caret.saveR();
    M4_Caret.updateFocus();

    M4_Caret.restR();
    enforceCollapsedState(desired);

    M4_Caret.saveR();
    M4_Caret.updateFocus();

    const rangeAfter = getEditorRange();
    if (rangeAfter && rangeAfter.collapsed) {
      saveTypingStateRef(rangeAfter);
      typingState.bold = desired.bold;
      typingState.italic = desired.italic;
    } else {
      clearTypingState();
    }

    window.M12_History?.afterChange?.(2);

    queueSyncUI()
    setTimeout(syncButtons, 0);
  };

  const bindAction = (button, command) => {
    let firedAt = 0;
    const TOUCH_SLOP = 12;
    let touchTrack = null;
    let suppressClickUntil = 0;

    const trigger = e => {
      if (e) e.preventDefault();
      if (button.disabled || button.getAttribute('aria-disabled') === 'true') return;
      if (Date.now() < suppressClickUntil) return;
      const now = Date.now();
      if (now - firedAt < 240) return;
      firedAt = now;
      applyCommand(command);
    };

    button.addEventListener('touchstart', e => {
      const t = e.changedTouches?.[0];
      if (!t) return;
      touchTrack = {
        id: t.identifier,
        x: t.clientX,
        y: t.clientY,
        moved: false
      };
    }, { passive: true, capture: true });

    button.addEventListener('touchmove', e => {
      if (!touchTrack) return;
      const t = Array.from(e.changedTouches || []).find(t => t.identifier === touchTrack.id);
      if (!t) return;
      if (Math.hypot(t.clientX - touchTrack.x, t.clientY - touchTrack.y) > TOUCH_SLOP) {
        touchTrack.moved = true;
        suppressClickUntil = Date.now() + 450;
      }
    }, { passive: true, capture: true });

    button.addEventListener('touchend', e => {
      if (!touchTrack) return;
      const t = Array.from(e.changedTouches || []).find(t => t.identifier === touchTrack.id);
      if (!t) return;
      const moved = touchTrack.moved;
      touchTrack = null;

      if (moved) {
        suppressClickUntil = Date.now() + 450;
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      trigger(e);
      e.stopPropagation();
    }, { passive: false, capture: true });

    button.addEventListener('touchcancel', () => {
      touchTrack = null;
      suppressClickUntil = Date.now() + 450;
    }, { passive: true, capture: true });

    button.addEventListener('click', e => {
      if (Date.now() < suppressClickUntil) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      trigger(e);
    });
  };

  let uiSyncRaf = 0;
  const queueSyncUI = () => {
    if (uiSyncRaf) return;
    uiSyncRaf = requestAnimationFrame(() => {
      uiSyncRaf = 0;
      syncButtons();
    });
  };

  bindAction(boldBtn, 'bold');
  bindAction(italicBtn, 'italic');

  document.addEventListener('selectionchange', () => {
    const range = getEditorRange();
    if (!typingStateStillValid(range)) {
      clearTypingState();
    }
    queueSyncUI()
  });

  editor.addEventListener('input', () => {
    const range = getEditorRange();
    if (!typingStateStillValid(range)) {
      clearTypingState();
    }
    queueSyncUI()
  });

  editor.addEventListener('focus', () => {
    queueSyncUI()
  }, true);

  editor.addEventListener('blur', () => {
    clearTypingState();
    setTimeout(syncButtons, 60);
  }, true);

  document.addEventListener('keydown', e => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    const key = (e.key || '').toLowerCase();
    if (key !== 'b' && key !== 'i') return;
    if (!ensureSelection()) return;
    e.preventDefault();
    applyCommand(key === 'b' ? 'bold' : 'italic');
  });

  window.M13_Negrita = {
    clearTypingState,
    syncButtons,
    forceTypingState(state = {}) {
      clearTypingState();
      const range = getEditorRange();
      if (range && range.collapsed) {
        saveTypingStateRef(range);
        if (typeof state.bold === 'boolean') typingState.bold = !!state.bold;
        if (typeof state.italic === 'boolean') typingState.italic = !!state.italic;
      }
      queueSyncUI()
    }
  };

  syncButtons();
});