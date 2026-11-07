(function () {
  const CONFIG = {
    workerUrl: 'https://gem.momentaneo2021.workers.dev',
    modelFallbacks:[
      'gemini-3.1-flash-lite-preview',
      'gemini-3-flash-preview',
      'gemini-2.5-flash'
    ],
    timeoutMs: 30000,
    maxInputChars: 22000,
    maxOutputTokens: 950,
    temperature: 0.35, // Temperatura baixa para garantir o JSON estrito
    topP: 0.9,
    topK: 40,
    cooldownKey: '__sentinela_subtitulo_cooldown__',
    defaultCooldownMs: 30000
  };

  function injectStyles() {
    if (document.getElementById('sentinela-subtitulo-style')) return;
    const style = document.createElement('style');
    style.id = 'sentinela-subtitulo-style';
    style.textContent = `
      .ia-tabs-container { display: flex; flex-direction: column; gap: 12px; position: relative; padding-bottom: 8px; }
      .ia-tabs-header { 
        display: flex; gap: 8px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; margin-bottom: 4px;
      }
      .ia-tab-btn {
        background: none; border: none; padding: 6px 12px; cursor: pointer;
        font-size: 0.85rem; font-weight: 600; color: #9ca3af; border-radius: 4px;
        transition: all 0.2s ease;
      }
      .ia-tab-btn:hover { color: #4b5563; background: #f9fafb; }
      .ia-tab-btn.active { background: #f3f4f6; color: #375255; }
      .ia-tab-content { display: none; animation: fadeInTab 0.3s ease; }
      .ia-tab-content.active { display: block; }
      @keyframes fadeInTab { from { opacity: 0; transform: translateY(2px); } to { opacity: 1; transform: translateY(0); } }
      
      .ia-sub-text { color: #374151; line-height: 1.62; font-size: 0.96rem; margin: 0 0 12px 0; text-align: justify; }
      .ia-sub-text:last-child { margin-bottom: 0; }
      
      .ia-inline-note { font-size: .78rem; color: #6b7280; }
      .ia-status-error { color: #b91c1c; }
      .ia-status-ok { color: #166534; }
      
      html[data-theme="dark"] .ia-tabs-header { border-bottom-color: #5a5a5c; }
      html[data-theme="dark"] .ia-tab-btn { color: #b3b3bb; }
      html[data-theme="dark"] .ia-tab-btn:hover { color: #f2f2f7; background: #3a3a3c; }
      html[data-theme="dark"] .ia-tab-btn.active { background: #f2f2f7; color: #375255; }
      html[data-theme="dark"] .ia-sub-text { color: #f2f2f7; }
      html[data-theme="dark"] .ia-inline-note { color: #a1a1aa; }
      
      @media (prefers-color-scheme: dark) {
        html:not([data-theme="light"]) .ia-tabs-header { border-bottom-color: #5a5a5c; }
        html:not([data-theme="light"]) .ia-tab-btn { color: #b3b3bb; }
        html:not([data-theme="light"]) .ia-tab-btn:hover { color: #f2f2f7; background: #3a3a3c; }
        html:not([data-theme="light"]) .ia-tab-btn.active { background: #f2f2f7; color: #375255; }
        html:not([data-theme="light"]) .ia-sub-text { color: #f2f2f7; }
        html:not([data-theme="light"]) .ia-inline-note { color: #a1a1aa; }
      }
    `;
    document.head.appendChild(style);
  }
  injectStyles();

  function escapeHTML(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function textToHTML(text) {
    return escapeHTML(text).replace(/\n/g, '<br>');
  }

  function normalizeSpaces(text) {
    return String(text || '')
      .replace(/\u200B/g, '')
      .replace(/\r\n?/g, '\n')
      .replace(/[\t\f\v ]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function sanitizeFrontendError(message) {
    const raw = String(message || '').trim();
    if (!raw) return 'Falha ao analisar esta seção.';

    return raw
      .replace(/AIza[0-9A-Za-z_\-]+/g, '[oculto]')
      .replace(/AQ\.[A-Za-z0-9_\-.]+/g, '[oculto]')
      .replace(/api[_ -]?key:[^'\s]+/gi, 'api_key:[oculto]');
  }

  function isConfigured() {
    const url = String(CONFIG.workerUrl || '').trim();
    return /^https?:\/\//i.test(url);
  }

  function safeJSONParse(text) {
    if (!text) return null;
    const cleaned = String(text).replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end < start) return null;
    try {
      return JSON.parse(cleaned.slice(start, end + 1).replace(/,\s*([\]}])/g, '$1'));
    } catch (_) {
      return null;
    }
  }

  function getActiveCooldown(modelName) {
    try {
      const raw = localStorage.getItem(`${CONFIG.cooldownKey}:${modelName}`);
      if (!raw) return { until: 0 };
      const parsed = JSON.parse(raw);
      const until = Number(parsed?.until || 0);
      if (!until || until <= Date.now()) {
        localStorage.removeItem(`${CONFIG.cooldownKey}:${modelName}`);
        return { until: 0 };
      }
      return { until };
    } catch (_) {
      return { until: 0 };
    }
  }

  function setCooldown(modelName, ms) {
    try {
      localStorage.setItem(`${CONFIG.cooldownKey}:${modelName}`, JSON.stringify({
        until: Date.now() + Math.max(1000, Number(ms) || CONFIG.defaultCooldownMs)
      }));
    } catch (_) {}
  }

  function extractRetryAfterMs(message, headers) {
    const retryAfterHeader = headers?.get?.('retry-after');
    const seconds = Number(retryAfterHeader);
    if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
    const match = String(message || '').match(/retry after\s*(\d+(?:\.\d+)?)s/i);
    if (match) return Math.ceil(Number(match[1]) * 1000);
    return CONFIG.defaultCooldownMs;
  }

  function getParagraphText(paragraphElement) {
    const clone = paragraphElement.cloneNode(true);
    const spanNum = clone.querySelector('span');
    let number = '';
    if (spanNum) number = spanNum.textContent.trim();
    clone.querySelectorAll('a.bbl').forEach((link) => {
      link.outerHTML = `[${link.textContent.trim()}] `;
    });
    const text = normalizeSpaces(clone.textContent);
    return { number, text };
  }

  function collectParagraphsFromSectionNode(node, bag) {
    if (!node) return;

    if (node.classList?.contains('paragrafo')) {
      bag.push(node);
    }

    node.querySelectorAll?.('.paragrafo').forEach((paragraph) => {
      if (!bag.includes(paragraph)) bag.push(paragraph);
    });
  }

  function extractSectionBundle(idTrigger) {
    const trigger = document.getElementById(idTrigger);
    if (!trigger) return null;

    const isH1 = trigger.matches('h1.estudo-titulo');
    const tituloArtigo = normalizeSpaces(document.querySelector('.estudo-titulo')?.textContent || '');
    const secaoTitulo = normalizeSpaces(trigger.textContent || '');
    const paragrafoElements =[];
    let current = trigger.nextElementSibling;

    while (current) {
      if (isH1) {
        if (current.matches('h2.subtitulo')) break;
      } else if (current.matches('h2.subtitulo, .secao-recapitulacao')) {
        break;
      }

      collectParagraphsFromSectionNode(current, paragrafoElements);
      current = current.nextElementSibling;
    }

    const paragrafos = paragrafoElements.map((element) => {
      const info = getParagraphText(element);
      return { ...info, element };
    }).filter((item) => item.text && item.text.length > 10);

    const textoCompleto = paragrafos.map((item) => {
      const prefix = item.number ? `PARÁGRAFO ${item.number}: ` : '';
      return `${prefix}${item.text}`;
    }).join('\n\n');

    const firstNumber = paragrafos[0]?.number || '';
    const lastNumber = paragrafos[paragrafos.length - 1]?.number || '';

    return {
      idTrigger,
      tipo: isH1 ? 'h1' : 'h2',
      tituloArtigo,
      secaoTitulo,
      totalParagrafos: paragrafos.length,
      firstNumber,
      lastNumber,
      textoCompleto,
      snapshot: `sub:${idTrigger}:${paragrafos.length}:${textoCompleto.length}:${firstNumber}:${lastNumber}`
    };
  }

  function buildPrompt(bundle) {
    const contextoSecao = bundle.tipo === 'h1'
      ? 'Esta seção corresponde apenas à introdução textual do artigo. Ignore citação, objetivo, cânticos, recapitulação e qualquer outra parte fora dos parágrafos fornecidos.'
      : 'Esta seção corresponde apenas ao subtítulo indicado. Ignore totalmente qualquer parte antes ou depois dos parágrafos fornecidos.';

    const safeText = bundle.textoCompleto.slice(0, 15000);

    return[
      'Você é um irmão cristão maduro e amoroso, como um representante experiente de Betel das Testemunhas de Jeová.',
      'Sua tarefa não é resumir parágrafo por parágrafo, mas sim dar uma visão geral do que esta seção ensina.',
      '',
      'REGRAS DE CONTEÚDO E PERSONALIDADE:',
      '1) Baseie-se APENAS nos parágrafos fornecidos. Não invente detalhes.',
      '2) Fale sempre na primeira pessoa do plural ("nós", "nosso").',
      '3) Use um tom natural, reverente, claro e edificante.',
      '',
      'REGRAS DE FORMATO (CRÍTICO):',
      'O sistema está usando o mimeType application/json. Você DEVE retornar APENAS o JSON.',
      'Você deve retornar um JSON com DUAS chaves estritas:',
      '- "destaque": 1 parágrafo único e EXTREMAMENTE BREVE (máximo de 3 linhas), indo direto ao ponto da essência desta seção.',
      '- "visao_geral": Um array de 1 ou 2 parágrafos curtos, explicando de forma mais elaborada e calorosa a ideia central e o benefício espiritual.',
      '',
      `TÍTULO DO ARTIGO: ${bundle.tituloArtigo}`,
      `TÍTULO DA SEÇÃO: ${bundle.secaoTitulo}`,
      `TIPO DE SEÇÃO: ${bundle.tipo === 'h1' ? 'introdução ligada ao título principal' : 'subtítulo'}`,
      contextoSecao,
      `TOTAL DE PARÁGRAFOS NA SEÇÃO: ${bundle.totalParagrafos}`,
      '',
      'PARÁGRAFOS DA SEÇÃO:',
      safeText,
      '',
      'JSON OBRIGATÓRIO DE SAÍDA:',
      '{',
      '  "destaque": "Nesta seção, o destaque principal é...",',
      '  "visao_geral":[',
      '    "Aqui veremos como...",',
      '    "Esta parte nos ajuda a..."',
      '  ]',
      '}'
    ].join('\n');
  }

  function renderResponseHTML(parsed) {
    const destaqueText = String(parsed?.destaque || '');
    const blocosVisao = Array.isArray(parsed?.visao_geral) ? parsed.visao_geral :[String(parsed?.visao_geral || '')];
    
    const lines =['<div class="ia-tabs-container">'];
    
    // Header das abas
    lines.push('<div class="ia-tabs-header">');
    lines.push(`<button class="ia-tab-btn active" onclick="const c = this.closest('.ia-tabs-container'); c.querySelectorAll('.ia-tab-content').forEach(e=>e.classList.remove('active')); c.querySelector('.ia-tab-destaque').classList.add('active'); c.querySelectorAll('.ia-tab-btn').forEach(e=>e.classList.remove('active')); this.classList.add('active');">Destaque</button>`);
    lines.push(`<button class="ia-tab-btn" onclick="const c = this.closest('.ia-tabs-container'); c.querySelectorAll('.ia-tab-content').forEach(e=>e.classList.remove('active')); c.querySelector('.ia-tab-visao').classList.add('active'); c.querySelectorAll('.ia-tab-btn').forEach(e=>e.classList.remove('active')); this.classList.add('active');">Visão</button>`);
    lines.push('</div>');

    // Aba Destaque
    lines.push('<div class="ia-tab-content ia-tab-destaque active">');
    lines.push(`<p class="ia-sub-text">${textToHTML(destaqueText)}</p>`);
    lines.push('</div>');

    // Aba Visão Geral
    lines.push('<div class="ia-tab-content ia-tab-visao">');
    blocosVisao.filter(Boolean).forEach((texto) => {
      lines.push(`<p class="ia-sub-text">${textToHTML(texto)}</p>`);
    });
    lines.push('</div>');

    if (parsed?.model && typeof window.DEBUG_G !== 'undefined') {
      lines.push(`<div class="ia-inline-note ia-status-ok" style="margin-top: 4px;">Modelo: ${escapeHTML(parsed.model)}</div>`);
    }
    
    lines.push('</div>');
    return lines.join('');
  }

  function extractTextFromResponse(data) {
    const candidates = Array.isArray(data?.candidates) ? data.candidates :[];
    let text = '';
    candidates.forEach((candidate) => {
      const parts = candidate?.content?.parts ||[];
      parts.forEach((part) => {
        if (typeof part?.text === 'string') text += part.text + '\n';
      });
    });
    return text.trim();
  }

  async function requestGemini(prompt, modelName) {
    const cooldown = getActiveCooldown(modelName);
    if (cooldown.until) throw new Error('Modelo em cooldown.');
    if (!isConfigured()) throw new Error('Configure a URL do Worker.');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(new Error('timeout')), CONFIG.timeoutMs);

    try {
      const response = await fetch(String(CONFIG.workerUrl || '').trim(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: String(prompt || '').slice(0, Number(CONFIG.maxInputChars) || 22000),
          modelName,
          isJson: true,
          generationConfig: {
            temperature: CONFIG.temperature,
            topP: CONFIG.topP,
            topK: CONFIG.topK,
            maxOutputTokens: CONFIG.maxOutputTokens
          }
        }),
        signal: controller.signal
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.error) {
        const msg = sanitizeFrontendError(data?.error || data?.message || `Erro ${response.status}`);
        if (response.status === 429 || /quota|rate|limite|cota/i.test(msg)) {
          setCooldown(modelName, extractRetryAfterMs(msg, response.headers));
        }
        throw new Error(msg);
      }

      const text = normalizeSpaces(String(data?.text || ''));
      if (!text) throw new Error('Retorno vazio.');
      return {
        text,
        model: String(data?.model || modelName || '').trim() || modelName
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function requestWithFallback(prompt) {
    let lastError = null;
    for (const model of CONFIG.modelFallbacks) {
      try {
        const result = await requestGemini(prompt, model);
        return { text: result.text, model: result.model || model };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error('Falha ao consultar a IA.');
  }

  function setLoading(wrapper, responseDiv, message) {
    if (wrapper) wrapper.classList.add('ia-loading');
    if (responseDiv) responseDiv.innerHTML = `<div class="ia-inline-note">${escapeHTML(message)}</div>`;
  }

  function clearLoading(wrapper) {
    if (wrapper) wrapper.classList.remove('ia-loading');
  }

  function readCachedPayload(idTrigger) {
    const bundle = extractSectionBundle(idTrigger);
    if (!bundle) return null;
    try {
      const raw = localStorage.getItem(`qa:sub:${idTrigger}`);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed?.snapshot !== bundle.snapshot || !parsed?.html) return null;
      return parsed;
    } catch (_) {
      return null;
    }
  }

  window.AgenteSubResumo = {
    getCachedHTML(idTrigger) {
      return readCachedPayload(idTrigger)?.html || '';
    }
  };

  window.gerarRespostaIA_Subtitulo = async function (idTrigger, wrapperElement, idRespostaIA) {
    const respostaDiv = document.getElementById(idRespostaIA);
    if (!respostaDiv) return;

    const bundle = extractSectionBundle(idTrigger);
    if (!bundle || !bundle.textoCompleto || bundle.totalParagrafos < 1) {
      respostaDiv.innerHTML = '<div class="ia-inline-note ia-status-error">Não encontrei parágrafos suficientes nesta seção.</div>';
      return;
    }

    const cached = readCachedPayload(idTrigger);
    if (cached?.html) {
      respostaDiv.innerHTML = cached.html;
      return;
    }

    setLoading(wrapperElement, respostaDiv, 'Lendo os parágrafos desta seção e preparando a visão geral...');

    try {
      const prompt = buildPrompt(bundle);
      const result = await requestWithFallback(prompt);
      const parsed = safeJSONParse(result.text);
      
      const visao = parsed ? (parsed.visao_geral || parsed.visaoGeral || parsed.VisaoGeral) : null;
      const destaque = parsed ? (parsed.destaque || parsed.Destaque) : null;
      if (!visao || !destaque) throw new Error('Formato de resposta inválido.');

      parsed.visao_geral = Array.isArray(visao) ? visao : [String(visao)];
      parsed.destaque = String(destaque);
      parsed.model = result.model;

      const html = renderResponseHTML(parsed);
      respostaDiv.innerHTML = html;

      try {
        localStorage.setItem(`qa:sub:${idTrigger}`, JSON.stringify({
          snapshot: bundle.snapshot,
          html
        }));
        if (window.CacheAnotacao) window.CacheAnotacao.salvar(idRespostaIA, html);
      } catch (_) {}
    } catch (error) {
      respostaDiv.innerHTML = `<div class="ia-inline-note ia-status-error">Falha ao analisar esta seção: ${escapeHTML(sanitizeFrontendError(error.message))}</div>`;
    } finally {
      clearLoading(wrapperElement);
    }
  };
})();