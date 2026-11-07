class ZoomModal {
    constructor() {
        this.container = null; this.header = null; this.content = null; this.footer = null;
        this.image = null; this.closeBtn = null; this.scale = 1; this.translateX = 0; this.translateY = 0;
        this.maxScale = 4; this.minScale = 1; this.initialDistance = 0; this.lastScale = 1;
        this.lastTranslateX = 0; this.lastTranslateY = 0; this.initialTranslateX = 0;
        this.initialTranslateY = 0; this.startX = 0; this.startY = 0; this.focusX = 0; this.focusY = 0;
        this.isMultiTouch = false; this.multiTouchEndTime = 0; this.touchTolerance = 200;
        this.tapStartTime = 0; this.isDragging = false; this.headerVisible = true;
        this.hideTimeout = null; this.savedScrollY = 0;
        this.savedScrollX = 0; this.scrollLocked = false; this.savedBodyTop = null;
        this.isOpen = false; this.isClosing = false; this.lifecycle = 0;
        this.openFrame = null; this.closeFrame = null; this.enterTimer = null; this.closeTimer = null;

        this.lastTapTime = 0;
        this.lastTapX = 0;
        this.lastTapY = 0;
        this.singleTapTimer = null;
        this.transformTimer = null;
        this.doubleTapDelay = 280;
        this.doubleTapDistance = 35;
        this.doubleTapScale = 2.5;

        this.isDismissing = false; this.dismissThreshold = 100;
        this.dismissStartY = 0; this.dismissCurrentY = 0; this.dismissOpacity = 1;

        this.rafId = null; this.velocityX = 0; this.velocityY = 0; this.trackingPoints = [];
        this.FRICTION = 0.96; this.MIN_VELOCITY = 0.3; this.MAX_VELOCITY = 35; this.VELOCITY_MULTIPLIER = 15;

        this.init();
    }

    init() {
        this.container = document.getElementById('zoom-container');
        this.header = this.container?.querySelector('.zoom-header');
        this.content = this.container?.querySelector('.zoom-content');
        this.footer = this.container?.querySelector('.zoom-footer');
        this.closeBtn = this.container?.querySelector('.zoom-btn-fechar');
        if (!this.container) { return; }
        this.container.setAttribute('role', 'dialog');
        this.container.setAttribute('aria-modal', 'true');
        this.container.setAttribute('aria-label', 'Imagem ampliada');
        this.container.setAttribute('aria-hidden', 'true');
        this.setupEventListeners();
        window.abrirZoom = (img) => this.open(img);
    }

    setupEventListeners() {
        if (this.closeBtn) { this.closeBtn.addEventListener('click', () => this.close()); }
        this.content.addEventListener('touchstart', (e) => this.onTouchStart(e), { passive: false });
        this.content.addEventListener('touchmove', (e) => this.onTouchMove(e), { passive: false });
        this.content.addEventListener('touchend', (e) => this.onTouchEnd(e), { passive: false });
        this.content.addEventListener('touchcancel', () => {
            if (!this.isOpen) return;
            this.stopInertia(); this.resetDismiss();
            this.isMultiTouch = false; this.isDragging = false; this.trackingPoints = [];
            this.multiTouchEndTime = Date.now(); this.lastTapTime = 0;
            clearTimeout(this.singleTapTimer);
            this.applyConstraints(); this.updateTransform(); this.startAutoHide();
        });
        this.container.addEventListener('wheel', (e) => { if (this.isOpen || this.isClosing) e.preventDefault(); }, { passive: false });
        this.container.addEventListener('touchmove', (e) => { if (this.isOpen || this.isClosing) e.preventDefault(); }, { passive: false });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen) { e.preventDefault(); this.close(); }
        });
        window.addEventListener('resize', () => {
            if (!this.isOpen) return;
            this.applyConstraints(); this.updateTransform();
        }, { passive: true });
    }

    notifyNavigation(active) {
        document.dispatchEvent(new CustomEvent('sentinela:image-viewer-state', { detail: { active } }));
    }

    cancelLifecycleCallbacks() {
        clearTimeout(this.enterTimer); clearTimeout(this.closeTimer);
        cancelAnimationFrame(this.openFrame); cancelAnimationFrame(this.closeFrame);
        this.enterTimer = this.closeTimer = this.openFrame = this.closeFrame = null;
    }

    releaseScrollLock() {
        if (!this.scrollLocked) return;
        document.body.classList.remove('zoom-active');
        if (this.savedBodyTop?.value) document.body.style.setProperty('top', this.savedBodyTop.value, this.savedBodyTop.priority);
        else document.body.style.removeProperty('top');
        this.scrollLocked = false;
        // Restore the article beneath the still-opaque viewer. A site's smooth
        // scrolling preference must not animate this internal restoration.
        const style = document.documentElement.style;
        const value = style.getPropertyValue('scroll-behavior'), priority = style.getPropertyPriority('scroll-behavior');
        style.setProperty('scroll-behavior', 'auto', 'important');
        window.scrollTo(this.savedScrollX, this.savedScrollY);
        if (value) style.setProperty('scroll-behavior', value, priority);
        else style.removeProperty('scroll-behavior');
    }

    open(imgElement) {
        if (!imgElement || !this.container) return;
        const epoch = ++this.lifecycle;
        this.cancelLifecycleCallbacks();
        if (!this.scrollLocked) {
            this.savedScrollX = window.scrollX;
            this.savedScrollY = window.scrollY;
            this.savedBodyTop = {value:document.body.style.getPropertyValue('top'), priority:document.body.style.getPropertyPriority('top')};
            this.returnFocus = document.activeElement;
        }
        // Freeze navbar state before fixing the body changes window.scrollY.
        this.notifyNavigation(true);
        this.isOpen = true; this.isClosing = false;
        this.reset();
        this.showHeader();
        document.documentElement.classList.remove('zoom-viewer-closing');
        document.documentElement.classList.add('zoom-viewer-open');
        this.container.classList.remove('closing');
        this.container.style.backgroundColor = 'black';

        const image = document.createElement('img');
        image.className = 'zoom-image zoom-enter';
        image.src = imgElement.currentSrc || imgElement.src;
        image.alt = imgElement.alt || '';
        this.image = image;
        if (this.footer) this.footer.textContent = image.alt;
        this.content.replaceChildren(image);

        document.body.style.top = `-${this.savedScrollY}px`;
        document.body.classList.add('zoom-active');
        this.scrollLocked = true;
        this.container.setAttribute('aria-hidden', 'false');
        this.container.classList.add('active');
        this.closeBtn?.focus({preventScroll:true});

        this.openFrame = requestAnimationFrame(() => {
            this.openFrame = null;
            if (epoch !== this.lifecycle || !this.isOpen) return;
            image.classList.add('transition-active');
            image.classList.remove('zoom-enter');
        });
        this.enterTimer = setTimeout(() => {
            if (epoch === this.lifecycle) image.classList.remove('transition-active');
            this.enterTimer = null;
        }, 400);
        this.startAutoHide();
    }

    close() {
        if (!this.isOpen || !this.image) return;
        const epoch = ++this.lifecycle;
        this.isOpen = false; this.isClosing = true;
        this.cancelLifecycleCallbacks();
        this.stopInertia();
        clearTimeout(this.hideTimeout);
        clearTimeout(this.singleTapTimer);
        clearTimeout(this.transformTimer);
        this.container.style.backgroundColor = 'black';
        this.container.classList.add('closing');
        document.documentElement.classList.add('zoom-viewer-closing');

        // Unlock and restore first, while black still covers every pixel. The
        // navbar restores its snapshot synchronously, then drains two frames of
        // scroll/viewport events before this viewer starts revealing the page.
        this.releaseScrollLock();
        this.notifyNavigation(false);
        this.closeFrame = requestAnimationFrame(() => {
            this.closeFrame = requestAnimationFrame(() => {
                this.closeFrame = null;
                if (epoch !== this.lifecycle || !this.isClosing) return;
                this.image.style.opacity = '';
                this.image.classList.add('transition-active', 'zoom-exit');
                this.hideHeader();
                document.documentElement.classList.remove('zoom-viewer-open');
                this.container.classList.remove('active');
                const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 400;
                this.closeTimer = setTimeout(() => {
                    if (epoch !== this.lifecycle || !this.isClosing) return;
                    this.isClosing = false;
                    this.container.classList.remove('closing');
                    this.container.setAttribute('aria-hidden', 'true');
                    document.documentElement.classList.remove('zoom-viewer-closing');
                    this.content.replaceChildren();
                    if (this.footer) this.footer.textContent = '';
                    this.image = null;
                    this.returnFocus?.focus?.({preventScroll:true});
                    document.dispatchEvent(new Event('sentinela:image-viewer-closed'));
                    this.closeTimer = null;
                }, duration);
            });
        });
    }

    reset() {
        this.scale = 1; this.translateX = 0; this.translateY = 0; this.lastScale = 1;
        this.lastTranslateX = 0; this.lastTranslateY = 0; this.isMultiTouch = false;
        this.multiTouchEndTime = 0; this.headerVisible = true;

        this.isDismissing = false; this.dismissCurrentY = 0; this.dismissOpacity = 1;

        this.stopInertia(); this.velocityX = 0; this.velocityY = 0; this.trackingPoints = [];

        clearTimeout(this.singleTapTimer);
        clearTimeout(this.transformTimer);
        this.singleTapTimer = null;
        this.transformTimer = null;
        this.lastTapTime = 0;
        this.lastTapX = 0;
        this.lastTapY = 0;

        if (this.container) {
            this.container.style.backgroundColor = 'black';
        }
    }

    updateTransform() {
        if (this.image) {
            this.image.style.transform = `translate3d(${this.translateX}px, ${this.translateY}px, 0) scale(${this.scale})`;
        }
    }

    animateTransform(duration = 280) {
        if (!this.image) return;

        clearTimeout(this.transformTimer);

        this.image.classList.add('transition-active');
        this.updateTransform();

        this.transformTimer = setTimeout(() => {
            if (this.image) {
                this.image.classList.remove('transition-active');
            }
            this.transformTimer = null;
        }, duration);
    }

    toggleDoubleTapZoom(clientX, clientY) {
        if (!this.image || !this.content) return;

        this.stopInertia();

        if (this.scale > 1.1) {
            this.scale = 1;
            this.translateX = 0;
            this.translateY = 0;
            this.animateTransform();

            this.showHeader();
            this.startAutoHide();
            return;
        }

        const containerRect = this.content.getBoundingClientRect();
        const targetScale = Math.min(this.doubleTapScale, this.maxScale);

        const focusX = clientX - containerRect.left - containerRect.width / 2;
        const focusY = clientY - containerRect.top - containerRect.height / 2;

        const scaleDifference = targetScale - this.scale;

        this.translateX = this.translateX - (focusX * scaleDifference);
        this.translateY = this.translateY - (focusY * scaleDifference);
        this.scale = targetScale;

        this.applyConstraints();
        this.animateTransform();

        this.hideHeader();
    }

    handleTap(e) {
        if (!e.changedTouches || !e.changedTouches[0]) return;
        if (!(e.target === this.content || e.target === this.image)) return;

        const touch = e.changedTouches[0];
        const now = Date.now();
        const x = touch.clientX;
        const y = touch.clientY;

        const timeSinceLastTap = now - this.lastTapTime;
        const distanceFromLastTap = Math.hypot(x - this.lastTapX, y - this.lastTapY);

        if (
            e.target === this.image &&
            timeSinceLastTap > 0 &&
            timeSinceLastTap < this.doubleTapDelay &&
            distanceFromLastTap < this.doubleTapDistance
        ) {
            clearTimeout(this.singleTapTimer);
            this.singleTapTimer = null;
            this.lastTapTime = 0;

            this.toggleDoubleTapZoom(x, y);
            return;
        }

        this.lastTapTime = now;
        this.lastTapX = x;
        this.lastTapY = y;

        clearTimeout(this.singleTapTimer);

        this.singleTapTimer = setTimeout(() => {
            this.toggleHeader();
            this.singleTapTimer = null;
        }, this.doubleTapDelay);
    }

    updateDismissTransform() {
        if (this.image && this.isDismissing) {
            const progress = Math.min(this.dismissCurrentY / this.dismissThreshold, 1);
            const opacity = 1 - (progress * 0.7);

            this.image.style.transform = `translate3d(${this.translateX}px, ${this.translateY + this.dismissCurrentY}px, 0) scale(${this.scale})`;
            this.image.style.opacity = opacity;
            this.container.style.backgroundColor = `rgba(0, 0, 0, ${opacity})`;
        }
    }

    resetDismiss() {
        if (this.image) {
            this.image.style.opacity = '1';
            this.container.style.backgroundColor = 'black';
            this.updateTransform();
        }
        this.isDismissing = false;
        this.dismissCurrentY = 0;
    }

    stopInertia() {
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
    }

    applyConstraints() {
        if (!this.image || !this.content) return;
        const containerRect = this.content.getBoundingClientRect();
        const imgNaturalWidth = this.image.naturalWidth;
        const imgNaturalHeight = this.image.naturalHeight;
        if (imgNaturalWidth === 0) return;
        const imgAspectRatio = imgNaturalWidth / imgNaturalHeight;
        const containerAspectRatio = containerRect.width / containerRect.height;
        let baseWidth, baseHeight;
        if (imgAspectRatio > containerAspectRatio) {
            baseWidth = containerRect.width;
            baseHeight = baseWidth / imgAspectRatio;
        } else {
            baseHeight = containerRect.height;
            baseWidth = baseHeight * imgAspectRatio;
        }
        const scaledWidth = baseWidth * this.scale;
        const scaledHeight = baseHeight * this.scale;

        const maxTranslateX = Math.max(0, (scaledWidth - containerRect.width) / 2);
        const maxTranslateY = Math.max(0, (scaledHeight - containerRect.height) / 2);

        this.translateX = Math.max(-maxTranslateX, Math.min(maxTranslateX, this.translateX));
        this.translateY = Math.max(-maxTranslateY, Math.min(maxTranslateY, this.translateY));
    }

    inertiaLoop() {
        if (Math.abs(this.velocityX) < this.MIN_VELOCITY && Math.abs(this.velocityY) < this.MIN_VELOCITY) {
            this.velocityX = 0;
            this.velocityY = 0;
            return;
        }

        this.translateX += this.velocityX;
        this.translateY += this.velocityY;
        this.velocityX *= this.FRICTION;
        this.velocityY *= this.FRICTION;

        this.applyConstraints();
        this.updateTransform();

        this.rafId = requestAnimationFrame(() => this.inertiaLoop());
    }

    onTouchStart(e) {
        e.preventDefault();
        if (!this.isOpen) return;
        clearTimeout(this.hideTimeout);

        this.stopInertia();

        this.isDragging = false;
        this.tapStartTime = Date.now();
        const currentTime = Date.now();
        const timeSinceMultiTouchEnd = currentTime - this.multiTouchEndTime;

        if (e.touches.length === 2) {
            clearTimeout(this.singleTapTimer);
            this.singleTapTimer = null;

            this.isMultiTouch = true;
            const touch1 = e.touches[0];
            const touch2 = e.touches[1];
            this.initialDistance = Math.hypot(touch2.clientX - touch1.clientX, touch2.clientY - touch1.clientY);
            this.lastScale = this.scale;
            const screenCenterX = (touch1.clientX + touch2.clientX) / 2;
            const screenCenterY = (touch1.clientY + touch2.clientY) / 2;
            const containerRect = this.content.getBoundingClientRect();
            this.focusX = screenCenterX - containerRect.left - containerRect.width / 2;
            this.focusY = screenCenterY - containerRect.top - containerRect.height / 2;
            this.initialTranslateX = this.translateX;
            this.initialTranslateY = this.translateY;
        } else if (e.touches.length === 1) {
            if (timeSinceMultiTouchEnd < this.touchTolerance) return;

            this.startX = e.touches[0].clientX;
            this.startY = e.touches[0].clientY;
            this.lastTranslateX = this.translateX;
            this.lastTranslateY = this.translateY;

            this.trackingPoints = [{
                x: e.touches[0].clientX,
                y: e.touches[0].clientY,
                time: performance.now()
            }];
            this.velocityX = 0;
            this.velocityY = 0;

            if (this.scale <= 1.1) {
                this.dismissStartY = e.touches[0].clientY;
                this.isDismissing = true;
            }
        }
    }

    onTouchMove(e) {
        e.preventDefault();
        if (!this.isOpen) return;
        if (!this.isMultiTouch) {
            this.isDragging = true;
            clearTimeout(this.singleTapTimer);
            this.singleTapTimer = null;
        }
        const currentTime = Date.now();
        const timeSinceMultiTouchEnd = currentTime - this.multiTouchEndTime;

        if (e.touches.length === 2 && this.isMultiTouch) {
            if (this.isDismissing) {
                this.isDismissing = false;
                this.resetDismiss();
            }

            const touch1 = e.touches[0];
            const touch2 = e.touches[1];
            const currentDistance = Math.hypot(touch2.clientX - touch1.clientX, touch2.clientY - touch1.clientY);
            const scaleChange = currentDistance / this.initialDistance;
            const newScale = Math.min(Math.max(this.lastScale * scaleChange, this.minScale), this.maxScale);
            const scaleDifference = newScale - this.lastScale;
            this.translateX = this.initialTranslateX - (this.focusX * scaleDifference);
            this.translateY = this.initialTranslateY - (this.focusY * scaleDifference);
            this.scale = newScale;
            this.applyConstraints();
            this.updateTransform();
        } else if (e.touches.length === 1 && !this.isMultiTouch) {
            if (timeSinceMultiTouchEnd < this.touchTolerance) return;

            const deltaX = e.touches[0].clientX - this.startX;
            const deltaY = e.touches[0].clientY - this.startY;

            const currentX = e.touches[0].clientX;
            const currentY = e.touches[0].clientY;
            this.trackingPoints.push({
                x: currentX,
                y: currentY,
                time: performance.now()
            });
            if (this.trackingPoints.length > 5) this.trackingPoints.shift();

            if (this.isDismissing && this.scale <= 1.1) {
                const dismissDelta = e.touches[0].clientY - this.dismissStartY;

                if (dismissDelta > 0) {
                    this.dismissCurrentY = dismissDelta;
                    this.updateDismissTransform();
                } else {
                    this.resetDismiss();
                }
            } else if (this.scale > 1) {
                this.translateX = this.lastTranslateX + deltaX;
                this.translateY = this.lastTranslateY + deltaY;
                this.applyConstraints();
                this.updateTransform();
            }
        }
    }

    onTouchEnd(e) {
        e.preventDefault();
        if (!this.isOpen) return;
        const tapDuration = Date.now() - this.tapStartTime;

        if (this.isDismissing && this.dismissCurrentY > this.dismissThreshold) {
            this.close();
            return;
        }

        if (this.isDismissing) {
            this.resetDismiss();
        }

        if (!this.isMultiTouch && this.scale > 1 && this.trackingPoints.length >= 2 && e.touches.length === 0) {
            const recent = this.trackingPoints.slice(-4);
            let totalVelX = 0, totalVelY = 0, count = 0;

            for (let i = 1; i < recent.length; i++) {
                const dt = recent[i].time - recent[i - 1].time;
                if (dt > 0) {
                    totalVelX += (recent[i].x - recent[i - 1].x) / dt;
                    totalVelY += (recent[i].y - recent[i - 1].y) / dt;
                    count++;
                }
            }

            if (count > 0) {
                this.velocityX = Math.max(-this.MAX_VELOCITY, Math.min(this.MAX_VELOCITY, (totalVelX / count) * this.VELOCITY_MULTIPLIER));
                this.velocityY = Math.max(-this.MAX_VELOCITY, Math.min(this.MAX_VELOCITY, (totalVelY / count) * this.VELOCITY_MULTIPLIER));
            }

            if (Math.abs(this.velocityX) > this.MIN_VELOCITY || Math.abs(this.velocityY) > this.MIN_VELOCITY) {
                this.rafId = requestAnimationFrame(() => this.inertiaLoop());
            }
        } else {
            this.velocityX = 0;
            this.velocityY = 0;
        }

        if (!this.isMultiTouch && !this.isDragging && tapDuration < 250) {
            this.handleTap(e);
        }

        if (e.touches.length === 0 && this.isMultiTouch) {
            this.isMultiTouch = false;
            this.multiTouchEndTime = Date.now();
        }

        if (this.scale < 1.1) {
            this.scale = 1;
            this.translateX = 0;
            this.translateY = 0;
            this.updateTransform();
        } else {
            this.applyConstraints();
            this.updateTransform();
        }

        if (e.touches.length === 0) {
            this.startAutoHide();
            this.trackingPoints = [];
        }
    }

    toggleHeader() {
        if (this.headerVisible) {
            this.hideHeader();
        } else {
            this.showHeader();
            this.startAutoHide();
        }
    }

    showHeader() {
        if (this.header) {
            this.header.classList.remove('hidden');
        }
        if (this.footer) {
            this.footer.classList.remove('hidden');
        }
        this.headerVisible = true;
    }

    hideHeader() {
        if (this.header) {
            this.header.classList.add('hidden');
        }
        if (this.footer) {
            this.footer.classList.add('hidden');
        }
        this.headerVisible = false;
        clearTimeout(this.hideTimeout);
    }

    startAutoHide() {
        clearTimeout(this.hideTimeout);
        if (this.headerVisible) {
            this.hideTimeout = setTimeout(() => this.hideHeader(), 15000);
        }
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new ZoomModal());
} else {
    new ZoomModal();
}
