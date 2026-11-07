(function () {
  const CONFIG = {
    workerUrl: 'https://gem.jonathan-sbs01.workers.dev',
    modelFallbacks:[
      'gemini-3.1-flash-lite-preview',
      'gemini-3-flash-preview',
      'gemini-2.5-flash'
    ],
    timeoutMs: 30000,
    maxInputChars: 40000,
    maxOutputTokens: 1500,
    temperature: 0.25,
    topP: 0.85,
    topK: 30,
    cooldownKey: '__sentinela_recap_cooldown__',
    defaultCooldownMs: 30000
  };

  function injectStyles() {
    if (document.getElementById('sentinela-recap-style')) return;
    const style = document.createElement('style');
    style.id = 'sentinela-recap-style';
    style.textContent = `
      .ia-recap-container { display: flex; flex-direction: column; gap: 12px; }
      .ia-recap-answer { color: #374151; line-height: 1.6; font-size: 0.95rem; text-align: justify; }
      .ia-recap-refs { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; border-top: 1px solid #e5e7eb; padding-top: 12px; }
      .ia-ref-chip {
        appearance: none; border: 1px solid rgba(55,82,85,.18); border-radius: 999px;
        background: rgba(55,82,85,.05); color: #375255; padding: 6px 12px;
        font-size: .8rem; font-weight: 600; line-height: 1; cursor: pointer; transition: all 0.2s;
      }
      .ia-ref-chip:hover { background: rgba(55,82,85,.1); transform: scale(1.02); }
      .ia-ref-chip:active { transform: scale(.97); }
      .ia-inline-note { font-size: .78rem; color: #6b7280; }
      .ia-status-error { color: #b91c1c; }
      .ia-status-ok { color: #166534; }
      @keyframes paragrafo-pulse {
        0% { background: transparent; box-shadow: none; transform: scale(1); }
        50% { background: linear-gradient(90deg, rgba(255,215,0,0.25) 0%, rgba(255,215,0,0.15) 50%, rgba(255,215,0,0.25) 100%); box-shadow: 0 0 25px rgba(255,215,0,0.4); transform: scale(1.02); }
        100% { background: linear-gradient(90deg, rgba(255,215,0,0.2) 0%, rgba(255,215,0,0.1) 50%, rgba(255,215,0,0.2) 100%); box-shadow: 0 0 20px rgba(255,215,0,0.3); transform: scale(1); }
      }
      .paragrafo-destaque { animation: paragrafo-pulse 0.8s ease-in-out; border-radius: 8px; padding: 8px; margin: -8px; }
    `;
    document.head.appendChild(style);
  }
  injectStyles();

  function escapeHTML(text) {
    return String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function textToHTML(text) {
    return escapeHTML(text).replace(/\n/g, '<br>');
  }

  function normalizeSpaces(text) {
    return String(text || '').replace(/\u200B/g, '').replace(/\r\n?/g, '\n').replace(/[\t\f\v ]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  }

  function stripSelectionArtifacts(text) {
    return normalizeSpaces(String(text || '').replace(/[“”]/g, '"').replace(/[‘’´`]/g, "'").replace(/[–—−]/g, '-'));
  }

  function normalizeForMatch(text) {
    return normalizeSpaces(stripSelectionArtifacts(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase());
  }

  function sanitizeFrontendError(message) {
    const raw = String(message || '').trim();
    if (!raw) return 'Falha ao consultar a IA.';

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
    let cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end >= start) {
      let jsonStr = cleaned.slice(start, end + 1);
      jsonStr = jsonStr.replace(/,\s*([\]}])/g, '$1');
      try { return JSON.parse(jsonStr); } catch (e) { return null; }
    }
    return null;
  }

  function boundedLevenshtein(a, b, maxDistance) {
    const left = normalizeSpaces(a || '');
    const right = normalizeSpaces(b || '');
    if (left === right) return 0;
    const limit = Math.max(0, Number(maxDistance) || 0);
    let aText = left; let bText = right; let aLen = aText.length; let bLen = bText.length;
    if (Math.abs(aLen - bLen) > limit) return limit + 1;
    if (aLen > bLen) {[aText, bText] =[bText, aText];[aLen, bLen] = [bLen, aLen];}
    let prev = new Array(bLen + 1).fill(limit + 1);
    let curr = new Array(bLen + 1).fill(limit + 1);
    for (let j = 0; j <= Math.min(bLen, limit); j += 1) prev[j] = j;
    for (let i = 1; i <= aLen; i += 1) {
      curr.fill(limit + 1);
      const from = Math.max(1, i - limit);
      const to = Math.min(bLen, i + limit);
      if (from === 1) curr[0] = i;
      let rowMin = limit + 1;
      for (let j = from; j <= to; j += 1) {
        const cost = aText.charCodeAt(i - 1) === bText.charCodeAt(j - 1) ? 0 : 1;
        curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
        if (curr[j] < rowMin) rowMin = curr[j];
      }
      if (rowMin > limit) return limit + 1;[prev, curr] =[curr, prev];
    }
    return prev[bLen];
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
    } catch (_) { return { until: 0 }; }
  }

  function setCooldown(modelName, ms) {
    try {
      localStorage.setItem(`${CONFIG.cooldownKey}:${modelName}`, JSON.stringify({ until: Date.now() + Math.max(1000, Number(ms) || CONFIG.defaultCooldownMs) }));
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

  function extrairBundleRecap(idPergunta) {
    const liElement = document.getElementById(idPergunta);
    if (!liElement) return null;

    let perguntaRecap = '';
    const cloneLi = liElement.cloneNode(true);
    cloneLi.querySelectorAll('.anotacao, .comentarios, .btn-gerar-ia').forEach(el => el.remove());
    perguntaRecap = normalizeSpaces(cloneLi.textContent);

    let tituloRecap = document.querySelector('.titulo-recapitulacao')?.textContent?.trim() || '';

    let textoCompleto = '';
    const paragrafos =[];
    const todosParagrafos = document.querySelectorAll('.paragrafo');
    todosParagrafos.forEach(p => {
      const clone = p.cloneNode(true);
      const spanNum = clone.querySelector('span');
      let num = null;
      let prefixo = '';
      if (spanNum) {
        const match = spanNum.textContent.match(/\d+/);
        if (match) num = Number(match[0]);
        prefixo = `PARÁGRAFO ${spanNum.textContent.trim()}: `;
      }
      clone.querySelectorAll('a.bbl, .anotacao, .comentarios').forEach(el => {
        if(el.tagName === 'A') el.outerHTML = `[${el.textContent.trim()}] `;
        else el.remove();
      });
      let texto = clone.textContent.replace(/\s+/g, ' ').trim();
      if (texto && texto.length > 10) {
        textoCompleto += `${prefixo}${texto}\n\n`;
        if (num) paragrafos.push({ number: num, element: p, text: texto });
      }
    });

    return {
      idPergunta,
      tituloRecap,
      perguntaRecap,
      textoCompleto,
      paragrafos,
      snapshot: `recap:${tituloRecap.slice(0,10)}:${perguntaRecap.slice(0,10)}:${textoCompleto.length}`
    };
  }

  function buildPrompt(bundle) {
    return[
      'Você é um irmão cristão maduro e amoroso, como um representante experiente de Betel das Testemunhas de Jeová.',
      'Sua tarefa é responder a uma pergunta da seção de recapitulação baseando-se APENAS no artigo fornecido.',
      '',
      'REGRAS DE PERSONALIDADE E FORMATO:',
      '1) Fale na primeira pessoa do plural ("nós", "nosso"), incluindo-se na fraternidade cristã.',
      '2) Retorne APENAS um JSON válido. Não use formatação Markdown (```json). Escape aspas duplas corretamente com \\".',
      '3) A chave "natural_answer" deve ser BEM RESUMIDA (cerca de 70% do tamanho de uma resposta normal, 1 parágrafo curto indo direto ao ponto).',
      '4) A chave "highlights" deve ser um array de objetos contendo os trechos exatos que basearam sua resposta.',
      '',
      `TÍTULO DA RECAPITULAÇÃO: ${bundle.tituloRecap}`,
      `PERGUNTA ESPECÍFICA: ${bundle.perguntaRecap}`,
      'DICA: Muitas vezes a pergunta específica é um complemento do título da recapitulação (ex: "O que aprendemos sobre:" + "Tiago 1:5"). Interprete-os juntos.',
      '',
      'TEXTO COMPLETO DO ARTIGO PARA PESQUISA:',
      bundle.textoCompleto,
      '',
      'ESTRUTURA JSON OBRIGATÓRIA:',
      JSON.stringify({
        "natural_answer": "Sua resposta conversacional BEM curta, direta e amorosa aqui.",
        "highlights":[
          {
            "paragraph_number": 0,
            "literal_text": "texto exato copiado do paragrafo",
            "anchor_start": "primeiras palavras",
            "anchor_end": "ultimas palavras"
          }
        ]
      }, null, 2)
    ].join('\n');
  }

  function collectRawCharMap(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
        if (!node.nodeValue.trim() && !/\s/.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (parent.closest('script, style, button, .anotacao, .comentarios')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const raw =[]; let node;
    while ((node = walker.nextNode())) {
      for (let i = 0; i < node.nodeValue.length; i += 1) raw.push({ node, offset: i, ch: node.nodeValue[i] });
    }
    return raw;
  }

  function buildNormalizedIndex(root) {
    const raw = collectRawCharMap(root);
    const normChars =[]; const normMap =[]; let lastWasSpace = true;
    raw.forEach((item, rawIndex) => {
      let ch = item.ch.replace(/\u00A0/g, ' ').replace(/[“”]/g, '"').replace(/[‘’´`]/g, "'").replace(/[–—−]/g, '-');
      ch = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      if (!ch) return;
      if (/\s/.test(ch)) {
        if (lastWasSpace) { if (normMap.length) normMap[normMap.length - 1].rawEnd = rawIndex + 1; return; }
        normChars.push(' '); normMap.push({ rawStart: rawIndex, rawEnd: rawIndex + 1 }); lastWasSpace = true; return;
      }
      lastWasSpace = false; normChars.push(ch); normMap.push({ rawStart: rawIndex, rawEnd: rawIndex + 1 });
    });
    while (normChars.length && normChars[0] === ' ') { normChars.shift(); normMap.shift(); }
    while (normChars.length && normChars[normChars.length - 1] === ' ') { normChars.pop(); normMap.pop(); }
    return { raw, normText: normChars.join(''), normMap };
  }

  function findAllOccurrences(haystack, needle) {
    const positions =[]; if (!needle) return positions;
    let start = 0;
    while (start < haystack.length) {
      const idx = haystack.indexOf(needle, start);
      if (idx === -1) break;
      positions.push(idx); start = idx + 1;
    }
    return positions;
  }

  function chooseAnchoredWindow(index, startAnchor, endAnchor, fallbackLength) {
    const startNorm = normalizeForMatch(startAnchor || '');
    const endNorm = normalizeForMatch(endAnchor || '');
    const text = index.normText;
    if (!text) return null;
    const starts = startNorm ? findAllOccurrences(text, startNorm) :[];
    const ends = endNorm ? findAllOccurrences(text, endNorm) :[];
    let best = null;
    if (starts.length && ends.length) {
      starts.forEach((s) => {
        ends.forEach((e) => {
          if (e < s) return;
          const endPos = e + endNorm.length;
          const width = endPos - s;
          if (width < Math.max(4, Math.round((fallbackLength || 10) * 0.45))) return;
          if (!best || width < best.width) best = { start: s, end: endPos, width };
        });
      });
      if (best) return { start: best.start, end: best.end };
    }
    if (starts.length) {
      const s = starts[0];
      return { start: s, end: Math.min(text.length, s + Math.max(fallbackLength, startNorm.length + 40)) };
    }
    if (ends.length) {
      const e = ends[0] + endNorm.length;
      return { start: Math.max(0, e - Math.max(fallbackLength, endNorm.length + 40)), end: e };
    }
    return null;
  }

  function scoreTokenOverlap(a, b) {
    const left = new Set(normalizeForMatch(a).split(' ').filter((w) => w.length >= 3));
    const right = new Set(normalizeForMatch(b).split(' ').filter((w) => w.length >= 3));
    if (!left.size || !right.size) return 0;
    let shared = 0;
    left.forEach((w) => { if (right.has(w)) shared += 1; });
    return shared / Math.max(left.size, right.size);
  }

  function fuzzyFindInIndex(index, excerpt, anchorStart, anchorEnd) {
    const excerptNorm = normalizeForMatch(excerpt || '');
    if (!excerptNorm) return null;
    const text = index.normText;
    if (!text) return null;

    const exactIdx = text.indexOf(excerptNorm);
    if (exactIdx >= 0) return { startNorm: exactIdx, endNorm: exactIdx + excerptNorm.length, score: 0, mode: 'exact' };

    const anchored = chooseAnchoredWindow(index, anchorStart, anchorEnd, excerptNorm.length);
    if (anchored) {
      const anchoredSlice = text.slice(anchored.start, anchored.end);
      if (anchoredSlice && scoreTokenOverlap(anchoredSlice, excerptNorm) >= 0.35) {
        return { startNorm: anchored.start, endNorm: anchored.end, score: 0.6, mode: 'anchored' };
      }
    }

    const threshold = Math.max(2, Math.min(18, Math.round(Math.max(8, excerptNorm.length) * 0.18)));
    const minLen = Math.max(1, excerptNorm.length - threshold);
    const maxLen = Math.min(text.length, excerptNorm.length + threshold);
    const startBound = anchored ? Math.max(0, anchored.start - threshold * 3) : 0;
    const endBound = anchored ? Math.min(text.length, anchored.end + threshold * 3) : text.length;

    let best = null;
    for (let start = startBound; start < endBound; start += 1) {
      for (let len = minLen; len <= maxLen; len += 1) {
        const end = start + len;
        if (end > endBound) break;
        const candidate = text.slice(start, end);
        const distance = boundedLevenshtein(candidate, excerptNorm, threshold);
        if (distance > threshold) continue;
        const overlap = scoreTokenOverlap(candidate, excerptNorm);
        const score = distance - overlap;
        if (!best || score < best.score || (score === best.score && candidate.length > (best.endNorm - best.startNorm))) {
          best = { startNorm: start, endNorm: end, score, mode: 'fuzzy' };
        }
      }
    }
    return best;
  }

  function normSpanToRaw(index, startNorm, endNorm) {
    if (!index.normMap.length) return null;
    const safeStart = Math.max(0, Math.min(index.normMap.length - 1, startNorm));
    const safeEnd = Math.max(safeStart + 1, Math.min(index.normMap.length, endNorm));
    return { rawStart: index.normMap[safeStart].rawStart, rawEnd: index.normMap[safeEnd - 1].rawEnd };
  }

  function isolateTextNodeSegment(node, start, end) {
    let working = node; let localStart = start; let localEnd = end;
    if (localStart > 0) { working = working.splitText(localStart); localEnd -= localStart; localStart = 0; }
    if (localEnd < working.nodeValue.length) working.splitText(localEnd);
    const txt = working.nodeValue;
    const leftTrim = (txt.match(/^\s+/) || [''])[0].length;
    const rightTrim = (txt.match(/\s+$/) ||[''])[0].length;
    if (leftTrim + rightTrim >= txt.length) return null;
    if (leftTrim > 0) working = working.splitText(leftTrim);
    if (rightTrim > 0 && working.nodeValue.length > rightTrim) working.splitText(working.nodeValue.length - rightTrim);
    return working;
  }

  function createRecapHighlight(scope, rawStart, rawEnd, metadata) {
    const range = document.createRange();
    const index = buildNormalizedIndex(scope);
    if (!index.raw.length) return false;
    const startRef = index.raw[rawStart];
    const endRef = index.raw[Math.max(rawStart, rawEnd - 1)];
    if (!startRef || !endRef) return false;
    range.setStart(startRef.node, startRef.offset);
    range.setEnd(endRef.node, endRef.offset + 1);

    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, null);
    const nodes =[]; let node;
    while ((node = walker.nextNode())) { if (range.intersectsNode(node)) nodes.push(node); }

    let created = false;
    nodes.forEach((textNode) => {
      let start = textNode === range.startContainer ? range.startOffset : 0;
      let end = textNode === range.endContainer ? range.endOffset : textNode.nodeValue.length;
      if (start >= end) return;
      const segmentNode = isolateTextNodeSegment(textNode, start, end);
      if (!segmentNode || !segmentNode.nodeValue) return;

      const parentMark = segmentNode.parentElement?.closest(`mark[data-ia-owner="${CSS.escape(metadata.ownerId)}"]`);
      if (parentMark) {
        parentMark.dataset.iaMode = 'adopted';
        created = true;
        return;
      }

      const mark = document.createElement('mark');
      mark.className = `ia-underline-recap`;
      mark.dataset.hlId = metadata.groupId;
      mark.dataset.iaOwner = metadata.ownerId;
      mark.dataset.iaGroup = metadata.groupId;
      mark.dataset.iaMode = 'owned';
      
      segmentNode.parentNode.replaceChild(mark, segmentNode);
      mark.appendChild(segmentNode);
      created = true;
    });

    if (created && window.CacheAnotacao && scope.id) window.CacheAnotacao.salvar(scope.id, scope.innerHTML);
    return created;
  }

  function unwrapMark(mark) {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    mark.remove();
    parent.normalize();
  }

  function clearIAHighlights(ownerId, bundle) {
    const marks = Array.from(document.querySelectorAll(`mark[data-ia-owner="${CSS.escape(ownerId)}"]`));
    const touched = new Set();
    marks.forEach((mark) => {
      const scope = mark.closest('.paragrafo');
      if (scope) touched.add(scope);
      if (mark.dataset.iaMode === 'owned') { unwrapMark(mark); return; }
      delete mark.dataset.iaOwner; delete mark.dataset.iaGroup; delete mark.dataset.iaMode;
    });
    if (window.CacheAnotacao) { touched.forEach((scope) => { if (scope?.id) window.CacheAnotacao.salvar(scope.id, scope.innerHTML); }); }
    if (bundle?.paragrafos) { bundle.paragrafos.forEach((p) => p.element?.normalize?.()); }
  }

  async function applyRecapHighlights(ownerId, parsed, bundle) {
    clearIAHighlights(ownerId, bundle);
    const appliedHighlights =[];
    for (let index = 0; index < (parsed.highlights || []).length; index++) {
      const highlight = parsed.highlights[index];
      const preferred = Number(highlight.paragraph_number);
      let best = null;
      const paragraphs = bundle.paragrafos.slice();
      if (Number.isFinite(preferred)) paragraphs.sort((a, b) => (a.number === preferred ? -1 : b.number === preferred ? 1 : 0));
      
      for (const p of paragraphs) {
        await new Promise(r => setTimeout(r, 0));
        const idx = buildNormalizedIndex(p.element);
        const match = fuzzyFindInIndex(idx, highlight.literal_text, highlight.anchor_start, highlight.anchor_end);
        if (!match) continue;
        const rawSpan = normSpanToRaw(idx, match.startNorm, match.endNorm);
        if (!rawSpan) continue;
        const overlap = scoreTokenOverlap(idx.normText.slice(match.startNorm, match.endNorm), normalizeForMatch(highlight.literal_text));
        const score = Number(match.score || 0) - overlap - (p.number === preferred ? 0.25 : 0);
        if (!best || score < best.score) best = { paragraph: p, rawSpan, score };
      }

      if (!best) continue;
      const groupId = `${ownerId}-recap-${index}-${Math.random().toString(36).slice(2, 8)}`;
      const created = createRecapHighlight(best.paragraph.element, best.rawSpan.rawStart, best.rawSpan.rawEnd, { ownerId, groupId });
      if (created) appliedHighlights.push({ paragraph_number: best.paragraph.number });
    }
    return { ...parsed, highlights: appliedHighlights };
  }

  function renderRecapHTML(parsed, bundle) {
    const lines =[];
    lines.push('<div class="ia-recap-container">');
    if (parsed.natural_answer) lines.push(`<div class="ia-recap-answer">${textToHTML(parsed.natural_answer)}</div>`);
    
    const refs = Array.from(new Set((parsed.highlights ||[]).map(h => Number(h.paragraph_number)).filter(Number.isFinite)));
    if (refs.length > 0) {
      lines.push('<div class="ia-recap-refs">');
      refs.forEach(num => {
        lines.push(`<button type="button" class="ia-ref-chip" data-target-paragraph="${num}">&sect; ${num}</button>`);
      });
      lines.push('</div>');
    }

    if (parsed.model && typeof window.DEBUG_G !== 'undefined') {
      lines.push(`<div class="ia-inline-note ia-status-ok" style="margin-top: 8px;">Modelo: ${escapeHTML(parsed.model)}</div>`);
    }
    lines.push('</div>');
    return lines.join('');
  }

  function wireRecapInteractions(responseDiv, bundle) {
    responseDiv.querySelectorAll('.ia-ref-chip').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const targetNum = Number(btn.dataset.targetParagraph || '0');
        const target = bundle.paragrafos.find((p) => p.number === targetNum)?.element;
        if (!target) return;
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.classList.add('paragrafo-destaque');
        setTimeout(() => target.classList.remove('paragrafo-destaque'), 1200);
      });
    });
  }

  async function requestGemini(prompt, modelName) {
    const cooldown = getActiveCooldown(modelName);
    if (cooldown.until) throw new Error('Modelo em cooldown.');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(new Error('timeout')), CONFIG.timeoutMs);

    try {
      const response = await fetch(String(CONFIG.workerUrl || '').trim(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: String(prompt || '').slice(0, CONFIG.maxInputChars),
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
        const msg = data?.error || data?.message || `Erro ${response.status}`;
        if (response.status === 429 || /quota|rate/i.test(msg)) {
          setCooldown(modelName, extractRetryAfterMs(msg, response.headers));
        }
        throw new Error(sanitizeFrontendError(msg));
      }

      const text = normalizeSpaces(String(data?.text || ''));
      if (!text) throw new Error('Retorno vazio.');
      return text;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function requestWithFallback(prompt) {
    let lastError = null;
    for (const model of CONFIG.modelFallbacks) {
      try {
        const text = await requestGemini(prompt, model);
        return { text, model };
      } catch (e) { lastError = e; }
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

  window.gerarRespostaIA_Recap = async function(idPergunta, wrapperElement, idRespostaIA) {
    const respostaDiv = document.getElementById(idRespostaIA);
    if (!respostaDiv) return;

    if (!isConfigured()) {
      respostaDiv.innerHTML = '<div class="ia-inline-note ia-status-error">Configure a URL do Worker.</div>';
      return;
    }

    const bundle = extrairBundleRecap(idPergunta);
    if (!bundle || !bundle.textoCompleto) {
      respostaDiv.innerHTML = '<div class="ia-inline-note ia-status-error">Não foi possível ler o artigo.</div>';
      return;
    }

    setLoading(wrapperElement, respostaDiv, 'Buscando a resposta no artigo...');

    try {
      const prompt = buildPrompt(bundle);
      const result = await requestWithFallback(prompt);
      const parsed = safeJSONParse(result.text);
      if (!parsed || !parsed.natural_answer) throw new Error('Formato de resposta inválido.');

      parsed.model = result.model;
      const applied = await applyRecapHighlights(idPergunta, parsed, bundle);
      const html = renderRecapHTML(applied, bundle);
      
      respostaDiv.innerHTML = html;
      wireRecapInteractions(respostaDiv, bundle);

      const cacheKey = `qa:recap:${window.estudoId || 'default'}:${idPergunta}`;
      try {
        localStorage.setItem(cacheKey, JSON.stringify({ snapshot: bundle.snapshot, html: html }));
        if (window.CacheAnotacao) window.CacheAnotacao.salvar(idRespostaIA, html);
      } catch (_) {}

    } catch (error) {
      respostaDiv.innerHTML = `<div class="ia-inline-note ia-status-error">Falha ao gerar recapitulação: ${escapeHTML(sanitizeFrontendError(error.message))}</div>`;
    } finally {
      clearLoading(wrapperElement);
    }
  };
})();