(function initNetworkSensor() {
    function updateNetworkStatus() {
        const isOnline = navigator.onLine;
        
        const iaButtons = document.querySelectorAll('.btn-gerar-ia, .agente-btn--primario');
        iaButtons.forEach(btn => {
            if (!isOnline) {
                if (btn.dataset.wasDisabled === undefined) {
                    btn.dataset.wasDisabled = btn.disabled;
                }
                btn.disabled = true;
                btn.style.opacity = '0.4';
                btn.style.filter = 'grayscale(100%)';
            } else {
                if (btn.dataset.wasDisabled === 'false' || btn.dataset.wasDisabled === undefined) {
                    btn.disabled = false;
                }
                btn.style.opacity = '1';
                btn.style.filter = 'none';
            }
        });

        if (!isOnline) {
            document.body.classList.add('is-offline');
            if (window.AutoSaveManager) window.AutoSaveManager.isPaused = true;
        } else {
            document.body.classList.remove('is-offline');
            if (window.AutoSaveManager) {
                window.AutoSaveManager.isPaused = false;
                window.AutoSaveManager.forceAutoSave();
            }
        }
    }

    window.addEventListener('online', updateNetworkStatus);
    window.addEventListener('offline', updateNetworkStatus);
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', updateNetworkStatus);
    } else {
        updateNetworkStatus();
    }

    const observer = new MutationObserver(() => {
        if (!navigator.onLine) updateNetworkStatus();
    });
    
    if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            observer.observe(document.body, { childList: true, subtree: true });
        });
    }
})();