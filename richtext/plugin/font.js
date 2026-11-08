document.addEventListener('DOMContentLoaded', () => {
  if (typeof M1_Config === 'undefined' || !M1_Config.editor || !M1_Config.toolbar) return;

  const editor   = M1_Config.editor;
  const PERF_LOW = !!(window.EditorPerfProfile?.isLow?.() || document.documentElement.classList.contains('perf-low'));
  const toolbar  = M1_Config.toolbar;
  const fontBtn  = toolbar.querySelector('[aria-label="Tamanho da Fonte"]');
  if (!fontBtn) return;

  const fontLabel = fontBtn.querySelector('.font-label');


const bindTapIntent = (el, handler, { delay = 240, slop = 10, preventFocus = true } = {}) => {
  if (!el || typeof handler !== 'function') return;

  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let moved = false;
  let lastFire = 0;

  const canRun = () => {
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
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

  const reset = () => {
    pointerId = null;
    moved = false;
  };

  const finish = e => {
    const wasMoved = moved;
    reset();
    if (wasMoved || !canRun()) {
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

  el.addEventListener('pointercancel', reset);

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
    if (moved && preventFocus) e.preventDefault();
  }, { passive: false });

  el.addEventListener('touchcancel', reset, { passive: false });

  el.addEventListener('touchend', e => {
    const t = Array.from(e.changedTouches).find(t => pointerId === null || t.identifier === pointerId);
    if (!t) return;
    e.preventDefault();
    finish(e);
  }, { passive: false });

  el.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    if (e.detail === 0 && canRun()) handler(e);
  });
};


  // ── Configuração dos tamanhos ──────────────────────────────────────────────
  const SIZES = [
    { key: 'h1',     label: 'Título',    display: 'T1' },
    { key: 'h2',     label: 'Subtítulo', display: 'T2' },
    { key: 'h3',     label: 'Seção',     display: 'T3' },
    { key: 'normal', label: 'Normal',    display: 'Aa' },
  ];

  const FONT_CLASSES = ['font-h1', 'font-h2', 'font-h3'];

  // ── Dropdown ─────────────────────────────────────────────────────────────
  // Appendado ao body para escapar do overflow:hidden do pill-container
  const dropdown = document.createElement('div');
  dropdown.id = 'notes-font-menu';
  dropdown.className = 'font-dropdown';
  dropdown.setAttribute('role', 'listbox');
  dropdown.setAttribute('aria-label', 'Tamanho da fonte');
  dropdown.innerHTML = SIZES.map(s => `
    <button class="font-option" data-size="${s.key}" type="button" role="option" aria-selected="false">
      <span class="font-option-label font-option-label--${s.key}">${s.label}</span>
    </button>
  `).join('');
  document.body.appendChild(dropdown);
  fontBtn.setAttribute('aria-controls', dropdown.id);
  fontBtn.setAttribute('aria-expanded', 'false');

  let isOpen = false;

  // ── Helpers ───────────────────────────────────────────────────────────────
  const insideEditor = node => {
    const base = node?.nodeType === 3 ? node.parentNode : node;
    return !!base && editor.contains(base);
  };

  const getEditorRange = () => {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const r = sel.getRangeAt(0);
    if (!insideEditor(r.startContainer)) return null;
    return r;
  };

  const getActiveEditable = () => {
    const r = getEditorRange();
    if (!r) return null;
    return M2_Query.closest(r.startContainer, '.editable');
  };

  // Font só funciona em paragraph-content.
  // toggle-title e text-content ficam bloqueados.
  const isBlocked = editable => {
    if (!editable) return true;
    return editable.classList.contains('toggle-title') ||
           editable.classList.contains('text-content');
  };

  const getActiveParagraphNode = () => {
    const editable = getActiveEditable();
    if (isBlocked(editable)) return null;
    return editable?.closest('.node-paragraph') ?? null;
  };

  const readCurrentSize = node => {
    if (!node) return 'normal';
    if (node.classList.contains('font-h1')) return 'h1';
    if (node.classList.contains('font-h2')) return 'h2';
    if (node.classList.contains('font-h3')) return 'h3';
    return 'normal';
  };

  // ── Estado do botão ───────────────────────────────────────────────────────
  const syncButton = () => {
    const editable = getActiveEditable();
    const blocked  = isBlocked(editable);

    fontBtn.classList.toggle('is-blocked', blocked);
    fontBtn.disabled = blocked;
    fontBtn.setAttribute('aria-disabled', String(blocked));

    const node  = blocked ? null : getActiveParagraphNode();
    const size  = readCurrentSize(node);
    const entry = SIZES.find(s => s.key === size);

    if (fontLabel) fontLabel.textContent = entry?.display ?? 'Aa';

    // Marca opção selecionada no dropdown
    dropdown.querySelectorAll('.font-option').forEach(opt => {
      const sel = opt.dataset.size === size;
      opt.classList.toggle('is-selected', sel);
      opt.setAttribute('aria-selected', String(sel));
    });
  };

  // ── Posicionamento do dropdown ────────────────────────────────────────────
  const positionDropdown = () => {
    const viewport = window.visualViewport;
    const visibleTop = Math.max(0, viewport?.offsetTop || 0);
    const visibleLeft = Math.max(0, viewport?.offsetLeft || 0);
    const visibleHeight = viewport?.height || innerHeight;
    const visibleWidth = viewport?.width || innerWidth;
    const rect = fontBtn.getBoundingClientRect();
    const dropW = Math.min(168, Math.max(1, visibleWidth - 16));
    const available = Math.max(1, visibleHeight - 16);
    dropdown.style.width = `${dropW}px`;
    dropdown.style.maxHeight = `${available}px`;
    const dropH = Math.min(dropdown.scrollHeight, available);
    const left = Math.max(visibleLeft + 8, Math.min(rect.left + rect.width / 2 - dropW / 2, visibleLeft + visibleWidth - dropW - 8));
    const top = Math.max(visibleTop + 8, Math.min(rect.top - dropH - 10, visibleTop + visibleHeight - dropH - 8));
    dropdown.style.left = `${left}px`;
    dropdown.style.top = `${top}px`;
    dropdown.style.bottom = 'auto';
  };
  let positionFrame = 0;
  const queuePosition = () => {
    if (!isOpen || positionFrame) return;
    positionFrame = requestAnimationFrame(() => { positionFrame = 0; if (isOpen) positionDropdown(); });
  };
  window.addEventListener('resize', queuePosition, {passive:true});
  window.visualViewport?.addEventListener('resize', queuePosition, {passive:true});
  window.visualViewport?.addEventListener('scroll', queuePosition, {passive:true});
  document.addEventListener('editor:viewport-layout', queuePosition);

  // ── Abrir / fechar ────────────────────────────────────────────────────────
  const openDropdown = () => {
    M4_Caret.saveR(); // salva range antes de perder foco
    syncButton();
    positionDropdown();
    dropdown.classList.add('is-open');
    isOpen = true;
    fontBtn.setAttribute('aria-expanded', 'true');
  };

  const closeDropdown = () => {
    dropdown.classList.remove('is-open');
    isOpen = false;
    fontBtn.setAttribute('aria-expanded', 'false');
    cancelAnimationFrame(positionFrame); positionFrame = 0;
  };

  // ── Aplicar tamanho ───────────────────────────────────────────────────────
  const applySize = size => {
    // Restaura seleção salva no momento da abertura do dropdown
    M4_Caret.restR();

    const node = getActiveParagraphNode();
    if (!node) return;

    window.M12_History?.beforeChange?.();

    // Troca de classe no node-paragraph
    FONT_CLASSES.forEach(c => node.classList.remove(c));
    if (size !== 'normal') node.classList.add(`font-${size}`);

    M3_TextModel.syncAll();

    // Re-foca o editable e restaura cursor
    const editable = node.querySelector('.paragraph-content');
    if (editable) {
      try { editable.focus({ preventScroll: true }); } catch (e) { editable.focus(); }
      M4_Caret.restR();
    }

    M4_Caret.saveR();
    M4_Caret.updateFocus();
    window.M12_History?.afterChange?.(2);

    queueSyncUI()
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
    blockStyle: size => {
      if (!SIZES.some(entry => entry.key === size)) return;
      closeDropdown();
      applySize(size);
    }
  });

