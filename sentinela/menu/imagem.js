// imagem.js (Versão FINAL com caminhos dinâmicos por semana)
// + PATCH: modal por link (event delegation) + patch: aplicar classes do estilo em <figure> existentes

document.addEventListener('DOMContentLoaded', () => {
    // Pega a variável global definida no HTML.
    // Se não existir, usa 'default' para evitar quebrar e mostra um aviso.
    const semana = window.semanaAtual;
    if (!semana) {
        console.warn('A variável global "window.semanaAtual" não foi encontrada. Verifique o <script> no seu HTML. As imagens não serão carregadas corretamente.');
        return; // Interrompe a execução se a semana não for definida.
    }

    const placeholders = document.querySelectorAll('[class^="imagem"]');

    placeholders.forEach(placeholder => {
        const id = placeholder.className.replace('imagem', '');
        if (!id || isNaN(id)) {
            console.error('Placeholder de imagem com ID inválido:', placeholder);
            return;
        }

        // --- A MUDANÇA PRINCIPAL ESTÁ AQUI ---
        // Constrói o caminho dinamicamente usando a variável 'semana'.
        const basePath = `imagem/semanas/${semana}/`;
        const imgPath = `${basePath}img${id}.png`;
        const legPath = `${basePath}leg${id}.txt`;

        // O resto do código permanece o mesmo, pois agora ele usa os caminhos corretos.
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

                // Adiciona um listener de erro para a imagem, caso ela não seja encontrada
                img.onerror = () => {
                    console.error(`Erro: A imagem não foi encontrada no caminho: ${imgPath}`);
                    placeholder.innerHTML = `<div class="figura-erro">Imagem para '${semana}' (img${id}.png) não encontrada.</div>`;
                };

                // Mantém o clique direto nas imagens "locais" (placeholders)
                img.addEventListener('click', () => {
                    if (typeof window.abrirZoom === 'function') {
                        window.abrirZoom(img);
                    } else {
                        console.error('Função de zoom (abrirZoom) não encontrada.');
                    }
                });

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
                console.error('Erro de rede ao carregar recursos da imagem:', error);
                placeholder.innerHTML = `<div class="figura-erro">Erro de rede ao carregar imagem ${id}</div>`;
            });
    });

    // ============================================================
    // PATCH 1: Modal para imagens por LINK (qualquer <figure><img>)
    // ============================================================
    (function bindFigureImagesToZoomModal() {
        function isInsideZoomModal(el) {
            return !!el.closest('#zoom-container');
        }

        document.addEventListener('click', (e) => {
            const img = e.target && e.target.closest ? e.target.closest('figure img') : null;
            if (!img) return;
            if (isInsideZoomModal(img)) return;

            if (typeof window.abrirZoom !== 'function') {
                console.error('Função de zoom (abrirZoom) não encontrada.');
                return;
            }

            // Se não tiver alt, usa figcaption como legenda (o teu modal mostra o alt no footer)
            if (!img.alt || !img.alt.trim()) {
                const fig = img.closest('figure');
                const cap = fig ? fig.querySelector('figcaption') : null;
                const txt = cap && cap.textContent ? cap.textContent.trim() : '';
                if (txt) img.alt = txt;
            }

            window.abrirZoom(img);
        }, true); // capture=true ajuda a pegar clique mesmo com overlays/handlers no caminho
    })();

    // ============================================================
    // PATCH 2: Estilo automático nas figuras do HTML (por link)
    // - aplica figura-container no <figure>
    // - aplica figura-legenda no <figcaption>
    // ============================================================
    (function normalizarFigureClasses() {
        function isInsideZoomModal(el) {
            return !!el.closest('#zoom-container');
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
        }

        // Aplica nas figuras já existentes (imagens por link já no HTML)
        document.querySelectorAll('figure').forEach(aplicarClasses);

        // Se teu conteúdo for inserido depois (dinâmico), aplica também
        const obs = new MutationObserver((mutations) => {
            for (const m of mutations) {
                for (const node of m.addedNodes) {
                    if (!(node instanceof Element)) continue;

                    if (node.matches && node.matches('figure')) aplicarClasses(node);
                    if (node.querySelectorAll) node.querySelectorAll('figure').forEach(aplicarClasses);
                }
            }
        });

        obs.observe(document.body, { childList: true, subtree: true });
    })();
});








(function () {
  // Funções de lockScroll/unlockScroll removidas. O fundo escuro não existe mais.

  function ensureAltModal() {
    if (document.getElementById("alt-modal")) return;

    const modal = document.createElement("div");
    modal.id = "alt-modal";
    modal.innerHTML = `
      <div class="alt-box" role="dialog" aria-modal="true">
        <div class="alt-topo">
          <div class="alt-titulo">Nota de rodapé</div>
          <button class="alt-fechar" aria-label="Fechar">&times;</button>
        </div>
        <div class="alt-corpo">
          <span class="alt-label">DESCRIÇÃO DA IMAGEM:</span>
          <span class="alt-texto"></span>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // Fecha o modal se o usuário clicar/tocar em qualquer lugar fora dele
    document.addEventListener("click", (e) => {
      if (modal.classList.contains("aberto")) {
        if (!modal.contains(e.target) && !e.target.classList.contains("alt-link")) {
          fecharAltModal();
        }
      }
    });

    modal.querySelector(".alt-fechar").addEventListener("click", fecharAltModal);

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") fecharAltModal();
    });
  }

  function abrirAltModal(texto) {
    ensureAltModal();
    const modal = document.getElementById("alt-modal");
    modal.querySelector(".alt-texto").textContent = texto || "";
    
    // Alfineta o modal no centro exato da tela VISUAL do usuário naquele momento
    const alturaAtualDaTela = window.scrollY + (window.innerHeight / 2);
    modal.style.top = alturaAtualDaTela + "px";

    modal.classList.add("aberto");
  }

  function fecharAltModal() {
    const modal = document.getElementById("alt-modal");
    if (!modal || !modal.classList.contains("aberto")) return;
    modal.classList.remove("aberto");
  }

  function aplicarAsteriscoAlt(raiz = document) {
    raiz.querySelectorAll("figure").forEach((fig) => {
      const img = fig.querySelector("img");
      const cap = fig.querySelector("figcaption");
      if (!img || !cap) return;

      const alt = (img.getAttribute("alt") || "").trim();
      if (!alt) return;

      if (cap.querySelector(".alt-link")) return;

      const a = document.createElement("a");
a.className = "alt-link";
a.href = "javascript:void(0)";
a.textContent = "*";
      a.setAttribute("role", "button");
      a.setAttribute("aria-label", "Ver descrição da imagem");
      
      a.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        abrirAltModal(alt);
      });

      cap.appendChild(a);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => aplicarAsteriscoAlt());
  } else {
    aplicarAsteriscoAlt();
  }

  document.addEventListener("cacheRestored", () => aplicarAsteriscoAlt());
})();
