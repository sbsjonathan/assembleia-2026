/* The complete assembly stays mounted. Tabs only change visibility, never note IDs. */
(function () {
  'use strict';
  const PROGRAM_ID = 'ca-copgm27';
  const TABS = ['manha', 'tarde', 'perguntas'];
  let currentTab = 'manha';
  let initialized = false;

  function tabFromHash() {
    const value = location.hash.slice(1);
    return TABS.includes(value) ? value : 'manha';
  }

  function selectTab(name, options = {}) {
    if (!TABS.includes(name)) return false;
    if (window.AssembleiaIA?.flushPendingWrites?.() === false) return false;
    const focused = document.activeElement;
    if (focused?.closest('[role="tabpanel"]') && focused.closest('[role="tabpanel"]').id !== name) focused.blur();
    currentTab = name;
    document.querySelectorAll('.session-nav [role="tab"]').forEach(button => {
      const selected = button.dataset.session === name;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
      document.getElementById(button.dataset.session).hidden = !selected;
    });
    const info = document.querySelector('.assembly-info');
    if (info) info.hidden = name === 'perguntas';
    if (options.updateHash !== false) history.replaceState(null, '', `#${name}`);
    // Keep the tabs visible when changing from the bottom of a long panel.
    const nav = document.querySelector('.session-nav');
    if (options.scroll !== false && nav && nav.getBoundingClientRect().top <= 1) {
      const boundary = document.getElementById('menu-container').getBoundingClientRect().bottom + scrollY;
      window.scrollTo({ top: boundary, behavior: 'instant' });
    }
    window.dispatchEvent(new CustomEvent('programacao:daychange', { detail: { dia: 'unico', tab: name, isUserNavigation: false } }));
    return true;
  }

  function restoreExtras() {
    ['manha', 'tarde'].forEach(period => {
      const key = `${PROGRAM_ID}:assistencia:${period}`;
      const input = document.getElementById(key);
      if (!input) return;
      try { input.value = localStorage.getItem(key) || ''; } catch {}
      input.addEventListener('input', () => {
        try {
          localStorage.setItem(key, input.value);
          window.dispatchEvent(new CustomEvent('assembleia:recordchange', { detail: { id: key } }));
        } catch {}
      });
    });
    const key = `${PROGRAM_ID}:pontos-altos`;
    const result = document.getElementById(key);
    try { const saved = localStorage.getItem(key); if (saved && result) result.innerHTML = saved; } catch {}
    document.querySelector('.btn-gerar-pontos-altos')?.addEventListener('click', event => {
      window.AssembleiaIA?.gerarPontosAltosDia?.('unico', event.currentTarget.closest('.pontos-altos-wrapper'), key);
    });
    // Background sync updates extras too, while leaving a focused draft alone.
    function refreshExtras() {
      ['manha', 'tarde'].forEach(period => {
        const input = document.getElementById(`${PROGRAM_ID}:assistencia:${period}`);
        if (!input || input === document.activeElement) return;
        try { input.value = localStorage.getItem(input.id) || ''; } catch {}
      });
      if (!result || result.closest('.ia-loading')) return;
      try {
        const saved = localStorage.getItem(key);
        if (saved) result.innerHTML = saved;
        else result.textContent = 'Suas anotações podem virar um resumo dos pontos altos.';
      } catch {}
    }
    window.addEventListener('assembleia:cloudapplied', refreshExtras);
    window.addEventListener('storage', refreshExtras);
    window.addEventListener('pageshow', refreshExtras);
  }

  function init() {
    if (initialized) return;
    initialized = true;
    const tabs = Array.from(document.querySelectorAll('.session-nav [role="tab"]'));
    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => selectTab(tab.dataset.session));
      tab.addEventListener('keydown', event => {
        let next;
        if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
        if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
        if (event.key === 'Home') next = 0;
        if (event.key === 'End') next = tabs.length - 1;
        if (next === undefined) return;
        event.preventDefault();
        if (selectTab(tabs[next].dataset.session)) tabs[next].focus();
      });
    });
    window.ProgramacaoBbl?.normalizeBbl(document.getElementById('programacao-container'));
    window.AssembleiaClickables?.init(document.getElementById('programacao-container'));
    restoreExtras();
    selectTab(tabFromHash(), { updateHash: false, scroll: false });
    window.addEventListener('hashchange', () => selectTab(tabFromHash(), { updateHash: false }));
  }

  window.AssemblyProgram = Object.freeze({ id: PROGRAM_ID, selectTab, activeTab: () => currentTab });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
