/* One reading-size preference for every page, including restored/offline articles. */
(function initSharedTypography() {
    'use strict';
    if (window.GlobalFontScale?.version === 3 && window.GlobalFontScale.documentRoot === document.documentElement) {
        window.GlobalFontScale.refresh();
        return;
    }

    const STORAGE_KEY = 'tamanho-fonte-global';
    const DEFAULT_SIZE = 19.36;
    const DEFAULT_LEVEL = 3;
    const LEVEL_COUNT = 11;
    // Preserve the existing proportions of headings/UI, including the 30px maximum.
    const DESIGN_BASE_SIZE = 16;
    const MAX_SIZE = 30;
    const LEVEL_RATIO = Math.pow(MAX_SIZE / DEFAULT_SIZE, 1 / (LEVEL_COUNT - DEFAULT_LEVEL));
    const LEVEL_SIZES = Object.freeze(Array.from({ length: LEVEL_COUNT }, (_, index) =>
        Number((DEFAULT_SIZE * Math.pow(LEVEL_RATIO, index + 1 - DEFAULT_LEVEL)).toFixed(2))
    ));
    const MIN_SIZE = LEVEL_SIZES[0];
    const root = document.documentElement;
    let currentSize = DEFAULT_SIZE;

    function validNumber(value) {
        if (value == null || String(value).trim() === '') return null;
        const number = Number(value);
        return Number.isFinite(number) && number > 0 ? number : null;
    }

    function levelForSize(value) {
        const number = validNumber(value);
        if (number === null) return DEFAULT_LEVEL;
        return LEVEL_SIZES.reduce((nearest, size, index) =>
            Math.abs(size - number) < Math.abs(LEVEL_SIZES[nearest] - number) ? index : nearest, 0
        ) + 1;
    }

    function sizeForLevel(value) {
        const number = value == null || String(value).trim() === '' ? NaN : Number(value);
        const level = Math.max(1, Math.min(LEVEL_COUNT, Math.round(Number.isFinite(number) ? number : DEFAULT_LEVEL)));
        return LEVEL_SIZES[level - 1];
    }

    function clamp(value) {
        return sizeForLevel(levelForSize(value));
    }

    function readPreference(migrateLegacy) {
        try {
            const saved = validNumber(localStorage.getItem(STORAGE_KEY));
            // Older versions stored arbitrary pixel sizes. Keep the nearest level,
            // using the same key so backup/sync continue to carry the preference.
            if (saved !== null) return clamp(saved);
            // Only migrate on startup. Removing the global preference resets its size.
            if (migrateLegacy) {
                const legacy = validNumber(localStorage.getItem('jwpub-font'));
                if (legacy !== null) return clamp(legacy);
            }
            return DEFAULT_SIZE;
        } catch (error) {
            return currentSize;
        }
    }

    function persist(size) {
        try {
            if (localStorage.getItem(STORAGE_KEY) !== String(size)) {
                localStorage.setItem(STORAGE_KEY, String(size));
            }
        } catch (error) { /* The control still works for this page if storage is unavailable. */ }
    }

    function apply(size, announce = true) {
        const nextSize = clamp(size);
        const changed = nextSize !== currentSize;
        currentSize = nextSize;
        // Home and account screens keep their interface sizing. The reading
        // preference remains saved so returning to an article restores its level.
        const interfaceOnly = root.dataset.fontScope === 'interface';
        const displaySize = interfaceOnly ? DESIGN_BASE_SIZE : nextSize;
        const properties = {
            '--tamanho-fonte': `${displaySize}px`,
            '--font-base-default': String(DESIGN_BASE_SIZE),
            '--font-base-global': `${displaySize}px`,
            '--font-scale-global': String(displaySize / DESIGN_BASE_SIZE),
            '--read-size': `${nextSize}px`
        };
        Object.entries(properties).forEach(([name, value]) => {
            if (root.style.getPropertyValue(name) !== value) root.style.setProperty(name, value);
        });
        root.dataset.fontSizeGlobal = String(nextSize);
        root.dataset.fontLevelGlobal = String(levelForSize(nextSize));
        root.classList.toggle('large-reading-text', !interfaceOnly && nextSize >= 25);
        if (announce) window.dispatchEvent(new CustomEvent('globalfont:changed', {
            detail: { size: nextSize, level: levelForSize(nextSize), scale: nextSize / DESIGN_BASE_SIZE }
        }));
        // Existing navigation and reader overlays measure their position on resize.
        if (changed) requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
        return nextSize;
    }

    window.GlobalFontScale = {
        version: 3,
        documentRoot: root,
        storageKey: STORAGE_KEY,
        defaultSize: DEFAULT_SIZE,
        defaultLevel: DEFAULT_LEVEL,
        minLevel: 1,
        maxLevel: LEVEL_COUNT,
        levelSizes: LEVEL_SIZES,
        minSize: MIN_SIZE,
        maxSize: MAX_SIZE,
        clamp,
        levelForSize,
        sizeForLevel,
        getSize: () => currentSize,
        getLevel: () => levelForSize(currentSize),
        setLevel(level) { return this.setSize(sizeForLevel(level)); },
        setSize(size) {
            const nextSize = clamp(size);
            persist(nextSize);
            return apply(nextSize);
        },
        reset() { return this.setSize(DEFAULT_SIZE); },
        refresh() { return apply(readPreference(false)); }
    };

    const initialSize = readPreference(true);
    persist(initialSize);
    apply(initialSize, false);
    window.addEventListener('storage', (event) => {
        if (event.key === STORAGE_KEY || event.key === null) apply(readPreference(false));
    });
    window.addEventListener('pageshow', () => window.GlobalFontScale.refresh());
    document.addEventListener('DOMContentLoaded', () => window.GlobalFontScale.refresh(), { once: true });
})();
