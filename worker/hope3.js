var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

var jw_default = {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    
    const urlParams = new URL(request.url).searchParams;
    let targetUrl = urlParams.get("url");
    let arquivoRtf = urlParams.get("arquivo");

    if (request.method === "POST" && !targetUrl && !arquivoRtf) {
      try {
        const body = await request.json();
        if (body.url) targetUrl = body.url;
        if (body.arquivo) arquivoRtf = body.arquivo;
      } catch (e) {}
    }

    const robustHeaders = new Headers({
      "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "pt-BR,pt;q=0.9",
      "Cache-Control": "no-cache",
      "Pragma": "no-cache",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Upgrade-Insecure-Requests": "1"
    });

    try {
      if (!targetUrl && arquivoRtf) {
        const match = arquivoRtf.match(/w_T_(\d{6})_(\d{2})\.rtf/i);
        if (match) {
          const fallbackData = await getFallbackUrlFromTOC(match[1], parseInt(match[2], 10), robustHeaders);
          if (fallbackData.url) targetUrl = fallbackData.url;
          else return new Response(`Erro ao descobrir o link: ${fallbackData.error}`, { status: 400, headers: corsHeaders });
        } else {
          return new Response(`Expressão regex falhou no arquivoRtf`, { status: 400, headers: corsHeaders });
        }
      }
      if (!targetUrl) return new Response(`Nenhuma URL alvo informada.`, { status: 400, headers: corsHeaders });
      
      let response = await fetch(targetUrl, { method: "GET", headers: robustHeaders, redirect: "follow" });
      const rawHtml = await response.text();
      
      if (!response.ok) return new Response(`Erro do site alvo JW.org: Status ${response.status}`, { status: response.status, headers: corsHeaders });
      
      let hexColor = "";
      const tokenMatch = rawHtml.match(/\bdu-bgColor--([a-z0-9-]+)\b/i);
      if (tokenMatch) hexColor = await fetchHexFromCss(rawHtml, targetUrl, tokenMatch[0], robustHeaders);
      if (!hexColor) hexColor = tokenMatch ? tokenMatch[1] : "";
      
      const onlyArticle = keepOnlyArticle(rawHtml);
      const rewriter = new HTMLRewriter()
        .on(".gen-field", { element: __name((el) => el.remove(), "element") })
        .on(".jsPinnedAudioPlayer", { element: __name((el) => el.remove(), "element") })
        .on(".jsAudioPlayer", { element: __name((el) => el.remove(), "element") })
        .on(".jsAudioFormat", { element: __name((el) => el.remove(), "element") })
        .on(".jsVideoPoster", { element: __name((el) => el.remove(), "element") })
        .on(".articleFooterLinks", { element: __name((el) => el.remove(), "element") })
        .on(".pageNum", { element: __name((el) => el.remove(), "element") });
        
      const cleaned = await rewriter.transform(new Response(onlyArticle, { headers: { "Content-Type": "text/html;charset=UTF-8" } })).text();
      
      const afterP2 = PROCESSADOR_2(cleaned, hexColor);
      const afterP3 = PROCESSADOR_3(afterP2);
      const afterP4 = PROCESSADOR_4(afterP3);
      const afterP5 = PROCESSADOR_5(afterP4);
      const afterP6 = PROCESSADOR_6(afterP5);
      const afterP8 = PROCESSADOR_8(afterP6);
      const afterP7 = PROCESSADOR_7(afterP8);
      
      let withPerguntas = processPerguntas(afterP7);
      withPerguntas = withPerguntas.replace(
        /(<strong[^>]*>\s*)?(\(?\s*Leia\s+(?:<bbl>[\s\S]*?<\/bbl>)(?:\s*(?:,|;|e)\s*<bbl>[\s\S]*?<\/bbl>)*\s*[\).,:;!?]?)(\s*<\/strong>)?/g,
        (_match, _openStrong, trecho) => `<strong>${trecho}</strong>`
      );
      
      const finalHtml = normalizeBlankLines(withPerguntas);
      return new Response(finalHtml, { status: 200, headers: { ...corsHeaders, "Content-Type": "text/html;charset=UTF-8" } });
    } catch (error) {
      return new Response(`Erro no Worker: ${error.message}`, { status: 500, headers: { ...corsHeaders, "Content-Type": "text/plain;charset=UTF-8" } });
    }
  }
};

