/* Highlight the scheduled block without guessing a date or subtopic duration. */
document.addEventListener('DOMContentLoaded', () => {
  function minutes(paragraph) {
    const value = paragraph.querySelector('.hora')?.textContent.trim().match(/^(\d{1,2}):(\d{2})$/);
    return value ? Number(value[1]) * 60 + Number(value[2]) : null;
  }

  function refresh() {
    const container = document.getElementById('programacao-container');
    if (!container) return;
    container.querySelectorAll('p.hora-ativo').forEach(paragraph => {
      paragraph.classList.remove('hora-ativo');
      const wrapper = paragraph.querySelector(':scope > .hora-ativo-texto');
      if (wrapper) wrapper.replaceWith(...wrapper.childNodes);
    });
    const now = new Date();
    const current = now.getHours() * 60 + now.getMinutes();
    const entries = Array.from(container.querySelectorAll('[role="tabpanel"] p'))
      .map(paragraph => ({ paragraph, minute: minutes(paragraph) }))
      .filter(entry => entry.minute !== null);
    // Between sessions there is no current talk. The closing song remains a discrete item.
    const activePeriod = current >= 580 && current <= 725 ? 'manha'
      : current >= 800 && current <= 960 ? 'tarde' : null;
    if (!activePeriod) return;
    const candidates = entries.filter(entry => entry.paragraph.closest('[role="tabpanel"]').id === activePeriod && entry.minute <= current);
    const paragraph = candidates.at(-1)?.paragraph;
    if (!paragraph) return;
    paragraph.classList.add('hora-ativo');
    const wrapper = document.createElement('span');
    wrapper.className = 'hora-ativo-texto';
    wrapper.append(...paragraph.childNodes);
    paragraph.append(wrapper);
  }

  refresh();
  setInterval(refresh, 60000);
  window.addEventListener('programacao:daychange', refresh);
});
