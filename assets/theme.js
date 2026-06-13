/* Modern Theme — Alpine stores + GSAP animations + cart API + Lenis */

/* ─── Lenis smooth scroll ─────────────────────────────── */

const lenis = new Lenis({
  lerp: 0.08,
  wheelMultiplier: 1,
  smoothTouch: false,
});

function raf(time) {
  lenis.raf(time);
  requestAnimationFrame(raf);
}
requestAnimationFrame(raf);

// Sync Lenis with GSAP ScrollTrigger
if (typeof gsap !== 'undefined' && typeof ScrollTrigger !== 'undefined') {
  gsap.registerPlugin(ScrollTrigger);

  lenis.on('scroll', ScrollTrigger.update);

  gsap.ticker.add((time) => {
    lenis.raf(time * 1000);
  });
  gsap.ticker.lagSmoothing(0);
}


/* ─── Alpine.js stores ────────────────────────────────── */

document.addEventListener('alpine:init', () => {

  /* Cart store — single source of truth */
  Alpine.store('cart', {
    open: false,
    items: [],
    totalQuantity: 0,
    totalPrice: 0,
    loading: false,

    async init() {
      await this.fetch();
    },

    async fetch() {
      try {
        const res = await fetch('/cart.js', { headers: { 'Content-Type': 'application/json' } });
        const cart = await res.json();
        this.items = cart.items;
        this.totalQuantity = cart.item_count;
        this.totalPrice = cart.total_price;
      } catch (e) {
        console.error('[Cart] fetch failed', e);
      }
    },

    async addItem(variantId, quantity = 1, properties = {}) {
      this.loading = true;
      try {
        const res = await fetch('/cart/add.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: variantId, quantity, properties }),
        });
        if (!res.ok) throw new Error('Add to cart failed');
        await this.fetch();
        this.open = true;
      } catch (e) {
        console.error('[Cart] addItem failed', e);
      } finally {
        this.loading = false;
      }
    },

    async updateItem(key, quantity) {
      this.loading = true;
      try {
        const res = await fetch('/cart/change.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: key, quantity }),
        });
        if (!res.ok) throw new Error('Cart change failed');
        await this.fetch();
      } catch (e) {
        console.error('[Cart] updateItem failed', e);
      } finally {
        this.loading = false;
      }
    },

    async removeItem(key) {
      await this.updateItem(key, 0);
    },

    formattedPrice(cents) {
      return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        minimumFractionDigits: 0,
      }).format(cents / 100);
    },

    get formattedTotal() {
      return this.formattedPrice(this.totalPrice);
    },
  });

  /* Mobile menu store */
  Alpine.store('menu', {
    open: false,
    toggle() { this.open = !this.open; },
    close() { this.open = false; },
  });

  /* Product page store */
  Alpine.data('productPage', (productData) => ({
    product: productData,
    selectedVariantId: productData.selected_or_first_available_variant?.id,
    selectedOptions: {},
    activeImageIndex: 0,
    quantity: 1,
    addingToCart: false,
    addedToCart: false,

    init() {
      const variant = this.product.selected_or_first_available_variant;
      if (variant) {
        this.product.options.forEach((opt, i) => {
          this.selectedOptions[opt] = variant.options[i];
        });
      }
    },

    get currentVariant() {
      return this.product.variants.find((v) =>
        v.options.every((o, i) => o === this.selectedOptions[this.product.options[i]])
      );
    },

    selectOption(name, value) {
      this.selectedOptions[name] = value;
      const variant = this.currentVariant;
      if (variant) this.selectedVariantId = variant.id;
    },

    isOptionAvailable(name, value) {
      const testOptions = { ...this.selectedOptions, [name]: value };
      return this.product.variants.some(
        (v) => v.available && v.options.every((o, i) => o === testOptions[this.product.options[i]])
      );
    },

    async addToCart() {
      if (!this.selectedVariantId || this.addingToCart) return;
      this.addingToCart = true;
      await Alpine.store('cart').addItem(this.selectedVariantId, this.quantity);
      this.addingToCart = false;
      this.addedToCart = true;
      setTimeout(() => { this.addedToCart = false; }, 2000);
    },

    setActiveImage(index) {
      this.activeImageIndex = index;
    },
  }));
});


/* ─── Header scroll behavior ──────────────────────────── */

