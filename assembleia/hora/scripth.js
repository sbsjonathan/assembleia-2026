/* The marker and opening tab use the same scheduled block. No date or subtopic duration is guessed. */
(function () {
  'use strict';
  function minutes(paragraph) {
    const value = paragraph.querySelector('.hora')?.textContent.trim().match(/^(\d{1,2}):(\d{2})$/);
    return value ? Number(value[1]) * 60 + Number(value[2]) : null;
  }

  function current(now = new Date()) {
    const minute = now.getHours() * 60 + now.getMinutes();
    const panels = document.querySelectorAll('#programacao-container [role="tabpanel"]');
    for (const panel of panels) {
      // Only programme rows can define a block, never a time pasted into a note.
      const entries = Array.from(panel.querySelectorAll(':scope > p'))
        .map(paragraph => ({ paragraph, minute: minutes(paragraph), tab: panel.id }))
        .filter(entry => entry.minute !== null);
      if (!entries.length || minute < entries[0].minute || minute > entries.at(-1).minute) continue;
      return entries.filter(entry => entry.minute <= minute).at(-1) || null;
    }
    // Between sessions and after the closing song there is no active block.
    return null;
  }

  function refresh() {
    const container = document.getElementById('programacao-container');
    if (!container) return;
    container.querySelectorAll('p.hora-ativo').forEach(paragraph => {
      paragraph.classList.remove('hora-ativo');
      const wrapper = paragraph.querySelector(':scope > .hora-ativo-texto');
      if (wrapper) wrapper.replaceWith(...wrapper.childNodes);
    });
    const paragraph = current()?.paragraph;
    if (!paragraph) return;
    paragraph.classList.add('hora-ativo');
    const wrapper = document.createElement('span');
    wrapper.className = 'hora-ativo-texto';
    wrapper.append(...paragraph.childNodes);
    paragraph.append(wrapper);
  }

  // Available before DOMContentLoaded so the tab controller has no listener-order dependency.
  window.AssemblySchedule = Object.freeze({ current, refresh });
  function init() {
    refresh();
    setInterval(refresh, 60000);
    window.addEventListener('programacao:daychange', refresh);
    window.addEventListener('pageshow', refresh);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') refresh();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