// ── Botão principal ───────────────────────────────────────────────────────
bindTapIntent(fontBtn, e => {
  if (e) e.preventDefault();
  if (isOpen) closeDropdown();
  else openDropdown();
});

// ── Opções do dropdown ────────────────────────────────────────────────────
dropdown.querySelectorAll('.font-option').forEach(opt => {
  bindTapIntent(opt, e => {
    if (e) e.preventDefault();
    closeDropdown();
    applySize(opt.dataset.size);
  }, {preventFocus:false});
});

  // ── Fecha ao clicar fora ──────────────────────────────────────────────────
  document.addEventListener('pointerdown', e => {
    if (isOpen && !fontBtn.contains(e.target) && !dropdown.contains(e.target)) {
      closeDropdown();
    }
  });
  document.addEventListener('keydown', e => {
    if (isOpen && e.key === 'Escape') {
      e.preventDefault(); closeDropdown(); M4_Caret.restR();
    }
  });

  // ── Sincroniza com movimento do cursor ────────────────────────────────────
  document.addEventListener('selectionchange', queueSyncUI);
  editor.addEventListener('input',  queueSyncUI);
  editor.addEventListener('focus',  queueSyncUI, true);
  editor.addEventListener('blur',   () => setTimeout(syncButton, PERF_LOW ? 120 : 60), true);

  // ── Patch no M12_History para font sobreviver undo/redo ──────────────────
  //
  // M12_History.serializeNode salva apenas o innerHTML do .paragraph-content,
  // mas a classe font-h1/h2/h3 fica no .node-paragraph (o pai).
  // Este patch estende a serialização sem tocar em undo.js.
  //
  const patchHistory = () => {
    if (!window.M12_History) { setTimeout(patchHistory, 50); return; }

    const origSerialize   = M12_History.serializeNode.bind(M12_History);
    const origDeserialize = M12_History.deserializeNode.bind(M12_History);

    M12_History.serializeNode = function (node) {
      const tree = origSerialize(node);
      if (tree?.type === 'paragraph') {
        const fc = FONT_CLASSES.find(c => node.classList.contains(c));
        if (fc) tree.fontClass = fc;
      }
      return tree;
    };

    M12_History.deserializeNode = function (tree) {
      const node = origDeserialize(tree);
      if (node && tree?.type === 'paragraph' && tree.fontClass) {
        node.classList.add(tree.fontClass);
      }
      return node;
    };
  };
  // O comportamento do Enter fica centralizado no editor.js.

  patchHistory();
  syncButton();
});
