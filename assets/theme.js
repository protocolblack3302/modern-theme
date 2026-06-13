/* Modern Theme — Alpine stores, GSAP, Lenis, cart API */

/* ─── Lenis smooth scroll (guarded — must NEVER block Alpine init) ───
   If the Lenis CDN fails to load, `new Lenis()` would throw and abort the
   whole file, so the alpine:init listeners below would never register and
   ALL Alpine features (cart, product page) would silently die. Guard it. */

let lenis = null;

try {
  if (typeof Lenis !== 'undefined') {
    lenis = new Lenis({ lerp: 0.08, wheelMultiplier: 1, smoothTouch: false });
    const raf = (time) => { lenis.raf(time); requestAnimationFrame(raf); };
    requestAnimationFrame(raf);

    if (typeof gsap !== 'undefined' && typeof ScrollTrigger !== 'undefined') {
      gsap.registerPlugin(ScrollTrigger);
      lenis.on('scroll', ScrollTrigger.update);
      gsap.ticker.add((time) => { lenis.raf(time * 1000); });
      gsap.ticker.lagSmoothing(0);
    }
  }
} catch (e) {
  console.warn('[Theme] Lenis init failed (smooth scroll disabled)', e);
}


/* ─── Alpine stores + data ────────────────────────────── */

