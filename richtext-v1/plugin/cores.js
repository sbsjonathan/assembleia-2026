document.addEventListener('DOMContentLoaded', () => {
  if (typeof M1_Config === 'undefined' || !M1_Config.editor || !M1_Config.toolbar) return;

  const editor = M1_Config.editor;
  const PERF_LOW = !!(window.EditorPerfProfile?.isLow?.() || document.documentElement.classList.contains('perf-low'));
  const toolbar = M1_Config.toolbar;

  const textBtn = toolbar.querySelector('[aria-label="Cor do texto"]');
  const bgBtn = toolbar.querySelector('[aria-label="Cor de fundo"]');
  const resetBtn = toolbar.querySelector('[aria-label="Resetar formatação"]');

  if (!textBtn || !bgBtn || !resetBtn) return;

  const textIndicator = textBtn.querySelector('.color-indicator.text');
  const bgIndicator = bgBtn.querySelector('.color-indicator.bg');
  const resetIndicator = resetBtn.querySelector('.reset-indicator');

  let pickerMode = 'text';
  
  const getDefaultTextColor = () => getComputedStyle(document.documentElement).getPropertyValue('--text-color').trim() || '#37352f';
  
  let lastTextColor = getDefaultTextColor();
  let lastBgColor = null;

  let pickerR = 255, pickerG = 59, pickerB = 48;
  let spectrumDrawn = false, specDragging = false;
  let selectedCell = null, selectedSwatch = null;

  const overlay = document.getElementById('color-picker-overlay');
  const previewEl = document.getElementById('picker-preview');
  const dotEl = document.getElementById('picker-dot');
  const specCanvas = document.getElementById('picker-spec-canvas');
  const specCtx = specCanvas?.getContext('2d', { alpha: false });
  const sliderR = document.getElementById('picker-slider-r'), numR = document.getElementById('picker-num-r'), bgR = document.getElementById('picker-bg-r');
  const sliderG = document.getElementById('picker-slider-g'), numG = document.getElementById('picker-num-g'), bgG = document.getElementById('picker-bg-g');
  const sliderB = document.getElementById('picker-slider-b'), numB = document.getElementById('picker-num-b'), bgB = document.getElementById('picker-bg-b');
  const hexInput = document.getElementById('picker-hex-input');

  const thumbStyleEl = document.createElement('style');
  document.head.appendChild(thumbStyleEl);
  const clamp = v => Math.max(0, Math.min(255, Math.round(v)));
  const toHex2 = n => n.toString(16).padStart(2, '0').toUpperCase();
  const hexToRgb = hex => {
    const h = hex.replace('#', '');
    return[parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  };
  const rgbToHex = rgb => {
    if (!rgb) return null;
    const m = rgb.replace(/\s+/g, '').match(/^rgba?\((\d+),(\d+),(\d+)/i);
    return m ? '#' +[1, 2, 3].map(i => parseInt(m[i]).toString(16).padStart(2, '0')).join('') : null;
  };

  const insideEditor = node => {
    const base = node?.nodeType === 3 ? node.parentNode : node;
    return !!base && editor.contains(base);
  };

  const ensureSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && insideEditor(sel.getRangeAt(0).startContainer)) return true;
    M4_Caret.restR();
    return !!(window.getSelection()?.rangeCount && insideEditor(window.getSelection().getRangeAt(0).startContainer));
  };

  const getHeadingNode = editable => {
    if (!editable?.classList?.contains('paragraph-content')) return null;
    const node = editable.closest('.node-paragraph');
    if (!node) return null;
    if (node.classList.contains('font-h1') || node.classList.contains('font-h2') || node.classList.contains('font-h3')) return node;
    return null;
  };

  const clearHeadingTextColor = editable => {
    if (!editable) return;
    editable.querySelectorAll('[style], [color], font').forEach(node => {
      if (node.nodeType !== 1) return;

      if (node.style) {
        node.style.removeProperty('color');
        const styleAttr = node.getAttribute('style');
        if (!styleAttr || !styleAttr.trim()) node.removeAttribute('style');
      }

      if (node.hasAttribute && node.hasAttribute('color')) {
        node.removeAttribute('color');
      }
    });
    editable.querySelectorAll('font').forEach(node => {
      if (node.attributes.length) return;
      const parent = node.parentNode;
      if (!parent) return;
      while (node.firstChild) parent.insertBefore(node.firstChild, node);
      parent.removeChild(node);
    });
  };

  const applyWholeHeadingTextColor = (editable, hex) => {
    if (!editable) return false;
    if (M3_TextModel.isEmpty(editable)) return false;
    const sel = window.getSelection();
    if (!sel) return false;

    M4_Caret.saveR();
    clearHeadingTextColor(editable);

    const fullRange = document.createRange();
    fullRange.selectNodeContents(editable);
    sel.removeAllRanges();
    sel.addRange(fullRange);

    document.execCommand('foreColor', false, hex);
    M3_TextModel.sync(editable);

    M4_Caret.restR();
    return true;
  };

  const isLight = hex => {
    const [r, g, b] = hexToRgb(hex);
    return (r * 299 + g * 587 + b * 114) / 1000 > 180;
  };
  const contrast = hex => {
    const [r, g, b] = hexToRgb(hex);
    return (r * 299 + g * 587 + b * 114) / 1000 > 128 ? '#111111' : '#FFFFFF';
  };

  const isValidBg = color => color && color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)' && color !== '#ffffff' && color !== '#FFFFFF';
  const normalizeColor = val => {
    if (!val) return null;
    const normalized = String(val).trim();
    if (!normalized || normalized.toLowerCase() === 'transparent') return null;
    const rgbaMatch = normalized.replace(/\s+/g, '').match(/^rgba\((\d+),(\d+),(\d+),(\d*\.?\d+)\)$/i);
    if (rgbaMatch && parseFloat(rgbaMatch[4]) <= 0.05) return null;
    return rgbToHex(normalized) || normalized;
  };
  const setColorState = (r, g, b, source) => {
    pickerR = clamp(r); pickerG = clamp(g);
    pickerB = clamp(b);

    if (source !== 'swatch' && source !== 'init' && selectedSwatch) {
      selectedSwatch.classList.remove('selected');
      selectedSwatch.style.boxShadow = '0 1px 4px rgba(0,0,0,0.18)';
      selectedSwatch = null;
    }

    const rgb = `rgb(${pickerR},${pickerG},${pickerB})`;
    const hex = '#' + toHex2(pickerR) + toHex2(pickerG) + toHex2(pickerB);
    
    if (previewEl) previewEl.style.backgroundColor = rgb;
    thumbStyleEl.textContent = `
      #color-picker-overlay input[type="range"]::-webkit-slider-thumb { background: ${rgb} !important; }
      #color-picker-overlay input[type="range"]::-moz-range-thumb { background: ${rgb} !important; }
    `;
    if (bgR) bgR.style.background = `linear-gradient(to right, rgb(0,${pickerG},${pickerB}), rgb(255,${pickerG},${pickerB}))`;
    if (bgG) bgG.style.background = `linear-gradient(to right, rgb(${pickerR},0,${pickerB}), rgb(${pickerR},255,${pickerB}))`;
    if (bgB) bgB.style.background = `linear-gradient(to right, rgb(${pickerR},${pickerG},0), rgb(${pickerR},${pickerG},255))`;

    if (source !== 'spectrum') syncSpectrumDot();
    if (source !== 'controls') {
      if (sliderR) sliderR.value = pickerR;
      if (sliderG) sliderG.value = pickerG;
      if (sliderB) sliderB.value = pickerB;
    }
    
    if (numR) numR.value = pickerR;
    if (numG) numG.value = pickerG;
    if (numB) numB.value = pickerB;
    if (hexInput) hexInput.value = toHex2(pickerR) + toHex2(pickerG) + toHex2(pickerB);
    if (overlay && overlay.classList.contains('open')) {
      if (pickerMode === 'text') {
        if (textIndicator) {
          textIndicator.style.color = hex;
          textIndicator.style.textShadow = isLight(hex) ? '-0.5px -0.5px 0 rgba(0,0,0,0.5), 0.5px -0.5px 0 rgba(0,0,0,0.5), -0.5px 0.5px 0 rgba(0,0,0,0.5), 0.5px 0.5px 0 rgba(0,0,0,0.5)' : 'none';
        }
        if (resetIndicator) resetIndicator.style.color = hex;
      } else {
        if (bgIndicator) {
          bgIndicator.style.backgroundColor = hex;
          bgIndicator.style.color = contrast(hex);
        }
        if (resetIndicator) resetIndicator.style.backgroundColor = hex;
      }
    }
  };

  const readSliders = () => {
    setColorState(parseInt(sliderR?.value || 0), parseInt(sliderG?.value || 0), parseInt(sliderB?.value || 0), 'controls');
  };

  const initModalUI = () => {
    if (!overlay) return;

    overlay.querySelectorAll('.picker-tab, .picker-view').forEach(e => e.classList.remove('active'));
    
    const defaultTab = overlay.querySelector('[data-target="picker-view-spectrum"]');
    if (defaultTab) defaultTab.classList.add('active');
    
    const defaultView = document.getElementById('picker-view-spectrum');
    if (defaultView) defaultView.classList.add('active');

    const closePicker = () => applyColorAndClose();
    document.getElementById('picker-close')?.addEventListener('click', closePicker);
    overlay.addEventListener('touchstart', e => { if (e.target === overlay) { e.preventDefault(); applyColorAndClose(); } }, { passive: false });
    overlay.addEventListener('click', e => { if (e.target === overlay) applyColorAndClose(); });
    overlay.querySelectorAll('.picker-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        overlay.querySelectorAll('.picker-tab, .picker-view').forEach(e => e.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(tab.dataset.target)?.classList.add('active');
        if (tab.dataset.target === 'picker-view-spectrum') {
          if (!spectrumDrawn) { drawSpectrum(); spectrumDrawn = true; }
          syncSpectrumDot();
        }
      });
    });
    const gridEl = document.getElementById('picker-color-grid');
    if (gridEl) {
      const colorGrid = [["#FFFFFF","#EBEBEB","#D6D6D6","#C2C2C2","#ADADAD","#999999","#858585","#707070","#5C5C5C","#474747","#333333","#000000"],["#00374A","#011D57","#11053B","#2E063D","#3C071B","#5C0701","#5A1C00","#583300","#563D00","#666100","#4F5504","#263E0F"],["#004D65","#012F7B","#1A0A52","#450D59","#551029","#831100","#7B2900","#7A4A00","#785800","#8D8602","#6F760A","#38571A"],["#016E8F","#0042A9","#2C0977","#61187C","#791A3D","#B51A00","#AD3E00","#A96800","#A67B01","#C4BC00","#9BA50E","#4E7A27"],["#008CB4","#0056D6","#371A94","#7A219E","#99244F","#E22400","#DA5100","#D38301","#D19D01","#F4EC00","#C3D017","#669D34"],["#00A1D8","#0061FE","#4D22B2","#982ABC","#B92D5D","#FE4015","#FF6A00","#FEAB01","#FCC700","#FEFB41","#D8EC37","#76BB40"],["#01C7FC","#3A87FE","#5E30EB","#BE38F3","#E63B7A","#FF6250","#FE8648","#FEB43F","#FDCB3E","#FFF76B","#E4EF65","#96D35F"],["#52D6FC","#74A7FF","#864FFE","#D357FE","#EE719E","#FE8C82","#FEA57D","#FEC777","#FED877","#FFF994","#EAF28F","#B1DD8B"],["#93E3FD","#A7C6FF","#B18CFE","#E292FE","#F4A4C0","#FFB5AF","#FFC5AB","#FED8A8","#FDE4A8","#FEFBB9","#F2F7B7","#CDE8B5"],["#CBF0FE","#D3E2FF","#D9C9FD","#EFCAFF","#F8D3E0","#FFDBD8","#FEE2D6","#FEECD4","#FEF2D5","#FDFCDC","#F6F9DB","#DEEED4"]
      ];
      colorGrid.forEach((row, r) => {
        row.forEach((col, c) => {
          const btn = document.createElement('button');
          btn.className = 'color-cell';
          btn.style.backgroundColor = col;
          if (r === 0 && c === 0) btn.style.borderRadius = '12px 0 0 0';
          if (r === 0 && c === 11) btn.style.borderRadius = '0 12px 0 0';
          if (r === 9 && c === 0) btn.style.borderRadius = '0 0 0 12px';
          if (r === 9 && c === 11) btn.style.borderRadius = '0 0 12px 0';

          btn.addEventListener('click', () => {
            if (selectedCell) selectedCell.classList.remove('selected');
            selectedCell = btn;
            btn.classList.add('selected');
            const [cr, cg, cb] = hexToRgb(col);
            setColorState(cr, cg, cb, 'grid');
          });
          gridEl.appendChild(btn);
        });
      });
    }

    const swatchesEl = document.getElementById('picker-swatches');
    if (swatchesEl) {['#FF3B30', '#007AFF', '#34C759', '#FF9500', '#AF52DE', '#000000'].forEach(color => {
        const btn = document.createElement('button');
        btn.className = 'picker-swatch';
        btn.style.background = color;
        const select = e => {
          e.preventDefault();
          if (selectedSwatch && selectedSwatch !== btn) {
            selectedSwatch.classList.remove('selected');
            selectedSwatch.style.boxShadow = '0 1px 4px rgba(0,0,0,0.18)';
          }
          selectedSwatch = btn;
          btn.classList.add('selected');
          btn.style.boxShadow = `0 0 0 3px #f2f2f7, 0 0 0 6px ${color}`;
          const [cr, cg, cb] = hexToRgb(color);
          setColorState(cr, cg, cb, 'swatch');
        };
        btn.addEventListener('touchstart', select, { passive: false });
        btn.addEventListener('click', select);
        swatchesEl.appendChild(btn);
      });
    }

    const specBox = document.getElementById('picker-view-spectrum');
    if (specBox) {
      let tMoved = false, tStartX = 0, tStartY = 0;
      const move = e => {
        if (!specCanvas || !specCtx || !dotEl) return;
        const rect = specCanvas.getBoundingClientRect();
        const ev = e.touches ? e.touches[0] : e;
        const x = Math.max(0, Math.min(rect.width - 1, ev.clientX - rect.left));
        const y = Math.max(0, Math.min(rect.height - 1, ev.clientY - rect.top));
        const px = Math.max(0, Math.min(specCanvas.width - 1, Math.round(x * specCanvas.width / rect.width)));
        const py = Math.max(0, Math.min(specCanvas.height - 1, Math.round(y * specCanvas.height / rect.height)));
        const p = specCtx.getImageData(px, py, 1, 1).data;
        dotEl.style.left = x + 'px';
        dotEl.style.top = y + 'px';
        dotEl.style.background = `rgb(${p[0]},${p[1]},${p[2]})`;
        setColorState(p[0], p[1], p[2], 'spectrum');
      };
      specBox.addEventListener('mousedown', e => { specDragging = true; move(e); });
      window.addEventListener('mousemove', e => { if (specDragging) move(e); });
      window.addEventListener('mouseup', () => { specDragging = false; });
      specBox.addEventListener('touchstart', e => {
        e.preventDefault(); specDragging = true; tMoved = false;
        tStartX = e.touches[0].clientX; tStartY = e.touches[0].clientY;
        move(e);
      }, { passive: false });
      window.addEventListener('touchmove', e => {
        if (!specDragging) return;
        e.preventDefault();
        if (Math.abs(e.touches[0].clientX - tStartX) > 6 || Math.abs(e.touches[0].clientY - tStartY) > 6) tMoved = true;
        move(e);
      }, { passive: false });
      window.addEventListener('touchend', () => {
        if (specDragging) {
          specDragging = false;
          if (tMoved && document.getElementById('picker-view-spectrum')?.classList.contains('active')) applyColorAndClose();
        }
      });
    }

    [sliderR, sliderG, sliderB].forEach(s => s?.addEventListener('input', readSliders));
    numR?.addEventListener('input', () => { if (sliderR) sliderR.value = clamp(parseInt(numR.value) || 0); readSliders(); });
    numG?.addEventListener('input', () => { if (sliderG) sliderG.value = clamp(parseInt(numG.value) || 0); readSliders(); });
    numB?.addEventListener('input', () => { if (sliderB) sliderB.value = clamp(parseInt(numB.value) || 0); readSliders(); });
    hexInput?.addEventListener('input', () => {
      let raw = hexInput.value.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
      hexInput.value = raw;
      if (raw.length === 6) {
        const[r, g, b] = hexToRgb(raw);
        setColorState(r, g, b, 'controls');
      }
    });
  };

  const drawSpectrum = () => {
    if (!specCanvas || !specCtx) return;
    const w = specCanvas.width = specCanvas.parentElement.offsetWidth;
    const h = specCanvas.height = specCanvas.parentElement.offsetHeight;
    
    const hCanvas = document.createElement('canvas');
    hCanvas.width = 1;
    hCanvas.height = h;
    const hCtx = hCanvas.getContext('2d');
    const grad = hCtx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0.00,"#ff0000"); grad.addColorStop(0.12,"#ffff00");
    grad.addColorStop(0.18,"#ffff00"); grad.addColorStop(0.30,"#00ff00");
    grad.addColorStop(0.40,"#00ff00"); grad.addColorStop(0.52,"#00ffff");
    grad.addColorStop(0.60,"#00ffff"); grad.addColorStop(0.72,"#0000ff");
    grad.addColorStop(0.85,"#ff00ff"); grad.addColorStop(0.92,"#ff00ff");
    grad.addColorStop(1.00,"#ff0000");
    hCtx.fillStyle = grad; hCtx.fillRect(0, 0, 1, h);
    const hData = hCtx.getImageData(0, 0, 1, h).data;
    const img = specCtx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      const rH = hData[y * 4], gH = hData[y * 4 + 1], bH = hData[y * 4 + 2];
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4, pct = x / w;
        const wA = pct < 0.4 ? Math.pow(1 - (pct / 0.4), 2) * (3 - 2 * (1 - (pct / 0.4))) : 0;
        const bA = pct > 0.6 ? Math.pow((pct - 0.6) / 0.4, 2) : 0;
        img.data[i] = (rH + (255 - rH) * wA) * (1 - bA);
        img.data[i + 1] = (gH + (255 - gH) * wA) * (1 - bA);
        img.data[i + 2] = (bH + (255 - bH) * wA) * (1 - bA);
        img.data[i + 3] = 255;
      }
    }
    specCtx.putImageData(img, 0, 0);
  };
  
  const syncSpectrumDot = () => {
    if (!spectrumDrawn || !specCanvas || !dotEl) return;
    const w = specCanvas.width, h = specCanvas.height;
    const data = specCtx.getImageData(0, 0, w, h).data;
    let bx = w / 2, by = h / 2, minDist = Infinity;
    for (let y = 0; y < h; y += 4) {
      for (let x = 0; x < w; x += 4) {
        const i = (y * w + x) * 4;
        const d = (data[i] - pickerR) ** 2 + (data[i + 1] - pickerG) ** 2 + (data[i + 2] - pickerB) ** 2;
        if (d < minDist) { minDist = d; bx = x; by = y;
        }
      }
    }
    dotEl.style.left = bx + 'px';
    dotEl.style.top = by + 'px';
    dotEl.style.background = `rgb(${pickerR},${pickerG},${pickerB})`;
  };

  const getColorsAtCaret = () => {
    const out = { text: null, bg: null };
    const range = M2_Query.curRange();
    if (!range || !editor.contains(range.startContainer)) return out;
    try {
      const fore = document.queryCommandValue('foreColor');
      const back = document.queryCommandValue('hiliteColor') || document.queryCommandValue('backColor');
      if (fore) out.text = normalizeColor(fore);
      if (back) out.bg = normalizeColor(back);
    } catch (_) {}

    const node = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
    if (node) {
      const cs = getComputedStyle(node);
      if (!out.text && cs.color) out.text = normalizeColor(cs.color);
      if (!out.bg && cs.backgroundColor) out.bg = normalizeColor(cs.backgroundColor);
    }

    const editable = M2_Query.closest(range.startContainer, '.editable');
    if (!out.text && getHeadingNode(editable)) {
      const colored = editable.querySelector('[style*="color"], font[color]');
      if (colored) {
        const inlineColor = colored.getAttribute?.('color') || colored.style?.color || getComputedStyle(colored).color;
        out.text = normalizeColor(inlineColor);
      }
    }

    return out;
  };
  
  const applyColorAndClose = () => {
    overlay.classList.remove('open');
    if (!ensureSelection()) return;

    const editable = M2_Query.curEd();
    if (!editable) return;
    window.M12_History?.beforeChange?.();
    M4_Caret.restR();
    try { editable.focus({ preventScroll: true }); } catch (e) { editable.focus();
    }

    const hex = '#' + toHex2(pickerR) + toHex2(pickerG) + toHex2(pickerB);
    const headingNode = getHeadingNode(editable);
    if (pickerMode === 'text') {
      if (!headingNode || !applyWholeHeadingTextColor(editable, hex)) {
        document.execCommand('foreColor', false, hex);
      }
      lastTextColor = hex;
    } else {
      if (!document.execCommand('hiliteColor', false, hex)) document.execCommand('backColor', false, hex);
      lastBgColor = hex;
    }

    M3_TextModel.sync(editable);
    M4_Caret.saveR();
    M4_Caret.updateFocus();
    window.M12_History?.afterChange?.(2);

    queueSyncUI()
  };
  
  // CORREÇÃO: Limpeza profunda e cirúrgica de cores na seleção
  const applyReset = () => {
    if (!ensureSelection()) return;
    const editable = M2_Query.curEd();
    if (!editable) return;

    window.M12_History?.beforeChange?.();
    M4_Caret.restR();
    try { editable.focus({ preventScroll: true }); } catch (e) { editable.focus(); }

    const sel = window.getSelection();
    if (sel && sel.rangeCount) {
      const range = sel.getRangeAt(0);
      try {
        // removeFormat nativo
        document.execCommand('removeFormat', false, null);

        if (!range.collapsed) {
          // Varredura nos nós para remover cores remanescentes
          const elements = editable.querySelectorAll('*');
          elements.forEach(el => {
            if (sel.containsNode(el, true)) {
              el.style.removeProperty('color');
              el.style.removeProperty('background-color');
              el.style.removeProperty('background');
              if (el.tagName === 'FONT') el.removeAttribute('color');
              if (!el.getAttribute('style')) el.removeAttribute('style');
            }
          });
        } else {
          // Se estiver colapsado, limpa o nó pai direto
          let parent = range.startContainer;
          if (parent.nodeType === 3) parent = parent.parentElement;
          while (parent && parent !== editable) {
            parent.style.removeProperty('color');
            parent.style.removeProperty('background-color');
            parent.style.removeProperty('background');
            if (parent.tagName === 'FONT') parent.removeAttribute('color');
            if (!parent.getAttribute('style')) parent.removeAttribute('style');
            parent = parent.parentElement;
          }
        }
      } catch (err) {}
    }

    lastTextColor = getDefaultTextColor();
    lastBgColor = null;

    M3_TextModel.sync(editable);
    M4_Caret.saveR();
    M4_Caret.updateFocus();
    window.M12_History?.afterChange?.(2);

    resetBtn.classList.add('shake');
    setTimeout(() => resetBtn.classList.remove('shake'), 400);

    queueSyncUI()
  };
  
  const updateToolbarUI = () => {
    if (overlay && overlay.classList.contains('open')) return;

    const info = getColorsAtCaret();
    const tColor = info.text || lastTextColor || getDefaultTextColor();
    const bColor = isValidBg(info.bg) ? info.bg : lastBgColor;
    if (textIndicator) {
      textIndicator.style.color = tColor;
      textIndicator.style.textShadow = isLight(tColor) ?
        '-0.5px -0.5px 0 rgba(0,0,0,0.5), 0.5px -0.5px 0 rgba(0,0,0,0.5), -0.5px 0.5px 0 rgba(0,0,0,0.5), 0.5px 0.5px 0 rgba(0,0,0,0.5)' : 'none';
    }
    if (bgIndicator) {
      bgIndicator.style.backgroundColor = isValidBg(bColor) ? bColor : 'transparent';
      bgIndicator.style.color = isValidBg(bColor) ? contrast(bColor) : 'currentColor';
    }
    if (resetIndicator) {
      resetIndicator.style.color = tColor;
      resetIndicator.style.backgroundColor = isValidBg(bColor) ? bColor : 'transparent';
    }
  };
  
  const openPicker = (mode) => {
    pickerMode = mode;
    M4_Caret.saveR();
    document.activeElement?.blur();
    overlay.classList.add('open');
    requestAnimationFrame(() => {
      if (!spectrumDrawn && document.getElementById('picker-view-spectrum')?.classList.contains('active')) {
        drawSpectrum(); spectrumDrawn = true;
      }
      syncSpectrumDot();
    });
  };

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
      if (moved) e.preventDefault();
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
    });
  };

  let uiSyncRaf = 0;
  const queueSyncUI = () => {
    if (uiSyncRaf) return;
    uiSyncRaf = requestAnimationFrame(() => {
      uiSyncRaf = 0;
      updateToolbarUI();
    });
  };

  initModalUI();
  setColorState(255, 59, 48, 'init');
  bindTapIntent(textBtn, () => openPicker('text'));
  bindTapIntent(bgBtn, () => openPicker('bg'));
  bindTapIntent(resetBtn, applyReset);

  document.addEventListener('selectionchange', queueSyncUI);
  editor.addEventListener('input', queueSyncUI);
  editor.addEventListener('focus', queueSyncUI, true);
  editor.addEventListener('blur', () => setTimeout(updateToolbarUI, PERF_LOW ? 120 : 60), true);
  
  window.addEventListener('theme:changed', () => {
      lastTextColor = getDefaultTextColor();
      queueSyncUI()
  });
  
  updateToolbarUI();
});