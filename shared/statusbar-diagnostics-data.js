/* Opt-in, local technical measurements. No article text, form values, account
 * data or saved notes are read; native iOS chrome is outside the DOM. */
(function initStatusbarDiagnosticsData() {
    'use strict';
    const SCHEMA_VERSION = 1;
    const MAX_ERRORS = 12;
    const STYLE_KEYS = [
        'display', 'position', 'top', 'right', 'bottom', 'left', 'width', 'height',
        'minHeight', 'maxHeight', 'boxSizing', 'paddingTop', 'paddingBottom',
        'marginTop', 'marginBottom', 'backgroundColor', 'backgroundImage',
        'opacity', 'visibility', 'zIndex', 'pointerEvents', 'overflow',
        'overflowX', 'overflowY', 'filter', 'backdropFilter', 'webkitBackdropFilter',
        'transform', 'perspective', 'contain', 'contentVisibility', 'isolation',
        'mixBlendMode', 'willChange', 'clipPath', 'maskImage', 'webkitMaskImage',
        'overscrollBehaviorY', 'webkitOverflowScrolling', 'transitionProperty'
    ];
    const ELEMENTS = {
        root: 'html', body: 'body', strip: '#app-solid-statusbar',
        articleHeader: '.barra-estudo', bibleHeader: '.app-header',
        studyHeader: '.study-article-header', bibleTabs: '.section-tabs',
        notesMask: '.statusbar-mask', notesScroller: '.editor-scroll',
        homeStatusbar: '.home-statusbar', navbar: '.bottom-navbar',
        imageViewer: '.zoom-container', imageHeader: '.zoom-header',
        searchDialog: '#search-dialog'
    };

    function finite(value) {
        return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
    }
    function label(value, limit = 120) {
        return typeof value === 'string' ? value.slice(0, limit) : null;
    }
    function pathOnly(value) {
        if (!value) return null;
        try {
            const url = new URL(value, location.href);
            if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
            return url.origin + url.pathname;
        } catch (_) { return null; }
    }
    function cssValue(value) {
        if (!value) return null;
        // CSS images/filter URLs can carry signed or private query parameters.
        return /url\s*\(/i.test(value) ? '[CSS URL omitted]' : label(value, 300);
    }
    function identity(element) {
        if (!(element instanceof Element)) return null;
        return {
            tag: element.localName,
            id: label(element.id, 100),
            classes: [...element.classList].slice(0, 16).map(value => label(value, 60))
        };
    }
    function rectangle(element) {
        const rect = element.getBoundingClientRect();
        return Object.fromEntries(['x', 'y', 'top', 'right', 'bottom', 'left', 'width', 'height']
            .map(key => [key, finite(rect[key])]));
    }
    function styleSnapshot(element, pseudo) {
        const style = getComputedStyle(element, pseudo);
        return Object.fromEntries(STYLE_KEYS.map(key => [key, cssValue(style[key])]));
    }
    function elementSnapshot(element, includeAncestors = false) {
        if (!element) return null;
        const result = {
            ...identity(element), rect: rectangle(element), style: styleSnapshot(element),
            clientWidth: element.clientWidth, clientHeight: element.clientHeight,
            scrollWidth: element.scrollWidth, scrollHeight: element.scrollHeight,
            scrollTop: finite(element.scrollTop), scrollLeft: finite(element.scrollLeft)
        };
        if (includeAncestors) {
            result.ancestors = [];
            let ancestor = element.parentElement;
            while (ancestor && result.ancestors.length < 8) {
                result.ancestors.push({ ...identity(ancestor), rect: rectangle(ancestor), style: styleSnapshot(ancestor) });
                ancestor = ancestor.parentElement;
            }
        }
        return result;
    }
    function headerTextRectangles(element) {
        if (!element) return null;
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        const rectangles = [];
        let node;
        while ((node = walker.nextNode()) && rectangles.length < 30) {
            // Range geometry, never the node's text or its selection value.
            const range = document.createRange();
            range.selectNodeContents(node);
            for (const rect of range.getClientRects()) {
                if (rect.width && rect.height) rectangles.push({ top: finite(rect.top), left: finite(rect.left), width: finite(rect.width), height: finite(rect.height), bottom: finite(rect.bottom) });
                if (rectangles.length === 30) break;
            }
            range.detach();
        }
        return rectangles;
    }
    function topCandidates() {
        const elements = document.body?.querySelectorAll('*') || [];
        const candidates = [];
        let examined = 0;
        for (const element of elements) {
            if (++examined > 5000 || candidates.length === 40) break;
            const rect = element.getBoundingClientRect();
            if (!rect.width || !rect.height || rect.bottom <= 0 || rect.top >= 200 || rect.right <= 0 || rect.left >= innerWidth) continue;
            const style = getComputedStyle(element);
            const backdrop = style.backdropFilter || style.webkitBackdropFilter;
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
            if (!['fixed', 'sticky'].includes(style.position) && (!style.filter || style.filter === 'none') && (!backdrop || backdrop === 'none')) continue;
            candidates.push(elementSnapshot(element, true));
        }
        return { examined, truncated: examined > 5000 || candidates.length === 40, elements: candidates };
    }
    function media(query) {
        try { return matchMedia(query).matches; } catch (_) { return null; }
    }
    function probeDimensions() {
        const probe = document.createElement('sentinela-statusbar-measurement');
        probe.setAttribute('aria-hidden', 'true');
        probe.style.cssText = 'all:initial!important;position:fixed!important;display:block!important;top:0!important;left:-10000px!important;width:1px!important;min-height:0!important;max-height:none!important;padding:0!important;border:0!important;margin:0!important;visibility:hidden!important;pointer-events:none!important;box-sizing:content-box!important;';
        const dimensions = { units: {}, safeAreas: {} };
        try {
            (document.body || document.documentElement).append(probe);
            for (const unit of ['vh', 'svh', 'lvh', 'dvh']) {
                const value = '100' + unit;
                dimensions.units[unit] = CSS.supports('height', value) ? (() => {
                    probe.style.setProperty('height', value, 'important');
                    return finite(probe.getBoundingClientRect().height);
                })() : null;
            }
            probe.style.setProperty('height', 'auto', 'important');
            probe.style.setProperty('bottom', '0', 'important');
            dimensions.units.fixedEdges = rectangle(probe);
            probe.style.setProperty('bottom', 'auto', 'important');
            for (const edge of ['top', 'right', 'bottom', 'left']) {
                for (const max of [false, true]) {
                    const name = 'safe-area-' + (max ? 'max-' : '') + 'inset-' + edge;
                    probe.style.setProperty('height', 'env(' + name + ', 0px)', 'important');
                    dimensions.safeAreas[name] = finite(probe.getBoundingClientRect().height);
                }
            }
        } finally { probe.remove(); }
        return dimensions;
    }
    function serviceWorkerIdentity(worker) {
        return worker ? { script: pathOnly(worker.scriptURL), state: worker.state } : null;
    }
    function requestVersion(worker) {
        if (!worker || typeof MessageChannel !== 'function') return Promise.resolve(null);
        return new Promise(resolve => {
            const channel = new MessageChannel();
            let settled = false;
            const finish = result => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                channel.port1.close();
                channel.port2.close();
                resolve(result);
            };
            const timer = setTimeout(() => finish({ status: 'timeout' }), 1800);
            channel.port1.onmessage = ({ data }) => {
                if (data?.type !== 'APP_VERSION') return;
                finish({
                    status: 'received', version: label(data.version, 80),
                    installedVersion: label(data.installedVersion, 80),
                    shell: label(data.shell, 100), ready: data.ready === true
                });
            };
            channel.port1.onmessageerror = () => finish({ status: 'message-error' });
            try { worker.postMessage({ action: 'GET_APP_VERSION' }, [channel.port2]); }
            catch (_) { finish({ status: 'unavailable' }); }
        });
    }
    function bounded(promise, milliseconds) {
        return new Promise(resolve => {
            const timer = setTimeout(() => resolve(null), milliseconds);
            Promise.resolve(promise).then(value => { clearTimeout(timer); resolve(value); }, () => { clearTimeout(timer); resolve(null); });
        });
    }
    async function workerSnapshot() {
        if (!('serviceWorker' in navigator)) return { supported: false };
        const controller = navigator.serviceWorker.controller;
        const registration = await bounded(navigator.serviceWorker.getRegistration(), 1000);
        const worker = controller || registration?.active;
        return {
            supported: true, controller: serviceWorkerIdentity(controller),
            scope: pathOnly(registration?.scope),
            active: serviceWorkerIdentity(registration?.active),
            waiting: serviceWorkerIdentity(registration?.waiting),
            installing: serviceWorkerIdentity(registration?.installing),
            version: await requestVersion(worker)
        };
    }
    async function cacheAudit(worker) {
        const shell = worker?.version?.shell;
        if (!/^assembleia-2026-integrado-shell-v\d+$/.test(shell || '')) return { status: 'active-shell-unavailable' };
        if (!window.caches || !crypto.subtle) return { status: 'unsupported' };
        const source = [...document.scripts].find(script => /\/shared\/statusbar-diagnostics-data\.js(?:[?#]|$)/.test(script.src))?.src;
        if (!source) return { status: 'project-root-unavailable' };
        const project = new URL('../', source);
        const entries = await Promise.all(['shared/statusbar.js', 'shared/statusbar.css'].map(async path => {
            const url = new URL(path, project);
            if (url.origin !== location.origin) return { path, status: 'different-origin' };
            // CacheStorage.match is read-only; caches.open could create a cache.
            const response = await caches.match(url.href, { cacheName: shell });
            if (!response) return { path, status: 'missing' };
            const result = {
                path, status: 'present', httpStatus: response.status,
                headers: Object.fromEntries(['x-sentinela-app-version', 'x-sentinela-sha256', 'x-sentinela-bytes']
                    .map(name => [name, label(response.headers.get(name), 100)]))
            };
            const limit = 262144;
            if (Number(response.headers.get('x-sentinela-bytes')) > limit || Number(response.headers.get('content-length')) > limit) {
                result.hashStatus = 'size-limit';
                return result;
            }
            if (!response.body?.getReader) { result.hashStatus = 'stream-unavailable'; return result; }
            const reader = response.body.getReader();
            let bytes = 0;
            const chunks = [];
            try {
                while (true) {
                    const next = await reader.read();
                    if (next.done) break;
                    bytes += next.value.byteLength;
                    if (bytes > limit) { await reader.cancel(); result.hashStatus = 'size-limit'; return result; }
                    chunks.push(next.value);
                }
            } finally { reader.releaseLock(); }
            const data = new Uint8Array(bytes);
            let offset = 0;
            for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
            result.bytes = bytes;
            result.sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(byte => byte.toString(16).padStart(2, '0')).join('');
            result.hashStatus = 'computed';
            result.matchesReceipt = result.sha256 === response.headers.get('x-sentinela-sha256');
            return result;
        }));
        return { status: 'measured', shell, entries };
    }

    async function collect(options = {}) {
        const started = performance.now();
        const errors = [];
        const read = (name, callback, fallback = null) => {
            try { return callback(); }
            catch (error) {
                // Error messages may include URLs or user-controlled strings.
                if (errors.length < MAX_ERRORS) errors.push({ field: name, type: label(error?.name || 'Error', 50) });
                return fallback;
            }
        };
        const root = document.documentElement;
        const rootStyle = getComputedStyle(root);
        const visual = window.visualViewport;
        const report = {
            schemaVersion: SCHEMA_VERSION,
            diagnosticVersion: label(options.diagnosticVersion, 80),
            mode: label(options.mode || 'baseline', 60),
            collectedAt: new Date().toISOString(),
            limitations: ['native-statusbar-not-observable-from-dom', 'visual-result-needs-device-observation', 'point-stacks-exclude-pointer-events-none'],
            device: {
                userAgent: label(navigator.userAgent, 500), platform: label(navigator.platform, 80),
                maxTouchPoints: navigator.maxTouchPoints, devicePixelRatio: finite(devicePixelRatio),
                navigatorStandalone: navigator.standalone === true,
                displayModes: Object.fromEntries(['standalone', 'fullscreen', 'minimal-ui', 'browser']
                    .map(mode => [mode, media('(display-mode: ' + mode + ')')])),
                dark: media('(prefers-color-scheme: dark)'),
                reducedMotion: media('(prefers-reduced-motion: reduce)'),
                reducedTransparency: media('(prefers-reduced-transparency: reduce)'),
                screen: Object.fromEntries(['width', 'height', 'availWidth', 'availHeight', 'colorDepth', 'pixelDepth']
                    .map(key => [key, finite(screen[key])])),
                orientation: { type: label(screen.orientation?.type), angle: finite(screen.orientation?.angle ?? window.orientation) }
            },
            viewport: {
                innerWidth, innerHeight, outerWidth, outerHeight,
                scrollX: finite(scrollX), scrollY: finite(scrollY),
                clientWidth: root.clientWidth, clientHeight: root.clientHeight,
                visual: visual ? Object.fromEntries(['width', 'height', 'offsetTop', 'offsetLeft', 'pageTop', 'pageLeft', 'scale']
                    .map(key => [key, finite(visual[key])])) : null
            },
            document: {
                location: pathOnly(location.href), readyState: document.readyState,
                visibilityState: document.visibilityState, fullscreen: !!document.fullscreenElement,
                userActivation: navigator.userActivation ? {
                    isActive: navigator.userActivation.isActive,
                    hasBeenActive: navigator.userActivation.hasBeenActive
                } : null,
                scrollingElement: identity(document.scrollingElement),
                rootAttributes: Object.fromEntries(['appStatusbar', 'nativeStatusbar', 'statusbarSurface', 'theme', 'fontSizeGlobal']
                    .map(key => [key, label(root.dataset[key], 100)])),
                statusbarModule: {
                    present: !!window.AppStatusBar,
                    currentDocument: window.AppStatusBar?.documentRoot === root,
                    revision: label(window.AppStatusBar?.revision || window.AppStatusBar?.version, 80)
                },
                css: Object.fromEntries(['--app-statusbar-height', '--statusbar-build', '--safe-top', '--font-base-global']
                    .map(key => [key, cssValue(rootStyle.getPropertyValue(key).trim())])),
                meta: Object.fromEntries(['app-version', 'viewport', 'apple-mobile-web-app-capable', 'apple-mobile-web-app-status-bar-style', 'theme-color']
                    .map(name => [name, [...document.querySelectorAll('meta[name="' + name + '"]')].map(meta => ({ content: label(meta.content, 250), media: label(meta.media, 100) }))]))
            },
            elements: Object.fromEntries(Object.entries(ELEMENTS)
                .map(([name, selector]) => [name, read('elements.' + name, () => elementSnapshot(document.querySelector(selector), name === 'strip' || /Header$/.test(name)))])),
            headerTextRectangles: Object.fromEntries(['articleHeader', 'bibleHeader', 'studyHeader']
                .map(name => [name, read('headerTextRectangles.' + name, () => headerTextRectangles(document.querySelector(ELEMENTS[name])))])),
            topCandidates: read('topCandidates', topCandidates),
            pseudoElements: read('pseudoElements', () => ({
                bodyBefore: document.body ? styleSnapshot(document.body, '::before') : null,
                bodyAfter: document.body ? styleSnapshot(document.body, '::after') : null
            })),
            stylesheets: read('stylesheets', () => [...document.querySelectorAll('link[rel="stylesheet"]')].slice(0, 80).map(link => ({
                path: pathOnly(link.href), disabled: link.disabled, sheetPresent: !!link.sheet,
                media: label(link.media, 100),
                rules: read('stylesheetRules', () => link.sheet?.cssRules.length ?? null)
            }))),
            scripts: read('scripts', () => [...document.scripts]
                .filter(script => /\/(?:shared\/(?:statusbar[^/]*|typography)|navbar\/navbar-unified|sentinela\/artigos\/(?:article-runtime|reading-position))\.js(?:[?#]|$)/.test(script.src))
                .map(script => ({ path: pathOnly(script.src), async: script.async, defer: script.defer }))),
            resources: read('resources', () => performance.getEntriesByType('resource')
                .filter(entry => /\/shared\/statusbar[^/]*\.(?:css|js)(?:[?#]|$)/.test(entry.name))
                .slice(-16).map(entry => ({ path: pathOnly(entry.name), type: entry.initiatorType, startTime: finite(entry.startTime), duration: finite(entry.duration) }))),
            pointStacks: read('pointStacks', () => {
                const xs = [...new Set([1, Math.floor(innerWidth / 2), Math.max(1, innerWidth - 2)])];
                const ys = [0, 4, 12, 24, 48, 64].filter(y => y < innerHeight);
                return xs.flatMap(x => ys.map(y => ({ x, y, elements: document.elementsFromPoint(x, y).slice(0, 8).map(identity) })));
            }),
            errors
        };
        Object.assign(report, read('probes', probeDimensions, { units: null, safeAreas: null }));
        try { report.serviceWorker = await workerSnapshot(); }
        catch (error) {
            report.serviceWorker = { supported: true, status: 'unavailable' };
            if (errors.length < MAX_ERRORS) errors.push({ field: 'serviceWorker', type: label(error?.name || 'Error', 50) });
        }
        try { report.cacheAudit = await bounded(cacheAudit(report.serviceWorker), 2500) || { status: 'timeout' }; }
        catch (error) {
            report.cacheAudit = { status: 'unavailable' };
            if (errors.length < MAX_ERRORS) errors.push({ field: 'cacheAudit', type: label(error?.name || 'Error', 50) });
        }
        report.durationMs = finite(performance.now() - started);
        return report;
    }

    window.StatusbarDiagnosticsData = Object.freeze({ schemaVersion: SCHEMA_VERSION, collect });
})();