document.addEventListener('alpine:init', () => {

  /* ── Cart store ── */
  Alpine.store('cart', {
    open: false,
    items: [],
    totalQuantity: 0,
    totalPrice: 0,
    loading: false,
    clearing: false,
    confirmingClear: false,
    _confirmTimer: null,
    pendingLines: {},
    lineTimers: {},
    lineVersions: {},
    activeRequests: 0,
    inventoryMap: {},
    errorMessage: null,
    _errorTimer: null,

    showError(msg) {
      this.errorMessage = msg;
      if (this._errorTimer) clearTimeout(this._errorTimer);
      this._errorTimer = setTimeout(() => { this.errorMessage = null; }, 4000);
    },

    clearError() {
      this.errorMessage = null;
      if (this._errorTimer) { clearTimeout(this._errorTimer); this._errorTimer = null; }
    },

    async init() {
      try {
        const el = document.getElementById('CartInventoryJSON');
        if (el) this.inventoryMap = JSON.parse(el.textContent);
      } catch (e) { /* non-fatal */ }
      await this.fetch();
    },

    _setBodyLock() {
      document.body.style.overflow = this.open ? 'hidden' : '';
    },

    openDrawer() {
      this.open = true;
      this._setBodyLock();
      setTimeout(() => {
        const drawer = document.querySelector('.cart-drawer');
        const close = drawer?.querySelector('.cart-drawer-close');
        (close || drawer)?.focus();
      }, 0);
    },

    closeDrawer() {
      this.open = false;
      if (this._confirmTimer) { clearTimeout(this._confirmTimer); this._confirmTimer = null; }
      this.confirmingClear = false;
      this._setBodyLock();
    },

    trapFocus(event) {
      if (!this.open) return;
      const drawer = document.querySelector('.cart-drawer');
      if (!drawer) return;

      const focusable = drawer.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },

    _setLoading(isLoading) {
      this.activeRequests += isLoading ? 1 : -1;
      this.activeRequests = Math.max(0, this.activeRequests);
      this.loading = this.activeRequests > 0;
    },

    _applyCart(cart) {
      this.items = cart.items || [];
      this.totalQuantity = cart.item_count || 0;
      this.totalPrice = cart.total_price || 0;
      // Keep inventoryMap in sync from the cart API on every response.
      // quantity_available = remaining stock AFTER deducting what's already in cart,
      // so total stock = item.quantity + quantity_available.
      (cart.items || []).forEach((item) => {
        if (item.quantity_available != null) {
          this.inventoryMap[item.variant_id] = {
            qty: item.quantity + item.quantity_available,
            tracked: item.inventory_management === 'shopify',
            policy: item.inventory_policy || 'deny',
          };
        }
      });
    },

    _recalculateTotals() {
      this.totalQuantity = this.items.reduce((sum, item) => sum + item.quantity, 0);
      this.totalPrice = this.items.reduce((sum, item) => {
        const unitPrice = item.final_price ?? item.price ?? 0;
        return sum + (unitPrice * item.quantity);
      }, 0);
    },

    _setLinePending(key, isPending) {
      this.pendingLines = { ...this.pendingLines, [key]: isPending };
    },

    linePending(key) {
      return Boolean(this.pendingLines[key]);
    },

    async fetch() {
      try {
        const res = await fetch('/cart.js');
        const cart = await res.json();
        this._applyCart(cart);
      } catch (e) { console.error('[Cart] fetch error', e); }
    },

    async addItem(variantId, quantity = 1, properties = {}, inventoryInfo = null) {
      this._setLoading(true);
      try {
        const res = await fetch('/cart/add.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: variantId, quantity, properties }),
        });
        if (!res.ok) throw new Error(await res.text());
        await res.json();
        if (inventoryInfo !== null) {
          this.inventoryMap[variantId] = inventoryInfo;
        }
        await this.fetch();
        this.openDrawer();
      } catch (e) {
        console.error('[Cart] addItem error', e);
        this.showError('Could not add item. Please try again.');
      } finally { this._setLoading(false); }
    },

    updateItem(key, quantity, options = {}) {
      const normalizedQuantity = Math.max(0, Number(quantity) || 0);
      const item = this.items.find((line) => line.key === key);
      if (!item && normalizedQuantity > 0) return;

      if (this.lineTimers[key]) clearTimeout(this.lineTimers[key]);

      if (item) {
        if (normalizedQuantity === 0) {
          this.items = this.items.filter((line) => line.key !== key);
        } else {
          this.items = this.items.map((line) =>
            line.key === key ? { ...line, quantity: normalizedQuantity } : line
          );
        }
        this._recalculateTotals();
      }

      this._setLinePending(key, true);
      this.lineVersions[key] = (this.lineVersions[key] || 0) + 1;
      const version = this.lineVersions[key];

      const delay = options.immediate ? 0 : 220;
      this.lineTimers[key] = setTimeout(() => {
        this.commitItem(key, normalizedQuantity, version);
      }, delay);
    },

    changeItem(key, delta) {
      const item = this.items.find((line) => line.key === key);
      if (!item) return;

      let newQty = item.quantity + delta;

      if (delta > 0) {
        const inv = this.inventoryMap[item.variant_id];
        if (inv && inv.tracked && inv.policy === 'deny') {
          newQty = Math.min(newQty, inv.qty);
        }
      }

      this.updateItem(key, newQty);
    },

    atStockLimit(item) {
      const inv = this.inventoryMap[item.variant_id];
      return Boolean(inv && inv.tracked && inv.policy === 'deny' && item.quantity >= inv.qty);
    },

    async commitItem(key, quantity, version) {
      delete this.lineTimers[key];
      this._setLoading(true);
      try {
        const res = await fetch('/cart/change.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: key, quantity }),
        });
        if (!res.ok) throw new Error(await res.text());
        const cart = await res.json();
        if (this.lineVersions[key] === version) this._applyCart(cart);
      } catch (e) {
        console.error('[Cart] updateItem error', e);
        if (this.lineVersions[key] === version) {
          await this.fetch();
          this.showError('Could not update quantity. Changes reverted.');
        }
      } finally {
        if (this.lineVersions[key] === version) this._setLinePending(key, false);
        this._setLoading(false);
      }
    },

    removeItem(key) {
      this.updateItem(key, 0, { immediate: true });
    },

    requestClear() {
      if (this.confirmingClear) {
        clearTimeout(this._confirmTimer);
        this._confirmTimer = null;
        this.confirmingClear = false;
        this._executeClear();
      } else {
        this.confirmingClear = true;
        this._confirmTimer = setTimeout(() => {
          this.confirmingClear = false;
          this._confirmTimer = null;
        }, 3000);
      }
    },

    async _executeClear() {
      Object.values(this.lineTimers).forEach(clearTimeout);
      this.lineTimers = {};
      this.pendingLines = {};
      this.lineVersions = {};
      this.clearing = true;
      this._setLoading(true);
      this.items = [];
      this.totalQuantity = 0;
      this.totalPrice = 0;

      try {
        const res = await fetch('/cart/clear.js', { method: 'POST' });
        if (!res.ok) throw new Error(await res.text());
        const cart = await res.json();
        this._applyCart(cart);
      } catch (e) {
        console.error('[Cart] clear error', e);
        await this.fetch();
      } finally {
        this.clearing = false;
        this._setLoading(false);
      }
    },

    formattedPrice(cents) {
      return new Intl.NumberFormat('en-IN', {
        style: 'currency', currency: 'INR', minimumFractionDigits: 0,
      }).format(cents / 100);
    },

    get formattedTotal() { return this.formattedPrice(this.totalPrice); },
  });


  /* ── Mobile menu store ── */
  Alpine.store('menu', {
    open: false,
    toggle() { this.open = !this.open; document.body.style.overflow = this.open ? 'hidden' : ''; },
    close() { this.open = false; document.body.style.overflow = ''; },
  });


  /* ── Product page data ──
     Takes ONLY the product id. All JSON parsing happens inside init() with
     try/catch so a malformed payload can never throw in the x-data attribute
     (which would kill the whole component and hide the add-to-cart button). */
  Alpine.data('productPage', (productId) => ({
    product: null,
    images: [],
    inventory: {},
    ready: false,
    selectedVariantId: null,
    selectedOptions: {},
    activeImageIndex: 0,
    quantity: 1,
    addingToCart: false,
    addedToCart: false,

    init() {
      /* Parse product JSON — critical. If this fails, log and bail gracefully. */
      try {
        const el = document.getElementById('ProductJSON-' + productId);
        this.product = JSON.parse(el.textContent);
      } catch (e) {
        console.error('[Product] failed to parse product JSON', e);
        return;
      }

      /* Parse images JSON — optional. Failure only disables image swapping. */
      try {
        const imgEl = document.getElementById('ProductImagesJSON-' + productId);
        if (imgEl) this.images = JSON.parse(imgEl.textContent);
      } catch (e) {
        console.warn('[Product] failed to parse images JSON', e);
        this.images = [];
      }

      /* Parse inventory JSON — optional. */
      try {
        const invEl = document.getElementById('ProductInventoryJSON-' + productId);
        if (invEl) this.inventory = JSON.parse(invEl.textContent);
      } catch (e) {
        this.inventory = {};
      }

      const variant =
        this.product.selected_or_first_available_variant ||
        this.product.variants.find((v) => v.available) ||
        this.product.variants[0];

      if (variant) {
        this.selectedVariantId = variant.id;
        this.product.options.forEach((opt, i) => {
          const name = typeof opt === 'object' ? opt.name : opt;
          this.selectedOptions[name] = variant.options[i];
        });
      }

      this.ready = true;
    },

    _optName(opt) {
      return typeof opt === 'object' ? opt.name : opt;
    },

    get currentVariant() {
      if (!this.product) return null;
      return this.product.variants.find((v) =>
        v.options.every(
          (o, i) => o === this.selectedOptions[this._optName(this.product.options[i])]
        )
      );
    },

    get stockInfo() {
      const v = this.currentVariant;
      if (!v) return null;
      return this.inventory[v.id] || null;
    },

    get maxAddable() {
      const si = this.stockInfo;
      if (!si || !si.tracked || si.policy !== 'deny') return 9999;
      const inCart = Alpine.store('cart').items.find(
        (i) => i.variant_id === this.selectedVariantId
      )?.quantity || 0;
      return Math.max(0, si.qty - inCart);
    },

    get atCartLimit() {
      const si = this.stockInfo;
      if (!si || !si.tracked || si.policy !== 'deny') return false;
      const inCart = Alpine.store('cart').items.find(
        (i) => i.variant_id === this.selectedVariantId
      )?.quantity || 0;
      return inCart >= si.qty;
    },

    /* CSS class for the stock dot: in / low / out */
    get stockState() {
      const v = this.currentVariant;
      if (!v || !v.available) return 'product-stock__dot--out';
      const info = this.stockInfo;
      if (info && info.tracked && info.qty > 0 && info.qty <= 10) return 'product-stock__dot--low';
      return 'product-stock__dot--in';
    },

    get stockLabel() {
      const v = this.currentVariant;
      if (!v || !v.available) return 'Out of stock';
      const info = this.stockInfo;
      if (info && info.tracked && info.qty > 0) {
        if (info.qty <= 10) return 'Only ' + info.qty + ' left in stock';
        return info.qty + ' in stock';
      }
      return 'In stock';
    },

    selectOption(name, value) {
      this.selectedOptions[name] = value;
      this.quantity = 1;
      this.addedToCart = false;
      const v = this.currentVariant;
      if (v) {
        this.selectedVariantId = v.id;
        window.history.replaceState({}, '', '?variant=' + v.id);
        if (v.featured_image && this.product.images) {
          const idx = this.product.images.findIndex((img) => img.id === v.featured_image.id);
          if (idx >= 0) this.setActiveImage(idx);
        }
      }
    },

    isOptionAvailable(name, value) {
      if (!this.product) return true;
      const test = { ...this.selectedOptions, [name]: value };
      return this.product.variants.some(
        (v) =>
          v.available &&
          v.options.every(
            (o, i) => o === test[this._optName(this.product.options[i])]
          )
      );
    },

    /* index-only: URLs come from pre-rendered imagesData to avoid JS-string quoting issues */
    setActiveImage(index) {
      this.activeImageIndex = index;
    },

    formatMoney(cents) {
      if (cents == null) return '';
      return new Intl.NumberFormat('en-IN', {
        style: 'currency', currency: 'INR', minimumFractionDigits: 0,
      }).format(cents / 100);
    },

    async addToCart() {
      if (!this.selectedVariantId || this.addingToCart) return;
      const qty = Math.min(this.quantity, this.maxAddable);
      if (qty <= 0) return;
      this.addingToCart = true;
      const si = this.stockInfo;
      const invInfo = si ? { qty: si.qty, tracked: si.tracked, policy: si.policy ?? 'deny' } : null;
      await Alpine.store('cart').addItem(this.selectedVariantId, qty, {}, invInfo);
      this.addingToCart = false;
      this.quantity = 1;
      this.addedToCart = true;
      setTimeout(() => { this.addedToCart = false; }, 2500);
    },
  }));

});


