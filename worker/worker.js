const $ = (id) => document.getElementById(id);

const WORKER_BASE = "https://hope4.momentaneo2021.workers.dev/";

function monthToIssue(yyyyDashMm) {
  if (!/^\d{4}-\d{2}$/.test(yyyyDashMm)) return null;
  return yyyyDashMm.replace("-", "");
}

async function fetchTextOrThrow(url) {
  const response = await fetch(url, { cache: "no-store" });
  const text = await response.text();
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try { message = JSON.parse(text).error?.message || message; } catch (_) {}
    throw new Error(message);
  }
  return text;
}

function setLoading(on) {
  const b = $("btnGo");
  const skeleton = $("loadingSkeleton");
  const area = $("outputArea");

  b.classList.toggle("loading", on);

  if (on) {
    skeleton.classList.add("active");
    area.style.opacity = "0.3";
  } else {
    skeleton.classList.remove("active");
    area.style.opacity = "1";
  }
}

async function carregar() {
  const issue = monthToIssue($("monthInput").value);
  const study = $("studyInput").value;

  if (!issue) {
    $("outputArea").value = "Escolhe um mês/ano.";
    return;
  }

  setLoading(true);
  try {
    const params = new URLSearchParams({ issue, study, format: "fragment" });
    const workerUrl = `${WORKER_BASE}convert?${params}`;
    
    const out = await fetchTextOrThrow(workerUrl);
    $("outputArea").value = out;
  } catch (err) {
    $("outputArea").value = "Não consegui carregar esse estudo.\nErro: " + err.message;
  }
  setLoading(false);
}

$("btnGo").onclick = carregar;

$("btnCopy").onclick = () => {
  $("outputArea").select();
  document.execCommand("copy");
  const old = $("btnCopy").textContent;
  $("btnCopy").textContent = "Copiado!";
  setTimeout(() => $("btnCopy").textContent = old, 1200);
};

(function init() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  $("monthInput").value = `${y}-${m}`;
})();

function feedbackBotao(el) {
  el.classList.add("btn-feedback");
  setTimeout(() => {
    el.classList.remove("btn-feedback");
  }, 70);
}

