document.addEventListener("DOMContentLoaded", () => {
    const menuContainer = document.getElementById('menu-container');
    const diaElemento = document.querySelector('.dia');

    if (!menuContainer || !diaElemento) return;

    const fonteStorageKey = 'tamanho-fonte-global';
    const FONTE_PADRAO = 16;
    const FONTE_MIN = FONTE_PADRAO;
    const FONTE_MAX = FONTE_PADRAO + 10;
    const GLOW_CINZA = 'rgba(180,180,185,0.15)';
    const DEFAULT_DAY_COLORS = { sex: '#4f73c3', sab: '#c63d3d', dom: '#7b4bb3' };

    // --- CORREÇÃO: Função independente para ler o Modo de Desempenho ---
    function isPerfLowMode() {
        if (window.EditorPerfProfile?.isLow) return window.EditorPerfProfile.isLow();
        const stored = localStorage.getItem('editor-performance-mode');
        if (stored) return stored === 'low';
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

    function setActionLabel(button, label) {
        const target = button?.querySelector('.action-card__label');
        if (target) target.textContent = label;
    }

    function getStaticActionIcon(name) {
        switch (name) {
            case 'font':
                return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="4 7 4 4 20 4 20 7"></polyline><line x1="9" y1="20" x2="15" y2="20"></line><line x1="12" y1="4" x2="12" y2="20"></line></svg>`;
            case 'cloud':
                return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 18a4 4 0 1 1 .5-7.97A5.5 5.5 0 0 1 18 11a3.5 3.5 0 1 1 0 7H7Z"></path><path d="M12 10v7"></path><path d="m9.5 14.5 2.5 2.5 2.5-2.5"></path></svg>`;
            case 'pdf':
                return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"></path><path d="M14 3v5h5"></path><path d="M8.5 15h2"></path><path d="M8.5 12h5"></path><path d="M8.5 18h7"></path></svg>`;
            case 'trash':
                return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"></path><path d="M8 6V4.8A1.8 1.8 0 0 1 9.8 3h4.4A1.8 1.8 0 0 1 16 4.8V6"></path><path d="M6 6l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"></path><path d="M10 10.5v5.5"></path><path d="M14 10.5v5.5"></path></svg>`;
            default:
                return '';
        }
    }

    function applyColorForDay(day) {
        const color = getSavedColor(day);
        document.documentElement.dataset.programDay = day;
        document.documentElement.style.setProperty('--cor-global', color);
        if (corPicker) corPicker.value = color;
        if (menuVisivel) aplicarGlowDaCorGlobal();
        else resetarGlowPadrao();
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
            <button id="btn-fonte-toggle" class="action-card" type="button" title="Tamanho do Texto" aria-label="Tamanho do Texto" aria-expanded="false">
              <span class="action-card__icon">${getStaticActionIcon('font')}</span>
              <span class="action-card__label">Fonte</span>
            </button>
            <button id="btn-tema-toggle" class="action-card" type="button" title="Tema" aria-label="Tema" aria-expanded="false">
              <span class="action-card__icon"></span>
              <span class="action-card__label">Tema</span>
            </button>
            <button id="btn-exportar-pdf" class="action-card action-card--pdf" type="button" title="Exportar" aria-label="Exportar ou importar">
              <span class="action-card__icon">${getStaticActionIcon('pdf')}</span>
              <span class="action-card__label">Exportar</span>
            </button>
            <button id="btn-carregar-nuvem" class="action-card action-card--cloud" type="button" title="Carregar da nuvem" aria-label="Carregar da nuvem">
              <span class="action-card__icon">${getStaticActionIcon('cloud')}</span>
              <span class="action-card__label">Nuvem</span>
            </button>
            <button id="btn-perf-toggle" class="action-card action-card--perf" type="button" title="Desempenho" aria-label="Desempenho">
              <span class="action-card__icon"></span>
              <span class="action-card__label">Desempenho</span>
            </button>
            <button id="btn-limpar-cache" class="action-card action-card--danger" type="button" title="Apagar tudo" aria-label="Apagar preferências e anotações">
              <span class="action-card__icon">${getStaticActionIcon('trash')}</span>
              <span class="action-card__label">Apagar</span>
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
                <input type="range" id="range-tamanho-fonte" min="16" max="26" step="1" value="16" aria-label="Ajustar tamanho global do texto">
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

    const menuControles = document.getElementById('controles');
    const corPicker = document.getElementById('cor-picker');
    const rangeTamanhoFonte = document.getElementById('range-tamanho-fonte');
    const btnLimparCache = document.getElementById('btn-limpar-cache');
    const btnCarregarNuvem = document.getElementById('btn-carregar-nuvem');
    const btnExportarPdf = document.getElementById('btn-exportar-pdf');
    const themeRadios = document.querySelectorAll('input[name="tema"]');
    const btnTemaToggle = document.getElementById('btn-tema-toggle');
    const btnFonteToggle = document.getElementById('btn-fonte-toggle');
    const btnPerfToggle = document.getElementById('btn-perf-toggle');
    const themeOptionsArea = document.getElementById('theme-options-area');
    const fontOptionsArea = document.getElementById('font-options-area');

    let menuVisivel = false;

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

    // --- CORREÇÃO: Alternância manual do Modo Low com reload automático ---
    if (btnPerfToggle) {
        btnPerfToggle.addEventListener('click', () => {
            const isLow = isPerfLowMode();
            const nextMode = isLow ? 'normal' : 'low';
            
            if (window.EditorPerfProfile?.setMode) {
                window.EditorPerfProfile.setMode(nextMode);
            } else {
                localStorage.setItem('editor-performance-mode', nextMode);
                document.documentElement.dataset.performanceMode = nextMode;
                location.reload(); 
            }
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
        if (!iconTarget) return;

        if (isDark) {
            iconTarget.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4.75"></circle><line x1="12" y1="1.75" x2="12" y2="4"></line><line x1="12" y1="20" x2="12" y2="22.25"></line><line x1="4.22" y1="4.22" x2="5.82" y2="5.82"></line><line x1="18.18" y1="18.18" x2="19.78" y2="19.78"></line><line x1="1.75" y1="12" x2="4" y2="12"></line><line x1="20" y1="12" x2="22.25" y2="12"></line><line x1="4.22" y1="19.78" x2="5.82" y2="18.18"></line><line x1="18.18" y1="5.82" x2="19.78" y2="4.22"></line></svg>`;
        } else {
            iconTarget.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 13.2A8.5 8.5 0 1 1 10.8 3.5a6.7 6.7 0 0 0 9.7 9.7Z"></path></svg>`;
        }
    }

    function aplicarGlowDaCorGlobal() {
        const corGlobal = getComputedStyle(document.documentElement).getPropertyValue('--cor-global').trim();
        let glow;
        if (corGlobal.startsWith('#')) {
            const hex = corGlobal.slice(1);
            const bigint = parseInt(hex, 16);
            const r = (bigint >> 16) & 255;
            const g = (bigint >> 8) & 255;
            const b = bigint & 255;
            glow = `rgba(${r},${g},${b},0.18)`;
        } else if (corGlobal.startsWith('rgb')) {
            const [r, g, b] = corGlobal.replace(/[^\d,]/g, '').split(',').map((n) => n.trim());
            glow = `rgba(${r},${g},${b},0.18)`;
        } else {
            glow = GLOW_CINZA;
        }
        document.documentElement.style.setProperty('--cor-glow', glow);
    }

    function resetarGlowPadrao() {
        document.documentElement.style.setProperty('--cor-glow', GLOW_CINZA);
    }

    const prefersDarkMedia = window.matchMedia('(prefers-color-scheme: dark)');

    function applyThemeToDOM(themeVal) {
        let isDark = false;
        if (themeVal === 'dark') {
            isDark = true;
        } else if (themeVal === 'system' && prefersDarkMedia.matches) {
            isDark = true;
        }
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
        const currentTheme = localStorage.getItem('tema-interface') || 'system';
        if (currentTheme === 'system') {
            applyThemeToDOM('system');
        }
    });

    themeRadios.forEach((radio) => {
        radio.addEventListener('change', (e) => {
            const selectedTheme = e.target.value;
            localStorage.setItem('tema-interface', selectedTheme);
            applyThemeToDOM(selectedTheme);
        });
    });

    function carregarPreferencias() {
        applyColorForDay(getActiveDay());
        initTheme();
        updatePerfIcon();
        const tamanhoFonteSalvo = Math.min(FONTE_MAX, Math.max(FONTE_MIN, parseInt(localStorage.getItem(fonteStorageKey) || FONTE_PADRAO, 10) || FONTE_PADRAO));
        document.documentElement.style.setProperty('--tamanho-fonte', `${tamanhoFonteSalvo}px`);
        document.documentElement.style.setProperty('--font-base-global', `${tamanhoFonteSalvo}px`);
        document.documentElement.style.setProperty('--font-scale-global', String(tamanhoFonteSalvo / FONTE_PADRAO));
        if (rangeTamanhoFonte) {
            rangeTamanhoFonte.value = String(tamanhoFonteSalvo);
            atualizarRangeVisual(tamanhoFonteSalvo);
        }
    }

    function atualizarRangeVisual(valorAtual) {
        const percentual = ((valorAtual - FONTE_MIN) / (FONTE_MAX - FONTE_MIN)) * 100;
        rangeTamanhoFonte.style.setProperty('--range-progress', `${percentual}%`);
        rangeTamanhoFonte.closest('.range-shell')?.style.setProperty('--range-progress', `${percentual}%`);
    }

    function toggleMenu() {
        menuVisivel = !menuVisivel;
        menuControles.style.display = menuVisivel ? 'block' : 'none';
        if (menuVisivel) aplicarGlowDaCorGlobal();
        else resetarGlowPadrao();
    }

    function atualizarCor(event) {
        const diaAtual = getActiveDay();
        const novaCor = event.target.value;
        document.documentElement.style.setProperty('--cor-global', novaCor);
        localStorage.setItem(getColorStorageKey(diaAtual), novaCor);
        if (menuVisivel) aplicarGlowDaCorGlobal();
    }

    function aplicarTamanhoFonte(novoTamanho) {
        const tamanhoSeguro = Math.min(FONTE_MAX, Math.max(FONTE_MIN, parseInt(novoTamanho, 10) || FONTE_PADRAO));
        if (window.GlobalFontScale?.setSize) {
            window.GlobalFontScale.setSize(tamanhoSeguro);
        } else {
            document.documentElement.style.setProperty('--tamanho-fonte', `${tamanhoSeguro}px`);
            document.documentElement.style.setProperty('--font-base-global', `${tamanhoSeguro}px`);
            document.documentElement.style.setProperty('--font-scale-global', String(tamanhoSeguro / FONTE_PADRAO));
            localStorage.setItem(fonteStorageKey, tamanhoSeguro);
        }
        rangeTamanhoFonte.value = String(tamanhoSeguro);
        atualizarRangeVisual(tamanhoSeguro);
    }

    function limparPreferencias() {
        if (confirm("Isso irá apagar todas as cores, fontes, temas e ANOTAÇÕES. Deseja continuar?")) {
            Object.keys(localStorage)
                .filter((key) => key === fonteStorageKey || key === 'tema-interface' || key === 'editor-performance-mode' || /^cor-(sex|sab|dom)$/.test(key) || key.startsWith('asmb-') || /^20\d{2}-(sex|sab|dom)-/.test(key))
                .forEach((key) => localStorage.removeItem(key));
            location.reload();
        }
    }

    if (btnCarregarNuvem) {
        btnCarregarNuvem.addEventListener('click', async () => {
            setActionLabel(btnCarregarNuvem, 'Baixando...');
            btnCarregarNuvem.disabled = true;
            try {
                if (window.assembleiaSync && typeof window.assembleiaSync.loadFromSupabase === 'function') {
                    await window.assembleiaSync.loadFromSupabase(true);
                }
                setActionLabel(btnCarregarNuvem, 'Concluído');
            } catch {
                setActionLabel(btnCarregarNuvem, 'Falhou');
            }
            setTimeout(() => {
                setActionLabel(btnCarregarNuvem, 'Nuvem');
                btnCarregarNuvem.disabled = false;
            }, 1800);
        });
    }

    if (btnExportarPdf) {
        btnExportarPdf.addEventListener('click', () => {
            document.dispatchEvent(new CustomEvent('assembleia-export:open'));
        });
    }

    diaElemento.addEventListener('click', toggleMenu);
    if (corPicker) corPicker.addEventListener('input', atualizarCor);
    if (rangeTamanhoFonte) {
        rangeTamanhoFonte.addEventListener('input', (event) => aplicarTamanhoFonte(event.target.value));
        ['change', 'touchend', 'pointerup', 'mouseup'].forEach((nomeEvento) => {
            rangeTamanhoFonte.addEventListener(nomeEvento, () => {
                const valorMagnetico = Math.round(parseFloat(rangeTamanhoFonte.value) || FONTE_PADRAO);
                if (String(valorMagnetico) !== rangeTamanhoFonte.value) {
                    rangeTamanhoFonte.value = String(valorMagnetico);
                }
                aplicarTamanhoFonte(valorMagnetico);
            });
        });
    }

    window.addEventListener('globalfont:changed', (event) => {
        const tamanho = event?.detail?.size;
        if (!tamanho || !rangeTamanhoFonte) return;
        rangeTamanhoFonte.value = String(tamanho);
        atualizarRangeVisual(tamanho);
    });

    if (btnLimparCache) btnLimparCache.addEventListener('click', limparPreferencias);

    window.addEventListener('programacao:daychange', (event) => {
        const dia = event?.detail?.dia;
        if (!dia) return;
        applyColorForDay(dia);
    });

    carregarPreferencias();
});