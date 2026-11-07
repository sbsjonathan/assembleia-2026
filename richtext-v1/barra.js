document.addEventListener('DOMContentLoaded', () => {
  if (typeof M1_Config === 'undefined') return;

  const toolbar = M1_Config.toolbar;
  const PERF_LOW = !!(window.EditorPerfProfile?.isLow?.() || document.documentElement.classList.contains('perf-low'));
  const allButtons = toolbar.querySelectorAll('.tool-btn');

  const TOUCH_SLOP = 12;
  let touchTrack = null;
  let suppressToolbarClickUntil = 0;

  const findTrackedTouch = touches => {
    if (!touchTrack) return null;
    return Array.from(touches ||[]).find(t => t.identifier === touchTrack.id) || null;
  };

  toolbar.addEventListener('touchstart', e => {
    const btn = e.target.closest('.tool-btn');
    const t = e.changedTouches?.[0];
    if (!btn || !t || btn.disabled) return;

    touchTrack = {
      id: t.identifier,
      x: t.clientX,
      y: t.clientY,
      moved: false,
      button: btn
    };

    btn.classList.add('is-pressed');
  }, { passive: true, capture: true });

  toolbar.addEventListener('touchmove', e => {
    const t = findTrackedTouch(e.changedTouches);
    if (!t || !touchTrack) return;

    if (Math.hypot(t.clientX - touchTrack.x, t.clientY - touchTrack.y) > TOUCH_SLOP) {
      touchTrack.moved = true;
      suppressToolbarClickUntil = Date.now() + 450;
      touchTrack.button?.classList.remove('is-pressed');
    }
  }, { passive: true, capture: true });

  toolbar.addEventListener('touchend', e => {
    const t = findTrackedTouch(e.changedTouches);
    if (!t || !touchTrack) return;

    const moved = touchTrack.moved;
    touchTrack.button?.classList.remove('is-pressed');
    touchTrack = null;

    if (moved) {
      suppressToolbarClickUntil = Date.now() + 450;
      e.preventDefault();
      e.stopPropagation();
    }
  }, { passive: false, capture: true });

  toolbar.addEventListener('touchcancel', () => {
    touchTrack?.button?.classList.remove('is-pressed');
    touchTrack = null;
    suppressToolbarClickUntil = Date.now() + 450;
  }, { passive: true, capture: true });

  // NOVO: Impede que o editor perca o foco se o usuário clicar no fundo vazio da barra
  toolbar.addEventListener('mousedown', e => {
    e.preventDefault();
  });

  toolbar.addEventListener('click', e => {
    if (Date.now() < suppressToolbarClickUntil) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);

  allButtons.forEach(btn => {
    btn.addEventListener('pointerdown', e => {
      if (e.pointerType && e.pointerType !== 'touch') e.preventDefault();
    });
    btn.addEventListener('mousedown', e => e.preventDefault());
  });

  const btnBold = toolbar.querySelector('[aria-label="Negrito"]');
  const btnItalic = toolbar.querySelector('[aria-label="Itálico"]');
  const btnList = toolbar.querySelector('[aria-label="Lista"]');

  const syncBubbles = () => {
    try {
      if (btnBold) btnBold.classList.toggle('is-active', document.queryCommandState('bold'));
      if (btnItalic) btnItalic.classList.toggle('is-active', document.queryCommandState('italic'));
      if (btnList) btnList.classList.toggle('is-active', document.queryCommandState('insertUnorderedList'));
    } catch (e) {}
  };

  let bubbleRaf = 0;
  const queueSyncBubbles = () => {
    if (bubbleRaf) return;
    bubbleRaf = requestAnimationFrame(() => {
      bubbleRaf = 0;
      syncBubbles();
    });
  };

  document.addEventListener('selectionchange', PERF_LOW ? queueSyncBubbles : syncBubbles);
  const editor = document.getElementById('editor');
  if (editor) {
    editor.addEventListener('input', queueSyncBubbles);
    editor.addEventListener('keyup', queueSyncBubbles);
    editor.addEventListener('mouseup', queueSyncBubbles);
  }
  setTimeout(queueSyncBubbles, 100);

  const addToggleButton = M1_Config.btn;
  const undoButton = toolbar.querySelector('[aria-label="Desfazer"]');
  const redoButton = toolbar.querySelector('[aria-label="Refazer"]');

  const syncHistoryButtons = () => {
    const canUndo = !!window.M12_History?.canUndo?.();
    const canRedo = !!window.M12_History?.canRedo?.();

    if (undoButton) {
      undoButton.classList.toggle('is-muted', !canUndo);
      undoButton.disabled = !canUndo;
      undoButton.setAttribute('aria-disabled', String(!canUndo));
    }
    if (redoButton) {
      redoButton.classList.toggle('is-muted', !canRedo);
      redoButton.disabled = !canRedo;
      redoButton.setAttribute('aria-disabled', String(!canRedo));
    }
  };

  const bindToolbarAction = (button, handler) => {
    if (!button) return;

    let firedAt = 0;

    button.addEventListener('click', e => {
      if (e) e.preventDefault();
      if (Date.now() < suppressToolbarClickUntil) return;
      if (button.disabled || button.getAttribute('aria-disabled') === 'true') return;

      const now = Date.now();
      if (now - firedAt < 240) return;
      firedAt = now;
      handler();
    });
  };

  bindToolbarAction(addToggleButton, () => {
    window.M12_History?.beforeChange?.();
    M4_Caret.restR();
    M7_Actions.newRootToggle();
    window.M12_History?.afterChange?.(2);
  });

  bindToolbarAction(undoButton, () => {
    window.M12_History?.undo?.();
  });

  bindToolbarAction(redoButton, () => {
    window.M12_History?.redo?.();
  });

  document.addEventListener('history:statechange', syncHistoryButtons);
  syncHistoryButtons();
});