/* ─── Header: transparent on homepage, solid everywhere else ─── */

(function initHeader() {
  const header = document.querySelector('.site-header');
  if (!header) return;

  const setHeaderOffset = () => {
    const barHeight = document.querySelector('.announcement-bar')?.offsetHeight || 0;
    document.documentElement.style.setProperty('--announcement-height', barHeight + 'px');
  };

  setHeaderOffset();
  window.addEventListener('resize', setHeaderOffset, { passive: true });

  const isHomepage = document.body.classList.contains('template-index');

  window.addEventListener('scroll', () => {
    const barHeight = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--announcement-height')
    ) || 0;
    // Move header to top only once the announcement bar has scrolled away
    if (window.scrollY >= barHeight) {
      header.setAttribute('data-scrolled', '');
    } else {
      header.removeAttribute('data-scrolled');
      // Non-homepage keeps solid bg via data-solid attribute in HTML
    }
  }, { passive: true });
})();


/* ─── GSAP scroll animations ──────────────────────────── */

(function initAnimations() {
  if (typeof gsap === 'undefined' || typeof ScrollTrigger === 'undefined') return;

  gsap.utils.toArray('[data-animate="fade-up"]').forEach((el) => {
    gsap.fromTo(el,
      { opacity: 0, y: 48 },
      {
        opacity: 1, y: 0, duration: 0.9, ease: 'power3.out',
        scrollTrigger: { trigger: el, start: 'top 88%', once: true },
      }
    );
  });

  gsap.utils.toArray('[data-animate="stagger"]').forEach((parent) => {
    const children = parent.querySelectorAll(':scope > *');
    gsap.fromTo(children,
      { opacity: 0, y: 32 },
      {
        opacity: 1, y: 0, duration: 0.7, ease: 'power3.out', stagger: 0.1,
        scrollTrigger: { trigger: parent, start: 'top 85%', once: true },
      }
    );
  });

  /* Hero entrance */
  const heroLines = document.querySelectorAll('.hero-heading .line');
  if (heroLines.length) {
    gsap.fromTo(heroLines,
      { y: '110%', opacity: 0 },
      { y: '0%', opacity: 1, duration: 1, ease: 'power4.out', stagger: 0.12, delay: 0.1 }
    );
  }

  const heroEyebrow = document.querySelector('.hero-eyebrow');
  if (heroEyebrow) {
    gsap.fromTo(heroEyebrow, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.8, ease: 'power3.out', delay: 0.05 });
  }

  const heroSub = document.querySelector('.hero-subheading');
  if (heroSub) {
    gsap.fromTo(heroSub, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.8, ease: 'power3.out', delay: 0.4 });
  }

  gsap.utils.toArray('.hero-actions .btn').forEach((btn, i) => {
    gsap.fromTo(btn, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.7, ease: 'power3.out', delay: 0.55 + i * 0.1 });
  });

  const heroMedia = document.querySelector('.hero-media img, .hero-media video');
  if (heroMedia) {
    gsap.fromTo(heroMedia, { scale: 1.06 }, { scale: 1, duration: 1.8, ease: 'power2.out' });
  }
})();
