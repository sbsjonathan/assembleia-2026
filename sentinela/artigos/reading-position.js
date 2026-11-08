/* Keep each downloaded study at its own reading position, including iOS PWA resumes. */
(() => {
  'use strict';
  const script = document.currentScript;
  const date = script?.dataset.studyDate || new URLSearchParams(location.search).get('d');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return;
  const key = 'sentinela:reading-position:v1:' + date;
  const kinds = ['.paragrafo', '.pergunta', 'h1,h2,h3', 'figure'];
  const selector = '.paragrafo,.pergunta,h1,h2,h3,figure';
  let saved;
  try {
    saved = JSON.parse(localStorage.getItem(key));
    if (saved?.version !== 1 || saved.date !== date || !Number.isFinite(saved.y) || saved.y < 0) saved = null;
  } catch (_) { saved = null; }
  let restoring = !!saved && !location.hash, frame = 0, saveTimer = 0, deadlineTimer = 0;
  let observer, resizeObserver, observedMain, started = false;
  const originalRestoration = history.scrollRestoration;
  if (restoring) history.scrollRestoration = 'manual';

  function main() { return document.querySelector('.container > main, main'); }
  function visible(element) { return !!element?.getClientRects().length && element.getBoundingClientRect().height > 0; }
  function editing() {
    const active = document.activeElement;
    return !!active && (active.matches('input,textarea,select') || active.isContentEditable);
  }
  function blocked() {
    if (!document.body || editing()) return true;
    if (document.documentElement.hasAttribute('data-article-tutor-fullscreen')) return true;
    const body = getComputedStyle(document.body), view = window.visualViewport;
    if (body.position === 'fixed' || body.overflowY === 'hidden' || body.overflowY === 'clip') return true;
    if (view && (view.scale > 1.01 || view.height < innerHeight - 120)) return true;
    if (document.querySelector('dialog[open], .sync-sheet-overlay.is-open, .sync-alert-overlay.is-open, #zoom-container.active')) return true;
    return visible(document.getElementById('modal-biblia'));
  }
  function readingTop() {
    let top = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-top')) || 0;
    const header = document.querySelector('.barra-estudo');
    if (header) {
      const rect = header.getBoundingClientRect(), position = getComputedStyle(header).position;
      if ((position === 'fixed' || position === 'sticky') && rect.top <= top + 1 && rect.bottom > top) top = rect.bottom;
    }
    return top;
  }
  function anchorFor(root) {
    const edge = readingTop(), nodes = [...root.querySelectorAll(selector)].filter(visible);
    let node = nodes.find(element => element.getBoundingClientRect().bottom > edge);
    if (!node) node = nodes.at(-1);
    if (!node) return null;
    const kind = kinds.find(value => node.matches(value)), rect = node.getBoundingClientRect();
    return {id: node.id || '', kind, index: [...root.querySelectorAll(kind)].indexOf(node), offset: rect.top - edge, height: rect.height};
  }
  function save() {
    clearTimeout(saveTimer); saveTimer = 0;
    // Do not replace an old position with zero while its page is still being restored,
    // or with the temporary scroll used by an editor keyboard or image modal.
    const root = main();
    if (!root || restoring || blocked()) return;
    const y = Math.max(0, window.scrollY);
    const value = {version: 1, date, y, anchor: y > 1 ? anchorFor(root) : null, width: innerWidth, savedAt: Date.now()};
    try { localStorage.setItem(key, JSON.stringify(value)); saved = value; } catch (_) {}
  }
  function scheduleSave() {
    if (!saveTimer && !restoring) saveTimer = setTimeout(save, 180);
  }
  function stopRestoring() {
    if (!restoring) return;
    restoring = false;
    clearTimeout(deadlineTimer);
    observer?.disconnect(); resizeObserver?.disconnect();
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  }
  function restore() {
    frame = 0;
    if (!restoring || location.hash || blocked()) return;
    const root = main();
    if (!root) return;
    if (!started) {
      started = true;
      deadlineTimer = setTimeout(() => { stopRestoring(); save(); }, 8000);
    }
    if (resizeObserver && observedMain !== root) { observedMain = root; resizeObserver.observe(root); }
    let target = saved.y;
    const anchor = saved.anchor;
    if (anchor && kinds.includes(anchor.kind) && Number.isInteger(anchor.index) && Number.isFinite(anchor.offset)) {
      let element = anchor.id ? document.getElementById(anchor.id) : null;
      if (!element || !root.contains(element)) element = root.querySelectorAll(anchor.kind)[anchor.index];
      // The parser may not have reached the saved paragraph yet. Avoid a partial
      // restoration near the top while the rest of the local article is parsed.
      if (!element && document.readyState === 'loading') return;
      if (element && visible(element)) {
        const rect = element.getBoundingClientRect();
        let offset = anchor.offset;
        if (offset < 0 && anchor.height > 0 && Math.abs(innerWidth - saved.width) > 1) offset *= rect.height / anchor.height;
        target = window.scrollY + rect.top - readingTop() - offset;
      }
    }
    const max = Math.max(0, document.documentElement.scrollHeight - innerHeight);
    target = Math.min(max, Math.max(0, target));
    if (Math.abs(window.scrollY - target) <= 1) return;
    const style = document.documentElement.style, previous = style.scrollBehavior;
    style.scrollBehavior = 'auto';
    window.scrollTo(0, target);
    style.scrollBehavior = previous;
    // A sticky header can enter its pinned state during this scroll. Measure it
    // once more on the next frame instead of relying on an unrelated image load.
    queueRestore();
  }
  function queueRestore() { if (restoring && !frame) frame = requestAnimationFrame(restore); }
  function userTakesOver() { stopRestoring(); }
  function beforeTouch() { stopRestoring(); save(); }
  function selectionStarted() {
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) userTakesOver();
  }

  if (restoring) {
    observer = new MutationObserver(queueRestore);
    observer.observe(document.documentElement, {childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'src']});
    if ('ResizeObserver' in window) resizeObserver = new ResizeObserver(queueRestore);
    // This starts before any optional remote script finishes loading.
    restore(); queueRestore();
  }
  document.addEventListener('DOMContentLoaded', () => { restore(); queueRestore(); }, {once: true});
  document.addEventListener('cacheRestored', queueRestore);
  document.addEventListener('load', queueRestore, true);
  document.fonts?.ready.then(queueRestore);
  window.addEventListener('resize', queueRestore, {passive: true});
  window.visualViewport?.addEventListener('resize', queueRestore, {passive: true});
  window.addEventListener('scroll', scheduleSave, {passive: true});
  // Merely touching the document is enough: a pending layout correction must not
  // fight a finger, a native selection handle, a form focus, or an explicit link.
  document.addEventListener('pointerdown', beforeTouch, {capture: true, passive: true});
  document.addEventListener('touchstart', beforeTouch, {capture: true, passive: true});
  document.addEventListener('wheel', userTakesOver, {capture: true, passive: true});
  document.addEventListener('keydown', event => {
    if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' ', 'Tab'].includes(event.key)) userTakesOver();
  }, true);
  document.addEventListener('focusin', () => { if (editing()) userTakesOver(); });
  document.addEventListener('selectionchange', selectionStarted);
  document.addEventListener('focusout', () => setTimeout(scheduleSave, 300));
  window.addEventListener('hashchange', userTakesOver);
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
  window.addEventListener('pagehide', () => { save(); stopRestoring(); history.scrollRestoration = originalRestoration; });
  window.addEventListener('pageshow', event => { if (event.persisted) stopRestoring(); });
  window.SentinelaReadingPosition = {save, key};
})();
