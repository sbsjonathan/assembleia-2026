(function() {
  if (window.conexaoInicializada) return;
  window.conexaoInicializada = true;
  window.CONEXAO_VERSAO = 'conexao-v9-sessao';
  const tokensVistos = {};
  function jaVisto(token) {
    if (!token) return false;
    if (tokensVistos[token]) return true;
    tokensVistos[token] = Date.now();
    // limpa tokens antigos (mais de 60s)
    const agora = Date.now();
    for (const k in tokensVistos) {
      if (agora - tokensVistos[k] > 60000) delete tokensVistos[k];
    }
    return false;
  }
  try { console.log('[Conexao] versao carregada:', window.CONEXAO_VERSAO); } catch (e) {}

  const NOME_CANAL = 'ass26-presenca-global';
  const CHAVE_PAR = 'sentinela-par-conexao';
  const CHAVE_ATIVO = 'sentinela-conexao-ativa';
  const CHAVE_VER = 'sentinela-ver-online';

  function salvarAtivo(ativo) {
    try {
      if (ativo) localStorage.setItem(CHAVE_ATIVO, '1');
      else localStorage.removeItem(CHAVE_ATIVO);
    } catch (e) {}
  }
  function lerAtivo() {
    try { return localStorage.getItem(CHAVE_ATIVO) === '1'; } catch (e) { return false; }
  }
  function salvarVerOnline(v) {
    try {
      if (v) localStorage.setItem(CHAVE_VER, '1');
      else localStorage.removeItem(CHAVE_VER);
    } catch (e) {}
  }
  function lerVerOnline() {
    try { return localStorage.getItem(CHAVE_VER) === '1'; } catch (e) { return false; }
  }

  let canal = null;
  let sessaoCanal = null;
  let geracaoCanal = 0;
  let pedidoEnviado = null;
  let conectado = false;
  let conectando = false;
  let travaSeguranca = null;
  let parDe = null;          // com quem estou pareado: { id, usuario, nome }
  let pedidoPendente = null; // pedido recebido aguardando resposta

  function gerarCodigo() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }

  function enviarAck(para_id, token, tipo) {
    const eu = obterUsuario();
    if (!eu) return;
    enviarMensagem('envio-ack', { para_id, de_id: eu.id, token, tipo });
  }

  function obterUsuario() {
    if (!window.SupabaseSync || typeof window.SupabaseSync.getCurrentUser !== 'function') return null;
    try {
      const user = window.SupabaseSync.getCurrentUser();
      return window.SupabaseSync.sessionUnavailable ? null : user;
    } catch (_) { return null; }
  }

  function sessaoAtual() {
    const eu = obterUsuario();
    return eu && eu.id != null ? JSON.stringify([String(eu.id), eu.loginId || null]) : null;
  }

  function canalAtual() {
    return !!(canal && sessaoCanal && sessaoCanal === sessaoAtual());
  }

  function enviarMensagem(event, payload) {
    if (!canalAtual() || !conectado) return false;
    try {
      Promise.resolve(canal.send({ type: 'broadcast', event, payload })).catch(() => {});
      return true;
    } catch (_) { return false; }
  }

  function obterCliente() {
    if (!window.SupabaseSync || !window.SupabaseSync.supabase) return null;
    return window.SupabaseSync.supabase;
  }

  // --- Persistencia do par (so um registro do ultimo par aceito; NAO reconecta sozinho) ---
  function salvarPar(par) {
    try {
      if (par) localStorage.setItem(CHAVE_PAR, JSON.stringify({ ...par, conta: sessaoAtual() }));
      else localStorage.removeItem(CHAVE_PAR);
    } catch (e) {}
  }
  function lerParSalvo() {
    try {
      const raw = localStorage.getItem(CHAVE_PAR);
      const par = raw ? JSON.parse(raw) : null;
      return par && par.conta === sessaoAtual() ? par : null;
    } catch (e) { return null; }
  }

  // --- Bubble discreto (canto superior direito) ---
  function injetarEstiloBubble() {
    if (document.getElementById('conexao-bubble-estilo')) return;
    const st = document.createElement('style');
    st.id = 'conexao-bubble-estilo';
    st.textContent =
      '#conexao-bubble{position:fixed;top:calc(8px + env(safe-area-inset-top));right:10px;' +
      'background:rgba(20,20,22,0.82);color:#fff;border-radius:999px;padding:5px 11px;font-size:0.72rem;font-weight:600;' +
      'display:flex;align-items:center;gap:6px;z-index:99999;box-shadow:0 2px 8px rgba(0,0,0,0.2);' +
      '-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);pointer-events:none;max-width:62vw;opacity:0.92;}' +
      '#conexao-bubble .conexao-bubble-dot{font-size:0.6rem;line-height:1;}' +
      '#conexao-bubble .conexao-bubble-txt{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}';
    document.head.appendChild(st);
  }

  function mostrarBubble(nome) {
    injetarEstiloBubble();
    let bubble = document.getElementById('conexao-bubble');
    if (!bubble) {
      bubble = document.createElement('div');
      bubble.id = 'conexao-bubble';
      document.body.appendChild(bubble);
    }
    bubble.innerHTML = '<span class="conexao-bubble-dot">🟢</span><span class="conexao-bubble-txt"></span>';
    bubble.querySelector('.conexao-bubble-txt').textContent = 'Conectado: ' + nome;
  }

  function esconderBubble() {
    const bubble = document.getElementById('conexao-bubble');
    if (bubble) bubble.remove();
  }

  function mostrarBubbleCaiu() {
    injetarEstiloBubble();
    let bubble = document.getElementById('conexao-bubble');
    if (!bubble) {
      bubble = document.createElement('div');
      bubble.id = 'conexao-bubble';
      document.body.appendChild(bubble);
    }
    bubble.innerHTML = '<span class="conexao-bubble-dot">🔴</span><span class="conexao-bubble-txt">Conexão perdida</span>';
  }

  function mostrarBubbleReconectando() {
    injetarEstiloBubble();
    let bubble = document.getElementById('conexao-bubble');
    if (!bubble) {
      bubble = document.createElement('div');
      bubble.id = 'conexao-bubble';
      document.body.appendChild(bubble);
    }
    bubble.innerHTML = '<span class="conexao-bubble-dot">🟡</span><span class="conexao-bubble-txt">Reconectando...</span>';
  }

  // --- UI da lista (so existe no menu do save) ---
  function elLista() { return document.getElementById('online-lista'); }
  function elStatus() { return document.getElementById('online-status'); }

  function mostrarStatus(texto) {
    const s = elStatus();
    if (s) s.textContent = texto;
  }

  function renderLista(usuarios) {
    const lista = elLista();
    if (!lista) return;

    const eu = obterUsuario();
    const meuId = eu ? eu.id : null;

    // Remove duplicatas por id (presence pode listar o mesmo usuario em multiplas abas)
    const vistos = {};
    const outros = [];
    usuarios.forEach((u) => {
      if (u.id === meuId) return;
      if (vistos[u.id]) return;
      vistos[u.id] = true;
      outros.push(u);
    });

    // Preserva um pedido pendente que esteja sendo exibido
    const pedidoEl = lista.querySelector('.online-pedido');

    if (outros.length === 0) {
      lista.innerHTML = '';
      if (pedidoEl) lista.appendChild(pedidoEl);
      else lista.innerHTML = '<div class="online-vazio">Nenhum outro usuário online agora.</div>';
      return;
    }

    lista.innerHTML = '';
    if (pedidoEl) lista.appendChild(pedidoEl);

    outros.forEach((u) => {
      const item = document.createElement('div');
      item.className = 'online-item';
      item.innerHTML = '<span class="online-dot"></span><span class="online-nome"></span><span class="online-acao">Parear</span>';
      item.querySelector('.online-nome').textContent = u.nome || u.usuario || 'Usuário';

      const estaPareadoComEle = parDe && parDe.id === u.id;
      if (estaPareadoComEle) {
        item.querySelector('.online-acao').textContent = '✓ Pareado';
        item.classList.add('online-pareado');
      } else {
        item.addEventListener('click', () => enviarPedido(u));
      }
      lista.appendChild(item);
    });
  }

  function coletarPresentes() {
    if (!canal) return [];
    const estado = canal.presenceState();
    const todos = [];
    Object.keys(estado).forEach((chave) => {
      const entradas = estado[chave];
      entradas.forEach((e) => {
        todos.push({ id: e.id, usuario: e.usuario, nome: e.nome });
      });
    });
    return todos;
  }

  // --- Conexao (so acontece quando a caixinha "permitir" esta ligada) ---
  async function conectar() {
    const cliente = obterCliente();
    const eu = obterUsuario();
    if (!cliente || !eu) { mostrarStatus('Faça login primeiro.'); return; }
    if ((conectado || conectando) && sessaoCanal === sessaoAtual()) return;
    const sessao = sessaoAtual();
    if (sessaoCanal && sessaoCanal !== sessao) await desconectar();
    if (sessao !== sessaoAtual()) return;
    const anterior = canal;
    const geracao = ++geracaoCanal;
    canal = null;
    sessaoCanal = sessao;
    conectado = false;
    conectando = true;
    await liberarCanal(anterior);
    if (geracao !== geracaoCanal || sessao !== sessaoAtual()) return;

    mostrarStatus('Conectando...');
    const novoCanal = cliente.channel(NOME_CANAL, {
      config: { presence: { key: String(eu.id) } }
    });
    canal = novoCanal;
    const vigente = () => geracao === geracaoCanal && canal === novoCanal && sessao === sessaoAtual();
    const escutar = (tipo, filtro, callback) => novoCanal.on(tipo, filtro, (...args) => {
      if (vigente()) callback(...args);
    });

    escutar('presence', { event: 'sync' }, () => {
      renderLista(coletarPresentes());
    });

    escutar('broadcast', { event: 'encerrar-conexao' }, ({ payload }) => {
      const me = obterUsuario();
      if (!me || !payload) return;
      if (payload.para_id !== me.id) return;
      // O par desmarcou "permitir": encerra do meu lado tambem, sem aviso.
      if (parDe && parDe.id === payload.de_id) {
        parDe = null;
        salvarPar(null);
        esconderBubble();
        window.dispatchEvent(new Event('conexao:contextchange'));
      }
    });

    escutar('broadcast', { event: 'pedido-pareamento' }, ({ payload }) => {
      const me = obterUsuario();
      if (!me || !payload) return;
      if (payload.para_id !== me.id) return;
      // Consentimento: so aceita receber pedido se a caixinha estiver ligada
      if (!permitirConexoes || (parDe && parDe.id !== payload.de_id)) {
        enviarMensagem('resposta-pareamento', { para_id: payload.de_id, de_id: me.id, de_nome: me.nome_completo || me.usuario, aceito: false, motivo: 'bloqueado', codigo: payload.codigo });
        return;
      }
      pedidoPendente = payload;
      mostrarPedidoRecebido(payload);
    });

    escutar('broadcast', { event: 'resposta-pareamento' }, ({ payload }) => {
      const me = obterUsuario();
      if (!me || !payload) return;
      if (payload.para_id !== me.id) return;
      tratarResposta(payload);
    });

    escutar('broadcast', { event: 'envio-texto' }, ({ payload }) => {
      const me = obterUsuario();
      if (!me || !payload) return;
      if (payload.para_id !== me.id) return;
      if (!parDe || parDe.id !== payload.de_id) return;
      // Sempre confirma o recebimento (ACK), mesmo se for duplicado, para o remetente saber
      enviarAck(payload.de_id, payload.token, 'chegou');
      if (jaVisto(payload.token)) return;
      if (typeof window.EnvioTextoReceber === 'function') {
        window.EnvioTextoReceber(payload);
      }
    });

    escutar('broadcast', { event: 'envio-ack' }, ({ payload }) => {
      const me = obterUsuario();
      if (!me || !payload) return;
      if (payload.para_id !== me.id) return;
      if (!parDe || parDe.id !== payload.de_id) return;
      if (typeof window.EnvioTextoAck === 'function') {
        window.EnvioTextoAck(payload);
      }
    });

    escutar('broadcast', { event: 'envio-resposta' }, ({ payload }) => {
      const me = obterUsuario();
      if (!me || !payload) return;
      if (payload.para_id !== me.id) return;
      if (!parDe || parDe.id !== payload.de_id) return;
      if (typeof window.EnvioTextoConfirmacao === 'function') {
        window.EnvioTextoConfirmacao(payload);
      }
    });

    novoCanal.subscribe((status) => {
      if (!vigente()) return;
      if (status === 'SUBSCRIBED') {
        conectado = true;
        conectando = false;
        if (travaSeguranca) { clearTimeout(travaSeguranca); travaSeguranca = null; }
        mostrarStatus('Online');
        Promise.resolve(novoCanal.track({
          id: eu.id,
          usuario: eu.usuario,
          nome: eu.nome_completo || eu.usuario
        })).catch(() => { if (vigente()) mostrarStatus('Não foi possível atualizar a presença.'); });
        renderLista(coletarPresentes());
        if (parDe) mostrarBubble(parDe.nome);
        atualizarBotaoVer();
      } else if (status === 'CHANNEL_ERROR' || status === 'CLOSED' || status === 'TIMED_OUT') {
        conectado = false;
        conectando = false;
        if (travaSeguranca) { clearTimeout(travaSeguranca); travaSeguranca = null; }
        // Sem reconexao automatica em loop: apenas informa.
        if (parDe) mostrarBubbleCaiu();
        mostrarStatus('Conexão encerrada.');
      }
    });

    // Trava de seguranca UNICA (nao recorrente): se o subscribe travar e nao disparar nada,
    // apenas libera a flag (NAO reconecta, para evitar loop).
    if (travaSeguranca) clearTimeout(travaSeguranca);
    travaSeguranca = setTimeout(() => {
      travaSeguranca = null;
      if (vigente() && !conectado) {
        conectando = false;
        if (parDe) mostrarBubbleCaiu();
        mostrarStatus('Não foi possível conectar.');
      }
    }, 10000);
  }

  async function liberarCanal(anterior) {
    if (!anterior) return;
    const cliente = obterCliente();
    try { await anterior.untrack(); } catch (_) {}
    try {
      if (cliente && cliente.removeChannel) await cliente.removeChannel(anterior);
      else await anterior.unsubscribe();
    } catch (_) {}
  }

  function desconectar() {
    const eu = obterUsuario();
    if (parDe && eu && canalAtual()) {
      enviarMensagem('encerrar-conexao', { para_id: parDe.id, de_id: eu.id });
    }
    // Invalidate synchronously: late subscribe/ACK callbacks cannot revive this session.
    const anterior = canal;
    geracaoCanal++;
    canal = null;
    sessaoCanal = null;
    if (travaSeguranca) { clearTimeout(travaSeguranca); travaSeguranca = null; }
    conectado = false;
    conectando = false;
    parDe = null;
    pedidoPendente = null;
    pedidoEnviado = null;
    Object.keys(tokensVistos).forEach(token => delete tokensVistos[token]);
    salvarPar(null);
    salvarAtivo(false);
    salvarVerOnline(false);
    permitirConexoes = false;
    esconderBubble();
    mostrarStatus('Desconectado.');
    const lista = elLista();
    if (lista) lista.innerHTML = '';
    const chk = document.getElementById('online-permitir');
    if (chk) chk.checked = false;
    atualizarBotaoVer();
    window.dispatchEvent(new Event('conexao:contextchange'));
    return liberarCanal(anterior);
  }

  // --- Handshake de pareamento ---
  function enviarPedido(usuarioDestino) {
    const eu = obterUsuario();
    if (!eu || !canalAtual() || !conectado) return;
    if (parDe) { mostrarStatus('Você já está pareado. Desconecte primeiro.'); return; }
    if (!permitirConexoes) {
      mostrarStatus('Marque "Permitir que outros se conectem comigo" para poder parear.');
      return;
    }

    const codigo = gerarCodigo();
    pedidoEnviado = { id: usuarioDestino.id, codigo };
    enviarMensagem('pedido-pareamento', {
        de_id: eu.id,
        de_usuario: eu.usuario,
        de_nome: eu.nome_completo || eu.usuario,
        para_id: usuarioDestino.id,
        codigo: codigo
      });
    mostrarStatus('Solicitação enviada para ' + (usuarioDestino.nome || usuarioDestino.usuario) + ' (código ' + codigo + '). Aguardando...');
  }

  function mostrarPedidoRecebido(payload) {
    const lista = elLista();
    if (!lista) return;

    // Remove pedido anterior se houver
    const antigo = lista.querySelector('.online-pedido');
    if (antigo) antigo.remove();

    const aviso = document.createElement('div');
    aviso.className = 'online-pedido';
    aviso.innerHTML =
      '<div class="online-pedido-texto"></div>' +
      '<div class="online-pedido-codigo"></div>' +
      '<div class="online-pedido-botoes">' +
        '<button class="online-btn-aceitar">Aceitar</button>' +
        '<button class="online-btn-recusar">Recusar</button>' +
      '</div>';
    aviso.querySelector('.online-pedido-texto').textContent =
      (payload.de_nome || payload.de_usuario) + ' quer se conectar com você';
    aviso.querySelector('.online-pedido-codigo').textContent = 'Código: ' + payload.codigo;

    aviso.querySelector('.online-btn-aceitar').addEventListener('click', () => responder(true));
    aviso.querySelector('.online-btn-recusar').addEventListener('click', () => responder(false));

    lista.insertBefore(aviso, lista.firstChild);
  }

  function responder(aceito) {
    const eu = obterUsuario();
    if (!eu || !canalAtual() || !conectado || !permitirConexoes || !pedidoPendente) return;

    enviarMensagem('resposta-pareamento', {
        para_id: pedidoPendente.de_id,
        de_id: eu.id,
        de_usuario: eu.usuario,
        de_nome: eu.nome_completo || eu.usuario,
        aceito: aceito,
        codigo: pedidoPendente.codigo
      });

    if (aceito) {
      parDe = { id: pedidoPendente.de_id, usuario: pedidoPendente.de_usuario, nome: pedidoPendente.de_nome };
      salvarPar(parDe);
      mostrarBubble(parDe.nome);
      mostrarStatus('Pareado com ' + parDe.nome + '.');
    } else {
      mostrarStatus('Solicitação recusada.');
    }
    const lista = elLista();
    const ped = lista ? lista.querySelector('.online-pedido') : null;
    if (ped) ped.remove();
    pedidoPendente = null;
    renderLista(coletarPresentes());
  }

  function tratarResposta(payload) {
    if (!permitirConexoes || !pedidoEnviado || pedidoEnviado.id !== payload.de_id || pedidoEnviado.codigo !== payload.codigo) return;
    pedidoEnviado = null;
    if (payload.motivo === 'bloqueado') {
      const nome = payload.de_nome || 'Esse usuário';
      mostrarStatus(nome + ' ainda não permite conexões.');
      return;
    }
    if (payload.aceito) {
      parDe = { id: payload.de_id, usuario: payload.de_usuario, nome: payload.de_nome };
      salvarPar(parDe);
      mostrarBubble(parDe.nome);
      mostrarStatus('Pareado com ' + parDe.nome + '!');
      renderLista(coletarPresentes());
    } else {
      mostrarStatus('Sua solicitação foi recusada.');
    }
  }

  // --- Dois controles independentes ---
  // verOnline: liga a presenca (ver e ser visto). Botao "Ver usuarios online".
  // permitirConexoes: autoriza pareamento. Checkbox "Permitir que outros se conectem".
  let permitirConexoes = false;

  function atualizarBotaoVer() {
    const btn = document.getElementById('btn-online-toggle');
    if (!btn) return;
    if (conectado) {
      btn.textContent = '🔌 Desabilitar ver online';
    } else {
      btn.textContent = '🔌 Ver usuários online';
    }
  }

  function montarUI() {
    const chk = document.getElementById('online-permitir');
    if (chk) {
      permitirConexoes = lerAtivo();
      chk.checked = permitirConexoes;

      if (chk.dataset.bound !== 'true') {
        chk.dataset.bound = 'true';
        chk.addEventListener('change', () => {
          permitirConexoes = chk.checked;
          if (permitirConexoes) {
            salvarAtivo(true);
            // Para permitir conexoes, preciso estar online (visivel)
            if (!conectado) {
              salvarVerOnline(true);
              conectar();
            }
          } else {
            // Desmarcou: encerra qualquer pareamento imediatamente (intencional)
            salvarAtivo(false);
            encerrarPareamento();
          }
        });
      }
    }

    const btn = document.getElementById('btn-online-toggle');
    if (btn && btn.dataset.bound !== 'true') {
      btn.dataset.bound = 'true';
      btn.addEventListener('click', () => {
        if (conectado) {
          // Desligar "ver online" tambem encerra pareamento (nao da pra parear invisivel)
          salvarVerOnline(false);
          salvarAtivo(false);
          permitirConexoes = false;
          if (chk) chk.checked = false;
          desconectar();
        } else {
          salvarVerOnline(true);
          conectar();
        }
      });
    }

    atualizarBotaoVer();
  }

  // Encerra o pareamento atual sem desligar a presenca (usado ao desmarcar "permitir")
  function encerrarPareamento() {
    if (parDe && canalAtual()) {
      // Avisa o par que a conexao foi encerrada (sinal intencional)
      const eu = obterUsuario();
      if (eu) enviarMensagem('encerrar-conexao', { para_id: parDe.id, de_id: eu.id });
    }
    parDe = null;
    pedidoPendente = null;
    pedidoEnviado = null;
    salvarPar(null);
    esconderBubble();
    window.dispatchEvent(new Event('conexao:contextchange'));
  }

  // Reconexao automatica: reconecta a PRESENCA se "ver online" estava ligado.
  // O pareamento so e restaurado se "permitir" tambem estava ligado E ha par salvo.
  function autoReconectar() {
    const querVer = lerVerOnline();
    const querPermitir = lerAtivo();
    if (!querVer && !querPermitir) return;   // nada ligado: nao faz nada

    permitirConexoes = querPermitir;

    const parSalvo = lerParSalvo();
    if (querPermitir && parSalvo) {
      parDe = parSalvo;
      mostrarBubbleReconectando();
    }

    let tentativas = 0;
    const geracao = geracaoCanal;
    const tentar = () => {
      if (geracao !== geracaoCanal) return;
      if (conectado || conectando) return;
      const cliente = obterCliente();
      const eu = obterUsuario();
      if (cliente && eu) {
        conectar();
        return;
      }
      tentativas++;
      if (tentativas < 40) setTimeout(tentar, 300);
      else if (parDe) mostrarBubbleCaiu();
    };
    tentar();
  }

  function verificarSessao() {
    // A transient storage read failure is not a logout; sending remains blocked meanwhile.
    const sessao = sessaoAtual();
    if (window.SupabaseSync && window.SupabaseSync.sessionUnavailable) return;
    if ((sessaoCanal && sessao !== sessaoCanal) || (parDe?.conta && parDe.conta !== sessao)) desconectar();
  }
  window.addEventListener('supabaseLogout', desconectar);
  window.addEventListener('supabaseSessionChanged', verificarSessao);
  window.addEventListener('storage', event => {
    if (event.key === null || event.key === 'supabase_user') verificarSessao();
  });

  document.addEventListener('DOMContentLoaded', () => {
    montarUI();
    autoReconectar();
  });

  window.ConexaoPresenca = {
    conectar: conectar,
    desconectar: desconectar,
    estaConectado: function() { return conectado && canalAtual(); },
    contextoAtual: function() {
      const eu = obterUsuario();
      return eu && canalAtual() && conectado && parDe ? { sessao: sessaoCanal, contaId: eu.id, parId: parDe.id, parNome: parDe.nome, geracao: geracaoCanal } : null;
    },
    contextoValido: function(contexto) {
      return !!(contexto && canalAtual() && parDe && contexto.sessao === sessaoCanal && contexto.geracao === geracaoCanal && contexto.parId === parDe.id);
    },
    parAtual: function() { return parDe; },
    podeEnviar: function() {
      return !!(canalAtual() && conectado && parDe);
    },
    enviarTexto: function(dados, contexto) {
      const eu = obterUsuario();
      if (!eu || !canalAtual() || !conectado || !parDe || (contexto && !this.contextoValido(contexto))) {
        return false;
      }
      return enviarMensagem('envio-texto', {
          de_id: eu.id,
          de_nome: eu.nome_completo || eu.usuario,
          para_id: parDe.id,
          html: dados.html,
          texto: dados.texto,
          quadro_id: dados.quadroId,
          quadro_nome: dados.quadroNome,
          token: dados.token
        });
    },
    responderTexto: function(de_id, token, aceito) {
      const eu = obterUsuario();
      if (!eu || !canalAtual() || !conectado || !parDe || parDe.id !== de_id) return false;
      return enviarMensagem('envio-resposta', {
          de_id: eu.id,
          de_nome: eu.nome_completo || eu.usuario,
          para_id: de_id,
          token: token,
          aceito: aceito
        });
    }
  };
})();