async function getFallbackUrlFromTOC(issue, studyNumber, robustHeaders) {
  const ano = issue.slice(0, 4);
  const mesNum = issue.slice(4, 6);
  const meses = { "01": "janeiro", "02": "fevereiro", "03": "marco", "04": "abril", "05": "maio", "06": "junho", "07": "julho", "08": "agosto", "09": "setembro", "10": "outubro", "11": "novembro", "12": "dezembro" };
  const mesNome = meses[mesNum];
  if (!mesNome) return { error: "Mês inválido" };
  const tocUrl = `https://www.jw.org/pt/biblioteca/revistas/sentinela-estudo-${mesNome}-${ano}/`;
  const res = await fetch(tocUrl, { method: "GET", headers: robustHeaders, redirect: "follow" });
  if (!res.ok) return { error: `Bloqueio: ${res.status}` };
  const html = await res.text();
  const regex = new RegExp(`href=["'](/pt/biblioteca/revistas/sentinela-estudo-${mesNome}-${ano}/[^"']+)["']`, "gi");
  let matches =[];
  let match;
  while ((match = regex.exec(html)) !== null) matches.push(match[1]);
  matches = [...new Set(matches)].filter((m) => !m.replace(/\/$/, "").endsWith(`${mesNome}-${ano}`));
  const idx = studyNumber - 1;
  if (idx >= 0 && idx < matches.length) {
    let urlMontada = `https://www.jw.org` + matches[idx];
    if (!urlMontada.endsWith("/")) urlMontada += "/";
    return { url: urlMontada };
  }
  return { error: `Artigo ${studyNumber} não encontrado.` };
}
__name(getFallbackUrlFromTOC, "getFallbackUrlFromTOC");

async function fetchHexFromCss(html, baseUrl, tokenClass, robustHeaders) {
  try {
    const baseMatch = html.match(/<base\b[^>]*href\s*=\s*["']([^"']+)["']/i);
    const baseHref = baseMatch ? baseMatch[1] : baseUrl;
    const hrefs =[];
    const linkRe = /<link\b[^>]*>/gi;
    let lm;
    while ((lm = linkRe.exec(html)) !== null) {
      const tag = lm[0];
      const relM = tag.match(/\brel\s*=\s*["']([^"']+)["']/i);
      const hrefM = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i);
      if (!hrefM) continue;
      const rel = (relM ? relM[1] : "").toLowerCase();
      const asVal = (tag.match(/\bas\s*=\s*["']([^"']+)["']/i)?.[1] || "").toLowerCase();
      if (!rel.includes("stylesheet") && !(rel.includes("preload") && asVal === "style")) continue;
      const rawHref = hrefM[1].trim();
      if (!rawHref) continue;
      const abs = new URL(rawHref, baseHref).toString();
      if (abs.toLowerCase().includes(".css")) hrefs.push(abs);
    }
    const collectorUrl = hrefs.find((u) => /collector(\.|-)?[^/]*\.css/i.test(u)) || hrefs.find((u) => /collector/i.test(u));
    if (collectorUrl) {
      const cssResp = await fetch(collectorUrl, { method: "GET", headers: robustHeaders, redirect: "follow" });
      if (cssResp.ok) {
        const css = await cssResp.text();
        const esc = tokenClass.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const bgHexRe = new RegExp("\\.jwac\\s+\\." + esc + "\\b[\\s\\S]*?\\{[\\s\\S]*?background-color\\s*:\\s*(#[0-9a-fA-F]{3,6})", "i");
        let bgM = css.match(bgHexRe);
        if (bgM && bgM[1]) return bgM[1];
        const fbg = css.match(new RegExp("\\." + esc + "\\b[\\s\\S]*?\\{[\\s\\S]*?background-color\\s*:\\s*(#[0-9a-fA-F]{3,6})", "i"));
        if (fbg && fbg[1]) return fbg[1];
      }
    }
  } catch (e) {
    return null;
  }
  return null;
}
__name(fetchHexFromCss, "fetchHexFromCss");

