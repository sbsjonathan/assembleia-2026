/* Cached article documents may predate the shared head include. */
(function loadSharedTypography() {
    if (window.GlobalFontScale?.version === 3 && window.GlobalFontScale.documentRoot === document.documentElement) {
        window.GlobalFontScale.refresh();
        return;
    }
    const source = document.currentScript?.src || Array.from(document.scripts)
        .find((script) => /navbar-unified\.js(?:[?#]|$)/.test(script.src))?.src;
    if (!source) return;
    const scriptUrl = new URL('../shared/typography.js', source);
    scriptUrl.search = new URL(source).search;
    const stylesheetUrl = new URL('typography.css', scriptUrl);
    stylesheetUrl.search = scriptUrl.search;
    if (!Array.from(document.querySelectorAll('link[rel="stylesheet"]')).some((link) => new URL(link.href).pathname === stylesheetUrl.pathname)) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = stylesheetUrl.href;
        document.head.appendChild(link);
    }
    if (!Array.from(document.scripts).some((script) => script.src && new URL(script.src).pathname === scriptUrl.pathname)) {
        const script = document.createElement('script');
        script.src = scriptUrl.href;
        document.head.appendChild(script);
    }
})();

window.getGlobalWeek = function(paramValue) {
    if (paramValue && /\b(\d{2}-\d{2})\b/.test(String(paramValue))) {
        return String(paramValue).match(/\b(\d{2}-\d{2})\b/)[1];
    }
    if (window.semanaAtual && /\b(\d{2}-\d{2})\b/.test(String(window.semanaAtual))) {
        return String(window.semanaAtual).match(/\b(\d{2}-\d{2})\b/)[1];
    }
    const params = new URLSearchParams(window.location.search);
    const param = params.get('semana');
    if (param && /\b(\d{2}-\d{2})\b/.test(String(param))) {
        return String(param).match(/\b(\d{2}-\d{2})\b/)[1];
    }
    const hoje = new Date();
    const dia = hoje.getDay();
    const diff = dia === 0 ? -6 : 1 - dia;
    const segunda = new Date(hoje);
    segunda.setDate(hoje.getDate() + diff);
    const dd = String(segunda.getDate()).padStart(2, '0');
    const mm = String(segunda.getMonth() + 1).padStart(2, '0');
    return `${dd}-${mm}`;
};

const NAVBAR_SCRIPT_SRC = (() => {
    const current = document.currentScript && document.currentScript.src;
    if (current) return current;
    const scripts = Array.from(document.scripts ||[]);
    const ownScript = scripts.find(script => /navbar-unified\.js(?:\?|#|$)/.test(script.src || ''));
    return ownScript ? ownScript.src : '';
})();

function getProjectRootURL() {
    try {
        if (NAVBAR_SCRIPT_SRC) {
            return new URL('../', NAVBAR_SCRIPT_SRC).href;
        }
    } catch (error) {}

    const originPath = window.location.origin + window.location.pathname;
    const knownFolders =['/biblia/', '/richtext/', '/sentinela/', '/save/', '/navbar/'];
    const lower = originPath.toLowerCase();

    for (const folder of knownFolders) {
        const index = lower.indexOf(folder);
        if (index !== -1) {
            return originPath.slice(0, index + 1);
        }
    }

    return new URL('./', window.location.href).href;
}

function joinProjectPath(relativePath) {
    return new URL(relativePath.replace(/^\/+/, ''), getProjectRootURL()).href;
}

// The Assembly always opens the current study, independently of the article or
// notes week that is still in memory. Resolve on each click, including PWA resumes.
window.AssemblyCurrentStudy = Object.freeze({
    date(now = new Date()) {
        // Calendar arithmetic at local noon also works across DST and year changes.
        const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
        monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7);
        return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
    },
    url(now = new Date()) {
        const target = new URL('sentinela/artigos/estudo.html', getProjectRootURL());
        target.searchParams.set('d', this.date(now));
        return target.href;
    }
});

// Older directly opened article documents may predate the shared head include.
(function loadSharedStatusBar() {
    const scriptUrl = new URL('shared/statusbar.js', getProjectRootURL());
    if (NAVBAR_SCRIPT_SRC) scriptUrl.search = new URL(NAVBAR_SCRIPT_SRC).search;
    const stylesheetUrl = new URL('statusbar.css', scriptUrl);
    stylesheetUrl.search = scriptUrl.search;
    if (!document.getElementById('sentinela-statusbar-style') && !Array.from(document.querySelectorAll('link[rel="stylesheet"]')).some((link) => new URL(link.href).pathname === stylesheetUrl.pathname)) {
        const link = document.createElement('link');
        link.id = 'sentinela-statusbar-style';
        link.rel = 'stylesheet';
        link.href = stylesheetUrl.href;
        document.head.appendChild(link);
    }
    if (!document.getElementById('sentinela-statusbar-script') && !Array.from(document.scripts).some((script) => script.src && new URL(script.src).pathname === scriptUrl.pathname)) {
        const script = document.createElement('script');
        script.id = 'sentinela-statusbar-script';
        script.src = scriptUrl.href;
        document.head.appendChild(script);
    }
})();

(function initSharedAppIcons() {
    // Change this only when the artwork changes, independently of app releases.
    const ICON_REVISION = 'ass26-4';
    for (const [rel, file, sizes] of [
        ['icon', 'favicon-32.png', '32x32'],
        ['apple-touch-icon', 'apple-touch-icon.png', '180x180']
    ]) {
        const links = Array.from(document.head.querySelectorAll(`link[rel="${rel}"]`));
        const link = links.shift() || document.createElement('link');
        links.forEach(duplicate => duplicate.remove());
        link.rel = rel;
        link.type = 'image/png';
        link.sizes = sizes;
        const href = joinProjectPath(`assets/icons/${file}?v=${ICON_REVISION}`);
        if (link.href !== href) link.href = href;
        if (!link.isConnected) document.head.append(link);
    }
})();

function isIndexPageNavbar() {
    const path = window.location.pathname.toLowerCase();
    return path.includes('index.html') || path.endsWith('/estudos.html') || path === '/' || path.endsWith('/');
}

function buildIndexEmBreveURL(semana) {
    const url = new URL('estudos.html', getProjectRootURL());
    if (semana) url.searchParams.set('semana', semana);
    url.searchParams.set('estado', 'em-breve');
    return url.href;
}

async function urlExiste(url) {
    try {
        const response = await fetch(url, {
            method: "GET",
            cache: "no-store",
            credentials: "same-origin"
        });

        if (!response.ok) return false;

        const finalURL = String(response.url || "").toLowerCase();
        if (finalURL.includes("/404") || finalURL.endsWith("404.html")) return false;

        const html = await response.text();
        const sample = html.slice(0, 7000).toLowerCase();

        if (sample.includes("page not found") || sample.includes("file not found")) return false;
        if (sample.includes("github pages") && sample.includes("404")) return false;

        return /data-estudo=["\x27]?\d{2}-\d{2}/i.test(html)
            || /<title>\s*a sentinela\s*<\/title>/i.test(html)
            || /--cor-principal-estudo/i.test(html);
    } catch (error) {
        return false;
    }
}

class UnifiedNavbar {
    constructor() {
        this.navbar = null;
        this.lastScrollY = 0;
        this.isHidden = false;
        this.isKeyboardOpen = false;
        this.editableFocado = false;
        this.currentPage = this.detectCurrentPage();
        this._syncRaf = 0;
        this._metricsRaf = 0;
        this._resizeObserver = null;
        this._metricsListeners = [];
        this._imageViewerSnapshot = null;
        this._imageViewerSuspended = false;
        this._imageViewerReleaseFrame = 0;
        this._lastToolbarReserved = false;
        
        this.init();
    }

    init() {
        this.addBodyClass();
        this.createNavbar();
        this.setupBottomMetrics();
        this.updateActiveState();
        this.updateSaveButtonVisual();
        this.setupScrollBehavior();
        this.setupKeyboardBehavior();
        this.setupNavigation();
        this.setupImageViewerBehavior();
        this._referenceContextHandler = () => {
            this.currentPage = this.detectCurrentPage();
            this.updateActiveState();
        };
        document.addEventListener('sentinela:reference-context', this._referenceContextHandler);
        this.finishInitialPaint();
    }

    finishInitialPaint() {
        if (!this.navbar) return;
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                this.navbar.classList.remove('booting');
            });
        });
    }

    detectCurrentPage() {
        if (document.body.dataset.studyReferenceContext === 'article') return 'watchtower';
        const path = window.location.pathname.toLowerCase();
        if (path.endsWith('/estudos.html')) return 'watchtower';
        if (path.includes('index.html') || path === '/' || path.endsWith('/')) return 'home';
        if (path.includes('biblia') || path.includes('livro') || path.includes('capitulo')) return 'bible';
        if (path.includes('richtext') || path.includes('anotacoes') || path.includes('container')) return 'notes';
        if (path.includes('sentinela') || path.includes('em-breve')) return 'watchtower';
        if (path.includes('save') || path.includes('auth')) return 'save';
        return 'home';
    }

    createNavbar() {
        const existingNav = document.querySelector('.bottom-navbar');
        if (existingNav && this.isReusableNavbar(existingNav)) {
            existingNav.classList.add('booting');
            this.navbar = existingNav;
            return;
        }

        if (existingNav) existingNav.remove();
        document.body.insertAdjacentHTML('beforeend', this.buildNavbarHTML());
        this.navbar = document.querySelector('.bottom-navbar');
    }

    isReusableNavbar(navbar) {
        if (!navbar) return false;
        return navbar.querySelectorAll('.navbar-item[data-page]').length === 5;
    }

    getFallbackNavbarHeight() {
        return document.body.classList.contains('is-pwa') ? 52 : 70;
    }

    measureElementHeight(element, fallback = 0) {
        if (!element) return fallback;
        const rect = element.getBoundingClientRect();
        const height = Math.round(rect.height || 0);
        return height > 0 ? height : fallback;
    }

    setupBottomMetrics() {
        this.syncBottomMetrics(true);

        const sync = () => this.syncBottomMetrics();
        window.addEventListener('resize', sync, { passive: true });
        window.addEventListener('orientationchange', sync, { passive: true });
        this._metricsListeners.push(['resize', sync], ['orientationchange', sync]);

        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', sync, { passive: true });
            window.visualViewport.addEventListener('scroll', sync, { passive: true });
        }

        if ('ResizeObserver' in window) {
            this._resizeObserver = new ResizeObserver(sync);
            if (this.navbar) this._resizeObserver.observe(this.navbar);
            const toolbar = document.getElementById('kbdToolbar');
            if (toolbar) this._resizeObserver.observe(toolbar);
        }
    }

    syncBottomMetrics(immediate = false) {
        const apply = () => {
            this._metricsRaf = 0;
            if (this._imageViewerSuspended) return;
            const root = document.documentElement;
            const navHeight = this.measureElementHeight(this.navbar, this.getFallbackNavbarHeight());
            const toolbar = document.getElementById('kbdToolbar');
            const toolbarHeight = this.measureElementHeight(toolbar, 68);
            const reservedToolbarMode = this.isToolbarReservedMode();
            const navVisible = Boolean(this.navbar && !this.isHidden && !this.isKeyboardOpen && !reservedToolbarMode);
            const navReserved = Boolean(this.navbar && !this.isKeyboardOpen && !reservedToolbarMode);
            const occupiedBottom = navVisible ? navHeight : 0;
            const layoutBottom = navReserved ? navHeight : 0;

            root.style.setProperty('--navbar-real-height', `${navHeight}px`);
            root.style.setProperty('--navbar-occupied-bottom', `${occupiedBottom}px`);
            root.style.setProperty('--navbar-layout-bottom', `${layoutBottom}px`);
            root.style.setProperty('--kbd-toolbar-real-height', `${toolbarHeight}px`);

            document.body.classList.toggle('navbar-is-visible', navVisible);
            document.body.classList.toggle('navbar-is-hidden', !navVisible);
        };

        if (immediate) {
            apply();
            return;
        }

        if (this._metricsRaf) return;
        this._metricsRaf = requestAnimationFrame(apply);
    }

    buildNavbarHTML() {
        return `
            <nav class="bottom-navbar booting" data-context="navbar-context-${this.currentPage}">
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
                <a href="#" class="navbar-item" data-page="watchtower" onclick="irParaSentinela(event)">
                    <div class="navbar-icon icon-watchtower"></div>
                    <span class="navbar-label">A Sentinela</span>
                </a>
                <a href="#" class="navbar-item" data-page="save" onclick="irParaSalvar(event)">
                    <div class="navbar-icon icon-save"></div>
                    <span class="navbar-label">Salvar</span>
                </a>
            </nav>
        `;
    }

    setupScrollBehavior() {
        window.addEventListener('scroll', () => this.onScroll(), { passive: true });
    }

    onScroll() {
        if (this.isKeyboardOpen || this._imageViewerSnapshot) return;
        const currentScrollY = window.scrollY;
        // A scroll-lock restoration may dispatch again at the same position.
        if (Math.abs(currentScrollY - this.lastScrollY) < 1) return;
        if (currentScrollY > this.lastScrollY && currentScrollY > 10) {
            this.hideNavbar('scroll');
        } else {
            this.showNavbar();
        }
        this.lastScrollY = currentScrollY <= 0 ? 0 : currentScrollY;
    }

    hideNavbar(reason = 'scroll') {
        if (this._imageViewerSnapshot) return;
        // Keep the programme navigation available while reading any of its tabs.
        // Editing still follows the keyboard, independently of scroll direction.
        if (reason === 'scroll' && document.body.classList.contains('assembly-home')) return;
        if (reason === 'scroll' && document.body.hasAttribute('data-bible-reader')) return;
        if (reason === 'scroll' && !document.documentElement.dataset.programYear && ['home', 'notes', 'save'].includes(this.currentPage)) {
            return;
        }
        if (!this.isHidden && this.navbar) {
            this.navbar.classList.add('hidden');
            this.isHidden = true;
        }
    }

    showNavbar() {
        if (this.isKeyboardOpen || this._imageViewerSnapshot) return;
        if (this.isToolbarReservedMode()) {
            this.syncBottomMetrics();
            return;
        }
        if (this.isHidden && this.navbar) {
            this.navbar.classList.remove('hidden');
            this.isHidden = false;
        }
    }

    isReaderMode() {
        return document.body.classList.contains('leitor-keep-toolbar');
    }

    isZombieToolbarMode() {
        return document.body.classList.contains('zombie-toolbar-active');
    }

    isToolbarReservedMode() {
        return this.isReaderMode() || this.isZombieToolbarMode();
    }

    keyboardOpenByViewport() {
        if (this.editableFocado) return true;
        if (window.visualViewport) {
            return (window.innerHeight - window.visualViewport.height) > 120;
        }
        return this.isKeyboardOpen;
    }

    syncBottomUI() {
        if (this._syncRaf || this._imageViewerSnapshot) return;
        this._syncRaf = requestAnimationFrame(() => {
            this._syncRaf = 0;
            if (this._imageViewerSnapshot) return;
            const wasKeyboardOpen = this.isKeyboardOpen;
            const wasToolbarReserved = this._lastToolbarReserved;
            this.isKeyboardOpen = this.keyboardOpenByViewport();
            this._lastToolbarReserved = this.isToolbarReservedMode();
            if (this.isKeyboardOpen || this._lastToolbarReserved) {
                this.hideNavbar('keyboard');
            } else if (wasKeyboardOpen || wasToolbarReserved) {
                // Body classes, viewport settling and focus moving between
                // non-editable controls must not undo a scroll-hidden navbar.
                this.showNavbar();
            }
            this.syncBottomMetrics();
        });
    }

    setupKeyboardBehavior() {
        const sync = () => this.syncBottomUI();

        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', sync, { passive: true });
            window.visualViewport.addEventListener('scroll', sync, { passive: true });
        }

        document.addEventListener('focusin', (e) => {
            const tag = e.target.tagName;
            const textInput = tag === 'INPUT' && !['range', 'color', 'radio', 'checkbox', 'button', 'submit', 'reset', 'file', 'image', 'hidden'].includes(e.target.type);
            if (textInput || tag === 'TEXTAREA' || e.target.isContentEditable) {
                this.editableFocado = true;
                this.isKeyboardOpen = true;
                this.hideNavbar('keyboard');
                this.syncBottomMetrics();
            }
        });

        document.addEventListener('focusout', () => {
            this.editableFocado = false;
            setTimeout(sync, 60);
        });

        const bodyObserver = new MutationObserver(sync);
        bodyObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });

        sync();
    }

    setupNavigation() {
        if (!this.navbar) return;
        this.navbar.addEventListener('click', (e) => {
            const item = e.target.closest('.navbar-item');
            if (!item) return;
            const href = item.getAttribute('href');
            if (href && href !== '#') return;
        });
    }

    setupImageViewerBehavior() {
        this._imageViewerHandler = ({ detail }) => {
            if (detail?.active) {
                cancelAnimationFrame(this._imageViewerReleaseFrame);
                this._imageViewerReleaseFrame = 0;
                // Reopening during the close animation must retain the original
                // article state, not snapshot the temporarily hidden viewer UI.
                this._imageViewerSnapshot ||= {
                    hidden: this.isHidden,
                    keyboardOpen: this.isKeyboardOpen,
                    toolbarReserved: this.isToolbarReservedMode()
                };
                this._imageViewerSuspended = true;
                cancelAnimationFrame(this._syncRaf);
                cancelAnimationFrame(this._metricsRaf);
                this._syncRaf = this._metricsRaf = 0;
                this.navbar?.classList.add('image-viewer-suspended');
                return;
            }
            const snapshot = this._imageViewerSnapshot;
            if (!snapshot) return;
            cancelAnimationFrame(this._imageViewerReleaseFrame);
            // The image viewer has already restored the body's scroll lock.
            // Settle the underlying navbar while its opaque overlay covers it.
            this.isKeyboardOpen = this.keyboardOpenByViewport();
            this._lastToolbarReserved = this.isToolbarReservedMode();
            this.isHidden = this.isKeyboardOpen || this._lastToolbarReserved ||
                (snapshot.hidden && !snapshot.keyboardOpen && !snapshot.toolbarReserved);
            this.navbar?.classList.toggle('hidden', this.isHidden);
            this.lastScrollY = Math.max(0, window.scrollY);
            this._imageViewerSuspended = false;
            this.syncBottomMetrics(true);
            // Body/viewport observers and the restored scroll can arrive in the
            // next frame. Keep their show/hide actions suspended until drained.
            this._imageViewerReleaseFrame = requestAnimationFrame(() => {
                this._imageViewerReleaseFrame = requestAnimationFrame(() => {
                    this._imageViewerReleaseFrame = 0;
                    if (this._imageViewerSnapshot !== snapshot || this._imageViewerSuspended) return;
                    this.lastScrollY = Math.max(0, window.scrollY);
                    this.navbar?.classList.remove('image-viewer-suspended');
                });
            });
        };
        document.addEventListener('sentinela:image-viewer-state', this._imageViewerHandler);
        this._imageViewerClosedHandler = () => {
            const snapshot = this._imageViewerSnapshot;
            if (!snapshot || this._imageViewerSuspended) return;
            cancelAnimationFrame(this._imageViewerReleaseFrame);
            this._imageViewerReleaseFrame = requestAnimationFrame(() => {
                this._imageViewerReleaseFrame = requestAnimationFrame(() => {
                    this._imageViewerReleaseFrame = 0;
                    if (this._imageViewerSnapshot !== snapshot || this._imageViewerSuspended) return;
                    this.lastScrollY = Math.max(0, window.scrollY);
                    this._imageViewerSnapshot = null;
                    this.navbar?.classList.remove('image-viewer-suspended');
                    this.syncBottomUI();
                });
            });
        };
        document.addEventListener('sentinela:image-viewer-closed', this._imageViewerClosedHandler);
    }

    updateActiveState() {
        if (!this.navbar) return;
        const items = this.navbar.querySelectorAll('.navbar-item');
        items.forEach(item => item.classList.remove('active'));
        const activeItem = this.navbar.querySelector(`[data-page="${this.currentPage}"]`);
        if (activeItem) activeItem.classList.add('active');
        this.navbar.setAttribute('data-context', `navbar-context-${this.currentPage}`);
    }

    addBodyClass() {
        document.body.classList.add('with-bottom-navbar');
        if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true) {
            document.body.classList.add('is-pwa');
        }
    }

    updateSaveButtonVisual() {
        const savedUser = localStorage.getItem('supabase_user');
        const saveButton = this.navbar?.querySelector('[data-page="save"]');
        if (savedUser && saveButton) {
            saveButton.classList.add('logged-in');
        } else if (saveButton) {
            saveButton.classList.remove('logged-in');
        }
    }

    onLoginSuccess(userData) {
        const saveButton = this.navbar?.querySelector('[data-page="save"]');
        if (saveButton) saveButton.classList.add('logged-in');
    }

    onLogout() {
        localStorage.removeItem('supabase_user');
        localStorage.removeItem('last_login');
        const saveButton = this.navbar?.querySelector('[data-page="save"]');
        if (saveButton) saveButton.classList.remove('logged-in');
    }

    setActivePage(page) {
        this.currentPage = page;
        this.updateActiveState();
    }

    destroy() {
        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
            this._resizeObserver = null;
        }

        for (const [eventName, handler] of this._metricsListeners) {
            window.removeEventListener(eventName, handler);
        }
        this._metricsListeners = [];

        document.removeEventListener('sentinela:reference-context', this._referenceContextHandler);
        document.removeEventListener('sentinela:image-viewer-state', this._imageViewerHandler);
        document.removeEventListener('sentinela:image-viewer-closed', this._imageViewerClosedHandler);
        cancelAnimationFrame(this._imageViewerReleaseFrame);

        if (this.navbar) {
            this.navbar.remove();
            this.navbar = null;
        }
        document.body.classList.remove('with-bottom-navbar', 'navbar-is-visible', 'navbar-is-hidden');
        const root = document.documentElement;
        root.style.removeProperty('--navbar-real-height');
        root.style.removeProperty('--navbar-occupied-bottom');
        root.style.removeProperty('--navbar-layout-bottom');
        root.style.removeProperty('--kbd-toolbar-real-height');
    }
}

