document.addEventListener("DOMContentLoaded", () => {
    const menuContainer = document.getElementById('menu-container');
    const diaElemento = document.querySelector('.dia');

    if (!menuContainer || !diaElemento) return;

    const fonteStorageKey = 'tamanho-fonte-global';
    const FONTE_PADRAO = 3;
    const FONTE_MIN = 1;
    const FONTE_MAX = 11;
    const GLOW_CINZA = 'rgba(180,180,185,0.15)';
    const DEFAULT_DAY_COLORS = { sex: '#4f73c3', sab: '#c63d3d', dom: '#7b4bb3' };
    const DAY_NAMES = { sex: 'Sexta-feira', sab: 'Sábado', dom: 'Domingo' };

    function isPerfLowMode() {
        return document.documentElement.classList.contains('perf-low');
    }

    function systemProgramDay() {
        const hoje = new Date().getDay();
        if (hoje === 6) return 'sab';
        if (hoje === 0) return 'dom';
        return 'sex';
    }

    function getHashDay() {
        const raw = (location.hash || '').replace('#', '').trim().toLowerCase();
        return ['sex', 'sab', 'dom'].includes(raw) ? raw : null;
    }

    function getActiveDay() {
        return getHashDay() || systemProgramDay();
    }

    function getColorStorageKey(day) {
        return `cor-${day}`;
    }

    function getDefaultColor(day) {
        return DEFAULT_DAY_COLORS[day] || DEFAULT_DAY_COLORS.sex;
    }

    function getSavedColor(day) {
        return localStorage.getItem(getColorStorageKey(day)) || getDefaultColor(day);
    }

    function getStaticActionIcon(name) {
        switch (name) {
            case 'font': return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="4 7 4 4 20 4 20 7"></polyline><line x1="9" y1="20" x2="15" y2="20"></line><line x1="12" y1="4" x2="12" y2="20"></line></svg>`;
            case 'cloud': return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 18a4 4 0 1 1 .5-7.97A5.5 5.5 0 0 1 18 11a3.5 3.5 0 1 1 0 7H7Z"></path><path d="M12 10v7"></path><path d="m9.5 14.5 2.5 2.5 2.5-2.5"></path></svg>`;
            case 'pdf': return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"></path><path d="M14 3v5h5"></path><path d="M8.5 15h2"></path><path d="M8.5 12h5"></path><path d="M8.5 18h7"></path></svg>`;
            case 'trash': return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"></path><path d="M8 6V4.8A1.8 1.8 0 0 1 9.8 3h4.4A1.8 1.8 0 0 1 16 4.8V6"></path><path d="M6 6l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"></path><path d="M10 10.5v5.5"></path><path d="M14 10.5v5.5"></path></svg>`;
            default: return '';
        }
    }

    function applyColorForDay(day) {
        const color = getSavedColor(day);
        document.documentElement.dataset.programDay = day;
        document.documentElement.style.setProperty('--cor-global', color);
        if (corPicker) corPicker.value = color;
        if (menuVisivel) aplicarGlowDaCorGlobal();
        else resetarGlowPadrao();
        updateDynamicDayTexts(day);
    }

    function updateDynamicDayTexts(day) {
        const dayName = DAY_NAMES[day] || 'Hoje';
        const labelUploadDay = document.getElementById('label-upload-day');
        const labelDeleteDay = document.getElementById('label-delete-day');
        const labelLocalDeleteDay = document.getElementById('label-local-delete-day');
        
        if (labelUploadDay) labelUploadDay.textContent = `Salvar apenas o dia de hoje (${dayName})`;
        if (labelDeleteDay) labelDeleteDay.textContent = `Apagar apenas ${dayName}`;
        if (labelLocalDeleteDay) labelLocalDeleteDay.textContent = `Apagar anotações de hoje (${dayName})`;
    }

    document.documentElement.style.setProperty('--cor-glow', GLOW_CINZA);

    menuContainer.innerHTML = `
      <div id="controles" style="display: none;">
        <div class="controle-grupo controle-grupo-ajustes">
          <div class="linha-top linha-top-ajustes">
            <div class="cor-bloco">
              <label for="cor-picker">Cor do Dia</label>
              <div class="controle-acoes">
                <input type="color" id="cor-picker" title="Escolha a cor de destaque do dia">
              </div>
            </div>
          </div>
        </div>
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
            <button id="btn-exportar-pdf" class="action-card action-card--pdf" type="button">
              <span class="action-card__icon">${getStaticActionIcon('pdf')}</span>
              <span class="action-card__label">Exportar</span>
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
                <input type="range" id="range-tamanho-fonte" min="1" max="11" step="1" value="3" aria-label="Tamanho do texto de leitura">
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

    document.body.insertAdjacentHTML('beforeend', `
      <!-- Action Sheet de Sincronização (NUVEM) -->
      <div class="sync-sheet-overlay" id="asmbSyncOverlay" aria-hidden="true">
        <div class="sync-sheet" role="dialog" aria-modal="true">
          <div class="sync-sheet__handle"></div>
          <div class="sync-sheet__inner">
            <div class="sync-sheet__topbar">
              <div class="sync-sheet__title">Nuvem do Congresso</div>
              <button type="button" class="sync-sheet__close" id="asmbSyncClose">×</button>
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
                      <span class="sync-choice__desc">Junta as anotações deste aparelho com as da nuvem. Nada é perdido.</span>
                    </span>
                  </label>
                  <label class="sync-choice">
                    <input type="radio" name="sync-enviar" value="day">
                    <span class="sync-choice__body">
                      <span class="sync-choice__title" id="label-upload-day">Salvar apenas o dia de hoje</span>
                      <span class="sync-choice__desc">Atualiza a nuvem só com as anotações do dia atual. O resto fica intacto.</span>
                    </span>
                  </label>
                  <label class="sync-choice">
                    <input type="radio" name="sync-enviar" value="overwrite">
                    <span class="sync-choice__body">
                      <span class="sync-choice__title">Cópia exata (Substituir nuvem)</span>
                      <span class="sync-choice__desc">Apaga o que está na nuvem e guarda exatamente como este aparelho está agora.</span>
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
                      <span class="sync-choice__title">Baixar e misturar</span>
                      <span class="sync-choice__desc">Traz da nuvem e soma com o que você já fez hoje. Nenhuma nota local é apagada.</span>
                    </span>
                  </label>
                  <label class="sync-choice">
                    <input type="radio" name="sync-baixar" value="overwrite">
                    <span class="sync-choice__body">
                      <span class="sync-choice__title">Restaurar aparelho (Substituir)</span>
                      <span class="sync-choice__desc">Apaga as anotações deste aparelho e deixa ele idêntico ao que está salvo na nuvem.</span>
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
                      <span class="sync-choice__title" id="label-delete-day">Apagar dia atual</span>
                      <span class="sync-choice__desc">Remove apenas as anotações deste dia da nuvem. O resto continua a salvo.</span>
                    </span>
                  </label>
                  <label class="sync-choice sync-choice--danger">
                    <input type="radio" name="sync-apagar" value="all">
                    <span class="sync-choice__body">
                      <span class="sync-choice__title">Apagar todo o Congresso</span>
                      <span class="sync-choice__desc">Esvazia completamente a nuvem. (Suas notas no aparelho não serão afetadas).</span>
                    </span>
                  </label>
                </div>
              </div>
            </section>

            <div class="sync-sheet__actions">
              <button type="button" class="sync-sheet__secondary" id="asmbSyncCancel">Cancelar</button>
              <button type="button" class="sync-sheet__primary" id="asmbSyncRun">Avançar</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Action Sheet de Limpeza Local -->
      <div class="sync-sheet-overlay" id="asmbDeleteOverlay" aria-hidden="true">
        <div class="sync-sheet" role="dialog" aria-modal="true">
          <div class="sync-sheet__handle"></div>
          <div class="sync-sheet__inner">
            <div class="sync-sheet__topbar">
              <div class="sync-sheet__title">Limpeza Local</div>
              <button type="button" class="sync-sheet__close" id="asmbDeleteClose">×</button>
            </div>

            <div class="sync-card">
              <div class="sync-options">
                <label class="sync-choice sync-choice--danger">
                  <input type="radio" name="local-delete-opt" value="day" checked>
                  <span class="sync-choice__body">
                    <span class="sync-choice__title" id="label-local-delete-day">Apagar anotações de hoje</span>
                    <span class="sync-choice__desc">Remove apenas o que você escreveu no dia selecionado.</span>
                  </span>
                </label>
                <label class="sync-choice sync-choice--danger">
                  <input type="radio" name="local-delete-opt" value="all-notes">
                  <span class="sync-choice__body">
                    <span class="sync-choice__title">Apagar todo o Congresso</span>
                    <span class="sync-choice__desc">Esvazia o caderno de todos os dias do Congresso neste aparelho.</span>
                  </span>
                </label>
                <label class="sync-choice sync-choice--danger">
                  <input type="radio" name="local-delete-opt" value="reset">
                  <span class="sync-choice__body">
                    <span class="sync-choice__title">Restaurar Padrões do Congresso</span>
                    <span class="sync-choice__desc">Apaga as anotações e reseta tamanho de fonte, cores e tema ao original.</span>
                  </span>
                </label>
                <label class="sync-choice sync-choice--danger">
                  <input type="radio" name="local-delete-opt" value="nuclear">
                  <span class="sync-choice__body">
                    <span class="sync-choice__title">Apagar dados deste aplicativo</span>
                    <span class="sync-choice__desc">Sai da conta e remove os dados e downloads deste aplicativo.</span>
                  </span>
                </label>
              </div>
            </div>

            <div class="sync-sheet__actions">
              <button type="button" class="sync-sheet__secondary" id="asmbDeleteCancel">Cancelar</button>
              <button type="button" class="sync-sheet__primary is-danger" id="asmbDeleteRun">Apagar Dados</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Custom iOS Alert Modal (Somente para Nuvem) -->
      <div class="sync-alert-overlay" id="asmbAlertOverlay" aria-hidden="true">
        <div class="sync-alert" role="alertdialog">
          <div class="sync-alert__content">
            <h3 class="sync-alert__title" id="asmbAlertTitle"></h3>
            <p class="sync-alert__text" id="asmbAlertText"></p>
          </div>
          <div class="sync-alert__actions">
            <button class="sync-alert__btn" id="asmbAlertBtnLeft"></button>
            <button class="sync-alert__btn sync-alert__btn--right" id="asmbAlertBtnRight"></button>
          </div>
        </div>
      </div>

      <div class="sync-alert-overlay" id="asmbPwOverlay" aria-hidden="true">
        <div class="sync-alert" role="alertdialog">
          <div class="sync-alert__content">
            <h3 class="sync-alert__title">Digite a senha de permissão</h3>
            <p class="sync-alert__text">Esta ação precisa de autorização.</p>
            <input type="password" id="asmbPwInput" inputmode="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" style="width:100%;box-sizing:border-box;margin-top:14px;padding:12px 14px;border:2px solid var(--border-input,#e5e7eb);border-radius:12px;font-size:16px;background:var(--bg-input,#fafafa);color:var(--text-input,#1a1a1a);text-align:center;letter-spacing:2px;">
            <p id="asmbPwError" style="display:none;color:var(--cor-erro,#ef4444);font-size:12px;margin:8px 0 0;">Senha incorreta.</p>
          </div>
          <div class="sync-alert__actions">
            <button class="sync-alert__btn" id="asmbPwCancel">Cancelar</button>
            <button class="sync-alert__btn sync-alert__btn--right is-bold" id="asmbPwOk">Confirmar</button>
          </div>
        </div>
      </div>
    `);

    const menuControles = document.getElementById('controles');
    const corPicker = document.getElementById('cor-picker');
    const rangeTamanhoFonte = document.getElementById('range-tamanho-fonte');
    const btnLimparCache = document.getElementById('btn-limpar-cache');
    const btnAbrirSync = document.getElementById('btn-abrir-sync');
    const btnExportarPdf = document.getElementById('btn-exportar-pdf');
    const themeRadios = document.querySelectorAll('input[name="tema"]');
    const btnTemaToggle = document.getElementById('btn-tema-toggle');
    const btnFonteToggle = document.getElementById('btn-fonte-toggle');
    const btnPerfToggle = document.getElementById('btn-perf-toggle');
    const themeOptionsArea = document.getElementById('theme-options-area');
    const fontOptionsArea = document.getElementById('font-options-area');

    let menuVisivel = false;

    function showCustomAlert({ title, text, left, right, leftDanger, rightDanger, leftBold, rightBold }) {
      return new Promise((resolve) => {
        const overlay = document.getElementById('asmbAlertOverlay');
        const titleEl = document.getElementById('asmbAlertTitle');
        const textEl = document.getElementById('asmbAlertText');
        const btnLeft = document.getElementById('asmbAlertBtnLeft');
        const btnRight = document.getElementById('asmbAlertBtnRight');

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

    function pedirSenha() {
      return new Promise((resolve) => {
        const overlay = document.getElementById('asmbPwOverlay');
        const input = document.getElementById('asmbPwInput');
        const erro = document.getElementById('asmbPwError');
        const btnOk = document.getElementById('asmbPwOk');
        const btnCancel = document.getElementById('asmbPwCancel');

        input.value = '';
        erro.style.display = 'none';

        const cleanup = () => {
          overlay.classList.remove('is-open');
          btnOk.removeEventListener('click', onOk);
          btnCancel.removeEventListener('click', onCancel);
          input.removeEventListener('keydown', onKey);
        };
        const onOk = () => {
          if (input.value === 'Noj') {
            cleanup();
            resolve(true);
          } else {
            erro.style.display = 'block';
            input.value = '';
            input.focus();
          }
        };
        const onCancel = () => { cleanup(); resolve(false); };
        const onKey = (e) => { if (e.key === 'Enter') onOk(); };

        btnOk.addEventListener('click', onOk);
        btnCancel.addEventListener('click', onCancel);
        input.addEventListener('keydown', onKey);

        overlay.classList.add('is-open');
        setTimeout(() => input.focus(), 100);
      });
    }

    const syncOverlay = document.getElementById('asmbSyncOverlay');
    const syncTabs = document.querySelectorAll('[data-sync-tab]');
    const syncPanels = document.querySelectorAll('[data-sync-panel]');
    let activeSyncTab = 'enviar';

    function setSyncTab(tab) {
      activeSyncTab = tab;
      syncTabs.forEach(btn => btn.classList.toggle('is-active', btn.dataset.syncTab === tab));
      syncPanels.forEach(panel => panel.hidden = panel.dataset.syncPanel !== tab);
      const runBtn = document.getElementById('asmbSyncRun');
      if (tab === 'apagar') {
        runBtn.textContent = 'Apagar Dados';
        runBtn.classList.add('is-danger');
      } else {
        runBtn.textContent = 'Avançar';
        runBtn.classList.remove('is-danger');
      }
    }

    syncTabs.forEach(btn => btn.addEventListener('click', () => setSyncTab(btn.dataset.syncTab)));
    
    document.getElementById('asmbSyncClose').addEventListener('click', () => syncOverlay.classList.remove('is-open'));
    document.getElementById('asmbSyncCancel').addEventListener('click', () => syncOverlay.classList.remove('is-open'));
    
    btnAbrirSync.addEventListener('click', () => {
      const isLoggedIn = !!localStorage.getItem('supabase_user');
      if (!isLoggedIn) {
        alert("Você precisa fazer login em 'Salvar' antes de usar a Nuvem.");
        return;
      }
      setSyncTab('enviar');
      updateDynamicDayTexts(getActiveDay());
      syncOverlay.classList.add('is-open');
    });

    document.getElementById('asmbSyncRun').addEventListener('click', async () => {
      syncOverlay.classList.remove('is-open');
      const actionValue = document.querySelector(`input[name="sync-${activeSyncTab}"]:checked`).value;
      const day = getActiveDay();

      if (activeSyncTab === 'apagar') {
        const res1 = await showCustomAlert({
          title: "Apagar anotações?",
          text: "Tem certeza que deseja remover os dados da nuvem?",
          left: "Não", right: "Sim", rightBold: true
        });

        if (res1 === 'right') {
          setTimeout(async () => {
            const res2 = await showCustomAlert({
              title: "Último aviso!",
              text: "Esta ação não pode ser desfeita. Tem certeza MESMO?",
              left: "Apagar", leftDanger: true, leftBold: true,
              right: "Não", rightBold: true
            });

            if (res2 === 'left') {
              executeSyncCall('apagar', actionValue, day);
            }
          }, 300);
        }
      } else if (activeSyncTab === 'enviar' && actionValue === 'overwrite') {
        const res = await showCustomAlert({
          title: "Tem certeza?",
          text: "Isso vai apagar a nuvem atual e enviar a cópia exata deste aparelho.",
          left: "Cancelar", right: "Continuar", rightBold: true
        });
        if (res === 'right') executeSyncCall('enviar', actionValue, day);
      } else if (activeSyncTab === 'baixar' && actionValue === 'overwrite') {
        const res = await showCustomAlert({
          title: "Tem certeza?",
          text: "Suas notas atuais não salvas serão apagadas e substituídas pelas da nuvem.",
          left: "Cancelar", right: "Continuar", rightBold: true
        });
        if (res === 'right') executeSyncCall('baixar', actionValue, day);
      } else {
        executeSyncCall(activeSyncTab, actionValue, day);
      }
    });

    async function executeSyncCall(tab, option, day) {
       const year = document.documentElement.dataset.programYear || '2026';
       const sync = window.assembleiaSync;

       const autorizado = await pedirSenha();
       if (!autorizado) return;

       if (tab === 'apagar') {
         if (!window.SupabaseSync || typeof window.SupabaseSync.apagarAssembleiaCompleto !== 'function') {
           alert('Nuvem indisponível no momento. Tente novamente.');
           return;
         }
         let result;
         if (option === 'all') {
           result = await window.SupabaseSync.apagarAssembleiaCompleto(year);
         } else {
           result = await window.SupabaseSync.apagarAssembleiaDia(year, day);
         }
         if (result && result.success) {
           apagarLocalAssembleia(year, option === 'all' ? null : day);
           if (sync) sync.lastSavedDataJSON = '{}';
           if (window.AssembleiaClickables && typeof window.AssembleiaClickables.refresh === 'function') {
             window.AssembleiaClickables.refresh();
             alert('Anotações apagadas da nuvem e do aparelho.');
           } else {
             alert('Anotações apagadas. Atualizando a tela...');
             location.reload();
           }
         } else {
           alert('Não foi possível apagar: ' + ((result && result.error) || 'erro desconhecido'));
         }
         return;
       }

       if (!sync) {
         alert('Sincronização indisponível no momento. Tente novamente em instantes.');
         return;
       }
       if (!localStorage.getItem('supabase_user')) {
         alert('Você precisa estar logado para usar a nuvem do congresso.');
         return;
       }
       if (!navigator.onLine) {
         alert('Você precisa de internet para sincronizar.');
         return;
       }

       let result;
       try {
         if (tab === 'enviar') {
           if (option === 'overwrite') result = await sync.pushOverwrite();
           else if (option === 'day') result = await sync.pushDay(day);
           else result = await sync.pushMerge();
         } else if (tab === 'baixar') {
           if (option === 'overwrite') {
             result = await sync.pullOverwrite();
             if (result && result.success) {
               alert('Conteúdo baixado da nuvem. Atualizando a tela...');
               location.reload();
               return;
             }
           } else {
             result = await sync.loadFromSupabase(true);
           }
         }
       } catch (e) {
         result = { success: false, error: e.message };
       }

       if (result && result.success) {
         alert(tab === 'enviar' ? 'Anotações enviadas para a nuvem com sucesso.' : 'Anotações baixadas da nuvem com sucesso.');
       } else {
         alert('Não foi possível concluir: ' + ((result && result.error) || 'erro desconhecido'));
       }
    }

    function apagarLocalAssembleia(year, dia) {
       const prefixo = dia ? `${year}-${dia}-` : `${year}-`;
       const remover = [];
       for (let i = 0; i < localStorage.length; i++) {
         const key = localStorage.key(i);
         if (key && key.startsWith(prefixo)) remover.push(key);
       }
       for (const k of remover) localStorage.removeItem(k);
    }

    // LÓGICA DE LIMPEZA LOCAL (TRASH)
    const deleteOverlay = document.getElementById('asmbDeleteOverlay');
    
    document.getElementById('asmbDeleteClose').addEventListener('click', () => deleteOverlay.classList.remove('is-open'));
    document.getElementById('asmbDeleteCancel').addEventListener('click', () => deleteOverlay.classList.remove('is-open'));

    btnLimparCache.addEventListener('click', () => {
      updateDynamicDayTexts(getActiveDay());
      deleteOverlay.classList.add('is-open');
    });

    document.getElementById('asmbDeleteRun').addEventListener('click', async () => {
      deleteOverlay.classList.remove('is-open');
      const opt = document.querySelector('input[name="local-delete-opt"]:checked').value;
      const day = getActiveDay();
      const year = document.documentElement.dataset.programYear || '2026';
      
      let msg = "";
      if (opt === 'day') {
        msg = `Apagar todas as anotações feitas hoje (${DAY_NAMES[day]})?\n\nIsso não afetará os outros dias do congresso.`;
      } else if (opt === 'all-notes') {
        msg = "Apagar todas as anotações do Congresso?\n\nSuas configurações visuais serão mantidas.";
      } else if (opt === 'reset') {
        msg = "Restaurar Padrões do Congresso?\n\nIsso apagará todas as anotações e resetará fontes, cores e temas.\n(A Sentinela não será afetada).";
      } else if (opt === 'nuclear') {
        msg = "Apagar todos os dados deste aplicativo?\n\nIsso remove suas anotações e downloads da Assembleia neste aparelho e sai da conta.";
      }

      // Alerta Nativo do Sistema para Limpeza Local
      setTimeout(() => {
        if (window.confirm(msg)) {
          executarLimpezaLocal(opt, day, year);
        }
      }, 100);
    });

    async function executarLimpezaLocal(opt, day, year) {
      if (opt === 'day') {
        const prefix = `${year}-${day}-`;
        Object.keys(localStorage).forEach(key => {
          if (key.startsWith(prefix)) localStorage.removeItem(key);
        });
        location.reload();
      } 
      else if (opt === 'all-notes') {
        const prefixes = [`${year}-sex-`, `${year}-sab-`, `${year}-dom-`];
        Object.keys(localStorage).forEach(key => {
          if (prefixes.some(p => key.startsWith(p))) localStorage.removeItem(key);
        });
        sessionStorage.removeItem(`asmb_loaded_${year}`);
        location.reload();
      }
      else if (opt === 'reset') {
        const prefixes = [`${year}-sex-`, `${year}-sab-`, `${year}-dom-`];
        const settings = ['tamanho-fonte-global', 'tema-interface', 'editor-performance-mode', 'cor-sex', 'cor-sab', 'cor-dom'];
        Object.keys(localStorage).forEach(key => {
          if (prefixes.some(p => key.startsWith(p)) || settings.includes(key) || key.startsWith('asmb-')) {
            localStorage.removeItem(key);
          }
        });
        sessionStorage.removeItem(`asmb_loaded_${year}`);
        location.reload();
      }
      else if (opt === 'nuclear') {
        localStorage.clear();
        sessionStorage.clear();
        
        try {
          // Only this app's named stores/caches may be removed on a shared origin.
          if (window.indexedDB?.databases) {
            const databases = await indexedDB.databases();
            await Promise.all(databases.map(db => new Promise(resolve => {
              const request = indexedDB.deleteDatabase(db.name);
              request.onsuccess = request.onerror = request.onblocked = resolve;
            })));
          }
          if ('caches' in window) {
            const names = await caches.keys();
            await Promise.all(names.filter(name => name.startsWith('assembleia-2026-')).map(name => caches.delete(name)));
          }
        } catch (e) {}

        window.dispatchEvent(new Event('supabaseLogout'));
        location.reload();
      }
    }


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
            window.__EDITOR_PERF_BOOT__ = nextMode;
            document.documentElement.dataset.performanceMode = nextMode;
            document.documentElement.classList.toggle('perf-low', nextMode === 'low');
            document.documentElement.classList.toggle('perf-normal', nextMode !== 'low');
            if (document.body) {
                document.body.classList.toggle('perf-low', nextMode === 'low');
                document.body.classList.toggle('perf-normal', nextMode !== 'low');
            }
            if (window.EditorPerfProfile?.setMode) {
                window.EditorPerfProfile.setMode(nextMode, { reload: false });
            }
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

    function aplicarGlowDaCorGlobal() {
        const corGlobal = getComputedStyle(document.documentElement).getPropertyValue('--cor-global').trim();
        let glow = GLOW_CINZA;
        if (corGlobal.startsWith('#')) {
            const bigint = parseInt(corGlobal.slice(1), 16);
            glow = `rgba(${(bigint >> 16) & 255},${(bigint >> 8) & 255},${bigint & 255},0.18)`;
        } else if (corGlobal.startsWith('rgb')) {
            const [r, g, b] = corGlobal.replace(/[^\d,]/g, '').split(',').map((n) => n.trim());
            glow = `rgba(${r},${g},${b},0.18)`;
        }
        document.documentElement.style.setProperty('--cor-glow', glow);
    }

    function resetarGlowPadrao() {
        document.documentElement.style.setProperty('--cor-glow', GLOW_CINZA);
    }

    const prefersDarkMedia = window.matchMedia('(prefers-color-scheme: dark)');

    function applyThemeToDOM(themeVal) {
        const isDark = themeVal === 'dark' || (themeVal === 'system' && prefersDarkMedia.matches);
        document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
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

    function atualizarRangeVisual(valorAtual) {
        const percentual = ((valorAtual - FONTE_MIN) / (FONTE_MAX - FONTE_MIN)) * 100;
        rangeTamanhoFonte.style.setProperty('--range-progress', `${percentual}%`);
        rangeTamanhoFonte.closest('.range-shell')?.style.setProperty('--range-progress', `${percentual}%`);
    }

    function aplicarTamanhoFonte(novoNivel) {
        const nivel = Math.min(FONTE_MAX, Math.max(FONTE_MIN, Number(novoNivel) || FONTE_PADRAO));
        window.GlobalFontScale?.setLevel(nivel);
        rangeTamanhoFonte.value = String(nivel);
        rangeTamanhoFonte.setAttribute('aria-valuetext', `Nível ${nivel} de ${FONTE_MAX}`);
        atualizarRangeVisual(nivel);
    }

    function carregarPreferencias() {
        applyColorForDay(getActiveDay());
        initTheme();
        updatePerfIcon();
        const nivel = window.GlobalFontScale?.getLevel() || FONTE_PADRAO;
        if (rangeTamanhoFonte) {
            rangeTamanhoFonte.value = String(nivel);
            rangeTamanhoFonte.setAttribute('aria-valuetext', `Nível ${nivel} de ${FONTE_MAX}`);
            atualizarRangeVisual(nivel);
        }
    }

    function toggleMenu() {
        menuVisivel = !menuVisivel;
        menuControles.style.display = menuVisivel ? 'block' : 'none';
        if (menuVisivel) aplicarGlowDaCorGlobal();
        else resetarGlowPadrao();
    }

    diaElemento.addEventListener('click', toggleMenu);
    
    if (corPicker) {
        corPicker.addEventListener('input', (e) => {
            const novaCor = e.target.value;
            document.documentElement.style.setProperty('--cor-global', novaCor);
            localStorage.setItem(getColorStorageKey(getActiveDay()), novaCor);
            if (menuVisivel) aplicarGlowDaCorGlobal();
        });
    }

    if (rangeTamanhoFonte) {
        rangeTamanhoFonte.addEventListener('input', (event) => aplicarTamanhoFonte(event.target.value));
        ['change', 'touchend', 'pointerup', 'mouseup'].forEach((nomeEvento) => {
            rangeTamanhoFonte.addEventListener(nomeEvento, () => {
                const valorMagnetico = Math.round(parseFloat(rangeTamanhoFonte.value) || FONTE_PADRAO);
                if (String(valorMagnetico) !== rangeTamanhoFonte.value) rangeTamanhoFonte.value = String(valorMagnetico);
                aplicarTamanhoFonte(valorMagnetico);
            });
        });
    }

    window.addEventListener('globalfont:changed', (event) => {
        const tamanho = event?.detail?.level;
        if (!tamanho || !rangeTamanhoFonte) return;
        rangeTamanhoFonte.value = String(tamanho);
        atualizarRangeVisual(tamanho);
    });

    if (btnExportarPdf) {
        btnExportarPdf.addEventListener('click', () => {
            document.dispatchEvent(new CustomEvent('assembleia-export:open'));
        });
    }

    window.addEventListener('programacao:daychange', (event) => {
        const dia = event?.detail?.dia;
        if (dia) applyColorForDay(dia);
    });

    carregarPreferencias();
});