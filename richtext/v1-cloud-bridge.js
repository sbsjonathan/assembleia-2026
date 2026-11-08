/* Keep the immutable v1 editor while using the current app's cloud transport. */
(() => {
    const store = window.cacheRichText;
    if (!store || store.isStored) return;
    // v1's flush returns a snapshot even when localStorage rejected the write.
    // Cloud acknowledgement requires the exact revision to exist on this device.
    store.isStored = snapshot => {
        if (!snapshot) return false;
        try {
            const stored = store.parse(localStorage.getItem(`richtext_cache_${store.semanaAtual()}`));
            return !!stored && store.contentKey(stored) === snapshot.key &&
                (stored.localRevision || null) === (snapshot.payload.localRevision || null);
        } catch (_) { return false; }
    };
})();
