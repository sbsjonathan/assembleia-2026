
(function () {
  function normalizeBbl(root) {
    const scope = root || document;
    if (!window.setupBblLinkListeners) return;
    scope.querySelectorAll('.bbl').forEach((el) => {
      if (el.dataset.bblBound === 'true') return;
      el.dataset.bblBound = 'true';
      window.setupBblLinkListeners(el);
    });
  }

  window.ProgramacaoBbl = { normalizeBbl };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => normalizeBbl(document), { once: true });
  } else {
    normalizeBbl(document);
  }
})();