async function irParaHome(event) {
    if (event) event.preventDefault();
    const appRoot = new URL(getProjectRootURL());
    if ([appRoot.pathname, new URL('index.html', appRoot).pathname].includes(location.pathname)) {
        window.scrollTo({top: 0, behavior: 'smooth'});
        return;
    }
    window.location.href = joinProjectPath('index.html');
}

async function irParaBiblia(event) {
    if (event) event.preventDefault();
    const currentPath = window.location.pathname.toLowerCase();
    if (currentPath.includes('biblia') || currentPath.includes('livro') || currentPath.includes('capitulo')) {
        window.location.href = joinProjectPath('biblia/biblia.html?from=navbar');
    } else {
        window.location.href = joinProjectPath('biblia/biblia.html');
    }
}

async function irParaAnotacoes(event) {
    if (event) event.preventDefault();
    const currentPath = window.location.pathname.toLowerCase();
    if (currentPath.includes('richtext') || currentPath.includes('anotacoes') || currentPath.includes('container')) return;
    window.location.href = joinProjectPath(`richtext/container.html?semana=${window.getGlobalWeek()}`);
}

async function irParaSentinela(event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    const target = new URL(window.AssemblyCurrentStudy.url());
    const current = new URL(window.location.href);
    if (document.body.dataset.studyReferenceContext !== 'article' &&
        current.pathname === target.pathname && current.searchParams.get('d') === target.searchParams.get('d')) {
        return false;
    }

    // A reference screen still has its own Back action for its source article.
    // This navbar destination instead opens this week's article, cache-first.
    window.location.href = target.href;
    return false;
}

