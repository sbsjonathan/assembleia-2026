(function() {
  if (window.envioTextoInicializado) return;
  window.envioTextoInicializado = true;
  window.ENVIO_TEXTO_VERSAO = 'envio-texto-v5-final';
  try { console.log('[EnvioTexto] versao carregada:', window.ENVIO_TEXTO_VERSAO); } catch (e) {}

  let balao = null;
  let rangeSalvo = null;
  let touchStartData = { x: 0, y: 0, scrollY: 0, moved: false };

  function estaConectado() {
    return !!(window.ConexaoPresenca && window.ConexaoPresenca.estaConectado && window.ConexaoPresenca.estaConectado());
  }

  function editorEl() {
    return document.getElementById('editor');
  }

  function selecaoNoEditor(sel) {
    const ed = editorEl();
    if (!ed || !sel || sel.rangeCount === 0) return false;
    const range = sel.getRangeAt(0);
    const cont = range.commonAncestorContainer;
    const el = cont.nodeType === 1 ? cont : cont.parentElement;
    return !!(el && ed.contains(el));
  }

  function injetarEstilo() {
    if (document.getElementById('envio-texto-estilo')) return;
    const st = document.createElement('style');
    st.id = 'envio-texto-estilo';
    st.textContent =
      '#envio-balao{position:absolute;z-index:990;display:none;align-items:center;justify-content:center;' +
      'background:#2a2a2c;border-radius:10px;padding:7px 9px;box-shadow:0 4px 14px rgba(0,0,0,0.3);' +
      'transform:translateX(-50%);transition:top 0.2s,left 0.2s;gap:8px;}' +
      '#envio-balao button{background:#007AFF;border:none;border-radius:8px;width:40px;height:36px;' +
      'display:flex;align-items:center;justify-content:center;cursor:pointer;color:#fff;padding:0;}' +
      '#envio-balao button:active{transform:scale(0.92);}' +
      '#envio-balao svg{width:20px;height:20px;display:block;}' +
      '.envio-modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:100000;display:flex;align-items:flex-start;justify-content:center;padding:24px;padding-top:18vh;}' +
      '.envio-modal{background:var(--bg-card,#fff);color:var(--text-title,#1a1a1a);border-radius:16px;padding:20px;max-width:340px;width:100%;box-shadow:0 10px 40px rgba(0,0,0,0.3);}' +
      '.envio-modal-titulo{font-size:1rem;font-weight:700;margin-bottom:6px;}' +
      '.envio-modal-destino{font-size:0.78rem;opacity:0.6;margin-bottom:12px;}' +
      '.envio-modal-previa{font-size:0.88rem;opacity:0.85;max-height:30vh;overflow:auto;background:var(--border-input,#f0f0f0);border-radius:10px;padding:12px;margin-bottom:16px;white-space:pre-wrap;}' +
      '.envio-modal-botoes{display:flex;gap:10px;}' +
      '.envio-modal-botoes button{flex:1;padding:11px;border-radius:10px;border:none;font-size:0.9rem;font-weight:600;cursor:pointer;}' +
      '.envio-modal-cancelar{background:var(--border-input,#e8e8e8);color:var(--text-title,#333);}' +
      '.envio-modal-enviar{background:#007AFF;color:#fff;}' +
      '.envio-toast{position:fixed;top:calc(50px + env(safe-area-inset-top));left:50%;transform:translateX(-50%);background:rgba(20,20,22,0.92);color:#fff;padding:11px 18px;border-radius:999px;font-size:0.82rem;font-weight:600;z-index:100001;box-shadow:0 4px 14px rgba(0,0,0,0.3);max-width:80vw;text-align:center;}';
    document.head.appendChild(st);
  }

  function criarBalao() {
    injetarEstilo();
    if (balao) return balao;
    balao = document.createElement('div');
    balao.id = 'envio-balao';
    balao.innerHTML =
      '<button type="button" aria-label="Enviar trecho para o usuário conectado">' +
      '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M3.4 20.4L21 12 3.4 3.6 3.4 10.2 15 12 3.4 13.8 3.4 20.4Z" fill="#ffffff"/>' +
      '</svg></button>';
    document.body.appendChild(balao);

    balao.addEventListener('touchend', (e) => {
      e.preventDefault();
      e.stopPropagation();
      aoEnviar();
    });
    balao.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      aoEnviar();
    });
    return balao;
  }

  function mostrarBalao(rect) {
    criarBalao();
    balao.style.display = 'flex';
    let top = rect.bottom + window.scrollY + 12;
    let left = rect.left + window.scrollX + (rect.width / 2);
    if (top + 50 > window.scrollY + window.innerHeight) {
      top = rect.top + window.scrollY - 50;
    }
    balao.style.top = top + 'px';
    balao.style.left = left + 'px';
  }

  function esconderBalao() {
    if (balao) balao.style.display = 'none';
    rangeSalvo = null;
  }

  function capturarHtmlSelecao(range) {
    const ed = editorEl();
    if (!ed) {
      // fallback: conteudo simples
      const frag = range.cloneContents();
      const div = document.createElement('div');
      div.appendChild(frag);
      return div.innerHTML;
    }

    // Encontra todos os nodes do editor (node-paragraph/node-text/node-toggle) que a selecao toca
    const todosNodes = ed.querySelectorAll('.node-paragraph, .node-text, .node-toggle');
    const tocados = [];
    todosNodes.forEach((node) => {
      if (range.intersectsNode(node)) {
        // Evita pegar um node que seja apenas ancestral de outro ja incluido (pega os "folha" relevantes)
        tocados.push(node);
      }
    });

    if (tocados.length === 0) {
      // Selecao dentro de um unico node: sobe ate achar o node mais proximo
      let cont = range.commonAncestorContainer;
      let node = cont.nodeType === 1 ? cont : cont.parentElement;
      const nodeRaiz = node && node.closest ? node.closest('.node-paragraph, .node-text, .node-toggle') : null;
      if (nodeRaiz) {
        const div = document.createElement('div');
        div.appendChild(nodeRaiz.cloneNode(true));
        return div.innerHTML;
      }
      const frag = range.cloneContents();
      const div = document.createElement('div');
      div.appendChild(frag);
      return div.innerHTML;
    }

    // Filtra: mantem so os nodes de nivel mais alto (nao incluir filhos cujo pai ja esta na lista)
    const topo = tocados.filter((n) => {
      return !tocados.some((outro) => outro !== n && outro.contains(n));
    });

    const div = document.createElement('div');
    topo.forEach((n) => {
      div.appendChild(n.cloneNode(true));
    });
    return div.innerHTML;
  }

  function quadroAtual() {
    let id = '';
    try { id = new URLSearchParams(location.search).get('id') || ''; } catch (e) {}
    let nome = '';
    const t = document.getElementById('fullscTitle');
    if (t) nome = t.textContent.trim();
    return { id: id, nome: nome || 'Anotação' };
  }

  function gerarToken() {
    return 'tx-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function aoEnviar() {
    if (!rangeSalvo) return;
    const html = capturarHtmlSelecao(rangeSalvo);
    const texto = rangeSalvo.toString();
    esconderBalao();
    const sel = window.getSelection();
    if (sel) sel.removeAllRanges();

    if (!html || !texto.trim()) return;

    const q = quadroAtual();
    confirmarEnvio(html, texto, q);
  }

  function confirmarEnvio(html, texto, quadro) {
    injetarEstilo();
    // Fecha o teclado para o modal ficar centralizado e visivel
    if (document.activeElement && document.activeElement.blur) {
      try { document.activeElement.blur(); } catch (e) {}
    }

    setTimeout(() => {
      const overlay = document.createElement('div');
      overlay.className = 'envio-modal-overlay';
      overlay.innerHTML =
        '<div class="envio-modal">' +
          '<div class="envio-modal-titulo">Enviar este trecho?</div>' +
          '<div class="envio-modal-destino"></div>' +
          '<div class="envio-modal-botoes">' +
            '<button class="envio-modal-cancelar">Cancelar</button>' +
            '<button class="envio-modal-enviar">Enviar</button>' +
          '</div>' +
        '</div>';
      overlay.querySelector('.envio-modal-destino').textContent =
        'Para ' + parNome() + ' · ' + (quadro.nome || 'anotação');
      document.body.appendChild(overlay);

      const fechar = () => { if (overlay.parentNode) overlay.remove(); };
      overlay.querySelector('.envio-modal-cancelar').addEventListener('click', fechar);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) fechar(); });

      overlay.querySelector('.envio-modal-enviar').addEventListener('click', () => {
        fechar();
        dispararEnvio(html, texto, quadro);
      });
    }, 250);
  }

  function dispararEnvio(html, texto, quadro) {
    const C = window.ConexaoPresenca;
    if (!C || !C.enviarTexto) {
      mostrarToast('Sem conexão ativa. Não foi enviado.');
      return;
    }

    const token = gerarToken();
    let confirmado = false;
    const dados = { html: html, texto: texto, quadroId: quadro.id, quadroNome: quadro.nome, token: token };

    enviosPendentes[token] = {
      quadroNome: quadro.nome,
      onAck: () => { confirmado = true; }
    };

    mostrarToast('Enviando...');

    let tentativa = 0;
    const MAX = 4;

    function tentar() {
      if (confirmado) return;
      if (!enviosPendentes[token]) return;
      tentativa++;

      // Se nao da pra enviar agora (canal caiu), espera e tenta de novo
      const pode = C.podeEnviar && C.podeEnviar();
      if (pode) {
        C.enviarTexto(dados);
      }

      if (tentativa >= MAX) {
        // Ultima espera: 2s para o ACK chegar
        setTimeout(() => {
          if (!confirmado && enviosPendentes[token]) {
            delete enviosPendentes[token];
            mostrarToast('Falhou: ' + parNome() + ' não recebeu. Tente de novo.');
          }
        }, 2000);
        return;
      }

      // Reagenda: tenta de novo em 1.5s se nao confirmou
      setTimeout(() => {
        if (!confirmado && enviosPendentes[token]) tentar();
      }, 1500);
    }

    tentar();
  }

  function parNome() {
    const p = window.ConexaoPresenca && window.ConexaoPresenca.parAtual && window.ConexaoPresenca.parAtual();
    return p ? (p.nome || 'usuário') : 'usuário';
  }

  const enviosPendentes = {};

  function mostrarToast(msg) {
    injetarEstilo();
    const t = document.createElement('div');
    t.className = 'envio-toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => { if (t.parentNode) t.remove(); }, 3000);
  }

  // Segue o padrao do mark.js (que funciona no iOS): touchstart -> touchmove -> touchend + atraso.
  document.addEventListener('touchstart', (e) => {
    if (e.target && e.target.closest && e.target.closest('#envio-balao')) return;
    if (e.touches.length === 1) {
      touchStartData = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        scrollY: window.scrollY,
        moved: false
      };
    }
    // Toque fora de uma selecao ativa esconde o balao
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) esconderBalao();
  });

  document.addEventListener('touchmove', (e) => {
    if (!e.touches || !e.touches.length) return;
    const dx = e.touches[0].clientX - touchStartData.x;
    const dy = e.touches[0].clientY - touchStartData.y;
    const scrollDelta = Math.abs(window.scrollY - touchStartData.scrollY);
    if (Math.sqrt(dx * dx + dy * dy) > 12 || scrollDelta > 6) {
      touchStartData.moved = true;
    }
  }, { passive: true });

  document.addEventListener('touchend', (e) => {
    if (e.target && e.target.closest && e.target.closest('#envio-balao')) return;

    setTimeout(() => {
      if (!estaConectado()) { esconderBalao(); return; }

      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) { esconderBalao(); return; }
      if (!sel.toString().trim()) { esconderBalao(); return; }
      if (!selecaoNoEditor(sel)) { esconderBalao(); return; }

      rangeSalvo = sel.getRangeAt(0).cloneRange();
      mostrarBalao(rangeSalvo.getBoundingClientRect());
    }, 50);
  });

  // --- RECEBIMENTO: mostra o pop-up quando um texto chega ---
  window.EnvioTextoReceber = function(payload) {
    injetarEstilo();
    const overlay = document.createElement('div');
    overlay.className = 'envio-modal-overlay';
    overlay.innerHTML =
      '<div class="envio-modal">' +
        '<div class="envio-modal-titulo"></div>' +
        '<div class="envio-modal-destino"></div>' +
        '<div class="envio-modal-previa"></div>' +
        '<div class="envio-modal-botoes">' +
          '<button class="envio-modal-cancelar">Recusar</button>' +
          '<button class="envio-modal-enviar">Receber</button>' +
        '</div>' +
      '</div>';
    overlay.querySelector('.envio-modal-titulo').textContent =
      (payload.de_nome || 'Alguém') + ' quer te enviar um texto';
    overlay.querySelector('.envio-modal-destino').textContent =
      'para ' + (payload.quadro_nome || 'uma anotação');
    overlay.querySelector('.envio-modal-previa').textContent = payload.texto || '';
    document.body.appendChild(overlay);

    const fechar = () => { if (overlay.parentNode) overlay.remove(); };

    overlay.querySelector('.envio-modal-cancelar').addEventListener('click', () => {
      if (window.ConexaoPresenca && window.ConexaoPresenca.responderTexto) {
        window.ConexaoPresenca.responderTexto(payload.de_id, payload.token, false);
      }
      fechar();
    });

    overlay.querySelector('.envio-modal-enviar').addEventListener('click', () => {
      const r = gravarTextoRecebido(payload);
      if (window.ConexaoPresenca && window.ConexaoPresenca.responderTexto) {
        window.ConexaoPresenca.responderTexto(payload.de_id, payload.token, !!r);
      }
      fechar();
      if (r) mostrarToast('Texto adicionado em "' + (payload.quadro_nome || 'anotação') + '".');
      else mostrarToast('Não foi possível salvar o texto recebido.');
    });
  };

  // --- GRAVACAO (4c): adiciona o texto recebido no quadro certo (local + nuvem) ---
  function gravarTextoRecebido(payload) {
    const agent = window.AssembleiaIA;
    if (!agent || !agent.readRecord || !agent.writeRecord) return false;
    const id = payload.quadro_id;
    if (!id) return false;

    try {
      const record = agent.readRecord(id);

      // 1. Texto integral (fullHtml): anexa abaixo, com EXATAMENTE 1 linha vazia se ja houver conteudo.
      let atual = (record.fullHtml || '');
      let recebido = (payload.html || '');

      // Remove quebras de linha e espacos das bordas, para nao acumular linhas vazias
      const limparBordas = (s) => s
        .replace(/^(?:\s|&nbsp;|<br\s*\/?>|<div>\s*<\/div>|<p>\s*<\/p>)+/gi, '')
        .replace(/(?:\s|&nbsp;|<br\s*\/?>|<div>\s*<\/div>|<p>\s*<\/p>)+$/gi, '')
        .trim();

      atual = limparBordas(atual);
      recebido = limparBordas(recebido);

      if (!recebido) return false;

      // Detecta se o quadro esta realmente vazio (so placeholder/marcacao vazia)
      const textoAtual = atual.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
      const vazio = textoAtual.length === 0;

      // Detecta se estamos lidando com a estrutura de nodes do editor
      const ehNode = /class\s*=\s*["'][^"']*(node-paragraph|node-toggle|node-text)/i.test(recebido) ||
                     /class\s*=\s*["'][^"']*(node-paragraph|node-toggle|node-text)/i.test(atual);

      if (vazio) {
        record.fullHtml = recebido;
      } else if (ehNode) {
        // Nodes sao blocos: concatena direto (cada node ja ocupa sua linha)
        record.fullHtml = atual + recebido;
      } else {
        // Conteudo simples: separa com 1 linha vazia
        record.fullHtml = atual + '<br><br>' + recebido;
      }

      // 2. Resumo do index: vira o aviso travado e colorido (cor global ja definida).
      record.summaryText = '📩 Novo comentário recebido';
      record.hasSummary = true;
      record.status = 'summarized';
      record.isVirgin = false;

      agent.writeRecord(id, record);

      // 3. Dispara o sync para a nuvem (asmb-sync escuta este evento).
      window.dispatchEvent(new CustomEvent('assembleia:recordchange', { detail: { id: id } }));

      // 4. Atualizacao ao vivo: se o Matheus estiver vendo ESTE quadro no fullsc agora.
      atualizarAoVivoSeNoQuadro(id, record.fullHtml);

      return true;
    } catch (e) {
      return false;
    }
  }

  function quadroAbertoNoFullsc() {
    // Retorna o data-id do quadro aberto no fullsc, ou null se nao estiver no fullsc.
    if (!document.getElementById('editor')) return null;
    try { return new URLSearchParams(location.search).get('id') || null; } catch (e) { return null; }
  }

  function atualizarAoVivoSeNoQuadro(id, fullHtml) {
    const aberto = quadroAbertoNoFullsc();
    if (!aberto || aberto !== id) return; // nao esta vendo este quadro: nada a fazer (ja gravou)

    const editor = document.getElementById('editor');
    if (!editor) return;

    const trimmed = (fullHtml || '').trim();
    editor.innerHTML = '';
    if (trimmed) {
      editor.innerHTML = trimmed;
    }
    if (typeof M3_TextModel !== 'undefined' && M3_TextModel.syncAll) M3_TextModel.syncAll();
    if (typeof M11_Layout !== 'undefined' && M11_Layout.schedule) M11_Layout.schedule(2);

    // Persiste o estado atual do editor pelo caminho normal do fullsc.
    const agent = window.AssembleiaIA;
    if (agent && agent.saveFullDraft) {
      try { agent.saveFullDraft(id, editor.innerHTML); } catch (e) {}
    }
  }

  // ACK: o destinatario confirmou que a mensagem CHEGOU (entrega garantida)
  window.EnvioTextoAck = function(payload) {
    const pend = enviosPendentes[payload.token];
    if (!pend) return;
    if (pend.jaConfirmou) return;
    pend.jaConfirmou = true;
    if (pend.onAck) pend.onAck();
    mostrarToast('Entregue a ' + parNome() + '!');
    // A resposta final (aceitou/recusou) ainda pode chegar via EnvioTextoConfirmacao
  };

  // CONFIRMACAO FINAL: o destinatario aceitou ou recusou
  window.EnvioTextoConfirmacao = function(payload) {
    if (payload.aceito) {
      mostrarToast('Enviado com sucesso a ' + (payload.de_nome || 'usuário') + '!');
    } else {
      mostrarToast((payload.de_nome || 'O usuário') + ' recusou o texto.');
    }
    if (enviosPendentes[payload.token]) delete enviosPendentes[payload.token];
  };
})();
