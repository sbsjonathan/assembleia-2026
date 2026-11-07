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

    .hl-btn.hl-color-yellow { background-color: #FFEC0D !important; }
    .hl-btn.hl-color-green { background-color: #B7E492 !important; }
    .hl-btn.hl-color-blue { background-color: #98D8FF !important; }
    .hl-btn.hl-color-purple { background-color: #C1A7E2 !important; }
    .hl-btn.hl-color-pink { background-color: #DD89A9 !important; }
    .hl-btn.hl-color-orange { background-color: #E5A77C !important; }

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
      width: 24px;
      height: 24px;
      border-radius: 50%;
      border: 2px solid transparent;
      cursor: pointer;
      flex-shrink: 0;
      transition: transform 0.1s;
    }
    .hl-btn:active { transform: scale(0.85); }
    .hl-color-btn-main {
      border: 2px solid #555;
    }
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
  let lastColor = 'yellow';
  let activeRange = null;
  let activeHlId = null;
  
  let touchStartData = { x: 0, y: 0, scrollY: 0, moved: false, targetMarkId: null };
  let lastTapTime = 0;
  let isQuickSwipeMode = false;
  let lastMarkTap = { id: null, time: 0 };

  const menu = document.createElement('div');
  menu.id = 'hl-custom-menu';
  
  const mainBtn = document.createElement('div');
  mainBtn.className = `hl-btn hl-color-btn-main hl-color-${lastColor}`;
  
  const palette = document.createElement('div');
  palette.className = 'hl-palette';
  colors.forEach(c => {
    const btn = document.createElement('div');
    btn.className = `hl-btn hl-color-${c}`;
    btn.dataset.color = c;
    palette.appendChild(btn);
  });

  const divider = document.createElement('div');
  divider.className = 'hl-divider';

  const trashBtn = document.createElement('button');
  trashBtn.className = 'hl-btn-trash';
  trashBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" fill="currentColor"/></svg>`;

  menu.appendChild(mainBtn);
  menu.appendChild(palette);
  menu.appendChild(divider);
  menu.appendChild(trashBtn);
  document.body.appendChild(menu);

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

  const showMenu = (rect, isEdit, isRecapOnly = false) => {
    menu.classList.remove('hl-expanded');
    menu.classList.remove('recap-only');
    if (isRecapOnly) menu.classList.add('recap-only');

    mainBtn.className = `hl-btn hl-color-btn-main hl-color-${lastColor}`;
    
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
      
      if (!node.nodeValue || node.parentNode.tagName === 'MARK') return;
      
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
      m.className = `hl-color-${color}`;
      if (!scope) scope = m.closest('.paragrafo');
    });
    if (scope) saveState(scope);
  };

  const removeHighlight = id => {
    const marks = document.querySelectorAll(`mark[data-hl-id="${id}"]`);
    if (!marks.length) return;
    const scope = marks[0].closest('.paragrafo');
    marks.forEach(m => {
      const p = m.parentNode;
      while (m.firstChild) p.insertBefore(m.firstChild, m);
      m.remove();
      if (p) p.normalize();
    });
    if (scope) saveState(scope);
  };

  mainBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.classList.add('hl-expanded');
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
        tMark = marks.find(m => !m.classList.contains('ia-underline-recap'));
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
        targetMark = marks.find(m => !m.classList.contains('ia-underline-recap'));
        if (!targetMark) {
          targetMark = marks.find(m => m.classList.contains('ia-underline-recap'));
          isRecapOnly = true;
        }
      }
    }

    if (!targetMark) {
      targetMark = e.target.closest('mark');
      if (targetMark && targetMark.classList.contains('ia-underline-recap')) isRecapOnly = true;
    }

    if (targetMark && targetMark.dataset.hlId) {
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
      if (rect) showMenu(rect, true, isRecapOnly);
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
        activeRange = range;
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