window.irParaSentinelaAcao = function() {
    return irParaSentinela(null);
};

async function irParaSalvar(event) {
    if (event) event.preventDefault();
    const currentPath = window.location.pathname.toLowerCase();
    if (currentPath.includes('save') || currentPath.includes('auth')) return;
    window.location.href = joinProjectPath('save/auth-supabase.html');
}

window.UnifiedNavbar = {
    instance: null,
    init(options = {}) {
        if (this.instance) this.instance.destroy();
        this.instance = new UnifiedNavbar(options);
        return this.instance;
    },
    get() {
        return this.instance;
    },
    setActivePage(page) {
        if (this.instance) this.instance.setActivePage(page);
    }
};

function bootUnifiedNavbarWhenPossible() {
    if (!document.body) {
        document.addEventListener('DOMContentLoaded', bootUnifiedNavbarWhenPossible, { once: true });
        return;
    }
    if (!window.UnifiedNavbar.instance) {
        window.UnifiedNavbar.init();
    }
}

bootUnifiedNavbarWhenPossible();

// Suppress repeated navigation taps only. Text selection and its native handles
// must keep their touch events, including double taps in the Bible reader.
let lastNavbarTouchEnd = 0;
document.addEventListener('touchend', function (event) {
    if (!(event.target instanceof Element) || !event.target.closest('.bottom-navbar')) return;
    const now = (new Date()).getTime();
    if (now - lastNavbarTouchEnd <= 300) {
        event.preventDefault();
    }
    lastNavbarTouchEnd = now;
}, { passive: false });

