// Repair the known truncated hope3 article tail in existing downloads. Move
// the original nodes so answer fields, highlights, IDs and listeners survive.
(() => {
  function repairArticle() {
    if (document.querySelectorAll('main').length !== 1) return;
    const main = document.querySelector('.container > main');
    if (!main) return;
    for (const end of [main, main.parentElement]) {
      let node = end.nextElementSibling;
      while (node?.matches('figure, .secao-recapitulacao, .secao-cantico, hr.linha-divisoria, .nota-rodape')) {
        const next = node.nextElementSibling;
        main.appendChild(node);
        node = next;
      }
    }

    // Legacy recaps flattened links to plain text. Recover only an exact Bible
    // label already linked elsewhere in this article; never rewrite user notes.
    if (main.closest('[data-hope4-article]')) return;
    const labels = [...new Set([...main.querySelectorAll('a.bbl')]
      .filter(link => !link.closest('.secao-recapitulacao, .anotacao, .comentarios, [contenteditable]'))
      .map(link => link.textContent.trim().replace(/\s+/g, ' '))
      .filter(label => /\p{L}/u.test(label) && /\d/.test(label)))];
    if (!labels.length) return;
    const escaped = labels.sort((a, b) => b.length - a.length)
      .map(label => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'));
    const pattern = new RegExp(escaped.join('|'), 'giu');
    for (const recap of main.querySelectorAll('.lista-recapitulacao')) {
      const walker = document.createTreeWalker(recap, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          return node.parentElement.closest('a, button, input, textarea, select, script, style, .anotacao, .comentarios, [contenteditable]')
            ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
        }
      });
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      for (const node of nodes) {
        const text = node.nodeValue, fragment = document.createDocumentFragment();
        let last = 0, changed = false;
        for (const match of text.matchAll(pattern)) {
          const start = match.index, end = start + match[0].length;
          const item = node.parentElement.closest('li') || recap;
          const prefix = document.createRange(), suffix = document.createRange();
          prefix.selectNodeContents(item); prefix.setEnd(node, start);
          suffix.selectNodeContents(item); suffix.setStart(node, end);
          const before = prefix.toString(), after = suffix.toString();
          if (/[\p{L}\p{N}]/u.test(before.slice(-1)) || /^[\p{L}\p{N}:]/u.test(after)) continue;
          // A shorter linked label must not turn "1 João 3" into João 3, or
          // "Salmo 91-93" / "Salmo 91 : 2" into a link to just chapter 91,
          // including a boundary split across a highlight or inline formatting.
          if (!/^\d/.test(match[0]) && /(?:^|[^\p{L}\p{N}])(?:[1-3]|I{1,3})\s+$/iu.test(before)) continue;
          if (/^\s*(?::|[-–—,;]\s*\d)|^\s+e\s+\d/u.test(after)) continue;
          fragment.append(text.slice(last, start));
          const link = document.createElement('a');
          link.className = 'bbl';
          link.textContent = match[0];
          fragment.append(link);
          last = end;
          changed = true;
        }
        if (changed) {
          fragment.append(text.slice(last));
          node.replaceWith(fragment);
        }
      }
    }
  }
  // This script follows the article markup, before its interactive controls
  // initialize. A cache restore can replace descendants, so repair those too.
  repairArticle();
  document.addEventListener('DOMContentLoaded', repairArticle, {once: true});
  document.addEventListener('cacheRestored', repairArticle, {capture: true});
})();

