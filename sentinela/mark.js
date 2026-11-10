(() => {
  const css = `
    mark[class^="hl-color-"] {
      background-color: transparent;
      color: inherit !important;
      padding: 0;
      background-image: none;
      animation: none;
      mix-blend-mode: multiply;
      border-radius: 2px;
    }

    html[data-theme="dark"] mark[class^="hl-color-"] {
      mix-blend-mode: normal;
      color: inherit !important;
    }

    @media (prefers-color-scheme: dark) {
      html:not([data-theme="light"]) mark[class^="hl-color-"] {
        mix-blend-mode: normal;
        color: inherit !important;
      }
    }
    
    mark.hl-color-yellow { background-color: #FFEC0D66 !important; }
    mark.hl-color-green { background-color: #B7E49266 !important; }
    mark.hl-color-blue { background-color: #98D8FF66 !important; }
    mark.hl-color-purple { background-color: #C1A7E266 !important; }
    mark.hl-color-pink { background-color: #DD89A966 !important; }
    mark.hl-color-orange { background-color: #E5A77C66 !important; }

    .hl-btn.hl-color-yellow, .hl-color-swatch.hl-color-yellow { background-color: #FFEC0D !important; }
    .hl-btn.hl-color-green, .hl-color-swatch.hl-color-green { background-color: #B7E492 !important; }
    .hl-btn.hl-color-blue, .hl-color-swatch.hl-color-blue { background-color: #98D8FF !important; }
    .hl-btn.hl-color-purple, .hl-color-swatch.hl-color-purple { background-color: #C1A7E2 !important; }
    .hl-btn.hl-color-pink, .hl-color-swatch.hl-color-pink { background-color: #DD89A9 !important; }
    .hl-btn.hl-color-orange, .hl-color-swatch.hl-color-orange { background-color: #E5A77C !important; }

    #hl-custom-menu {
      position: absolute;
      z-index: 990; /* Abaixo dos modais (1000) e Navbar (1000) */
      display: none;
      align-items: center;
      background: #2a2a2c;
      border-radius: 8px;
      padding: 6px 8px;
      box-shadow: 0 4px 14px rgba(0,0,0,0.3);
      gap: 12px;
      transform: translateX(-50%);
      transition: top 0.2s, left 0.2s;
    }
    #hl-custom-menu.hl-expanded .hl-color-btn-main { display: none; }
    #hl-custom-menu.hl-expanded .hl-palette { display: flex; }
    
    #hl-custom-menu.recap-only .hl-color-btn-main { display: none !important; }
    #hl-custom-menu.recap-only .hl-palette { display: none !important; }
    #hl-custom-menu.recap-only .hl-divider { display: none !important; }
    #hl-custom-menu.recap-only .hl-btn-trash { opacity: 1 !important; pointer-events: auto !important; }

    .hl-palette {
      display: none;
      gap: 10px;
      align-items: center;
    }
    .hl-btn {
      appearance: none;
      width: 24px;
      height: 24px;
      padding: 0;
      border-radius: 50%;
      border: 2px solid transparent;
      cursor: pointer;
      flex-shrink: 0;
      transition: transform 0.1s;
    }
    .hl-btn:active { transform: scale(0.85); }
    .hl-btn.hl-color-btn-main {
      position: relative;
      width: 32px;
      height: 32px;
      background: transparent !important;
      border: 0;
    }
    .hl-color-swatch { position: absolute; border-radius: 50%; box-sizing: border-box; pointer-events: none; }
    .hl-color-front { width: 20px; height: 20px; left: 6px; top: 6px; border: 1px solid rgba(0,0,0,.12); z-index: 2; }
    .hl-color-peek { display: none; width: 14px; height: 14px; border: 1px solid rgba(0,0,0,.1); }
    .hl-color-stack .hl-color-peek { display: block; }
    .hl-color-peek:nth-child(1) { left: 9px; top: 3px; }
    .hl-color-peek:nth-child(2) { right: 3px; top: 7px; }
    .hl-color-peek:nth-child(3) { right: 5px; bottom: 3px; }
    .hl-color-peek:nth-child(4) { left: 5px; bottom: 3px; }
    .hl-color-peek:nth-child(5) { left: 3px; top: 7px; }
    #hl-custom-menu button:focus-visible { outline: 2px solid #fff; outline-offset: 3px; }
    .hl-divider {
      width: 1px;
      height: 20px;
      background: #555;
    }
    .hl-btn-trash {
      background: transparent;
      border: none;
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      padding: 0;
      opacity: 0.4;
      pointer-events: none;
      cursor: pointer;
    }
    .hl-btn-trash.hl-active {
      opacity: 1;
      pointer-events: auto;
    }
    .hl-btn-trash svg { width: 18px; height: 18px; }
  `;

  const styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  const colors =['yellow', 'green', 'blue', 'purple', 'pink', 'orange'];
  const colorNames = { yellow: 'amarelo', green: 'verde', blue: 'azul', purple: 'roxo', pink: 'rosa', orange: 'laranja' };
  const colorOf = mark => colors.find(color => mark?.classList.contains(`hl-color-${color}`)) ||
    (mark?.classList.contains('ia-highlight') ? 'yellow' : mark?.classList.contains('ia-highlight-b') ? 'green' : null);
  const recapOnly = mark => mark?.classList.contains('ia-underline-recap') && !colorOf(mark);
  let lastColor = 'yellow';
  let activeRange = null;
  let activeHlId = null;
  
  let touchStartData = { x: 0, y: 0, scrollY: 0, moved: false, targetMarkId: null };
  let lastTapTime = 0;
  let isQuickSwipeMode = false;
  let lastMarkTap = { id: null, time: 0 };

  const menu = document.createElement('div');
  menu.id = 'hl-custom-menu';
  
  const mainBtn = document.createElement('button');
  mainBtn.type = 'button';
  mainBtn.className = `hl-btn hl-color-btn-main hl-color-${lastColor}`;
  const peeks = Array.from({ length: colors.length - 1 }, () => {
    const swatch = document.createElement('span');
    swatch.setAttribute('aria-hidden', 'true');
    mainBtn.append(swatch);
    return swatch;
  });
  const front = document.createElement('span');
  front.setAttribute('aria-hidden', 'true');
  mainBtn.append(front);
  
  const palette = document.createElement('div');
  palette.className = 'hl-palette';
  colors.forEach(c => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `hl-btn hl-color-${c}`;
    btn.dataset.color = c;
    btn.setAttribute('aria-label', `Destacar em ${colorNames[c]}`);
    palette.appendChild(btn);
  });

  const divider = document.createElement('div');
  divider.className = 'hl-divider';

  const trashBtn = document.createElement('button');
  trashBtn.type = 'button';
  trashBtn.setAttribute('aria-label', 'Remover destaque');
  trashBtn.className = 'hl-btn-trash';
  trashBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" fill="currentColor"/></svg>`;

  menu.appendChild(mainBtn);
  menu.appendChild(palette);
  menu.appendChild(divider);
  menu.appendChild(trashBtn);
  document.body.appendChild(menu);
  // Keep the article selection when a pointer presses a menu control. The
  // cloned range remains available even if WebKit hides its native handles.
  menu.addEventListener('pointerdown', event => {
    // Cancelling a touch pointerdown can suppress the click in WebKit. Touch
    // uses the saved range; only mouse presses need their focus change stopped.
    if (event.pointerType === 'mouse') event.preventDefault();
  });
  menu.addEventListener('mousedown', event => event.preventDefault());

  // Escudo Anti-Raio-X para bloquear toques quando os modais estiverem abertos
  const isAnyModalOpen = () => {
    const biblia = document.getElementById('modal-biblia');
    if (biblia && (biblia.style.display === 'flex' || biblia.style.display === 'block')) return true;
    if (document.body.classList.contains('no-select-global')) return true;
    if (document.body.classList.contains('zoom-active')) return true;
    const alt = document.getElementById('alt-modal');
    if (alt && alt.classList.contains('aberto')) return true;
    return false;
  };

  const saveState = scope => {
    if (window.CacheAnotacao && scope?.id) window.CacheAnotacao.salvar(scope.id, scope.innerHTML);
  };

  const showMenu = (rect, isEdit, isRecapOnly = false, markColor = lastColor) => {
    menu.classList.remove('hl-expanded');
    menu.classList.remove('recap-only');
    if (isRecapOnly) menu.classList.add('recap-only');

    const displayColor = isEdit ? markColor : lastColor;
    mainBtn.className = `hl-btn hl-color-btn-main hl-color-${displayColor}${isEdit && !isRecapOnly ? ' hl-color-stack' : ''}`;
    front.className = `hl-color-swatch hl-color-front hl-color-${displayColor}`;
    const alternatives = colors.filter(color => color !== displayColor);
    peeks.forEach((swatch, index) => {
      swatch.className = `hl-color-swatch hl-color-peek hl-color-${alternatives[index]}`;
      swatch.dataset.swatchColor = alternatives[index];
    });
    mainBtn.setAttribute('aria-label', isEdit ? 'Alterar cor do destaque' : `Aplicar destaque ${colorNames[lastColor]}`);
    if (isEdit) mainBtn.setAttribute('aria-expanded', 'false');
    else mainBtn.removeAttribute('aria-expanded');
    
    if (isEdit) {
      trashBtn.classList.add('hl-active');
    } else {
      trashBtn.classList.remove('hl-active');
    }

    menu.style.display = 'flex';
    
    let top = rect.bottom + window.scrollY + 12;
    let left = rect.left + window.scrollX + (rect.width / 2);

    if (top + 50 > window.scrollY + window.innerHeight) {
      top = rect.top + window.scrollY - 50;
    }
    
    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
  };

  const hideMenu = () => {
    menu.style.display = 'none';
    activeRange = null;
    activeHlId = null;
  };

  const getHlBounds = id => {
    const marks = document.querySelectorAll(`mark[data-hl-id="${id}"]`);
    if (!marks.length) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    marks.forEach(m => {
      const r = m.getBoundingClientRect();
      minX = Math.min(minX, r.left);
      minY = Math.min(minY, r.top);
      maxX = Math.max(maxX, r.right);
      maxY = Math.max(maxY, r.bottom);
    });
    return { left: minX, top: minY, right: maxX, bottom: maxY, width: maxX - minX, height: maxY - minY };
  };

  const applyHighlight = (color, range, scope) => {
    const hlId = 'hl-' + Math.random().toString(36).substr(2, 9);
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, null);
    const nodes =[];
    let n;
    
    while ((n = walker.nextNode())) {
      if (range.intersectsNode(n)) nodes.push(n);
    }
    
    let created = false;
    nodes.forEach(node => {
      let start = node === range.startContainer ? range.startOffset : 0;
      let end = node === range.endContainer ? range.endOffset : node.nodeValue.length;
      if (start >= end) return;
      
      if (start > 0) { node = node.splitText(start); end -= start; }
      if (end < node.nodeValue.length) node.splitText(end);
      
      const txt = node.nodeValue;
      const lTrim = (txt.match(/^\s+/) || [''])[0].length;
      const rTrim = (txt.match(/\s+$/) || [''])[0].length;
      
      if (lTrim + rTrim >= txt.length) return;
      if (lTrim > 0) node = node.splitText(lTrim);
      if (rTrim > 0) node.splitText(node.nodeValue.length - rTrim);
      
      // Color and recap are separate layers. An underline does not prevent
      // painting, while an existing color still belongs to its original owner.
      let ancestor = node.parentElement;
      while (ancestor && ancestor !== scope) {
        if (ancestor.tagName === 'MARK' && !recapOnly(ancestor)) return;
        ancestor = ancestor.parentElement;
      }
      if (!node.nodeValue) return;
      
      const mark = document.createElement('mark');
      mark.className = `hl-color-${color}`;
      mark.dataset.hlId = hlId;
      node.parentNode.replaceChild(mark, node);
      mark.appendChild(node);
      created = true;
    });
    
    if (created) saveState(scope);
  };

  const changeColor = (id, color) => {
    const marks = document.querySelectorAll(`mark[data-hl-id="${id}"]`);
    let scope = null;
    marks.forEach(m => {
      const keepUnderline = m.classList.contains('ia-underline-recap');
      m.className = `hl-color-${color}${keepUnderline ? ' ia-underline-recap' : ''}`;
      // A manual color choice belongs to the reader from this point onward.
      // A later AI refresh must preserve it instead of treating it as generated.
      delete m.dataset.iaOwner;
      delete m.dataset.iaGroup;
      delete m.dataset.iaPart;
      delete m.dataset.iaMode;
      if (!scope) scope = m.closest('.paragrafo');
    });
    if (scope) saveState(scope);
  };

  const removeHighlight = id => {
    const marks = document.querySelectorAll(`mark[data-hl-id="${id}"]`);
    if (!marks.length) return;
    const scope = marks[0].closest('.paragrafo');
    marks.forEach(m => {
      // Older saved articles can put both styles on one element. Removing
      // their color should leave the dotted reference available to the reader.
      if (colorOf(m) && m.classList.contains('ia-underline-recap')) {
        m.className = 'ia-underline-recap';
        delete m.dataset.iaOwner;
        delete m.dataset.iaGroup;
        delete m.dataset.iaPart;
        delete m.dataset.iaMode;
        return;
      }
      const p = m.parentNode;
      while (m.firstChild) p.insertBefore(m.firstChild, m);
      m.remove();
      if (p) p.normalize();
    });
    if (scope) saveState(scope);
  };

  mainBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (activeHlId) {
      menu.classList.add('hl-expanded');
      mainBtn.setAttribute('aria-expanded', 'true');
    } else if (activeRange) {
      const scope = activeRange.commonAncestorContainer.nodeType === 1
        ? activeRange.commonAncestorContainer.closest('.paragrafo')
        : activeRange.commonAncestorContainer.parentElement?.closest('.paragrafo');
      if (scope) applyHighlight(lastColor, activeRange, scope);
      window.getSelection()?.removeAllRanges();
      hideMenu();
    }
  });

  palette.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!e.target.dataset.color) return;
    
    lastColor = e.target.dataset.color;
    
    if (activeHlId) {
      changeColor(activeHlId, lastColor);
    } else if (activeRange) {
      const scope = activeRange.commonAncestorContainer.nodeType === 1 
        ? activeRange.commonAncestorContainer.closest('.paragrafo') 
        : activeRange.commonAncestorContainer.parentElement.closest('.paragrafo');
      if (scope) applyHighlight(lastColor, activeRange, scope);
      window.getSelection().removeAllRanges();
    }
    hideMenu();
  });

  trashBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (activeHlId) {
      removeHighlight(activeHlId);
      hideMenu();
    }
  });

  document.addEventListener('touchstart', e => {
    // 1. Escudo ativado! Se algum modal estiver aberto, ignora os toques para o mark.js
    if (isAnyModalOpen()) {
      hideMenu();
      return;
    }
    
    // 2. Proteção para Links (Bíblia, rodapé, alt e tags <a> em geral)
    if (e.target.closest('.bbl, .footnote-link, .alt-link, a[href]')) {
      hideMenu();
      return;
    }

    if (e.target.closest('#hl-custom-menu')) return;
    
    if (e.touches.length === 1) {
      const now = Date.now();
      if (now - lastTapTime < 400) {
        isQuickSwipeMode = true;
      } else {
        isQuickSwipeMode = false;
      }

      // O Raio-X original, que agora só funciona se não tiver modais acima
      const elementsUnderTap = document.elementsFromPoint(e.touches[0].clientX, e.touches[0].clientY);
      const marks = elementsUnderTap.filter(el => el.tagName === 'MARK');
      let tMark = null;

      if (marks.length > 0) {
        tMark = marks.find(m => colorOf(m));
        if (!tMark) tMark = marks.find(m => m.classList.contains('ia-underline-recap'));
      } else {
        tMark = e.target.closest('mark');
      }

      touchStartData = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        scrollY: window.scrollY,
        moved: false,
        targetMarkId: tMark?.dataset?.hlId || null
      };
    }
    
    if (!e.target.closest('mark')) {
      hideMenu();
    }
  });

  document.addEventListener('touchmove', e => {
    if (!e.touches || !e.touches.length) return;
    const dx = e.touches[0].clientX - touchStartData.x;
    const dy = e.touches[0].clientY - touchStartData.y;
    const scrollDelta = Math.abs(window.scrollY - touchStartData.scrollY);
    if (Math.sqrt(dx*dx + dy*dy) > 12 || scrollDelta > 6) {
      touchStartData.moved = true;
    }
  }, { passive: true });

  document.addEventListener('touchend', e => {
    // Escudos ativados no final do toque também
    if (isAnyModalOpen()) return;
    if (e.target.closest('.bbl, .footnote-link, .alt-link, a[href]')) return;

    const now = Date.now();
    lastTapTime = now;

    if (e.target.closest('#hl-custom-menu')) return;

    let targetMark = null;
    let isRecapOnly = false;

    if (e.changedTouches && e.changedTouches.length > 0) {
      const x = e.changedTouches[0].clientX;
      const y = e.changedTouches[0].clientY;
      const marks = document.elementsFromPoint(x, y).filter(el => el.tagName === 'MARK');
      if (marks.length > 0) {
        targetMark = marks.find(m => colorOf(m));
        if (!targetMark) {
          targetMark = marks.find(m => m.classList.contains('ia-underline-recap'));
          isRecapOnly = true;
        }
      }
    }

    if (!targetMark) {
      targetMark = e.target.closest('mark');
      if (targetMark && recapOnly(targetMark)) isRecapOnly = true;
    }

    const selection = window.getSelection();
    const hasSelection = selection && !selection.isCollapsed && selection.toString().trim();
    if (targetMark && targetMark.dataset.hlId && !hasSelection) {
      if (touchStartData.moved) {
        lastMarkTap = { id: null, time: 0 };
        return;
      }
      
      const hlId = targetMark.dataset.hlId;
      
      if (lastMarkTap.id === hlId && (now - lastMarkTap.time < 400)) {
        removeHighlight(hlId);
        hideMenu();
        lastMarkTap = { id: null, time: 0 };
        return;
      }
      lastMarkTap = { id: hlId, time: now };

      activeHlId = hlId;
      activeRange = null;
      const rect = getHlBounds(activeHlId);
      if (rect) showMenu(rect, true, isRecapOnly, colorOf(targetMark) || lastColor);
      return;
    }

    setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;

      let dx = 0, dy = 0;
      if (e.changedTouches && e.changedTouches.length > 0) {
        dx = e.changedTouches[0].clientX - touchStartData.x;
        dy = e.changedTouches[0].clientY - touchStartData.y;
      }
      const distance = Math.sqrt(dx*dx + dy*dy);
      const gestureMoved = touchStartData.moved || Math.abs(window.scrollY - touchStartData.scrollY) > 6;

      const range = sel.getRangeAt(0);
      const scope = range.commonAncestorContainer.nodeType === 1 
        ? range.commonAncestorContainer.closest('.paragrafo') 
        : range.commonAncestorContainer.parentElement?.closest('.paragrafo');
      
      if (!scope) return;

      if (gestureMoved && !sel.toString().trim()) {
        sel.removeAllRanges();
        hideMenu();
      }
      else if (distance > 10 && isQuickSwipeMode) {
        applyHighlight(lastColor, range, scope);
        sel.removeAllRanges();
        hideMenu();
      } 
      else if (distance > 10 || isQuickSwipeMode || sel.toString().trim().length > 0) {
        activeRange = range.cloneRange();
        activeHlId = null;
        showMenu(range.getBoundingClientRect(), false, false);
      }
    }, 50);
  });

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.paragrafo').forEach((p, i) => {
      if (!p.id) p.id = `paragrafo-geral-${i}`;
      if (window.CacheAnotacao) {
        const cached = window.CacheAnotacao.carregar(p.id);
        if (cached) p.innerHTML = cached;
      }
    });
    document.dispatchEvent(new CustomEvent('cacheRestored'));
  });
})();
