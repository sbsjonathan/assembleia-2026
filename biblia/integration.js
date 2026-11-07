'use strict';
// Offline checks never block reading or turn a saved Bible into an error banner.
(() => {
  const root = new URL('../', document.currentScript.src);
  const notice = document.getElementById('bible-offline-notice');
  const action = document.getElementById('offline-status');
  const detail = document.getElementById('offline-detail');
  let ready = false, textReady = false, fresh = false, checking, workerPromise;
  let jobRunning = false, autoAttempted = false, activeRequest, hideTimer, workerRevision = 0;
  const requestId = () => 'bible-offline-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  function hideNotice() { clearTimeout(hideTimer); notice.hidden = true; notice.classList.remove('offline-error'); }
  function showState(message, label, {banner = false, complete = false} = {}) {
    detail.textContent = message;
    action.replaceChildren(document.createTextNode(label), Object.assign(document.createElement('span'), {textContent:complete?'✓':'↓'}));
    if (banner) { notice.textContent = message; notice.hidden = false; notice.classList.remove('offline-error'); }
    else hideNotice();
  }
  function finish() {
    jobRunning = false; ready = true; activeRequest = undefined;
    showState('Bíblia disponível offline: livros, notas, mapas e apêndices. Áudios e vídeos usam internet.', 'Bíblia disponível offline', {complete:true,banner:fresh});
    if (fresh) { fresh = false; hideTimer = setTimeout(hideNotice, 3000); }
  }
  function incomplete() {
    ready = false; jobRunning = false; activeRequest = undefined;
    const message = textReady
      ? 'O texto da Bíblia está salvo neste iPhone. Ainda faltam arquivos para completar os mapas, imagens ou outras telas offline. Toque para retomar quando estiver conectado.'
      : 'Conecte-se para preparar a leitura offline. O que já foi salvo será aproveitado.';
    showState(message, 'Completar leitura offline');
  }
  async function worker() {
    if (workerPromise) return workerPromise;
    workerPromise = (async () => {
      if (!('serviceWorker' in navigator)) throw new Error('Abra A Sentinela no Safari para preparar o modo offline.');
      // Use the current worker immediately. A code update can finish in the background.
      const controller = navigator.serviceWorker.controller;
      if (controller && controller.scriptURL === new URL('sw.js', root).href) return controller;
      const existing = await navigator.serviceWorker.getRegistration(root.href);
      if (existing?.active) return existing.active;
      const registration = existing || await navigator.serviceWorker.register(new URL('sw.js', root), {scope:root.pathname});
      if (registration.active) return registration.active;
      return await new Promise((resolve,reject) => {
        const timer = setTimeout(() => reject(new Error('O modo offline ainda está sendo preparado.')), 12000);
        navigator.serviceWorker.ready.then(ready => {clearTimeout(timer);resolve(ready.active);}, error => {clearTimeout(timer);reject(error);});
      });
    })().catch(error => { workerPromise = null; throw error; });
    return workerPromise;
  }
  async function status(active) {
    return new Promise((resolve,reject) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => {channel.port1.close();reject(new Error('Não foi possível conferir os arquivos offline agora.'));}, 8000);
      channel.port1.onmessage = ({data}) => {
        if (data?.type !== 'CACHE_STATUS') return;
        clearTimeout(timer); channel.port1.close(); resolve(data);
      };
      active.postMessage({action:'CACHE_STATUS',fast:true,requestId:requestId()},[channel.port2]);
    });
  }
  function begin(active) {
    jobRunning = true; autoAttempted = true; activeRequest = requestId();
    showState('Salvando mapas e imagens para leitura offline. Você já pode continuar lendo.', 'Preparando leitura offline…', {banner:fresh});
    active.postMessage({action:'PREPARE_BIBLE_OFFLINE',requestId:activeRequest});
    navigator.storage?.persist?.().catch(() => {});
  }
  async function prepare(options = {}) {
    textReady = options.textReady ?? textReady;
    fresh = options.fresh ?? fresh;
    if (checking || jobRunning) return checking;
    const revision = workerRevision;
    checking = (async () => {
      try {
        const active = await worker();
        const saved = await status(active);
        if (revision !== workerRevision) return;
        if (typeof saved.bibleComplete !== 'boolean' || (saved.message && saved.total == null)) throw new Error('Status offline indisponível.');
        if (saved.bibleComplete === true) { finish(); return; }
        incomplete();
        if (navigator.onLine && (options.manual || !autoAttempted)) begin(active);
      } catch (_) {
        if (revision !== workerRevision) return;
        // Failure to inspect storage says nothing about already saved Bible text.
        // Keep a truthful retry action in Library; never interrupt the reader.
        if (!ready) showState(textReady
          ? 'O texto da Bíblia está salvo neste iPhone. A disponibilidade dos mapas e imagens pode ser conferida novamente aqui.'
          : 'A disponibilidade offline pode ser conferida novamente aqui.', 'Conferir leitura offline');
      }
    })().finally(() => {checking = null;});
    return checking;
  }
  navigator.serviceWorker?.addEventListener('message', ({data}) => {
    if (!data || !jobRunning || data.requestId !== activeRequest) return;
    if (data.type === 'BIBLE_OFFLINE_COMPLETE') finish();
    else if (data.type === 'BIBLE_OFFLINE_PROGRESS') {
      const percent = data.bytesTotal ? Math.min(99,Math.floor(data.bytesLoaded*100/data.bytesTotal)) : 0;
      showState(`Salvando mapas e imagens para leitura offline… ${percent}%. Você já pode continuar lendo.`, `Preparando leitura offline · ${percent}%`, {banner:fresh});
    } else if (data.type === 'BIBLE_OFFLINE_ERROR') incomplete();
  });
  navigator.serviceWorker?.addEventListener('controllerchange', () => {
    workerRevision++; workerPromise = null; jobRunning = false; activeRequest = undefined; autoAttempted = false;
    if (textReady) { if (checking) checking.finally(() => prepare()); else prepare(); }
  });
  action.onclick = () => prepare({manual:true});
  window.prepareSentinelaBibleOffline = prepare;
  window.addEventListener('online', () => { if(!ready){autoAttempted=false;prepare();} });
  window.addEventListener('pageshow', event => { if(event.persisted) prepare(); });
  showState('A disponibilidade offline é conferida em segundo plano, sem interromper a leitura.', 'Conferir leitura offline');
})();
