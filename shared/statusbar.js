/* Give iOS a real opaque edge on internal screens, even when safe-area-top is 0.
 * Metadata alone does not control the native status-area blur in installed PWAs.
 */
(function initStatusBar() {
    'use strict';
    const root = document.documentElement;
    if (window.AppStatusBar?.documentRoot === root) {
        window.AppStatusBar.refresh();
        return;
    }

    const source = document.currentScript?.src || Array.from(document.scripts)
        .find(script => /\/shared\/statusbar\.js(?:[?#]|$)/.test(script.src))?.src;
    if (!source) return;
    const project = new URL('../', source);
    const home = location.origin === project.origin &&
        [new URL('estudos.html', project).pathname].includes(location.pathname);
    const path = location.pathname.slice(project.pathname.length);
    const surface = path.startsWith('biblia/') ? 'bible' :
        path.startsWith('richtext/') ? 'notes' :
        path.startsWith('save/') ? 'save' :
        path.startsWith('sentinela/artigos/') ? 'article' :
        path === 'atualizar.html' ? 'recovery' :
        (path === '' || path === 'index.html') ? 'assembly' : 'default';
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const standalone = window.matchMedia('(display-mode: standalone)');
    let bodyObserver;

    function syncAssemblyChrome() {
        if (surface !== 'assembly' || document.documentElement !== root) return;
        const heading = document.querySelector('.assembly-heading');
        if (!heading) return;
        // Use the painted header colour for native browser/PWA chrome too.
        // Convert color-mix() to a plain hex colour for older iOS metadata parsers.
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d');
        if (!context) return;
        context.fillStyle = getComputedStyle(heading).backgroundColor;
        context.fillRect(0, 0, 1, 1);
        const rgba = context.getImageData(0, 0, 1, 1).data;
        if (rgba[3] !== 255) return;
        const colour = '#' + Array.from(rgba.slice(0, 3), value => value.toString(16).padStart(2, '0')).join('');
        let meta = document.querySelector('meta[name="theme-color"]');
        if (!meta) {
            meta = document.createElement('meta');
            meta.name = 'theme-color';
            document.head.append(meta);
        }
        if (meta.content !== colour) meta.content = colour;
    }

    function mount() {
        if (document.documentElement !== root || !document.body) return;
        bodyObserver?.disconnect();
        if (root.dataset.nativeStatusbar !== 'solid') return;
        if (!document.getElementById('app-solid-statusbar')) {
            const strip = document.createElement('div');
            strip.id = 'app-solid-statusbar';
            strip.setAttribute('aria-hidden', 'true');
            document.body.prepend(strip);
        }
    }

    function refresh() {
        if (document.documentElement !== root) return;
        // Native chrome is not a per-page blur setting. In particular, requesting
        // black-translucent on the launch page can affect the installed PWA even
        // after navigating to a document declaring default. Leave this deprecated
        // key absent everywhere; the home-only material remains in styles.css.
        for (const meta of document.head.querySelectorAll('meta[name]')) {
            if (meta.name.toLowerCase() === 'apple-mobile-web-app-status-bar-style') meta.remove();
        }
        root.dataset.appStatusbar = home ? 'home' : 'solid';
        root.dataset.statusbarSurface = surface;
        if (!home && ios && (navigator.standalone === true || standalone.matches)) {
            // Set this in the head so the header reserves its inset before paint.
            root.dataset.nativeStatusbar = 'solid';
            mount();
            if (!document.body && !bodyObserver) {
                bodyObserver = new MutationObserver(mount);
                bodyObserver.observe(root, { childList: true });
            }
        } else {
            delete root.dataset.nativeStatusbar;
            document.getElementById('app-solid-statusbar')?.remove();
        }
        syncAssemblyChrome();
    }

    window.AppStatusBar = { documentRoot: root, revision: 'ass26-2026.11.07.2', refresh };
    refresh();
    window.addEventListener('pageshow', refresh);
    standalone.addEventListener('change', refresh);
    if (surface === 'assembly') {
        const appearanceObserver = new MutationObserver(syncAssemblyChrome);
        appearanceObserver.observe(root, { attributes: true, attributeFilter: ['style', 'data-theme'] });
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', syncAssemblyChrome, { once: true });
        else syncAssemblyChrome();
    }

    // Opt-in measurements run on the affected page, inside the same installed app.
    if (new URLSearchParams(location.search).get('diagnostico') === 'statusbar') {
        const stylesheet = document.createElement('link');
        stylesheet.rel = 'stylesheet';
        stylesheet.href = new URL('shared/statusbar-diagnostics.css', project).href;
        const script = document.createElement('script');
        script.src = new URL('shared/statusbar-diagnostics.js', project).href;
        let settled = false;
        root.dataset.statusbarDiagnosticLoader = 'loading';
        const timeout = setTimeout(failed, 10000);
        function failed() {
            if (settled || document.documentElement !== root) return;
            settled = true; clearTimeout(timeout);
            root.dataset.statusbarDiagnosticLoader = 'error';
            const show = () => {
                if (document.documentElement !== root) return;
                const message = document.createElement('div');
                message.setAttribute('role', 'alert');
                message.style.cssText = 'position:fixed;bottom:20px;left:12px;right:12px;z-index:2147483600;padding:18px;background:#fff;color:#222;border:1px solid #777;border-radius:12px;font:16px/1.5 system-ui';
                message.textContent = 'O diagnóstico não carregou. ';
                const retry = document.createElement('a');
                retry.href = new URL('atualizar.html', project).href;
                retry.textContent = 'Verifique a atualização e tente novamente.';
                message.append(retry); document.body.append(message);
            };
            if (document.body) show(); else document.addEventListener('DOMContentLoaded', show, { once: true });
        }
        stylesheet.onerror = script.onerror = failed;
        stylesheet.onload = () => { if (!settled && document.documentElement === root) document.head.append(script); };
        script.onload = () => {
            if (settled || document.documentElement !== root) return;
            settled = true; clearTimeout(timeout); root.dataset.statusbarDiagnosticLoader = 'ready';
        };
        document.head.append(stylesheet);
    }
})();