(function initHeader() {
  const header = document.querySelector('.site-header');
  if (!header) return;

  const barHeight = document.querySelector('.announcement-bar')?.offsetHeight || 0;
  header.style.top = barHeight + 'px';

  let ticking = false;
  window.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(() => {
        if (window.scrollY > 60) {
          header.setAttribute('data-scrolled', '');
        } else {
          header.removeAttribute('data-scrolled');
        }
        ticking = false;
      });
      ticking = true;
    }
  }, { passive: true });
})();


/* ─── GSAP scroll animations ──────────────────────────── */

(function initAnimations() {
  if (typeof gsap === 'undefined' || typeof ScrollTrigger === 'undefined') return;

  /* Fade-up reveal for generic elements */
  gsap.utils.toArray('[data-animate="fade-up"]').forEach((el) => {
    gsap.fromTo(el,
      { opacity: 0, y: 48 },
      {
        opacity: 1,
        y: 0,
        duration: 0.9,
        ease: 'power3.out',
        scrollTrigger: {
          trigger: el,
          start: 'top 88%',
          once: true,
        },
      }
    );
  });

  /* Stagger children */
  gsap.utils.toArray('[data-animate="stagger"]').forEach((parent) => {
    const children = parent.querySelectorAll(':scope > *');
    gsap.fromTo(children,
      { opacity: 0, y: 32 },
      {
        opacity: 1,
        y: 0,
        duration: 0.7,
        ease: 'power3.out',
        stagger: 0.1,
        scrollTrigger: {
          trigger: parent,
          start: 'top 85%',
          once: true,
        },
      }
    );
  });

  /* Hero entrance — runs immediately on load */
  const heroHeading = document.querySelector('.hero-heading');
  if (heroHeading) {
    const lines = heroHeading.querySelectorAll('.line');
    gsap.fromTo(lines,
      { y: '110%', opacity: 0 },
      { y: '0%', opacity: 1, duration: 1, ease: 'power4.out', stagger: 0.12, delay: 0.1 }
    );
  }

  const heroEyebrow = document.querySelector('.hero-eyebrow');
  if (heroEyebrow) {
    gsap.fromTo(heroEyebrow,
      { opacity: 0, y: 16 },
      { opacity: 1, y: 0, duration: 0.8, ease: 'power3.out', delay: 0.05 }
    );
  }

  const heroSub = document.querySelector('.hero-subheading');
  if (heroSub) {
    gsap.fromTo(heroSub,
      { opacity: 0, y: 20 },
      { opacity: 1, y: 0, duration: 0.8, ease: 'power3.out', delay: 0.4 }
    );
  }

  const heroCtas = document.querySelectorAll('.hero-actions .btn');
  if (heroCtas.length) {
    gsap.fromTo(heroCtas,
      { opacity: 0, y: 20 },
      { opacity: 1, y: 0, duration: 0.7, ease: 'power3.out', stagger: 0.1, delay: 0.55 }
    );
  }

  /* Hero image subtle scale */
  const heroMedia = document.querySelector('.hero-media img, .hero-media video');
  if (heroMedia) {
    gsap.fromTo(heroMedia,
      { scale: 1.06 },
      { scale: 1, duration: 1.8, ease: 'power2.out' }
    );
  }
})();


/* ─── Cart drawer — Alpine x-show bridge ─────────────── */

(function initCartDrawerBridge() {
  const drawer = document.querySelector('.cart-drawer');
  if (!drawer) return;

  const observer = new MutationObserver(() => {
    /* Alpine sets display:none via x-show — we bridge to data-open for CSS transition */
    if (drawer.style.display === 'none' || drawer.style.display === '') {
      drawer.removeAttribute('data-open');
    } else {
      drawer.setAttribute('data-open', '');
    }
  });

  observer.observe(drawer, { attributes: true, attributeFilter: ['style'] });
})();


/* ─── Product gallery thumbnails ──────────────────────── */

document.addEventListener('click', (e) => {
  const thumb = e.target.closest('.product-gallery__thumb');
  if (!thumb) return;

  const gallery = thumb.closest('.product-gallery');
  if (!gallery) return;

  const index = parseInt(thumb.dataset.index, 10);
  const mainImg = gallery.querySelector('.product-gallery__main img');
  const allThumbs = gallery.querySelectorAll('.product-gallery__thumb');

  if (mainImg) {
    mainImg.src = thumb.dataset.src;
    mainImg.srcset = thumb.dataset.srcset || '';
  }

  allThumbs.forEach((t) => t.classList.remove('active'));
  thumb.classList.add('active');
});
