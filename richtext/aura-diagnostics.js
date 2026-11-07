/* Opt-in measurements inside the installed app. Never reads note contents. */
(() => {
  'use strict';
  const root = document.documentElement;
  if (root.dataset.notesVersion !== '2' || window.NotesAuraDiagnostics?.enabled) return;
  if (!window.__NOTES_AURA_DIAGNOSTIC_REQUESTED__ && new URLSearchParams(location.search).get('diagnostico') !== 'aura' && new URLSearchParams(location.search).get('diagnostico') !== 'navbar') return;

  const VERSION = '2026.11.07.2', LIMIT = 120;
  const sourceURL = new URL(document.currentScript.src);
  const manualStart = !!window.__NOTES_AURA_DIAGNOSTIC_REQUESTED__ && !window.NotesNavbarDiagnostics?.enabled;
  const startedAt = new Date().toISOString(), started = performance.now();
  const listeners = [], timers = new Set(), samples = [], reasons = new Set();
  let enabled = true, baseline = null, dropped = 0, probe, observer, notice;
  let unitsProbe;
  let frame = 0, throttle = 0, settled = 0, lastCapture = -100;
  let cache = {status:'pending', shells:[], modules:[]};
  const number = value => Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
  const media = query => matchMedia(query).matches;
  const knownIds = new Set(['editor','editorScroll','kbdToolbar','modal-biblia-campo','picker-close','notes-versions-close','notes-start-aura-diagnostic','notes-copy-aura-diagnostic','notes-download-aura-diagnostic','notes-stop-aura-diagnostic']);
  const rect = element => {
    if (!element) return null;
    const box = element.getBoundingClientRect();
    return Object.fromEntries(['x','y','top','right','bottom','left','width','height'].map(key => [key, number(box[key])]));
  };
  function focus(element = document.activeElement) {
    if (!(element instanceof Element)) return null;
    return {tag:element.tagName.toLowerCase(), id:knownIds.has(element.id) ? element.id : null,
      inEditor:!!element.closest('#editor'), inBibleModal:!!element.closest('#modal-biblia'),
      inVersionMenu:!!element.closest('#notes-versions'), editable:!!element.isContentEditable};
  }
  function element(selector) {
    const node = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (!node) return null;
    const style = getComputedStyle(node);
    const keys = ['position','display','visibility','opacity','zIndex','transform','overflow','overflowY','height','paddingTop','paddingBottom','backgroundColor','filter','backdropFilter','webkitBackdropFilter','transitionProperty','transitionDuration','top','bottom','left','right','width','boxSizing','paddingLeft','paddingRight'];
    const result = {rect:rect(node), style:Object.fromEntries(keys.map(key => [key,style[key] || ''])),
      offsetHeight:node.offsetHeight, clientHeight:node.clientHeight, scrollHeight:node.scrollHeight, scrollTop:number(node.scrollTop)};
    if (node instanceof HTMLCanvasElement) result.bitmap = {width:node.width, height:node.height};
    return result;
  }
  function snapshot(reason, eventFocus) {
    const vv = window.visualViewport, safe = probe && getComputedStyle(probe);
    const navbar = document.querySelector('.bottom-navbar'), navBox = rect(navbar);
    const visualBottom = vv ? vv.offsetTop + vv.height : innerHeight;
    const rootStyle = getComputedStyle(root);
    const surfaceKeys = ['--notes-surface-width','--notes-surface-height','--notes-toolbar-height','--navbar-real-height','--navbar-safe-bottom'];
    return {
      atMs:number(performance.now() - started), reason,
      lifecycle:{visibility:document.visibilityState, persisted:reason.includes('persisted')},
      state:{reader:document.body.classList.contains('leitor-keep-toolbar'), aura:root.classList.contains('leitor-glow-active'),
        performance:root.classList.contains('perf-low') ? 'low' : 'normal',
        theme:root.dataset.theme === 'dark' ? 'dark' : 'light', nativeStatusbar:root.dataset.nativeStatusbar === 'solid',
        versionsMenuOpen:!!document.querySelector('#notes-versions:not([hidden])')},
      focus:focus(), ...(eventFocus ? {eventFocus} : {}),
      viewport:{innerWidth, innerHeight, clientWidth:root.clientWidth, clientHeight:root.clientHeight,
        scrollX:number(scrollX), scrollY:number(scrollY), visual:vv ? Object.fromEntries(['width','height','offsetTop','offsetLeft','pageTop','pageLeft','scale'].map(key => [key,number(vv[key])])) : null},
      safeAreas:safe ? {top:parseFloat(safe.paddingTop), right:parseFloat(safe.paddingRight), bottom:parseFloat(safe.paddingBottom), left:parseFloat(safe.paddingLeft)} : null,
      fixedEdges:rect(probe),
      units:unitsProbe ? Object.fromEntries([...unitsProbe.children].map(node => [node.dataset.unit,number(node.getBoundingClientRect().height)])) : null,
      surface:{enabled:!!window.NotesViewport?.enabled, css:Object.fromEntries(surfaceKeys.map(key => [key,rootStyle.getPropertyValue(key).trim()]))},
      navbarPosition:{mode:root.dataset.notesNavbarTest === 'native' ? 'native-bottom' : 'current',
        hiddenByApp:!!navbar?.classList.contains('hidden'),
        bottomMinusVisualBottom:navBox ? number(navBox.bottom - visualBottom) : null,
        bottomMinusInnerHeight:navBox ? number(navBox.bottom - innerHeight) : null,
        bottomMinusFixedBottom:navBox && probe ? number(navBox.bottom - probe.getBoundingClientRect().bottom) : null},
      elements:{root:element(root), body:element(document.body), app:element('.app'), scroller:element('#editorScroll'),
        aura:element('.leitor-fx'), fog:element('.leitor-fx__fog canvas'), glow:element('.leitor-fx__smoke canvas'),
        navbar:element('.bottom-navbar'), toolbar:element('#kbdToolbar'), statusbar:element('#app-solid-statusbar'), mask:element('.statusbar-mask')}
    };
  }
  function capture(reason, eventFocus) {
    if (!enabled || !document.body || !probe) return;
    // Focus/viewport events may arrive before the first animation frame on iOS.
    // Keep the initial geometry independent of those event timings.
    if (!baseline && reason !== 'baseline-before-menu') return;
    const sample = snapshot(reason, eventFocus);
    if (!baseline) baseline = sample;
    samples.push(sample);
    if (samples.length > LIMIT) { samples.shift(); dropped++; }
    lastCapture = performance.now();
  }
  function later(callback, delay) {
    const handle = setTimeout(() => { timers.delete(handle); if (enabled) callback(); }, delay);
    timers.add(handle); return handle;
  }
  function queue(reason) {
    if (!enabled) return;
    reasons.add(reason);
    if (throttle || frame) return;
    throttle = later(() => {
      throttle = 0;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const label = [...reasons].join(','); reasons.clear(); capture(label);
      });
    }, Math.max(0, 100 - (performance.now() - lastCapture)));
  }
  function recheck(reason) {
    queue(reason);
    clearTimeout(settled); timers.delete(settled);
    settled = later(() => { settled = 0; capture(reason + ':settled-500ms'); }, 500);
  }
  function listen(target, name, handler, options = {passive:true}) {
    target?.addEventListener(name, handler, options); listeners.push([target,name,handler,options]);
  }
  async function readExistingCache() {
    try {
      if (!window.caches) { cache = {status:'unavailable'}; return; }
      const names = await caches.keys();
      const modules = [];
      for (const path of ['viewport.js','viewport.css','aura-diagnostics.js','navbar-diagnostics.js','../navbar/navbar-unified.js','../navbar/navbar-unified.css','plugin/leitor.js','editor.js']) {
        const response = await caches.match(new URL(path, sourceURL).href);
        const version = response?.headers.get('x-sentinela-app-version');
        modules.push({path, present:!!response, receiptHash:response?.headers.get('x-sentinela-sha256') || null, version:version && /^\d{4}\.\d{2}\.\d{2}\.\d+$/.test(version) ? version : null});
      }
      cache = {status:'read-existing', shells:names.filter(name => /^ass26-shell-v\d+$/.test(name)), modules};
    } catch (_) { cache = {status:'unavailable'}; }
  }
  function report() {
    capture('export');
    const value = {
      type:'sentinela-notes-aura-diagnostic', schemaVersion:1, diagnosticVersion:VERSION,
      startedAt, exportedAt:new Date().toISOString(), notesVersion:2,
      device:{userAgent:navigator.userAgent, platform:navigator.platform, devicePixelRatio,
        screen:{width:screen.width,height:screen.height}, navigatorStandalone:navigator.standalone === true,
        displayModes:{standalone:media('(display-mode: standalone)'), fullscreen:media('(display-mode: fullscreen)'), browser:media('(display-mode: browser)')},
        reducedMotion:media('(prefers-reduced-motion: reduce)')},
      serviceWorker:{controlled:!!navigator.serviceWorker?.controller, state:navigator.serviceWorker?.controller?.state || null},
      statusbarModule:{present:!!window.AppStatusBar, revision:/^\d{4}\.\d{2}\.\d{2}\.\d+$/.test(window.AppStatusBar?.revision || '') ? window.AppStatusBar.revision : null},
      cache, baseline, samples, droppedSamples:dropped, sampleLimit:LIMIT,
      limitations:['native-statusbar-and-home-indicator-not-observable-from-dom','keyboard-visibility-not-inferred-from-height-alone','visual-result-needs-observation-in-installed-pwa'],
      privacy:'No note text, HTML, field values, account data or page query parameters are collected.'
    };
    return JSON.parse(JSON.stringify(value));
  }
  function download() {
    const href = URL.createObjectURL(new Blob([JSON.stringify(report(), null, 2)], {type:'application/json;charset=utf-8'}));
    const link = document.createElement('a'); link.href = href; link.download = 'diagnostico-aura-pwa.json';
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(href), 30000);
  }
  function copy() {
    if (!navigator.clipboard?.writeText) return Promise.resolve(false);
    // Clipboard access begins in the tap, before any async measurements.
    try { return navigator.clipboard.writeText(JSON.stringify(report())).then(() => true, () => false); }
    catch (_) { return Promise.resolve(false); }
  }
  function stop() {
    enabled = false; timers.forEach(clearTimeout); timers.clear(); cancelAnimationFrame(frame);
    listeners.forEach(([target,name,handler,options]) => target?.removeEventListener(name,handler,options));
    observer?.disconnect(); probe?.remove(); unitsProbe?.remove(); notice?.remove();
    delete window.__NOTES_AURA_DIAGNOSTIC_REQUESTED__;
    document.getElementById('notes-aura-diagnostic-script')?.remove();
  }
  function begin() {
    if (!enabled || probe) return;
    probe = document.createElement('div'); probe.id = 'notes-aura-diagnostic-probe'; probe.setAttribute('aria-hidden','true');
    probe.style.cssText = 'position:fixed;inset:0;box-sizing:border-box;visibility:hidden;pointer-events:none;overflow:hidden;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
    document.body.append(probe);
    unitsProbe = document.createElement('div');
    unitsProbe.id = 'notes-diagnostic-units';
    unitsProbe.style.cssText = 'position:fixed;top:0;left:-10000px;width:1px;height:0;visibility:hidden;pointer-events:none';
    for (const unit of ['vh','svh','lvh','dvh']) {
      const node = document.createElement('div'); node.dataset.unit = unit;
      node.style.cssText = `position:absolute;top:0;width:1px;height:100${unit}`;
      unitsProbe.append(node);
    }
    document.body.append(unitsProbe);
    // A manual start closes the version menu before the first measurement.
    frame = requestAnimationFrame(() => {
      frame = 0; capture('baseline-before-menu');
      if (manualStart) {
        notice = document.createElement('div'); notice.setAttribute('role','status');
        notice.textContent = 'Verificação iniciada. Use o teclado e volte a Anotações para copiar o diagnóstico.';
        notice.style.cssText = 'position:fixed;top:calc(env(safe-area-inset-top,0px) + 60px);left:50%;transform:translateX(-50%);max-width:300px;width:calc(100% - 64px);padding:10px 14px;border-radius:12px;background:#29252eee;color:#fff;font:13px/1.4 -apple-system,BlinkMacSystemFont,sans-serif;text-align:center;pointer-events:none;z-index:13010';
        document.body.append(notice); later(() => { notice?.remove(); notice = null; }, 4500);
      }
      window.dispatchEvent(new Event('notes:aura-diagnostics-ready'));
    });
    listen(window,'resize',() => queue('window-resize'));
    listen(window,'orientationchange',() => recheck('orientationchange'));
    listen(window.visualViewport,'resize',() => queue('visual-resize'));
    listen(window.visualViewport,'scroll',() => queue('visual-scroll'));
    listen(document,'focusin',event => { capture('focusin',focus(event.target)); queue('focusin-next-frame'); });
    listen(document,'focusout',event => { capture('focusout',focus(event.target)); recheck('focusout-next-frame'); });
    listen(window,'pageshow',event => recheck(event.persisted ? 'pageshow-persisted' : 'pageshow'));
    listen(window,'pagehide',event => capture(event.persisted ? 'pagehide-persisted' : 'pagehide'));
    listen(document,'visibilitychange',() => { capture('visibilitychange'); if (!document.hidden) recheck('visible-resume'); });
    listen(document,'notes:surface-resize',() => queue('notes-surface-resize'));
    listen(document,'editor:viewport-layout',() => queue('editor-layout'));
    observer = new MutationObserver(() => queue('layout-state'));
    const config = {attributes:true, attributeFilter:['class','style','data-theme','data-performance-mode','data-native-statusbar']};
    observer.observe(root,config); observer.observe(document.body,config);
    readExistingCache();
  }
  window.NotesAuraDiagnostics = {get enabled() { return enabled; }, report, copy, download, stop};
  if (document.body) begin(); else listen(document,'DOMContentLoaded',begin,{once:true});
})();