function normalizeBlankLines(html) {
  return html.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
__name(normalizeBlankLines, "normalizeBlankLines");

function keepOnlyArticle(html) {
  const src = html.replace(/\r\n/g, "\n");
  const start = src.search(/<article\b[^>]*\bid=(?:"|')article(?:"|')[^>]*>/i);
  if (start < 0) return src;
  const endMatch = src.slice(start).match(/<\/article\s*>/i);
  if (!endMatch) return src.slice(start);
  return src.slice(start, start + endMatch.index) + "</article>";
}
__name(keepOnlyArticle, "keepOnlyArticle");

function stripTags(s) {
  return s.replace(/<[^>]+>/g, "");
}
__name(stripTags, "stripTags");

function processPerguntas(html) {
  const preserveAllowedTags = __name((s) => {
    let t = (s || "").replace(/\r\n/g, "\n");
    t = t.replace(/<a\b[^>]*\bclass=(["'])[^"']*\bjsBibleLink\b[^"']*\1[^>]*>([\s\S]*?)<\/a>/gi, (_m, _q, inner) => `<bbl>${stripTags(inner).replace(/\s+/g, " ").trim()}</bbl>`);
    t = t.replace(/<\s*bbl\s*>/gi, "__BBL_OPEN__").replace(/<\s*\/\s*bbl\s*>/gi, "__BBL_CLOSE__");
    t = t.replace(/<\s*strong\s*>/gi, "__STRONG_OPEN__").replace(/<\s*\/\s*strong\s*>/gi, "__STRONG_CLOSE__");
    t = t.replace(/<\s*em\s*>/gi, "__EM_OPEN__").replace(/<\s*\/\s*em\s*>/gi, "__EM_CLOSE__");
    t = t.replace(/<[^>]+>/g, "");
    t = t.replace(/__BBL_OPEN__/g, "<bbl>").replace(/__BBL_CLOSE__/g, "</bbl>");
    t = t.replace(/__STRONG_OPEN__/g, "<strong>").replace(/__STRONG_CLOSE__/g, "</strong>");
    t = t.replace(/__EM_OPEN__/g, "<em>").replace(/__EM_CLOSE__/g, "</em>");
    return t.replace(/\s+/g, " ").trim();
  }, "preserveAllowedTags");
  return html.replace(
    /<p\b[^>]*\bclass=(["'])[^"']*\bqu\b[^"']*\1[^>]*>\s*<strong[^>]*>\s*([\s\S]*?)\s*<\/strong>([\s\S]*?)<\/p>/gi,
    (_m, _q, strongPart, rest) => `\n\n<pergunta>${(stripTags(strongPart).replace(/\s+/g, "").trim() ? stripTags(strongPart).replace(/\s+/g, "").trim() + " " : "") + preserveAllowedTags(rest)}</pergunta>\n\n`
  );
}
__name(processPerguntas, "processPerguntas");

function PROCESSADOR_2(html, hexColor) {
  let out = html.replace(/\r\n/g, "\n");
  const docIdMatch = out.match(/\bdocId-(\d+)\b/i);
  const docId = docIdMatch ? docIdMatch[1] : "";
  const tt2OpenRe = /<div\b[^>]*\bid=(?:"|')tt2(?:"|')[^>]*>/i;
  const tt2OpenMatch = out.match(tt2OpenRe);
  if (!tt2OpenMatch) return out;
  const tt2OpenIdx = tt2OpenMatch.index;
  const tt2OpenTag = tt2OpenMatch[0];
  const openEnd = tt2OpenIdx + tt2OpenTag.length;
  let i = openEnd, depth = 1;
  while (i < out.length) {
    const nextOpen = out.slice(i).search(/<div\b/i);
    const nextClose = out.slice(i).search(/<\/div\s*>/i);
    if (nextClose < 0) break;
    if (nextOpen >= 0 && nextOpen < nextClose) {
      depth++;
      i += nextOpen + 4;
      continue;
    }
    depth--;
    const closeStart = i + nextClose;
    const closeEnd = closeStart + out.slice(closeStart).match(/<\/div\s*>/i)[0].length;
    if (depth === 0) {
      const inside = out.slice(openEnd, closeStart), rest = out.slice(closeEnd);
      return `${docId}\n\n${hexColor}\n\n` + inside + rest;
    }
    i = closeEnd;
  }
  return `${docId}\n\n${hexColor}\n\n` + out.slice(openEnd);
}
__name(PROCESSADOR_2, "PROCESSADOR_2");

function PROCESSADOR_3(html) {
  let out = html.replace(/\r\n/g, "\n");
  out = out.replace(/<p\b[^>]*\bclass=(["'])[^"']*\bcontextTtl\b[^"']*\1[^>]*>[\s\S]*?<\/p>/i, (m) => `<estudo>${stripTags(m).replace(/\s+/g, " ").trim()}</estudo>\n\n`);
  out = out.replace(/<div\b[^>]*\bid=(?:"|')tt4(?:"|')[^>]*>[\s\S]*?<\/div>/i, (m) => `<cantico>${stripTags(m).replace(/\s+/g, " ").trim()}</cantico>\n\n`);
  out = out.replace(/<h1\b[^>]*>[\s\S]*?<\/h1>/i, (m) => `<tema>${stripTags(m).replace(/\s+/g, " ").trim()}</tema>\n\n`);
  return out;
}
__name(PROCESSADOR_3, "PROCESSADOR_3");

function PROCESSADOR_4(html) {
  let out = html.replace(/\r\n/g, "\n");
  out = out.replace(/<a\b[^>]*\bclass=(["'])[^"']*\bjsBibleLink\b[^"']*\1[^>]*>([\s\S]*?)<\/a>/gi, (_m, _q, inner) => `<bbl>${stripTags(inner).replace(/\s+/g, " ").trim()}</bbl>`);
  out = out.replace(
    /<p\b[^>]*>\s*<span\b[^>]*\bclass=(["'])[^"']*\bparNum\b[^"']*\1[^>]*\bdata-pnum=(["'])(\d+)\2[^>]*>[\s\S]*?<\/span>([\s\S]*?)<\/p>/gi,
    (_m, _q1, _q2, num, restHtml) => {
      let rest = restHtml || "";
      rest = rest.replace(/<span\b[^>]*\bclass=(["'])[^"']*\brefID\b[^"']*\1[^>]*>[\s\S]*?<\/span>/gi, "");
      rest = rest.replace(/<a\b[^>]*\bclass=(["'])[^"']*\bfootnoteLink\b[^"']*\1[^>]*>[\s\S]*?<\/a>/gi, " * ");
      rest = rest.replace(/^\s+/, "").replace(/^\u00a0+/, "").replace(/\s+$/, "");
      return `\n\n<paragrafo>${num} ${rest}</paragrafo>\n\n`;
    }
  );
  return out;
}
__name(PROCESSADOR_4, "PROCESSADOR_4");

function PROCESSADOR_5(html) {
  let out = html.replace(/\r\n/g, "\n");
  out = out.replace(/<\/tema>\s*<\/header>[\s\S]*?(?=<div\b[^>]*\bid=(?:"|')tt8(?:"|')[^>]*>|<p\b[^>]*\bclass)/i, "</tema>\n\n");
  out = out.replace(/<div\b[^>]*\bclass=(["'])[^"']*\bbodyTxt\b[^"']*\1[^>]*>/gi, "");
  const stripTagsExceptBbl = __name((s) => {
    let t = s.replace(/<\s*bbl\s*>/gi, "__BBL_OPEN__").replace(/<\s*\/\s*bbl\s*>/gi, "__BBL_CLOSE__");
    t = t.replace(/<[^>]+>/g, "");
    return t.replace(/__BBL_OPEN__/g, "<bbl>").replace(/__BBL_CLOSE__/g, "</bbl>");
  }, "stripTagsExceptBbl");
  out = out.replace(/<div\b[^>]*\bid=(?:"|')tt8(?:"|')[^>]*>[\s\S]*?<p\b[^>]*\bclass=(["'])[^"']*\bthemeScrp\b[^"']*\1[^>]*>([\s\S]*?)<\/p>[\s\S]*?<\/div>/gi, (_m, _q, inner) => `<citacao>${stripTagsExceptBbl(inner).replace(/\s+/g, " ").trim()}</citacao>\n\n`);
  out = out.replace(
    /<div\b[^>]*\bid=(?:"|')tt\d+(?:"|')[^>]*>([\s\S]*?)<\/div>/gi,
    (m, inner) => {
      if (/<strong[^>]*>\s*OBJETIVO\s*<\/strong>/i.test(inner)) {
        let txt = stripTags(inner).replace(/\s+/g, " ").trim();
        txt = txt.replace(/^OBJETIVO\s*/i, "");
        return `<objetivo>OBJETIVO\n${txt}</objetivo>\n\n`;
      }
      return m;
    }
  );
  return out;
}
__name(PROCESSADOR_5, "PROCESSADOR_5");

function PROCESSADOR_6(html) {
  let out = html.replace(/\r\n/g, "\n");
  out = out.replace(/<div\b[^>]*\bclass=(["'])[^"']*\bblockTeach\b[^"']*\1[^>]*>\s*<aside\b[^>]*>[\s\S]*?<\/aside>/gi, (m) => {
    const h2m = m.match(/<h2\b[^>]*>[\s\S]*?<\/h2>/i);
    const titulo = h2m ? stripTags(h2m[0]).replace(/\s+/g, " ").trim() : "";
    const itens = [];
    m.replace(/<li\b[^>]*>[\s\S]*?<p\b[^>]*>([\s\S]*?)<\/p>[\s\S]*?<\/li>/gi, (_mm, pInner) => {
      const t = stripTags(pInner).replace(/\s+/g, " ").trim();
      if (t) itens.push(t);
      return _mm;
    });
    if (!titulo && itens.length === 0) return m;
    return `\n\n<recap>\n${(titulo + itens.map((t) => `\n\n\u2022 ${t}`).join("")).trim()}</recap>`;
  });
  out = out.replace(
    /<div\b[^>]*\bid=(["'])f\d+\1[^>]*>[\s\S]*?<figure\b[^>]*>[\s\S]*?<\/figure>\s*<\/div>(?:\s*<hr\b[^>]*>)?/gi,
    (m) => {
      const lgMatch = m.match(/data-img-size-lg=(["'])(.*?)\1/i);
      const src = lgMatch ? lgMatch[2] : "";
      if (!src) return m;
      const pMatch = m.match(/<figcaption\b[^>]*>[\s\S]*?<p\b[^>]*>([\s\S]*?)<\/p>/i);
      let caption = "";
      if (pMatch && pMatch[1]) {
        let pInner = pMatch[1];
        pInner = pInner.replace(/<span\b[^>]*\bclass=(["'])[^"']*\brefID\b[^"']*\1[^>]*>[\s\S]*?<\/span>/gi, "");
        pInner = pInner.replace(/<a\b[^>]*\bclass=(["'])[^"']*\bfootnoteLink\b[^"']*\1[^>]*>[\s\S]*?<\/a>/gi, " * ");
        caption = stripTags(pInner).replace(/\s+/g, " ").trim();
      }
      let fig = `\n\n<figure>\n  <img src="${src}">`;
      if (caption) fig += `\n  <figcaption>\n    ${caption}\n  </figcaption>`;
      fig += `\n</figure>\n\n`;
      return fig;
    }
  );
  return out;
}
__name(PROCESSADOR_6, "PROCESSADOR_6");

function PROCESSADOR_8(html) {
  let out = html.replace(/\r\n/g, "\n");
  out = out.replace(
    /<div\b[^>]*\bclass=(["'])[^"']*\bboxSupplement\b[^"']*\1[^>]*>[\s\S]*?<aside\b[^>]*>([\s\S]*?)<\/aside>[\s\S]*?<\/div>/gi,
    (m, quote, asideInner) => {
      const partes =[];
      const h2Match = asideInner.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i);
      let titulo = "";
      if (h2Match) {
        let tHtml = h2Match[1].replace(/<span\b[^>]*\bclass=(["'])[^"']*\brefID\b[^"']*\1[^>]*>[\s\S]*?<\/span>/gi, "");
        titulo = stripTags(tHtml).replace(/\s+/g, " ").trim();
        if (titulo) partes.push(titulo);
      }
      const blockRegex = /<(p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi;
      let bm;
      while ((bm = blockRegex.exec(asideInner)) !== null) {
        const tag = bm[1].toLowerCase();
        let inner = bm[2];
        let plainTextCheck = stripTags(inner).replace(/\s+/g, " ").trim();
        if (!plainTextCheck || plainTextCheck === titulo) continue;
        inner = inner.replace(/<span\b[^>]*\bclass=(["'])[^"']*\brefID\b[^"']*\1[^>]*>[\s\S]*?<\/span>/gi, "");
        inner = inner.replace(/<a\b[^>]*\bclass=(["'])[^"']*\bfootnoteLink\b[^"']*\1[^>]*>[\s\S]*?<\/a>/gi, " * ");
        let text = inner.replace(/<\s*bbl\s*>/gi, "__BBL_OPEN__").replace(/<\s*\/\s*bbl\s*>/gi, "__BBL_CLOSE__");
        text = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
        text = text.replace(/__BBL_OPEN__/g, "<bbl>").replace(/__BBL_CLOSE__/g, "</bbl>").trim();
        if (text && text !== "*") {
          if (tag === "li") partes.push(`\u2022 ${text}`);
          else partes.push(text);
        }
      }
      return `\n\n<quadro>\n${partes.join("\n\n")}\n</quadro>\n\n`;
    }
  );
  return out;
}
__name(PROCESSADOR_8, "PROCESSADOR_8");

function PROCESSADOR_7(html) {
  let out = html.replace(/\r\n/g, "\n");
  out = out.replace(/<h2\b[^>]*\bclass=(["'])[^"']*\bdu-textAlign--center\b[^"']*\1[^>]*>[\s\S]*?<\/h2>/gi, (m) => {
    const txt = stripTags(m).replace(/\s+/g, " ").trim();
    return txt ? `\n\n<subtitulo>${txt}</subtitulo>\n\n` : m;
  });
  out = out.replace(
    /<div\b[^>]*\bclass=(["'])[^"']*\bdu-color--textSubdued\b[^"']*\1[^>]*>\s*<p\b[^>]*>[\s\S]*?CÂNTICO[\s\S]*?<\/p>\s*<\/div>/gi,
    (m) => {
      const txt = stripTags(m).replace(/\s+/g, " ").trim();
      if (!txt) return m;
      return `\n\n<cantico>${txt}</cantico>\n\n`;
    }
  );
  const preserveFormatAndLinks = __name((s) => {
    let t = s.replace(/<\s*bbl\s*>/gi, "__BBL_OPEN__").replace(/<\s*\/\s*bbl\s*>/gi, "__BBL_CLOSE__");
    t = t.replace(/<\s*strong\s*>/gi, "__STRONG_OPEN__").replace(/<\s*\/\s*strong\s*>/gi, "__STRONG_CLOSE__");
    t = t.replace(/<\s*em\s*>/gi, "__EM_OPEN__").replace(/<\s*\/\s*em\s*>/gi, "__EM_CLOSE__");
    const links = [];
    t = t.replace(/<a\b[^>]*\bhref=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi, (m, quote, href, inner) => {
      let url = href;
      if (url.startsWith("/")) url = "https://jw.org" + url;
      let text = inner.replace(/__[A-Z]+_[A-Z]+__/g, "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ");
      links.push(`<link><a href="${url}">${text}</a></link>`);
      return `__LINK_${links.length - 1}__`;
    });
    t = t.replace(/<[^>]+>/g, "");
    t = t.replace(/__BBL_OPEN__/g, "<bbl>").replace(/__BBL_CLOSE__/g, "</bbl>");
    t = t.replace(/__STRONG_OPEN__/g, "<strong>").replace(/__STRONG_CLOSE__/g, "</strong>");
    t = t.replace(/__EM_OPEN__/g, "<em>").replace(/__EM_CLOSE__/g, "</em>");
    t = t.replace(/__LINK_(\d+)__/g, (m, idx) => links[parseInt(idx)]);
    return t.replace(/\s+/g, " ").trim();
  }, "preserveFormatAndLinks");
  const notes =[];
  out = out.replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, (m, inner) => {
    const isNote = /<a\b[^>]*\bclass=(["'])[^"']*\bfn-symbol\b[^"']*\1[^>]*>/i.test(inner) || /<strong>(?:ENTENDA MELHOR|DESCRIÇÃO DA IMAGEM|Para ver mais|Veja o quadro|Veja o artigo|Compare)/i.test(inner) || /class=(["'])[^"']*\bfootnote\b[^"']*\1/i.test(m);
    if (isNote) {
      let cleanInner = inner;
      if (/<a\b[^>]*\bclass=(["'])[^"']*\bfn-symbol\b[^"']*\1[^>]*>/i.test(cleanInner)) {
        cleanInner = cleanInner.replace(/<a\b[^>]*\bclass=(["'])[^"']*\bfn-symbol\b[^"']*\1[^>]*>[\s\S]*?<\/a>/i, " * ");
      } else {
        cleanInner = " * " + cleanInner;
      }
      let noteText = preserveFormatAndLinks(cleanInner);
      noteText = noteText.replace(/^\s*\*\s*/, "* ");
      if (noteText) notes.push(`<nota> ${noteText}</nota>`);
      return "";
    }
    return m;
  });
  out = out.replace(/<\/?article\b[^>]*>/gi, "");
  out = out.replace(/<\/div>\s*(<recap>)/gi, "$1");
  out = out.replace(/(<\/recap>)\s*<\/div>/gi, "$1");
  out = out.replace(/(?:<div\b[^>]*>|<\/div>|\s)+$/gi, "");
  if (notes.length > 0) {
    out += "\n\n" + notes.join("\n\n") + "\n";
  }
  return out;
}
__name(PROCESSADOR_7, "PROCESSADOR_7");

export {
  jw_default as default
};