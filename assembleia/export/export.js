(function () {
  const PROGRAM_ID = 'ca-copgm27';
  const PROGRAM_PREFIX = `${PROGRAM_ID}:`;
  const PANELS = ['manha', 'tarde', 'perguntas'];
  const PANEL_NAMES = { manha: 'Manhã', tarde: 'Tarde', perguntas: 'Perguntas de revisão' };
  const PREFERENCE_KEYS = ['tema-interface', 'tamanho-fonte-global', 'editor-performance-mode', 'cor-assembleia'];

  function qs(selector, root = document) {
    return root.querySelector(selector);
  }

  function qsa(selector, root = document) {
    return Array.from(root.querySelectorAll(selector));
  }

  function getProgramYear() {
    return String(document.documentElement.dataset.programYear || '2026').trim();
  }

  function getDisplayedPanel() {
    const selected = document.querySelector('[role="tab"][aria-selected="true"][data-session]')?.dataset.session;
    return PANELS.includes(selected) ? selected : 'manha';
  }

  function escapeHTML(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normalizeText(text) {
    return String(text || '')
      .replace(/\u200B/g, '')
      .replace(/\r\n?/g, '\n')
      .replace(/[\t\f\v ]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function slug(text) {
    return String(text || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);
  }

  function htmlToText(html) {
    const root = document.createElement('div');
    root.innerHTML = String(html || '').trim();
    root.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
    return normalizeText(root.textContent || '');
  }

  function coerceRecord(parsed) {
    if (!parsed || typeof parsed !== 'object') return null;
    const fullHtml = typeof parsed.fullHtml === 'string' ? parsed.fullHtml : '';
    return {
      fullHtml,
      fullText: typeof parsed.fullText === 'string' ? parsed.fullText : htmlToText(fullHtml)
    };
  }

  function readRecord(id) {
    try {
      if (window.AssembleiaIA?.readRecord) {
        return window.AssembleiaIA.readRecord(id);
      }
      const raw = localStorage.getItem(id);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return coerceRecord(parsed);
    } catch {
      return null;
    }
  }

  // Pega o texto ÍNTEGRO, ignorando resumos da IA
  function getRecordExportText(id) {
    if (!id) return '';
    const record = readRecord(id);
    if (!record) return '';
    return normalizeText(record.fullText || '');
  }

  function getLocalExportPayload() {
    if (window.AssembleiaIA?.flushPendingWrites?.() === false) {
      throw new Error('Não foi possível salvar a última edição. Tente novamente antes de exportar.');
    }
    const preferences = {};
    PREFERENCE_KEYS.forEach((key) => {
      const value = localStorage.getItem(key);
      if (value !== null) preferences[key] = value;
    });
    const annotations = {};
    const archives = {};
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key?.startsWith(PROGRAM_PREFIX)) annotations[key] = localStorage.getItem(key);
      if (key?.startsWith('legacy-congresso:')) archives[key] = localStorage.getItem(key);
    }
    return {
      format: 'ass26-bin-v1',
      programId: PROGRAM_ID,
      exportedAt: new Date().toISOString(),
      year: getProgramYear(),
      preferences,
      recoveries: window.assembleiaSync?.getRecoveries?.() || [],
      annotations,
      archives
    };
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1200);
  }

  // EXPORTAÇÃO DO BIN AGORA USA O SHARE SHEET NATIVO DO IPHONE (ARQUIVOS)
  async function exportBin() {
    const payload = getLocalExportPayload();
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `ass26-backup-${stamp}.bin`;
    
    // Transforma o JSON do Backup num Arquivo Real
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/octet-stream' });
    const file = new File([blob], filename, { type: 'application/octet-stream' });

    // Chama o Compartilhamento Nativo do iOS
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          files: [file] // Somente arquivo, sem texto parasita!
        });
      } catch (err) {
        // Se o usuário fechar a aba de compartilhar, ignoramos.
        // Mas se o sistema falhar, tentamos o método de download clássico por garantia.
        if (err.name !== 'AbortError') {
          downloadBlob(blob, filename);
        }
      }
    } else {
      downloadBlob(blob, filename);
    }
  }

  async function importBinFile(file) {
    const parsed = JSON.parse(await file.text());
    if (!parsed || typeof parsed !== 'object') throw new Error('Arquivo BIN inválido ou corrompido.');
    const legacy = parsed.format === 'assembleia-bin-v1';
    if (!legacy && (parsed.format !== 'ass26-bin-v1' || parsed.programId !== PROGRAM_ID)) {
      throw new Error('Este backup não pertence a esta assembleia.');
    }
    const annotations = parsed.annotations && typeof parsed.annotations === 'object' ? parsed.annotations : {};
    const writes = [];
    if (legacy) {
      // Congress notes retain their original identities and never become assembly answers.
      Object.entries(annotations).forEach(([key, value]) => {
        if (/^20\d{2}-(sex|sab|dom)-/.test(key) && typeof value === 'string') {
          writes.push([`legacy-congresso:${key}`, value]);
        }
      });
      if (!writes.length) throw new Error('O backup não contém anotações de congresso válidas.');
    } else {
      const preferences = parsed.preferences && typeof parsed.preferences === 'object' ? parsed.preferences : {};
      Object.entries(preferences).forEach(([key, value]) => {
        if (PREFERENCE_KEYS.includes(key) && typeof value === 'string') writes.push([key, value]);
      });
      Object.entries(annotations).forEach(([key, value]) => {
        if (key.startsWith(PROGRAM_PREFIX) && typeof value === 'string') writes.push([key, value]);
      });
      Object.entries(parsed.archives || {}).forEach(([key, value]) => {
        if (key.startsWith('legacy-congresso:') && typeof value === 'string') writes.push([key, value]);
      });
    }
    // Preserve an explicit recovery copy before replacing matching programme records.
    const stamp = new Date().toISOString();
    const replaced = Object.fromEntries(writes.filter(([key, value]) => localStorage.getItem(key) !== null && localStorage.getItem(key) !== value)
      .map(([key]) => [key, localStorage.getItem(key)]));
    if (Object.keys(replaced).length) localStorage.setItem(`ass26-import-recovery:${stamp}`, JSON.stringify(replaced));
    writes.forEach(([key, value]) => localStorage.setItem(key, value));
    if (legacy) alert('As notas do congresso foram preservadas no arquivo histórico. As notas desta assembleia não foram alteradas.');
  }

  function getTextWithoutHour(el) {
    const clone = el.cloneNode(true);
    clone.querySelectorAll('.hora').forEach((n) => n.remove());
    return (clone.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function normalizeComparableText(text) {
    return String(text || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isSymposiumTitle(el) {
    const strong = el.querySelector('strong');
    if (!strong) return false;
    const txt = strong.textContent.toLowerCase().trim();
    return txt.includes('série de discursos');
  }

  function isExcludedTrigger(el) {
    const text = normalizeComparableText(getTextWithoutHour(el));
    const padded = ` ${text} `;
    return (
      padded.includes(' cantico ') ||
      padded.includes(' oração ') ||
      padded.includes(' oracao ') ||
      padded.includes(' anuncios ') ||
      padded.includes(' anúncios ') ||
      padded.includes(' intervalo ') ||
      padded.includes(' video musical ') ||
      padded.includes(' vídeo musical ') ||
      text === 'musica' ||
      text === 'música' ||
      text.startsWith('musica ') ||
      text.startsWith('música ') ||
      text.endsWith(' musica') ||
      text.endsWith(' música') ||
      isSymposiumTitle(el)
    );
  }

  function buildParagraphId(panel, el) {
    return el.dataset.noteId || '';
  }

  function buildListId(panel, headingEl, li) {
    return li.dataset.noteId || '';
  }

  function stripHourSpan(html) {
    const root = document.createElement('div');
    root.innerHTML = html;
    root.querySelectorAll('.hora').forEach((node) => node.remove());
    return root.innerHTML.trim();
  }

  function noteTextToMarkup(text) {
    const clean = String(text || '').replace(/\u00A0/g, ' ').trim();
    if (!clean) return '';
    const blocks = clean.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
    return blocks.map((block) => {
      const lines = block.split(/\n+/).map((line) => line.trim()).filter(Boolean);
      if (lines.every((line) => /^[•\-*]\s+/.test(line))) {
        return `<ul class="pdf-note-list">${lines.map((line) => `<li>${escapeHTML(line.replace(/^[•\-*]\s+/, ''))}</li>`).join('')}</ul>`;
      }
      return `<p>${lines.map((line) => escapeHTML(line)).join('<br>')}</p>`;
    }).join('');
  }

  function renderNote(text) {
    if (!text) return '';
    return `
      <div class="pdf-note">
        <div class="pdf-note-kicker">Anotação</div>
        <div class="pdf-note-body">${noteTextToMarkup(text)}</div>
      </div>`;
  }

  function renderParagraphItem(day, el, idx) {
    const hour = el.querySelector('.hora')?.textContent.trim() || '';
    const body = stripHourSpan(el.innerHTML);
    const note = isExcludedTrigger(el) ? '' : getRecordExportText(buildParagraphId(day, el, idx));
    return `
      <article class="pdf-item">
        ${hour ? `<div class="pdf-item-time">${escapeHTML(hour)}</div>` : ''}
        <div class="pdf-item-main">
          <div class="pdf-item-content">${body}</div>
          ${renderNote(note)}
        </div>
      </article>`;
  }

  function renderList(listEl, day, headingEl) {
    const items = Array.from(listEl.children).filter((child) => child.tagName === 'LI');
    if (!items.length) return '';

    return `
      <div class="pdf-subtopics">
        ${items.map((li) => {
          const note = getRecordExportText(buildListId(day, headingEl, li));
          return `
            <div class="pdf-subtopic">
              <div class="pdf-subtopic-text">${li.innerHTML}</div>
              ${renderNote(note)}
            </div>`;
        }).join('')}
      </div>`;
  }

  async function buildPdfSections(panelList) {
    if (window.AssembleiaIA?.flushPendingWrites?.() === false) {
      throw new Error('Não foi possível salvar a última edição. Tente novamente antes de exportar.');
    }
    const accentCandidate = localStorage.getItem('cor-assembleia') || '#604184';
    const accent = /^#[0-9a-f]{6}$/i.test(accentCandidate) ? accentCandidate : '#604184';
    return panelList.map((panel) => {
      const original = document.getElementById(panel);
      if (!original) throw new Error('A programação ainda não está pronta. Tente novamente.');
      const fragment = original.cloneNode(true);
      fragment.querySelectorAll('.anotacao-asmb, script, style').forEach(node => node.remove());
      const bodyParts = [];
      let paragraphIndex = 0;
      let lastSymposiumHeading = null;
      Array.from(fragment.children).forEach((child) => {
        if (child.tagName === 'P') {
          bodyParts.push(renderParagraphItem(panel, child, paragraphIndex++));
          lastSymposiumHeading = isSymposiumTitle(child) ? child : null;
        } else if ((child.tagName === 'UL' || child.tagName === 'OL') && lastSymposiumHeading) {
          bodyParts.push(renderList(child, panel, lastSymposiumHeading));
        }
      });
      return `
        <section class="pdf-day" style="--pdf-accent:${accent};">
          <header class="pdf-day-header">
            <div class="pdf-day-eyebrow">ASSEMBLEIA DE CIRCUITO 2026–2027</div>
            <h1>${PANEL_NAMES[panel]}</h1>
            <div class="pdf-day-theme">“Feliz é aquele que confia em Jeová” — Provérbios 16:20</div>
          </header>
          <div class="pdf-day-body">${bodyParts.join('')}</div>
        </section>`;
    }).join('');
  }

  function getPdfStyles() {
    return `
      .pdf-preview-overlay {
        position: fixed; inset: 0; z-index: 100000;
        background: #f2f4f8;
        display: flex; flex-direction: column;
        animation: pdfSlideUp 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);
      }
      @keyframes pdfSlideUp {
        from { transform: translateY(100%); }
        to { transform: translateY(0); }
      }
      .pdf-preview-content {
        flex: 1; overflow-y: auto; 
        padding: 20px 20px calc(100px + env(safe-area-inset-bottom)) 20px;
        -webkit-overflow-scrolling: touch;
      }
      .pdf-preview-toolbar {
        position: absolute; bottom: 0; left: 0; right: 0;
        padding: 16px 20px calc(16px + env(safe-area-inset-bottom));
        background: rgba(255,255,255,0.85);
        backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
        border-top: 1px solid rgba(0,0,0,0.1);
        display: flex; gap: 12px;
      }
      .pdf-toolbar__button {
        flex: 1; appearance: none; border: none; border-radius: 16px;
        min-height: 52px; font-weight: 700; font-size: 16px;
        background: #111827; color: #fff; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
      }
      .pdf-toolbar__button--ghost {
        background: rgba(0,0,0,0.06); color: #111827;
      }

      /* Estilos Internos do Documento PDF */
      .pdf-export-wrapper {
        color-scheme: light;
        --ink: #172033;
        --muted: #697386;
        --line: rgba(23, 32, 51, 0.1);
        --paper: #ffffff;
        --note-bg: #f7f9fd;
        --note-line: rgba(23, 32, 51, 0.08);
        background: #fff;
        color: var(--ink);
        font-family: 'Noto Sans', -apple-system, BlinkMacSystemFont, sans-serif;
        width: 100%;
        max-width: 210mm;
        margin: 0 auto;
        box-shadow: 0 10px 30px rgba(0,0,0,0.1);
        display: block;
      }
      .pdf-export-wrapper * { box-sizing: border-box; }
      .pdf-day {
        padding: 0 14mm; 
        page-break-after: always;
      }
      .pdf-day:last-child { page-break-after: auto; }
      .pdf-day-header { margin-bottom: 8mm; padding-top: 2mm; }
      .pdf-day-eyebrow { font-size: 11px; text-transform: uppercase; letter-spacing: 0.16em; color: var(--pdf-accent, #2a7d7d); font-weight: 700; margin-bottom: 8px; }
      .pdf-day-header h1 { margin: 0; font-size: 28px; letter-spacing: -0.03em; }
      .pdf-day-theme { margin-top: 10px; color: var(--muted); font-size: 14px; line-height: 1.55; }
      .pdf-day-theme .bbl { color: inherit; text-decoration: none; }
      .pdf-section-title {
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.16em;
        color: var(--pdf-accent, #2a7d7d);
        margin: 10mm 0 4mm;
        padding-top: 2mm;
        border-top: 1px solid rgba(0,0,0,0.15);
        page-break-after: avoid;
      }
      .pdf-section-title:first-of-type { margin-top: 0; }
      
      .pdf-item,
      .pdf-subtopic {
        display: block; 
        padding: 4mm 0;
        border-bottom: 1px solid var(--line);
        page-break-inside: avoid;
      }
      .pdf-item-time {
        display: inline-block;
        font-size: 11.5px;
        font-weight: 800;
        color: var(--pdf-accent, #2a7d7d);
        background: rgba(0,0,0,0.04);
        padding: 2.5px 8px;
        border-radius: 6px;
        margin-bottom: 5px;
      }
      .pdf-item-main {
        display: block;
      }
      .pdf-subtopic {
        padding: 3.5mm 0;
        border-bottom: 1px dashed rgba(23,32,51,0.1);
      }
      .pdf-item-content,
      .pdf-subtopic-text {
        font-size: 14px;
        line-height: 1.6;
        display: block;
      }
      .pdf-item-content .hora { display: none; }
      .pdf-item-content strong,
      .pdf-subtopic-text strong { font-weight: 760; }
      .pdf-item-content .video-subtitulo-preto-suave,
      .pdf-item-content .refs-neutral,
      .pdf-subtopic-text .refs-neutral,
      .pdf-day-theme .refs-neutral { color: var(--muted); }
      
      .pdf-subtopics {
        display: block;
        margin: 2mm 0 1mm 12mm;
        border-left: 2px solid rgba(0,0,0,0.15);
        padding-left: 5mm;
      }
      .pdf-note {
        display: block;
        margin-top: 3mm;
        padding: 4mm 4.5mm;
        border-radius: 14px;
        background: var(--note-bg);
        border: 1px solid var(--note-line);
        page-break-inside: avoid;
      }
      .pdf-note-kicker {
        font-size: 11px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        font-weight: 700;
        color: var(--pdf-accent, #2a7d7d);
        margin-bottom: 2mm;
      }
      .pdf-note-body p,
      .pdf-note-body ul { margin: 0; font-size: 13.5px; line-height: 1.65; }
      .pdf-note-body p + p,
      .pdf-note-body p + ul,
      .pdf-note-body ul + p,
      .pdf-note-body ul + ul { margin-top: 2.2mm; }
      .pdf-note-list { padding-left: 5mm; }
      .pdf-note-list li + li { margin-top: 1.2mm; }
      
      @media print {
        .pdf-export-wrapper { box-shadow: none; max-width: none; margin: 0; padding: 0; }
        .pdf-preview-toolbar { display: none !important; }
      }
    `;
  }

  function loadHtml2Pdf() {
    return new Promise((resolve, reject) => {
      if (window.html2pdf) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
      script.onload = resolve;
      script.onerror = () => reject(new Error('Falha ao carregar o gerador de PDF.'));
      document.head.appendChild(script);
    });
  }

  async function previewAndExportPdf(scope) {
    const panelList = scope === 'all' ? PANELS : [getDisplayedPanel()];
    const scopeLabel = scope === 'all' ? 'assembleia-completa' : panelList[0];
    const sections = await buildPdfSections(panelList);

    const overlay = document.createElement('div');
    overlay.className = 'pdf-preview-overlay';
    overlay.innerHTML = `
      <style>${getPdfStyles()}</style>
      <div class="pdf-preview-content">
        <div class="pdf-export-wrapper" id="pdf-export-target">
          ${sections}
        </div>
      </div>
      <div class="pdf-preview-toolbar">
        <button class="pdf-toolbar__button pdf-toolbar__button--ghost" id="pdfBtnBack">Voltar</button>
        <button class="pdf-toolbar__button" id="pdfBtnShare">Gerar Arquivo PDF</button>
      </div>
    `;
    
    document.body.appendChild(overlay);

    overlay.querySelector('#pdfBtnBack').addEventListener('click', () => {
      overlay.style.animation = 'pdfSlideUp 0.25s cubic-bezier(0.2, 0.8, 0.2, 1) reverse forwards';
      setTimeout(() => overlay.remove(), 260);
    });

    overlay.querySelector('#pdfBtnShare').addEventListener('click', async (e) => {
      const btn = e.target;
      const originalText = btn.textContent;
      
      btn.textContent = 'Renderizando...';
      btn.disabled = true;

      try {
        await loadHtml2Pdf();
        
        const htmlString = `
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="utf-8">
              <style>${getPdfStyles()}</style>
            </head>
            <body>
              <div class="pdf-export-wrapper">
                ${sections}
              </div>
            </body>
          </html>
        `;

        const filename = `ass26-${slug(scopeLabel)}.pdf`;

        const opt = {
          margin: [15, 0, 15, 0], 
          filename: filename,
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: { 
            scale: 2, 
            useCORS: true, 
            letterRendering: true,
            scrollY: 0, 
            windowHeight: document.body.scrollHeight
          },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
          pagebreak: { mode: ['css', 'legacy'] }
        };

        const pdfBlob = await window.html2pdf().set(opt).from(htmlString).output('blob');
        const file = new File([pdfBlob], filename, { type: 'application/pdf' });

        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file] // Removido o campo "text" parasita!
          });
        } else {
          const url = URL.createObjectURL(pdfBlob);
          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          a.click();
          URL.revokeObjectURL(url);
        }
      } catch (err) {
        alert('Erro ao gerar o arquivo PDF: ' + err.message);
      } finally {
        btn.textContent = originalText;
        btn.disabled = false;
      }
    });
  }

  function createSheetMarkup() {
    return `
      <div class="asmb-sheet-overlay" id="asmbExportOverlay" aria-hidden="true">
        <div class="asmb-sheet" role="dialog" aria-modal="true" aria-labelledby="asmbExportTitle">
          <div class="asmb-sheet__handle" aria-hidden="true"></div>
          <div class="asmb-sheet__inner">
            <div class="asmb-sheet__topbar">
              <div class="asmb-sheet__title" id="asmbExportTitle">Exportar ou importar</div>
              <button type="button" class="asmb-sheet__close" id="asmbExportClose" aria-label="Fechar">×</button>
            </div>

            <div class="asmb-sheet__tabs" role="tablist" aria-label="Modo">
              <button type="button" class="asmb-sheet__tab is-active" data-tab="export" role="tab" aria-selected="true">Exportação</button>
              <button type="button" class="asmb-sheet__tab" data-tab="import" role="tab" aria-selected="false">Importação</button>
            </div>

            <section class="asmb-sheet__panel" data-panel="export">
              <div class="asmb-card">
                <div class="asmb-card__title">Formato</div>
                <div class="asmb-segmented">
                  <label class="asmb-choice">
                    <input type="radio" name="asmb-export-format" value="pdf" checked>
                    <span class="asmb-choice__body">
                      <span class="asmb-choice__title">PDF</span>
                      <span class="asmb-choice__desc">Para imprimir e compartilhar.</span>
                    </span>
                  </label>
                  <label class="asmb-choice">
                    <input type="radio" name="asmb-export-format" value="bin">
                    <span class="asmb-choice__body">
                      <span class="asmb-choice__title">BIN</span>
                      <span class="asmb-choice__desc">Backup local para importar depois.</span>
                    </span>
                  </label>
                </div>
              </div>

              <div class="asmb-card" data-format-panel="pdf">
                <div class="asmb-card__title">Escopo do PDF</div>
                <div class="asmb-inline-options">
                  <label class="asmb-choice">
                    <input type="radio" name="asmb-pdf-scope" value="current">
                    <span class="asmb-choice__body">
                      <span class="asmb-choice__title">Aba atual</span>
                      <span class="asmb-choice__desc">Exporta a aba que está aberta agora, com suas anotações.</span>
                    </span>
                  </label>
                  <label class="asmb-choice">
                    <input type="radio" name="asmb-pdf-scope" value="all" checked>
                    <span class="asmb-choice__body">
                      <span class="asmb-choice__title">Assembleia completa</span>
                      <span class="asmb-choice__desc">Inclui Manhã, Tarde e Perguntas, com suas anotações.</span>
                    </span>
                  </label>
                </div>
              </div>

              <div class="asmb-card" data-format-panel="bin" hidden>
                <div class="asmb-card__title">Conteúdo do BIN</div>
                <p class="asmb-sheet__meta">O BIN inclui as preferências, anotações e respostas desta assembleia, além das notas arquivadas do congresso. Você pode importar o arquivo depois.</p>
              </div>

              <div class="asmb-sheet__actions">
                <button type="button" class="asmb-sheet__secondary" id="asmbExportCancel">Cancelar</button>
                <button type="button" class="asmb-sheet__primary" id="asmbExportRun">Avançar</button>
              </div>
            </section>

            <section class="asmb-sheet__panel" data-panel="import" hidden>
              <div class="asmb-card">
                <div class="asmb-card__title">Importar BIN</div>
                <div class="asmb-sheet__file">
                  <input id="asmbImportFile" class="asmb-sheet__file-input" type="file" accept=".bin,.json,application/octet-stream,application/json">
                  <label for="asmbImportFile" class="asmb-sheet__file-label">Escolher arquivo</label>
                  <div class="asmb-sheet__file-name" id="asmbImportFileName">Nenhum arquivo selecionado.</div>
                  <p class="asmb-sheet__meta">Ao importar, as preferências e anotações do BIN sobrescrevem as chaves correspondentes e a página recarrega para aplicar tudo.</p>
                </div>
              </div>
              <div class="asmb-sheet__actions">
                <button type="button" class="asmb-sheet__secondary" id="asmbImportCancel">Cancelar</button>
                <button type="button" class="asmb-sheet__primary" id="asmbImportRun">Importar</button>
              </div>
            </section>
          </div>
        </div>
      </div>`;
  }

  function initSheet() {
    document.body.insertAdjacentHTML('beforeend', createSheetMarkup());

    const overlay = qs('#asmbExportOverlay');
    const closeBtn = qs('#asmbExportClose');
    const cancelBtn = qs('#asmbExportCancel');
    const importCancelBtn = qs('#asmbImportCancel');
    const runBtn = qs('#asmbExportRun');
    const importBtn = qs('#asmbImportRun');
    const tabs = qsa('.asmb-sheet__tab', overlay);
    const panels = qsa('.asmb-sheet__panel', overlay);
    const formatInputs = qsa('input[name="asmb-export-format"]', overlay);
    const formatPanels = qsa('[data-format-panel]', overlay);
    const importFile = qs('#asmbImportFile');
    const importFileName = qs('#asmbImportFileName');

    let activeTab = 'export';

    function setTab(tab) {
      activeTab = tab;
      tabs.forEach((btn) => {
        const active = btn.dataset.tab === tab;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      panels.forEach((panel) => {
        panel.hidden = panel.dataset.panel !== tab;
      });
    }

    function updateFormatPanels() {
      const selected = qs('input[name="asmb-export-format"]:checked', overlay)?.value || 'pdf';
      formatPanels.forEach((panel) => {
        panel.hidden = panel.dataset.formatPanel !== selected;
      });
      runBtn.textContent = selected === 'pdf' ? 'Avançar para Visualização' : 'Exportar BIN';
    }

    function openSheet() {
      setTab('export');
      overlay.classList.add('is-open');
      overlay.setAttribute('aria-hidden', 'false');
      updateFormatPanels();
    }

    function closeSheet() {
      overlay.classList.remove('is-open');
      overlay.setAttribute('aria-hidden', 'true');
    }

    document.addEventListener('assembleia-export:open', openSheet);
    closeBtn.addEventListener('click', closeSheet);
    cancelBtn.addEventListener('click', closeSheet);
    importCancelBtn.addEventListener('click', closeSheet);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) closeSheet();
    });

    tabs.forEach((btn) => {
      btn.addEventListener('click', () => setTab(btn.dataset.tab));
    });

    formatInputs.forEach((input) => input.addEventListener('change', updateFormatPanels));

    importFile.addEventListener('change', () => {
      const file = importFile.files?.[0];
      importFileName.textContent = file ? file.name : 'Nenhum arquivo selecionado.';
    });

    runBtn.addEventListener('click', async () => {
      const selected = qs('input[name="asmb-export-format"]:checked', overlay)?.value || 'pdf';
      const originalText = runBtn.textContent;
      
      runBtn.disabled = true;
      runBtn.textContent = 'Processando...';

      try {
        if (selected === 'bin') {
          await exportBin();
        } else {
          const scope = qs('input[name="asmb-pdf-scope"]:checked', overlay)?.value || 'all';
          await previewAndExportPdf(scope);
        }
        closeSheet();
      } catch (error) {
        alert(error?.message || 'Não foi possível concluir a exportação.');
      } finally {
        runBtn.disabled = false;
        runBtn.textContent = originalText;
      }
    });

    importBtn.addEventListener('click', async () => {
      const file = importFile.files?.[0];
      if (!file) {
        alert('Escolha um arquivo BIN antes de importar.');
        return;
      }

      if (!confirm('Importar este BIN vai sobrescrever as chaves correspondentes. Deseja continuar?')) {
        return;
      }

      const originalText = importBtn.textContent;
      importBtn.disabled = true;
      importBtn.textContent = 'Importando...';

      try {
        await importBinFile(file);
        closeSheet();
        location.reload();
      } catch (error) {
        alert(error?.message || 'Não foi possível importar o arquivo.');
      } finally {
        importBtn.disabled = false;
        importBtn.textContent = originalText;
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && overlay.classList.contains('is-open')) {
        closeSheet();
      }
    });

    setTab(activeTab);
    updateFormatPanels();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSheet, { once: true });
  } else {
    initSheet();
  }
})();