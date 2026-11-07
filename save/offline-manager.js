document.addEventListener('DOMContentLoaded', () => {
  const FLAG_KEY = 'reuniao-offline-baixado';
  const button = document.getElementById('btn-offline-toggle');
  const progressContainer = document.getElementById('offline-progress-container');
  const progressFill = document.getElementById('offline-progress-fill');
  const progressText = document.getElementById('offline-progress-text');
  const hint = document.querySelector('.offline-section p');
  if (!button) return;
  let isDownloaded = false;
  let bibleComplete = false;
  let busy = false;
  let pendingRequest;
  const requestId = () => 'offline-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  function updateUI() {
    button.innerHTML = isDownloaded ? '🗑️ Apagar arquivos offline' : '⬇️ Baixar aplicativo e Bíblia';
    button.classList.toggle('btn-danger', isDownloaded);
    button.classList.toggle('btn-secondary', !isDownloaded);
    if (hint) hint.textContent = isDownloaded
      ? 'Aplicativo e Bíblia disponíveis offline. Os estudos de A Sentinela são baixados pelo botão Baixar na aba A Sentinela.'
      : bibleComplete
        ? 'A Bíblia já está disponível offline. Baixe também as outras telas do aplicativo. Os estudos são baixados na aba A Sentinela.'
        : 'Baixe o aplicativo e a Bíblia de Estudo completa, com imagens e apêndices. Áudios e vídeos precisam de internet.';
  }
  function setDownloaded(value) {
    isDownloaded = value;
    try { if (value) localStorage.setItem(FLAG_KEY, '1'); else localStorage.removeItem(FLAG_KEY); } catch (_) {}
    updateUI();
  }
  async function activeWorker() {
    if (!('serviceWorker' in navigator)) throw new Error('Seu navegador não suporta o modo offline.');
    const registration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_,reject) => setTimeout(() => reject(new Error('O modo offline está iniciando. Tente novamente em instantes.')), 10000))
    ]);
    const worker = registration.active || navigator.serviceWorker.controller;
    if (!worker) throw new Error('O modo offline ainda está iniciando.');
    return worker;
  }
  async function requestCacheStatus() {
    const worker = await activeWorker();
    return new Promise((resolve,reject) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => { channel.port1.close(); reject(new Error('Não foi possível conferir os arquivos offline agora.')); }, 15000);
      channel.port1.onmessage = event => {
        if (!event.data || event.data.type !== 'CACHE_STATUS') return;
        clearTimeout(timer); channel.port1.close(); resolve(event.data);
      };
      worker.postMessage({ action:'CACHE_STATUS', requestId:requestId() }, [channel.port2]);
    });
  }
  async function reconcile() {
    if (busy) return;
    try {
      const status = await requestCacheStatus();
      bibleComplete = status.bibleComplete === true;
      // Storage flags are only a UI hint. Check the actual cached package every time.
      setDownloaded(status.complete === true);
    } catch (_) { setDownloaded(false); }
  }
  function finish() {
    busy = false; button.disabled = false; pendingRequest = undefined;
    if (progressContainer) progressContainer.style.display = 'none';
    if (progressText) progressText.style.display = 'none';
  }
  button.addEventListener('click', async () => {
    if (busy) return;
    try {
      const worker = await activeWorker();
      const status = await requestCacheStatus();
      bibleComplete = status.bibleComplete === true;
      setDownloaded(status.complete === true);
      if (isDownloaded) {
        if (!confirm('Apagar os arquivos offline do aplicativo? Suas anotações, biblioteca local e estudos já baixados serão preservados.')) return;
        busy = true; button.disabled = true; button.textContent = 'Apagando…';
        pendingRequest = requestId();
        worker.postMessage({ action:'CLEAR_CACHE', requestId:pendingRequest });
      } else {
        if (!navigator.onLine) throw new Error('Conecte-se à internet para concluir o download. Os arquivos já preparados serão aproveitados.');
        busy = true; button.disabled = true; button.textContent = 'Preparando…';
        if (progressContainer) progressContainer.style.display = 'block';
        if (progressText) { progressText.style.display = 'block'; progressText.textContent = 'Conferindo os arquivos…'; }
        if (progressFill) progressFill.style.width = '0%';
        pendingRequest = requestId();
        worker.postMessage({ action:'START_DOWNLOAD', requestId:pendingRequest });
      }
    } catch (error) { finish(); updateUI(); alert(error.message); }
  });
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', event => {
    const data = event.data;
    if (!data) return;
    if (data.type === 'BIBLE_OFFLINE_COMPLETE' && !busy) { reconcile(); return; }
    if (!pendingRequest || data.requestId !== pendingRequest) return;
    if (data.type === 'DOWNLOAD_PROGRESS') {
      const percent = data.total ? Math.round(data.loaded / data.total * 100) : 0;
      button.textContent = 'Baixando…';
      if (progressFill) progressFill.style.width = `${percent}%`;
      if (progressText) progressText.textContent = `${percent}% (${data.loaded}/${data.total} arquivos)`;
    } else if (data.type === 'DOWNLOAD_COMPLETE') {
      finish(); bibleComplete = true; setDownloaded(data.complete === true);
      if (data.complete === true) alert('Aplicativo e Bíblia completos para leitura offline. Áudios e vídeos precisam de internet. Baixe os estudos pela aba A Sentinela.');
    } else if (data.type === 'DOWNLOAD_ERROR') {
      finish(); setDownloaded(false);
      alert(data.message || 'O download ficou incompleto. Tente novamente; os arquivos já baixados serão aproveitados.');
    } else if (data.type === 'CACHE_CLEARED') {
      finish(); bibleComplete = false; setDownloaded(false);
    }
  });
  window.addEventListener('pageshow', () => reconcile());
  window.addEventListener('online', () => reconcile());
  updateUI(); reconcile();
});
