/* The editor can be rolled back independently of its notes. No data migration. */
(() => {
  'use strict';
  const current = document.documentElement.dataset.notesVersion === '1' ? '1' : '2';
  const preferenceKey = 'sentinela-notes-version';
  const choiceKey = 'sentinela-notes-version-choice';
  const parameters = new URLSearchParams(location.search);
  const requested = parameters.get('versao');
  const scriptURL = new URL(document.currentScript.src);
  const entry = version => new URL(version === '1' ? 'container-v1.html' : 'container.html', scriptURL);
  function destination(version) {
    const url = entry(version); url.search = location.search; url.hash = location.hash;
    url.searchParams.set('versao', version);
    url.searchParams.delete('experimental');
    return url;
  }
  let preferred;
  try {
    preferred = localStorage.getItem(choiceKey);
  } catch (_) {}
  // The previous release assigned v1 automatically. That assignment is not a
  // user preference. Resume v2 by default; keep explicit links and menu choices.
  const chosen = ['1', '2'].includes(requested) ? requested : current === '1' ? '1' :
    ['1', '2'].includes(preferred) ? preferred : '2';
  try {
    localStorage.setItem(preferenceKey, chosen);
  } catch (_) {}
  if (chosen !== current) { location.replace(destination(chosen)); return; }

  function week() {
    const specified = new URLSearchParams(location.search).get('semana');
    if (specified) return specified;
    const day = new Date(); day.setDate(day.getDate() + (day.getDay() === 0 ? -6 : 1 - day.getDay()));
    return `${String(day.getDate()).padStart(2, '0')}-${String(day.getMonth() + 1).padStart(2, '0')}`;
  }
  const initialWeek = week(), cacheKey = 'richtext_cache_' + initialWeek;
  let initialRaw = null, backupError = false, overlay, message, trigger;
  try { initialRaw = localStorage.getItem(cacheKey); } catch (_) {}
  function database() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('sentinela-notes-versions', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('before-v2', {keyPath:'week'});
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('A cópia inicial está aguardando outra aba.'));
    });
  }
  async function preserveOriginal() {
    if (current !== '2') return;
    const db = await database();
    try {
      await new Promise((resolve, reject) => {
        const transaction = db.transaction('before-v2', 'readwrite');
        const store = transaction.objectStore('before-v2');
        const read = store.get(initialWeek);
        read.onsuccess = () => {
          if (!read.result) store.add({week:initialWeek, raw:initialRaw, createdAt:new Date().toISOString(), sourceVersion:1});
        };
        transaction.oncomplete = resolve;
        transaction.onerror = transaction.onabort = () => reject(transaction.error);
      });
    } finally { db.close(); }
  }
  const ready = preserveOriginal().catch(() => { backupError = Boolean(initialRaw); });
  async function getBackup() {
    await ready;
    const db = await database();
    try {
      return await new Promise((resolve, reject) => {
        const request = db.transaction('before-v2').objectStore('before-v2').get(initialWeek);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
    } finally { db.close(); }
  }
  function download(raw, name) {
    const href = URL.createObjectURL(new Blob([raw], {type:'application/json;charset=utf-8'}));
    const link = document.createElement('a'); link.href = href; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }
  function exportCurrent() {
    const store = window.cacheRichText, snapshot = store?.snapshot();
    const raw = snapshot ? JSON.stringify(snapshot.payload, null, 2) : localStorage.getItem(cacheKey);
    if (raw) download(raw, `anotacoes-${initialWeek}.json`);
  }
  function recoveryCopies() {
    if (window.cacheRichText?.listRecovery) return window.cacheRichText.listRecovery();
    const copies = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith('richtext_recovery_' + initialWeek + '_')) {
          try { copies.push(JSON.parse(localStorage.getItem(key))); } catch (_) {}
        }
      }
    } catch (_) {}
    return copies;
  }
  async function switchTo(version) {
    if (!['1','2'].includes(String(version))) return false;
    if (String(version) === current) {
      try { localStorage.setItem(choiceKey, current); } catch (_) {}
      close(); return true;
    }
    const store = window.cacheRichText;
    await store?.ready;
    if (!store) return false;
    let saved = false;
    try {
      if (store.canLeave) saved = store.canLeave();
      else {
        // v1 can load legacy HTML into a tree without rewriting that cache.
        // Those equivalent representations have different content keys. Its
        // synchronous error event reliably distinguishes a failed flush.
        let failed = false;
        const onError = () => { failed = true; };
        window.addEventListener('notes:save-error', onError);
        try { saved = Boolean(store.flush()) && !failed; }
        finally { window.removeEventListener('notes:save-error', onError); }
      }
    } catch (_) {}
    if (!saved) {
      if (message) message.textContent = 'Resolva o aviso de salvamento antes de trocar de versão. Você também pode exportar sua nota.';
      return false;
    }
    try {
      localStorage.setItem(preferenceKey, String(version));
      localStorage.setItem(choiceKey, String(version));
    } catch (_) {}
    location.assign(destination(String(version)));
    return true;
  }
  function close() {
    if (!overlay) return;
    overlay.hidden = true;
    if (trigger?.isConnected) trigger.focus({preventScroll:true});
  }
  function build() {
    overlay = document.createElement('div'); overlay.className = 'notes-version-overlay'; overlay.id = 'notes-versions'; overlay.hidden = true;
    overlay.innerHTML = `<section class="notes-version-card" role="dialog" aria-modal="true" aria-labelledby="notes-versions-title">
      <header><h2 id="notes-versions-title">Anotações · versão ${current}</h2><button type="button" id="notes-versions-close" aria-label="Fechar opções">×</button></header>
      <div class="notes-version-body">
      <p>Alternar a versão mantém suas anotações.</p>
      <button type="button" id="notes-version-2" class="notes-version-choice"><strong>Versão 2 · atual</strong><span>Edição e leitura com borda animada</span></button>
      <button type="button" id="notes-version-1" class="notes-version-choice"><strong>Versão 1</strong><span>Página anterior preservada</span></button>
      <p id="notes-version-message" role="status"></p>
      <button type="button" id="notes-diagnose-navbar" class="notes-version-export" ${current === '2' ? '' : 'hidden'}>Verificar barra inferior</button>
      <button type="button" id="notes-export-current" class="notes-version-export">Exportar nota desta semana</button>
      <button type="button" id="notes-export-original" class="notes-version-export" hidden>Exportar cópia anterior à v2</button>
      <button type="button" id="notes-export-recovery" class="notes-version-export" hidden>Exportar cópias preservadas</button>
      </div>
    </section>`;
    document.body.append(overlay); message = overlay.querySelector('#notes-version-message');
    overlay.querySelector('#notes-versions-close').onclick = close;
    for (const version of ['1','2']) {
      const button = overlay.querySelector('#notes-version-' + version);
      button.setAttribute('aria-pressed', String(version === current));
      button.onclick = () => switchTo(version);
    }
    overlay.querySelector('#notes-export-current').onclick = exportCurrent;
    overlay.querySelector('#notes-diagnose-navbar').onclick = () => {
      if (window.NotesNavbarDiagnostics?.enabled) { close(); window.NotesNavbarDiagnostics.show(); return; }
      if (document.getElementById('notes-navbar-diagnostic-script')) return;
      close();
      const script = document.createElement('script'); script.id = 'notes-navbar-diagnostic-script';
      script.src = new URL('navbar-diagnostics.js',scriptURL).href;
      script.onerror = () => { script.remove(); open(); message.textContent = 'Não foi possível abrir a verificação. Tente novamente.'; };
      document.head.append(script);
    };
    overlay.querySelector('#notes-export-original').onclick = async () => {
      const backup = await getBackup().catch(() => null);
      if (backup?.raw) download(backup.raw, `anotacoes-antes-v2-${initialWeek}.json`);
    };
    overlay.querySelector('#notes-export-recovery').onclick = () => {
      download(JSON.stringify({type:'notes-recovery', semana:initialWeek, copies:recoveryCopies()}, null, 2), `anotacoes-recuperadas-${initialWeek}.json`);
    };
    overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
    overlay.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key === 'Tab') {
        const buttons = [...overlay.querySelectorAll('button')].filter(button => !button.hidden && !button.disabled);
        const first = buttons[0], last = buttons.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    });
  }
  function open(event) {
    event?.preventDefault(); trigger = event?.currentTarget || document.activeElement;
    if (!overlay) build();
    message.textContent = backupError ? 'Não foi possível guardar a cópia inicial neste dispositivo. Você pode exportar sua nota.' : '';
    overlay.hidden = false; overlay.querySelector('#notes-versions-close').focus({preventScroll:true});
    overlay.querySelector('#notes-export-recovery').hidden = !recoveryCopies().length;
    getBackup().then(backup => { overlay.querySelector('#notes-export-original').hidden = !backup?.raw; }).catch(() => {});
  }
  window.NotesVersions = {current, ready, open, close, switchTo, getBackup, exportCurrent};
})();
