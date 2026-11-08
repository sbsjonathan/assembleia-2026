document.addEventListener('DOMContentLoaded', () => {
  if (typeof M1_Config === 'undefined' || !M1_Config.editor || !M1_Config.toolbar) return;

  const editor = M1_Config.editor;
  const PERF_LOW = !!(window.EditorPerfProfile?.isLow?.() || document.documentElement.classList.contains('perf-low'));
  const toolbar = M1_Config.toolbar;
  const bulletBtn = toolbar.querySelector('[aria-label="Lista"]');

  if (!bulletBtn) return;


const bindTapIntent = (el, handler, { delay = 240, slop = 10, preventFocus = true } = {}) => {
  if (!el || typeof handler !== 'function') return;

  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let moved = false;
  let lastFire = 0;

  const nowOk = () => {
    const now = Date.now();
    if (now - lastFire < delay) return false;
    lastFire = now;
    return true;
  };

  const begin = (x, y, id = null) => {
    pointerId = id;
    startX = x;
    startY = y;
    moved = false;
  };

  const track = (x, y) => {
    if (moved) return;
    if (Math.hypot(x - startX, y - startY) > slop) moved = true;
  };

  const finish = e => {
    const wasMoved = moved;
    pointerId = null;
    moved = false;
    if (wasMoved || !nowOk()) {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    handler(e);
  };

  el.addEventListener('pointerdown', e => {
    if (preventFocus) e.preventDefault();
    begin(e.clientX, e.clientY, e.pointerId);
  });

  el.addEventListener('pointermove', e => {
    if (pointerId !== e.pointerId) return;
    track(e.clientX, e.clientY);
  });

  el.addEventListener('pointercancel', () => {
    pointerId = null;
    moved = false;
  });

  el.addEventListener('pointerup', e => {
    if (pointerId !== e.pointerId) return;
    e.preventDefault();
    finish(e);
  });

  el.addEventListener('touchstart', e => {
    if (preventFocus) e.preventDefault();
    const t = e.changedTouches[0];
    if (!t) return;
    begin(t.clientX, t.clientY, t.identifier);
  }, { passive: false });

  el.addEventListener('touchmove', e => {
    const t = Array.from(e.changedTouches).find(t => pointerId === null || t.identifier === pointerId);
    if (!t) return;
    track(t.clientX, t.clientY);
    if (moved) e.preventDefault();
  }, { passive: false });

  el.addEventListener('touchcancel', () => {
    pointerId = null;
    moved = false;
  }, { passive: false });

  el.addEventListener('touchend', e => {
    const t = Array.from(e.changedTouches).find(t => pointerId === null || t.identifier === pointerId);
    if (!t) return;
    e.preventDefault();
    finish(e);
  }, { passive: false });

  el.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
  });
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

  const isBlockedEditable = editable => {
    if (!editable) return true;
    return editable.classList.contains('toggle-title');
  };

  const typeFromAncestors = range => {
    let node = range?.startContainer?.nodeType === 3 ? range.startContainer.parentNode : range?.startContainer;
    while (node && node !== editor) {
      if (node.nodeType === 1 && node.tagName === 'UL') return 'unordered';
      if (node.nodeType === 1 && node.tagName === 'OL') return 'ordered';
      node = node.parentNode;
    }
    return null;
  };

  const getListType = () => {
    const range = getEditorRange();
    if (range) {
      const ancestorType = typeFromAncestors(range);
      if (ancestorType) return ancestorType;
      try {
        if (document.queryCommandState('insertOrderedList')) return 'ordered';
        if (document.queryCommandState('insertUnorderedList')) return 'unordered';
      } catch (err) {}
      return null;
    }
    // The top panel can take focus without discarding the editor selection.
    const saved = M1_Config.state.lastR;
    if (!saved || !insideEditor(saved.startContainer) || !insideEditor(saved.endContainer)) return null;
    return typeFromAncestors(saved);
  };

  const queryState = () => !!getEditorRange() && getListType() === 'unordered';

  const setPressed = active => {
    bulletBtn.classList.toggle('is-active', !!active);
    bulletBtn.setAttribute('aria-pressed', String(!!active));
  };

  const syncButton = () => {
    const editable = getActiveEditable();
    const blocked = isBlockedEditable(editable);
    bulletBtn.classList.toggle('is-blocked', blocked);
    bulletBtn.disabled = blocked;
    bulletBtn.setAttribute('aria-disabled', String(blocked));
    if (blocked) {
      setPressed(false);
      return;
    }
    setPressed(queryState());
  };

  const applyList = (ordered = false) => {
    if (!ensureSelection()) return;
    const editable = getActiveEditable();
    if (isBlockedEditable(editable)) {
      syncButton();
      return;
    }

    window.M12_History?.beforeChange?.();

    try {
      editable.focus({ preventScroll: true });
    } catch (err) {
      editable.focus();
    }

    M4_Caret.restR();

    try {
      document.execCommand(ordered ? 'insertOrderedList' : 'insertUnorderedList', false, null);
    } catch (err) {}

    M3_TextModel.sync(editable);
    M4_Caret.saveR();
    M4_Caret.updateFocus();
    window.M12_History?.afterChange?.(2);

    syncButton();
    queueSyncUI()
    requestAnimationFrame(() => requestAnimationFrame(syncButton));
    setTimeout(syncButton, 60);
  };

  let uiSyncRaf = 0;
  const queueSyncUI = () => {
    if (uiSyncRaf) return;
    uiSyncRaf = requestAnimationFrame(() => {
      uiSyncRaf = 0;
      syncButton();
    });
  };

  Object.assign(window.NotesEditorActions ||= {}, {
    list: () => applyList(),
    orderedList: () => applyList(true),
    getListType
  });

  bindTapIntent(bulletBtn, e => {
    if (e) e.preventDefault();
    applyList();
  });

  document.addEventListener('selectionchange', () => {
    queueSyncUI()
  });

  editor.addEventListener('input', () => {
    queueSyncUI()
  });

  editor.addEventListener('focus', () => {
    queueSyncUI()
  }, true);

  editor.addEventListener('blur', () => {
    setTimeout(syncButton, 60);
  }, true);

  document.addEventListener('keydown', e => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    const key = (e.key || '').toLowerCase();
    if (key !== 'l') return;
    if (!ensureSelection()) return;
    e.preventDefault();
    applyList();
  });

  syncButton();
});
