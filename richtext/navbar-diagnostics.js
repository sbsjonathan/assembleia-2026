/* Opt-in, reversible navbar comparison inside the same installed document. */
(() => {
  'use strict';
  const root = document.documentElement;
  if (root.dataset.notesVersion !== '2' || window.NotesNavbarDiagnostics?.enabled) return;
  const source = new URL(document.currentScript.src);
  const previousMode = root.getAttribute('data-notes-navbar-test');
  const ownsCollector = !window.NotesAuraDiagnostics?.enabled;
  const observations = [], timers = new Set();
  let enabled = true, panel, style, baseline, initial, current, message;
  function later(callback, delay) {
    const timer = setTimeout(() => { timers.delete(timer); if (enabled) callback(); }, delay);
    timers.add(timer);
  }
  function data() { return window.NotesAuraDiagnostics.report(); }
  function record(action, observation = null) {
    const sample = data().samples.at(-1);
    observations.push({action, observation, at:new Date().toISOString(), sample});
    if (observations.length > 24) observations.shift();
  }
  function report() {
    return {type:'sentinela-notes-navbar-diagnostic', schemaVersion:1, diagnosticVersion:'2026.11.07.2',
      baselineBeforePanel:baseline, initialGeometry:initial, observations:[...observations], measurements:data()};
  }
  function restore() {
    if (previousMode === null) root.removeAttribute('data-notes-navbar-test');
    else root.setAttribute('data-notes-navbar-test', previousMode);
  }
  function resume() { if (enabled && panel) compare(false); }
  function stop() {
    enabled = false; timers.forEach(clearTimeout); timers.clear();
    restore(); style?.remove(); panel?.remove();
    if (ownsCollector) window.NotesAuraDiagnostics?.stop();
    window.removeEventListener('pagehide', restore);
    window.removeEventListener('pageshow', resume);
    document.getElementById('notes-navbar-diagnostic-script')?.remove();
  }
  function compare(native) {
    if (native) root.dataset.notesNavbarTest = 'native'; else restore();
    for (const button of panel.querySelectorAll('[data-position]')) {
      button.setAttribute('aria-pressed', String((button.dataset.position === 'native') === native));
    }
    current.textContent = native ? 'Comparação: borda inferior' : 'Posição atual';
    message.textContent = 'Observe se os ícones e os nomes aparecem inteiros. Depois registre o resultado.';
    later(() => record(native ? 'native-bottom-settled' : 'current-settled'), 500);
  }
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(report(),null,2)],{type:'application/json'}));
    const link = document.createElement('a'); link.href = url; link.download = 'diagnostico-navbar-anotacoes.json';
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url),30000);
  }
  function build() {
    if (!enabled) return;
    const before = data(); baseline = before.samples.at(-1); initial = before.baseline;
    style = document.createElement('style');
    style.textContent = `
      html[data-notes-version="2"][data-notes-navbar-test="native"] body .bottom-navbar {top:auto!important;bottom:0!important}
      #notes-navbar-diagnostic {position:fixed;top:max(12px,env(safe-area-inset-top));left:12px;right:12px;z-index:14000;max-width:430px;margin:auto;padding:12px;box-sizing:border-box;border:1px solid #bdb7c5;border-radius:14px;background:#fff;color:#29252e;box-shadow:0 4px 18px #0002;font:14px/1.4 -apple-system,BlinkMacSystemFont,sans-serif;max-height:60dvh;overflow:auto}
      #notes-navbar-diagnostic header {display:flex;align-items:center;justify-content:space-between;gap:8px}
      #notes-navbar-diagnostic button {font:inherit;min-height:40px;border:1px solid #d5cede;border-radius:8px;background:#f6f3fa;color:#54376d;padding:7px 10px;cursor:pointer}
      #notes-navbar-diagnostic button[aria-pressed="true"] {background:#54376d;color:white}
      #notes-navbar-diagnostic .diagnostic-actions {display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
      #notes-navbar-diagnostic p {font:inherit;margin:8px 0}
      #notes-navbar-diagnostic [hidden] {display:none!important}
    `;
    document.head.append(style);
    panel = document.createElement('section'); panel.id = 'notes-navbar-diagnostic';
    panel.setAttribute('aria-label','Verificação da barra inferior');
    panel.innerHTML = `<header><strong>Barra de Anotações</strong><button type="button" data-action="collapse" aria-expanded="true">Recolher</button></header>
      <div data-body><p>Compare as posições. O teste é temporário e não altera suas notas.</p>
      <div class="diagnostic-actions"><button type="button" data-position="current" aria-pressed="true">Posição atual</button><button type="button" data-position="native" aria-pressed="false">Testar borda inferior</button></div>
      <p data-current>Posição atual</p>
      <div class="diagnostic-actions"><button type="button" data-observation="fits">Ficou correto</button><button type="button" data-observation="clipped">Continua cortado</button><button type="button" data-observation="gap">Ficou uma faixa abaixo</button></div>
      <p data-message role="status">Medidas iniciais registradas. Observe a barra antes de comparar.</p>
      <div class="diagnostic-actions"><button type="button" data-action="copy">Copiar log</button><button type="button" data-action="download">Baixar log</button><button type="button" data-action="stop">Sair e restaurar</button></div></div>`;
    current = panel.querySelector('[data-current]'); message = panel.querySelector('[data-message]');
    panel.addEventListener('click', event => {
      const button = event.target.closest('button'); if (!button) return;
      if (button.dataset.position) return compare(button.dataset.position === 'native');
      if (button.dataset.observation) {
        record('visual-observation',button.dataset.observation);
        message.textContent = 'Resultado registrado. Copie o log para enviar na conversa.'; return;
      }
      switch (button.dataset.action) {
        case 'collapse': {
          const body = panel.querySelector('[data-body]'); body.hidden = !body.hidden;
          button.textContent = body.hidden ? 'Abrir' : 'Recolher'; button.setAttribute('aria-expanded',String(!body.hidden)); break;
        }
        case 'stop': stop(); break;
        case 'download': download(); break;
        case 'copy': {
          const text = JSON.stringify(report());
          const failed = () => { if (enabled) message.textContent = 'Não foi possível copiar. Use Baixar log.'; };
          try {
            if (!navigator.clipboard?.writeText) { failed(); break; }
            navigator.clipboard.writeText(text).then(() => { if (enabled) message.textContent = 'Log copiado. Envie na conversa.'; },failed);
          } catch (_) { failed(); }
          break;
        }
      }
    });
    document.body.append(panel);
    window.addEventListener('pagehide', restore);
    window.addEventListener('pageshow', resume);
  }
  async function start() {
    if (ownsCollector) {
      window.__NOTES_AURA_DIAGNOSTIC_REQUESTED__ = true;
      await new Promise((resolve,reject) => {
        const script = document.createElement('script'); script.id = 'notes-aura-diagnostic-script';
        script.src = new URL('aura-diagnostics.js',source).href;
        script.onload = resolve; script.onerror = () => { script.remove(); reject(new Error('collector unavailable')); };
        document.head.append(script);
      });
    }
    if (window.NotesAuraDiagnostics?.report().baseline) build();
    else window.addEventListener('notes:aura-diagnostics-ready',build,{once:true});
  }
  window.NotesNavbarDiagnostics = {get enabled() { return enabled; }, report, stop,
    show() { if (panel) { panel.querySelector('[data-body]').hidden = false; const button = panel.querySelector('[data-action="collapse"]'); button.textContent = 'Recolher'; button.setAttribute('aria-expanded','true'); } }};
  start().catch(() => {
    stop(); window.NotesVersions?.open();
    const status = document.getElementById('notes-version-message');
    if (status) status.textContent = 'Não foi possível carregar a verificação. Tente novamente.';
  });
})();
