(function () {
  const DIAS = ['sex', 'sab', 'dom'];
  const ROTULOS = {
    sex: 'Sexta-feira',
    sab: 'Sábado',
    dom: 'Domingo'
  };
  const IMG_VERSION = 'asmb-2026';
  let activeLoad = 0;
  let dayController = null;

  function diaAutomatico() {
    const hoje = new Date().getDay();
    if (hoje === 6) return 'sab';
    if (hoje === 0) return 'dom';
    return 'sex';
  }

  function diaDaHash() {
    const raw = (location.hash || '').replace('#', '').trim().toLowerCase();
    return DIAS.includes(raw) ? raw : null;
  }

  function atualizarCabecalho(dia) {
    const el = document.getElementById('programacao-dia');
    if (el) el.textContent = ROTULOS[dia] || ROTULOS.sex;
    document.documentElement.dataset.programDay = dia;
  }

  function atualizarImagemTopo(dia, requestId) {
    const slot = document.getElementById('img-topo');
    if (!slot) return;

    const src = `programacao/imagens/${dia}.jpeg?v=${IMG_VERSION}`;
    const label = ROTULOS[dia] || ROTULOS.sex;
    const img = new Image();

    img.onload = () => {
      if (requestId !== activeLoad) return;
      slot.innerHTML = '';
      img.alt = `Imagem da programação de ${label}`;
      img.decoding = 'async';
      img.loading = 'eager';
      slot.appendChild(img);
      slot.style.display = 'block';
    };

    img.onerror = () => {
      if (requestId !== activeLoad) return;
      slot.innerHTML = '';
      slot.style.display = 'none';
    };

    img.src = src;
  }

  function navButton(label, dir, enabled, target) {
    const arrow = dir === 'prev'
      ? '<span class="nav-arrow" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4 7 12l8 8"/></svg></span>'
      : '<span class="nav-arrow" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 4 8 8-8 8"/></svg></span>';
    const text = `<span class="nav-label">${label}</span>`;
    if (!enabled) {
      return `<button class="program-nav-btn is-disabled" type="button" disabled>${dir === 'prev' ? arrow + text : text + arrow}</button>`;
    }
    return `<button class="program-nav-btn" type="button" data-go-day="${target}">${dir === 'prev' ? arrow + text : text + arrow}</button>`;
  }

  function renderNav(dia) {
    const idx = DIAS.indexOf(dia);
    const ano = document.documentElement.dataset.programYear || '2026';
    const idManha = `${ano}-${dia}-assistencia-manha`;
    const idTarde = `${ano}-${dia}-assistencia-tarde`;
    const idPontos = `${ano}-${dia}-pontos-altos`;

    return `
      <div class="info-panel-asmb-wrapper">
        <div class="info-panel-asmb" id="info-panel-asmb">
          <div class="info-panel-asmb-inner">
            <div class="info-panel-content">
              <div class="assistencia-container">
                <div class="assistencia-header">Assistência</div>
                <div class="assistencia-row">
                  <span class="assistencia-label">MANHÃ:</span>
                  <input type="text" class="assistencia-input" id="${idManha}" placeholder="Assistência da manhã">
                </div>
                <div class="assistencia-row">
                  <span class="assistencia-label">TARDE:</span>
                  <input type="text" class="assistencia-input" id="${idTarde}" placeholder="Assistência da tarde">
                </div>
              </div>
              <hr class="info-panel-divider">
              <div class="pontos-altos-container">
                <div class="pontos-altos-header">Pontos Altos do Dia</div>
                <div class="pontos-altos-wrapper" id="wrapper-${idPontos}">
                  <div class="pontos-altos-content" id="${idPontos}">
                    <span style="color: var(--text-muted, #9ca3af);">Clique na estrela para gerar os pontos altos do dia...</span>
                  </div>
                  <button type="button" class="btn-gerar-ia btn-gerar-pontos-altos" title="Gerar Pontos Altos" onclick="if(window.AssembleiaIA && window.AssembleiaIA.gerarPontosAltosDia) window.AssembleiaIA.gerarPontosAltosDia('${dia}', this.parentElement, '${idPontos}')">✨</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="program-nav" data-program-nav>
        ${navButton('Anterior', 'prev', idx > 0, DIAS[idx - 1])}
        <div class="program-nav-center" id="nav-center-hitbox">
          <button class="program-nav-btn program-nav-btn--info" type="button" id="btn-toggle-info" aria-label="Informações e Resumo">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="7.15" fill="none" stroke="currentColor" stroke-width="0.95"></circle>
              <text x="12" y="12.35" text-anchor="middle" dominant-baseline="middle" font-size="11.2" font-style="italic" font-weight="500" font-family="Georgia, 'Times New Roman', serif" fill="currentColor">i</text>
            </svg>
          </button>
        </div>
        ${navButton('Próximo', 'next', idx < DIAS.length - 1, DIAS[idx + 1])}
      </div>
    `;
  }

  function bindInfoPanel(container, dia) {
    const hitbox = container.querySelector('#nav-center-hitbox');
    const btnInfo = container.querySelector('#btn-toggle-info');
    const infoPanel = container.querySelector('#info-panel-asmb');

    let hideTimer = null;

    function startHideTimer() {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        btnInfo.classList.remove('is-visible');
      }, 10000);
    }

    if (hitbox && btnInfo && infoPanel) {
      hitbox.addEventListener('click', (e) => {
        if (e.target.closest('#btn-toggle-info')) return;
        
        if (!btnInfo.classList.contains('is-visible')) {
          btnInfo.classList.add('is-visible');
          startHideTimer();
        } else {
          startHideTimer();
        }
      });

      btnInfo.addEventListener('click', (e) => {
        e.stopPropagation();
        infoPanel.classList.toggle('is-open');

        if (infoPanel.classList.contains('is-open')) {
          clearTimeout(hideTimer);
          setTimeout(() => {
            infoPanel.scrollIntoView({ behavior: 'smooth', block: 'end' });
          }, 320);
        } else {
          startHideTimer();
        }
      });
    }

    const ano = document.documentElement.dataset.programYear || '2026';
    
    ['manha', 'tarde'].forEach(turno => {
      const idInput = `${ano}-${dia}-assistencia-${turno}`;
      const input = document.getElementById(idInput) || container.querySelector(`[id="${idInput}"]`);
      if (input) {
        input.value = localStorage.getItem(idInput) || '';
        input.addEventListener('input', () => {
          localStorage.setItem(idInput, input.value);
          window.dispatchEvent(new CustomEvent('assembleia:recordchange'));
        });
      }
    });

    const idPontos = `${ano}-${dia}-pontos-altos`;
    const elPontos = document.getElementById(idPontos) || container.querySelector(`[id="${idPontos}"]`);
    if (elPontos) {
      const salvo = localStorage.getItem(idPontos);
      if (salvo) elPontos.innerHTML = salvo;
    }
  }

  async function carregarDia(dia, pushHash = true) {
    const container = document.getElementById('programacao-container');
    if (!container) return;
    if (!DIAS.includes(dia)) return;
    if (window.AssembleiaIA?.flushPendingWrites?.() === false) return;
    const requestId = ++activeLoad;
    dayController?.abort();
    dayController = new AbortController();
    atualizarCabecalho(dia);
    atualizarImagemTopo(dia, requestId);
    container.innerHTML = '<p>Carregando...</p>';
    try {
      const res = await fetch(`programacao/${dia}.html?v=asmb-2026`, { cache: 'no-store', signal: dayController.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      if (requestId !== activeLoad) return;
      if (!html.includes('class="program-fragment"')) throw new Error('Programação indisponível');
      container.innerHTML = html + renderNav(dia);
      if (window.ProgramacaoBbl?.normalizeBbl) window.ProgramacaoBbl.normalizeBbl(container);
      if (window.AssembleiaClickables?.init) window.AssembleiaClickables.init(container);
      if (pushHash) history.replaceState(null, '', `#${dia}`);
      bindNav(container);
      bindInfoPanel(container, dia);
      window.dispatchEvent(new CustomEvent('programacao:daychange', { detail: { dia, isUserNavigation: true } }));
    } catch (err) {
      if (requestId !== activeLoad || err.name === 'AbortError') return;
      container.innerHTML = '<p>Não foi possível carregar a programação.</p>';
    }
  }

  function bindNav(scope) {
    scope.querySelectorAll('[data-go-day]').forEach((btn) => {
      if (btn.dataset.boundNav === 'true') return;
      btn.dataset.boundNav = 'true';
      btn.addEventListener('click', () => carregarDia(btn.dataset.goDay, true));
    });
  }

  function init() {
    carregarDia(diaDaHash() || diaAutomatico(), false);
    window.addEventListener('hashchange', () => {
      const dia = diaDaHash();
      if (dia) carregarDia(dia, false);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();