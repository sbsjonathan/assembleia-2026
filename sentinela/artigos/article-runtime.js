(function (scope) {
  'use strict';

  // Shared by the navigation worker and the first-load fallback page. Older
  // downloads keep their original cache name and URL, so no download is lost.
  const CACHE_NAME = 'ass26-artigos-v1';
  const PROXY_URL = 'https://hope2.momentaneo2021.workers.dev/';
  const pad = value => String(value).padStart(2, '0');
  const iso = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

  function calendarDate(year, month, day) {
    const date = new Date(year, month - 1, day, 12);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
  }

  function resolveDate(url, now = new Date()) {
    const params = new URL(String(url), 'https://sentinela.invalid/').searchParams;
    const requested = /^(\d{4})-(\d{2})-(\d{2})$/.exec(params.get('d') || '');
    if (requested) {
      const date = calendarDate(Number(requested[1]), Number(requested[2]), Number(requested[3]));
      if (date) return iso(date);
    }
    const week = /^(\d{1,2})-(\d{1,2})$/.exec(params.get('semana') || '');
    if (week) {
      const candidates = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1]
        .map(year => calendarDate(year, Number(week[2]), Number(week[1])))
        .filter(Boolean)
        .sort((a, b) => Math.abs(a - now) - Math.abs(b - now));
      if (candidates.length) return iso(candidates[0]);
    }
    return iso(now);
  }

  function cacheKey(date) {
    return `${PROXY_URL}?semana=${encodeURIComponent(date)}`;
  }

  function isArticle(html) {
    if (typeof html !== 'string' || !/^\s*<!doctype\s+html\b/i.test(html)) return false;
    // A generic HTML error/challenge page must never replace a downloaded study.
    return /<body\b[^>]*\bdata-estudo\s*=/i.test(html) ||
      (/<(?:main|article)\b/i.test(html) && /\b(?:class|id)\s*=\s*["'][^"']*\b(?:paragrafo|barra-estudo|secao-cantico)\b/i.test(html));
  }

  function escapeAttribute(value) {
    return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  function isStatusBarMeta(tag) {
    const attributes = tag.replace(/^<meta\b/i, '').replace(/>$/, '');
    const attribute = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    let match;
    while ((match = attribute.exec(attributes))) {
      if (match[1].toLowerCase() === 'name') {
        return (match[2] ?? match[3] ?? match[4] ?? '').toLowerCase() === 'apple-mobile-web-app-status-bar-style';
      }
    }
    return false;
  }

  // The worker has no DOMParser. Scan just the real head, leaving comments,
  // script/style text and inert template contents untouched in old downloads.
  function articleHead(html) {
    const token = /<!--[\s\S]*?(?:-->|$)|<![^>]*>|<\/?([a-z][a-z0-9:-]*)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi;
    const headElements = new Set(['base', 'basefont', 'bgsound', 'link', 'meta', 'title', 'noscript', 'noframes', 'script', 'style', 'template']);
    const rawText = new Set(['script', 'style', 'title', 'noscript', 'noframes']);
    let start = 0, end = html.length, cursor = 0, explicit = false, closed = false, templates = 0, match;
    const statusMetas = [];
    while ((match = token.exec(html))) {
      const tag = match[0], name = (match[1] || '').toLowerCase(), closing = /^<\//.test(tag);
      if (!templates && /\S/.test(html.slice(cursor, match.index))) {
        end = cursor;
        break;
      }
      cursor = token.lastIndex;
      if (!name) {
        if (!explicit && /^<!doctype\b/i.test(tag)) start = cursor;
        continue;
      }
      if (name === 'template') {
        templates = Math.max(0, templates + (closing ? -1 : 1));
        continue;
      }
      if (templates) {
        if (!closing && rawText.has(name)) {
          const close = new RegExp('</' + name + '\\b[^>]*>', 'gi');
          close.lastIndex = cursor;
          const found = close.exec(html);
          cursor = token.lastIndex = found ? close.lastIndex : html.length;
        }
        continue;
      }
      if (name === 'html' && !closing && !explicit) { start = cursor; continue; }
      if (name === 'head' && !closing && !explicit) { start = cursor; explicit = true; continue; }
      if (name === 'head' && closing) { end = match.index; closed = true; break; }
      if (!headElements.has(name)) { end = match.index; break; }
      if (name === 'meta' && !closing && isStatusBarMeta(tag)) statusMetas.push({ start: match.index, end: cursor });
      if (!closing && rawText.has(name)) {
        const close = new RegExp('</' + name + '\\b[^>]*>', 'gi');
        close.lastIndex = cursor;
        const found = close.exec(html);
        cursor = token.lastIndex = found ? close.lastIndex : html.length;
      }
    }
    return { start, end, explicit, closed, statusMetas };
  }

  function prepareHTML(html, { date, rootURL }) {
    if (!isArticle(html)) throw new Error('O conteúdo recebido não é um estudo.');
    const root = new URL('./', rootURL).href;
    // Scope storage before any downloaded article script can access it.
    const appScope = `<script id="assembleia-app-scope" src="${escapeAttribute(new URL('shared/app-scope.js', root).href)}"></script>`;
    const scriptURL = new URL('sentinela/artigos/reading-position.js', root).href;
    const script = /\bid\s*=\s*["']sentinela-reading-position["']/i.test(html) ? '' : `<script id="sentinela-reading-position" src="${escapeAttribute(scriptURL)}" data-study-date="${escapeAttribute(date)}" data-project-root="${escapeAttribute(root)}"></script>`;
    const statusbar = (/\bid\s*=\s*["']sentinela-statusbar-style["']/i.test(html) ? '' : `<link id="sentinela-statusbar-style" rel="stylesheet" href="${escapeAttribute(new URL('shared/statusbar.css', root).href)}">`) +
      (/\bid\s*=\s*["']sentinela-statusbar-script["']/i.test(html) ? '' : `<script id="sentinela-statusbar-script" src="${escapeAttribute(new URL('shared/statusbar.js', root).href)}"></script>`);
    const typography = (/\bid\s*=\s*["']sentinela-typography-script["']/i.test(html) ? '' : `<script id="sentinela-typography-script" src="${escapeAttribute(new URL('shared/typography.js', root).href)}"></script>`) +
      (/\bid\s*=\s*["']sentinela-typography-style["']/i.test(html) ? '' : `<link id="sentinela-typography-style" rel="stylesheet" href="${escapeAttribute(new URL('shared/typography.css', root).href)}">`);
    const head = articleHead(html);
    let contents = html.slice(head.start, head.end);
    for (const meta of head.statusMetas.reverse()) {
      contents = contents.slice(0, meta.start - head.start) + contents.slice(meta.end - head.start);
    }
    // Remove legacy native status-bar metadata on every opening, including old
    // offline HTML. The install/launch policy must also be absent on the index;
    // toggling it per page cannot reliably change an installed iOS web view.
    // Reading position runs before styles; typography follows legacy bootstraps.
    // The URL stays estudo.html, preserving all relative assets and links.
    return html.slice(0, head.start) + (head.explicit ? '' : '<head>') + appScope + script + statusbar +
      contents + typography + (head.closed ? '' : '</head>') + html.slice(head.end);
  }

  scope.SentinelaArticleRuntime = Object.freeze({ CACHE_NAME, PROXY_URL, resolveDate, cacheKey, isArticle, prepareHTML });
})(typeof self === 'object' ? self : globalThis);
