/* Use the current PWA viewport, independently of a stale post-keyboard fixed box. */
(() => {
  'use strict';
  const root = document.documentElement;
  const standalone = matchMedia('(display-mode: standalone)');
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let enabled = false, probe = null, size = null, frame = 0, changedFrame = 0;
  let toolbarObserver = null, toolbarHeight = 0;
  let checks = [];

  function notify() {
    if (changedFrame) return;
    changedFrame = requestAnimationFrame(() => {
      changedFrame = 0;
      document.dispatchEvent(new Event('notes:surface-resize'));
    });
  }
  function measure() {
    if (!enabled) return {width:innerWidth, height:innerHeight};
    // The shared dock metric can be sampled during scale(.95) animation.
    // Layout height, unlike getBoundingClientRect(), excludes that transform.
    const layoutHeight = document.getElementById('kbdToolbar')?.offsetHeight || 0;
    if (layoutHeight > 0 && layoutHeight !== toolbarHeight) {
      toolbarHeight = layoutHeight;
      root.style.setProperty('--notes-toolbar-height', layoutHeight + 'px');
      notify();
    }
    const units = probe?.getBoundingClientRect();
    const width = Math.round(Math.max(innerWidth, units?.width || 0));
    // Pinch zoom changes the visual viewport, not the document surface. Do not
    // chase its dimensions or offset. An orientation/width change still needs
    // a fresh surface, even if the user remains zoomed in.
    if (window.visualViewport && Math.abs(visualViewport.scale - 1) > 0.01 && size && width === size.width) return {...size};
    // iOS can reserve the status bar outside the web view: 100lvh/100vh
    // still report the physical 932px while innerHeight/100dvh report 873px.
    // The dynamic unit also retains the layout height while the keyboard
    // occludes visualViewport, without relying on a stale fixed inset box.
    const height = Math.round(Math.max(innerHeight, units?.height || 0));
    if (width > 0 && height > 0 && (!size || width !== size.width || height !== size.height)) {
      size = {width, height};
      root.style.setProperty('--notes-surface-width', width + 'px');
      root.style.setProperty('--notes-surface-height', height + 'px');
      notify();
    }
    return size ? {...size} : {width:innerWidth, height:innerHeight};
  }
  function schedule() {
    if (!enabled || frame) return;
    frame = requestAnimationFrame(() => { frame = 0; measure(); });
  }
  function clearChecks() {
    checks.forEach(clearTimeout); checks = [];
    cancelAnimationFrame(frame); frame = 0;
  }
  function settle() {
    clearChecks(); schedule();
    // Recompute from current values, never a historical maximum: a landscape
    // viewport must not retain the old portrait height.
    if (enabled) checks = [150, 500].map(delay => setTimeout(schedule, delay));
  }
  function refresh() {
    const next = root.dataset.notesVersion === '2' && ios &&
      (navigator.standalone === true || standalone.matches);
    if (next !== enabled) {
      enabled = next;
      if (enabled) {
        probe = document.createElement('div');
        probe.id = 'notes-surface-units'; probe.setAttribute('aria-hidden', 'true');
        // Dynamic viewport units follow the space allocated to the web app.
        // Keep the probe independent of inset:0, which can remain too short
        // after keyboard dismissal on other iOS installations.
        probe.style.cssText = 'position:fixed;left:-10000px;top:0;width:100vw;height:0;width:100lvw;height:100dvh;visibility:hidden;pointer-events:none;contain:strict';
        document.body.append(probe);
        root.dataset.notesSurface = 'pwa';
        const toolbar = document.getElementById('kbdToolbar');
        if (toolbar && typeof ResizeObserver === 'function') {
          toolbarObserver = new ResizeObserver(schedule);
          toolbarObserver.observe(toolbar);
        }
      } else {
        clearChecks(); probe?.remove(); probe = null; size = null;
        toolbarObserver?.disconnect(); toolbarObserver = null; toolbarHeight = 0;
        delete root.dataset.notesSurface;
        root.style.removeProperty('--notes-surface-width');
        root.style.removeProperty('--notes-surface-height');
        root.style.removeProperty('--notes-toolbar-height');
        notify();
      }
    }
    if (enabled) { measure(); settle(); }
  }
  window.NotesViewport = {get enabled() { return enabled; }, measure};
  window.addEventListener('resize', schedule, {passive:true});
  window.addEventListener('orientationchange', settle, {passive:true});
  window.visualViewport?.addEventListener('resize', schedule, {passive:true});
  window.visualViewport?.addEventListener('scroll', schedule, {passive:true});
  window.addEventListener('pageshow', refresh);
  window.addEventListener('pagehide', clearChecks);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) settle(); else clearChecks(); });
  standalone.addEventListener('change', refresh);
  if (document.body) refresh(); else document.addEventListener('DOMContentLoaded', refresh, {once:true});
})();