document.addEventListener('DOMContentLoaded', () => {
    const semana = window.semanaAtual;
    if (!semana) {
        return;
    }

    const placeholders = document.querySelectorAll('[class^="imagem"]');

    placeholders.forEach(placeholder => {
        const id = placeholder.className.replace('imagem', '');
        if (!id || isNaN(id)) {
            return;
        }

        const basePath = `imagem/semanas/${semana}/`;
        const imgPath = `${basePath}img${id}.png`;
        const legPath = `${basePath}leg${id}.txt`;

        fetch(legPath)
            .then(response => {
                if (response.ok) {
                    return response.text();
                }
                return '';
            })
            .then(legendaText => {
                const figure = document.createElement('figure');
                figure.className = 'figura-container';

                const img = document.createElement('img');
                img.src = imgPath;
                img.alt = legendaText.trim();

                img.onerror = () => {
                    placeholder.innerHTML = `<div class="figura-erro">Imagem para '${semana}' (img${id}.png) não encontrada.</div>`;
                };

                figure.appendChild(img);

                if (legendaText && legendaText.trim() !== '') {
                    const figcaption = document.createElement('figcaption');
                    figcaption.className = 'figura-legenda';
                    figcaption.textContent = legendaText.trim();
                    figure.appendChild(figcaption);
                }

                placeholder.replaceWith(figure);
            })
            .catch(error => {
                placeholder.innerHTML = `<div class="figura-erro">Erro de rede ao carregar imagem ${id}</div>`;
            });
    });

    (function normalizarFigureClasses() {
        const boundImages = new WeakSet();
        function isInsideZoomModal(el) {
            return !!el.closest('#zoom-container');
        }

        function openFigureImage(event) {
            const img = event.currentTarget;
            if (isInsideZoomModal(img) || typeof window.abrirZoom !== 'function') return;
            event.preventDefault();
            if (!img.alt.trim()) img.alt = img.closest('figure')?.querySelector('figcaption')?.textContent.trim() || '';
            window.abrirZoom(img);
        }

        function aplicarClasses(fig) {
            if (!fig || !(fig instanceof Element)) return;
            if (isInsideZoomModal(fig)) return;

            if (!fig.classList.contains('figura-container')) {
                fig.classList.add('figura-container');
            }

            const cap = fig.querySelector('figcaption');
            if (cap && !cap.classList.contains('figura-legenda')) {
                cap.classList.add('figura-legenda');
            }
            // Safari needs a handler on the image itself to turn its touch into
            // a click. Bind restored/new figures too, without opening twice.
            for (const img of fig.querySelectorAll('img')) {
                if (boundImages.has(img)) continue;
                boundImages.add(img);
                img.addEventListener('click', openFigureImage);
            }
        }

        document.querySelectorAll('figure').forEach(aplicarClasses);

        const obs = new MutationObserver((mutations) => {
            for (const m of mutations) {
                for (const node of m.addedNodes) {
                    if (!(node instanceof Element)) continue;

                    const figure = node.closest('figure');
                    if (figure) aplicarClasses(figure);
                    if (node.querySelectorAll) node.querySelectorAll('figure').forEach(aplicarClasses);
                }
            }
        });

        obs.observe(document.body, { childList: true, subtree: true });
    })();
});

