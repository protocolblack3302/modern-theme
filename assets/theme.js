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

    async init() { await this.fetch(); },

    async fetch() {
      try {
        const res = await fetch('/cart.js');
        const cart = await res.json();
        this.items = cart.items;
        this.totalQuantity = cart.item_count;
        this.totalPrice = cart.total_price;
      } catch (e) { console.error('[Cart] fetch error', e); }
    },

    async addItem(variantId, quantity = 1, properties = {}) {
      this.loading = true;
      try {
        const res = await fetch('/cart/add.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: variantId, quantity, properties }),
        });
        if (!res.ok) throw new Error(await res.text());
        await this.fetch();
        this.open = true;
      } catch (e) { console.error('[Cart] addItem error', e); }
      finally { this.loading = false; }
    },

    async updateItem(key, quantity) {
      this.loading = true;
      try {
        const res = await fetch('/cart/change.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: key, quantity }),
        });
        if (!res.ok) throw new Error(await res.text());
        await this.fetch();
      } catch (e) { console.error('[Cart] updateItem error', e); }
      finally { this.loading = false; }
    },

    async removeItem(key) { await this.updateItem(key, 0); },

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
      const v = this.currentVariant;
      if (v) {
        this.selectedVariantId = v.id;
        /* Swap to variant's featured image if it has one */
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
      const img = this.$refs && this.$refs.mainImage;
      const data = this.images[index];
      if (img && data) {
        img.src = data.src900;
        img.alt = data.alt || '';
      }
    },

    formatMoney(cents) {
      if (cents == null) return '';
      return new Intl.NumberFormat('en-IN', {
        style: 'currency', currency: 'INR', minimumFractionDigits: 0,
      }).format(cents / 100);
    },

    async addToCart() {
      if (!this.selectedVariantId || this.addingToCart) return;
      this.addingToCart = true;
      await Alpine.store('cart').addItem(this.selectedVariantId, this.quantity);
      this.addingToCart = false;
      this.addedToCart = true;
      setTimeout(() => { this.addedToCart = false; }, 2500);
    },
  }));

});


/* ─── Header: transparent on homepage, solid everywhere else ─── */

(function initHeader() {
  const header = document.querySelector('.site-header');
  if (!header) return;

  const barHeight = document.querySelector('.announcement-bar')?.offsetHeight || 0;
  header.style.top = barHeight + 'px';

  /* On non-index pages force the solid state immediately */
  const isHomepage = document.body.classList.contains('template-index');

  if (!isHomepage) {
    header.setAttribute('data-scrolled', '');
  }

  window.addEventListener('scroll', () => {
    if (isHomepage) {
      if (window.scrollY > 60) {
        header.setAttribute('data-scrolled', '');
      } else {
        header.removeAttribute('data-scrolled');
      }
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


