// Save status belongs to the editor; errors must remain visible without changing
// the note or interrupting the keyboard/caret with a dialog.
(() => {
  let host, message, actions, comparison, hideTimer, showTimer, currentType;
  const css = document.createElement('style');
  css.textContent = `
    #notes-save-status[hidden]{display:none!important}
    #notes-save-status{position:fixed;z-index:12080;left:12px;right:12px;top:calc(var(--app-statusbar-height,env(safe-area-inset-top,0px)) + 8px);max-width:480px;margin:auto;padding:9px 12px;border:1px solid #d7d1de;border-radius:10px;background:#fff;color:#39333e;box-shadow:0 3px 16px #00000014;font:12px/1.45 system-ui,-apple-system,sans-serif;max-height:calc(100dvh - 100px);overflow:auto;overscroll-behavior:contain}
    #notes-save-status[data-type="local"],#notes-save-status[data-type="success"],#notes-save-status[data-type="saving"]{left:auto;max-width:240px;padding:5px 9px;pointer-events:none;box-shadow:none;opacity:.92}
    #notes-save-status[data-type="error"],#notes-save-status[data-type="conflict"]{border-color:#b39a76}
    #notes-save-status p{margin:0;font:inherit}
    #notes-save-status .notes-save-actions{display:flex;flex-wrap:wrap;gap:4px 8px;margin-top:6px}
    #notes-save-status button{border:0;border-radius:5px;background:#f2eef6;color:#604184;font:600 12px/1.35 system-ui;padding:8px;min-height:34px;cursor:pointer}
    #notes-save-status details{margin-top:7px}
    #notes-save-status summary{cursor:pointer;padding:5px 0;color:#604184}
    #notes-save-status .notes-compare-copy{padding:8px;margin:6px 0;border:1px solid #e2dce8;border-radius:5px}
    #notes-save-status pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:6px 0 0;max-height:130px;overflow:auto;font:12px/1.5 system-ui}
    html[data-theme="dark"] #notes-save-status{background:#252229;color:#eee;border-color:#65596e}
    html[data-theme="dark"] #notes-save-status button{background:#3b3345;color:#e2d3f1}
  `;
  document.head.append(css);
  function ensure() {
    if (host) return;
    host = document.createElement('aside'); host.id = 'notes-save-status'; host.hidden = true;
    host.setAttribute('role', 'status'); host.setAttribute('aria-live', 'polite');
    message = document.createElement('p'); actions = document.createElement('div'); actions.className = 'notes-save-actions';
    comparison = document.createElement('div'); host.append(message, comparison, actions); document.body.append(host);
  }
  function button(label, run) {
    const node = document.createElement('button'); node.type = 'button'; node.textContent = label;
    node.onclick = run; return node;
  }
  function hide() { clearTimeout(hideTimer); clearTimeout(showTimer); if (host) host.hidden = true; currentType = null; }
  function textOf(payload) {
    const node = document.createElement('template'); node.innerHTML = payload?.html || '';
    return node.content.textContent || '(Nota vazia)';
  }
  function showConflict() {
    const conflict = window.cacheRichText?.getConflict(); if (!conflict) return;
    ensure(); clearTimeout(hideTimer); clearTimeout(showTimer);
    currentType = 'conflict'; host.dataset.type = 'conflict'; host.hidden = false;
    message.textContent = conflict.saved
      ? 'Esta nota também foi editada em outra aba. As duas versões foram preservadas. Escolha qual continuar usando.'
      : 'Esta nota também mudou em outra aba. Não há espaço para guardar as duas versões; baixe uma cópia antes de escolher.';
    const wasOpen = comparison.querySelector('details')?.open;
    comparison.replaceChildren(); actions.replaceChildren();
    const details = document.createElement('details'); details.open = !!wasOpen;
    const summary = document.createElement('summary'); summary.textContent = 'Comparar versões'; details.append(summary);
    for (const [title, value] of [['Nesta aba', conflict.local], ['Na outra aba', conflict.external]]) {
      const box = document.createElement('div'); box.className = 'notes-compare-copy';
      const heading = document.createElement('strong'); heading.textContent = title;
      const preview = document.createElement('pre'); preview.textContent = textOf(value); box.append(heading, preview); details.append(box);
    }
    comparison.append(details);
    const choose = value => { if (window.cacheRichText.resolveConflict(value)) hide(); else showConflict(); };
    actions.append(button('Usar desta aba', () => choose('local')), button('Usar da outra aba', () => choose('external')),
      button('Baixar as duas', () => { window.cacheRichText.downloadRecovery(); showConflict(); }));
  }
  function show(detail = {}) {
    if (window.cacheRichText?.getConflict()) { showConflict(); return; }
    const type = detail.type || 'local';
    if (currentType === 'error' && type !== 'error' && window.cacheRichText?.stats().saveError) return;
    ensure(); clearTimeout(hideTimer); clearTimeout(showTimer);
    const render = () => {
      currentType = type; host.dataset.type = type; host.hidden = false;
      message.textContent = String(detail.message || ''); actions.replaceChildren(); comparison.replaceChildren();
      if (type === 'error') {
        actions.append(button('Tentar novamente', async () => {
          const saved = window.cacheRichText?.flush();
          if (!saved || window.cacheRichText?.getConflict()) return;
          await window.UnifiedLoadManager?.syncWithSupabase();
          await window.AutoSaveManager?.forceAutoSave();
        }), button('Baixar cópia', () => window.cacheRichText?.downloadRecovery()), button('Fechar aviso', hide));
      } else hideTimer = setTimeout(hide, Number(detail.duration) || 1600);
    };
    // Routine confirmations appear after typing pauses; only problems appear at once.
    if (type === 'error') render(); else showTimer = setTimeout(render, 700);
  }
  window.addEventListener('editor:save-status', event => show(event.detail));
  window.addEventListener('notes:conflict', showConflict);
  window.addEventListener('notes:conflict-resolved', hide);
})();
