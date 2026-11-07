document.addEventListener('DOMContentLoaded', () => {
  const DIAS_VALIDOS =['sex', 'sab', 'dom'];
  let initialLoad = true;

  function diaEfetivoDoSistema() {
    const hoje = new Date().getDay();
    if (hoje === 6) return 'sab';
    if (hoje === 0) return 'dom';
    return 'sex';
  }

  function diaExibido() {
    const explicit = (document.documentElement.dataset.programDay || '').trim().toLowerCase();
    if (DIAS_VALIDOS.includes(explicit)) return explicit;
    return 'sex';
  }

  function unwrapDirectChildWrapper(parent, wrapperClass) {
    const wrapper = Array.from(parent.children).find(
      (child) => child.classList && child.classList.contains(wrapperClass)
    );

    if (!wrapper) return;

    while (wrapper.firstChild) {
      parent.insertBefore(wrapper.firstChild, wrapper);
    }
    wrapper.remove();
  }

  function wrapChildren(parent, wrapperClass) {
    const alreadyWrapped =
      parent.childNodes.length === 1 &&
      parent.firstElementChild &&
      parent.firstElementChild.classList &&
      parent.firstElementChild.classList.contains(wrapperClass);

    if (alreadyWrapped) return;

    unwrapDirectChildWrapper(parent, wrapperClass);

    const wrapper = document.createElement('span');
    wrapper.className = wrapperClass;

    while (parent.firstChild) {
      wrapper.appendChild(parent.firstChild);
    }

    parent.appendChild(wrapper);
  }

  function limparDestaques(scope) {
    scope.querySelectorAll('p.hora-ativo').forEach((p) => {
      p.classList.remove('hora-ativo');
      unwrapDirectChildWrapper(p, 'hora-ativo-texto');
    });

    scope.querySelectorAll('li.simposio-subtema-ativo').forEach((li) => {
      li.classList.remove('simposio-subtema-ativo');
      unwrapDirectChildWrapper(li, 'simposio-subtema-ativo-texto');
    });

    scope.querySelectorAll('p[data-min-topico]').forEach((p) => {
      delete p.dataset.minTopico;
    });
  }

  function extrairMinutosDoParagrafo(p) {
    const primeiroFilho = p.firstElementChild;
    if (!primeiroFilho || !primeiroFilho.classList.contains('hora')) return null;

    const match = primeiroFilho.textContent.match(/^(\d{1,2}):(\d{2})/);
    if (!match) return null;

    const h = parseInt(match[1], 10);
    const m = parseInt(match[2], 10);
    return h * 60 + m;
  }

  function prepararTopicosComHora(container) {
    container.querySelectorAll('p').forEach((p) => {
      const minutos = extrairMinutosDoParagrafo(p);
      if (minutos !== null) {
        p.dataset.minTopico = String(minutos);
      }
    });
  }

  function encontrarTopicoAtual(container, minAtual) {
    const topicos = Array.from(container.querySelectorAll('p')).filter((p) => p.dataset.minTopico);
    if (!topicos.length) return null;

    let candidato = null;
    let diff = Infinity;

    topicos.forEach((p) => {
      const minDoTopico = parseInt(p.dataset.minTopico, 10);
      if (minAtual >= minDoTopico && (minAtual - minDoTopico) < diff) {
        candidato = p;
        diff = minAtual - minDoTopico;
      }
    });

    return candidato;
  }

  function getNextTimedParagraph(startElement) {
    let current = startElement.nextElementSibling;
    while (current) {
      if (current.tagName === 'P' && current.dataset.minTopico) {
        return current;
      }
      current = current.nextElementSibling;
    }
    return null;
  }

  function getSymposiumInfo(headingParagraph) {
    const headingMin = parseInt(headingParagraph.dataset.minTopico, 10);
    if (Number.isNaN(headingMin)) return null;

    const nextTimedParagraph = getNextTimedParagraph(headingParagraph);
    if (!nextTimedParagraph) return null;

    let current = headingParagraph.nextElementSibling;
    let list = null;

    while (current && current !== nextTimedParagraph) {
      if (current.tagName === 'UL' || current.tagName === 'OL') {
        list = current;
        break;
      }
      current = current.nextElementSibling;
    }

    if (!list) return null;

    const subtopics = Array.from(list.children).filter((child) => child.tagName === 'LI');
    if (!subtopics.length) return null;

    const endMin = parseInt(nextTimedParagraph.dataset.minTopico, 10);
    const totalMin = endMin - headingMin;
    if (!Number.isFinite(totalMin) || totalMin <= 0) return null;

    const subtopicMin = Math.floor(totalMin / subtopics.length);
    if (subtopicMin <= 0) return null;

    const presentationMin = totalMin - (subtopicMin * subtopics.length);

    return {
      headingParagraph,
      headingMin,
      endMin,
      totalMin,
      list,
      subtopics,
      subtopicMin,
      presentationMin,
    };
  }

  function aplicarDestaqueDeTopico(topico) {
    topico.classList.add('hora-ativo');
    wrapChildren(topico, 'hora-ativo-texto');
  }

  function aplicarDestaqueDeSubtema(subtopic) {
    subtopic.classList.add('simposio-subtema-ativo');
    wrapChildren(subtopic, 'simposio-subtema-ativo-texto');
  }

  function aplicarLogicaDoSimposio(topicoAtual, minAtual) {
    const symposium = getSymposiumInfo(topicoAtual);
    if (!symposium) return;

    const elapsed = minAtual - symposium.headingMin;
    if (elapsed < symposium.presentationMin) return;

    const elapsedInSubtopics = elapsed - symposium.presentationMin;
    const activeIndex = Math.floor(elapsedInSubtopics / symposium.subtopicMin);

    if (activeIndex < 0 || activeIndex >= symposium.subtopics.length) return;

    aplicarDestaqueDeSubtema(symposium.subtopics[activeIndex]);
  }

  function marcarHoraAtiva(event) {
    const container = document.getElementById('programacao-container');
    if (!container) return;

    limparDestaques(container);

    const diaDoSistema = diaEfetivoDoSistema();
    const diaAtual = diaExibido();
    if (diaAtual !== diaDoSistema) {
      return;
    }

    const agora = new Date();
    const minAtual = agora.getHours() * 60 + agora.getMinutes();
    const inicioFaixa = 9 * 60 + 0;
    const fimFaixa = 17 * 60 + 0;

    if (minAtual < inicioFaixa || minAtual >= fimFaixa) {
      return;
    }

    prepararTopicosComHora(container);

    const topicoAtual = encontrarTopicoAtual(container, minAtual);
    if (!topicoAtual) return;

    aplicarDestaqueDeTopico(topicoAtual);
    aplicarLogicaDoSimposio(topicoAtual, minAtual);

    let shouldScroll = false;
    if (initialLoad) {
      shouldScroll = true;
      initialLoad = false;
    } else if (event && event.type === 'programacao:daychange' && event.detail && event.detail.isUserNavigation) {
      shouldScroll = true;
    }

    if (shouldScroll) {
      setTimeout(() => {
        const navInst = window.UnifiedNavbar?.get();
        if (navInst && !navInst._isScrollLockedByRobot) {
          navInst._isScrollLockedByRobot = true;
          const originalHide = navInst.hideNavbar;
          navInst.hideNavbar = function() {};
          navInst.showNavbar();

          topicoAtual.scrollIntoView({ behavior: 'smooth', block: 'center' });

          setTimeout(() => {
            navInst.hideNavbar = originalHide;
            delete navInst._isScrollLockedByRobot;
          }, 1200);
        } else {
          topicoAtual.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 250);
    }
  }

  marcarHoraAtiva();
  setInterval(marcarHoraAtiva, 60 * 1000);
  window.addEventListener('programacao:daychange', marcarHoraAtiva);
});