// Reopening an installed iPhone app may resume the page without another load event.
(function manageAppUpdates() {
    if (!('serviceWorker' in navigator)) return;
    const release = 'ass26-2026.11.08.12';
    const root = getProjectRootURL();
    let registration, checking, lastCheck = 0, refreshing = false, navigating = false;
    const pageRelease = document.querySelector('meta[name="app-version"]')?.content || (isIndexPageNavbar() ? 'legacy' : release);
    const versionNode = document.createElement('p');
    versionNode.className = 'app-version';
    versionNode.textContent = 'Conferindo a versão do aplicativo…';
    const offlineSection = document.querySelector('.offline-section');
    if (offlineSection) {
        const update = document.createElement('a');
        update.className = 'btn btn-secondary';
        update.href = new URL('atualizar.html', root).href;
        update.textContent = 'Verificar atualização';
        versionNode.style.cssText = 'font-size:12px;margin:12px 0;color:inherit;opacity:.7';
        offlineSection.append(versionNode, update);
    }
    function askVersion(worker) {
        return new Promise(resolve => {
            if (!worker) return resolve(null);
            const channel = new MessageChannel();
            const timeout = setTimeout(() => { channel.port1.close(); resolve(null); }, 1800);
            channel.port1.onmessage = ({data}) => {
                if (data?.type !== 'APP_VERSION') return;
                clearTimeout(timeout); channel.port1.close(); resolve(data);
            };
            worker.postMessage({action:'GET_APP_VERSION'}, [channel.port2]);
        });
    }
    async function applyVersion() {
        const active = navigator.serviceWorker.controller || registration?.active;
        const info = await askVersion(active);
        if (!info?.ready) { if (offlineSection) versionNode.textContent = 'Versão local: ' + pageRelease; return; }
        if (offlineSection) versionNode.textContent = 'Versão instalada: ' + info.version;
        if (isIndexPageNavbar() && info.version !== pageRelease && !navigating) {
            const destination = new URL(location.href);
            if (destination.searchParams.get('atualizado') !== info.version) {
                navigating = true; destination.searchParams.set('atualizado', info.version);
                location.replace(destination.href); return;
            }
        }
        let refreshed;
        try { refreshed = localStorage.getItem('sentinela-app-refreshed'); } catch (_) {}
        if (!refreshing && refreshed !== info.version && navigator.onLine) {
            refreshing = true; active.postMessage({action:'REFRESH_APP'});
        }
    }
    async function check(force = false) {
        if (checking || (!force && Date.now() - lastCheck < 60000)) return checking;
        lastCheck = Date.now();
        checking = (async () => {
            try {
                registration = await navigator.serviceWorker.register(new URL('sw.js',root), {scope:new URL(root).pathname,updateViaCache:'none'});
                registration.addEventListener('updatefound', () => {
                    const candidate = registration.installing;
                    candidate?.addEventListener('statechange', () => { if (candidate.state === 'activated') applyVersion(); });
                }, {once:true});
                applyVersion();
                if (navigator.onLine) await registration.update();
            } catch (_) { /* Existing local reading is independent of the update network. */ }
        })().finally(() => { checking = null; });
        return checking;
    }
    navigator.serviceWorker.addEventListener('controllerchange', () => { refreshing = false; applyVersion(); });
    navigator.serviceWorker.addEventListener('message', ({data}) => {
        if (data?.type === 'APP_REFRESH_COMPLETE') {
            refreshing = false;
            try { localStorage.setItem('sentinela-app-refreshed', data.version || release); } catch (_) {}
        } else if (data?.type === 'APP_REFRESH_ERROR') refreshing = false;
    });
    addEventListener('pageshow', () => check());
    addEventListener('online', () => check(true));
    document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
    if (document.readyState === 'complete') check(); else addEventListener('load', () => check(), {once:true});
    window.SentinelaAppUpdate = {version:release, check};
})();