(function () {
  let ultimoAcionador = null;

  function ensureAltModal() {
    if (document.getElementById("alt-modal")) return;

    const modal = document.createElement("div");
    modal.id = "alt-modal";
    modal.innerHTML = `
      <div class="alt-box" role="dialog" aria-modal="true">
        <div class="alt-topo">
        <div class="alt-titulo" id="alt-modal-titulo">Nota de rodapé</div>
          <button class="alt-fechar" aria-label="Fechar">&times;</button>
        </div>
        <div class="alt-corpo">
          <span class="alt-label">DESCRIÇÃO DA IMAGEM:</span>
          <span class="alt-texto"></span>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelector('.alt-box').setAttribute('aria-labelledby', 'alt-modal-titulo');

    document.addEventListener("click", (e) => {
      const m = document.getElementById("alt-modal");
      if (!m || !m.classList.contains("aberto")) return;
      if (!m.contains(e.target) && !e.target.closest('.alt-link, .footnote-link, .footnote-ref')) {
        fecharPopover();
      }
    });

    modal.querySelector(".alt-fechar").addEventListener("click", fecharPopover);

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") fecharPopover();
    });
  }

  // Rebuild a small, safe inline fragment instead of copying arbitrary article HTML.
  // Bible anchors are rebound below; cloned DOM does not retain event listeners.
  function conteudoNota(nota) {
    const fragmento = document.createDocumentFragment();
    const permitidas = new Set(['A', 'SPAN', 'EM', 'STRONG', 'B', 'I', 'U', 'S', 'SUP', 'SUB', 'BR', 'CODE']);
    const ignoradas = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'LINK', 'META']);

    function copiar(origem, destino) {
      if (origem.nodeType === Node.TEXT_NODE) {
        destino.appendChild(document.createTextNode(origem.nodeValue));
        return;
      }
      if (origem.nodeType !== Node.ELEMENT_NODE || ignoradas.has(origem.tagName) ||
          origem.matches('.simbolo-rodape, .footnote-backref, [role="doc-backlink"]')) return;
      let novo = destino;
      if (permitidas.has(origem.tagName)) {
        novo = document.createElement(origem.tagName.toLowerCase());
        if (origem.classList.contains('bbl')) novo.classList.add('bbl');
        if (origem.tagName === 'A') {
          const href = origem.getAttribute('href');
          if (href) {
            try {
              const url = new URL(href, document.baseURI);
              if (url.protocol === 'https:' || url.protocol === 'http:') {
                novo.href = url.href;
                if (origem.target === '_blank') {
                  novo.target = '_blank';
                  novo.rel = 'noopener noreferrer';
                }
              }
            } catch (_) { /* Invalid links remain readable text. */ }
          }
        }
        destino.appendChild(novo);
      }
      origem.childNodes.forEach(child => copiar(child, novo));
    }
    nota.childNodes.forEach(child => copiar(child, fragmento));
    const primeiroTexto = document.createTreeWalker(fragmento, NodeFilter.SHOW_TEXT).nextNode();
    if (primeiroTexto) primeiroTexto.nodeValue = primeiroTexto.nodeValue.replace(/^\s*\*\s*/, '');
    return fragmento;
  }

  function abrirPopover({ titulo = "Nota de rodapé", rotulo = "", texto = "", nota = null, acionador = null } = {}) {
    ensureAltModal();
    const modal = document.getElementById("alt-modal");

    const t = modal.querySelector(".alt-titulo");
    const label = modal.querySelector(".alt-label");
    const body = modal.querySelector(".alt-texto");

    if (t) t.textContent = titulo;

    if (label) {
      const r = (rotulo || "").trim();
      if (r) {
        label.textContent = r;
        label.style.display = "";
      } else {
        label.textContent = "";
        label.style.display = "none";
      }
    }

    if (body) {
      body.replaceChildren(nota ? conteudoNota(nota) : document.createTextNode(texto || ''));
      if (typeof window.ativarLinksBiblicos === 'function') window.ativarLinksBiblicos(body);
    }
    ultimoAcionador = acionador;

    const alturaAtualDaTela = window.scrollY + (window.innerHeight / 2);
    modal.style.top = alturaAtualDaTela + "px";

    modal.classList.add("aberto");
    modal.querySelector('.alt-fechar').focus({ preventScroll: true });
  }

  function fecharPopover(restaurarFoco = true) {
    const modal = document.getElementById("alt-modal");
    if (!modal || !modal.classList.contains("aberto")) return;
    modal.classList.remove("aberto");
    if (restaurarFoco && ultimoAcionador?.isConnected) ultimoAcionador.focus({ preventScroll: true });
    ultimoAcionador = null;
  }

  function aplicarAsteriscoAlt(raiz = document) {
    raiz.querySelectorAll('figure').forEach(fig => {
      const img = fig.querySelector('img');
      const cap = fig.querySelector('figcaption');
      if (!img || !cap || !(img.getAttribute('alt') || '').trim() || cap.querySelector('.alt-link')) return;
      const a = document.createElement('a');
      a.className = 'alt-link';
      a.href = '#';
      a.textContent = '*';
      a.setAttribute('aria-label', 'Ver descrição da imagem');
      cap.appendChild(a);
    });
  }

  function notasPrincipais(main) {
    const notas = Array.from(main.querySelectorAll('.nota-rodape')).filter(nota => !nota.closest('.quadro1'));
    // Old hope3 output sometimes closed .container/main before the final figure,
    // recap and notes. Recover only that known article tail, stopping at any app
    // chrome/script/modal; this also repairs already-downloaded publications.
    if (document.querySelectorAll('main').length === 1) {
      const finais = new Set([main, main.closest('.container')].filter(Boolean));
      finais.forEach(final => {
        let sibling = final.nextElementSibling;
        while (sibling?.matches('figure, .secao-recapitulacao, .secao-cantico, hr.linha-divisoria, .nota-rodape')) {
          if (sibling.matches('.nota-rodape') && !notas.includes(sibling)) notas.push(sibling);
          sibling = sibling.nextElementSibling;
        }
      });
    }
    return notas;
  }

  function garantirId(nota, sugerido) {
    if (nota.id && document.getElementById(nota.id) === nota) return nota.id;
    let id = sugerido;
    let sufixo = 1;
    while (document.getElementById(id) && document.getElementById(id) !== nota) id = `${sugerido}-${sufixo++}`;
    nota.id = id;
    return id;
  }

  function destinoExplicito(link) {
    if (link.dataset.noteId) return link.dataset.noteId;
    if (link.dataset.footnoteTarget) return link.dataset.footnoteTarget;
    const href = link.getAttribute('href') || '';
    if (href.startsWith('#') && href.length > 1) {
      try { return decodeURIComponent(href.slice(1)); } catch (_) { return href.slice(1); }
    }
    return null;
  }

  function marcadorLegado(link) {
    const href = (link.getAttribute('href') || '').trim();
    return !href || href === '#' || /^javascript:\s*void\(0\);?$/i.test(href);
  }

  function resolverNota(link, main) {
    const id = destinoExplicito(link);
    if (id) {
      const nota = document.getElementById(id);
      return nota && (notasPrincipais(main).includes(nota) ||
        (main.contains(nota) && nota.matches('.quadro1-nota'))) ? nota : null;
    }
    // A saved data-fn is an explicit index from the old reader, not a fresh guess.
    if (marcadorLegado(link) && /^\d+$/.test(link.dataset.fn || '')) return notasPrincipais(main)[Number(link.dataset.fn)] || null;
    return null;
  }

  function associarNota(link, nota) {
    link.dataset.noteId = nota.id;
    link.href = `#${nota.id}`;
    link.classList.add('footnote-link');
    link.setAttribute('role', 'doc-noteref');
    if (!link.hasAttribute('aria-label')) link.setAttribute('aria-label', 'Abrir nota de rodapé');
  }

  function prepararNotasQuadro(main) {
    main.querySelectorAll('.quadro1').forEach((quadro, index) => {
      const notas = quadro.querySelectorAll('.quadro1-nota');
      const links = quadro.querySelectorAll('.footnote-link, .footnote-ref');
      if (notas.length !== 1 || links.length !== 1 || !marcadorLegado(links[0])) return;
      garantirId(notas[0], `sentinela-nota-quadro-${index + 1}`);
      associarNota(links[0], notas[0]);
    });
  }

  function prepararNotasRodape(main) {
    const notas = notasPrincipais(main);
    if (!notas.length) return;
    notas.forEach((nota, index) => garantirId(nota, `sentinela-nota-${index + 1}`));
    main.querySelectorAll('.footnote-link, .footnote-ref').forEach(link => {
      const nota = resolverNota(link, main);
      if (nota) associarNota(link, nota);
    });

    // Legacy articles lost the source IDs. Only repair the simple one-marker-per-
    // note case in the main paragraphs, with an exact count and consistent order.
    // Never consume stars in captions, boxes, editable comments or existing links.
    const referencias = [];
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const parent = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
      if (!parent?.closest('.paragrafo') || parent.closest('.nota-rodape, .quadro1, figure, .secao-recapitulacao, .anotacao, [contenteditable="true"], script, style')) continue;
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.matches('a.footnote-link, a.footnote-ref')) referencias.push({ link: node, nota: resolverNota(node, main) });
      } else if (!parent.closest('a') && node.nodeValue.includes('*')) {
        for (const match of node.nodeValue.matchAll(/\*/g)) referencias.push({ node, offset: match.index });
      }
    }
    if (referencias.length !== notas.length || referencias.some((ref, index) => ref.link && ref.nota !== notas[index])) return;

    // Replace backwards so offsets in a text node stay valid when it has two notes.
    for (let index = referencias.length - 1; index >= 0; index--) {
      const ref = referencias[index];
      if (ref.link) continue;
      const marcador = ref.node.splitText(ref.offset);
      marcador.splitText(1);
      const link = document.createElement('a');
      link.textContent = '*';
      link.dataset.fn = String(index);
      associarNota(link, notas[index]);
      marcador.replaceWith(link);
    }
  }

  // One delegated listener survives cached innerHTML replacements and repeated
  // cacheRestored events; it resolves the current target at the moment of the tap.
  document.addEventListener('click', event => {
    const link = event.target.closest?.('a.footnote-link, a.footnote-ref, a.alt-link');
    if (!link) return;
    if (link.classList.contains('alt-link')) {
      const texto = link.closest('figure')?.querySelector('img')?.getAttribute('alt')?.trim();
      if (!texto) return;
      event.preventDefault();
      event.stopPropagation();
      abrirPopover({ rotulo: 'DESCRIÇÃO DA IMAGEM:', texto, acionador: link });
      return;
    }
    const main = link.closest('main');
    if (!main) return;
    const nota = resolverNota(link, main);
    if (!nota) return; // A genuine or unresolved source link keeps its own behavior.
    event.preventDefault();
    event.stopPropagation();
    abrirPopover({ nota, acionador: link });
  });

  function runAll() {
    aplicarAsteriscoAlt();
    document.querySelectorAll('main').forEach(main => {
      prepararNotasQuadro(main);
      prepararNotasRodape(main);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", runAll);
  } else {
    runAll();
  }

  document.addEventListener("cacheRestored", runAll);
  document.addEventListener('sentinela:bible-preview-open', () => fecharPopover(false));
})();
