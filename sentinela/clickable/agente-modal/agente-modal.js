(function () {
  'use strict';
  if (window.ArticleTutor) return;

  const scriptURL = document.currentScript?.src || new URL('../clickable/agente-modal/agente-modal.js', location.href).href;
  let contextModule;
  const loadContext = () => contextModule || (contextModule = import(new URL('agente-contexto.js', scriptURL).href).catch(error => {
    contextModule = null;
    throw error;
  }));
  const CONFIG = {
    workerUrl: 'https://gem.momentaneo2021.workers.dev',
    models: ['gemini-3.1-flash-lite-preview', 'gemini-3-flash-preview', 'gemini-2.5-flash'],
    timeoutMs: 40000,
    cooldownKey: '__sentinela_modal_cooldown__'
  };
  const icons = {
    grip: '<path d="M8 6h.01M16 6h.01M8 12h.01M16 12h.01M8 18h.01M16 18h.01" stroke-width="3"/>',
    minimize: '<path d="M5 16h14"/>',
    expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
    restore: '<path d="M9 3v6H3m12-6v6h6M9 21v-6H3m12 6v-6h6"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    send: '<path d="M12 19V5m-6 6 6-6 6 6"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>',
    chat: '<path d="M20 11.5a8 8 0 0 1-8 8 9 9 0 0 1-3-.5l-5 2 1.5-5A8 8 0 1 1 20 11.5Z"/><path d="M8 11h8m-8 4h5"/>',
    reset: '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>'
  };
  const svg = name => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[ch]));
  const richText = value => escapeHTML(value).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  const sessions = new Map();
  let activeId = null, mode = 'closed', restoreMode = 'window', openToken = 0;
  let overlay, bubble, probe, area, thread, status, sendButton;
  let preferredPosition = null, bubblePosition = {edge: 'right', y: null}, layoutFrame = 0;
  let fullscreenRestore = null;
  const active = () => sessions.get(activeId);

  function ensureUI() {
    if (overlay) return;
    overlay = document.createElement('section');
    overlay.id = 'modal-agente';
    overlay.hidden = true;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-labelledby', 'agente-titulo agente-contexto');
    overlay.innerHTML = `<div class="modal-agente-content">
      <header class="modal-agente-header">
        <div id="agente-drag" tabindex="0" role="button" aria-label="Mover janela do tutor. Use as setas do teclado.">
          ${svg('grip')}<div class="agente-heading"><h3 id="agente-titulo">Tutor IA</h3><span id="agente-contexto"></span></div>
        </div>
        <div class="agente-window-actions">
          <button type="button" id="agente-minimizar" class="agente-icon-button" aria-label="Minimizar tutor" title="Minimizar">${svg('minimize')}</button>
          <button type="button" id="agente-expandir" class="agente-icon-button" aria-label="Tela cheia" title="Tela cheia">${svg('expand')}</button>
          <button type="button" id="agente-fechar" class="agente-icon-button" aria-label="Fechar tutor" title="Fechar">${svg('close')}</button>
        </div>
      </header>
      <div id="agente-thread" class="agente-thread" role="log" aria-label="Conversa com o tutor" aria-live="polite" aria-relevant="additions text" tabindex="0"></div>
      <form id="agente-composer">
        <div class="agente-input-row"><textarea id="agente-pergunta" rows="1" maxlength="8000" aria-label="Mensagem para o tutor" placeholder="Pergunte sobre este trecho…" autocomplete="off" autocapitalize="sentences" spellcheck="true"></textarea>
          <button id="agente-enviar" type="submit" class="agente-send" aria-label="Enviar mensagem" title="Enviar mensagem">${svg('send')}</button></div>
        <div class="agente-composer-meta"><button id="agente-reset" type="button">${svg('reset')}<span>Nova conversa</span></button><span class="agente-scope-hint">Conversa deste parágrafo</span></div>
        <div id="agente-status" role="status" hidden></div>
      </form>
    </div>`;
    bubble = document.createElement('button');
    bubble.id = 'agente-bolinha';
    bubble.type = 'button';
    bubble.hidden = true;
    bubble.innerHTML = `${svg('chat')}<span class="agente-bubble-label"></span><span class="agente-bubble-dot" aria-hidden="true"></span>`;
    probe = document.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = 'position:fixed;pointer-events:none;visibility:hidden;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px);width:0;height:0;';
    document.body.append(overlay, bubble, probe);
    area = overlay.querySelector('#agente-pergunta');
    thread = overlay.querySelector('#agente-thread');
    status = overlay.querySelector('#agente-status');
    sendButton = overlay.querySelector('#agente-enviar');
    overlay.querySelector('#agente-minimizar').addEventListener('click', minimize);
    overlay.querySelector('#agente-expandir').addEventListener('click', toggleFullscreen);
    overlay.querySelector('#agente-fechar').addEventListener('click', close);
    overlay.querySelector('#agente-reset').addEventListener('click', () => {
      const session = active();
      if (!session) return;
      session.request?.abort();
      session.request = null;
      session.messages = [];
      session.error = '';
      session.retry = '';
      session.unread = false;
      render(true);
    });
    overlay.querySelector('#agente-composer').addEventListener('submit', event => {
      event.preventDefault();
      if (active()?.request) stopRequest(active());
      else send();
    });
    area.addEventListener('input', () => {
      if (active()) active().draft = area.value;
      resizeComposer();
      updateControls();
    });
    area.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing &&
          (!matchMedia('(pointer: coarse)').matches || event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        if (!active()?.request) send();
      }
    });
    makeDraggable(overlay.querySelector('#agente-drag'), overlay, false);
    makeDraggable(bubble, bubble, true);
    overlay.querySelector('#agente-drag').addEventListener('keydown', moveByKey);
    bubble.addEventListener('keydown', moveByKey);
    document.addEventListener('keydown', event => {
      if (mode === 'closed' || mode === 'minimized') return;
      if (event.key === 'Escape') {
        event.preventDefault();
        if (mode === 'fullscreen') toggleFullscreen();
        else close();
      }
      if (event.key === 'Tab' && mode === 'fullscreen') trapFocus(event);
    });
    window.addEventListener('resize', scheduleLayout, {passive: true});
    window.addEventListener('pageshow', scheduleLayout);
    window.visualViewport?.addEventListener('resize', scheduleLayout, {passive: true});
    window.visualViewport?.addEventListener('scroll', scheduleLayout, {passive: true});
  }

  function viewport() {
    const vv = window.visualViewport;
    const css = getComputedStyle(probe);
    return {x: vv?.offsetLeft || 0, y: vv?.offsetTop || 0,
      width: vv?.width || window.innerWidth, height: vv?.height || window.innerHeight,
      top: parseFloat(css.paddingTop) || 0, right: parseFloat(css.paddingRight) || 0,
      bottom: parseFloat(css.paddingBottom) || 0, left: parseFloat(css.paddingLeft) || 0};
  }
  const clamp = (number, min, max) => Math.max(min, Math.min(number, Math.max(min, max)));
  function layout() {
    if (!overlay || mode === 'closed') return;
    const v = viewport();
    if (mode === 'minimized') {
      const size = bubble.offsetWidth || 54;
      const minY = v.y + v.top + 12;
      const maxY = v.y + v.height - v.bottom - size - 92;
      bubble.style.left = `${bubblePosition.edge === 'left' ? v.x + v.left + 10 : v.x + v.width - v.right - size - 10}px`;
      bubble.style.top = `${clamp(bubblePosition.y ?? v.y + v.height * .58, minY, maxY)}px`;
      return;
    }
    const fullscreen = mode === 'fullscreen';
    const width = fullscreen ? v.width : Math.min(540, v.width - v.left - v.right - 24);
    const height = fullscreen ? v.height : Math.min(500, v.height - v.top - v.bottom - 24);
    overlay.style.width = `${Math.max(0, width)}px`;
    overlay.style.height = `${Math.max(0, height)}px`;
    overlay.style.maxHeight = `${Math.max(0, height)}px`;
    overlay.dataset.compact = String(height < 340);
    overlay.style.left = `${fullscreen ? v.x : clamp(preferredPosition?.x ?? v.x + (v.width - width) / 2, v.x + v.left + 12, v.x + v.width - v.right - width - 12)}px`;
    overlay.style.top = `${fullscreen ? v.y : clamp(preferredPosition?.y ?? v.y + (v.height - height) / 2, v.y + v.top + 12, v.y + v.height - v.bottom - height - 12)}px`;
    // Only the transcript scrolls. Never scroll the article or refocus the editor
    // to compensate for an iOS keyboard/visualViewport transition.
  }
  function scheduleLayout() {
    if (!layoutFrame) layoutFrame = requestAnimationFrame(() => {layoutFrame = 0; layout();});
  }
  function resizeComposer() {
    area.style.height = 'auto';
    area.style.height = `${Math.min(112, area.scrollHeight)}px`;
  }
  function fullscreenIsolation(enable) {
    if (enable && !fullscreenRestore) {
      const siblings = [...document.body.children].filter(node => node !== overlay && node !== bubble && node !== probe);
      fullscreenRestore = {overflow: document.documentElement.style.overflow, siblings: siblings.map(node => [node, node.inert])};
      document.documentElement.style.overflow = 'hidden';
      siblings.forEach(node => {node.inert = true;});
    } else if (!enable && fullscreenRestore) {
      document.documentElement.style.overflow = fullscreenRestore.overflow;
      fullscreenRestore.siblings.forEach(([node, inert]) => {node.inert = inert;});
      fullscreenRestore = null;
    }
  }
  function applyMode(next) {
    mode = next;
    fullscreenIsolation(next === 'fullscreen');
    overlay.hidden = next === 'closed' || next === 'minimized';
    bubble.hidden = next !== 'minimized';
    overlay.dataset.mode = next;
    overlay.setAttribute('aria-modal', String(next === 'fullscreen'));
    const full = next === 'fullscreen';
    const expand = overlay.querySelector('#agente-expandir');
    expand.innerHTML = svg(full ? 'restore' : 'expand');
    expand.setAttribute('aria-label', full ? 'Restaurar janela' : 'Tela cheia');
    expand.title = full ? 'Restaurar janela' : 'Tela cheia';
    overlay.querySelector('#agente-drag').tabIndex = full ? -1 : 0;
    layout();
    if (!overlay.hidden) resizeComposer();
  }
  async function open(trigger) {
    ensureUI();
    const token = ++openToken;
    let context;
    try { context = (await loadContext()).buildContext(trigger); }
    catch (_) {
      context = {id: `unavailable:${location.pathname}`, title: 'Trecho indisponível', range: '?', question: '', ready: false,
        error: 'Não foi possível carregar o tutor. Conecte-se e atualize a página.'};
    }
    if (token !== openToken) return;
    if (active()) active().draft = area.value;
    if (!sessions.has(context.id)) sessions.set(context.id, {context, messages: [], draft: '', request: null, error: '', retry: '', unread: false, trigger});
    activeId = context.id;
    const session = active();
    session.context = context;
    session.trigger = trigger;
    session.unread = false;
    overlay.dataset.sessionId = context.id;
    area.value = session.draft;
    applyMode(mode === 'fullscreen' ? 'fullscreen' : 'window');
    restoreMode = mode;
    render(true);
  }
  function blurComposer() {
    if (overlay.contains(document.activeElement)) document.activeElement.blur();
  }
  function minimize() {
    if (!active() || mode === 'closed' || mode === 'minimized') return;
    active().draft = area.value;
    restoreMode = mode;
    blurComposer();
    applyMode('minimized');
    updateBubble();
    bubble.focus({preventScroll: true});
  }
  function restore() {
    if (!active()) return;
    active().unread = false;
    applyMode(restoreMode === 'fullscreen' ? 'fullscreen' : 'window');
    area.value = active().draft;
    render(false);
    overlay.querySelector('#agente-minimizar').focus({preventScroll: true});
  }
  function close() {
    ++openToken;
    if (!overlay) return;
    if (active()) active().draft = area.value;
    blurComposer();
    applyMode('closed');
    const trigger = active()?.trigger;
    if (trigger?.isConnected) trigger.focus({preventScroll: true});
  }
  function toggleFullscreen() {
    if (!active() || mode === 'closed' || mode === 'minimized') return;
    applyMode(mode === 'fullscreen' ? 'window' : 'fullscreen');
    restoreMode = mode;
    overlay.querySelector('#agente-expandir').focus({preventScroll: true});
  }
  function trapFocus(event) {
    const controls = [...overlay.querySelectorAll('button:not(:disabled), textarea:not(:disabled), [tabindex="0"]')].filter(node => node.offsetParent);
    if (!controls.length) return;
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && (document.activeElement === first || !overlay.contains(document.activeElement))) {
      event.preventDefault(); last.focus({preventScroll: true});
    } else if (!event.shiftKey && (document.activeElement === last || !overlay.contains(document.activeElement))) {
      event.preventDefault(); first.focus({preventScroll: true});
    }
  }

  function updateBubble() {
    const session = active();
    if (!session) return;
    bubble.querySelector('.agente-bubble-label').textContent = session.context.range;
    bubble.classList.toggle('is-pending', Boolean(session.request));
    bubble.classList.toggle('has-unread', session.unread);
    bubble.setAttribute('aria-label', `Abrir Tutor IA · ${session.context.title}${session.unread ? ' · nova resposta' : ''}`);
    bubble.title = `Tutor IA · ${session.context.title}. Arraste para mover.`;
  }
  function updateControls() {
    const session = active();
    if (!session) return;
    const pending = Boolean(session.request);
    sendButton.innerHTML = svg(pending ? 'stop' : 'send');
    sendButton.setAttribute('aria-label', pending ? 'Parar resposta' : 'Enviar mensagem');
    sendButton.title = pending ? 'Parar resposta' : 'Enviar mensagem';
    sendButton.disabled = !pending && (!area.value.trim() || !session.context.ready);
    area.disabled = !session.context.ready;
    overlay.querySelector('#agente-reset').disabled = !session.messages.length;
    overlay.querySelector('.agente-scope-hint').textContent = session.context.numbers?.length > 1 ? 'Conversa destes parágrafos' : 'Conversa deste parágrafo';
    status.replaceChildren();
    const message = session.error || (!session.context.ready ? session.context.error : '') || (pending ? 'O tutor está preparando a resposta…' : '');
    status.hidden = !message;
    status.classList.toggle('is-error', Boolean(session.error || !session.context.ready));
    status.append(document.createTextNode(message || ''));
    if (session.retry && !pending) {
      const retry = document.createElement('button');
      retry.id = 'agente-retry'; retry.type = 'button'; retry.textContent = 'Tentar novamente';
      retry.addEventListener('click', () => send(session.retry));
      status.append(retry);
    }
    updateBubble();
  }
  function render(scrollToEnd) {
    const session = active();
    if (!session) return;
    const previousScroll = thread.scrollTop;
    const atEnd = thread.scrollHeight - previousScroll - thread.clientHeight < 60;
    overlay.querySelector('#agente-contexto').textContent = session.context.title;
    if (!session.messages.length) {
      thread.innerHTML = `<div class="agente-thread-empty"><span class="agente-empty-icon">${svg('chat')}</span><strong>${escapeHTML(session.context.title)}</strong><p>${escapeHTML(session.context.question || 'O que você gostaria de entender melhor?')}</p><small>Explore este trecho com o tutor. Informações de fora serão diferenciadas na resposta.</small></div>`;
    } else {
      thread.innerHTML = session.messages.map(message => `<article class="agente-message agente-message--${message.role === 'assistant' ? 'assistant' : 'user'}"><div class="agente-message-meta">${message.role === 'assistant' ? 'Tutor IA' : 'Você'}</div><div class="agente-message-text">${richText(message.text)}</div>${message.failed ? '<span class="agente-message-status">Sem resposta</span>' : ''}</article>`).join('');
    }
    updateControls();
    resizeComposer();
    thread.scrollTop = scrollToEnd || atEnd ? thread.scrollHeight : previousScroll;
  }

  function errorMessage(error) {
    if (/timeout|tempo/i.test(error?.message || '')) return 'A resposta demorou demais. Você pode tentar novamente.';
    if (/429|quota|rate|aguarde/i.test(error?.message || '')) return 'O tutor está com muitas solicitações. Aguarde um pouco e tente novamente.';
    if (/context|trecho|parágrafo/i.test(error?.message || '')) return error.message;
    return 'Não foi possível obter a resposta. Confira sua conexão e tente novamente.';
  }
  function cooldown(model) {
    try { return JSON.parse(localStorage.getItem(`${CONFIG.cooldownKey}:${model}`) || '{}').until > Date.now(); }
    catch (_) { return false; }
  }
  async function requestWorker(prompt, parts, signal) {
    let lastError;
    for (const model of CONFIG.models) {
      signal.throwIfAborted();
      if (cooldown(model)) {lastError = new Error('aguarde'); continue;}
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal.addEventListener('abort', abort, {once: true});
      let timedOut = false;
      const timer = setTimeout(() => {timedOut = true; controller.abort();}, CONFIG.timeoutMs);
      try {
        const response = await fetch(CONFIG.workerUrl, {
          method: 'POST', headers: {'Content-Type': 'application/json'}, signal: controller.signal,
          body: JSON.stringify({prompt, parts, modelName: model, isJson: false,
            generationConfig: {temperature: .65, topP: .95, topK: 40, maxOutputTokens: 2000}, tools: [{googleSearch: {}}]})
        });
        const data = await response.json();
        if (!response.ok || data?.error) {
          if (response.status === 429) {
            const seconds = Number(response.headers.get('retry-after'));
            try {localStorage.setItem(`${CONFIG.cooldownKey}:${model}`, JSON.stringify({until: Date.now() + (seconds > 0 ? seconds * 1000 : 30000)}));} catch (_) {}
          }
          throw new Error(response.status === 429 ? '429' : String(data?.error || 'Falha na resposta'));
        }
        const text = String(data?.text || '').trim();
        if (!text) throw new Error('Resposta vazia');
        return text;
      } catch (error) {
        signal.throwIfAborted();
        lastError = timedOut ? new Error('timeout') : error;
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
      }
    }
    throw lastError || new Error('aguarde');
  }
  function stopRequest(session) {
    const request = session.request;
    if (!request) return;
    request.abort();
    session.request = null;
    const last = session.messages[session.messages.length - 1];
    if (last?.role === 'user') { last.failed = true; session.retry = last.text; }
    session.error = 'Resposta interrompida.';
    render(false);
  }
  async function send(retryText) {
    const session = active();
    const question = String(retryText || area.value).trim();
    if (!session || !session.context.ready || session.request || !question) return;
    const request = new AbortController();
    session.request = request;
    session.error = ''; session.retry = '';
    const history = session.messages.filter(message => !message.failed);
    if (retryText && session.messages.at(-1)?.failed && session.messages.at(-1).text === retryText) session.messages.pop();
    const userMessage = {role: 'user', text: question};
    session.messages.push(userMessage);
    if (!retryText) {session.draft = ''; area.value = '';}
    render(true);
    try {
      const module = await loadContext();
      request.signal.throwIfAborted();
      const prompt = module.buildPrompt({context: session.context, question, messages: history});
      const parts = await module.collectImageParts(session.context, question, request.signal);
      const result = await requestWorker(prompt, [{text: prompt}, ...parts], request.signal);
      if (session.request !== request) return;
      session.messages.push({role: 'assistant', text: result});
      session.unread = activeId !== session.context.id || mode === 'minimized' || mode === 'closed';
    } catch (error) {
      if (session.request !== request) return;
      userMessage.failed = true;
      session.retry = question;
      session.error = errorMessage(error);
    } finally {
      if (session.request === request) {
        session.request = null;
        if (active() === session) render(false);
      }
    }
  }

  function makeDraggable(handle, element, isBubble) {
    let drag = null, suppressClick = false;
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0 || (!isBubble && mode !== 'window')) return;
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      drag = {id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, moved: false};
      suppressClick = false;
      handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointermove', event => {
      if (!drag || event.pointerId !== drag.id) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 6) return;
      drag.moved = true;
      element.classList.add('is-dragging');
      const v = viewport(), rect = element.getBoundingClientRect();
      const x = clamp(drag.left + dx, v.x + v.left + 10, v.x + v.width - v.right - rect.width - 10);
      const y = clamp(drag.top + dy, v.y + v.top + 10, v.y + v.height - v.bottom - rect.height - 10);
      element.style.left = `${x}px`; element.style.top = `${y}px`;
      if (!isBubble) preferredPosition = {x, y};
    });
    const finish = event => {
      if (!drag || event.pointerId !== drag.id) return;
      const moved = drag.moved;
      suppressClick = moved || event.type === 'pointercancel';
      drag = null;
      element.classList.remove('is-dragging');
      if (isBubble && moved) {
        const rect = element.getBoundingClientRect(), v = viewport();
        bubblePosition = {edge: rect.left + rect.width / 2 < v.x + v.width / 2 ? 'left' : 'right', y: rect.top};
        layout();
      }
    };
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
    handle.addEventListener('lostpointercapture', finish);
    handle.addEventListener('click', event => {
      if (suppressClick) {event.preventDefault(); suppressClick = false; return;}
      if (isBubble) restore();
    });
  }
  function moveByKey(event) {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    if (mode !== 'window' && mode !== 'minimized') return;
    event.preventDefault();
    const rect = event.currentTarget === bubble ? bubble.getBoundingClientRect() : overlay.getBoundingClientRect();
    const step = event.shiftKey ? 40 : 16;
    if (event.currentTarget === bubble) {
      bubblePosition.y = rect.top + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0);
      if (event.key === 'ArrowLeft') bubblePosition.edge = 'left';
      if (event.key === 'ArrowRight') bubblePosition.edge = 'right';
    } else preferredPosition = {x: rect.left + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0), y: rect.top + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0)};
    layout();
  }

  let press = null, suppressedTrigger = null, suppressUntil = 0, activatedPointer = null;
  function numberTrigger(target) {
    const span = target?.closest?.('.pergunta span');
    return span && /^\s*\d+(?:\s*[-–—]\s*\d+)?\.?\s*$/.test(span.textContent) ? span : null;
  }
  function cancelPress() {
    if (!press) return;
    clearTimeout(press.timer);
    press.trigger.classList.remove('agente-pressing');
    press = null;
  }
  document.addEventListener('pointerdown', event => {
    cancelPress();
    const trigger = numberTrigger(event.target);
    if (!trigger || event.button !== 0) return;
    const current = {trigger, id: event.pointerId, x: event.clientX, y: event.clientY};
    current.timer = setTimeout(() => {
      if (press !== current) return;
      suppressedTrigger = trigger;
      activatedPointer = current.id;
      suppressUntil = Date.now() + 1500;
      cancelPress();
      navigator.vibrate?.(30);
      open(trigger);
    }, 1000);
    press = current;
    trigger.classList.add('agente-pressing');
  }, {passive: true});
  document.addEventListener('pointermove', event => {
    if (press && (event.pointerId !== press.id || Math.hypot(event.clientX - press.x, event.clientY - press.y) > 10)) cancelPress();
  }, {passive: true});
  ['pointerup', 'pointercancel'].forEach(name => document.addEventListener(name, event => {
    cancelPress();
    if (event.pointerId === activatedPointer) {
      suppressUntil = Date.now() + 1000;
      activatedPointer = null;
    }
  }, {passive: true}));
  document.addEventListener('scroll', cancelPress, {capture: true, passive: true});
  document.addEventListener('contextmenu', event => {if (numberTrigger(event.target)) event.preventDefault();});
  document.addEventListener('click', event => {
    if (Date.now() < suppressUntil && numberTrigger(event.target) === suppressedTrigger) {
      event.preventDefault(); event.stopImmediatePropagation(); suppressedTrigger = null;
    }
  }, true);
  document.addEventListener('keydown', event => {
    const trigger = numberTrigger(event.target);
    if (trigger && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      open(trigger).then(() => overlay.querySelector('#agente-fechar').focus({preventScroll: true}));
    }
  });
  function labelTriggers() {
    document.querySelectorAll('.pergunta span').forEach(span => {
      if (!numberTrigger(span)) return;
      span.tabIndex = 0;
      span.setAttribute('role', 'button');
      span.setAttribute('aria-haspopup', 'dialog');
      span.setAttribute('aria-label', `Tutor IA do parágrafo ${span.textContent.trim().replace(/\.$/, '')}. Toque e segure para abrir.`);
      span.title = 'Toque e segure para conversar com o Tutor IA';
    });
  }
  function start() {
    ensureUI();
    labelTriggers();
    // Articles can be inserted by the first-load fallback after DOMContentLoaded.
    new MutationObserver(records => {
      if (records.some(record => [...record.addedNodes].some(node => node.nodeType === 1 && !overlay.contains(node) && node !== bubble))) labelTriggers();
    }).observe(document.body, {childList: true, subtree: true});
  }
  window.ArticleTutor = Object.freeze({open, minimize, restore, close, toggleFullscreen,
    getState: () => ({mode, activeId, pending: Boolean(active()?.request)})});
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once: true});
  else start();
})();
