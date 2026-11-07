document.addEventListener("DOMContentLoaded", () => {
    const barraEstudo = document.querySelector(".barra-estudo");
    const mainContent = document.querySelector("main");

    if (!barraEstudo || !mainContent) return;

    const FONTE_STORAGE_KEY = 'tamanho-fonte-global';
    const FONTE_PADRAO = 19.36;
    const NIVEL_PADRAO = 3;
    const NIVEL_MIN = 1;
    const NIVEL_MAX = 11;
    // Fallback for legacy cached articles whose shared module loads after this menu.
    const TAMANHOS_FONTE = Array.from({ length: NIVEL_MAX }, (_, index) =>
        Number((FONTE_PADRAO * Math.pow(30 / FONTE_PADRAO, (index + 1 - NIVEL_PADRAO) / 8)).toFixed(2))
    );
    const urlParams = new URLSearchParams(window.location.search);
    const semanaAtual = window.semanaAtual || urlParams.get('semana') || 'Atual';
    const estudoId = window.estudoId || document.body.dataset.estudo || '';

    function isPerfLowMode() {
        return document.documentElement.classList.contains('perf-low') || localStorage.getItem('editor-performance-mode') === 'low';
    }

    function aplicarGlowDaCorEstudo() {
        const corGlobal = getComputedStyle(document.body).getPropertyValue('--cor-principal-estudo').trim() || '#51919d';
        let glow = 'rgba(180,180,185,0.15)';
        if (corGlobal.startsWith('#')) {
            const bigint = parseInt(corGlobal.slice(1), 16);
            const r = (bigint >> 16) & 255;
            const g = (bigint >> 8) & 255;
            const b = bigint & 255;
            glow = `rgba(${r},${g},${b},0.18)`;
        } else if (corGlobal.startsWith('rgb')) {
            const [r, g, b] = corGlobal.replace(/[^\d,]/g, '').split(',').map((n) => n.trim());
            glow = `rgba(${r},${g},${b},0.18)`;
        }
        document.documentElement.style.setProperty('--cor-glow', glow);
    }

    function getStaticActionIcon(name) {
        switch (name) {
            case 'font': return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="4 7 4 4 20 4 20 7"></polyline><line x1="9" y1="20" x2="15" y2="20"></line><line x1="12" y1="4" x2="12" y2="20"></line></svg>`;
            case 'cloud': return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 18a4 4 0 1 1 .5-7.97A5.5 5.5 0 0 1 18 11a3.5 3.5 0 1 1 0 7H7Z"></path><path d="M12 10v7"></path><path d="m9.5 14.5 2.5 2.5 2.5-2.5"></path></svg>`;
            case 'export': return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`;
            case 'trash': return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"></path><path d="M8 6V4.8A1.8 1.8 0 0 1 9.8 3h4.4A1.8 1.8 0 0 1 16 4.8V6"></path><path d="M6 6l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"></path><path d="M10 10.5v5.5"></path><path d="M14 10.5v5.5"></path></svg>`;
            default: return '';
        }
    }

    const menuHTML = `
      <div id="sentinela-controles" class="menu-barra" style="display: none;">
        <div class="controle-grupo controle-grupo-acoes">
          <div class="acoes-grid" role="group" aria-label="Ações principais">
            <button id="btn-fonte-toggle" class="action-card" type="button" aria-expanded="false">
              <span class="action-card__icon">${getStaticActionIcon('font')}</span>
              <span class="action-card__label">Fonte</span>
            </button>
            <button id="btn-tema-toggle" class="action-card" type="button" aria-expanded="false">
              <span class="action-card__icon"></span>
              <span class="action-card__label">Tema</span>
            </button>
            <button id="btn-exportar-bin" class="action-card action-card--export" type="button">
              <span class="action-card__icon">${getStaticActionIcon('export')}</span>
              <span class="action-card__label">Backup</span>
            </button>
            <button id="btn-abrir-sync" class="action-card action-card--cloud" type="button">
              <span class="action-card__icon">${getStaticActionIcon('cloud')}</span>
              <span class="action-card__label">Nuvem</span>
            </button>
            <button id="btn-perf-toggle" class="action-card action-card--perf" type="button">
              <span class="action-card__icon"></span>
              <span class="action-card__label">Desempenho</span>
            </button>
            <button id="btn-limpar-cache" class="action-card action-card--danger" type="button">
              <span class="action-card__icon">${getStaticActionIcon('trash')}</span>
              <span class="action-card__label">Apagar Local</span>
            </button>
          </div>
          <div id="font-options-area" class="expandable-area" hidden>
            <div class="controle-fonte">
              <div class="controle-fonte-topo" aria-hidden="true">
                <span class="fonte-preview fonte-preview-menor">A</span>
                <span class="fonte-preview fonte-preview-maior">A</span>
              </div>
              <div class="range-shell">
                <span class="range-linha" aria-hidden="true"></span>
                <span class="range-ticks" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>
                <input type="range" id="range-tamanho-fonte" aria-label="Tamanho da fonte" min="${NIVEL_MIN}" max="${NIVEL_MAX}" step="1" value="${NIVEL_PADRAO}">
              </div>
            </div>
          </div>
          <div id="theme-options-area" class="expandable-area" hidden>
            <div class="segmented-control">
              <input type="radio" name="tema" id="theme-system" value="system" checked>
              <input type="radio" name="tema" id="theme-light" value="light">
              <input type="radio" name="tema" id="theme-dark" value="dark">
              <label for="theme-system">Sistema</label>
              <label for="theme-light">Claro</label>
              <label for="theme-dark">Escuro</label>
              <div class="segmented-slider"></div>
            </div>
          </div>
        </div>
      </div>
    `;

    mainContent.insertAdjacentHTML('afterbegin', menuHTML);

    const sheetsHTML = `
      <div class="sync-sheet-overlay" id="sentinelaSyncOverlay" aria-hidden="true">
        <div class="sync-sheet" role="dialog" aria-modal="true">
          <div class="sync-sheet__handle"></div>
          <div class="sync-sheet__inner">
            <div class="sync-sheet__topbar">
              <div class="sync-sheet__title">Nuvem da Sentinela</div>
              <button type="button" class="sync-sheet__close" id="sentinelaSyncClose">×</button>
            </div>
            <div class="sync-sheet__tabs">
              <button type="button" class="sync-sheet__tab is-active" data-sync-tab="enviar">Enviar</button>
              <button type="button" class="sync-sheet__tab" data-sync-tab="baixar">Baixar</button>
              <button type="button" class="sync-sheet__tab" data-sync-tab="apagar">Apagar</button>
            </div>
            <section class="sync-sheet__panel" data-sync-panel="enviar">
              <div class="sync-card">
                <div class="sync-options">
                  <label class="sync-choice">
                    <input type="radio" name="sync-enviar" value="merge" checked>
                    <span class="sync-choice__body">
                      <span class="sync-choice__title">Juntar tudo (Recomendado)</span>
                      <span class="sync-choice__desc">Junta as anotações deste aparelho com as da nuvem. Nenhuma nota é perdida.</span>
                    </span>
                  </label>
                  <label class="sync-choice">
                    <input type="radio" name="sync-enviar" value="overwrite">
                    <span class="sync-choice__body">
                      <span class="sync-choice__title">Substituir Nuvem</span>
                      <span class="sync-choice__desc">Apaga as anotações deste artigo na nuvem e guarda exatamente como este aparelho está agora.</span>
                    </span>
                  </label>
                </div>
              </div>
            </section>
            <section class="sync-sheet__panel" data-sync-panel="baixar" hidden>
              <div class="sync-card">
                <div class="sync-options">
                  <label class="sync-choice">
                    <input type="radio" name="sync-baixar" value="merge" checked>
                    <span class="sync-choice__body">
                      <span class="sync-choice__title">Baixar e Misturar</span>
                      <span class="sync-choice__desc">Traz da nuvem e soma com o que você já fez hoje. Nenhuma nota local é apagada.</span>
                    </span>
                  </label>
                  <label class="sync-choice">
                    <input type="radio" name="sync-baixar" value="overwrite">
                    <span class="sync-choice__body">
                      <span class="sync-choice__title">Restaurar Aparelho</span>
                      <span class="sync-choice__desc">Apaga as anotações deste aparelho e deixa idêntico ao que está salvo na nuvem.</span>
                    </span>
                  </label>
                </div>
              </div>
            </section>
            <section class="sync-sheet__panel" data-sync-panel="apagar" hidden>
              <div class="sync-card">
                <div class="sync-options">
                  <label class="sync-choice sync-choice--danger">
                    <input type="radio" name="sync-apagar" value="day" checked>
                    <span class="sync-choice__body">
                      <span class="sync-choice__title">Apagar este artigo da Nuvem</span>
                      <span class="sync-choice__desc">Remove as anotações da semana ${semanaAtual} da nuvem. O resto continua a salvo.</span>
                    </span>
                  </label>
                </div>
              </div>
            </section>
            <div class="sync-sheet__actions">
              <button type="button" class="sync-sheet__secondary" id="sentinelaSyncCancel">Cancelar</button>
              <button type="button" class="sync-sheet__primary" id="sentinelaSyncRun">Avançar</button>
            </div>
          </div>
        </div>
      </div>

      <div class="sync-sheet-overlay" id="sentinelaDeleteOverlay" aria-hidden="true">
        <div class="sync-sheet" role="dialog" aria-modal="true">
          <div class="sync-sheet__handle"></div>
          <div class="sync-sheet__inner">
            <div class="sync-sheet__topbar">
              <div class="sync-sheet__title">Limpeza Local</div>
              <button type="button" class="sync-sheet__close" id="sentinelaDeleteClose">×</button>
            </div>
            <div class="sync-card">
              <div class="sync-options">
                <label class="sync-choice sync-choice--danger">
                  <input type="radio" name="local-delete-opt" value="day" checked>
                  <span class="sync-choice__body">
                    <span class="sync-choice__title">Apagar anotações deste artigo</span>
                    <span class="sync-choice__desc">Remove respostas da IA, comentários e destaques deste estudo da Sentinela.</span>
                  </span>
                </label>
                <label class="sync-choice sync-choice--danger">
                  <input type="radio" name="local-delete-opt" value="all-notes">
                  <span class="sync-choice__body">
                    <span class="sync-choice__title">Apagar de TODAS as Sentinelas</span>
                    <span class="sync-choice__desc">Esvazia todas as anotações de todos os artigos locais (Assembleia é mantida).</span>
                  </span>
                </label>
                <label class="sync-choice sync-choice--danger">
                  <input type="radio" name="local-delete-opt" value="nuclear">
                  <span class="sync-choice__body">
                    <span class="sync-choice__title">Formatar App Inteiro (Opção Nuclear)</span>
                    <span class="sync-choice__desc">Desloga a conta, apaga a Sentinela, Assembleia e reseta todo o aplicativo.</span>
                  </span>
                </label>
              </div>
            </div>
            <div class="sync-sheet__actions">
              <button type="button" class="sync-sheet__secondary" id="sentinelaDeleteCancel">Cancelar</button>
              <button type="button" class="sync-sheet__primary is-danger" id="sentinelaDeleteRun">Apagar Dados</button>
            </div>
          </div>
        </div>
      </div>

      <div class="sync-sheet-overlay" id="sentinelaExportOverlay" aria-hidden="true">
        <div class="sync-sheet" role="dialog" aria-modal="true">
          <div class="sync-sheet__handle"></div>
          <div class="sync-sheet__inner">
            <div class="sync-sheet__topbar">
              <div class="sync-sheet__title">Backup Local (Offline)</div>
              <button type="button" class="sync-sheet__close" id="sentinelaExportClose">×</button>
            </div>
            <div class="sync-sheet__tabs tabs-2">
              <button type="button" class="sync-sheet__tab is-active" data-exp-tab="exportar">Exportar</button>
              <button type="button" class="sync-sheet__tab" data-exp-tab="importar">Importar</button>
            </div>
            <section class="sync-sheet__panel" data-exp-panel="exportar">
              <div class="sync-card">
                <p class="sync-sheet__meta" style="margin:0;">O arquivo <strong>.bin</strong> contém todas as suas anotações da Sentinela e preferências de leitura salvas no aparelho. Útil para backup offline ou transferir para outro iPhone.</p>
              </div>
            </section>
            <section class="sync-sheet__panel" data-exp-panel="importar" hidden>
              <div class="sync-card">
                <div class="sync-sheet__file">
                  <input id="sentinelaImportFile" class="sync-sheet__file-input" type="file" accept=".bin,.json,application/octet-stream,application/json">
                  <label for="sentinelaImportFile" class="sync-sheet__file-label">Escolher Arquivo BIN</label>
                  <div class="sync-sheet__file-name" id="sentinelaImportFileName">Nenhum arquivo selecionado.</div>
                  <p class="sync-sheet__meta" style="margin:0; margin-top:8px;">Importar sobrescreverá as configurações e anotações locais com as do arquivo.</p>
                </div>
              </div>
            </section>
            <div class="sync-sheet__actions">
              <button type="button" class="sync-sheet__secondary" id="sentinelaExportCancel">Cancelar</button>
              <button type="button" class="sync-sheet__primary" id="sentinelaExportRun">Exportar BIN</button>
            </div>
          </div>
        </div>
      </div>

      <div class="sync-alert-overlay" id="sentinelaAlertOverlay" aria-hidden="true">
        <div class="sync-alert" role="alertdialog">
          <div class="sync-alert__content">
            <h3 class="sync-alert__title" id="sentinelaAlertTitle"></h3>
            <p class="sync-alert__text" id="sentinelaAlertText"></p>
          </div>
          <div class="sync-alert__actions">
            <button class="sync-alert__btn" id="sentinelaAlertBtnLeft"></button>
            <button class="sync-alert__btn sync-alert__btn--right" id="sentinelaAlertBtnRight"></button>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', sheetsHTML);

    const menuControles = document.getElementById('sentinela-controles');
    const rangeTamanhoFonte = document.getElementById('range-tamanho-fonte');
    const themeRadios = document.querySelectorAll('input[name="tema"]');
    const btnTemaToggle = document.getElementById('btn-tema-toggle');
    const btnFonteToggle = document.getElementById('btn-fonte-toggle');
    const btnPerfToggle = document.getElementById('btn-perf-toggle');
    const btnLimparCache = document.getElementById('btn-limpar-cache');
    const btnExportarBin = document.getElementById('btn-exportar-bin');
    const btnAbrirSync = document.getElementById('btn-abrir-sync');
    const themeOptionsArea = document.getElementById('theme-options-area');
    const fontOptionsArea = document.getElementById('font-options-area');

    let menuVisivel = false;

    barraEstudo.style.cursor = "pointer";
    barraEstudo.addEventListener('click', () => {
        menuVisivel = !menuVisivel;
        menuControles.style.display = menuVisivel ? 'block' : 'none';
        if (menuVisivel) aplicarGlowDaCorEstudo();
        else document.documentElement.style.setProperty('--cor-glow', 'rgba(180,180,185,0.15)');
    });

    function showCustomAlert({ title, text, left, right, leftDanger, rightDanger, leftBold, rightBold }) {
      return new Promise((resolve) => {
        const overlay = document.getElementById('sentinelaAlertOverlay');
        const titleEl = document.getElementById('sentinelaAlertTitle');
        const textEl = document.getElementById('sentinelaAlertText');
        const btnLeft = document.getElementById('sentinelaAlertBtnLeft');
        const btnRight = document.getElementById('sentinelaAlertBtnRight');

        titleEl.textContent = title;
        textEl.textContent = text;
        
        btnLeft.textContent = left;
        btnLeft.className = 'sync-alert__btn';
        if (leftDanger) btnLeft.classList.add('is-danger');
        if (leftBold) btnLeft.classList.add('is-bold');

        btnRight.textContent = right;
        btnRight.className = 'sync-alert__btn sync-alert__btn--right';
        if (rightDanger) btnRight.classList.add('is-danger');
        if (rightBold) btnRight.classList.add('is-bold');

        const cleanup = () => {
          overlay.classList.remove('is-open');
          btnLeft.removeEventListener('click', onLeft);
          btnRight.removeEventListener('click', onRight);
        };

        const onLeft = () => { cleanup(); resolve('left'); };
        const onRight = () => { cleanup(); resolve('right'); };

        btnLeft.addEventListener('click', onLeft);
        btnRight.addEventListener('click', onRight);

        overlay.classList.add('is-open');
      });
    }

    function isSentinelaKey(key) {
      if (!key) return false;
      return /^(c-|r-|p-|obj-|qa:)/.test(key) || /-pg-/.test(key) || key.startsWith('sentinela_loaded_');
    }

    function getLocalExportPayload() {
      const preferences = {};
      ['tema-interface', 'tamanho-fonte-global', 'editor-performance-mode'].forEach((key) => {
        const value = localStorage.getItem(key);
        if (value !== null) preferences[key] = value;
      });

      const annotations = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (isSentinelaKey(key)) {
          annotations[key] = localStorage.getItem(key);
        }
      }

      return {
        format: 'sentinela-bin-v1',
        exportedAt: new Date().toISOString(),
        preferences,
        annotations
      };
    }

    function downloadBlob(blob, filename) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1200);
    }

    async function exportBinFile() {
      const payload = getLocalExportPayload();
      const stamp = new Date().toISOString().slice(0, 10);
      const filename = `Backup_Sentinela_${stamp}.bin`;
      
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/octet-stream' });
      const file = new File([blob], filename, { type: 'application/octet-stream' });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file] });
        } catch (err) {
          if (err.name !== 'AbortError') downloadBlob(blob, filename);
        }
      } else {
        downloadBlob(blob, filename);
      }
    }

    async function importBinFile(file) {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed || parsed.format !== 'sentinela-bin-v1') {
        throw new Error('Arquivo BIN inválido ou corrompido.');
      }

      const preferences = parsed.preferences || {};
      const annotations = parsed.annotations || {};

      Object.entries(preferences).forEach(([key, value]) => localStorage.setItem(key, String(value)));
      Object.entries(annotations).forEach(([key, value]) => localStorage.setItem(key, String(value)));
    }

    // --- LOGIC: Export / Import BIN ---
    const expOverlay = document.getElementById('sentinelaExportOverlay');
    const expTabs = document.querySelectorAll('[data-exp-tab]');
    const expPanels = document.querySelectorAll('[data-exp-panel]');
    let activeExpTab = 'exportar';

    function setExpTab(tab) {
      activeExpTab = tab;
      expTabs.forEach(btn => btn.classList.toggle('is-active', btn.dataset.expTab === tab));
      expPanels.forEach(panel => panel.hidden = panel.dataset.expPanel !== tab);
      const runBtn = document.getElementById('sentinelaExportRun');
      runBtn.textContent = tab === 'exportar' ? 'Exportar BIN' : 'Importar BIN';
    }

    expTabs.forEach(btn => btn.addEventListener('click', () => setExpTab(btn.dataset.expTab)));
    document.getElementById('sentinelaExportClose').addEventListener('click', () => expOverlay.classList.remove('is-open'));
    document.getElementById('sentinelaExportCancel').addEventListener('click', () => expOverlay.classList.remove('is-open'));

    const importFileInput = document.getElementById('sentinelaImportFile');
    importFileInput.addEventListener('change', () => {
      const file = importFileInput.files?.[0];
      document.getElementById('sentinelaImportFileName').textContent = file ? file.name : 'Nenhum arquivo selecionado.';
    });

    btnExportarBin.addEventListener('click', () => {
      setExpTab('exportar');
      expOverlay.classList.add('is-open');
    });

    document.getElementById('sentinelaExportRun').addEventListener('click', async () => {
      const runBtn = document.getElementById('sentinelaExportRun');
      const originalText = runBtn.textContent;
      runBtn.disabled = true;
      runBtn.textContent = 'Aguarde...';

      try {
        if (activeExpTab === 'exportar') {
          await exportBinFile();
          expOverlay.classList.remove('is-open');
        } else {
          const file = importFileInput.files?.[0];
          if (!file) { alert('Selecione um arquivo.'); return; }
          const res = await showCustomAlert({
            title: "Sobrescrever anotações?",
            text: "A importação substituirá suas configurações e as anotações contidas no backup.",
            left: "Cancelar", right: "Importar", rightBold: true
          });
          if (res === 'right') {
            await importBinFile(file);
            expOverlay.classList.remove('is-open');
            location.reload();
          }
        }
      } catch (err) {
        alert(err.message || 'Erro inesperado.');
      } finally {
        runBtn.disabled = false;
        runBtn.textContent = originalText;
      }
    });

    // --- LOGIC: Nuvem Sync ---
    const syncOverlay = document.getElementById('sentinelaSyncOverlay');
    const syncTabs = document.querySelectorAll('[data-sync-tab]');
    const syncPanels = document.querySelectorAll('[data-sync-panel]');
    let activeSyncTab = 'enviar';

    function setSyncTab(tab) {
      activeSyncTab = tab;
      syncTabs.forEach(btn => btn.classList.toggle('is-active', btn.dataset.syncTab === tab));
      syncPanels.forEach(panel => panel.hidden = panel.dataset.syncPanel !== tab);
      const runBtn = document.getElementById('sentinelaSyncRun');
      if (tab === 'apagar') {
        runBtn.textContent = 'Apagar da Nuvem';
        runBtn.classList.add('is-danger');
      } else {
        runBtn.textContent = 'Avançar';
        runBtn.classList.remove('is-danger');
      }
    }

    syncTabs.forEach(btn => btn.addEventListener('click', () => setSyncTab(btn.dataset.syncTab)));
    document.getElementById('sentinelaSyncClose').addEventListener('click', () => syncOverlay.classList.remove('is-open'));
    document.getElementById('sentinelaSyncCancel').addEventListener('click', () => syncOverlay.classList.remove('is-open'));

    btnAbrirSync.addEventListener('click', () => {
      const isLoggedIn = !!localStorage.getItem('supabase_user');
      if (!isLoggedIn) {
        alert("Você precisa fazer login em 'Salvar' antes de usar a Nuvem.");
        return;
      }
      setSyncTab('enviar');
      syncOverlay.classList.add('is-open');
    });

    document.getElementById('sentinelaSyncRun').addEventListener('click', async () => {
      syncOverlay.classList.remove('is-open');
      const actionValue = document.querySelector(`input[name="sync-${activeSyncTab}"]:checked`).value;

      const runSync = async () => {
        if (!window.SupabaseSync) { alert('Erro: Supabase não inicializado.'); return; }
        
        try {
          if (activeSyncTab === 'apagar') {
            await window.SupabaseSync.salvarSentinelaAnotacoes(semanaAtual, estudoId, {});
            alert('Anotações apagadas da nuvem com sucesso.');
          } else if (activeSyncTab === 'enviar') {
            const anotacoes = window.sentinelaSync?.collectAnnotationsFromLocalStorage() || {};
            await window.SupabaseSync.salvarSentinelaAnotacoes(semanaAtual, estudoId, anotacoes);
            alert('Anotações enviadas para a nuvem.');
          } else if (activeSyncTab === 'baixar') {
            const anotacoes = await window.SupabaseSync.carregarSentinelaAnotacoes(semanaAtual, estudoId);
            if (anotacoes) {
              Object.entries(anotacoes).forEach(([k, v]) => localStorage.setItem(k, v));
              alert('Anotações baixadas com sucesso. A página será recarregada.');
              location.reload();
            } else {
              alert('Nenhuma anotação encontrada na nuvem para este artigo.');
            }
          }
        } catch (e) {
          alert('Erro de comunicação com a nuvem.');
        }
      };

      if (activeSyncTab === 'apagar') {
        const res = await showCustomAlert({ title: "Apagar da nuvem?", text: "Isso removerá apenas as notas deste artigo do servidor.", left: "Cancelar", right: "Apagar", rightDanger: true, rightBold: true });
        if (res === 'right') runSync();
      } else if (activeSyncTab === 'enviar' && actionValue === 'overwrite') {
        const res = await showCustomAlert({ title: "Substituir nuvem?", text: "A cópia da nuvem será sobrescrita pela versão deste aparelho.", left: "Cancelar", right: "Substituir", rightBold: true });
        if (res === 'right') runSync();
      } else if (activeSyncTab === 'baixar' && actionValue === 'overwrite') {
        const res = await showCustomAlert({ title: "Restaurar aparelho?", text: "Suas notas locais que não estiverem na nuvem serão perdidas.", left: "Cancelar", right: "Restaurar", rightBold: true });
        if (res === 'right') runSync();
      } else {
        runSync();
      }
    });

    // --- LOGIC: Limpeza Local ---
    const deleteOverlay = document.getElementById('sentinelaDeleteOverlay');
    document.getElementById('sentinelaDeleteClose').addEventListener('click', () => deleteOverlay.classList.remove('is-open'));
    document.getElementById('sentinelaDeleteCancel').addEventListener('click', () => deleteOverlay.classList.remove('is-open'));

    btnLimparCache.addEventListener('click', () => {
      deleteOverlay.classList.add('is-open');
    });

    document.getElementById('sentinelaDeleteRun').addEventListener('click', async () => {
      deleteOverlay.classList.remove('is-open');
      const opt = document.querySelector('input[name="local-delete-opt"]:checked').value;

      let msg = "";
      if (opt === 'day') {
        msg = "Apagar as anotações APENAS deste artigo da Sentinela?";
      } else if (opt === 'all-notes') {
        msg = "Apagar TODAS as anotações de todos os artigos locais da Sentinela?";
      } else if (opt === 'nuclear') {
        msg = "ALERTA MÁXIMO!\nIsso vai deslogar sua conta e formatar o cache interno de todo o aplicativo. Tem certeza?";
      }

      setTimeout(() => {
        if (window.confirm(msg)) {
          if (opt === 'day') {
            Object.keys(localStorage).forEach(key => {
              if (isSentinelaKey(key) && (key.includes(semanaAtual) || key.includes(estudoId))) {
                localStorage.removeItem(key);
              }
            });
            location.reload();
          } else if (opt === 'all-notes') {
            Object.keys(localStorage).forEach(key => {
              if (isSentinelaKey(key)) localStorage.removeItem(key);
            });
            location.reload();
          } else if (opt === 'nuclear') {
            localStorage.clear();
            sessionStorage.clear();
            window.dispatchEvent(new Event('supabaseLogout'));
            location.reload();
          }
        }
      }, 100);
    });

    // --- LÓGICA DE UI E PREFERÊNCIAS ---
    function toggleExpandable(targetBtn, targetArea, otherBtn, otherArea) {
      const isHidden = targetArea.hidden;
      if (!otherArea.hidden) {
          otherArea.hidden = true;
          otherBtn.classList.remove('is-active');
          otherBtn.setAttribute('aria-expanded', 'false');
      }
      targetArea.hidden = !isHidden;
      targetBtn.classList.toggle('is-active', isHidden);
      targetBtn.setAttribute('aria-expanded', isHidden ? 'true' : 'false');
    }

    if (btnTemaToggle && themeOptionsArea) {
      btnTemaToggle.addEventListener('click', () => toggleExpandable(btnTemaToggle, themeOptionsArea, btnFonteToggle, fontOptionsArea));
    }

    if (btnFonteToggle && fontOptionsArea) {
      btnFonteToggle.addEventListener('click', () => toggleExpandable(btnFonteToggle, fontOptionsArea, btnTemaToggle, themeOptionsArea));
    }

    if (btnPerfToggle) {
      btnPerfToggle.addEventListener('click', () => {
          const isLow = isPerfLowMode();
          const nextMode = isLow ? 'normal' : 'low';
          localStorage.setItem('editor-performance-mode', nextMode);
          document.documentElement.dataset.performanceMode = nextMode;
          document.documentElement.classList.toggle('perf-low', nextMode === 'low');
          document.documentElement.classList.toggle('perf-normal', nextMode !== 'low');
          updatePerfIcon();
      });
    }

    function updatePerfIcon() {
      if (!btnPerfToggle) return;
      const isLow = isPerfLowMode();
      const iconTarget = btnPerfToggle.querySelector('.action-card__icon');
      const labelTarget = btnPerfToggle.querySelector('.action-card__label');
      if (!iconTarget) return;

      if (isLow) {
          btnPerfToggle.classList.add('is-low');
          btnPerfToggle.classList.remove('is-normal');
          iconTarget.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="16" height="10" rx="2" ry="2"></rect><line x1="22" y1="11" x2="22" y2="13"></line><rect x="4" y="9" width="3" height="6" rx="1" fill="currentColor" stroke="none"></rect></svg>`;
          if (labelTarget) labelTarget.textContent = 'Modo Low';
      } else {
          btnPerfToggle.classList.add('is-normal');
          btnPerfToggle.classList.remove('is-low');
          iconTarget.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="16" height="10" rx="2" ry="2"></rect><line x1="22" y1="11" x2="22" y2="13"></line><rect x="4" y="9" width="12" height="6" rx="1" fill="currentColor" stroke="none"></rect></svg>`;
          if (labelTarget) labelTarget.textContent = 'Desempenho';
      }
    }

    function updateThemeIcon(isDark) {
      if (!btnTemaToggle) return;
      const iconTarget = btnTemaToggle.querySelector('.action-card__icon');
      if (iconTarget) {
          iconTarget.innerHTML = isDark ? 
            `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4.75"></circle><line x1="12" y1="1.75" x2="12" y2="4"></line><line x1="12" y1="20" x2="12" y2="22.25"></line><line x1="4.22" y1="4.22" x2="5.82" y2="5.82"></line><line x1="18.18" y1="18.18" x2="19.78" y2="19.78"></line><line x1="1.75" y1="12" x2="4" y2="12"></line><line x1="20" y1="12" x2="22.25" y2="12"></line><line x1="4.22" y1="19.78" x2="5.82" y2="18.18"></line><line x1="18.18" y1="5.82" x2="19.78" y2="4.22"></line></svg>` : 
            `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 13.2A8.5 8.5 0 1 1 10.8 3.5a6.7 6.7 0 0 0 9.7 9.7Z"></path></svg>`;
      }
    }

    const prefersDarkMedia = window.matchMedia('(prefers-color-scheme: dark)');

    function applyThemeToDOM(themeVal) {
      const isDark = themeVal === 'dark' || (themeVal === 'system' && prefersDarkMedia.matches);
      document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
      document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
      document.documentElement.dataset.themeChoice = themeVal;
      updateThemeIcon(isDark);
    }

    function initTheme() {
      const savedTheme = localStorage.getItem('tema-interface') || 'system';
      const radio = document.querySelector(`input[name="tema"][value="${savedTheme}"]`);
      if (radio) radio.checked = true;
      applyThemeToDOM(savedTheme);
    }

    prefersDarkMedia.addEventListener('change', () => {
      if ((localStorage.getItem('tema-interface') || 'system') === 'system') applyThemeToDOM('system');
    });

    themeRadios.forEach((radio) => {
      radio.addEventListener('change', (e) => {
          localStorage.setItem('tema-interface', e.target.value);
          applyThemeToDOM(e.target.value);
      });
    });

    function nivelDoTamanho(tamanho) {
      if (window.GlobalFontScale?.levelForSize) return window.GlobalFontScale.levelForSize(tamanho);
      return TAMANHOS_FONTE.reduce((nearest, size, index) =>
          Math.abs(size - tamanho) < Math.abs(TAMANHOS_FONTE[nearest] - tamanho) ? index : nearest, 0) + 1;
    }

    function atualizarRangeVisual(nivel) {
      const percentual = ((nivel - NIVEL_MIN) / (NIVEL_MAX - NIVEL_MIN)) * 100;
      rangeTamanhoFonte.value = String(nivel);
      rangeTamanhoFonte.setAttribute('aria-valuetext', `Nível ${nivel} de ${NIVEL_MAX}${nivel === NIVEL_PADRAO ? ', padrão' : ''}`);
      rangeTamanhoFonte.style.setProperty('--range-progress', `${percentual}%`);
      rangeTamanhoFonte.closest('.range-shell')?.style.setProperty('--range-progress', `${percentual}%`);
    }

    function aplicarNivelFonte(novoNivel) {
      const nivel = Math.min(NIVEL_MAX, Math.max(NIVEL_MIN, Math.round(Number(novoNivel)) || NIVEL_PADRAO));
      const tamanhoSeguro = TAMANHOS_FONTE[nivel - 1];
      if (window.GlobalFontScale?.setLevel) {
          window.GlobalFontScale.setLevel(nivel);
      } else {
          document.documentElement.style.setProperty('--tamanho-fonte', `${tamanhoSeguro}px`);
          document.documentElement.style.setProperty('--font-base-global', `${tamanhoSeguro}px`);
          document.documentElement.style.setProperty('--font-scale-global', String(tamanhoSeguro / 16));
          document.documentElement.style.setProperty('--read-size', `${tamanhoSeguro}px`);
          document.documentElement.dataset.fontSizeGlobal = String(tamanhoSeguro);
          document.documentElement.dataset.fontLevelGlobal = String(nivel);
          try { localStorage.setItem(FONTE_STORAGE_KEY, tamanhoSeguro); } catch (error) {}
      }
      atualizarRangeVisual(nivel);
    }

    if (rangeTamanhoFonte) {
      rangeTamanhoFonte.addEventListener('input', (event) => aplicarNivelFonte(event.target.value));
      ['change', 'touchend', 'pointerup', 'mouseup'].forEach((nomeEvento) => {
          rangeTamanhoFonte.addEventListener(nomeEvento, () => {
              const valorMagnetico = Math.round(parseFloat(rangeTamanhoFonte.value) || NIVEL_PADRAO);
              if (String(valorMagnetico) !== rangeTamanhoFonte.value) rangeTamanhoFonte.value = String(valorMagnetico);
              aplicarNivelFonte(valorMagnetico);
          });
      });
    }

    window.addEventListener('globalfont:changed', (event) => {
      const tamanho = event?.detail?.size;
      if (!tamanho || !rangeTamanhoFonte) return;
      atualizarRangeVisual(nivelDoTamanho(tamanho));
    });

    initTheme();
    updatePerfIcon();
    const tamanhoFonteSalvo = window.GlobalFontScale?.getSize() || FONTE_PADRAO;
    if (rangeTamanhoFonte) {
      atualizarRangeVisual(nivelDoTamanho(tamanhoFonteSalvo));
    }
});
