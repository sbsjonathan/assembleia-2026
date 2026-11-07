(function () {
  const DEFAULT_CONFIG = {
    enabled: true,
    workerUrl: 'https://gem-congresso.jonjonathan2-0.workers.dev',
    model: 'gemini-3.1-flash-lite',
    modelFallbacks: [
      'gemini-3.1-flash-lite',
      'gemini-3.5-flash',
      'gemini-2.5-flash-lite'
    ],
    timeoutMs: 18000,
    thresholdChars: 10,
    maxSummaryChars: 700,
    maxInputChars: 5000,
    maxOutputTokens: 256,
    temperature: 0.28,
    topP: 0.8,
    topK: 24,
    cooldownKey: '__assembleia_ia_cooldown__',
    defaultCooldownMs: 30000
  };

  const userConfig = window.ASSEMBLEIA_IA_CONFIG || {};
  const CONFIG = Object.assign({}, DEFAULT_CONFIG, userConfig);
  const VERSION = 3;
  const dbg = window.ASMBDebug || { log(){}, warn(){}, error(){} };

  function createRecord() {
    return {
      version: VERSION,
      fullHtml: '',
      fullText: '',
      summaryText: '',
      hasSummary: false,
      status: 'idle',
      errorMessage: '',
      summaryModel: '',
      pendingToken: '',
      pendingStartedAt: 0,
      isVirgin: true,
      lastAgentText: '',
      updatedAt: 0
    };
  }

  function normalizeSpaces(text) {
    return String(text || '')
      .replace(/\u200B/g, '')
      .replace(/\r\n?/g, '\n')
      .replace(/[\t\f\v ]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function escapeHTML(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function textToHTML(text) {
    const clean = normalizeSpaces(String(text || '').replace(/\u00A0/g, ' '));
    if (!clean) return '';
    return escapeHTML(clean).replace(/\n/g, '<br>');
  }

  function htmlToText(html) {
    const markup = String(html || '').trim();
    if (!markup) return '';

    const root = document.createElement('div');
    root.innerHTML = markup;
    // Collapsed branches remain part of the annotation. Strip only editor UI,
    // then read every text node, including the current rich editor's .children.
    root.querySelectorAll('script, style, .toggle-arrow, .text-plus, .expand-handle-asmb, .asmb-status-badge').forEach(node => node.remove());
    root.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
    root.querySelectorAll('p, div, li, ul, ol, h1, h2, h3, h4, h5, h6, blockquote, .toggle-title, .paragraph-content, .text-content').forEach(block => {
      block.prepend('\n');
      block.append('\n');
    });
    return normalizeSpaces(root.textContent || '');
  }

  function clampSummary(text) {
    const clean = normalizeSpaces(text);
    const limit = Number(CONFIG.maxSummaryChars || 700);
    if (clean.length <= limit) return clean;
    const head = clean.slice(0, limit);
    const sentenceEnd = Math.max(
      head.lastIndexOf('. '),
      head.lastIndexOf('! '),
      head.lastIndexOf('? '),
      head.lastIndexOf('.\n'),
      head.lastIndexOf('!\n'),
      head.lastIndexOf('?\n')
    );
    if (sentenceEnd > 0) return head.slice(0, sentenceEnd + 1).trim();
    const lastStop = Math.max(head.lastIndexOf('.'), head.lastIndexOf('!'), head.lastIndexOf('?'));
    if (lastStop > 0) return head.slice(0, lastStop + 1).trim();
    return head.trim();
  }

  function isRichMarkup(html) {
    return /class\s*=\s*["'][^"']*(node-paragraph|node-toggle|node-text)/i.test(String(html || ''));
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
    if (aLen > bLen) {
      [aText, bText] = [bText, aText];
      [aLen, bLen] = [bLen, aLen];
    }
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
        curr[j] = Math.min(
          prev[j] + 1,
          curr[j - 1] + 1,
          prev[j - 1] + cost
        );
        if (curr[j] < rowMin) rowMin = curr[j];
      }
      if (rowMin > limit) return limit + 1;
      [prev, curr] = [curr, prev];
    }
    return prev[bLen];
  }

  function compareAgainstLastAgent(record) {
    const current = normalizeSpaces(record?.fullText || '');
    const baseline = normalizeSpaces(record?.lastAgentText || '');
    const threshold = Math.max(0, Number(CONFIG.thresholdChars || 10));
    if (!baseline) {
      return { hasBaseline: false, same: false, smallChange: false, distance: null, threshold };
    }
    const distance = boundedLevenshtein(current, baseline, threshold);
    return {
      hasBaseline: true,
      same: distance === 0,
      smallChange: distance <= threshold,
      distance,
      threshold
    };
  }

  function maybeMarkNotVirgin(record) {
    if (!record) return record;
    if (record.isVirgin === false) return record;
    if (isRichMarkup(record.fullHtml || '')) {
      record.isVirgin = false;
    }
    return record;
  }

  function isRecordMeaningfullyEmpty(record) {
    const text = normalizeSpaces(record?.fullText || '');
    const rich = isRichMarkup(record?.fullHtml || '');
    return !text && !rich;
  }

  function resetRecordToVirgin(record) {
    if (!record) return createRecord();
    record.fullHtml = '';
    record.fullText = '';
    record.summaryText = '';
    record.hasSummary = false;
    record.status = 'idle';
    record.errorMessage = '';
    record.summaryModel = '';
    record.pendingToken = '';
    record.pendingStartedAt = 0;
    record.isVirgin = true;
    record.lastAgentText = '';
    return record;
  }

  function isConfigured() {
    const url = String(CONFIG.workerUrl || '').trim();
    return !!url;
  }

  function shouldSummarize(text) {
    const clean = normalizeSpaces(text);
    const result = clean.length > Number(CONFIG.thresholdChars || 10);
    dbg.log('ia:shouldSummarize', { length: clean.length, threshold: Number(CONFIG.thresholdChars || 10), result, preview: clean.slice(0, 160) });
    return result;
  }

  function prepareInputText(text) {
    const clean = normalizeSpaces(String(text || ''));
    const max = Math.max(100, Number(CONFIG.maxInputChars || 5000));
    const limited = clean.length > max ? clean.slice(0, max).trim() : clean;
    dbg.log('ia:prepareInputText', {
      originalLength: clean.length,
      sentLength: limited.length,
      truncated: limited.length < clean.length,
      maxInputChars: max,
      preview: limited.slice(0, 180)
    });
    return limited;
  }

  function serializeError(error) {
    if (!error) return { message: 'Erro desconhecido' };
    return { name: error.name || 'Error', message: error.message || String(error), stack: error.stack || '' };
  }

  function normalizeSummaryOutput(text) {
    return clampSummary(String(text || '')
      .replace(/^Resumo:\s*/i, '')
      .replace(/^"|"$/g, '')
      .replace(/\.\.\.$/, '')
      .replace(/…$/, ''));
  }

  function getModelQueue() {
    const configuredList = Array.isArray(CONFIG.modelFallbacks) ? CONFIG.modelFallbacks : [];
    const rawList = [CONFIG.model, ...configuredList]
      .map((item) => String(item || '').trim())
      .filter(Boolean);
    const unique = [];
    rawList.forEach((item) => {
      if (!unique.includes(item)) unique.push(item);
    });
    return unique;
  }

  function getCooldownStorageKey(modelName) {
    return `${String(CONFIG.cooldownKey || '__assembleia_ia_cooldown__')}:${String(modelName || 'global')}`;
  }

  function readCooldown(modelName) {
    try {
      const raw = localStorage.getItem(getCooldownStorageKey(modelName));
      if (!raw) return { until: 0, reason: '', model: String(modelName || '') };
      const parsed = JSON.parse(raw);
      return {
        until: Number(parsed?.until) || 0,
        reason: String(parsed?.reason || ''),
        model: String(parsed?.model || modelName || '')
      };
    } catch {
      return { until: 0, reason: '', model: String(modelName || '') };
    }
  }

  function writeCooldown(modelName, until, reason) {
    try {
      localStorage.setItem(getCooldownStorageKey(modelName), JSON.stringify({
        until: Number(until) || 0,
        reason: String(reason || ''),
        model: String(modelName || '')
      }));
      return true;
    } catch {
      return false;
    }
  }

  function clearCooldown(modelName) {
    try {
      localStorage.removeItem(getCooldownStorageKey(modelName));
      return true;
    } catch {
      return false;
    }
  }

  function getActiveCooldown(modelName) {
    const data = readCooldown(modelName);
    if (data.until > Date.now()) return data;
    if (data.until) clearCooldown(modelName);
    return { until: 0, reason: '', model: String(modelName || '') };
  }

  function extractRetryAfterMs(message, headers) {
    const retryHeader = headers?.get?.('retry-after');
    if (retryHeader) {
      const seconds = Number(retryHeader);
      if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds * 1000);
      const parsedDate = Date.parse(retryHeader);
      if (Number.isFinite(parsedDate) && parsedDate > Date.now()) return parsedDate - Date.now();
    }
    const match = String(message || '').match(/retry in\s+([\d.]+)s/i);
    if (match) {
      const seconds = Number(match[1]);
      if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds * 1000);
    }
    return Number(CONFIG.defaultCooldownMs || 30000);
  }

  function createApiError(message, meta) {
    const error = new Error(message || 'Erro na API');
    Object.assign(error, meta || {});
    return error;
  }

  function extractContext(id) {
    if (!id) return '';
    let temaDia = '';
    let temaSimposio = '';
    let temaDiscurso = '';

    const isFullScreen = !!document.querySelector('.fullsc-app');
    if (isFullScreen) {
      const titleEl = document.getElementById('fullscTitle');
      if (titleEl) temaDiscurso = titleEl.textContent.replace(/\s+/g, ' ').trim();
      const kicker = document.querySelector('.fullsc-kicker');
      if (kicker && !kicker.classList.contains('is-hidden') && !kicker.hidden) {
        temaSimposio = kicker.textContent.replace(/\s+/g, ' ').trim();
      }
    } else {
      const temaEl = document.querySelector('.assembly-heading h1, .tema');
      if (temaEl) {
        temaDia = temaEl.textContent.replace(/\s+/g, ' ').trim();
      }
      try {
        const trigger = document.querySelector(`[data-clickable-id="${CSS.escape(id)}"]`);
        if (trigger) {
          const clone = trigger.cloneNode(true);
          clone.querySelectorAll('.hora').forEach(n => n.remove());
          temaDiscurso = clone.textContent.replace(/\s+/g, ' ').trim();

          if (trigger.tagName.toUpperCase() === 'LI') {
            let node = trigger.parentElement;
            while (node) {
              let prev = node.previousElementSibling;
              while (prev) {
                if (prev.tagName.toUpperCase() === 'P') {
                  const pClone = prev.cloneNode(true);
                  pClone.querySelectorAll('.hora').forEach(n => n.remove());
                  temaSimposio = pClone.textContent.replace(/\s+/g, ' ').trim();
                  break;
                }
                prev = prev.previousElementSibling;
              }
              if (temaSimposio) break;
              node = node.parentElement;
              if (!node || node === document.body) break;
            }
          }
        }
      } catch (e) {}
    }

    let partes = [];
    if (temaDia) partes.push(`TEMA DO DIA: ${temaDia}`);
    if (temaSimposio) partes.push(`SIMPÓSIO: ${temaSimposio}`);
    if (temaDiscurso) partes.push(`DISCURSO: ${temaDiscurso}`);

    return partes.join(' | ');
  }

  async function callGemini(text, id) {
    const preparedText = prepareInputText(text);
    const models = getModelQueue();
    const workerUrl = String(CONFIG.workerUrl || '').trim().replace(/\/$/, '');
    if (!workerUrl) {
      throw createApiError('Worker de IA não configurado.', { status: 0, canFallback: false });
    }

    const contexto = extractContext(id);
    let systemInstruction = `Você é um assistente focado APENAS em resumir anotações da assembleia de circuito de uma Testemunha de Jeová. Escreva de forma impessoal (sem usar primeira pessoa), vá direto ao ponto e não use aspas, prefixos ou saudações.

HIERARQUIA E LIMITES OBRIGATÓRIOS:
1. VOCÊ É UM RESUMIDOR: Seu trabalho é destilar a essência do que o usuário anotou. O resumo DEVE ser obrigatoriamente e visivelmente mais curto que a anotação original.
2. NUNCA INVENTE CONTEÚDO: Nunca adicione ensinamentos, conselhos, textos bíblicos ou conclusões espirituais que não estejam explicitamente escritos nas anotações do usuário.
3. O TEMA É PASSIVO: O título do discurso e do simpósio servem APENAS como etiqueta para você entender sobre o que a pessoa anotou. NÃO desenvolva o tema por iniciativa própria. 
4. TAMANHO ULTRA CONCISO: Crie um único parágrafo com no máximo 1 ou 2 frases curtas. Vá direto à ideia central (ex: a lição de um vídeo ou de um texto bíblico que a pessoa citou).
5. LIDANDO COM OFF-TOPIC (TEXTOS SEM NEXO): Se a anotação do usuário não tiver relação aparente com o contexto/tema (ex: "Amanhã é domingo"), NÃO TENTE criar uma ponte ou lição espiritual forçada. Relate o fato de forma seca.
Use exatamente este modelo: "A anotação menciona que [assunto aleatório], mas não traz detalhes adicionais referentes ao discurso [Tema do Discurso]."`;

    if (contexto) {
      systemInstruction += `\n\nCONTEXTO DO DISCURSO (Usar apenas como referência passiva):\n${contexto}`;
    }

    const payload = {
      prompt: preparedText,
      systemInstruction,
      isJson: false,
      models,
      generationConfig: {
        temperature: CONFIG.temperature,
        topP: CONFIG.topP,
        topK: CONFIG.topK,
        maxOutputTokens: CONFIG.maxOutputTokens
      }
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONFIG.timeoutMs);
    const startedAt = Date.now();
    dbg.log('ia:callGemini:start', {
      models,
      textLength: preparedText.length,
      preview: preparedText.slice(0, 180)
    });

    let rawText = '';
    let response = null;
    try {
      response = await fetch(workerUrl, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      rawText = await response.text();
      dbg.log('ia:callGemini:response', {
        status: response.status,
        ok: response.ok,
        durationMs: Date.now() - startedAt,
        bodyPreview: rawText.slice(0, 320)
      });

      let data = {};
      if (rawText) {
        try { data = JSON.parse(rawText); }
        catch (error) {
          throw createApiError(`Resposta inválida do Worker (${response.status})`, {
            status: response.status,
            isParseError: true
          });
        }
      }

      if (!response.ok) {
        const message = data?.error || `HTTP ${response.status}`;
        const status = Number(response.status) || 0;
        const isRateLimit = status === 429;
        const canFallback = isRateLimit || status === 500 || status === 503;
        throw createApiError(message, {
          status,
          isRateLimit,
          canFallback,
          bodyPreview: rawText.slice(0, 320)
        });
      }

      const summary = normalizeSummaryOutput(String(data?.text || '').trim());
      if (!summary) throw createApiError('Resposta vazia da IA', {
        status: response.status || 200,
        bodyPreview: rawText.slice(0, 320)
      });

      const usedModel = data?.model || (models[0] || '');
      dbg.log('ia:callGemini:summary-received', {
        model: usedModel,
        summaryLength: summary.length,
        durationMs: Date.now() - startedAt,
        summaryPreview: summary.slice(0, 240)
      });
      return { summary, model: usedModel };
    } catch (error) {
      dbg.error('ia:callGemini:error', {
        durationMs: Date.now() - startedAt,
        error: serializeError(error),
        bodyPreview: rawText.slice(0, 320)
      });
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  const unsavedRecords = new Map();
  const STORAGE_WARNING_ID = 'assembleia-storage-warning';

  function updateStorageWarning() {
    let warning = document.getElementById(STORAGE_WARNING_ID);
    if (!unsavedRecords.size) { warning?.remove(); return; }
    if (!document.body || warning) return;
    warning = document.createElement('div');
    warning.id = STORAGE_WARNING_ID;
    warning.setAttribute('role', 'alert');
    warning.style.cssText = 'position:fixed;z-index:2147483600;top:calc(env(safe-area-inset-top,0px) + 12px);left:12px;right:12px;background:#fff3d6;color:#573d00;padding:12px 16px;border:1px solid #c89d43;border-radius:12px;font:15px/1.4 system-ui;box-shadow:0 4px 20px #0002';
    const message = document.createElement('span');
    message.textContent = 'Não foi possível salvar neste aparelho. Mantenha esta tela aberta e copie sua anotação. ';
    const retry = document.createElement('button');
    retry.type = 'button'; retry.textContent = 'Tentar novamente';
    retry.addEventListener('click', retryUnsavedRecords);
    warning.append(message, retry);
    document.body.appendChild(warning);
  }

  function retryUnsavedRecords() {
    for (const [id, value] of [...unsavedRecords]) {
      try { writeRaw(id, value); } catch (_) { break; }
    }
  }

  function readRaw(id) {
    if (unsavedRecords.has(id)) return unsavedRecords.get(id);
    try { return localStorage.getItem(id); } catch { return null; }
  }

  function writeRaw(id, value) {
    try {
      localStorage.setItem(id, value);
      unsavedRecords.delete(id);
      updateStorageWarning();
      window.dispatchEvent(new CustomEvent('assembleia:stored', { detail: { id } }));
      return true;
    } catch (cause) {
      unsavedRecords.set(id, value);
      updateStorageWarning();
      const error = new Error('Não foi possível salvar a anotação neste aparelho.');
      error.name = 'AssemblyStorageError';
      error.cause = cause;
      window.dispatchEvent(new CustomEvent('assembleia:storageerror', { detail: { id, message: error.message } }));
      throw error;
    }
  }

  window.addEventListener('focus', retryUnsavedRecords);
  window.addEventListener('beforeunload', event => {
    if (unsavedRecords.size) { event.preventDefault(); event.returnValue = ''; }
  });

  function legacyToRecord(value) {
    const record = createRecord();
    const html = String(value || '');
    record.fullHtml = html;
    record.fullText = htmlToText(html);
    record.updatedAt = Date.now();
    return record;
  }

  function coerceRecord(parsed) {
    if (!parsed || typeof parsed !== 'object') return createRecord();
    const fullHtml = typeof parsed.fullHtml === 'string' ? parsed.fullHtml : '';
    const fullText = typeof parsed.fullText === 'string' ? parsed.fullText : htmlToText(fullHtml || '');
    const summaryText = typeof parsed.summaryText === 'string' ? parsed.summaryText : '';
    const hasSummary = !!parsed.hasSummary && !!normalizeSpaces(summaryText || '');
    const inferredVirgin = typeof parsed.isVirgin === 'boolean'
      ? parsed.isVirgin
      : !(hasSummary || isRichMarkup(fullHtml));

    return {
      version: parsed.version || VERSION,
      fullHtml,
      fullText,
      summaryText,
      hasSummary,
      status: typeof parsed.status === 'string' ? parsed.status : (hasSummary ? 'summarized' : 'idle'),
      errorMessage: typeof parsed.errorMessage === 'string' ? parsed.errorMessage : '',
      summaryModel: typeof parsed.summaryModel === 'string' ? parsed.summaryModel : '',
      pendingToken: typeof parsed.pendingToken === 'string' ? parsed.pendingToken : '',
      pendingStartedAt: Number(parsed.pendingStartedAt) || 0,
      isVirgin: inferredVirgin,
      lastAgentText: typeof parsed.lastAgentText === 'string'
        ? parsed.lastAgentText
        : (hasSummary ? normalizeSpaces(fullText) : ''),
      updatedAt: Number(parsed.updatedAt) || 0
    };
  }

  function readRecord(id) {
    const raw = readRaw(id);
    if (!raw) return createRecord();

    try {
      const parsed = JSON.parse(raw);
      return coerceRecord(parsed);
    } catch {
      return legacyToRecord(raw);
    }
  }

  function writeRecord(id, nextRecord) {
    const record = coerceRecord(nextRecord);
    record.fullText = htmlToText(record.fullHtml || '');
    record.summaryText = clampSummary(record.summaryText || '');
    record.hasSummary = !!record.summaryText && !!record.hasSummary;
    if (record.hasSummary && record.status !== 'pending') record.status = 'summarized';
    if (!record.hasSummary && record.status === 'summarized') record.status = 'idle';
    if (record.status !== 'pending') record.pendingToken = '';
    if (record.status === 'pending' && !record.pendingStartedAt) record.pendingStartedAt = Date.now();
    record.isVirgin = !!record.isVirgin;
    record.updatedAt = Date.now();
    writeRaw(id, JSON.stringify(record));
    dbg.log('ia:writeRecord', {
      id,
      status: record.status,
      isVirgin: record.isVirgin,
      fullTextLength: record.fullText.length,
      summaryLength: record.summaryText.length,
      hasSummary: record.hasSummary,
      preview: record.summaryText || record.fullText.slice(0, 160)
    });
    return record;
  }

  function saveInlineDraft(id, inlineHtml) {
    const record = readRecord(id);
    record.fullHtml = String(inlineHtml || '').trim();
    record.fullText = htmlToText(record.fullHtml);
    if (isRecordMeaningfullyEmpty(record)) {
      return writeRecord(id, resetRecordToVirgin(record));
    }
    maybeMarkNotVirgin(record);
    record.summaryText = '';
    record.hasSummary = false;
    record.status = 'idle';
    record.errorMessage = '';
    record.summaryModel = '';
    return writeRecord(id, record);
  }

  function saveFullDraft(id, fullHtml) {
    const record = readRecord(id);
    const previousText = normalizeSpaces(record.fullText);
    record.fullHtml = String(fullHtml || '').trim();
    record.fullText = htmlToText(record.fullHtml);
    if (isRecordMeaningfullyEmpty(record)) {
      const written = writeRecord(id, resetRecordToVirgin(record));
      dbg.log('ia:saveFullDraft', { id, htmlLength: 0, textLength: 0, preview: '' });
      return written;
    }
    maybeMarkNotVirgin(record);
    if (record.status === 'pending' && normalizeSpaces(record.fullText) !== previousText) {
      record.status = 'idle';
      record.pendingToken = '';
      record.pendingStartedAt = 0;
    }
    if (record.status !== 'pending') {
      record.errorMessage = '';
      if (!record.hasSummary) record.summaryModel = '';
    }
    dbg.log('ia:saveFullDraft', { id, htmlLength: record.fullHtml.length, textLength: record.fullText.length, preview: record.fullText.slice(0, 160) });
    return writeRecord(id, record);
  }

  const inflightPending = new Map();

  function dispatchRecordChange(id, record) {
    try {
      window.dispatchEvent(new CustomEvent('assembleia:recordchange', {
        detail: { id, record: coerceRecord(record) }
      }));
    } catch {}
  }

  function classifySummaryError(error) {
    if (!navigator.onLine) return 'error_network';
    const status = Number(error?.status || 0);
    if (error?.name === 'AbortError') return 'error_network';
    if (status === 429 || status === 500 || status === 503 || error?.isRateLimit || error?.code === 'COOLDOWN_ACTIVE') return 'error_api';
    if (status >= 400) return 'error_api';
    return 'error_network';
  }

  async function finalizeFromFull(id, fullHtml) {
    const queued = queueSummaryFromFull(id, fullHtml);
    if (getRecordStatus(queued) !== 'pending') return queued;
    return processPendingSummary(id);
  }

  function queueSummaryFromFull(id, fullHtml) {
    const record = readRecord(id);
    const previousText = normalizeSpaces(record.fullText);
    record.fullHtml = String(fullHtml || '').trim();
    record.fullText = htmlToText(record.fullHtml);

    if (isRecordMeaningfullyEmpty(record)) {
      const written = writeRecord(id, resetRecordToVirgin(record));
      dispatchRecordChange(id, written);
      return written;
    }

    maybeMarkNotVirgin(record);

    if (!shouldSummarize(record.fullText)) {
      record.summaryText = '';
      record.hasSummary = false;
      record.status = 'idle';
      record.errorMessage = '';
      record.summaryModel = '';
      const written = writeRecord(id, record);
      dispatchRecordChange(id, written);
      return written;
    }

    if (record.status === 'pending' && record.pendingToken && normalizeSpaces(record.fullText) === previousText) {
      const written = writeRecord(id, record);
      dispatchRecordChange(id, written);
      return written;
    }

    const comparison = compareAgainstLastAgent(record);
    dbg.log('ia:compareText', {
      id,
      hasBaseline: comparison.hasBaseline,
      same: comparison.same,
      smallChange: comparison.smallChange,
      distance: comparison.distance,
      threshold: comparison.threshold
    });

    if (record.hasSummary && comparison.hasBaseline && comparison.smallChange) {
      record.status = record.hasSummary ? 'summarized' : 'idle';
      record.errorMessage = '';
      if (!record.hasSummary) record.summaryModel = '';
      const written = writeRecord(id, record);
      dispatchRecordChange(id, written);
      return written;
    }

    if (!CONFIG.enabled || !isConfigured()) {
      record.summaryText = '';
      record.hasSummary = false;
      record.status = 'idle';
      record.errorMessage = '';
      record.summaryModel = '';
      const written = writeRecord(id, record);
      dispatchRecordChange(id, written);
      return written;
    }

    record.summaryText = '';
    record.hasSummary = false;
    record.status = 'pending';
    record.errorMessage = '';
    record.summaryModel = '';
    record.pendingToken = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    record.pendingStartedAt = Date.now();
    const written = writeRecord(id, record);
    dispatchRecordChange(id, written);
    return written;
  }

  function getRecordStatus(idOrRecord) {
    const record = typeof idOrRecord === 'string' ? readRecord(idOrRecord) : coerceRecord(idOrRecord);
    if (record.status) return record.status;
    return record.hasSummary ? 'summarized' : 'idle';
  }

  async function processPendingSummary(id) {
    if (!id) return createRecord();
    const record = readRecord(id);
    if (getRecordStatus(record) !== 'pending' || !normalizeSpaces(record.fullText || '')) return record;
    const token = record.pendingToken || '';
    const inflight = inflightPending.get(id);
    if (inflight?.token === token) return inflight.promise;

    const job = (async () => {
      try {
        const result = await callGemini(record.fullText, id);
        const latest = readRecord(id);
        if (getRecordStatus(latest) !== 'pending' || latest.pendingToken !== token || normalizeSpaces(latest.fullText) !== normalizeSpaces(record.fullText)) return latest;
        latest.summaryText = clampSummary(result.summary);
        latest.hasSummary = !!latest.summaryText;
        latest.status = latest.hasSummary ? 'summarized' : 'idle';
        latest.errorMessage = '';
        latest.summaryModel = result.model || '';
        latest.lastAgentText = normalizeSpaces(latest.fullText || '');
        const written = writeRecord(id, latest);
        dispatchRecordChange(id, written);
        return written;
      } catch (error) {
        const latest = readRecord(id);
        if (getRecordStatus(latest) !== 'pending' || latest.pendingToken !== token || normalizeSpaces(latest.fullText) !== normalizeSpaces(record.fullText)) return latest;
        latest.summaryText = '';
        latest.hasSummary = false;
        latest.status = classifySummaryError(error);
        latest.errorMessage = String(error?.message || '').trim();
        latest.summaryModel = '';
        // A failed request is not a completed summary. Keep the last successful
        // baseline so reopening the same note can actually retry.
        const written = writeRecord(id, latest);
        dispatchRecordChange(id, written);
        return written;
      } finally {
        if (inflightPending.get(id)?.token === token) inflightPending.delete(id);
      }
    })();

    inflightPending.set(id, { token, promise: job });
    return job;
  }

  function getInlineHTML(idOrRecord) {
    const record = typeof idOrRecord === 'string' ? readRecord(idOrRecord) : coerceRecord(idOrRecord);
    if (record.hasSummary) return textToHTML(record.summaryText);
    const rich = String(record.fullHtml || '').trim();
    if (rich) return rich;
    return textToHTML(record.fullText);
  }

  function getFullHTML(idOrRecord) {
    const record = typeof idOrRecord === 'string' ? readRecord(idOrRecord) : coerceRecord(idOrRecord);
    return String(record.fullHtml || '');
  }

  function isSummaryMode(idOrRecord) {
    const record = typeof idOrRecord === 'string' ? readRecord(idOrRecord) : coerceRecord(idOrRecord);
    return !!record.hasSummary && !!normalizeSpaces(record.summaryText || '');
  }

  function isVirginRecord(idOrRecord) {
    const record = typeof idOrRecord === 'string' ? readRecord(idOrRecord) : coerceRecord(idOrRecord);
    return !!record.isVirgin;
  }
  function clearRecord(id) {
    try { localStorage.removeItem(id); return true; } catch { return false; }
  }

  // --- O NOVO AGENTE DE PONTOS ALTOS ---
  window.AssembleiaIA = window.AssembleiaIA || {};
  
  window.AssembleiaIA.gerarPontosAltosDia = async function(dia, wrapperElement, idRespostaIA) {
      const respostaDiv = document.getElementById(idRespostaIA);
      if (!respostaDiv) return;
      if (!CONFIG.enabled || !isConfigured()) {
          respostaDiv.innerHTML = '<span style="color:#b91c1c;">Configure o Worker da IA.</span>';
          return;
      }

      let textoTotal = '';

      // Lê a raiz pura de todos os editores do dia usando readRecord (ignora a interface gráfica)
      document.querySelectorAll('.clickable-asmb[data-id]').forEach(editor => {
          const id = editor.dataset.id;
          if (document.documentElement.dataset.programId && !id.startsWith('ca-copgm27:nota:')) return;
          const record = readRecord(id);
          
          if (record && record.fullText && record.fullText.length > 5) {
              textoTotal += record.fullText + '\n\n';
          }
      });

      if (textoTotal.trim().length < 15) {
          respostaDiv.innerHTML = '<span style="color: var(--text-muted, #9ca3af);">Aguardando suas anotações da assembleia para gerar os pontos altos.</span>';
          return;
      }

      wrapperElement.classList.add('ia-loading');
      respostaDiv.innerHTML = '<span style="color: var(--text-muted, #6b7280);">✨ Analisando suas anotações da assembleia...</span>';

      try {
          let nomeIrmao = '';
          try {
              const userRaw = localStorage.getItem('supabase_user');
              if (userRaw) {
                  const user = JSON.parse(userRaw);
                  let nomeFull = user.nome || user.usuario || '';
                  if (nomeFull) {
                      nomeIrmao = nomeFull.trim().split(' ')[0];
                      if (nomeIrmao) {
                          nomeIrmao = nomeIrmao.charAt(0).toUpperCase() + nomeIrmao.slice(1).toLowerCase();
                      }
                  }
              }
          } catch(e) {
              console.error("Erro ao ler usuário:", e);
          }

          const nomeDia = 'assembleia';
          const saudacao = nomeIrmao ? `Comece com uma saudação calorosa chamando o usuário pelo nome (${nomeIrmao}) (ex: "A ${nomeDia} trouxe bons lembretes, ${nomeIrmao}!").` : `Comece com uma saudação calorosa sobre a ${nomeDia}.`;

          const prompt = [
              `Você é um amigo cristão conversando no fim da ${nomeDia}.`,
              `Com base APENAS nas anotações feitas pelo usuário abaixo, faça um resumo de 1 ou 2 parágrafos com os pontos altos do dia.`,
              saudacao,
              `Use linguagem natural, amorosa, clara e edificante. Retorne APENAS um JSON válido.`,
              `Esquema JSON obrigatório:`,
              `{ "pontos_altos": "Texto do resumo..." }`,
              ``,
              `ANOTAÇÕES DO DIA:`,
              textoTotal
          ].join('\n');

          const models = getModelQueue();
          const workerUrl = String(CONFIG.workerUrl || '').trim().replace(/\/$/, '');
          
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), CONFIG.timeoutMs);
          
          const response = await fetch(workerUrl, {
              method: 'POST',
              signal: controller.signal,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                  prompt,
                  isJson: true,
                  models,
                  generationConfig: { temperature: 0.6, topP: 0.9, topK: 40, maxOutputTokens: 1024 }
              })
          });
          clearTimeout(timeout);

          const data = await response.json().catch(()=>({}));
          if (!response.ok) throw new Error(data?.error || 'Erro na API');
          if (!data.text) throw new Error('Retorno vazio');

          let parsed;
          try {
              const cleaned = data.text.replace(/\`\`\`json/g, '').replace(/\`\`\`/g, '').trim();
              parsed = JSON.parse(cleaned);
          } catch(e) {
              throw new Error('Falha ao processar o formato da resposta.');
          }

          const resumo = parsed.pontos_altos || parsed.PontosAltos || parsed.pontosAltos || '';
          if (!resumo) throw new Error('Resumo vazio.');

          const htmlFinal = textToHTML(resumo) + (data.model && typeof window.DEBUG_G !== 'undefined' ? `<div style="font-size:0.75rem; color:#166534; margin-top:8px;">Modelo: ${escapeHTML(data.model)}</div>` : '');
          respostaDiv.innerHTML = htmlFinal;

          writeRaw(idRespostaIA, htmlFinal);
          window.dispatchEvent(new CustomEvent('assembleia:recordchange'));

      } catch(error) {
          respostaDiv.innerHTML = `<span style="color:#b91c1c;">Falha ao gerar os pontos altos: ${escapeHTML(error.message)}</span>`;
      } finally {
          wrapperElement.classList.remove('ia-loading');
      }
  };

  dbg.log('ia:init', {
    enabled: CONFIG.enabled,
    model: CONFIG.model,
    modelFallbacks: getModelQueue(),
    thresholdChars: CONFIG.thresholdChars,
    configured: isConfigured(),
    workerUrl: CONFIG.workerUrl,
    maxInputChars: CONFIG.maxInputChars,
    maxOutputTokens: CONFIG.maxOutputTokens
  });

  window.ASSEMBLEIA_IA_CONFIG = CONFIG;
  window.AssembleiaIA = Object.assign(window.AssembleiaIA || {}, {
    config: CONFIG,
    createRecord,
    readRecord,
    writeRecord,
    flushPendingWrites() { retryUnsavedRecords(); return unsavedRecords.size === 0; },
    saveInlineDraft,
    saveFullDraft,
    finalizeFromFull,
    queueSummaryFromFull,
    processPendingSummary,
    getInlineHTML,
    getFullHTML,
    getRecordStatus,
    htmlToText,
    textToHTML,
    shouldSummarize,
    isSummaryMode,
    isVirginRecord,
    clearRecord,
    isConfigured,
    prepareInputText
  });
})();