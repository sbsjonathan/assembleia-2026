(() => {
  const MAX_DPR = 2;
  const PERF_LOW = !!(window.EditorPerfProfile?.isLow?.() || document.documentElement.classList.contains('perf-low'));

  if (PERF_LOW) {
    const fx = document.getElementById('glassFx');
    if (fx) fx.style.display = 'none';
    return;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function parsePx(value, fallback = 0) {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    const radius = Math.max(0, Math.min(r, Math.min(w, h) * 0.5));
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  function sampleBilinear(data, width, height, x, y) {
    x = clamp(x, 0, width - 1);
    y = clamp(y, 0, height - 1);

    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(width - 1, x0 + 1);
    const y1 = Math.min(height - 1, y0 + 1);
    const tx = x - x0;
    const ty = y - y0;

    const i00 = (y0 * width + x0) * 4;
    const i10 = (y0 * width + x1) * 4;
    const i01 = (y1 * width + x0) * 4;
    const i11 = (y1 * width + x1) * 4;

    const out =[0, 0, 0, 255];
    for (let c = 0; c < 3; c++) {
      const top = data[i00 + c] * (1 - tx) + data[i10 + c] * tx;
      const bottom = data[i01 + c] * (1 - tx) + data[i11 + c] * tx;
      out[c] = top * (1 - ty) + bottom * ty;
    }
    return out;
  }

  function capsuleSdf(px, py, halfSeg, radius) {
    const qx = Math.abs(px) - halfSeg;
    return Math.hypot(Math.max(qx, 0), py) - radius;
  }

  function mapRadial(r) {
    let v = 0.5 + r * 0.5;
    let mappedV;
    if (v > 0.85) {
      mappedV = 0.85 - (v - 0.85);
    } else if (v >= 0.64) {
      const t = (0.85 - v) / (0.85 - 0.64);
      const pull = Math.pow(1 - t, 2) * 0.16;
      mappedV = v - pull;
    } else {
      mappedV = v;
    }
    return (mappedV - 0.5) * 2;
  }

  function drawTriangle(ctx, rect, expanded, color) {
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const w = 7;
    const h = 10;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(expanded ? Math.PI / 2 : 0);
    ctx.beginPath();
    ctx.moveTo(-w / 2, -h / 2);
    ctx.lineTo(-w / 2, h / 2);
    ctx.lineTo(w / 2, 0);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }

  function drawPlus(ctx, rect, color) {
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    ctx.save();
    roundRectPath(ctx, rect.left, rect.top, rect.width, rect.height, 4);
    ctx.fillStyle = 'rgba(238, 238, 236, 0.96)';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - 4, cy);
    ctx.lineTo(cx + 4, cy);
    ctx.moveTo(cx, cy - 4);
    ctx.lineTo(cx, cy + 4);
    ctx.stroke();
    ctx.restore();
  }

  function buildFont(style, dpr) {
    const fontStyle = style.fontStyle && style.fontStyle !== 'normal' ? `${style.fontStyle} ` : '';
    const fontVariant = style.fontVariant && style.fontVariant !== 'normal' ? `${style.fontVariant} ` : '';
    const fontWeight = style.fontWeight || '400';
    const fontSize = parsePx(style.fontSize, 16) * dpr;
    const fontFamily = style.fontFamily || '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif';
    return `${fontStyle}${fontVariant}${fontWeight} ${fontSize}px ${fontFamily}`;
  }

  function isVisibleRect(rect, viewportHeight) {
    return rect && rect.width >= 0 && rect.height >= 0 && rect.bottom >= 0 && rect.top <= viewportHeight;
  }

  function collectRenderedTextFragments(rootEl, viewportHeight) {
    const fragments =[];
    const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        if (!node.parentElement) return NodeFilter.FILTER_REJECT;
        const editable = node.parentElement.closest('.editable');
        if (!editable) return NodeFilter.FILTER_REJECT;
        const editableRect = editable.getBoundingClientRect();
        if (!isVisibleRect(editableRect, viewportHeight)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    let textNode;
    while ((textNode = walker.nextNode())) {
      const parentEl = textNode.parentElement;
      const editable = parentEl.closest('.editable');
      if (!editable || editable.dataset.empty === 'true') continue;

      const nodeStyle = getComputedStyle(parentEl);
      const color = nodeStyle.color;
      const font = buildFont(nodeStyle, window.__liquidGlassDpr || 1);
      const letterSpacing = nodeStyle.letterSpacing;
      
      const text = textNode.nodeValue;
      const groups =[];
      let current = null;

      for (let i = 0; i < text.length; i++) {
        if (/\s/.test(text[i]) && i === text.length - 1) continue;

        const range = document.createRange();
        range.setStart(textNode, i);
        range.setEnd(textNode, i + 1);
        const rects = range.getClientRects();
        if (!rects.length) continue;

        // O SEGREDO DO IPHONE: Filtra o "retângulo fantasma" de largura zero
        // que o WebKit cria na linha de cima quando quebra uma palavra ao meio.
        let rect = rects[0];
        for (let rIdx = 0; rIdx < rects.length; rIdx++) {
          if (rects[rIdx].width > 0) {
            rect = rects[rIdx];
            break;
          }
        }

        if (!isVisibleRect(rect, viewportHeight)) continue;
        if (rect.width === 0 || rect.height === 0) continue;

        const keyTop = Math.round(rect.top * 4) / 4;
        const keyLeft = Math.round(rect.left * 4) / 4;

        // Agrupa estourando em 2 letras no máximo para matar o desvio de Kerning
        if (!current || Math.abs(current.top - keyTop) > 0.75 || (current.end - current.start >= 2)) {
          current = {
            top: keyTop,
            left: keyLeft,
            start: i,
            end: i + 1,
            font,
            color,
            letterSpacing
          };
          groups.push(current);
        } else {
          current.end = i + 1;
        }
      }

      for (const group of groups) {
        const content = text.slice(group.start, group.end);
        if (!content.trim()) continue;
        fragments.push({
          text: content,
          x: group.left,
          y: group.top + 0.5,
          font: group.font,
          color: group.color,
          letterSpacing: group.letterSpacing
        });
      }
    }

    return fragments;
  }

  function drawActualText(ctx, rootEl, dpr, viewportHeight) {
    const fragments = collectRenderedTextFragments(rootEl, viewportHeight);
    fragments.forEach(fragment => {
      ctx.save();
      ctx.font = fragment.font;
      if (fragment.letterSpacing && fragment.letterSpacing !== 'normal') {
        ctx.letterSpacing = fragment.letterSpacing;
      }
      ctx.textBaseline = 'top';
      ctx.fillStyle = fragment.color;
      ctx.fillText(fragment.text, fragment.x * dpr, fragment.y * dpr);
      ctx.restore();
    });
  }

  function drawWorld(worldCtx, viewportWidth, viewportHeight, dpr, refs) {
    const { editorScroll, editor } = refs;
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg-color').trim() || getComputedStyle(document.body).backgroundColor || '#fbfbfa';
    const iconColor = getComputedStyle(document.documentElement).getPropertyValue('--arrow-color').trim() || '#6f6f6f';
    const focusBg = getComputedStyle(document.documentElement).getPropertyValue('--focus-bg').trim() || 'rgba(0,0,0,0.028)';

    worldCtx.clearRect(0, 0, viewportWidth * dpr, viewportHeight * dpr);
    worldCtx.fillStyle = bg;
    worldCtx.fillRect(0, 0, viewportWidth * dpr, viewportHeight * dpr);

    const rows = Array.from(editor.querySelectorAll('.row'));
    rows.forEach(row => {
      const rowRect = row.getBoundingClientRect();
      if (!isVisibleRect(rowRect, viewportHeight) || rowRect.height <= 0) return;

      if (row.parentElement?.classList.contains('is-focused') && !row.closest('.node-paragraph')) {
        worldCtx.save();
        roundRectPath(worldCtx, rowRect.left * dpr, rowRect.top * dpr, rowRect.width * dpr, rowRect.height * dpr, 4 * dpr);
        worldCtx.fillStyle = focusBg;
        worldCtx.fill();
        worldCtx.restore();
      }

      const arrow = row.querySelector('.toggle-arrow');
      if (arrow) {
        const arrowRect = arrow.getBoundingClientRect();
        if (isVisibleRect(arrowRect, viewportHeight)) {
          drawTriangle(worldCtx, {
            left: arrowRect.left * dpr,
            top: arrowRect.top * dpr,
            width: arrowRect.width * dpr,
            height: arrowRect.height * dpr
          }, arrow.getAttribute('aria-expanded') === 'true', iconColor);
        }
      }

      const plus = row.querySelector('.text-plus');
      if (plus && plus.getClientRects().length > 0 && !plus.disabled && row.parentElement?.classList.contains('is-focused')) {
        const plusRect = plus.getBoundingClientRect();
        if (isVisibleRect(plusRect, viewportHeight)) {
          drawPlus(worldCtx, {
            left: plusRect.left * dpr,
            top: plusRect.top * dpr,
            width: plusRect.width * dpr,
            height: plusRect.height * dpr
          }, iconColor);
        }
      }
    });

    drawActualText(worldCtx, editor, dpr, viewportHeight);

    const scrollRect = editorScroll.getBoundingClientRect();
    if (scrollRect.top > 0) {
      worldCtx.fillStyle = bg;
      worldCtx.fillRect(0, 0, viewportWidth * dpr, scrollRect.top * dpr);
    }
  }

  function createLiquidGlass() {
    const fx = document.getElementById('glassFx');
    const toolbar = document.getElementById('kbdToolbar');
    const pill = toolbar?.querySelector('.pill-container');
    const editorScroll = document.getElementById('editorScroll');
    const editor = document.getElementById('editor');

    if (!fx || !toolbar || !pill || !editorScroll || !editor) return;

    const ctx = fx.getContext('2d', { alpha: true, willReadFrequently: true });
    const world = document.createElement('canvas');
    const worldCtx = world.getContext('2d', { alpha: false, willReadFrequently: true });

    const refs = { editorScroll, editor, toolbar, pill };
    let dpr = 1;
    let viewportWidth = 0;
    let viewportHeight = 0;
    let dirty = true;
    let raf = 0;

    function resize() {
      dpr = Math.max(1, Math.min(MAX_DPR, window.devicePixelRatio || 1));
      window.__liquidGlassDpr = dpr;
      const vv = window.visualViewport;
      viewportWidth = Math.round(vv ? vv.width : window.innerWidth);
      viewportHeight = Math.round(vv ? vv.height : window.innerHeight);

      fx.width = Math.round(viewportWidth * dpr);
      fx.height = Math.round(viewportHeight * dpr);
      fx.style.width = `${viewportWidth}px`;
      fx.style.height = `${viewportHeight}px`;

      world.width = Math.round(viewportWidth * dpr);
      world.height = Math.round(viewportHeight * dpr);

      dirty = true;
    }

    function drawGlass() {
      ctx.clearRect(0, 0, fx.width, fx.height);

      const pillRect = pill.getBoundingClientRect();
      if (pillRect.width <= 0 || pillRect.height <= 0) return;

      const bx = Math.round(pillRect.left * dpr);
      const by = Math.round(pillRect.top * dpr);
      const bw = Math.max(1, Math.round(pillRect.width * dpr));
      const bh = Math.max(1, Math.round(pillRect.height * dpr));
      const safeX = clamp(bx, 0, Math.max(0, world.width - bw));
      const safeY = clamp(by, 0, Math.max(0, world.height - bh));
      const src = worldCtx.getImageData(safeX, safeY, bw, bh);
      const out = ctx.createImageData(bw, bh);
      const s = src.data;
      const d = out.data;
      const radius = bh * 0.5;
      const halfSeg = Math.max(0, bw * 0.5 - radius);

      for (let y = 0; y < bh; y++) {
        const ly = y - bh * 0.5 + 0.5;
        for (let x = 0; x < bw; x++) {
          const lx = x - bw * 0.5 + 0.5;
          const i = (y * bw + x) * 4;
          const sdf = capsuleSdf(lx, ly, halfSeg, radius);
          if (sdf > 0) {
            d[i + 3] = 0;
            continue;
          }

          const px = clamp(lx, -halfSeg, halfSeg);
          const dx = lx - px;
          const dy = ly;
          const dist = Math.hypot(dx, dy);
          const r = dist === 0 ? 0 : dist / radius;
          let srcXm = x;
          let srcYm = y;

          if (dist > 0) {
            const mappedR = mapRadial(r);
            const factor = mappedR / r;
            srcXm = (px + dx * factor) + bw * 0.5 - 0.5;
            srcYm = (dy * factor) + bh * 0.5 - 0.5;
          }

          const base = sampleBilinear(s, bw, bh, srcXm, srcYm);
          let rC = base[0];
          let gC = base[1];
          let bC = base[2];

          let foldedR = r;
          if (r > 0.7) foldedR = 0.7 - (r - 0.7);
          const fringe = Math.pow(Math.max(0, foldedR), 2);

          if (fringe > 0.01 && dist > 0) {
            const shift = 0.55 * dpr * fringe;
            const nx = dx / dist;
            const ny = dy / dist;
            const cR = sampleBilinear(s, bw, bh, srcXm - nx * shift, srcYm - ny * shift);
            const cB = sampleBilinear(s, bw, bh, srcXm + nx * shift, srcYm + ny * shift);
            rC = cR[0];
            bC = cB[2];
          }

          const gloss = 1 + Math.max(0, 0.12 - r * 0.10);
          d[i] = clamp(rC * gloss, 0, 255);
          d[i + 1] = clamp(gC * gloss, 0, 255);
          d[i + 2] = clamp(bC * gloss, 0, 255);
          d[i + 3] = 255;
        }
      }

      ctx.putImageData(out, bx, by);
    }

    let idleFrames = 0;

    function renderFrame() {
      if (dirty) {
        drawWorld(worldCtx, viewportWidth, viewportHeight, dpr, refs);
        dirty = false;
        idleFrames = 0; // Reseta o contador de inatividade
      } else {
        idleFrames++;
      }

      drawGlass();

      // O PULO DO GATO: Se o usuário parar de digitar/rolar a tela 
      // por mais de 30 quadros (meio segundo), o motor DESLIGA sozinho!
      if (idleFrames > 30) {
        raf = 0;
        return; 
      }

      raf = requestAnimationFrame(renderFrame);
    }

    function requestRender() {
      dirty = true;
      if (!raf) raf = requestAnimationFrame(renderFrame);
    }

    const events =['scroll', 'input', 'keyup', 'mouseup', 'touchmove', 'touchend'];
    events.forEach(name => editorScroll.addEventListener(name, requestRender, { passive: true }));
    editor.addEventListener('input', requestRender);
    window.addEventListener('resize', () => {
      resize();
      requestRender();
    }, { passive: true });

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => {
        resize();
        requestRender();
      }, { passive: true });
      window.visualViewport.addEventListener('scroll', () => {
        resize();
        requestRender();
      }, { passive: true });
    }

    resize();
    requestRender();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createLiquidGlass, { once: true });
  } else {
    createLiquidGlass();
  }
})();