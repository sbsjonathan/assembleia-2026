(function () {
  const DEFAULT_CONFIG = {
    enabled: true,
    workerUrl: 'https://gem.jonjonathan2-0.workers.dev',
    modelFallbacks: [
      'gemini-3.1-flash-lite-preview',
      'gemini-3-flash-preview',
      'gemini-2.5-flash'
    ],
    timeoutMs: 22000,
    maxInputChars: 12000,
    maxOutputTokens: 2500,
    temperature: 0.15,
    topP: 0.85,
    topK: 24,
    cooldownKey: '__sentinela_perguntas_cooldown__',
    defaultCooldownMs: 30000
  };

  const userConfig = window.SENTINELA_PERGUNTAS_CONFIG || {};
  const CONFIG = Object.assign({}, DEFAULT_CONFIG, userConfig);

  const bibleCache = {};

  function injectStyles() {
    if (document.getElementById('sentinela-perguntas-style')) return;
    const style = document.createElement('style');
    style.id = 'sentinela-perguntas-style';
    style.textContent = `
      .anotacao.ativa { max-height: 1500px !important; }
      .ia-tabs-container { display: flex; flex-direction: column; gap: 12px; }
      .ia-tabs-header { display: flex; gap: 8px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; margin-bottom: 4px; }
      .ia-tab-btn { background: none; border: none; padding: 6px 12px; cursor: pointer; font-size: 0.85rem; font-weight: 600; color: #9ca3af; border-radius: 4px; transition: all 0.2s ease; }
      .ia-tab-btn:hover { color: #4b5563; background: #f9fafb; }
      .ia-tab-btn.active { background: #f3f4f6; color: #375255; }
      .ia-tab-content { display: none; animation: fadeInTab 0.3s ease; }
      .ia-tab-content.active { display: block; }
      @keyframes fadeInTab { from { opacity: 0; transform: translateY(2px); } to { opacity: 1; transform: translateY(0); } }
      .ia-answer-main { color: #374151; line-height: 1.6; font-size: 0.95rem; }
      .ia-answer-part { border-left: 4px solid transparent; padding-left: 10px; margin-bottom: 16px; display: flex; flex-direction: column; gap: 6px; }
      .ia-answer-part[data-part="a"] { border-left-color: rgba(234,179,8,.65); }
      .ia-answer-part[data-part="b"] { border-left-color: rgba(34,197,94,.55); }
      .ia-answer-part[data-part="c"] { border-left-color: rgba(59,130,246,.50); }
      .ia-answer-part-title { font-size: .75rem; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; color: #6b7280; }
      .ia-answer-part-text { color: #4b5563; line-height: 1.6; background: #f9fafb; padding: 8px 12px; border-radius: 6px; font-style: italic; font-size: 0.95rem; }
      .ia-inline-note { font-size: .78rem; color: #6b7280; }
      .ia-status-error { color: #b91c1c; }
      .ia-status-ok { color: #166534; }
    `;
    document.head.appendChild(style);
  }
  injectStyles();

  function normalizeSpaces(text) {
    return String(text || '').replace(/\u200B/g, '').replace(/\r\n?/g, '\n').replace(/[\t\f\v ]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  }

  function escapeHTML(text) {
    return String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function textToHTML(text) {
    let html = escapeHTML(normalizeSpaces(text));
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    html = html.replace(/\n/g, '<br>');
    return html;
  }

  function stripSelectionArtifacts(text) {
    return normalizeSpaces(String(text || '').replace(/[“”]/g, '"').replace(/[‘’´`]/g, "'").replace(/[–—−]/g, '-'));
  }

  function normalizeForMatch(text) {
    return normalizeSpaces(stripSelectionArtifacts(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase());
  }

  function safeJSONParse(text) {
    if (!text) return null;
    let cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end >= start) {
      let jsonStr = cleaned.slice(start, end + 1);
      jsonStr = jsonStr.replace(/,\s*([\]}])/g, '$1');
      try {
        return JSON.parse(jsonStr);
      } catch (e) {
        return null;
      }
    }
    return null;
  }

  function boundedLevenshtein(a, b, maxDistance) {
    const left = normalizeSpaces(a || '');
    const right = normalizeSpaces(b || '');
    if (left === right) return 0;
    const limit = Math.max(0, Number(maxDistance) || 0);
    let aText = left;
    let bText = right;
    let aLen = aText.length;
    let bLen = bText.length;
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
      if (rowMin > limit) return limit + 1;[prev, curr] = [curr, prev];
    }
    return prev[bLen];
  }

  function isConfigured() {
    const url = String(CONFIG.workerUrl || '').trim();
    return !!url && url !== 'COLE_A_URL_DO_SEU_WORKER_AQUI';
  }

  function getCooldownKey(modelName) {
    return `${String(CONFIG.cooldownKey || '__sentinela_perguntas_cooldown__')}:${String(modelName || 'global')}`;
  }

  function getActiveCooldown(modelName) {
    try {
      const raw = localStorage.getItem(getCooldownKey(modelName));
      if (!raw) return { until: 0, reason: '' };
      const parsed = JSON.parse(raw);
      const until = Number(parsed?.until || 0);
      if (!until || until <= Date.now()) {
        localStorage.removeItem(getCooldownKey(modelName));
        return { until: 0, reason: '' };
      }
      return { until, reason: String(parsed?.reason || '') };
    } catch (_) {
      return { until: 0, reason: '' };
    }
  }

  function setCooldown(modelName, ms, reason) {
    try {
      localStorage.setItem(getCooldownKey(modelName), JSON.stringify({
        until: Date.now() + Math.max(1000, Number(ms) || Number(CONFIG.defaultCooldownMs) || 30000),
        reason: String(reason || 'rate_limit')
      }));
    } catch (_) {}
  }

  function extractRetryAfterMs(message, headers) {
    const retryAfterHeader = headers?.get?.('retry-after');
    const seconds = Number(retryAfterHeader);
    if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
    const match = String(message || '').match(/retry after\s*(\d+(?:\.\d+)?)s/i);
    if (match) return Math.ceil(Number(match[1]) * 1000);
    return Number(CONFIG.defaultCooldownMs) || 30000;
  }

  function ensureResponseDiv(idRespostaIA) {
    return document.getElementById(idRespostaIA);
  }

  function getQuestionElement(idPergunta) {
    return document.getElementById(idPergunta);
  }

  function extractQuestionText(questionElement) {
    if (!questionElement) return '';
    const clone = questionElement.cloneNode(true);
    clone.querySelectorAll('.anotacao, .comentarios, .btn-gerar-ia').forEach((el) => el.remove());
    return normalizeSpaces(clone.textContent || '');
  }

  function extractParagraphText(paragraphElement) {
    const clone = paragraphElement.cloneNode(true);
    clone.querySelectorAll('.anotacao, .comentarios, button, script, style').forEach((el) => el.remove());
    return normalizeSpaces(clone.textContent || '');
  }

  function getParagraphNumber(paragraphElement) {
    const text = normalizeSpaces(paragraphElement?.querySelector('span')?.textContent || '');
    const match = text.match(/\d+/);
    return match ? Number(match[0]) : null;
  }

  function getBundle(idPergunta) {
    const questionElement = getQuestionElement(idPergunta);
    if (!questionElement) return null;
    const paragraphs = Array.from(document.querySelectorAll(`.paragrafo[data-question-id="${CSS.escape(idPergunta)}"]`)).map((el) => ({
      id: el.id,
      number: getParagraphNumber(el),
      text: extractParagraphText(el),
      element: el
    }));
    return {
      idPergunta,
      questionElement,
      questionText: extractQuestionText(questionElement),
      paragraphs
    };
  }

  function findAssociatedImage(bundle) {
    const pNums = bundle.paragraphs.map(p => p.number).filter(n => n);
    if (!pNums.length) return null;

    const figures = document.querySelectorAll('figure');
    for (let fig of figures) {
      const caption = fig.querySelector('figcaption');
      if (!caption) continue;
      const text = caption.textContent || '';
      const match = text.match(/parágrafo[s]?\s*(\d+)(?:[-–—](\d+))?/i);
      if (match) {
        const start = parseInt(match[1], 10);
        const end = match[2] ? parseInt(match[2], 10) : start;
        for (let n of pNums) {
          if (n >= start && n <= end) {
            const img = fig.querySelector('img');
            if (img && img.src) return { src: img.src, caption: text.trim() };
          }
        }
      }
    }

    const mentionsImage = /imagem|foto|ilustra|gravura/i.test(bundle.questionText) || 
                          bundle.paragraphs.some(p => /imagem|foto|ilustra|gravura/i.test(p.text));
                          
    if (mentionsImage && bundle.paragraphs.length > 0) {
      const lastParagraph = bundle.paragraphs[bundle.paragraphs.length - 1].element;
      const allElements = Array.from(document.querySelectorAll('.paragrafo, figure, [class^="imagem"]'));
      const lastParIndex = allElements.indexOf(lastParagraph);
      
      if (lastParIndex !== -1 && lastParIndex + 1 < allElements.length) {
        const nextEl = allElements[lastParIndex + 1];
        if (nextEl.tagName === 'FIGURE' || nextEl.matches('[class^="imagem"]')) {
          const img = nextEl.querySelector('img');
          if (img && img.src) {
            const captionEl = nextEl.querySelector('figcaption');
            const captionText = captionEl ? captionEl.textContent.trim() : 'Detalhes visuais associados ao parágrafo.';
            return { src: img.src, caption: captionText };
          }
        }
      }
    }
    return null;
  }

  function findBibleLinks(bundle) {
    const links = [];
    bundle.paragraphs.forEach(p => {
      const bbls = p.element.querySelectorAll('a.bbl');
      bbls.forEach(a => {
        const txt = normalizeSpaces(a.textContent || '');
        if (txt) links.push(txt);
      });
    });
    return [...new Set(links)];
  }

  async function getBase64Image(url) {
    const res = await fetch(url);
    const blob = await res.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result.split(',')[1];
        const mime = blob.type || 'image/jpeg';
        resolve({ base64, mime });
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async function getBibleText(refString) {
    if (typeof ABREVIACOES === 'undefined') return null;

    let referencias = [];
    if (refString.includes(';')) {
      referencias = refString.split(';').map(ref => ref.trim()).filter(ref => ref.length > 0);
    } else {
      referencias = [refString];
    }

    let output = [];

    for (let i = 0; i < referencias.length; i++) {
      let refAtual = referencias[i];
      
      if (i > 0 && /^\d+:[\d,\s-–—]+$/.test(refAtual)) {
        const primeiraRef = referencias[0];
        const matchPrimeiraRef = primeiraRef.match(/^([1-3]?\s?[A-Za-zêÊãÃíÍóÓâÂéÉôÔúÚçÇáÁ.]+)\s/);
        if (matchPrimeiraRef) {
          refAtual = matchPrimeiraRef[1] + ' ' + refAtual;
        }
      }

      let multiCapMatch = refAtual.match(/^([1-3]?\s?[A-Za-zêÊãÃíÍóÓâÂéÉôÔúÚçÇáÁ.]+)\s?(\d{1,3}):(\d{1,3})\s*[-–—]\s*(\d{1,3}):(\d{1,3})$/);
      let singleCapMatch = refAtual.match(/^([1-3]?\s?[A-Za-zêÊãÃíÍóÓâÂéÉôÔúÚçÇáÁ.]+)\s?(\d{1,3}):([\d,\s-–—]+)/);

      if (!multiCapMatch && !singleCapMatch) continue;

      const isMultiCap = !!multiCapMatch;
      const match = isMultiCap ? multiCapMatch : singleCapMatch;
      let nomeAbreviado = match[1].replace(/[\.\s]/g, '').trim();

      const mapeamentosEspeciais = {
        'Deut': 'deuteronomio',
        'Gál': 'galatas'
      };

      const nomeLivro = mapeamentosEspeciais[nomeAbreviado] || ABREVIACOES[nomeAbreviado] || nomeAbreviado.toLowerCase().replace(/\s/g, '');

      if (!bibleCache[nomeLivro]) {
        try {
          const resp = await fetch(`../biblia/data/${nomeLivro}.json`);
          if (resp.ok) bibleCache[nomeLivro] = await resp.json();
          else bibleCache[nomeLivro] = null;
        } catch (e) {
          bibleCache[nomeLivro] = null;
        }
      }

      const dados = bibleCache[nomeLivro];
      if (!dados) continue;

      let versosColetados = [];

      if (isMultiCap) {
        let capIni = parseInt(match[2]), versIni = parseInt(match[3]);
        let capFim = parseInt(match[4]), versFim = parseInt(match[5]);

        for (let c = capIni; c <= capFim; c++) {
          const capObj = dados.capitulos.find(chap => chap.capitulo === c);
          if (!capObj) continue;

          let versiculosDoCapitulo = [];
          if (c === capIni && c === capFim) versiculosDoCapitulo = capObj.versiculos.filter(v => v.verso >= versIni && v.verso <= versFim);
          else if (c === capIni) versiculosDoCapitulo = capObj.versiculos.filter(v => v.verso >= versIni);
          else if (c === capFim) versiculosDoCapitulo = capObj.versiculos.filter(v => v.verso <= versFim);
          else versiculosDoCapitulo = capObj.versiculos;
          
          versosColetados.push(...versiculosDoCapitulo.map(v => ({...v, capitulo: c}) ));
        }
      } else {
        const capituloNum = parseInt(match[2]);
        const capObj = dados.capitulos.find(c => c.capitulo === capituloNum);
        if (!capObj) continue;
        
        match[3].split(',').forEach(item => {
          if (item.includes('-') || item.includes('–') || item.includes('—')) {
            const sep = item.includes('-') ? '-' : (item.includes('–') ? '–' : '—');
            const [ini, fim] = item.split(sep).map(Number);
            versosColetados.push(...capObj.versiculos.filter(v => v.verso >= ini && v.verso <= fim));
          } else {
            const verso = capObj.versiculos.find(v => v.verso === Number(item));
            if (verso) versosColetados.push(verso);
          }
        });
      }

      if (versosColetados.length > 0) {
        let textSnippets = versosColetados.map(v => `(v. ${v.verso}) ${v.texto}`);
        output.push(`[${refAtual.trim()}]\n${textSnippets.join(' ')}`);
      }
    }

    return output.join('\n\n');
  }

  function getHexKey(id) {
    const key = String(id).toLowerCase();
    if (['a', '1'].includes(key)) return 'a';
    if (['b', '2'].includes(key)) return 'b';
    if (['c', '3'].includes(key)) return 'c';
    return 'a';
  }

  function getPartColor(hexKey) {
    if (hexKey === 'b') return 'green';
    if (hexKey === 'c') return 'blue';
    return 'yellow';
  }

  function renderResponseHTML(parsed) {
    const lines = [];
    lines.push('<div class="ia-tabs-container">');
    lines.push('<div class="ia-tabs-header">');
    lines.push(`<button class="ia-tab-btn active" onclick="const c = this.closest('.ia-tabs-container'); c.querySelectorAll('.ia-tab-content').forEach(e=>e.classList.remove('active')); c.querySelector('.ia-tab-natural').classList.add('active'); c.querySelectorAll('.ia-tab-btn').forEach(e=>e.classList.remove('active')); this.classList.add('active');">Resposta</button>`);
    lines.push(`<button class="ia-tab-btn" onclick="const c = this.closest('.ia-tabs-container'); c.querySelectorAll('.ia-tab-content').forEach(e=>e.classList.remove('active')); c.querySelector('.ia-tab-literal').classList.add('active'); c.querySelectorAll('.ia-tab-btn').forEach(e=>e.classList.remove('active')); this.classList.add('active');">Trecho Exato</button>`);
    
    if (parsed.has_bible) {
      lines.push(`<button class="ia-tab-btn" onclick="const c = this.closest('.ia-tabs-container'); c.querySelectorAll('.ia-tab-content').forEach(e=>e.classList.remove('active')); c.querySelector('.ia-tab-bible').classList.add('active'); c.querySelectorAll('.ia-tab-btn').forEach(e=>e.classList.remove('active')); this.classList.add('active');">R. Bíblia</button>`);
    }
    if (parsed.has_image) {
      lines.push(`<button class="ia-tab-btn" onclick="const c = this.closest('.ia-tabs-container'); c.querySelectorAll('.ia-tab-content').forEach(e=>e.classList.remove('active')); c.querySelector('.ia-tab-image').classList.add('active'); c.querySelectorAll('.ia-tab-btn').forEach(e=>e.classList.remove('active')); this.classList.add('active');">Imagem</button>`);
    }
    lines.push('</div>');

    lines.push('<div class="ia-tab-content ia-tab-natural active">');
    const parts = Array.isArray(parsed.parts) ? parsed.parts : [];
    parts.forEach((part) => {
      lines.push(`<div class="ia-answer-part" data-part="${escapeHTML(part.hexKey)}">`);
      if (parts.length > 1) lines.push(`<div class="ia-answer-part-title">${escapeHTML(part.title)}</div>`);
      lines.push(`<div class="ia-answer-main">${textToHTML(part.natural_answer)}</div>`);
      lines.push('</div>');
    });
    lines.push('</div>');

    lines.push('<div class="ia-tab-content ia-tab-literal">');
    parts.forEach((part) => {
      lines.push(`<div class="ia-answer-part" data-part="${escapeHTML(part.hexKey)}">`);
      if (parts.length > 1) lines.push(`<div class="ia-answer-part-title">${escapeHTML(part.title)}</div>`);
      if (part.literal_smooth) {
        lines.push(`<div class="ia-answer-part-text">"${textToHTML(part.literal_smooth)}"</div>`);
      } else {
        lines.push(`<div class="ia-answer-part-text" style="color:#9ca3af; font-style:normal;">Nenhum trecho destacado.</div>`);
      }
      lines.push('</div>');
    });
    lines.push('</div>');

    if (parsed.has_bible) {
      lines.push('<div class="ia-tab-content ia-tab-bible">');
      if (parsed.bible_analysis) {
        lines.push(`<div class="ia-answer-main">${textToHTML(parsed.bible_analysis)}</div>`);
      } else {
        lines.push('<div class="ia-inline-note">Cruzando textos bíblicos lidos...</div>');
      }
      lines.push('</div>');
    }

    if (parsed.has_image) {
      lines.push('<div class="ia-tab-content ia-tab-image">');
      if (parsed.image_analysis) {
        lines.push(`<div class="ia-answer-main">${textToHTML(parsed.image_analysis)}</div>`);
      } else {
        lines.push('<div class="ia-inline-note">Analisando os detalhes da imagem...</div>');
      }
      lines.push('</div>');
    }

    if (parsed.model && typeof window.DEBUG_G !== 'undefined') {
      lines.push(`<div class="ia-inline-note ia-status-ok" style="margin-top: 4px;">Modelo: ${escapeHTML(parsed.model)}</div>`);
    }
    
    lines.push('</div>');
    return lines.join('');
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
    const raw = [];
    let node;
    while ((node = walker.nextNode())) {
      for (let i = 0; i < node.nodeValue.length; i += 1) raw.push({ node, offset: i, ch: node.nodeValue[i] });
    }
    return raw;
  }

  function buildNormalizedIndex(root) {
    const raw = collectRawCharMap(root);
    const normChars = [];
    const normMap = [];
    let lastWasSpace = true;
    raw.forEach((item, rawIndex) => {
      let ch = item.ch.replace(/\u00A0/g, ' ').replace(/[“”]/g, '"').replace(/[‘’´`]/g, "'").replace(/[–—−]/g, '-');
      ch = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      if (!ch) return;
      if (/\s/.test(ch)) {
        if (lastWasSpace) { if (normMap.length) normMap[normMap.length - 1].rawEnd = rawIndex + 1; return; }
        normChars.push(' ');
        normMap.push({ rawStart: rawIndex, rawEnd: rawIndex + 1 });
        lastWasSpace = true; return;
      }
      lastWasSpace = false;
      normChars.push(ch);
      normMap.push({ rawStart: rawIndex, rawEnd: rawIndex + 1 });
    });
    while (normChars.length && normChars[0] === ' ') { normChars.shift(); normMap.shift(); }
    while (normChars.length && normChars[normChars.length - 1] === ' ') { normChars.pop(); normMap.pop(); }
    return { raw, normText: normChars.join(''), normMap };
  }

  function findAllOccurrences(haystack, needle) {
    const positions = [];
    if (!needle) return positions;
    let start = 0;
    while (start < haystack.length) {
      const idx = haystack.indexOf(needle, start);
      if (idx === -1) break;
      positions.push(idx);
      start = idx + 1;
    }
    return positions;
  }

  function chooseAnchoredWindow(index, startAnchor, endAnchor, fallbackLength) {
    const startNorm = normalizeForMatch(startAnchor || '');
    const endNorm = normalizeForMatch(endAnchor || '');
    const text = index.normText;
    if (!text) return null;
    const starts = startNorm ? findAllOccurrences(text, startNorm) : [];
    const ends = endNorm ? findAllOccurrences(text, endNorm) : [];
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
    let working = node;
    let localStart = start;
    let localEnd = end;
    if (localStart > 0) { working = working.splitText(localStart); localEnd -= localStart; localStart = 0; }
    if (localEnd < working.nodeValue.length) working.splitText(localEnd);
    const txt = working.nodeValue;
    const leftTrim = (txt.match(/^\s+/) || [''])[0].length;
    const rightTrim = (txt.match(/\s+$/) || [''])[0].length;
    if (leftTrim + rightTrim >= txt.length) return null;
    if (leftTrim > 0) working = working.splitText(leftTrim);
    if (rightTrim > 0 && working.nodeValue.length > rightTrim) working.splitText(working.nodeValue.length - rightTrim);
    return working;
  }

  function createHighlightOnRange(scope, rawStart, rawEnd, color, metadata) {
    const range = document.createRange();
    const index = buildNormalizedIndex(scope);
    if (!index.raw.length) return false;
    const startRef = index.raw[rawStart];
    const endRef = index.raw[Math.max(rawStart, rawEnd - 1)];
    if (!startRef || !endRef) return false;
    range.setStart(startRef.node, startRef.offset);
    range.setEnd(endRef.node, endRef.offset + 1);

    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, null);
    const nodes = [];
    let node;
    while ((node = walker.nextNode())) { if (range.intersectsNode(node)) nodes.push(node); }

    let created = false;
    const animClass = color === 'yellow' ? 'ia-highlight' : 'ia-highlight-b';

    nodes.forEach((textNode) => {
      let start = textNode === range.startContainer ? range.startOffset : 0;
      let end = textNode === range.endContainer ? range.endOffset : textNode.nodeValue.length;
      if (start >= end) return;
      const segmentNode = isolateTextNodeSegment(textNode, start, end);
      if (!segmentNode || !segmentNode.nodeValue) return;

      if (segmentNode.parentNode?.tagName === 'MARK') {
         if (segmentNode.parentNode.dataset.iaOwner === metadata.ownerId) {
             segmentNode.parentNode.dataset.iaMode = 'adopted';
             created = true;
             return;
         }
      }

      const mark = document.createElement('mark');
      mark.className = `hl-color-${color} ${animClass}`;
      mark.dataset.hlId = metadata.groupId;
      mark.dataset.iaOwner = metadata.ownerId;
      mark.dataset.iaGroup = metadata.groupId;
      mark.dataset.iaPart = metadata.partKey;
      mark.dataset.iaMode = 'owned';
      
      segmentNode.parentNode.replaceChild(mark, segmentNode);
      mark.appendChild(segmentNode);
      created = true;
    });

    if (created && window.CacheAnotacao && scope.id) { window.CacheAnotacao.salvar(scope.id, scope.innerHTML); }
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
      delete mark.dataset.iaOwner; delete mark.dataset.iaGroup; delete mark.dataset.iaPart; delete mark.dataset.iaMode;
    });
    if (window.CacheAnotacao) { touched.forEach((scope) => { if (scope?.id) window.CacheAnotacao.salvar(scope.id, scope.innerHTML); }); }
    if (bundle?.paragraphs) { bundle.paragraphs.forEach((p) => p.element?.normalize?.()); }
  }

  function pickBestParagraph(highlight, bundle) {
    const preferred = Number(highlight.paragraph_number);
    const paragraphs = bundle.paragraphs.slice();
    if (Number.isFinite(preferred)) {
      paragraphs.sort((a, b) => (a.number === preferred ? -1 : b.number === preferred ? 1 : 0));
    }

    let best = null;
    paragraphs.forEach((paragraph) => {
      const index = buildNormalizedIndex(paragraph.element);
      const match = fuzzyFindInIndex(index, highlight.literal_text, highlight.anchor_start, highlight.anchor_end);
      if (!match) return;
      const rawSpan = normSpanToRaw(index, match.startNorm, match.endNorm);
      if (!rawSpan) return;
      const literalNorm = normalizeForMatch(highlight.literal_text);
      const candidateNorm = index.normText.slice(match.startNorm, match.endNorm);
      const overlap = scoreTokenOverlap(candidateNorm, literalNorm);
      const score = Number(match.score || 0) - overlap - (paragraph.number === preferred ? 0.25 : 0);
      if (!best || score < best.score) { best = { paragraph, rawSpan, score, mode: match.mode }; }
    });
    return best;
  }

  function sanitizeModelPayload(payload) {
    const subs = Array.isArray(payload?.sub_questions) ? payload.sub_questions : [];
    if (subs.length === 0) {
      subs.push({ id: "1", title: "Resposta", natural_answer: "Erro ao estruturar a resposta.", literal_smooth: "", highlights: [] });
    }
    const parts = subs.map(sub => {
      const hexKey = getHexKey(sub.id);
      return {
        id: String(sub.id || '1'),
        hexKey: hexKey,
        title: String(sub.title || 'Resposta'),
        natural_answer: normalizeSpaces(sub.natural_answer || ''),
        literal_smooth: normalizeSpaces(sub.literal_smooth || ''),
        highlights: Array.isArray(sub.highlights) ? sub.highlights.map(h => ({
          paragraph_number: Number(h?.paragraph_number),
          literal_text: normalizeSpaces(h?.literal_text || ''),
          anchor_start: normalizeSpaces(h?.anchor_start || ''),
          anchor_end: normalizeSpaces(h?.anchor_end || '')
        })).filter(h => h.literal_text) : []
      };
    });
    return { parts, model: String(payload?.model || '') };
  }

  function applyLiteralHighlights(ownerId, parsed, bundle) {
    clearIAHighlights(ownerId, bundle);
    const appliedParts = (parsed.parts || []).map((part) => {
      const color = getPartColor(part.hexKey);
      const appliedHighlights = [];
      (part.highlights || []).forEach((highlight, index) => {
        const best = pickBestParagraph(highlight, bundle);
        if (!best) return;
        const groupId = `${ownerId}-${part.hexKey}-${index}-${Math.random().toString(36).slice(2, 8)}`;
        const created = createHighlightOnRange(best.paragraph.element, best.rawSpan.rawStart, best.rawSpan.rawEnd, color, {
          ownerId, groupId, partKey: part.hexKey
        });
        if (!created) return;
        appliedHighlights.push(Object.assign({}, highlight, { appliedParagraph: best.paragraph.number, appliedMode: best.mode }));
      });
      return Object.assign({}, part, { highlights: appliedHighlights });
    });
    return Object.assign({}, parsed, { parts: appliedParts });
  }

  function buildPrompt(bundle) {
    const context = bundle.paragraphs.map((p) => `PARÁGRAFO ${p.number}: ${p.text}`).join('\n\n');
    return [
      'Você é um assistente cirúrgico que responde perguntas do artigo A Sentinela usando APENAS o contexto fornecido.',
      'RETORNE EXCLUSIVAMENTE UM JSON VÁLIDO. NÃO USE MARKDOWN (```json). ESCAPE ASPAS DUPLAS CORRETAMENTE COM \\".',
      '',
      'Regras Importantes:',
      '1) Analise a Pergunta. Se ela for dividida em (a) e (b), crie 2 itens no array "sub_questions" com id "a" e "b" (titles: "Parte A", "Parte B").',
      '2) Se a pergunta NÃO tiver letras, mas contiver mais de uma pergunta (ex: "O que é X? Por que é assim?"), crie 2 itens com id "1" e "2" (titles curtos e contextuais baseados nas perguntas).',
      '3) Se for uma pergunta simples, crie apenas 1 item com id "1" (title: "Resposta").',
      '4) Para cada item:',
      '   - "natural_answer": A resposta conversacional em pt-BR.',
      '   - "literal_smooth": O trecho literal do artigo adaptado muito sutilmente no início para ter fluidez na leitura (sem usar frases formais como "O artigo diz que"). Ex: se o texto original for "pois eles oravam", ajuste para "Sabe-se que eles oravam". Mantenha 95% do texto exato.',
      '   - "highlights": O trecho EXATO (literal_text) sem nenhuma modificação, copiado do artigo para ancorar o marca-texto.',
      '5) Nunca cite nada fora do contexto.',
      '',
      `Pergunta: ${bundle.questionText}`,
      '',
      'Contexto:',
      context,
      '',
      'Esquema JSON obrigatório:',
      JSON.stringify({
        "sub_questions": [
          {
            "id": "a ou 1",
            "title": "Parte A ou Título Contextual",
            "natural_answer": "Resposta humana natural",
            "literal_smooth": "Trecho amaciado sutilmente no começo",
            "highlights": [
              {
                "paragraph_number": 0,
                "literal_text": "texto exato copiado do paragrafo",
                "anchor_start": "primeiras palavras exatas",
                "anchor_end": "ultimas palavras exatas"
              }
            ]
          }
        ]
      }, null, 2)
    ].join('\n');
  }

  function buildImagePrompt(bundle, caption) {
    const context = bundle.paragraphs.map((p) => `PARÁGRAFO ${p.number}: ${p.text}`).join('\n\n');
    return [
      'Você é um observador detalhista.',
      'Analise a imagem fornecida.',
      `Legenda da imagem: "${caption}"`,
      `Contexto do(s) parágrafo(s): "${context}"`,
      'Descreva a cena minuciosamente (expressões, objetos, detalhes) e explique de forma natural como esses detalhes visuais se conectam com a lição ensinada.',
      'Retorne apenas o texto da análise em português, sem formatação markdown.'
    ].join('\n');
  }

  function buildBiblePrompt(bundle, bibleTexts) {
    const context = bundle.paragraphs.map((p) => `PARÁGRAFO ${p.number}: ${p.text}`).join('\n\n');
    return [
      'Você é um irmão cristão experiente ajudando no estudo da Sentinela.',
      'Sua tarefa é mostrar a ligação entre os textos bíblicos fornecidos e o que o parágrafo ensina.',
      '',
      'REGRAS OBRIGATÓRIAS DE FORMATAÇÃO E COMPORTAMENTO:',
      '1) NUNCA cumprimente (ex: "Olá", "Queridos irmãos"). Vá direto ao ponto.',
      '2) VOCÊ DEVE TRANSCREVER literalmente a parte principal do versículo que se aplica ao parágrafo antes de explicá-lo. Coloque a citação exata entre aspas.',
      '   Exemplo do formato exigido: Em Atos 3:15, Pedro diz "arrependam-se e batizem-se", o que nos mostra que devemos nos batizar por um ato de obediência.',
      '3) Não resuma o versículo nas suas próprias palavras ao apresentá-lo. Cite o que está no texto fornecido.',
      '4) Fale sempre na primeira pessoa do plural ("nós", "nosso").',
      '5) Se houver mais de um texto bíblico, crie um parágrafo novo para cada um.',
      '6) Não use formatação markdown (asteriscos, negritos, etc), apenas texto limpo dividido em parágrafos.',
      '',
      '=== PARÁGRAFO DO ESTUDO ===',
      context,
      '',
      '=== TEXTOS BÍBLICOS LIDOS DO BANCO DE DADOS ===',
      bibleTexts
    ].join('\n');
  }

  async function requestGemini(prompt, modelName, imagePart = null, isJson = true) {
    const cooldown = getActiveCooldown(modelName);
    if (cooldown.until) throw new Error(`Modelo em cooldown (${Math.ceil((Math.max(0, cooldown.until - Date.now())) / 1000)}s).`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(new Error('timeout')), Number(CONFIG.timeoutMs) || 22000);

    try {
      const url = String(CONFIG.workerUrl || '').trim();
      const body = {
        prompt: prompt.slice(0, Number(CONFIG.maxInputChars) || 12000),
        modelName: modelName,
        imagePart: imagePart,
        isJson: isJson,
        generationConfig: {
          temperature: Number(CONFIG.temperature) || 0.15,
          topP: Number(CONFIG.topP) || 0.85,
          topK: Number(CONFIG.topK) || 24,
          maxOutputTokens: Number(CONFIG.maxOutputTokens) || 2500
        }
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      const data = await response.json().catch(() => ({}));
      
      if (!response.ok) {
        const message = data?.error || `Erro ${response.status}`;
        if (response.status === 429 || /quota|rate/i.test(message)) setCooldown(modelName, extractRetryAfterMs(message, response.headers), 'rate_limit');
        throw new Error(message);
      }

      if (!data.text) throw new Error('A IA não retornou conteúdo utilizável.');
      return data.text;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function requestWithFallback(prompt, imagePart = null, isJson = true) {
    const models = Array.isArray(CONFIG.modelFallbacks) && CONFIG.modelFallbacks.length ? CONFIG.modelFallbacks.slice() : DEFAULT_CONFIG.modelFallbacks.slice();
    let lastError = null;
    for (const model of models) {
      try {
        const text = await requestGemini(prompt, model, imagePart, isJson);
        return { text, model };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error('Falha ao consultar a IA.');
  }

  function setLoading(wrapper, button, responseDiv, message) {
    if (wrapper) wrapper.classList.add('ia-loading');
    if (button) button.disabled = true;
    if (responseDiv) responseDiv.innerHTML = `<div class="ia-inline-note">${escapeHTML(message || 'Consultando a IA...')}</div>`;
  }

  function clearLoading(wrapper, button) {
    if (wrapper) wrapper.classList.remove('ia-loading');
    if (button) button.disabled = false;
  }

  async function gerarRespostaIA(idPergunta, iaWrapper, idRespostaIA) {
    const responseDiv = ensureResponseDiv(idRespostaIA);
    const button = iaWrapper?.querySelector?.('.btn-gerar-ia');

    if (!responseDiv) return;
    if (!CONFIG.enabled) { responseDiv.innerHTML = '<div class="ia-inline-note ia-status-error">Agente desativado.</div>'; return; }
    if (!isConfigured()) { responseDiv.innerHTML = '<div class="ia-inline-note ia-status-error">Configure a URL do seu Worker no arquivo.</div>'; return; }

    const bundle = getBundle(idPergunta);
    if (!bundle || !bundle.paragraphs.length) { responseDiv.innerHTML = '<div class="ia-inline-note ia-status-error">Parágrafos não encontrados.</div>'; return; }

    const imageInfo = findAssociatedImage(bundle);
    const bibleLinks = findBibleLinks(bundle);

    setLoading(iaWrapper, button, responseDiv, 'Analisando o artigo para gerar a resposta...');

    let textParsed = null;
    try {
      const prompt = buildPrompt(bundle);
      const result = await requestWithFallback(prompt, null, true);
      textParsed = safeJSONParse(result.text);
      if (!textParsed) throw new Error('Ocorreu um erro ao formatar os dados. Tente novamente.');

      textParsed.model = result.model;
      const sanitized = sanitizeModelPayload(textParsed);
      textParsed = applyLiteralHighlights(idPergunta, sanitized, bundle);
      textParsed.model = result.model;
      textParsed.has_image = !!imageInfo;
      textParsed.has_bible = bibleLinks.length > 0;

      const html = renderResponseHTML(textParsed);
      responseDiv.innerHTML = html;
      if (window.CacheAnotacao) window.CacheAnotacao.salvar(idRespostaIA, html);
    } catch (error) {
      responseDiv.innerHTML = `<div class="ia-inline-note ia-status-error">${escapeHTML(error?.message || 'Falha ao gerar a resposta.')}</div>`;
      clearLoading(iaWrapper, button);
      return;
    }

    const extraPromises = [];

    if (imageInfo) {
      extraPromises.push((async () => {
        try {
          const { base64, mime } = await getBase64Image(imageInfo.src);
          const imagePart = { inlineData: { mimeType: mime, data: base64 } };
          const imgPrompt = buildImagePrompt(bundle, imageInfo.caption);
          const imgResult = await requestWithFallback(imgPrompt, imagePart, false);
          textParsed.image_analysis = imgResult.text;
        } catch (err) {
          textParsed.image_analysis = "A imagem não pôde ser analisada corretamente ou foi bloqueada.";
        }
        const finalHtml = renderResponseHTML(textParsed);
        responseDiv.innerHTML = finalHtml;
        if (window.CacheAnotacao) window.CacheAnotacao.salvar(idRespostaIA, finalHtml);
      })());
    }

    if (bibleLinks.length > 0) {
      extraPromises.push((async () => {
        try {
          let fetchedTexts = [];
          for (let bbl of bibleLinks) {
            let txt = await getBibleText(bbl);
            if (txt) fetchedTexts.push(txt);
          }
          if (fetchedTexts.length > 0) {
            const biblePrompt = buildBiblePrompt(bundle, fetchedTexts.join('\n\n'));
            const bibleResult = await requestWithFallback(biblePrompt, null, false);
            textParsed.bible_analysis = bibleResult.text;
          } else {
            textParsed.bible_analysis = "O sistema não conseguiu extrair os textos do banco de dados (abreviação não suportada ou JSON ausente).";
          }
        } catch (err) {
          textParsed.bible_analysis = "Erro ao cruzar os textos bíblicos.";
        }
        const finalHtml = renderResponseHTML(textParsed);
        responseDiv.innerHTML = finalHtml;
        if (window.CacheAnotacao) window.CacheAnotacao.salvar(idRespostaIA, finalHtml);
      })());
    }

    Promise.all(extraPromises).finally(() => {
      clearLoading(iaWrapper, button);
    });
  }

  function unavailableMessage(kind, responseDiv) {
    if (!responseDiv) return;
    responseDiv.innerHTML = `<div class="ia-inline-note">O agente de ${escapeHTML(kind)} não está disponível neste pacote.</div>`;
  }

  window.gerarRespostaIA = gerarRespostaIA;
  if (typeof window.gerarRespostaIA_Recap !== 'function') {
    window.gerarRespostaIA_Recap = function(idPergunta, iaWrapper, idRespostaIA) { unavailableMessage('recapitulação', document.getElementById(idRespostaIA)); };
  }
  if (typeof window.gerarRespostaIA_Objetivo !== 'function') {
    window.gerarRespostaIA_Objetivo = function(idObjetivo, iaWrapper, idRespostaIA) { unavailableMessage('objetivo', document.getElementById(idRespostaIA)); };
  }
})();