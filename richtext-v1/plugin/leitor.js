document.addEventListener('DOMContentLoaded', () => {
  if (typeof M1_Config === 'undefined' || !M1_Config.editor || !M1_Config.toolbar) return;
  const editor = M1_Config.editor;
  const toolbar = M1_Config.toolbar;
  const leitorBtn = toolbar.querySelector('[aria-label="Modo Bíblia"]');
  if (!leitorBtn) return;

  const PERF_LOW = !!(window.EditorPerfProfile?.isLow?.() || document.documentElement.classList.contains('perf-low'));

  let isReadOnly = false, processedNodes = new WeakSet(), multiRefAuraEnabled = false, modeVersion = 0;
  const aliases = typeof ABREVIACOES === 'object' ? ABREVIACOES : (window.ABREVIACOES || {});

  const bindTapIntent = (el, handler, { delay = 240, slop = 10, preventFocus = true } = {}) => {
    if (!el || typeof handler !== 'function') return;
    let pointerId = null, startX = 0, startY = 0, moved = false, lastFire = 0;
    const canRun = () => {
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
      const now = Date.now();
      if (now - lastFire < delay) return false;
      lastFire = now;
      return true;
    };
    const begin = (x, y, id = null) => { pointerId = id; startX = x; startY = y; moved = false; };
    const track = (x, y) => { if (moved) return; if (Math.hypot(x - startX, y - startY) > slop) moved = true; };
    const reset = () => { pointerId = null; moved = false; };
    const finish = e => {
      const wasMoved = moved; reset();
      if (wasMoved || !canRun()) { if (e) { e.preventDefault(); e.stopPropagation(); } return; }
      handler(e);
    };
    el.addEventListener('pointerdown', e => { if (preventFocus) e.preventDefault(); begin(e.clientX, e.clientY, e.pointerId); });
    el.addEventListener('pointermove', e => { if (pointerId !== e.pointerId) return; track(e.clientX, e.clientY); });
    el.addEventListener('pointercancel', reset);
    el.addEventListener('pointerup', e => { if (pointerId !== e.pointerId) return; e.preventDefault(); finish(e); });
    el.addEventListener('touchstart', e => { if (preventFocus) e.preventDefault(); const t = e.changedTouches[0]; if (!t) return; begin(t.clientX, t.clientY, t.identifier); }, { passive: false });
    el.addEventListener('touchmove', e => { const t = Array.from(e.changedTouches).find(t => pointerId === null || t.identifier === pointerId); if (!t) return; track(t.clientX, t.clientY); if (moved) e.preventDefault(); }, { passive: false });
    el.addEventListener('touchcancel', reset, { passive: false });
    el.addEventListener('touchend', e => { const t = Array.from(e.changedTouches).find(t => pointerId === null || t.identifier === pointerId); if (!t) return; e.preventDefault(); finish(e); }, { passive: false });
    el.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); });
  };

  const normalizeBookKey = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\.\s]/g, '').toLowerCase();
  const escapeRegex = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const buildBibleRegex = () => {
    const rawKeys = Array.from(new Set(Object.keys(aliases))).filter(Boolean).sort((a, b) => b.length - a.length);
    const bookPattern = rawKeys.length ? rawKeys.map(key => escapeRegex(key).replace(/\s+/g, '\\s*')).join('|') : '[1-3]?\\s?[A-Za-zÀ-ÖØ-öø-ÿ.]+';
    const end = '(?:\\d{1,3}\\s*:\\s*)?\\d{1,3}';
    const range = `(?:\\s*[-–—]\\s*${end})?`;
    const verses = `\\d{1,3}${range}(?:\\s*[,;]\\s*${end}${range})*`;
    return new RegExp(`(^|[^A-Za-zÀ-ÖØ-öø-ÿ0-9])(${bookPattern})\\s*(\\d{1,3})\\s*([:;])\\s*(${verses})(?!\\d)`, 'gi');
  };

  const REGEX_BBL = buildBibleRegex();
  const ABREV_NORMALIZED_KEYS = new Set(Object.keys(aliases).map(normalizeBookKey));
  const waitForBible = (cb, version) => {
    const check = () => {
      if (!isReadOnly || version !== modeVersion) return;
      if (window.setupBblLinkListeners) cb(); else setTimeout(check, 150);
    };
    check();
  };
  const allEditables = () => Array.from(editor.querySelectorAll('.paragraph-content, .toggle-title, .text-content'));
  const getToolbarControls = () => Array.from(toolbar.querySelectorAll('button, input, select, textarea')).filter(el => el !== leitorBtn);

  const setToolbarLocked = locked => {
    toolbar.classList.toggle('leitor-toolbar-locked', !!locked);
    getToolbarControls().forEach(el => {
      if (locked) {
        if (!el.hasAttribute('data-leitor-prev-disabled')) el.setAttribute('data-leitor-prev-disabled', el.disabled ? '1' : '0');
        if (!el.hasAttribute('data-leitor-prev-tabindex') && el.hasAttribute('tabindex')) el.setAttribute('data-leitor-prev-tabindex', el.getAttribute('tabindex') || '');
        if ('disabled' in el) el.disabled = true;
        el.setAttribute('aria-disabled', 'true');
        el.setAttribute('tabindex', '-1');
      } else {
        const wasDisabled = el.getAttribute('data-leitor-prev-disabled') === '1';
        if ('disabled' in el) el.disabled = wasDisabled;
        if (el.hasAttribute('data-leitor-prev-tabindex')) {
          const prevTabIndex = el.getAttribute('data-leitor-prev-tabindex') || '';
          if (prevTabIndex === '') el.removeAttribute('tabindex'); else el.setAttribute('tabindex', prevTabIndex);
          el.removeAttribute('data-leitor-prev-tabindex');
        } else { el.removeAttribute('tabindex'); }
        el.removeAttribute('aria-disabled');
        el.removeAttribute('data-leitor-prev-disabled');
      }
    });
  };

  function createLeitorBorderFx(anchorEl) {
    const host = document.createElement('div');
    host.className = 'leitor-fx';
    host.innerHTML = `<div class="leitor-fx__fog"><canvas aria-hidden="true"></canvas></div><div class="leitor-fx__smoke"><canvas aria-hidden="true"></canvas></div>`;
    document.body.appendChild(host);
    const fogCanvas = host.querySelector('.leitor-fx__fog canvas'), glowCanvas = host.querySelector('.leitor-fx__smoke canvas');
    const fogCtx = fogCanvas.getContext('2d', { alpha: true }), glowCtx = glowCanvas.getContext('2d', { alpha: true });

    const GRADIENT = [{t:0,r:58,g:110,b:255},{t:.1,r:46,g:145,b:255},{t:.2,r:28,g:195,b:255},{t:.32,r:0,g:245,b:255},{t:.46,r:120,g:92,b:255},{t:.58,r:185,g:88,b:255},{t:.68,r:255,g:110,b:220},{t:.76,r:255,g:180,b:235},{t:.86,r:254,g:245,b:124},{t:.94,r:254,g:176,b:119},{t:1,r:58,g:110,b:255}];
    function gradientColor(t) {
      const p = ((t % 1) + 1) % 1; let a = GRADIENT[0], b = GRADIENT[GRADIENT.length - 1];
      for (let i = 0; i < GRADIENT.length - 1; i++) { if (p >= GRADIENT[i].t && p <= GRADIENT[i + 1].t) { a = GRADIENT[i]; b = GRADIENT[i + 1]; break; } }
      const f = (p - a.t) / (b.t - a.t || 1), sf = f * f * (3 - 2 * f);
      return [Math.round(a.r + (b.r - a.r) * sf), Math.round(a.g + (b.g - a.g) * sf), Math.round(a.b + (b.b - a.b) * sf)];
    }

    let isEffectOn = false, glowAlpha = 0, fogAnim = null, boomAnim = null, W = 0, H = 0, dpr = 1, fogDpr = 1, lastTime = 0, raf = 0, lastFluidPaint = 0, lastFogBlit = 0;
    let fluidCanvas, fluidCtx, fluidW = 0, fluidH = 0, grainCanvas, grainCtx, fluidOffsets = [];
    const FLUID_STEPS = 84;
    const STEADY_FLUID_MS = 45;
    const STEADY_FOG_MS = 45;
    let path = null, waves = [];

    const rand = (lo, hi) => lo + Math.random() * (hi - lo);
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const easeOutQuad = t => 1 - (1 - t) ** 2, easeInQuad = t => t * t, easeInOut = t => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t, easeOutCubic = t => 1 - (1 - t) ** 3;

    function currentRadius() { const css = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--leitor-fx-radius')); return clamp(Number.isFinite(css) ? css : 28, 8, Math.min(W, H) / 2 - 1); }
    function buildPath() { const r = currentRadius(), sx = Math.max(1, W - r * 2), sy = Math.max(1, H - r * 2), arc = Math.PI * r * 0.5; path = { r, sx, sy, arc, total: (sx + sy) * 2 + arc * 4 }; }
    function pointOnBorder(t) {
      const { r, sx, sy, arc, total } = path; let s = ((t % 1) + 1) % 1 * total; const L = 0, T = 0, R2 = r * 2 + sx, B = r * 2 + sy;
      if (s <= sx) return { x: L+r+s, y: T, nx: 0, ny: -1 }; s -= sx;
      if (s <= arc) { const a = -Math.PI/2+s/arc*(Math.PI/2); return { x: R2-r+Math.cos(a)*r, y: T+r+Math.sin(a)*r, nx: Math.cos(a), ny: Math.sin(a) }; } s -= arc;
      if (s <= sy) return { x: R2, y: T+r+s, nx: 1, ny: 0 }; s -= sy;
      if (s <= arc) { const a = s/arc*(Math.PI/2); return { x: R2-r+Math.cos(a)*r, y: B-r+Math.sin(a)*r, nx: Math.cos(a), ny: Math.sin(a) }; } s -= arc;
      if (s <= sx) return { x: R2-r-s, y: B, nx: 0, ny: 1 }; s -= sx;
      if (s <= arc) { const a = Math.PI/2+s/arc*(Math.PI/2); return { x: L+r+Math.cos(a)*r, y: B-r+Math.sin(a)*r, nx: Math.cos(a), ny: Math.sin(a) }; } s -= arc;
      if (s <= sy) return { x: L, y: B-r-s, nx: -1, ny: 0 }; s -= sy;
      const a = Math.PI + s/arc*(Math.PI/2); return { x: L+r+Math.cos(a)*r, y: T+r+Math.sin(a)*r, nx: Math.cos(a), ny: Math.sin(a) };
    }

    function buildWaves() {
      waves = Array.from({ length: 24 }, (_, i) => ({
        pos: i / 24,
        speed: rand(0.095, 0.145) * (Math.random() < 0.32 ? -1 : 1),
        length: rand(0.08, 0.16),
        maxThick: rand(0.34, 0.56),
        maxGlow: rand(2.9, 4.4),
        wob: rand(0.003, 0.010),
        wobSpeed: rand(0.25, 0.7),
        phase: rand(0, Math.PI * 2)
      }));
    }

    function drawCoreBlob(x, y, rCore, rSpread, color, alpha, sx, sy, angle) {
      const [cr, cg, cb] = color; glowCtx.save(); glowCtx.translate(x, y); glowCtx.rotate(angle); glowCtx.scale(sx, sy);
      const maxR = rCore + rSpread, pCore = Math.min(1, rCore / maxR), pMid = pCore + (1 - pCore) * 0.28;
      const g = glowCtx.createRadialGradient(0, 0, 0, 0, 0, maxR);
      g.addColorStop(0, `rgba(${cr},${cg},${cb},${Math.min(1, alpha * 1.06)})`); g.addColorStop(pCore, `rgba(${cr},${cg},${cb},${Math.min(1, alpha * 0.95)})`);
      g.addColorStop(pMid, `rgba(${cr},${cg},${cb},${alpha * 0.26})`); g.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
      glowCtx.fillStyle = g; glowCtx.beginPath(); glowCtx.arc(0, 0, maxR, 0, Math.PI * 2); glowCtx.fill(); glowCtx.restore();
    }

    function drawHalo(x, y, waveR, color, waveBoost, angle) {
      const [cr, cg, cb] = color, R2 = 12 + waveR, aN = 0.000018 + waveBoost * 0.05, aM = 0.000007 + waveBoost * 0.006, aF = 0.000002 + waveBoost * 0.005;
      glowCtx.save(); glowCtx.translate(x, y); glowCtx.rotate(angle); glowCtx.scale(3.6, 1.5);
      const g = glowCtx.createRadialGradient(0, 0, 0, 0, 0, R2);
      g.addColorStop(0, `rgba(${cr},${cg},${cb},${aN.toFixed(4)})`); g.addColorStop(0.2, `rgba(${cr},${cg},${cb},${aN.toFixed(4)})`);
      g.addColorStop(0.5, `rgba(${cr},${cg},${cb},${aM.toFixed(4)})`); g.addColorStop(1, `rgba(${cr},${cg},${cb},${aF.toFixed(4)})`);
      glowCtx.fillStyle = g; glowCtx.beginPath(); glowCtx.arc(0, 0, R2, 0, Math.PI * 2); glowCtx.fill(); glowCtx.restore();
    }

    function drawBoomBloom(x, y, bloomR, color, alpha, angle) {
      const [cr, cg, cb] = color; glowCtx.save(); glowCtx.translate(x, y); glowCtx.rotate(angle); glowCtx.scale(5.2, 2.0);
      const g = glowCtx.createRadialGradient(0, 0, 0, 0, 0, bloomR);
      g.addColorStop(0, `rgba(${cr},${cg},${cb},${(alpha * 0.26).toFixed(4)})`); g.addColorStop(0.16, `rgba(${cr},${cg},${cb},${(alpha * 0.16).toFixed(4)})`);
      g.addColorStop(0.52, `rgba(${cr},${cg},${cb},${(alpha * 0.055).toFixed(4)})`); g.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
      glowCtx.fillStyle = g; glowCtx.beginPath(); glowCtx.arc(0, 0, bloomR, 0, Math.PI * 2); glowCtx.fill(); glowCtx.restore();
    }

    function initFluid() {
      fluidW = Math.max(1, Math.round(W * fogDpr)); fluidH = Math.max(1, Math.round(H * fogDpr));
      fluidCanvas = document.createElement('canvas'); fluidCanvas.width = fluidW; fluidCanvas.height = fluidH;
      fluidCtx = fluidCanvas.getContext('2d', { alpha: true }); fluidCtx.setTransform(fogDpr, 0, 0, fogDpr, 0, 0); fluidCtx.imageSmoothingEnabled = true;
    }

    function initGrain() {
      grainCanvas = document.createElement('canvas'); grainCanvas.width = Math.max(1, Math.round(W * fogDpr)); grainCanvas.height = Math.max(1, Math.round(H * fogDpr));
      grainCtx = grainCanvas.getContext('2d', { alpha: true }); const img = grainCtx.createImageData(grainCanvas.width, grainCanvas.height); const data = img.data;
      for (let i = 0; i < data.length; i += 4) { const v = 118 + Math.random() * 20; data[i] = v; data[i+1] = v; data[i+2] = v; data[i+3] = 255; }
      grainCtx.putImageData(img, 0, 0);
      fluidOffsets = Array.from({ length: FLUID_STEPS }, (_, i) => ({ base: rand(-0.0022, 0.0022), drift: rand(0.0004, 0.0012), phase: rand(0, Math.PI * 2) + i * 0.11 }));
    }

    function paintFluidLayer(time, go, radius, phaseShift, alphaScale, inset, radiusScale) {
      for (let i = 0; i < FLUID_STEPS; i++) {
        const seed = fluidOffsets[i], drift = Math.sin(time * 0.00042 + seed.phase) * seed.drift, t = (i / FLUID_STEPS) + phaseShift + seed.base + drift;
        const pos = pointOnBorder(t), rgb = gradientColor(t + go), innerX = pos.x - pos.nx * inset, innerY = pos.y - pos.ny * inset, localRadius = radius * radiusScale;
        const grad = fluidCtx.createRadialGradient(innerX, innerY, 0, innerX, innerY, localRadius);
        grad.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${0.082 * alphaScale})`); grad.addColorStop(0.22, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${0.050 * alphaScale})`);
        grad.addColorStop(0.52, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${0.018 * alphaScale})`); grad.addColorStop(0.82, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${0.006 * alphaScale})`);
        grad.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
        fluidCtx.fillStyle = grad; fluidCtx.beginPath(); fluidCtx.arc(innerX, innerY, localRadius, 0, Math.PI * 2); fluidCtx.fill();
      }
    }

    function paintFluid(time) {
      fluidCtx.clearRect(0, 0, W, H); const go = (time * 0.001 * 0.12) % 1; fluidCtx.globalCompositeOperation = 'screen';
      const radius = clamp(Math.min(W, H) * 0.38, 120, 220);
      paintFluidLayer(time, go, radius, 0, 1, 7, 1); paintFluidLayer(time, go, radius, 0.5 / FLUID_STEPS, 0.72, 10, 0.86);
      fluidCtx.globalCompositeOperation = 'source-over';
    }

    function paintFluidSteady(time) {
      fluidCtx.clearRect(0, 0, W, H); const go = (time * 0.001 * 0.12) % 1; fluidCtx.globalCompositeOperation = 'screen';
      const radius = clamp(Math.min(W, H) * 0.20, 70, 132);
      paintFluidLayer(time, go, radius, 0, 0.92, 6, 1); paintFluidLayer(time, go, radius, 0.5 / FLUID_STEPS, 0.6, 9, 0.82);
      fluidCtx.globalCompositeOperation = 'source-over';
    }

    function getButtonCenter() { const br = anchorEl.getBoundingClientRect(), fr = fogCanvas.getBoundingClientRect(); return { x: br.left + br.width * 0.5 - fr.left, y: br.top + br.height * 0.5 - fr.top }; }
    function cornerRadius(bx, by) { return Math.hypot(Math.max(bx, W - bx), Math.max(by, H - by)); }

    function renderFog(time) {
      if (!fogAnim) {
        if (!isEffectOn || glowAlpha <= 0.01) { fogCtx.clearRect(0, 0, W, H); lastFogBlit = 0; return; }
        if (lastFogBlit && time - lastFogBlit < STEADY_FOG_MS) return;
        lastFogBlit = time;
        fogCtx.clearRect(0, 0, W, H);
        fogCtx.save(); fogCtx.globalAlpha = glowAlpha * 0.92; fogCtx.filter = 'blur(14px)';
        fogCtx.drawImage(fluidCanvas, 0, 0, W, H); fogCtx.filter = 'none'; fogCtx.restore();
        if (grainCanvas) { fogCtx.save(); fogCtx.globalAlpha = 0.012; fogCtx.drawImage(grainCanvas, 0, 0, grainCanvas.width, grainCanvas.height, 0, 0, W, H); fogCtx.restore(); }
        return;
      }
      fogCtx.clearRect(0, 0, W, H);
      const raw = (time - fogAnim.startTime) / fogAnim.duration, t = clamp(raw, 0, 1), btn = getButtonCenter(), maxR = cornerRadius(btn.x, btn.y) * 1.15;
      let burstR = maxR, holeProgress = 0;
      if (fogAnim.dir === 'on') {
        burstR = maxR * (1 - Math.pow(1 - clamp(t / 0.55, 0, 1), 5)); holeProgress = easeInOut(clamp((t - 0.3) / 0.7, 0, 1)); glowAlpha = easeOutQuad(clamp((t - 0.3) / 0.7, 0, 1));
      } else {
        holeProgress = 1.0 - easeInOut(clamp(t / 0.4, 0, 1)); burstR = maxR * (1 - Math.pow(clamp((t - 0.2) / 0.8, 0, 1), 4)); glowAlpha = 1.0 - easeOutQuad(clamp(t / 0.4, 0, 1));
      }
      if (t >= 1) {
        const dir = fogAnim.dir; fogAnim = null; fogCtx.clearRect(0, 0, W, H); lastFogBlit = 0;
        if (dir === 'off') { isEffectOn = false; glowAlpha = 0; host.classList.remove('is-mounted'); document.documentElement.classList.remove('leitor-glow-active'); }
        else { glowAlpha = 1; host.classList.add('is-mounted'); document.documentElement.classList.add('leitor-glow-active'); boomAnim = { startTime: performance.now(), duration: 400 }; }
        return;
      }
      if (fogAnim.dir === 'on' && burstR < 2) return;

      fogCtx.save(); fogCtx.filter = 'blur(10px)'; fogCtx.drawImage(fluidCanvas, 0, 0, W, H); fogCtx.filter = 'none'; fogCtx.restore();
      const centerAlpha = 1.0 - easeInQuad(holeProgress);
      if (centerAlpha > 0.005) {
        const go = (time * 0.001 * 0.12) % 1, c1 = gradientColor(go), c2 = gradientColor((go + 0.15) % 1), c3 = gradientColor((go + 0.3) % 1), cx = W * 0.5, cy = H * 0.5;
        const fillGrad = fogCtx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.9);
        fillGrad.addColorStop(0, `rgba(${c1[0]},${c1[1]},${c1[2]},${0.5 * centerAlpha})`); fillGrad.addColorStop(0.4, `rgba(${c2[0]},${c2[1]},${c2[2]},${0.4 * centerAlpha})`);
        fillGrad.addColorStop(0.8, `rgba(${c3[0]},${c3[1]},${c3[2]},${0.3 * centerAlpha})`); fillGrad.addColorStop(1, `rgba(${c3[0]},${c3[1]},${c3[2]},0)`);
        fogCtx.save(); fogCtx.fillStyle = fillGrad; fogCtx.fillRect(0, 0, W, H); fogCtx.restore();
      }
      if (burstR < maxR * 0.99) {
        fogCtx.save(); fogCtx.globalCompositeOperation = 'destination-in';
        const mask = fogCtx.createRadialGradient(btn.x, btn.y, Math.max(0, burstR - maxR * 0.2), btn.x, btn.y, Math.max(Math.max(0, burstR - maxR * 0.2) + 1, burstR));
        mask.addColorStop(0, 'rgba(0,0,0,1)'); mask.addColorStop(1, 'rgba(0,0,0,0)');
        fogCtx.fillStyle = mask; fogCtx.fillRect(0, 0, W, H); fogCtx.restore();
      }
      if (holeProgress > 0.001) {
        const cx = W * 0.5, cy = H * 0.5, outerR = holeProgress * Math.hypot(cx, cy) * 1.35;
        if (outerR > 0.5) {
          fogCtx.save(); fogCtx.globalCompositeOperation = 'destination-in';
          const g = fogCtx.createRadialGradient(cx, cy, Math.max(0, outerR - Math.hypot(cx, cy) * 0.62), cx, cy, outerR);
          g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,1)');
          fogCtx.fillStyle = g; fogCtx.fillRect(0, 0, W, H); fogCtx.restore();
        }
      }
      if (grainCanvas) { fogCtx.save(); fogCtx.globalAlpha = 0.016; fogCtx.drawImage(grainCanvas, 0, 0, grainCanvas.width, grainCanvas.height, 0, 0, W, H); fogCtx.restore(); }
    }

    function renderBoom(time) {
      if (!boomAnim) return;
      const elapsed = time - boomAnim.startTime, ATTACK = 1055, DECAY = 4500;
      if (elapsed >= ATTACK + DECAY) { boomAnim = null; return; }
      const mainPulse = elapsed < ATTACK ? easeOutCubic(clamp(elapsed / ATTACK, 0, 1)) : 1 - easeOutQuad(clamp((elapsed - ATTACK) / DECAY, 0, 1));
      const mistPulse = elapsed < ATTACK ? easeOutCubic(clamp(elapsed / ATTACK, 0, 1)) : 1 - easeOutCubic(clamp((elapsed - ATTACK) / DECAY, 0, 1));
      const tailFade = 1 - easeInQuad(clamp((elapsed - ATTACK) / DECAY, 0, 1));
      const boomOut = (16 + 12 * mainPulse) * tailFade, boomCore = (1.8 + 4.6 * mainPulse) * tailFade, boomShell = (4.8 + 4.4 * mainPulse) * tailFade, boomGlow = (24 + 22 * mistPulse) * tailFade;
      const go = (time * 0.001 * 0.12) % 1;
      glowCtx.save(); glowCtx.globalCompositeOperation = 'screen';
      for (let i = 0; i < 96; i++) {
        const tPos = i / 96, pos = pointOnBorder(tPos), angle = Math.atan2(pos.nx, -pos.ny), rgb = gradientColor(tPos + go);
        drawBoomBloom(pos.x + pos.nx * ((9 + 6.5 * mainPulse) * tailFade + boomOut * 0.22), pos.y + pos.ny * ((9 + 6.5 * mainPulse) * tailFade + boomOut * 0.22), boomGlow, rgb, (0.1 + 0.26 * mistPulse) * tailFade, angle);
        drawCoreBlob(pos.x + pos.nx * (5.2 + boomOut * 0.24), pos.y + pos.ny * (5.2 + boomOut * 0.24), 4 + boomCore * 0.22, boomShell, rgb, (0.26 + mainPulse * 0.18) * tailFade, 5.9, 0.62, angle);
        drawCoreBlob(pos.x + pos.nx * (1.6 + boomOut * 0.12), pos.y + pos.ny * (1.6 + boomOut * 0.12), 3.1 + boomCore, 2 + boomOut * 0.18, rgb, (0.64 + mainPulse * 0.18) * tailFade, 5.0, 0.46, angle);
      }
      glowCtx.globalAlpha = (0.12 + mistPulse * 0.18) * tailFade; glowCtx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 48; i++) {
        const tPos = i / 48, pos = pointOnBorder(tPos), angle = Math.atan2(pos.nx, -pos.ny), rgb = gradientColor(tPos + go + 0.03);
        drawBoomBloom(pos.x + pos.nx * (10 + boomOut * 0.2), pos.y + pos.ny * (10 + boomOut * 0.2), 18 + boomGlow * 0.72, rgb, (0.08 + mistPulse * 0.12) * tailFade, angle);
      }
      glowCtx.globalCompositeOperation = 'source-over'; glowCtx.restore();
    }

    function render(time) {
      const dt = Math.min(0.08, Math.max(0.03, (time - (lastTime || time)) / 1000)); lastTime = time;
      glowCtx.clearRect(0, 0, W, H);
      for (const w of waves) w.pos = (w.pos + w.speed * dt + 1) % 1;
      if (isEffectOn) {
        const go = (time * 0.001 * 0.12) % 1;
        const breathe = 0.94 + 0.06 * Math.sin(time * 0.0012);
        glowCtx.globalAlpha = glowAlpha * breathe;
        for (let i = 0; i < 120; i++) {
          const t = i / 120; let rCore = 3.18, rSpread = 1.35, localAlpha = 0.6, waveBoost = 0;
          for (const w of waves) {
            const wp = ((w.pos + Math.sin(time * 0.001 * w.wobSpeed + w.phase) * w.wob) % 1 + 1) % 1;
            let d = Math.abs(t - wp); if (d > 0.5) d = 1 - d;
            if (d < w.length) { const sh = Math.pow(Math.cos(d / w.length * Math.PI * 0.5), 2); rCore += w.maxThick * sh; rSpread += w.maxGlow * sh; localAlpha += 0.05 * sh; waveBoost += 0.24 * sh; }
          }
          const pos = pointOnBorder(t), angle = Math.atan2(pos.nx, -pos.ny);
          const colT = t + go + Math.sin(t * Math.PI * 4 + time * 0.00055) * 0.024, rgb = gradientColor(colT);
          drawHalo(pos.x, pos.y, waveBoost * 14, rgb, waveBoost, angle); drawCoreBlob(pos.x, pos.y, rCore, rSpread, rgb, localAlpha, 4.5, 0.4, angle);
        }
        glowCtx.globalAlpha = 1;
      }
      renderBoom(time);
      if (fogAnim) { if (time - lastFluidPaint > 33 || !lastFluidPaint) { paintFluid(time); lastFluidPaint = time; } }
      else if (isEffectOn) { if (time - lastFluidPaint > STEADY_FLUID_MS || !lastFluidPaint) { paintFluidSteady(time); lastFluidPaint = time; } }
      renderFog(time);
      if (!isEffectOn && !fogAnim && !boomAnim) { raf = 0; lastTime = 0; lastFogBlit = 0; return; }
      raf = requestAnimationFrame(render);
    }

    function ensureRunning() { if (raf) return; lastTime = 0; raf = requestAnimationFrame(render); }
    function resize() {
      const vv = window.visualViewport; W = Math.round(vv ? vv.width : window.innerWidth); H = Math.round(vv ? vv.height : window.innerHeight);
      dpr = Math.min(window.devicePixelRatio || 1, 1.5); fogDpr = Math.min(dpr, 0.9);
      host.style.width = `${W}px`; host.style.height = `${H}px`; glowCanvas.width = Math.round(W * dpr); glowCanvas.height = Math.round(H * dpr);
      glowCanvas.style.width = `${W}px`; glowCanvas.style.height = `${H}px`; glowCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      fogCanvas.width = Math.round(W * dpr); fogCanvas.height = Math.round(H * dpr); fogCanvas.style.width = `${W}px`; fogCanvas.style.height = `${H}px`;
      fogCtx.setTransform(dpr, 0, 0, dpr, 0, 0); fogCtx.imageSmoothingEnabled = true;
      buildPath(); initFluid(); initGrain(); buildWaves(); lastTime = 0; lastFluidPaint = 0;
    }
    function setEnabled(next) {
      if (next) { isEffectOn = true; glowAlpha = 0; boomAnim = null; fogAnim = { dir: 'on', startTime: performance.now(), duration: 350 }; host.classList.add('is-mounted'); document.documentElement.classList.add('leitor-glow-active'); ensureRunning(); return; }
      if (!isEffectOn && !fogAnim) return; boomAnim = null; fogAnim = { dir: 'off', startTime: performance.now(), duration: 300 }; ensureRunning();
    }
    function forceOff() {
      isEffectOn = false; glowAlpha = 0; fogAnim = null; boomAnim = null; lastFogBlit = 0; host.classList.remove('is-mounted'); document.documentElement.classList.remove('leitor-glow-active'); glowCtx.clearRect(0, 0, W, H); fogCtx.clearRect(0, 0, W, H);
      if (raf) { cancelAnimationFrame(raf); raf = 0; } lastTime = 0;
    }
    function destroy() {
      forceOff(); window.removeEventListener('resize', resize); window.visualViewport?.removeEventListener('resize', resize); window.visualViewport?.removeEventListener('scroll', resize); host.remove();
    }
    window.addEventListener('resize', resize); window.visualViewport?.addEventListener('resize', resize); window.visualViewport?.addEventListener('scroll', resize); window.addEventListener('pagehide', forceOff);
    resize(); return { setEnabled, forceOff, destroy };
  }

  const leitorFx = PERF_LOW || matchMedia('(prefers-reduced-motion: reduce)').matches ? null : createLeitorBorderFx(leitorBtn);

  const enableReadOnly = ({ toastMessage = null, autoOpenRef = null, enableAura = false } = {}) => {
    const version = ++modeVersion;
    editor.setAttribute('contenteditable', 'false'); editor.classList.add('is-read-only');
    document.body.classList.add('leitor-keep-toolbar'); document.body.classList.add('editor-has-focus');
    window.M4_Caret?.updateFocus?.();
    if (window.M12_History) window.M12_History._leitorPaused = true;
    leitorBtn.classList.add('is-active'); leitorBtn.setAttribute('aria-pressed', 'true');
    setToolbarLocked(true); if (!PERF_LOW) leitorFx?.setEnabled(true); multiRefAuraEnabled = !PERF_LOW && !!enableAura;
    waitForBible(async () => {
      await processAllContent(version);
      if (!isReadOnly || version !== modeVersion || !autoOpenRef?.editable?.isConnected) return;
      const targetSpan = Array.from(autoOpenRef.editable.querySelectorAll('.bbl')).find(span => {
        const range = document.createRange(); range.selectNodeContents(autoOpenRef.editable); range.setEndBefore(span);
        return range.toString().length === autoOpenRef.index;
      });
      if (targetSpan) window.abrirModalBibl?.(targetSpan.dataset.ref, targetSpan);
    }, version);
    if (toastMessage) showToast(toastMessage);
  };

  const disableReadOnly = ({ reference = null } = {}) => {
    ++modeVersion; isReadOnly = false;
    const replacement = removeAllLinks(reference); leitorFx?.setEnabled(false);
    editor.setAttribute('contenteditable', 'true'); editor.classList.remove('is-read-only');
    document.body.classList.remove('leitor-keep-toolbar');
    if (window.M12_History) window.M12_History._leitorPaused = false;
    leitorBtn.classList.remove('is-active'); leitorBtn.setAttribute('aria-pressed', 'false');
    setToolbarLocked(false); setTimeout(() => window.M4_Caret?.updateFocus?.(), 0);
    processedNodes = new WeakSet(); multiRefAuraEnabled = false;
    return replacement;
  };

  const scanTextForRefs = text => {
    const source = String(text || ''), refs = []; REGEX_BBL.lastIndex = 0; let match;
    while ((match = REGEX_BBL.exec(source)) !== null) {
      const prefix = match[1] || '', book = match[2] || '', chapter = match[3] || '', sep = match[4] || ':', verses = match[5] || '', refText = `${book} ${chapter}${sep}${verses}`.replace(/\s+/g, ' ').trim();
      if (!book || !chapter || !verses) continue;
      if (ABREV_NORMALIZED_KEYS.size) { const bookKey = normalizeBookKey(book); if (!ABREV_NORMALIZED_KEYS.has(bookKey)) continue; }
      refs.push({ index: match.index + prefix.length, length: match[0].length - prefix.length, text: refText });
    }
    return refs;
  };

  const scanEditorReferences = () => allEditables().flatMap(editable =>
    scanTextForRefs(editable.textContent || '').map(ref => ({...ref, editable})));

  const referenceAtCaret = refs => {
    const live = M2_Query.curRange();
    const range = live && editor.contains(live.startContainer) ? live : M1_Config.state.lastR;
    if (!range || !editor.contains(range.startContainer)) return refs.length === 1 ? refs[0] : null;
    const editable = M2_Query.closest(range.startContainer, '.editable');
    if (!editable) return null;
    const before = range.cloneRange(); before.selectNodeContents(editable); before.setEnd(range.startContainer, range.startOffset);
    const offset = before.toString().length;
    const editables = allEditables(), index = editables.indexOf(editable);
    return refs.filter(ref => ref.editable === editable ? ref.index <= offset : editables.indexOf(ref.editable) < index).at(-1) || null;
  };
  const toggle = () => {
    if (isReadOnly) { disableReadOnly(); return; }
    const refs = scanEditorReferences();
    if (!refs.length) { showToast('Não há versículos bíblicos'); return; }
    const target = referenceAtCaret(refs);
    isReadOnly = true;
    enableReadOnly({autoOpenRef: target, toastMessage: target ? null : 'Modo Bíblia', enableAura: !PERF_LOW});
  };

  const processAllContent = version => new Promise(resolve => {
    const editables = allEditables(); let index = 0;
    const pump = () => {
      if (!isReadOnly || version !== modeVersion) { resolve(); return; }
      const end = Math.min(index + (PERF_LOW ? 4 : 20), editables.length);
      for (; index < end; index++) processEditable(editables[index]);
      if (index < editables.length) setTimeout(pump, 0); else resolve();
    };
    pump();
  });

  const processEditable = el => {
    if (!el || processedNodes.has(el)) return;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode(node) { if (node.parentElement?.classList.contains('bbl')) return NodeFilter.FILTER_REJECT; if (!node.textContent.trim()) return NodeFilter.FILTER_REJECT; return NodeFilter.FILTER_ACCEPT; } });
    const toProcess = []; let node; while ((node = walker.nextNode())) toProcess.push(node);
    toProcess.forEach(n => processTextNode(n)); processedNodes.add(el);
  };

  const processTextNode = textNode => {
    const text = textNode.textContent, matches = scanTextForRefs(text); if (!matches.length) return;
    const frag = document.createDocumentFragment(); let last = 0;
    matches.forEach(({ index, length, text: ref }) => {
      if (index > last) frag.appendChild(document.createTextNode(text.slice(last, index)));
      const span = document.createElement('span'); span.className = 'bbl'; if (multiRefAuraEnabled) span.classList.add('bbl--aura');
      span.textContent = text.slice(index, index + length); span.setAttribute('data-ref', ref);
      if (window.setupBblLinkListeners) window.setupBblLinkListeners(span);
      frag.appendChild(span); last = index + length;
    });
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    textNode.parentNode.replaceChild(frag, textNode);
  };

  const removeAllLinks = reference => {
    let replacement = reference;
    const targetEditable = reference?.closest?.('.editable');
    editor.querySelectorAll('.bbl').forEach(span => {
      const text = document.createTextNode(span.textContent);
      if (span === reference) replacement = text;
      span.replaceWith(text);
    });
    // Preserve this exact text node until the transcription wraps it in a
    // persistent source. Normalizing it now could merge it with another ref.
    allEditables().filter(el => el !== targetEditable).forEach(el => el.normalize());
    return replacement;
  };

  const showToast = msg => {
    let toast = document.getElementById('leitor-toast');
    if (!toast) { toast = document.createElement('div'); toast.id = 'leitor-toast'; toast.className = 'leitor-toast'; document.body.appendChild(toast); }
    toast.textContent = msg; toast.classList.remove('leitor-toast--out'); toast.classList.add('leitor-toast--in');
    clearTimeout(toast._timer); toast._timer = setTimeout(() => { toast.classList.remove('leitor-toast--in'); toast.classList.add('leitor-toast--out'); }, 1400);
  };

  const patchHistory = () => {
    if (!window.M12_History) { setTimeout(patchHistory, 50); return; }
    const origCommit = window.M12_History.commit.bind(window.M12_History), origSchedule = window.M12_History.schedule.bind(window.M12_History);
    window.M12_History.commit = function (...args) { if (this._leitorPaused) return; return origCommit(...args); };
    window.M12_History.schedule = function (...args) { if (this._leitorPaused) return; return origSchedule(...args); };
  };

  const resetArtifacts = () => {
    leitorFx?.forceOff(); editor.setAttribute('contenteditable', 'true'); editor.classList.remove('is-read-only'); document.body.classList.remove('leitor-keep-toolbar');
    leitorBtn.classList.remove('is-active'); leitorBtn.setAttribute('aria-pressed', 'false'); setToolbarLocked(false);
    if (window.M12_History) window.M12_History._leitorPaused = false; window.M4_Caret?.updateFocus?.();
    editor.querySelectorAll('.bbl').forEach(s => s.replaceWith(document.createTextNode(s.textContent))); allEditables().forEach(el => el.normalize());
    processedNodes = new WeakSet(); multiRefAuraEnabled = false;
  };

  const forceEdit = () => { if (isReadOnly) disableReadOnly(); };
  window.LeitorMode = {ativar: () => { if (!isReadOnly) toggle(); }, desativar: disableReadOnly, isActive: () => isReadOnly};
  window.addEventListener('notes:restored', () => { if (isReadOnly) disableReadOnly(); });

  window.addEventListener('pagehide', forceEdit); window.addEventListener('beforeunload', forceEdit); window.addEventListener('pageshow', () => { if (!isReadOnly) resetArtifacts(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !isReadOnly) resetArtifacts(); });

  bindTapIntent(leitorBtn, e => { if (e) e.preventDefault(); toggle(); }, { delay: 300, slop: 10, preventFocus: true });
  patchHistory(); leitorBtn.setAttribute('aria-pressed', 'false');
});