$("btn1").onclick = () => {
  feedbackBotao($("btn1"));
  const area = $("outputArea");
  let txt = area.value.trim();
  // hope4 already supplies the structured article; keep step 1 safe to repeat.
  if (/^<div\b[^>]*\bdata-hope4-article=/.test(txt) || /^<!doctype\s+html/i.test(txt)) return;


  let estudoId = "";
  let corHex = "";

  const idMatch = txt.match(/^(\d+)/);
  if (idMatch) {
    estudoId = idMatch[1];
    txt = txt.replace(estudoId, "").trim();
  }

  const hexMatch = txt.match(/(#[0-9a-fA-F]{3,6})/);
  if (hexMatch) {
    corHex = hexMatch[1];
    txt = txt.replace(corHex, "").trim();
  }

  txt = txt.replace(/<\/strong>(\s*)<bbl>([\s\S]*?)<\/bbl>(\s*)<strong>/gi, "$1<bbl>$2</bbl>$3");
  txt = txt.replace(/<\/em>(\s*)<bbl>([\s\S]*?)<\/bbl>(\s*)<em>/gi, "$1<bbl>$2</bbl>$3");

  txt = txt.replace(/;\s*<\/bbl>\s*<bbl>(?=[A-Za-zÀ-ÖØ-öø-ÿ])/gi, "</bbl>; <bbl>");
  txt = txt.replace(/;\s*<\/bbl>\s*<bbl>(?=\d)/gi, "; ");
  txt = txt.replace(/<\/bbl>;\s*<bbl>(?=\d)/gi, "; ");
  txt = txt.replace(/<\/bbl>\s*<bbl>(?=\d)/gi, " ");
  
  txt = txt.replace(/<bbl>([\s\S]*?)<\/bbl>/gi, '<a class="bbl">$1</a>');

  let estudoConteudo = "";
  txt = txt.replace(/<estudo>([\s\S]*?)<\/estudo>/i, (_, content) => {
    estudoConteudo = content.trim().replace(/(\d+)\s*-\s*(\d+)/, "$1 A $2");
    return "";
  });

  let preArticle = "";
  txt = txt.replace(/<cantico>([\s\S]*?)<\/cantico>/i, (_, content) => {
    const m = content.trim().match(/^(C[ÂA]NTICO\s+\d+)\s+(.+)/i);
    if (m) {
      const num = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
      preArticle += `<div class="secao-cantico"><p><span class="cantico">${num}</span> <span class="cantico-titulo">${m[2].trim()}</span></p></div>\n\n`;
    }
    return "";
  });

  txt = txt.replace(/<tema>([\s\S]*?)<\/tema>/i, (_, content) => {
    preArticle += `<h1 class="estudo-titulo">\n${content.trim()}\n</h1>\n\n`;
    return "";
  });

  txt = txt.replace(/<citacao>([\s\S]*?)<\/citacao>/i, (_, content) => {
    preArticle += `<p class="citacao">\n${content.trim()}\n</p>\n\n`;
    return "";
  });

  txt = txt.replace(/<objetivo>([\s\S]*?)<\/objetivo>/i, (_, content) => {
    const t = content.trim().replace(/^OBJETIVO\s*/i, "");
    preArticle += `<div class="objetivo"><p class="objetivo-titulo">OBJETIVO</p><p class="objetivo-texto">${t}</p></div>\n\n`;
    return "";
  });

  let descricoesImagem =[];
  txt = txt.replace(/<nota>\s*\*\s*<strong>DESCRIÇÃO DA IMAGEM:<\/strong>\s*([\s\S]*?)<\/nota>/gi, (_, desc) => {
    descricoesImagem.push(desc.trim());
    return ""; 
  });

  let descCount = 0;
  txt = txt.replace(/<figure>([\s\S]*?)<\/figure>/gi, (m, inner) => {
    // hope4 carries explicit note destinations. Keep those links and the image
    // URL selected by the source; legacy image descriptions have plain stars.
    const explicitNote = /data-note-id=["']hope4-note-/.test(inner);
    let hasAsterisk = !explicitNote && /\*/.test(inner);
    
    inner = inner.replace(/<img\s+src=(["'])(.*?_lg\.jpg)\1/i, (imgM, q, src) => {
      let newSrc = src;
      if (hasAsterisk && descCount < descricoesImagem.length) {
        let altTxt = descricoesImagem[descCount];
        return `<img src="${newSrc}"\n       alt="${altTxt}"`;
      }
      return `<img src="${newSrc}"`;
    });

    if (hasAsterisk) {
      descCount++;
      inner = inner.replace(/\s*\(\s*Veja\s+o\s+parágrafo[^)]+\)\s*\*/gi, "");
      inner = inner.replace(/\s*\*/g, "");
    }

    return `<figure>\n${inner.trim()}\n</figure>`;
  });

  txt = txt.replace(/<subtitulo>([\s\S]*?)<\/subtitulo>/gi, (_, content) => {
    let str = content.trim();
    str = str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
    return `<h2 class="subtitulo">${str}</h2>\n\n`;
  });

  txt = txt.replace(/<pergunta>([\s\S]*?)<\/pergunta>/gi, (_, content) => {
    const m = content.trim().match(/^(\d+(?:\s*[-–]\s*\d+)?)(?:\.)?\s*(.*)$/);
    if (m) return `<div><p class="pergunta"><span>${m[1].replace(/\s+/g, "")}.</span> ${m[2].trim()}</p></div>\n\n`;
    return `<div><p class="pergunta">${content.trim()}</p></div>\n\n`;
  });

  txt = txt.replace(/<paragrafo>([\s\S]*?)<\/paragrafo>/gi, (_, content) => {
    const m = content.trim().match(/^(\d+)\s+([\s\S]*)$/);
    if (m) return `<p class="paragrafo"><span>${m[1]}</span> ${m[2].trim()}</p>\n\n`;
    return `<p class="paragrafo">${content.trim()}</p>\n\n`;
  });

  txt = txt.replace(/<recap>([\s\S]*?)<\/recap>/gi, (_, content) => {
    const rawLines = content.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (!rawLines.length) return "";
    
    const titulo = rawLines[0];
    let lis = "";
    for(let i = 1; i < rawLines.length; i++) {
       let item = rawLines[i].replace(/^[•\-\u2022]\s*/, "");
       lis += `          <li>${item}</li>\n`;
    }
    return `<div class="secao-recapitulacao">\n  <hr class="linha-recapitulacao">\n  <h3 class="titulo-recapitulacao">${titulo}</h3>\n  <ul class="lista-recapitulacao">\n${lis}  </ul>\n</div>\n\n`;
  });

  txt = txt.replace(/<cantico>([\s\S]*?)<\/cantico>/gi, (_, content) => {
    const m = content.trim().match(/^(C[ÂA]NTICO\s+\d+)\s+(.+)/i);
    if (m) {
      const num = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
      return `<div class="secao-cantico"><p><span class="cantico">${num}</span> <span class="cantico-titulo">${m[2].trim()}</span></p></div>\n\n<hr class="linha-divisoria">\n\n`;
    }
    return "";
  });

  txt = txt.replace(/<quadro>([\s\S]*?)<\/quadro>/gi, (_, content) => {
    const lines = content.trim().split(/\n\n+/);
    if (lines.length === 0) return "";
    
    const titulo = lines.shift().trim();
    let htmlCorpo = "";
    let inList = false;

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i].trim();
      if (!line) continue;
      
      if (line.startsWith("•")) {
        if (!inList) { htmlCorpo += `<ul class="quadro1-lista">\n`; inList = true; }
        htmlCorpo += `    <li>${line.substring(1).trim()}</li>\n`;
      } else {
        if (inList) { htmlCorpo += `</ul>\n\n`; inList = false; }
        htmlCorpo += `<p>${line}</p>\n\n`;
      }
    }
    if (inList) htmlCorpo += `</ul>\n\n`;

    return `<div class="quadro1">\n  <h3 class="quadro1-titulo">${titulo}</h3>\n  <div class="quadro1-corpo">\n${htmlCorpo.trimEnd()}\n  </div>\n</div>\n\n`;
  });

  txt = txt.replace(/<nota(?:\s+id="(hope4-note-[a-zA-Z0-9_-]+)")?>\s*\*?\s*([\s\S]*?)<\/nota>/gi, (_, noteId, content) => {
    const target = noteId ? ` id="${noteId}"` : "";
    return `<p class="nota-rodape"${target}><span class="simbolo-rodape">*</span> ${content.trim()}</p>\n\n`;
  });

  txt = txt.replace(/\n{3,}/g, "\n\n");

  const headerHtml = `<div class="container">\n\n<header class="barra-estudo">\n<div>${estudoConteudo}</div>\n</header>\n\n<main>\n\n${preArticle}${txt.trim()}\n\n</main>\n\n</div>\n\n${estudoId}\n\n${corHex}`;

  area.value = headerHtml;
};

$("btn2").onclick = () => {
  feedbackBotao($("btn2"));

  const area = $("outputArea");
  let txt = area.value.trim();

  const tailMetaMatch = txt.match(/(?:\n\s*(\d{6,8}))?(?:\n\s*(#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})))?\s*$/);
  const estudoId = tailMetaMatch?.[1] || "";
  const corHex = tailMetaMatch?.[2] || "";

  txt = txt.replace(/(?:\n\s*\d{6,8})?(?:\n\s*#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3}))?\s*$/, "").trim();

  const headerTxtMatch = txt.match(/<header class="barra-estudo">\s*<div>([\s\S]*?)<\/div>\s*<\/header>/i);
  const headerTxt = headerTxtMatch ? headerTxtMatch[1].replace(/\s+/g, " ").trim() : "";

  const meses = {
    "JANEIRO": "01", "FEVEREIRO": "02", "MARÇO": "03", "MARCO": "03",
    "ABRIL": "04", "MAIO": "05", "JUNHO": "06", "JULHO": "07",
    "AGOSTO": "08", "SETEMBRO": "09", "OUTUBRO": "10", "NOVEMBRO": "11", "DEZEMBRO": "12"
  };

  let semanaDDMM = "";
  if (headerTxt) {
    const up = headerTxt.toUpperCase();
    let d = "";
    let mesNome = "";
    
    let m = up.match(/^(\d{1,2})\s+DE\s+([A-ZÇÃÕ]+)\s*[-–—A]\s*\d{1,2}\s+DE\s+[A-ZÇÃÕ]+\s+DE\s+\d{4}$/i);
    if (m) {
      d = m[1];
      mesNome = m[2];
    } else {
      m = up.match(/^(\d{1,2})\s*(?:A|[-–—])\s*\d{1,2}\s+DE\s+([A-ZÇÃÕ]+)\s+DE\s+\d{4}$/i);
      if (m) {
        d = m[1];
        mesNome = m[2];
      } else {
        m = up.match(/^(\d{1,2})\s+DE\s+([A-ZÇÃÕ]+)\s+DE\s+\d{4}$/i);
        if (m) {
          d = m[1];
          mesNome = m[2];
        }
      }
    }
    
    const mm = meses[mesNome] || "";
    if (d && mm) semanaDDMM = `${String(d).padStart(2, "0")}-${mm}`;
  }

  const TOPO = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
    <meta name="theme-color" content="X">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="mobile-web-app-capable" content="yes">
    <link id="sentinela-statusbar-style" rel="stylesheet" href="../../shared/statusbar.css">
    <script id="sentinela-statusbar-script" src="../../shared/statusbar.js"></script>
    <title>A Sentinela</title>

    <meta name="color-scheme" content="light dark">
    <script>
    (function() {
      try {
        var savedTheme = localStorage.getItem('tema-interface') || 'system';
        var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        var isDark = savedTheme === 'dark' || (savedTheme === 'system' && prefersDark);
        document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
        document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
      } catch (e) {}
    })();
    </script>
    <style>
      html, body { background: #f3f4f6; }
      html[data-theme="dark"], html[data-theme="dark"] body { background: #000000; }
    </style>

    <link href="https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Noto+Sans:wght@400;700;800&family=Noto+Serif:ital@1&display=swap" rel="stylesheet">

    <link rel="stylesheet" href="../style.css">
    <link rel="stylesheet" href="../biblia/stylebbl.css">
    <link rel="stylesheet" href="../clickable/clickable.css">
    <link rel="stylesheet" href="../menu/menu.css">
    <link rel="stylesheet" href="../clickable/agente-modal/agente-modal.css">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/Swiper/11.0.5/swiper-bundle.min.css">
    <link rel="stylesheet" href="../imagem/swiper-zoom.css">
    <link rel="stylesheet" href="../../navbar/navbar-unified.css">
    <script id="sentinela-typography-script" src="../../shared/typography.js"></script>
    <link id="sentinela-typography-style" rel="stylesheet" href="../../shared/typography.css">
</head>
<body data-estudo="X" style="--cor-principal-estudo: X;" class="with-bottom-navbar">
<script>
  (function() {
    try {
      var color = getComputedStyle(document.body).getPropertyValue('--cor-principal-estudo').trim() || 'X';
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', color);
    } catch (e) {}
  })();
</script>

<nav class="bottom-navbar booting" data-context="navbar-context-watchtower">
    <a href="#" class="navbar-item" data-page="home" onclick="irParaHome(event)">
        <div class="navbar-icon icon-home"></div>
        <span class="navbar-label">Início</span>
    </a>
    <a href="#" class="navbar-item" data-page="bible" onclick="irParaBiblia(event)">
        <div class="navbar-icon icon-bible"></div>
        <span class="navbar-label">Bíblia</span>
    </a>
    <a href="#" class="navbar-item" data-page="notes" onclick="irParaAnotacoes(event)">
        <div class="navbar-icon icon-notes"></div>
        <span class="navbar-label">Anotações</span>
    </a>
    <a href="#" class="navbar-item active" data-page="watchtower" onclick="irParaSentinela(event)">
        <div class="navbar-icon icon-watchtower"></div>
        <span class="navbar-label">A Sentinela</span>
    </a>
    <a href="#" class="navbar-item" data-page="save" onclick="irParaSalvar(event)">
        <div class="navbar-icon icon-save"></div>
        <span class="navbar-label">Salvar</span>
    </a>
</nav>

<script>
  const urlParams = new URLSearchParams(window.location.search);
  window.semanaAtual = urlParams.get('semana') || 'X-X';
  window.estudoId = 'X';
</script>`;

  const RODAPE = `<div id="modal-biblia">
    <div class="modal-biblia-content">
        <span id="modal-biblia-fechar">×</span>
        <div id="modal-biblia-corpo"></div>
    </div>
</div>

<script src="../biblia/abrev.js"></script>
<script src="../biblia/scriptbbl.js"></script>
<script src="../clickable/cache.js"></script>
<script src="../clickable/agente_perguntas.js"></script>
<script src="../clickable/agente_recap.js"></script>
<script src="../clickable/agente-obj.js"></script>
<script src="../clickable/agente-sub.js"></script>
<script src="../clickable/agente-modal/agente-modal.js"></script>
<script src="../clickable/clickable.js"></script>
<script src="../menu/menu.js"></script>
<script src="../mark.js"></script>
<script src="../imagem/semanas/22-09/ilust/ilust-universal.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Swiper/11.0.5/swiper-bundle.min.js"></script>

<script src="../imagem/swiper-zoom.js"></script>
<script src="../imagem.js"></script>

<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="../../save/config.js"></script>
<script src="../../save/supabase.js"></script>
<script src="../../navbar/navbar-unified.js"></script>
<script src="../../save/sentinela-sync.js"></script>

<div id="zoom-container" class="zoom-container">
    <div class="zoom-header">
        <button class="zoom-btn-fechar" aria-label="Fechar">×</button>
    </div>
    <div class="zoom-content"></div>
    <div class="zoom-footer"></div>
</div>

<script>
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        document.querySelectorAll('.paragrafo').forEach((p, index) => {
            if (!p.id) p.id = \`paragrafo-sentinela-\${index + 1}\`;
        });
        if (window.CacheAnotacao) {
            document.querySelectorAll('.paragrafo, .comentarios, .clickable').forEach(el => {
                if (el.id) {
                    const cachedContent = window.CacheAnotacao.carregar(el.id);
                    if (cachedContent) el.innerHTML = cachedContent;
                }
            });
        }
        document.dispatchEvent(new CustomEvent('cacheRestored'));
        if (window.UnifiedNavbar?.get()) {
            window.UnifiedNavbar.get().setActivePage('watchtower');
        }
    }, 200);
});
</script>

</body>
</html>`;

  const jaTemTopo = /^<!DOCTYPE html>/i.test(txt.trimStart());
  const jaTemRodape = /id="modal-biblia"/i.test(txt);

  if (!jaTemTopo) txt = `${TOPO}\n\n${txt.trimStart()}`;

  if (corHex) {
    txt = txt.replace(/--cor-principal-estudo:\s*X(\s*;)?/g, `--cor-principal-estudo: ${corHex};`);
    txt = txt.replace(/<meta name="theme-color" content="X">/g, `<meta name="theme-color" content="${corHex}">`);
  }
  if (estudoId) txt = txt.replace(/window\.estudoId\s*=\s*'X'\s*;/g, `window.estudoId = '${estudoId}';`);
  
  if (semanaDDMM) {
    txt = txt.replace(/<body([^>]*?)\bdata-estudo="X"([^>]*?)>/i, `<body$1 data-estudo="${semanaDDMM}"$2>`);
    txt = txt.replace(/window\.semanaAtual\s*=\s*urlParams\.get\('semana'\)\s*\|\|\s*'X-X'\s*;/g, `window.semanaAtual = urlParams.get('semana') || '${semanaDDMM}';`);
  }

  if (!jaTemRodape) {
    if (/<\/main>\s*<\/div>\s*$/i.test(txt)) txt = txt.replace(/<\/main>\s*<\/div>\s*$/i, (m) => `${m}\n\n${RODAPE}`);
    else if (/<\/div>\s*$/i.test(txt)) txt = txt.replace(/<\/div>\s*$/i, (m) => `${m}\n\n${RODAPE}`);
    else txt = `${txt.trimEnd()}\n\n${RODAPE}`;
  }

  area.value = txt.trimEnd();
};

(() => {
  const CSS_URL = "styly.css";

  const btn3     = document.getElementById("btn3");
  const overlay  = document.getElementById("editorModal");
  const frame    = document.getElementById("editorIframe");
  const bBold    = document.getElementById("btnBold");
  const bItalic  = document.getElementById("btnItalic");
  const bSave    = document.getElementById("btnSaveEditor");
  const bClose   = document.getElementById("btnCloseEditor");
  const area     = document.getElementById("outputArea");

  if (!btn3 || !overlay || !frame || !bBold || !bItalic || !bSave || !bClose || !area) return;

  let beforeMain  = "";
  let afterMain   = "";
  let mainOpenTag = "<main>";
  let hasMain     = false;
  let savedRange  = null;

  const splitHtml = (html) => {
    const m = (html || "").match(/<main\b[^>]*>[\s\S]*?<\/main>/i);
    if (!m) return { hasMain: false, before: "", after: "", mainOpenTag: "<main>", mainInner: html || "" };
    const mainBlock = m[0];
    const open = (mainBlock.match(/<main\b[^>]*>/i) || ["<main>"])[0];
    const inner = mainBlock.replace(/<main\b[^>]*>/i, "").replace(/<\/main>$/i, "");
    return {
      hasMain: true,
      before: (html || "").slice(0, m.index),
      after: (html || "").slice(m.index + mainBlock.length),
      mainOpenTag: open,
      mainInner: inner
    };
  };

  const sanitize = (fragment) =>
    (fragment || "")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");

  const normalize = (html) =>
    (html || "")
      .replace(/<(\/?)b(\b[^>]*)>/gi, "<$1strong$2>")
      .replace(/<(\/?)i(\b[^>]*)>/gi, "<$1em$2>");

  const getFrameDoc = () => frame.contentDocument;
  const getRoot = () => getFrameDoc()?.getElementById("edRoot");

  const show = () => {
    overlay.classList.add("active");
    document.body.style.overflow = "hidden";
  };

  const hide = () => {
    overlay.classList.remove("active");
    document.body.style.overflow = "";
    savedRange = null;
  };

  async function loadCssText() {
    const r = await fetch(CSS_URL, { cache: "no-store" });
    if (!r.ok) throw new Error("Falha ao carregar styly.css");
    return await r.text();
  }

  const buildSrcdoc = (safe, cssText) => `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover">
<style>
${cssText}

html, body { margin: 0; padding: 0; background: #fff; -webkit-touch-callout: none; }
#edRoot { padding: 14px; outline: none; -webkit-user-select: text; user-select: text; -webkit-touch-callout: none; min-height: 90vh; }
* { -webkit-tap-highlight-color: transparent; }
figure { display: none !important; }
</style>
</head>
<body>
<div class="container">
  <main id="edRoot" contenteditable="true" spellcheck="false">${safe || ""}</main>
</div>
<script>
  document.addEventListener('contextmenu', function(e) { e.preventDefault(); });
  document.addEventListener('copy', function(e) { e.preventDefault(); });
  document.addEventListener('cut', function(e) { e.preventDefault(); });
<\/script>
</body>
</html>`;

  const saveSelection = () => {
    const doc = getFrameDoc();
    if (!doc) return;
    const sel = doc.getSelection();
    if (sel && sel.rangeCount > 0) savedRange = sel.getRangeAt(0);
  };

  const applyFormat = (tagName) => {
    const doc = getFrameDoc();
    const root = getRoot();
    if (!doc || !root) return;

    if (savedRange) {
      try {
        const sel = doc.getSelection();
        sel.removeAllRanges();
        sel.addRange(savedRange);
      } catch (e) {
        savedRange = null;
        return;
      }
    }

    const sel = doc.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !sel.getRangeAt(0).toString().trim()) return;

    const range = sel.getRangeAt(0);
    const container = range.commonAncestorContainer;
    const existing = (container.nodeType === 3 ? container.parentElement : container).closest(tagName);

    if (existing && root.contains(existing)) {
      const parent = existing.parentNode;
      const frag = doc.createDocumentFragment();
      while (existing.firstChild) frag.appendChild(existing.firstChild);
      parent.replaceChild(frag, existing);
      parent.normalize();
    } else {
      const wrapper = doc.createElement(tagName);
      try {
        range.surroundContents(wrapper);
      } catch (e) {
        const frag = range.extractContents();
        wrapper.appendChild(frag);
        range.insertNode(wrapper);
      }
    }

    sel.removeAllRanges();
    savedRange = null;
  };

  const hookBtn = (el, fn) => {
    let fired = false;
    el.addEventListener("touchstart", (e) => {
      e.preventDefault();
      e.stopPropagation();
      fired = true;
      fn();
    }, { passive: false });

    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!fired) fn();
      fired = false;
    });

    el.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
  };

  btn3.onclick = async () => {
    if (typeof feedbackBotao === "function") feedbackBotao(btn3);

    const parts = splitHtml(area.value || "");
    hasMain = parts.hasMain;
    beforeMain = parts.before;
    afterMain = parts.after;
    mainOpenTag = parts.mainOpenTag;

    const cssText = await loadCssText();
    frame.srcdoc = buildSrcdoc(sanitize(parts.mainInner), cssText);
    show();

    frame.addEventListener("load", () => {
      const doc = getFrameDoc();
      const root = getRoot();
      if (!doc || !root) return;

      root.focus();
      doc.addEventListener("selectionchange", saveSelection);
      root.addEventListener("pointerup", saveSelection);
      root.addEventListener("touchend", saveSelection);
      root.addEventListener("keyup", saveSelection);
    }, { once: true });
  };

  hookBtn(bBold, () => applyFormat("strong"));
  hookBtn(bItalic, () => applyFormat("em"));
  hookBtn(bClose, hide);

  hookBtn(bSave, () => {
    const doc = getFrameDoc();
    const root = getRoot();
    if (!doc || !root) return;

    const editedInner = normalize(root.innerHTML);
    area.value = hasMain ? `${beforeMain}${mainOpenTag}${editedInner}</main>${afterMain}` : editedInner;
    hide();
  });

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) hide();
  });
})();

// =====================================================
// BOTAO 4 — Modal de Exportação Redesenhado
// =====================================================

const EXPORT_ICONS = {
  github: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.477 2 12c0 4.418 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.009-.868-.014-1.703-2.782.604-3.369-1.341-3.369-1.341-.454-1.154-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.564 9.564 0 0112 6.844a9.59 9.59 0 012.504.337c1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.641.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.744 0 .267.18.579.688.481C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z"/></svg>`,
  download: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
  file: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>`,
  check: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`
};

function injectExportStyles() {
  if (document.getElementById("_exportStyles")) return;
  const s = document.createElement("style");
  s.id = "_exportStyles";
  s.textContent = `
    /* ── overlay ── */
    .exp-overlay {
      position: fixed;
      inset: 0;
      z-index: 200000;
      display: flex;
      align-items: flex-end;
      justify-content: center;
      touch-action: none;
    }

    .exp-scrim {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0);
      backdrop-filter: blur(0px);
      -webkit-backdrop-filter: blur(0px);
      transition: background 0.32s ease, backdrop-filter 0.32s ease, -webkit-backdrop-filter 0.32s ease;
    }
    .exp-overlay.exp-visible .exp-scrim {
      background: rgba(0,0,0,0.38);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
    }

    /* ── sheet ── */
    .exp-sheet {
      position: relative;
      z-index: 1;
      width: 100%;
      max-width: 560px;
      background: #f5f5f7;
      border-radius: 20px 20px 0 0;
      padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 24px);
      transform: translateY(110%);
      transition: transform 0.42s cubic-bezier(0.34, 1.10, 0.64, 1);
      will-change: transform;
      overflow: hidden;
    }
    .exp-overlay.exp-visible .exp-sheet {
      transform: translateY(0);
    }

    @media (prefers-color-scheme: dark) {
      .exp-sheet { background: #1c1c1e; }
    }

    /* ── handle ── */
    .exp-handle {
      width: 38px; height: 4px;
      background: rgba(60,60,67,0.2);
      border-radius: 99px;
      margin: 12px auto 0;
    }
    @media (prefers-color-scheme: dark) {
      .exp-handle { background: rgba(235,235,245,0.25); }
    }

    /* ── header ── */
    .exp-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      padding: 20px 20px 0;
    }
    .exp-head-title {
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif;
      font-size: 19px;
      font-weight: 700;
      letter-spacing: -0.5px;
      color: #000;
      line-height: 1;
    }
    @media (prefers-color-scheme: dark) {
      .exp-head-title { color: #fff; }
    }
    .exp-head-cancel {
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
      font-size: 15px;
      font-weight: 400;
      color: #007AFF;
      background: none;
      border: none;
      cursor: pointer;
      padding: 0;
      line-height: 1;
      height: auto;
      border-radius: 0;
      -webkit-tap-highlight-color: transparent;
    }
    .exp-head-cancel:active { opacity: 0.5; }

    /* ── body ── */
    .exp-body {
      padding: 20px 16px 0;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    /* ── nome do arquivo ── */
    .exp-field-label {
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
      font-size: 12px;
      font-weight: 500;
      letter-spacing: 0.3px;
      text-transform: uppercase;
      color: rgba(60,60,67,0.6);
      padding: 0 4px 5px;
    }
    @media (prefers-color-scheme: dark) {
      .exp-field-label { color: rgba(235,235,245,0.55); }
    }

    .exp-field-row {
      display: flex;
      align-items: center;
      background: #fff;
      border-radius: 12px;
      overflow: hidden;
      height: 48px;
    }
    @media (prefers-color-scheme: dark) {
      .exp-field-row { background: #2c2c2e; }
    }

    .exp-field-icon {
      width: 44px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: rgba(60,60,67,0.45);
      flex-shrink: 0;
    }
    @media (prefers-color-scheme: dark) {
      .exp-field-icon { color: rgba(235,235,245,0.4); }
    }

    .exp-field-input {
      flex: 1;
      border: none;
      outline: none;
      background: transparent;
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
      font-size: 16px;
      font-weight: 400;
      color: #000;
      padding: 0;
      height: 100%;
      min-width: 0;
    }
    @media (prefers-color-scheme: dark) {
      .exp-field-input { color: #fff; }
    }

    .exp-field-ext {
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
      font-size: 15px;
      color: rgba(60,60,67,0.4);
      padding-right: 14px;
      flex-shrink: 0;
      pointer-events: none;
    }
    @media (prefers-color-scheme: dark) {
      .exp-field-ext { color: rgba(235,235,245,0.35); }
    }

    .exp-path-hint {
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
      font-size: 12px;
      color: rgba(60,60,67,0.45);
      padding: 5px 4px 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      min-height: 18px;
    }
    @media (prefers-color-scheme: dark) {
      .exp-path-hint { color: rgba(235,235,245,0.35); }
    }

    /* ── destino (dois cartões) ── */
    .exp-dest-wrap {
      display: flex;
      gap: 8px;
      padding-top: 4px;
    }

    .exp-dest-card {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 9px;
      height: 80px;
      background: #fff;
      border-radius: 14px;
      border: none;
      cursor: pointer;
      transition: background 0.15s;
      position: relative;
      -webkit-tap-highlight-color: transparent;
      padding: 0;
      font-family: inherit;
    }
    @media (prefers-color-scheme: dark) {
      .exp-dest-card { background: #2c2c2e; }
    }
    .exp-dest-card:active { opacity: 0.7; }

    .exp-dest-card.exp-dest-selected {
      background: #007AFF;
    }
    @media (prefers-color-scheme: dark) {
      .exp-dest-card.exp-dest-selected { background: #0A84FF; }
    }

    .exp-dest-icon {
      color: rgba(60,60,67,0.55);
      display: flex;
      align-items: center;
      transition: color 0.15s;
    }
    .exp-dest-card.exp-dest-selected .exp-dest-icon { color: rgba(255,255,255,0.9); }
    @media (prefers-color-scheme: dark) {
      .exp-dest-icon { color: rgba(235,235,245,0.45); }
    }

    .exp-dest-label {
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
      font-size: 12px;
      font-weight: 500;
      color: rgba(60,60,67,0.65);
      letter-spacing: 0.1px;
      transition: color 0.15s;
    }
    .exp-dest-card.exp-dest-selected .exp-dest-label { color: #fff; }
    @media (prefers-color-scheme: dark) {
      .exp-dest-label { color: rgba(235,235,245,0.5); }
    }

    /* ── botão principal ── */
    .exp-cta-wrap {
      padding: 16px 16px 0;
    }

    .exp-cta {
      width: 100%;
      height: 52px;
      border: none;
      border-radius: 14px;
      background: #007AFF;
      color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 9px;
      transition: opacity 0.15s, transform 0.1s;
      -webkit-tap-highlight-color: transparent;
      letter-spacing: -0.1px;
    }
    @media (prefers-color-scheme: dark) {
      .exp-cta { background: #0A84FF; }
    }
    .exp-cta:active { opacity: 0.8; transform: scale(0.98); }

    .exp-cta-icon { display: flex; align-items: center; opacity: 0.9; }

    /* ── estado de sucesso do CTA ── */
    .exp-cta.exp-cta-success {
      background: #34C759;
      pointer-events: none;
    }
  `;
  document.head.appendChild(s);
}

function criarModalExportacao(nomePadrao) {
  injectExportStyles();

  const GITHUB_PASTA = "sentinela/artigos";

  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "exp-overlay";

    overlay.innerHTML = `
      <div class="exp-scrim"></div>
      <div class="exp-sheet" role="dialog" aria-modal="true" aria-label="Exportar arquivo">
        <div class="exp-handle"></div>

        <div class="exp-head">
          <span class="exp-head-title">Exportar</span>
          <button class="exp-head-cancel" type="button">Cancelar</button>
        </div>

        <div class="exp-body">
          <div>
            <div class="exp-field-label">Nome do arquivo</div>
            <div class="exp-field-row">
              <span class="exp-field-icon">${EXPORT_ICONS.file}</span>
              <input
                class="exp-field-input"
                type="text"
                value="${String(nomePadrao).replace(/"/g, "&quot;")}"
                spellcheck="false"
                autocomplete="off"
                autocapitalize="off"
                inputmode="url"
                aria-label="Nome do arquivo"
              >
              <span class="exp-field-ext">.html</span>
            </div>
            <div class="exp-path-hint"></div>
          </div>

          <div class="exp-dest-wrap">
            <button class="exp-dest-card exp-dest-selected" data-dest="git" type="button">
              <span class="exp-dest-icon">${EXPORT_ICONS.github}</span>
              <span class="exp-dest-label">GitHub</span>
            </button>
            <button class="exp-dest-card" data-dest="local" type="button">
              <span class="exp-dest-icon">${EXPORT_ICONS.download}</span>
              <span class="exp-dest-label">Local</span>
            </button>
          </div>
        </div>

        <div class="exp-cta-wrap">
          <button class="exp-cta" type="button">
            <span class="exp-cta-icon">${EXPORT_ICONS.github}</span>
            <span class="exp-cta-text">Enviar para GitHub</span>
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const sheet      = overlay.querySelector(".exp-sheet");
    const input      = overlay.querySelector(".exp-field-input");
    const pathHint   = overlay.querySelector(".exp-path-hint");
    const destCards  = overlay.querySelectorAll(".exp-dest-card");
    const cta        = overlay.querySelector(".exp-cta");
    const ctaIcon    = overlay.querySelector(".exp-cta-icon");
    const ctaText    = overlay.querySelector(".exp-cta-text");
    const cancelBtn  = overlay.querySelector(".exp-head-cancel");

    let destino = "git";

    const updateHint = () => {
      const nome = input.value.trim();
      if (!nome) { pathHint.textContent = ""; return; }
      pathHint.textContent = destino === "git"
        ? `${GITHUB_PASTA}/${nome}.html`
        : `${nome}.html`;
    };

    const updateCta = () => {
      if (destino === "git") {
        ctaIcon.innerHTML = EXPORT_ICONS.github;
        ctaText.textContent = "Enviar para GitHub";
      } else {
        ctaIcon.innerHTML = EXPORT_ICONS.download;
        ctaText.textContent = "Salvar localmente";
      }
    };

    destCards.forEach(card => {
      card.addEventListener("click", () => {
        destCards.forEach(c => c.classList.remove("exp-dest-selected"));
        card.classList.add("exp-dest-selected");
        destino = card.dataset.dest;
        updateCta();
        updateHint();
      });
    });

    input.addEventListener("input", updateHint);

    requestAnimationFrame(() => {
      overlay.classList.add("exp-visible");
      setTimeout(() => { input.focus(); input.select(); }, 420);
    });
    updateHint();

    let startY = 0, dragY = 0, dragging = false;

    sheet.addEventListener("touchstart", (e) => {
      const t = e.target;
      if (t.closest("input") || t.closest("button")) return;
      startY = e.touches[0].clientY;
      dragging = true;
      sheet.style.transition = "none";
    }, { passive: true });

    sheet.addEventListener("touchmove", (e) => {
      if (!dragging) return;
      dragY = e.touches[0].clientY - startY;
      if (dragY > 0) sheet.style.transform = `translateY(${dragY}px)`;
    }, { passive: true });

    sheet.addEventListener("touchend", () => {
      if (!dragging) return;
      dragging = false;
      sheet.style.transition = "transform 0.42s cubic-bezier(0.34, 1.10, 0.64, 1)";
      if (dragY > 90) finish(null);
      else sheet.style.transform = "translateY(0)";
      dragY = 0;
    });

    const finish = (payload) => {
      document.removeEventListener("keydown", onKey, true);
      overlay.classList.remove("exp-visible");
      setTimeout(() => overlay.remove(), 420);
      resolve(payload);
    };

    const submit = () => {
      const nomeBase = input.value.replace(/\.html$/i, "").trim();
      if (!nomeBase) { input.focus(); input.select(); return; }
      finish({ nomeBase, destino });
    };

    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); finish(null); }
      if (e.key === "Enter") { e.preventDefault(); submit(); }
    };

    cta.addEventListener("click", submit);
    cancelBtn.addEventListener("click", () => finish(null));
    overlay.querySelector(".exp-scrim").addEventListener("click", () => finish(null));
    document.addEventListener("keydown", onKey, true);
  });
}

$("btn4").onclick = async () => {
  feedbackBotao($("btn4"));

  const area = $("outputArea");
  const txt = area.value.trim();

  if (!txt) {
    alert("Não há nada para exportar!");
    return;
  }

  const GITHUB_TOKEN = "aqui";
  const OWNER = "sbsjonathan";
  const REPO = "assembleia-2026";
  const BRANCH = "main";
  const PASTA = "sentinela/artigos";

  const matchData = txt.match(/data-estudo=["']([^"']+)["']/i);
  const nomePadrao = (matchData ? matchData[1] : "estudo").replace(/\.html$/i, "").trim() || "estudo";

  const escolha = await criarModalExportacao(nomePadrao);
  if (!escolha) return;

  const { nomeBase, destino } = escolha;
  const nomeArquivo = `${nomeBase}.html`;

  const utf8ToBase64 = (str) => {
    const bytes = new TextEncoder().encode(str);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk)
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    return btoa(binary);
  };

  const exportarLocalmente = async () => {
    const blob = new Blob([txt], { type: "text/html" });
    const file = new File([blob], nomeArquivo, { type: "text/html" });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); } catch {}
      return;
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nomeArquivo;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const enviarParaGitHub = async () => {
    const filePath = `${PASTA}/${nomeArquivo}`;
    const apiUrl = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${filePath}`;

    const headers = {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${GITHUB_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28"
    };

    async function getSha() {
      const r = await fetch(`${apiUrl}?ref=${encodeURIComponent(BRANCH)}`, { headers });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`Erro ao consultar arquivo: ${r.status}`);
      return (await r.json()).sha || null;
    }

    const sha = await getSha();
    const body = { message: `Atualiza ${filePath}`, content: utf8ToBase64(txt), branch: BRANCH };
    if (sha) body.sha = sha;

    const r = await fetch(apiUrl, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    const data = await r.json();
    if (!r.ok) throw new Error(data.message || `Erro ${r.status}`);
    alert(`Enviado com sucesso:\n${filePath}`);
  };

  try {
    if (destino === "git") await enviarParaGitHub();
    else if (destino === "local") await exportarLocalmente();
  } catch (err) {
    alert((destino === "git" ? "Falha no GitHub:\n" : "Falha ao exportar:\n") + err.message);
  }
};

$("btnBack")?.addEventListener("click", () => {
  window.location.href = "../index.html";
});
