// ============================================================
// ZHunter PRO v7.9.15 Ã¢â‚¬â€ Content Script
// ============================================================
// Fixes vs 7.6.0:
//   Ã¢â‚¬Â¢ Issue 1: Correct price extraction Ã¢â‚¬â€ reads full price string
//     (whole + fractional) directly from DOM; JSON harvest no longer
//     picks up unrelated numeric price fields (uses currency-bearing
//     string fields only when they originate from offer/price keys).
//   Ã¢â‚¬Â¢ Issue 2: Stronger isBadImage() Ã¢â‚¬â€ blocks logos, platform chrome,
//     UI sprites, tiny icons, header/footer/nav/banner images. DOM-
//     position-aware filtering rejects images outside the main product
//     gallery container.
//   Ã¢â‚¬Â¢ Issue 3: Universal e-commerce scraper covers Flipkart, Noon,
//     WooCommerce, BigCommerce, and any site exposing schema.org/JSON-LD
//     Product or Offer markup Ã¢â‚¬â€ no per-site hardcoding needed.
//   Ã¢â‚¬Â¢ Issue 4: Gallery-scoped image collection Ã¢â‚¬â€ images are collected
//     only from the main product display area (hero + thumbnails).
//     Description sections, review carousels, upsell grids, footer
//     banners are all excluded.
// ============================================================
if (!window.__zhunterContentLoaded) {
window.__zhunterContentLoaded = true;

'use strict';

const IMG_CAP = 15;
const VID_CAP = 12;

// FIX: Cache the harvestInlineJson result per page load.
// On complex pages (Next.js/Walmart/Amazon) the inline scripts can be 500 KBÃ¢â‚¬â€œ2 MB.
// Re-parsing them on every SCRAPE_PAGE message caused 200Ã¢â‚¬â€œ500 ms freezes.
let _harvestCache = null;

// Ã¢â€â‚¬Ã¢â€â‚¬ Basics Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
const absUrl = u => { try { return new URL(u, location.href).href; } catch (_) { return u || ''; } };
const host   = () => { try { return location.hostname.toLowerCase().replace(/^www\./, ''); } catch (_) { return ''; } };

// Ã¢â€â‚¬Ã¢â€â‚¬ Price Cleaner Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// Strips discount noise and returns the FIRST standalone price token found.
function cleanPriceText(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let s = raw
    .replace(/[-Ã¢Ë†â€™]\s*\d{1,3}\s*%/g, '')
    .replace(/\d{1,3}\s*%\s*off/gi, '')
    .replace(/\(\s*\d{1,3}\s*%\s*\)/g, '')
    .replace(/save\s+\$?\d[\d.,]*/gi, '')
    .replace(/save\s+\d{1,3}\s*%/gi, '')
    .replace(/\bdiscount\b/gi, '')
    .replace(/list\s*price\s*:?/gi, '')
    .replace(/\bwas\s*:?\s*/gi, '')
    .replace(/\bfrom\s*:?\s*/gi, '')
    .replace(/typical\s*price\s*:?/gi, '')
    .replace(/original\s*price\s*:?/gi, '')
    .trim();

  const patterns = [
    /[$Ã‚Â£Ã¢â€šÂ¬Ã‚Â¥Ã¢â€šÂ¹Ã¢â€šÂ©]\s*\d+(?:[.,]\d{3})*(?:[.,]\d{1,2})?/,
    /\d+(?:[.,]\d{3})*(?:[.,]\d{1,2})?\s*[$Ã‚Â£Ã¢â€šÂ¬Ã‚Â¥Ã¢â€šÂ¹Ã¢â€šÂ©]/,
    /(?:USD|CAD|AUD|GBP|EUR|PKR|INR)\s*\d+(?:[.,]\d{3})*(?:[.,]\d{1,2})?/i,
    /\d+(?:[.,]\d{3})*(?:[.,]\d{1,2})?/
  ];
  for (const p of patterns) {
    const m = s.match(p);
    if (m && /\d/.test(m[0])) return m[0].replace(/\s+/g, '');
  }
  return '';
}

function ensureCurrency(p, symbol) {
  if (!p) return '';
  // Already has a currency symbol or code Ã¢â‚¬â€ return as-is
  if (/^[$Ã‚Â£Ã¢â€šÂ¬Ã‚Â¥Ã¢â€šÂ¹Ã¢â€šÂ©]/.test(p)) return p;
  if (/^(USD|CAD|AUD|GBP|EUR|PKR|INR)/i.test(p)) return p;
  if (/[$Ã‚Â£Ã¢â€šÂ¬Ã‚Â¥Ã¢â€šÂ¹Ã¢â€šÂ©]$/.test(p)) return p;
  // Use detected symbol from page, or fall back to $
  return `${symbol || '$'}${p}`;
}

// Detect the currency symbol used on this page (first occurrence wins)
function detectPageCurrencySymbol() {
  const priceEls = document.querySelectorAll(
    '[itemprop="price"], [data-price], [class*="price"], [id*="price"], ' +
    '.a-price, .Price, .price'
  );
  for (const el of priceEls) {
    const txt = el.textContent || '';
    const m = txt.match(/[$Ã‚Â£Ã¢â€šÂ¬Ã‚Â¥Ã¢â€šÂ¹Ã¢â€šÂ©]/);
    if (m) return m[0];
  }
  // Fallback: look in meta tags
  const meta = document.querySelector('meta[property="product:price:currency"], meta[itemprop="priceCurrency"]');
  if (meta?.content) {
    const map = { USD: '$', GBP: 'Ã‚Â£', EUR: 'Ã¢â€šÂ¬', JPY: 'Ã‚Â¥', INR: 'Ã¢â€šÂ¹', KRW: 'Ã¢â€šÂ©', CAD: 'CA$', AUD: 'AU$' };
    return map[meta.content.toUpperCase()] || meta.content + ' ';
  }
  return '$';
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Image quality / dedup helpers Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
function normalizeImg(rawUrl) {
  try {
    const u = new URL(absUrl(rawUrl));
    const h = u.hostname.toLowerCase();

    ['width', 'height', 'w', 'h', 'size', 'quality', 'q', '_v', 'v',
     'fmt', 'wid', 'hei', 'fit'].forEach(p => u.searchParams.delete(p));

    if (/(media-amazon\.com|ssl-images-amazon\.com|images-na\.|amazon\.[a-z.]+)/i.test(h)) {
      // FIX: Replace ALL size tokens with SL1500 (highest standard CDN quality).
      // Previously this stripped the token entirely, which can result in Amazon
      // serving a low-res default. SL1500 guarantees 1500px longest side.
      // Global flag handles chained tokens like ._AC_US40_._SX300_.
      let path = u.pathname.replace(/\._[A-Z0-9_,]{2,}_\./gi, '._AC_SL1500_.');
      u.pathname = path;
      return u.href;
    }
    if (/walmartimages\.com|walmart\.com/i.test(h)) {
      ['odnHeight', 'odnWidth', 'odnBg'].forEach(p => u.searchParams.delete(p));
      return u.href;
    }
    if (/scene7\.samsclub\.com|samsclub\.com/i.test(h)) {
      u.searchParams.set('wid', '2000');
      u.searchParams.set('hei', '2000');
      u.searchParams.set('fmt', 'jpg');
      return u.href;
    }
    if (/faire-cdn\.com|cdn\.faire\.com|faire\.com/i.test(h)) {
      let path = u.pathname.replace(/\/(w|h|c|q|f)_[^/]+\/?/gi, '/');
      path = path.replace(/\/{2,}/g, '/');
      u.pathname = path;
      return u.href;
    }
    if (/alicdn\.com|aliexpress|alibaba/i.test(h)) {
      let path = u.pathname.replace(/_\d+x\d+(?=\.[a-z]+$)/i, '_960x960');
      u.pathname = path;
      return u.href;
    }
    if (/ebayimg\.com|ebaystatic\.com|ebay\./i.test(h)) {
      let path = u.pathname.replace(/s-l\d+/g, 's-l1600');
      u.pathname = path;
      return u.href;
    }
    if (/cdn\.shopify\.com|shopifycdn|myshopify\.com/i.test(h)) {
      let path = u.pathname.replace(/_(\d+)x(\d+)?(?=\.[a-z]+$)/i, '_1200x');
      u.pathname = path;
      return u.href;
    }
    return u.href;
  } catch (_) { return rawUrl || ''; }
}

function canonImageKey(url) {
  try {
    const u = new URL(absUrl(url));
    let p = u.pathname;
    // Amazon: strip ALL size/quality tokens (._AC_SL1500_., ._AC_US40_., etc.)
    // Use a global replace so multiple tokens in one path are all removed.
    p = p.replace(/\._[A-Z0-9_,]+_\./gi, '.'); // first pass (handles most)
    p = p.replace(/\._[A-Z0-9_,]+_\./gi, '.'); // second pass (handles chained tokens)
    p = p.replace(/\/\d{2,4}x\d{2,4}\//g, '/');
    p = p.replace(/\/\d{2,4}x\d{2,4}(?=\.[a-z]+$)/gi, '/');
    p = p.replace(/[-_](thumb|small|medium|large|tiny|sml|lrg|hi|lo)\b/gi, '');
    p = p.replace(/[-_]\d{2,4}x\d{2,4}(?=\.[a-z]+$)/gi, '');
    p = p.replace(/_\d{2,4}(?=\.[a-z]+$)/g, '');
    // Strip query string for Amazon image CDNs (they don't affect identity)
    if (/(media-amazon\.com|ssl-images-amazon\.com|images-na\.)/i.test(u.hostname)) {
      return u.hostname + p.toLowerCase();
    }
    return u.hostname + p.toLowerCase();
  } catch (_) { return String(url || '').toLowerCase(); }
}

// Ã¢â€â‚¬Ã¢â€â‚¬ ISSUE 2 & 4 FIX: Stronger image bad-image filter Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
function isBadImage(url) {
  if (!url) return true;
  const s = String(url).toLowerCase();
  if (s.length < 10) return true;
  if (s.startsWith('data:image/svg') || s.endsWith('.svg')) return true;
  if (/PHN2Z/.test(s)) return true; // base64 svg

  // Ã¢â€â‚¬Ã¢â€â‚¬ Keyword-based exclusions (expanded) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  if (/\b(logo|logos|sprite|sprites|favicon|avatar|placeholder|spacer|pixel|blank|loading|tracking|banner|header|footer|badge|watermark|branding|navbar|navigation|overlay|spinner|advertisement|ribbon|sticker)\b/.test(s)) return true;
  if (/\/icon\/|\/icons\/|[_-]icon[_.@-]|icon[_.@-]\d|\/nav\/|\/menu\/|\/cart\/|\/checkout\/|\/ad[-_]|payment[-_]icon|payment[-_]method|trust[-_]badge|trust[-_]seal/.test(s)) return true;
  if (/hero[-_]banner|promo[-_]banner|category[-_]banner|category[-_]image|\/department\/|\/category\/|\/brand\/|brand[-_]logo|\/circular\/|\/hero\/|\/search\/|search[-_]icon/.test(s)) return true;
  if (/\/rating\/|star[-_]rating|review[-_]star|\/social\/|social[-_]share|\/upsell\/|\/related\/|\/recommendation|\/similar\/|\/customer[-_]review|\/review[-_]image/.test(s)) return true;
  if (/\/seller\/|seller[-_]logo|\/store\/|store[-_]logo|\/gift[-_]wrap|\/delivery\/|\/shipping\//.test(s)) return true;

  if (/(^\/|\/)(1x1|2x2|3x3)\.|grey-pixel|transparent\.gif/.test(s)) return true;

  // Skip tiny icon-sized images (up to 64px)
  if (/\/\d{1,2}x\d{1,2}[./]/.test(s)) return true;
  if (/[-_](16|24|32|48|64)x\d{2,3}[._]/.test(s)) return true;

  // Amazon non-product
  if (/ssl-images-amazon\.com/i.test(s) && /\/G\/|\/transparent\.|\/buttons?\/|\/ui\/|\/nav\//.test(s)) return true;

  // Walmart non-product Ã¢â‚¬â€ block spark logo, app/delivery/store icons, badges, category images
  if (/walmartimages\.com/i.test(s) && /\/spark\/|\/store\/|\/logo\/|\/icon\/|\/badge\/|\/footer\/|\/header\/|\/delivery\/|\/app\/|\/promo\/|\/circular\/|\/dept\/|\/category\/|\/brand\/|\/nav\/|\/hero\/|\/banner\//.test(s)) return true;
  // Walmart image filenames that are clearly UI chrome
  if (/walmartimages\.com/i.test(s) && /spark[-_]logo|walmart[-_]logo|wm[-_]logo|wm[-_]app|delivery[-_]icon|pickup[-_]icon|store[-_]icon/.test(s)) return true;
  // Walmart inline JSON image patterns Ã¢â‚¬â€ small base64-encoded images from JSON are always UI
  if (/walmartimages\.com/i.test(s) && /\/\d{2,3}x\d{2,3}[?/]/.test(s)) return true;

  // Sam's Club non-product
  if (/samsclub\.com/i.test(s) && /\/category\/|\/banner\/|\/brand\/|\/circular\/|\/hero\/|\/nav\/|\/icon\/|\/logo\//.test(s)) return true;

  // Temu non-product (platform chrome / tracking pixels)
  if (/temu\.com/i.test(s) && /\/platform\/|\/icon\/|\/logo\/|\/badge\/|\/header\/|\/nav\//.test(s)) return true;

  // Faire non-product (brand logos, seller avatars)
  if (/faire\.com|faire-cdn\.com/i.test(s) && /brand[-_]logo|seller[-_]logo|\/avatar\/|\/logo\/|\/icon\/|\/badge\//.test(s)) return true;

  return false;
}

// Ã¢â€â‚¬Ã¢â€â‚¬ DOM-context bad-image check Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// Returns true if the <img> element sits inside a non-product DOM region.
function isBadImageElement(imgEl) {
  if (!imgEl) return false;
  const badParent = imgEl.closest(
    'header, nav, footer, ' +
    '[class*="logo"], [id*="logo"], ' +
    '[class*="navbar"], [id*="navbar"], ' +
    '[class*="header"], [id*="header"], ' +
    '[class*="footer"], [id*="footer"], ' +
    '[class*="nav-"], [id*="nav-"], ' +
    '[class*="site-nav"], [class*="site-header"], ' +
    '[class*="breadcrumb"], [class*="Breadcrumb"], ' +
    '[class*="badge"], [class*="trust-badge"], ' +
    '[class*="payment-method"], [class*="PaymentMethod"], ' +
    '[class*="seller-info"], [class*="SellerInfo"], ' +
    '[class*="store-logo"], [class*="StoreLogo"], ' +
    '[class*="brand-logo"], [class*="BrandLogo"]'
  );
  return !!badParent;
}

// Ã¢â€â‚¬Ã¢â€â‚¬ ISSUE 4 FIX: Find the main product gallery container Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// Returns the DOM element that wraps the primary product image area,
// or null if we cannot confidently identify one.
function findProductGalleryContainer() {
  // Priority-ordered CSS selectors for product image containers
  const gallerySelectors = [
    // Amazon
    '#imageBlock_feature_div',
    '#imageBlock',
    '#img-canvas',
    // Walmart / Sam's Club live vertical carousels
    '[data-testid="vertical-carousel-container"]',
    '[data-testid="vertical-hero-carousel"]',
    '[data-testid="hero-image-container"]',
    '[data-testid="item-page-vertical-carousel-hero-image-button"]',
    '[data-testid="media-thumbnail"]',
    '[data-testid="zoom-image"]',
    '[data-testid="zoom-panel"]',
    '[data-automation-id="product-media"]',
    '[data-testid="product-media"]',
    '.prod-hero-image-carousel-container',
    // Sam's Club
    '[data-testid="product-image-container"]',
    '.sc-image-viewer',
    '[class*="ImageViewer"]',
    // Faire
    '[data-testid*="product-image"]',
    '[class*="ProductImages"]',
    '[class*="productImages"]',
    // AliExpress
    '.pdp-comp-product-image',
    '[class*="gallery--wrap"]',
    // eBay
    '#vi-main-img-fs',
    '.ux-image-carousel',
    '[class*="image-carousel"]',
    // Shopify / WooCommerce generic
    '.product__media-wrapper',
    '.woocommerce-product-gallery',
    '[class*="product-gallery"]',
    '[class*="ProductGallery"]',
    '[class*="product-images"]',
    '[class*="ProductImages"]',
    // Temu
    '[class*="goods-gallery"]',
    '[class*="GoodsGallery"]',
    // Daraz / Noon / Flipkart / Lazada
    '.pdp-gallery',
    '.product-image-section',
    '[class*="ImageGallery"]',
    '[class*="image-gallery"]',
    '.fk-imgbox', // Flipkart
    '.EKFha-', // Flipkart
    '[class*="product-image"]',
    // Etsy
    '.listing-page-image-carousel',
    // Generic fallback Ã¢â‚¬â€ look for any element that contains multiple images
    // and is positioned in the upper portion of the page
    '[class*="media-gallery"]',
    '[class*="MediaGallery"]',
    '[class*="photo-gallery"]',
    '[class*="PhotoGallery"]',
    '[class*="carousel"][class*="image"]',
    '[class*="slider"][class*="product"]',
  ];

  for (const sel of gallerySelectors) {
    const el = document.querySelector(sel);
    if (el) return el;
  }

  // Heuristic fallback: find the first element that contains
  // Ã¢â€°Â¥2 images all with naturalWidth > 150, is within the top 60% of the page,
  // and is not inside a recommendations / reviews / footer section.
  const badAncestorSel =
    '[class*="recommend"], [class*="similar"], [class*="related"], ' +
    '[class*="review"], [class*="footer"], [class*="widget"], ' +
    '[class*="sponsored"], [id*="recommend"], [id*="related"]';

  const candidates = Array.from(document.querySelectorAll(
    'figure, [class*="gallery"], [class*="product"], [class*="image-wrap"], [class*="media-wrap"]'
  )).filter(el => {
    if (el.closest(badAncestorSel)) return false;
    const imgs = el.querySelectorAll('img');
    if (imgs.length < 1) return false;
    const rect = el.getBoundingClientRect();
    if (rect.top < 0 || rect.top > window.innerHeight * 2) return false; // too far down
    return true;
  });

  return candidates[0] || null;
}

// Collect images from within a DOM scope (gallery container or full document)
function collectScopedImages(scope) {
  const out = [];
  const imgs = (scope || document).querySelectorAll('img');
  imgs.forEach(img => {
    if (isBadImageElement(img)) return;
    const src = pickImgSrc(img);
    if (src) out.push(src);
  });
  return out;
}

function dedupeImages(arr) {
  const seen = new Set();
  const out = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== 'string') continue;
    const norm = normalizeImg(raw);
    if (isBadImage(norm)) continue;
    const key = canonImageKey(norm);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(norm);
  }
  return out;
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Video helpers Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
const VID_REGEX = /\.(mp4|webm|m3u8)([\?#]|$)/i;
const YT_REGEX  = /(youtube\.com\/(watch|embed|shorts|live)|youtu\.be\/)/i;

function ytWatch(url) {
  try {
    const u = new URL(url, location.href);
    const h = u.hostname.toLowerCase();
    let id = '';
    if (h.includes('youtu.be')) id = u.pathname.split('/').filter(Boolean)[0] || '';
    if (h.includes('youtube.com')) {
      id = u.searchParams.get('v') || '';
      const parts = u.pathname.split('/').filter(Boolean);
      for (const k of ['embed', 'shorts', 'live']) {
        const i = parts.indexOf(k);
        if (!id && i >= 0 && parts[i + 1]) id = parts[i + 1];
      }
    }
    return id ? `https://www.youtube.com/watch?v=${id}` : url;
  } catch (_) { return url || ''; }
}

function isVideoUrl(s) {
  if (!s || typeof s !== 'string') return false;
  if (s.startsWith('data:') || s.startsWith('blob:')) return false;
  return VID_REGEX.test(s) || YT_REGEX.test(s);
}

function dedupeVideos(arr) {
  const seen = new Set();
  const out = [];
  for (const raw of arr) {
    if (!isVideoUrl(raw)) continue;
    let s = absUrl(raw);
    if (YT_REGEX.test(s)) s = ytWatch(s);
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

// Ã¢â€â‚¬Ã¢â€â‚¬ DOM image collection Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
function pickImgSrc(img) {
  return (
    img.getAttribute('data-old-hires') ||
    img.getAttribute('data-zoom-image') ||
    img.getAttribute('data-image') ||
    img.getAttribute('data-large-image') ||
    img.getAttribute('data-src') ||
    img.getAttribute('data-lazy-src') ||
    img.getAttribute('data-original') ||
    img.src ||
    img.getAttribute('src') ||
    (img.getAttribute('srcset') || '').split(',').pop().trim().split(/\s+/)[0] ||
    ''
  );
}

function collectImagesBySelector(selector, scope) {
  const out = [];
  (scope || document).querySelectorAll(selector).forEach(img => {
    if (isBadImageElement(img)) return;
    const s = pickImgSrc(img);
    if (s && !isBadImage(s)) out.push(s);
  });
  return out;
}

function pickAmazonDynamic(img) {
  const raw = img.getAttribute('data-a-dynamic-image');
  if (!raw || !raw.startsWith('{')) return '';
  try {
    const parsed = JSON.parse(raw);
    const entries = Object.entries(parsed);
    entries.sort((a, b) => (b[1]?.[0] || 0) - (a[1]?.[0] || 0));
    return entries[0]?.[0] || '';
  } catch (_) { return ''; }
}

// Live marketplace gallery collector. Walmart and Sam's Club often render
// product media after the initial HTML response, using data-* attributes or
// srcset instead of a stable JSON payload.
function collectLiveMarketplaceImages(platform) {
  const out = [];
  const seen = new Set();
  const add = raw => {
    if (!raw || typeof raw !== 'string') return;
    const value = raw.trim().replace(/\\\//g, '/');
    if (!/^https?:|^\//i.test(value)) return;
    const abs = absUrl(value);
    if (isBadImage(abs)) return;
    const normalized = normalizeImg(abs);
    const key = canonImageKey(normalized);
    if (seen.has(key)) return;
    seen.add(key); out.push(normalized);
  };
  const addSrcset = raw => {
    if (!raw) return;
    const candidates = String(raw).split(',').map(part => {
      const bits = part.trim().split(/\s+/);
      const descriptor = bits[1] || '';
      const score = parseFloat(descriptor) || 0;
      return { url: bits[0], score };
    }).filter(item => item.url);
    candidates.sort((a, b) => b.score - a.score).forEach(item => add(item.url));
  };
  const gallerySelectors = platform === 'walmart' ? [
    '[data-automation-id="product-media"]', '[data-automation-id*="product"]',
    '[data-testid*="product-media"]', '[data-testid*="media"]', '[data-testid*="gallery"]',
    '[data-testid*="carousel"]', '[class*="prod-hero"]', '[class*="product-media"]',
    '[class*="ProductMedia"]', '[class*="gallery"]', '[class*="Gallery"]',
    'main', '[role="main"]'
  ] : [
    '[data-testid="product-image-container"]', '[data-testid*="item-page"]',
    '[data-testid*="product-image"]', '[data-testid*="media"]', '[data-testid*="gallery"]',
    '[class*="sc-image"]', '[class*="ImageViewer"]', '[class*="image-gallery"]',
    '[class*="product-image"]', '[class*="ProductImage"]', '[class*="gallery"]',
    'main', '[role="main"]'
  ];
  const scopes = [];
  const primary = findProductGalleryContainer();
  if (primary) scopes.push(primary);
  gallerySelectors.forEach(selector => document.querySelectorAll(selector).forEach(el => scopes.push(el)));
  if (!scopes.length) scopes.push(document);
  const elements = new Set();
  scopes.forEach(scope => scope.querySelectorAll('img, source, [data-image-url], [data-image-src], [data-zoom-image], [data-src], [data-lazy-src]').forEach(el => elements.add(el)));
  elements.forEach(el => {
    if (el.tagName === 'IMG' && isBadImageElement(el)) return;
    ['data-old-hires', 'data-zoom-image', 'data-image-url', 'data-image-src', 'data-large-image', 'data-src', 'data-lazy-src', 'data-original', 'src'].forEach(attr => add(el.getAttribute(attr)));
    addSrcset(el.getAttribute('srcset') || el.getAttribute('data-srcset'));
    if (el.tagName === 'IMG' && el.naturalWidth >= 80) add(el.currentSrc || el.src);
  });
  return out;
}

// Ã¢â€â‚¬Ã¢â€â‚¬ DOM video collection Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
function collectDomVideos() {
  const out = [];
  document.querySelectorAll('video').forEach(v => {
    out.push(v.currentSrc || v.src || v.getAttribute('src') || '');
    v.querySelectorAll('source').forEach(s => out.push(s.src || s.getAttribute('src') || ''));
  });
  document.querySelectorAll(
    'meta[property="og:video"], meta[property="og:video:url"], meta[property="og:video:secure_url"], meta[name="twitter:player"], meta[name="twitter:player:stream"]'
  ).forEach(m => out.push(m.content));
  document.querySelectorAll(
    'iframe[src*="youtube.com"], iframe[src*="youtu.be"], iframe[src*="vimeo.com"], iframe[src*="brightcove"]'
  ).forEach(f => out.push(f.src || ''));
  document.querySelectorAll('[data-video-url], [data-video-src], [data-mp4], [data-video]').forEach(el => {
    ['data-video-url', 'data-video-src', 'data-mp4', 'data-video'].forEach(a => {
      const v = el.getAttribute(a);
      if (v) out.push(v);
    });
  });
  return out;
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Deep JSON media walker Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// ISSUE 1 FIX: Only pick up price from offer/price-typed string fields
// that already contain a currency symbol (e.g. "$29.98"), not bare numbers.
// Bare numeric prices from JSON are unreliable and cause wrong price bugs.
function walkJsonForMedia(rootJson, found) {
  const stack = [{ node: rootJson, depth: 0 }];
  while (stack.length > 0) {
    const { node: json, depth } = stack.pop();
    if (!json || depth > 12) continue;
    const d = depth + 1;
    
    if (typeof json === 'string') {
      const s = json;
      if (s.length > 8192) continue;
      if (/^https?:\/\//i.test(s)) {
        if (/\.(jpg|jpeg|png|webp|gif|avif)(\?|#|$)/i.test(s) && !isBadImage(s)) found.images.push(s);
        if (isVideoUrl(s)) found.videos.push(s);
      }
      continue;
    }
    if (Array.isArray(json)) {
      for (let i = json.length - 1; i >= 0; i--) stack.push({ node: json[i], depth: d });
      continue;
    }
    if (typeof json === 'object') {
      for (const [k, v] of Object.entries(json)) {
        if (typeof v === 'string') {
          if (!found.price && /^(price|currentPrice|salePrice|displayPrice|priceFormatted|formattedPrice|currentPriceFormatted)$/i.test(k)) {
            if (/[$Ã‚Â£Ã¢â€šÂ¬Ã‚Â¥Ã¢â€šÂ¹Ã¢â€šÂ©]/.test(v) && /\d/.test(v)) {
              const cleaned = cleanPriceText(v);
              if (cleaned) found.price = cleaned;
            }
          }
          if (/^(url|src|href|contentUrl|embedUrl|videoUrl|video_url|mp4|hls|thumbnailUrl|imageUrl|image_url)$/i.test(k)) {
            if (/^https?:\/\//i.test(v)) {
              if (/\.(jpg|jpeg|png|webp|gif|avif)(\?|#|$)/i.test(v) && !isBadImage(v)) found.images.push(v);
              if (isVideoUrl(v)) found.videos.push(v);
            }
          }
        }
        stack.push({ node: v, depth: d });
      }
    }
  }
}

async function harvestInlineJson() {
  // Return cached result from this page load if available
  if (_harvestCache) return _harvestCache;

  const found = { images: [], videos: [], price: '' };
  // Dedup guard: all video pushes go through addFoundVideo() which checks this Set.
  // Prevents duplicates when Brightcove sources[] and renditions[] overlap,
  // or when the same URL appears in both __NEXT_DATA__ and an inline <script>.
  const _vidSet = new Set();
  const addFoundVideo = (v) => {
    if (!v || typeof v !== 'string') return;
    const clean = v.replace(/\\\//g, '/').trim();
    if (!clean.startsWith('http') || _vidSet.has(clean)) return;
    _vidSet.add(clean);
    found.videos.push(clean);
  };

  // Ã¢â€â‚¬Ã¢â€â‚¬ PRODUCT IDENTITY ANCHOR Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  // Derive a short fingerprint from the current page URL path so we can
  // reject images that belong to unrelated products embedded in the same
  // JSON blob (e.g. "Customers also bought" carousels on Amazon/Walmart).
  //
  // Strategy: extract the last meaningful path segment(s) that are likely
  // the product identifier (ASIN, item ID, SKU, etc.).
  // Images are only filtered by this key when we can reliably extract one.
  let productPathKey = '';
  try {
    const pathParts = location.pathname.split('/').filter(Boolean);
    // Amazon: /dp/ASIN or /gp/product/ASIN
    const dpIdx = pathParts.indexOf('dp');
    const gpIdx = pathParts.indexOf('product');
    if (dpIdx >= 0 && pathParts[dpIdx + 1]) productPathKey = pathParts[dpIdx + 1].toLowerCase();
    else if (gpIdx >= 0 && pathParts[gpIdx + 1]) productPathKey = pathParts[gpIdx + 1].toLowerCase();
    // Walmart: /ip/product-name/ITEM_ID
    else if (/walmart/i.test(location.hostname)) {
      const numPart = pathParts.find(p => /^\d{6,}$/.test(p));
      if (numPart) productPathKey = numPart;
    }
    // Sam's Club: /ip/product-name/ITEM_ID
    else if (/samsclub/i.test(location.hostname)) {
      const numPart = pathParts.find(p => /^\d{6,}$/.test(p));
      if (numPart) productPathKey = numPart;
    }
    // eBay: /itm/ITEM_ID
    const itmIdx = pathParts.indexOf('itm');
    if (!productPathKey && itmIdx >= 0 && pathParts[itmIdx + 1]) {
      productPathKey = pathParts[itmIdx + 1].toLowerCase();
    }
    // Generic: last all-digit segment of length 6+
    if (!productPathKey) {
      const last = [...pathParts].reverse().find(p => /^\d{6,}$/.test(p));
      if (last) productPathKey = last;
    }
  } catch (_) {}

  // Helper: does this image URL plausibly belong to the current product?
  // When we have a product key, reject images whose path contains a DIFFERENT
  // product ID of the same format (e.g. different ASIN embedded in image URL).
  function isLikelyCurrentProduct(imgUrl) {
    if (!productPathKey || productPathKey.length < 6) return true; // no key Ã¢â€ â€™ accept all
    try {
      const path = new URL(imgUrl).pathname.toLowerCase();
      // If the key appears in the image path Ã¢â€ â€™ definitely this product
      if (path.includes(productPathKey)) return true;
      // Amazon images embed the ASIN in their path. If there's a different
      // ASIN-like segment (10 uppercase alphanum chars) in the image path,
      // reject it Ã¢â‚¬â€ it belongs to another product.
      if (/media-amazon\.com|ssl-images-amazon/i.test(imgUrl)) {
        const asinMatch = path.match(/\/([A-Z0-9]{10})\//i);
        if (asinMatch && asinMatch[1].toLowerCase() !== productPathKey) return false;
      }
      return true;
    } catch (_) { return true; }
  }

  const nextEl = document.querySelector('script#__NEXT_DATA__');
  if (nextEl) {
    try { walkJsonForMedia(JSON.parse(nextEl.textContent || '{}'), found); } catch (_) {}
  }

  document.querySelectorAll('script[type="application/json"]').forEach(s => {
    try { walkJsonForMedia(JSON.parse(s.textContent || '{}'), found); } catch (_) {}
  });

  document.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
    try {
      const parsed = JSON.parse(s.textContent || '{}');
      walkJsonForMedia(parsed, found);
    } catch (_) {}
  });

  const allScripts = Array.from(document.querySelectorAll('script:not([src])'));
  
  for (const s of allScripts) {
    const t = s.textContent || '';
    if (t.length < 200 || t.length > 2_000_000) continue;
    if (!/__PRELOADED_STATE__|__INITIAL_STATE__|__APOLLO_STATE__|window\.__/.test(t)) continue;
    (t.match(/https?:\\?\/?\\?\/?[^"'\\s]+?\.(?:mp4|webm|m3u8)(?:\?[^"'\\s]*)?/gi) || [])
      .forEach(v => addFoundVideo(v));
    (t.match(/https?:\\?\/?\\?\/?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)[\w-]{6,}/gi) || [])
      .forEach(v => addFoundVideo(v));
    (t.match(/https?:\\?\/?\\?\/?[^"'\\s]*brightcove[^"'\\s]*/gi) || [])
      .forEach(v => addFoundVideo(v));
    (t.match(/https?:\\?\/?\\?\/?scene7\.samsclub\.com\/[^"'\\s]+(?:\.mp4|\/is\/content\/[^"'\\s]+)/gi) || [])
      .forEach(v => addFoundVideo(v));
  }

  // Second pass: catch Brightcove player init scripts that don't contain window.__ globals.
  // These scripts hold sources[]/renditions[] but fail the __PRELOADED_STATE__ guard above.
  for (const s of allScripts) {
    const t = s.textContent || '';
    if (t.length < 50 || t.length > 3_000_000) continue;
    if (!/brightcove|"renditions"\s*:\s*\[|"sources"\s*:\s*\[|walmartimages[^"']*\.mp4/i.test(t)) continue;
    // Brightcove sources: "src":"https://...mp4"
    for (const m of t.matchAll(/"src"\s*:\s*"(https?:[^"]+\.(?:mp4|m3u8|webm)[^"]*)"/gi))
      addFoundVideo(m[1]);
    // Brightcove renditions: "url":"https://...mp4"
    for (const m of t.matchAll(/"url"\s*:\s*"(https?:[^"]+\.(?:mp4|m3u8|webm)[^"]*)"/gi))
      addFoundVideo(m[1]);
    // Walmart CDN video URLs in any script
    for (const m of t.matchAll(/https?:\\?\/?\/?[^\s"']*walmartimages\.com[^\s"']*\.(?:mp4|m3u8)/gi))
      addFoundVideo(m[0]);
  }

  // JSON-LD offer price Ã¢â‚¬â€ only use currency-bearing string prices
  if (!found.price) {
    document.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
      try {
        const root = JSON.parse(s.textContent || '{}');
        const stack = Array.isArray(root) ? [...root] : [root];
        while (stack.length) {
          const it = stack.shift();
          if (!it || typeof it !== 'object') continue;
          const offers = it.offers;
          if (offers) {
            const arr = Array.isArray(offers) ? offers : [offers];
            for (const o of arr) {
              const rawPrice = o.price || o.lowPrice;
              const currency = o.priceCurrency || o.priceSpecification?.priceCurrency || '';
              if (rawPrice !== undefined && rawPrice !== null && rawPrice !== '') {
                // Map currency code to symbol for display
                const symMap = { USD: '$', GBP: 'Ã‚Â£', EUR: 'Ã¢â€šÂ¬', JPY: 'Ã‚Â¥', INR: 'Ã¢â€šÂ¹', KRW: 'Ã¢â€šÂ©', CAD: 'CA$', AUD: 'AU$', PKR: 'Ã¢â€šÂ¨' };
                const sym = symMap[currency.toUpperCase()] || (currency ? currency + ' ' : '$');
                found.price = `${sym}${rawPrice}`.replace(/\s+/g, '');
                break;
              }
            }
          }
          if (found.price) break;
          Object.values(it).forEach(v => { if (v && typeof v === 'object') stack.push(v); });
        }
      } catch (_) {}
    });
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ POST-HARVEST PRODUCT FILTER Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  // Remove images that belong to other products embedded in the JSON
  // (related/upsell carousels, "also bought" grids, etc.)
  if (productPathKey) {
    found.images = found.images.filter(u => isLikelyCurrentProduct(u));
  }

  // Final dedup for all pushes in walkJsonForMedia
  const finalVidSet = new Set();
  const finalVids = [];
  for (const v of found.videos) {
    if (!v || typeof v !== 'string') continue;
    const clean = v.replace(/\\\//g, '/').trim();
    if (!clean.startsWith('http') || finalVidSet.has(clean)) continue;
    finalVidSet.add(clean);
    finalVids.push(clean);
  }
  found.videos = finalVids;

  _harvestCache = found; // cache for subsequent calls on this page load
  return found;
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Variants Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
function collectVariants() {
  const out = [];
  document.querySelectorAll(
    'select option, [aria-label*="option" i], [data-testid*="variant" i], ' +
    '[data-automation-id*="variant" i], [class*="variant" i], [class*="swatch" i], ' +
    'button[aria-label*="Size" i], button[aria-label*="Color" i]'
  ).forEach(el => {
    const t = (el.innerText || el.textContent || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
    if (t && t.length < 80 && !/^(select|choose|undefined|Ã¢â‚¬â€|-)$/i.test(t) && !out.includes(t)) {
      out.push(t);
    }
  });
  return out.slice(0, 20);
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Generic price lookup Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
function priceFromSelectors(selectors) {
  for (const sel of selectors) {
    for (const el of document.querySelectorAll(sel)) {
      const raw =
        el.getAttribute?.('content') ||
        el.getAttribute?.('aria-label') ||
        el.innerText ||
        el.textContent ||
        '';
      const c = cleanPriceText(raw);
      if (c && /\d/.test(c)) return c;
    }
  }
  return '';
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Sam's Club precise price reader (v2) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// Sam's Club 2024/2025: price can be in multiple formats.
// Priority: aria-label Ã¢â€ â€™ structured data Ã¢â€ â€™ characteristic+mantissa Ã¢â€ â€™ JSON-LD Ã¢â€ â€™ script
// Ã¢â€â‚¬Ã¢â€â‚¬ Sam's Club precise price reader (v3 Ã¢â‚¬â€ fully rewritten) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// Priority order: aria-label Ã¢â€ â€™ split-price DOM Ã¢â€ â€™ meta itemprop Ã¢â€ â€™
//   JSON-LD Ã¢â€ â€™ __NEXT_DATA__ deep walk Ã¢â€ â€™ inline script regex fallback
function readSamsClubPrice() {
  const sym = detectPageCurrencySymbol() || '$';

  // Ã¢â€â‚¬Ã¢â€â‚¬ 1. aria-label on price wrapper elements Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  const ariaEls = document.querySelectorAll(
    'span[aria-label], [data-testid="product-price"], [data-automation-id="product-price"], ' +
    '[class*="PriceDisplay"] span[aria-label], [class*="price-display"] span[aria-label], ' +
    '[class*="sc-price"] span[aria-label], [id*="price"] span[aria-label]'
  );
  for (const el of ariaEls) {
    const raw = el.getAttribute('aria-label') || '';
    if (!raw) continue;
    const c = cleanPriceText(raw);
    if (c && /\d/.test(c)) return ensureCurrency(c, sym);
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ 2. Split-price: characteristic + mantissa Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  const charEl = document.querySelector(
    '.Price-characteristic, [class*="Price-characteristic"], [class*="price-characteristic"], ' +
    '[class*="priceCharacteristic"], [class*="PriceCharacteristic"]'
  );
  const mantEl = document.querySelector(
    '.Price-mantissa, [class*="Price-mantissa"], [class*="price-mantissa"], ' +
    '[class*="priceMantissa"], [class*="PriceMantissa"]'
  );
  if (charEl) {
    const whole = (charEl.getAttribute('content') || charEl.innerText || charEl.textContent || '').replace(/[^0-9,]/g, '');
    const frac  = mantEl ? (mantEl.innerText || mantEl.textContent || '').replace(/[^0-9]/g, '') : '';
    if (whole) return frac ? `${sym}${whole}.${frac}` : `${sym}${whole}`;
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ 3. itemprop="price" Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  const itmProp = document.querySelector('[itemprop="price"]');
  if (itmProp) {
    const raw = itmProp.getAttribute('content') || itmProp.innerText || itmProp.textContent || '';
    const c = cleanPriceText(raw) || raw.trim();
    if (c && /\d/.test(c)) return ensureCurrency(c, sym);
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ 4. JSON-LD offer price Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const root = JSON.parse(s.textContent || '{}');
      const stack = Array.isArray(root) ? [...root] : [root];
      while (stack.length) {
        const it = stack.shift();
        if (!it || typeof it !== 'object') continue;
        const o = it.offers || it.Offers;
        if (o) {
          const arr = Array.isArray(o) ? o : [o];
          for (const of_ of arr) {
            const p = of_.price || of_.lowPrice;
            if (p !== undefined && p !== null && p !== '') {
              const symMap = { USD:'$', GBP:'Ã‚Â£', EUR:'Ã¢â€šÂ¬', JPY:'Ã‚Â¥', INR:'Ã¢â€šÂ¹', KRW:'Ã¢â€šÂ©', CAD:'CA$', AUD:'AU$' };
              const cur = of_.priceCurrency || '';
              const cs = symMap[cur.toUpperCase()] || sym;
              return `${cs}${p}`;
            }
          }
        }
        Object.values(it).forEach(v => { if (v && typeof v === 'object') stack.push(v); });
      }
    } catch (_) {}
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ 5. __NEXT_DATA__ deep walk Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  const nextEl = document.getElementById('__NEXT_DATA__');
  if (nextEl) {
    try {
      const nd = JSON.parse(nextEl.textContent || '{}');

      function getDeepSC(obj, ...keys) {
        let cur = obj;
        for (const k of keys) {
          if (!cur || typeof cur !== 'object') return undefined;
          cur = Array.isArray(cur) ? cur[0]?.[k] : cur[k];
        }
        return cur;
      }

      const candidates = [
        getDeepSC(nd, 'props', 'pageProps', 'initialData', 'data', 'product', 'priceInfo', 'finalPrice'),
        getDeepSC(nd, 'props', 'pageProps', 'initialData', 'data', 'product', 'priceInfo', 'itemPrice'),
        getDeepSC(nd, 'props', 'pageProps', 'initialData', 'data', 'product', 'priceInfo', 'listPrice'),
        getDeepSC(nd, 'props', 'pageProps', 'initialData', 'data', 'priceInfo', 'finalPrice'),
        getDeepSC(nd, 'props', 'pageProps', 'initialData', 'data', 'priceInfo', 'itemPrice'),
        getDeepSC(nd, 'props', 'pageProps', 'initialData', 'data', 'product', 'offerList', 0, 'priceInfo', 'finalPrice'),
        getDeepSC(nd, 'props', 'pageProps', 'initialData', 'data', 'product', 'offerList', 0, 'priceInfo', 'itemPrice'),
      ];
      for (const v of candidates) {
        if (typeof v === 'number' && v > 0) return `${sym}${v.toFixed(2)}`;
        if (typeof v === 'string' && /\d/.test(v)) {
          const c = cleanPriceText(v);
          if (c) return ensureCurrency(c, sym);
        }
      }

      function scDeepPrice(obj, depth) {
        if (!obj || typeof obj !== 'object' || depth > 15) return '';
        const priceKeys = ['finalPrice', 'itemPrice', 'salePrice', 'currentPrice', 'displayPrice',
                           'listPrice', 'price', 'regularPrice', 'memberPrice', 'clubPrice'];
        for (const key of priceKeys) {
          if (key in obj) {
            const v = obj[key];
            if (typeof v === 'number' && v > 0) return `${sym}${v.toFixed(2)}`;
            if (typeof v === 'string' && /\d/.test(v)) {
              const c = cleanPriceText(v);
              if (c) return ensureCurrency(c, sym);
            }
          }
        }
        for (const v of Object.values(obj)) {
          if (v && typeof v === 'object') {
            const res = scDeepPrice(v, depth + 1);
            if (res) return res;
          }
        }
        return '';
      }
      const found = scDeepPrice(nd, 0);
      if (found) return found;
    } catch (_) {}
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ 6. Inline script regex fallback Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  for (const s of document.querySelectorAll('script:not([src])')) {
    const t = s.textContent || '';
    if (t.length < 50 || t.length > 3_000_000) continue;
    if (!/finalPrice|itemPrice|salePrice|clubPrice|memberPrice/.test(t)) continue;
    const m = t.match(/"(?:finalPrice|itemPrice|salePrice|clubPrice|memberPrice)"\s*:\s*([\d.]+)/);
    if (m && parseFloat(m[1]) > 0) return `${sym}${parseFloat(m[1]).toFixed(2)}`;
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ 7. Generic DOM fallback Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  const genericSelectors = [
    '[data-testid="price"]', '[data-automation-id="price"]',
    '[class*="price-display"]', '[class*="PriceDisplay"]',
    '[class*="sc-price"]', '[class*="priceInfo"]',
    '.price', '#price'
  ];
  for (const sel of genericSelectors) {
    for (const el of document.querySelectorAll(sel)) {
      const raw = el.getAttribute('content') || el.innerText || el.textContent || '';
      const c = cleanPriceText(raw);
      if (c && /\d/.test(c)) return ensureCurrency(c, sym);
    }
  }

  return '';
}


// Ã¢â€â‚¬Ã¢â€â‚¬ ISSUE 1 FIX: Walmart precise price reader Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
function readWalmartPrice() {
  // Prefer aria-label on the price wrapper (has the full formatted price)
  const ariaSelectors = [
    '[itemprop="price"]',
    '[data-automation-id="product-price"] [itemprop="price"]',
    '[data-automation-id="product-price"]',
    'span[aria-label*="$"]',
    'span[aria-label*="Ã‚Â£"]',
    'span[aria-label*="Ã¢â€šÂ¬"]'
  ];
  for (const sel of ariaSelectors) {
    for (const el of document.querySelectorAll(sel)) {
      const raw = el.getAttribute('aria-label') || el.getAttribute('content') || el.innerText || '';
      const c = cleanPriceText(raw);
      if (c && /\d/.test(c)) return c;
    }
  }

  // Reconstruct from characteristic + mantissa
  const charEl = document.querySelector('.price-characteristic, [itemprop="price"]');
  const mantEl = document.querySelector('.price-mantissa');
  if (charEl) {
    const whole = charEl.getAttribute('content') || charEl.innerText.replace(/[^0-9,]/g, '');
    const frac  = mantEl ? mantEl.innerText.replace(/[^0-9]/g, '') : '00';
    if (whole) return `$${whole}${frac ? '.' + frac : ''}`;
  }
  return '';
}

// Ã¢â€â‚¬Ã¢â€â‚¬ ISSUE 3 FIX: Universal e-commerce price reader Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// Reads price from any e-commerce page using a priority waterfall.
function universalPrice() {
  const sym = detectPageCurrencySymbol();
  const p = priceFromSelectors([
    // Schema.org meta
    'meta[property="product:price:amount"]',
    'meta[itemprop="price"]',
    // Structured data attributes
    '[itemprop="price"]',
    '[data-price]',
    // Common class patterns (ordered most-specific first)
    '.product-price .price',
    '.product__price .price',
    '.entry-price',
    '.single_variation_wrap .price .amount',
    '.woocommerce-Price-amount',   // WooCommerce
    '.bc-pricing__value',          // BigCommerce
    '.ProductMeta__Price',
    '.price-item--sale',
    '.price-item--regular',
    // Flipkart
    '._30jeq3._16Jk6d',
    '._30jeq3',
    // Noon
    '.priceNow',
    '.price-now',
    // Lazada / Shopee patterns
    '[class*="pdp-price"][class*="current"]',
    '[class*="current-price"]',
    '[class*="sale-price"]',
    '[class*="selling-price"]',
    '[class*="discounted-price"]',
    // Fallback catch-all (not script/style, not shipping)
    '[class*="price"]:not(script):not(style):not([class*="shipping"]):not([class*="original"]):not([class*="was"]):not([class*="strike"])',
    '[id*="price"]:not(script):not(style)'
  ]);
  if (p) return ensureCurrency(p, sym);

  // data-price attribute fallback
  const dp = document.querySelector('[data-price]')?.getAttribute('data-price');
  if (dp && /[\d.]+/.test(dp)) return `${sym}${dp}`;

  return '';
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
//                  PLATFORM SCRAPERS
// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

// ISSUE 4 FIX: All scrapers now collect images from gallery scope only,
// not from the full document.

function scrapeAmazon() {
  const r = { title: '', price: '', images: [], videos: [], variants: [] };

  const titleEl = document.querySelector('#productTitle, #title span, h1.a-size-large, #title_feature_div #title');
  if (titleEl) r.title = titleEl.innerText.trim();
  // If DOM title is empty (e.g. page still loading), try og:title Ã¢â‚¬â€ never fall back to document.title
  // because Amazon sets it to "Adding to Cart..." during cart operations.
  if (!r.title) {
    const og = document.querySelector('meta[property="og:title"]');
    if (og?.content) r.title = og.content.trim();
  }

  // ISSUE 1 FIX: prefer .a-offscreen inside non-strikethrough price elements
  r.price = priceFromSelectors([
    '#corePrice_feature_div .a-price:not(.a-text-price) .a-offscreen',
    '#apex_offerDisplay_desktop .a-price:not(.a-text-price) .a-offscreen',
    '.priceToPay .a-offscreen',
    '.apexPriceToPay .a-offscreen',
    '#priceblock_ourprice', '#priceblock_dealprice', '#priceblock_saleprice',
    '.a-price:not([data-a-strike]):not(.a-text-price) .a-offscreen'
  ]);
  if (!r.price) {
    const w = document.querySelector('.a-price-whole')?.innerText.replace(/[^0-9,]/g, '');
    const f = document.querySelector('.a-price-fraction')?.innerText.replace(/[^0-9]/g, '') || '00';
    if (w) r.price = `$${w}.${f}`;
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ TWO-TIER URL QUALITY STRATEGY Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  //
  // PROBLEM: Different Amazon JSON keys have different URL quality contracts:
  //   "hiRes"  = true original upload URL (clean or has modifier, always best)
  //   "large"  = bounded-size URL (e.g. ._SL1500_.) guaranteed by Amazon CDN
  //   "thumb"  = tiny thumbnail URL
  //
  // WRONG approach (caused the bug): stripping modifier from ALL sources.
  //   For "hiRes" Ã¢â€ â€™ strip modifier Ã¢â€ â€™ clean URL Ã¢â€ â€™ Amazon serves ORIGINAL Ã¢Å“â€¦
  //   For "large" Ã¢â€ â€™ strip modifier Ã¢â€ â€™ clean URL Ã¢â€ â€™ Amazon may serve DEFAULT
  //                 size (e.g. 500px) which is WORSE than the original _SL1500_ Ã¢ÂÅ’
  //
  // CORRECT approach: different treatment per source:
  //   "hiRes"  Ã¢â€ â€™ strip modifier Ã¢â€ â€™ clean URL Ã¢â€ â€™ original upload quality
  //   "large"  Ã¢â€ â€™ replace modifier with _SL1500_ Ã¢â€ â€™ guaranteed 1500px
  //   "thumb"  Ã¢â€ â€™ replace modifier with _SL1500_ Ã¢â€ â€™ guaranteed 1500px
  //   raw scan Ã¢â€ â€™ replace modifier with _SL1500_ Ã¢â€ â€™ guaranteed 1500px
  //
  // This way: products where ALL images have hiRes Ã¢â€ â€™ original quality for all.
  //           Products where SOME images have hiRes=null Ã¢â€ â€™ 1500px for those.

  // For hiRes source: strip modifier entirely Ã¢â€ â€™ original upload quality
  function cleanHiRes(url) {
    if (!url || typeof url !== 'string' || !url.startsWith('http')) return null;
    return url.replace(/\._[A-Za-z0-9_,]+_\./g, '.');
  }

  // For large/thumb/fallback: replace modifier with _SL1500_ Ã¢â€ â€™ guaranteed 1500px
  // NOT stripping, because Amazon may not CDN-cache the original for these paths.
  function upscaleTo1500(url) {
    if (!url || typeof url !== 'string' || !url.startsWith('http')) return null;
    return url.replace(/\._[A-Za-z0-9_,]+_\./g, '._SL1500_.');
  }

  const seenKeys = new Set();

  // Add image from hiRes source Ã¢â€ â€™ original quality
  function addHiResImg(url) {
    const clean = cleanHiRes(url);
    if (!clean) return;
    const key = canonImageKey(clean);
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    r.images.push(clean);
  }

  // Add image from fallback source Ã¢â€ â€™ 1500px quality
  function addFallbackImg(url) {
    const sized = upscaleTo1500(url);
    if (!sized) return;
    const key = canonImageKey(sized);
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    r.images.push(sized);
  }

  // DOM-first gallery extraction: the visible gallery is authoritative. This
  // prevents recommendation/variant media found in page-wide scripts from
  // inflating the product count. Amazon's two layouts share these selectors.
  const amazonGalleryImages = document.querySelectorAll(
    '#landingImage, #imgTagWrapperId img, #altImages img, .a-button-thumbnail img, .imageThumbnail img'
  );
  amazonGalleryImages.forEach(img => {
    const candidates = [
      img.getAttribute('data-old-hires') || '',
      pickAmazonDynamic(img),
      img.getAttribute('data-zoom-image') || '',
      img.getAttribute('data-large-image') || '',
      img.src || img.getAttribute('data-src') || ''
    ];
    candidates.forEach(candidate => {
      if (/play[-_]?button|video[-_]?thumbnail|pkplay/i.test(candidate)) return;
      if (img.getAttribute('data-old-hires') === candidate) addHiResImg(candidate);
      else addFallbackImg(candidate);
    });
  });

  // Pass 1: Script tag JSON extraction Ã¢â‚¬â€ only if the visible gallery was empty.
  const scripts = document.querySelectorAll('script');
  if (r.images.length === 0) for (const script of scripts) {
    const t = script.textContent || '';
    if (!t.includes('colorImages') && !t.includes('ImageBlockATF') &&
        !t.includes('hiRes') && !t.includes('thumbImages')) continue;

    let match;

    // "hiRes" Ã¢â€ â€™ original quality (strip modifier Ã¢â€ â€™ clean URL)
    const hiResDQ = /"hiRes"\s*:\s*"(https:\/\/[^"]+)"/g;
    while ((match = hiResDQ.exec(t)) !== null) addHiResImg(match[1]);

    const hiResSQ = /'hiRes'\s*:\s*'(https:\/\/[^']+)'/g;
    while ((match = hiResSQ.exec(t)) !== null) addHiResImg(match[1]);

    // "large" Ã¢â€ â€™ 1500px quality (keep/replace with _SL1500_)
    const largeDQ = /"large"\s*:\s*"(https:\/\/[^"]+)"/g;
    while ((match = largeDQ.exec(t)) !== null) addFallbackImg(match[1]);

    // "thumb" Ã¢â€ â€™ upscale to 1500px
    const thumbDQ = /"thumb"\s*:\s*"(https:\/\/[^"]+)"/g;
    while ((match = thumbDQ.exec(t)) !== null) addFallbackImg(match[1]);

    // "main":{...} Ã¢â‚¬â€ extract all URLs and upscale to 1500px
    const mainKeyRegex = /"main"\s*:\s*\{/g;
    let mk;
    while ((mk = mainKeyRegex.exec(t)) !== null) {
      let depth = 1;
      let i = mk.index + mk[0].length;
      while (i < t.length && depth > 0) {
        if (t[i] === '{') depth++;
        else if (t[i] === '}') depth--;
        i++;
      }
      const block = t.slice(mk.index + mk[0].length, i - 1);
      (block.match(/https:\/\/[^"'\s]+/g) || []).forEach(u => addFallbackImg(u));
    }
  }

  // Pass 2: Raw Amazon CDN URL scan Ã¢â‚¬â€ only if targeted script extraction found nothing.
  if (r.images.length === 0) for (const script of scripts) {
    const t = script.textContent || '';
    const rawScan = /https:\/\/(?:m\.media-amazon\.com|images-amazon\.com)\/images\/I\/[A-Za-z0-9%+\-_.]+\.(?:jpg|jpeg|png|webp)/g;
    let match;
    while ((match = rawScan.exec(t)) !== null) addFallbackImg(match[0]);
  }

  // Pass 3 (DOM fallback): used when script scans yield nothing (rare).
  if (r.images.length === 0) {
    const landingImage = document.getElementById('landingImage');
    if (landingImage) {
      const oldHires = landingImage.getAttribute('data-old-hires');
      if (oldHires) addHiResImg(oldHires);  // data-old-hires = true hi-res
      else addFallbackImg(landingImage.src); // src = fallback
    }

    document.querySelectorAll('.a-button-thumbnail img').forEach(img => {
      addHiResImg(img.getAttribute('data-old-hires') || '');
      addFallbackImg(pickAmazonDynamic(img) || img.src || '');
    });

    const imgEls = document.querySelectorAll(
      '#altImages img, #imgTagWrapperId img, #imageBlock img, .imageThumbnail img'
    );
    imgEls.forEach(img => {
      if (img.closest('[class*="review"]')) return;
      addHiResImg(img.getAttribute('data-old-hires') || '');
      addFallbackImg(
        pickAmazonDynamic(img) ||
        img.getAttribute('data-zoom-image') ||
        img.getAttribute('data-large-image') ||
        img.src || img.getAttribute('data-src') || ''
      );
    });
  }



  // Ã¢â€â‚¬Ã¢â€â‚¬ AMAZON VIDEO EXTRACTION Ã¢â‚¬â€ Multi-pass with dedup Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  // Amazon embeds video data in several places:
  //   1. Standard mp4/m3u8 URLs in script tags
  //   2. Amazon-specific JSON keys: videoDisplayInfos, videoSrc, immersionVideoUrl, videoCatalogUrl
  //   3. Amazon CDN: aiv-delivery.net, video.media-amazon.com
  //   4. HTML5 <video> elements and data-video-url attributes
  //   5. og:video meta tags
  const _vidSet = new Set();
  const addAmazonVideo = (v) => {
    if (!v || typeof v !== 'string') return;
    const clean = v.replace(/\\\//g, '/').replace(/\\u002F/gi, '/').trim();
    if (!clean.startsWith('http') || _vidSet.has(clean)) return;
    _vidSet.add(clean);
    r.videos.push(clean);
  };

  document.querySelectorAll('script:not([src])').forEach(s => {
    let t = s.textContent || '';
    t = t.replace(/\\\//g, '/').replace(/\\u002F/ig, '/');

    // Pass 1: Standard mp4/m3u8 URLs anywhere in script
    if (/\.(mp4|m3u8)/i.test(t)) {
      (t.match(/https?:\/\/[^"'\s\\]+\.(?:mp4|m3u8)[^"'\s\\]*/gi) || [])
        .forEach(url => addAmazonVideo(url));
    }

    // Pass 2: Amazon-specific JSON video keys
    // Amazon embeds videoDisplayInfos[] array with videoSrc, plus top-level
    // immersionVideoUrl and videoCatalogUrl in the page's data JSON blobs.
    if (/videoDisplayInfos|videoSrc|immersionVideoUrl|videoCatalogUrl|videoUrl/i.test(t)) {
      for (const m of t.matchAll(/"videoSrc"\s*:\s*"(https?:[^"]+)"/gi))          addAmazonVideo(m[1]);
      for (const m of t.matchAll(/"videoUrl"\s*:\s*"(https?:[^"]+)"/gi))          addAmazonVideo(m[1]);
      for (const m of t.matchAll(/"immersionVideoUrl"\s*:\s*"(https?:[^"]+)"/gi)) addAmazonVideo(m[1]);
      for (const m of t.matchAll(/"videoCatalogUrl"\s*:\s*"(https?:[^"]+)"/gi))   addAmazonVideo(m[1]);
      for (const m of t.matchAll(/"videoThumbnailUrl"\s*:\s*"(https?:[^"]+\.(?:mp4|m3u8)[^"]*)"/gi)) addAmazonVideo(m[1]);
    }

    // Pass 3: Amazon CDN URLs Ã¢â‚¬â€ aiv-delivery.net and video.media-amazon.com
    // These appear even without .mp4 extension in the URL string.
    if (/aiv-delivery\.net|video\.media-amazon\.com/i.test(t)) {
      for (const m of t.matchAll(/https?:\/\/[^"'\s\\]*(?:aiv-delivery\.net|video\.media-amazon\.com)[^"'\s\\]*/gi))
        addAmazonVideo(m[0]);
    }
  });

  // Pass 4: HTML5 video elements and data-video-url attributes in DOM
  document.querySelectorAll('video, video source, [data-video-url], [data-video-src]').forEach(el => {
    addAmazonVideo(el.currentSrc || '');
    addAmazonVideo(el.src || '');
    addAmazonVideo(el.getAttribute('src') || '');
    addAmazonVideo(el.getAttribute('data-video-url') || '');
    addAmazonVideo(el.getAttribute('data-video-src') || '');
  });

  // Pass 5: og:video meta tags
  document.querySelectorAll(
    'meta[property="og:video"], meta[property="og:video:url"], meta[name="twitter:player:stream"]'
  ).forEach(m => addAmazonVideo(m.getAttribute('content') || ''));

  return r;
}

function scrapeWalmart() {
  const r = { title: '', price: '', images: [], videos: [], variants: [] };

  const titleEl = document.querySelector(
    'h1[itemprop="name"], h1.prod-ProductTitle, [data-automation-id="product-title"], h1.lh-copy, h1#main-title'
  );
  if (titleEl) r.title = titleEl.innerText.trim();

  r.price = readWalmartPrice();

  // Helper: strip Walmart CDN size-capping parameters to get full-resolution image
  // Walmart uses i5.walmartimages.com with params like ?odnWidth=180&odnHeight=180 that cap quality
  const wmUpscale = (src) => {
    if (!src) return src;
    // Remove all query parameters from Walmart/Sam's Club CDN URLs (they only cap size)
    if (/walmartimages\.com|scene7\.samsclub|samsclub\.com\/content/i.test(src)) {
      return src.split('?')[0];
    }
    return src.split('?')[0]; // strip params universally for clean dedup
  };

  // Strategy 1: __NEXT_DATA__ JSON (most reliable Ã¢â‚¬â€ contains full-res URLs directly)
  // ROOT CAUSE of duplicates: Walmart __NEXT_DATA__ embeds the same imageInfo.allImages
  // in MULTIPLE locations (product root + contentLayout modules + variantMap). A generic
  // DFS with early exit can still find two sibling nodes at the same depth.
  // Fix: navigate a PRIORITY-ORDERED list of known product paths instead of blind DFS.
  const nextEl = document.getElementById('__NEXT_DATA__');
  if (nextEl) {
    try {
      const nd = JSON.parse(nextEl.textContent || '{}');

      // canonical-key dedup Set shared across all candidate sources
      const wmSeen = new Set();
      const addWmImg = (rawUrl) => {
        if (!rawUrl) return;
        const clean = wmUpscale(rawUrl);
        if (!clean) return;
        const key = canonImageKey(clean);
        if (wmSeen.has(key)) return;
        wmSeen.add(key);
        r.images.push(clean);
      };

      // Extract images from an imageInfo.allImages array
      const extractAllImages = (imageInfo) => {
        if (!imageInfo || !Array.isArray(imageInfo.allImages)) return false;
        imageInfo.allImages.forEach(img => {
          let url = img.url || '';
          // Prefer the largest assetSizeList entry
          if (Array.isArray(img.assetSizeList) && img.assetSizeList.length) {
            const last = img.assetSizeList[img.assetSizeList.length - 1];
            if (last && last.url) url = last.url;
          }
          addWmImg(url);
        });
        return imageInfo.allImages.length > 0;
      };

      // Try exact, known paths first (prevents collecting from recommendations)
      const root = nd?.props?.pageProps?.initialData?.data?.product
                || nd?.pageProps?.initialData?.data?.product
                || nd?.initialData?.data?.product;

      if (root) {
        extractAllImages(root.imageInfo);
        // Some Walmart pages nest it one level deeper under primaryOffer or imageList
        if (r.images.length === 0) extractAllImages(root.primaryOffer?.imageInfo || root.imageList?.imageInfo);
      }

      // Fallback: if targeted paths gave nothing, do a BOUNDED DFS (max depth 6)
      // that stops as soon as one imageInfo.allImages is found
      if (r.images.length === 0) {
        const dfs = (obj, depth) => {
          if (!obj || typeof obj !== 'object' || depth > 6) return false;
          if (obj.imageInfo && Array.isArray(obj.imageInfo.allImages)) {
            return extractAllImages(obj.imageInfo);
          }
          for (const v of Object.values(obj)) {
            if (v && typeof v === 'object' && dfs(v, depth + 1)) return true;
          }
          return false;
        };
        dfs(nd, 0);
      }
    } catch (_) {}
  }

  // Strategy 2: DOM thumbnails fallback (if __NEXT_DATA__ had nothing)
  if (r.images.length === 0) {
    document.querySelectorAll('[data-testid="vertical-carousel-container"] img, [data-testid="media-thumbnail"] img').forEach(img => {
      // data-old-hires or data-zoom-image may hold higher-res version
      const src = img.getAttribute('data-old-hires') || img.getAttribute('data-zoom-image') ||
                  img.getAttribute('data-src') || img.src || img.srcset?.split(' ')[0] || '';
      if (!src) return;
      const clean = wmUpscale(src);
      if (clean && !r.images.includes(clean)) r.images.push(clean);
    });
  }

  // Always merge live gallery media: Walmart can expose a partial __NEXT_DATA__
  // payload while the remaining product images arrive through lazy DOM attributes.
  collectLiveMarketplaceImages('walmart').forEach(image => {
    if (!r.images.some(existing => canonImageKey(existing) === canonImageKey(image))) r.images.push(image);
  });


  // Extract videos from __NEXT_DATA__ JSON (Walmart: mediaAssets + Brightcove player)
  try {
    const nd = JSON.parse(document.getElementById('__NEXT_DATA__')?.textContent || '{}');
    const _wmVidSeen = new Set();
    const addWmVid = (u) => {
      if (!u || typeof u !== 'string') return;
      const clean = u.replace(/\\\//g, '/').trim();
      if (!clean.startsWith('http')) return;
      if (!/\.(mp4|m3u8|webm)/i.test(clean) && !isVideoUrl(clean)) return;
      if (!_wmVidSeen.has(clean)) { _wmVidSeen.add(clean); r.videos.push(clean); }
    };

    (function scanWalmartVideos(obj, depth) {
      if (!obj || typeof obj !== 'object' || depth > 12) return;

      // Standard mediaAssets format
      if (Array.isArray(obj.mediaAssets)) {
        obj.mediaAssets.forEach(a => {
          if (a && a.type === 'VIDEO' && a.url) addWmVid(a.url);
        });
      }

      // Brightcove: sources[] Ã¢â‚¬â€ array of {src, type}
      if (Array.isArray(obj.sources)) {
        obj.sources.forEach(s => {
          if (s && typeof s.src === 'string') addWmVid(s.src);
        });
      }

      // Brightcove: renditions[] Ã¢â‚¬â€ pick highest quality
      if (Array.isArray(obj.renditions) && obj.renditions.length > 0) {
        const sorted = [...obj.renditions]
          .filter(rd => rd && typeof rd.url === 'string')
          .sort((a, b) => (b.encodingRate || 0) - (a.encodingRate || 0));
        if (sorted.length > 0) addWmVid(sorted[0].url);
      }

      // Flat video key names
      ['videoUrl', 'mp4Url', 'hlsUrl', 'videoSrc', 'streamUrl', 'video_url',
       'hlsManifestUrl', 'dashManifestUrl'].forEach(k => {
        if (typeof obj[k] === 'string') addWmVid(obj[k]);
      });

      Object.values(obj).forEach(v => { if (v && typeof v === 'object') scanWalmartVideos(v, depth + 1); });
    })(nd, 0);
  } catch(_) {}
  return r;
}

function scrapeSamsClub() {
  const r = { title: '', price: '', images: [], videos: [], variants: [] };



  const titleEl = document.querySelector(
    'h1.sc-product-title, h1[data-testid="product-title"], h1[data-automation-id="product-title"], h1'
  );
  if (titleEl) r.title = titleEl.innerText.trim();

  r.price = readSamsClubPrice();

  // Helper: strip Sam's Club scene7 CDN size params to get full-resolution image
  // scene7 URLs use $SC_Item_Medium_Image$ qualifiers and ?wid=200&hei=200 that cap quality
  const scUpscale = (src) => {
    if (!src) return src;
    if (/scene7\.samsclub\.com/i.test(src)) {
      // Remove everything from ? onward AND strip scene7 image preset qualifiers
      return src.split('?')[0].replace(/\$SC_Item[^$]*\$/, '').replace(/\$[^$]+\$/, '');
    }
    return src.split('?')[0];
  };

  // Strategy 1: __NEXT_DATA__ JSON Ã¢â‚¬â€ assets[].largeImage or zoomImage (highest quality fields)
  // Use targeted path navigation to avoid collecting assets from recommendation panels.
  const nextEl = document.getElementById('__NEXT_DATA__');
  if (nextEl) {
    try {
      const nd = JSON.parse(nextEl.textContent || '{}');

      // Canonical-key dedup Set for Sam's Club images
      const scSeen = new Set();
      const addScImg = (rawUrl) => {
        if (!rawUrl) return;
        const clean = scUpscale(rawUrl);
        if (!clean) return;
        const key = canonImageKey(clean);
        if (scSeen.has(key)) return;
        scSeen.add(key);
        r.images.push(clean);
      };

      const extractScAssets = (assets) => {
        if (!Array.isArray(assets) || assets.length === 0) return false;
        if (!assets[0].largeImage && !assets[0].zoomImage) return false;
        assets.forEach(a => addScImg(a.zoomImage || a.largeImage || ''));
        return assets.length > 0;
      };

      // Navigate the known Sam's Club product path first
      const scProduct = nd?.props?.pageProps?.initialData?.data?.product
                     || nd?.pageProps?.initialData?.data?.product;

      if (scProduct) {
        extractScAssets(scProduct.assets);
        // Some Sam's Club pages use imageAssets instead of assets
        if (r.images.length === 0) extractScAssets(scProduct.imageAssets || scProduct.images);
      }

      // Fallback: bounded DFS (max depth 6) if targeted paths found nothing
      if (r.images.length === 0) {
        const dfs = (obj, depth) => {
          if (!obj || typeof obj !== 'object' || depth > 6) return false;
          if (extractScAssets(obj.assets)) return true;
          for (const v of Object.values(obj)) {
            if (v && typeof v === 'object' && dfs(v, depth + 1)) return true;
          }
          return false;
        };
        dfs(nd, 0);
      }
    } catch (_) {}
  }

  // Strategy 2: DOM thumbnail fallback
  if (r.images.length === 0) {
    document.querySelectorAll(
      '[data-testid="item-page-vertical-carousel-hero-image-button"] img, ' +
      '[data-seo-id="hero-carousel-image"] img, [data-testid="media-thumbnail"] img'
    ).forEach(img => {
      if ((img.src || '').includes('samsclub.com/content/dam/logos')) return;
      const src = img.getAttribute('data-old-hires') || img.getAttribute('data-zoom-image') ||
                  img.getAttribute('data-src') || img.src || img.srcset?.split(' ')[0] || '';
      if (!src) return;
      const clean = scUpscale(src);
      if (clean && !r.images.includes(clean)) r.images.push(clean);
    });
  }

  // Always merge live gallery media: Sam's Club may render image assets after
  // the initial React state has been created or use a different carousel DOM.
  collectLiveMarketplaceImages('samsclub').forEach(image => {
    if (!r.images.some(existing => canonImageKey(existing) === canonImageKey(image))) r.images.push(image);
  });


  // Extract videos from __NEXT_DATA__ JSON
  // Sam's Club shares Walmart's Next.js infrastructure BUT uses Brightcove player.
  // Brightcove stores video in sources[].src and renditions[].url Ã¢â‚¬â€ NOT mediaAssets[].
  try {
    const nd = JSON.parse(document.getElementById('__NEXT_DATA__')?.textContent || '{}');
    const _scVidSeen = new Set();
    const addScVid = (u) => {
      if (!u || typeof u !== 'string') return;
      const clean = u.replace(/\\\//g, '/').trim();
      if (!clean.startsWith('http')) return;
      if (!/\.(mp4|m3u8|webm)/i.test(clean) && !isVideoUrl(clean)) return;
      if (!_scVidSeen.has(clean)) { _scVidSeen.add(clean); r.videos.push(clean); }
    };

    (function scanScVideos(obj, depth) {
      if (!obj || typeof obj !== 'object' || depth > 15) return;

      // Standard Walmart/Sam's Club mediaAssets format
      if (Array.isArray(obj.mediaAssets)) {
        obj.mediaAssets.forEach(a => {
          if (a && a.type === 'VIDEO' && a.url) addScVid(a.url);
        });
      }

      // Brightcove: sources[] Ã¢â‚¬â€ array of {src, type} objects
      if (Array.isArray(obj.sources)) {
        obj.sources.forEach(s => {
          if (s && typeof s.src === 'string') addScVid(s.src);
        });
      }

      // Brightcove: renditions[] Ã¢â‚¬â€ pick highest quality (sort by encodingRate desc)
      if (Array.isArray(obj.renditions) && obj.renditions.length > 0) {
        const sorted = [...obj.renditions]
          .filter(rd => rd && typeof rd.url === 'string')
          .sort((a, b) => (b.encodingRate || 0) - (a.encodingRate || 0));
        if (sorted.length > 0) addScVid(sorted[0].url);
      }

      // Flat video key names (Walmart + Brightcove variants)
      ['videoUrl', 'mp4Url', 'hlsUrl', 'videoSrc', 'video_url', 'streamUrl',
       'hlsManifestUrl', 'dashManifestUrl'].forEach(k => {
        if (typeof obj[k] === 'string') addScVid(obj[k]);
      });

      Object.values(obj).forEach(v => { if (v && typeof v === 'object') scanScVideos(v, depth + 1); });
    })(nd, 0);

    // Inline <script> scan Ã¢â‚¬â€ catches Brightcove JSON not in __NEXT_DATA__
    document.querySelectorAll('script:not([src])').forEach(s => {
      const t = s.textContent || '';
      if (t.length < 50 || t.length > 3_000_000) return;
      if (!/brightcove|renditions|sources.*mp4|sources.*m3u8|scene7.*samsclub/i.test(t)) return;
      // Brightcove sources: "src":"https://...mp4"
      for (const m of t.matchAll(/"src"\s*:\s*"(https?:[^"]+\.(?:mp4|m3u8|webm)[^"]*)"/gi))
        addScVid(m[1].replace(/\\\//g, '/'));
      // Brightcove renditions: "url":"https://...mp4"
      for (const m of t.matchAll(/"url"\s*:\s*"(https?:[^"]+\.(?:mp4|m3u8|webm)[^"]*)"/gi))
        addScVid(m[1].replace(/\\\//g, '/'));
      // scene7 Sam's Club video CDN
      for (const m of t.matchAll(/https?:\\?\/?\/?scene7\.samsclub\.com\/[^\s"']+\.mp4/gi))
        addScVid(m[0].replace(/\\\//g, '/'));
    });
  } catch(_) {}
  return r;
}

function scrapeFaire() {
  const r = { title: '', price: '', images: [], videos: [], variants: [] };
  const sym = detectPageCurrencySymbol() || '$';

  // Ã¢â€â‚¬Ã¢â€â‚¬ Title Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  const titleEl = document.querySelector(
    'h1[class*="product"], h1[class*="Product"], h1[class*="title"], h1[class*="Title"], ' +
    '[data-testid*="product-title"], [data-testid*="productTitle"], ' +
    '[class*="ProductTitle"], [class*="product-title"], h1'
  );
  if (titleEl) r.title = titleEl.innerText.trim();

  // Ã¢â€â‚¬Ã¢â€â‚¬ Price: Strategy 1 Ã¢â‚¬â€ __NEXT_DATA__ deep walk (most reliable for Faire) Ã¢â€â‚¬Ã¢â€â‚¬
  const nextDataEl = document.getElementById('__NEXT_DATA__');
  if (nextDataEl) {
    try {
      const nextData = JSON.parse(nextDataEl.textContent || '{}');

      function getFairePrice(obj, depth) {
        if (!obj || typeof obj !== 'object' || depth > 18) return '';
        const priceKeys = [
          'wholesale_price', 'wholesalePrice', 'unit_price', 'unitPrice',
          'min_price', 'minPrice', 'price_per_unit', 'pricePerUnit',
          'retail_price', 'retailPrice', 'suggested_retail_price',
          'min_order_amount', 'price'
        ];
        for (const key of priceKeys) {
          if (key in obj) {
            const v = obj[key];
            // Faire stores prices as integers in cents (e.g. 1498 = $14.98)
            if (typeof v === 'number' && v > 0) {
              const amount = v >= 100 ? (v / 100) : v;
              return `${sym}${amount.toFixed(2)}`;
            }
            if (typeof v === 'string' && /\d/.test(v)) {
              const c = cleanPriceText(v);
              if (c) return ensureCurrency(c, sym);
            }
          }
        }
        for (const v of Object.values(obj)) {
          if (v && typeof v === 'object') {
            const res = getFairePrice(v, depth + 1);
            if (res) return res;
          }
        }
        return '';
      }

      function walkFaireJson(obj, depth) {
        if (!obj || typeof obj !== 'object' || depth > 12) return;
        if (Array.isArray(obj)) { obj.forEach(v => walkFaireJson(v, depth + 1)); return; }
        const imageKeys = ['images', 'productImages', 'media', 'photos', 'product_images'];
        for (const key of imageKeys) {
          if (Array.isArray(obj[key])) {
            obj[key].forEach(item => {
              const u = typeof item === 'string' ? item
                : (item.url || item.src || item.imageUrl || item.image_url || '');
              if (u && !isBadImage(u)) r.images.push(u);
            });
          }
        }
        const singleKeys = ['imageUrl', 'image_url', 'heroImage', 'primaryImage', 'thumbnail_url', 'thumbnailUrl'];
        for (const key of singleKeys) {
          if (typeof obj[key] === 'string' && obj[key] && !isBadImage(obj[key])) {
            r.images.push(obj[key]);
          }
        }
        Object.values(obj).forEach(v => { if (v && typeof v === 'object') walkFaireJson(v, depth + 1); });
      }

      const foundPrice = getFairePrice(nextData, 0);
      if (foundPrice) r.price = foundPrice;
      walkFaireJson(nextData, 0);
    } catch (_) {}
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ Price: Strategy 2 Ã¢â‚¬â€ DOM selectors (Faire-specific) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  if (!r.price) {
    r.price = priceFromSelectors([
      '[data-testid="wholesale-price"]', '[data-testid="retail-price"]',
      '[data-testid="unit-price"]', '[data-testid="product-price"]',
      '[data-testid*="price"]', '[data-test-id*="price"]',
      '[class*="wholesale"][class*="price" i]',
      '[class*="WholesalePrice"]', '[class*="wholesalePrice"]',
      '[class*="UnitPrice"]', '[class*="unit-price"]',
      '[class*="ProductPrice"]', '[class*="product-price"]',
      '[class*="Price"]', '[class*="price"]',
      '[aria-label*="price" i]', '[aria-label*="wholesale" i]'
    ]);
    if (r.price) r.price = ensureCurrency(r.price, sym);
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ Price: Strategy 3 Ã¢â‚¬â€ JSON-LD Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  if (!r.price) {
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const root = JSON.parse(s.textContent || '{}');
        const stack = Array.isArray(root) ? [...root] : [root];
        while (stack.length) {
          const it = stack.shift();
          if (!it || typeof it !== 'object') continue;
          const o = it.offers || it.Offers;
          if (o) {
            const arr = Array.isArray(o) ? o : [o];
            for (const of_ of arr) {
              const p = of_.price || of_.lowPrice;
              if (p !== undefined && p !== null && p !== '') {
                const symMap = { USD:'$', GBP:'Ã‚Â£', EUR:'Ã¢â€šÂ¬', JPY:'Ã‚Â¥', INR:'Ã¢â€šÂ¹', KRW:'Ã¢â€šÂ©', CAD:'CA$', AUD:'AU$' };
                const cur = of_.priceCurrency || '';
                const cs = symMap[cur.toUpperCase()] || sym;
                r.price = `${cs}${p}`;
                break;
              }
            }
          }
          if (r.price) break;
          Object.values(it).forEach(v => { if (v && typeof v === 'object') stack.push(v); });
        }
      } catch (_) {}
      if (r.price) break;
    }
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ Images: Fallback DOM scan Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  if (r.images.length === 0) {
    const galleryScope = document.querySelector(
      '[data-testid*="product-image"], [class*="ProductImages"], ' +
      '[class*="productImages"], [class*="ImageGallery"], ' +
      '[class*="image-gallery"], [class*="carousel"], ' +
      '[class*="pdp-image"], [class*="ProductMedia"]'
    ) || findProductGalleryContainer() || document;

    collectImagesBySelector(
      'img[src*="faire-cdn"], img[src*="faire.com/"], img[srcset*="faire-cdn"], ' +
      'picture img, [data-testid*="image" i] img, [data-testid*="ProductImage" i] img, ' +
      '[class*="ProductImage"] img, [class*="carousel"] img, [class*="gallery"] img',
      galleryScope
    ).forEach(s => {
      if (!isBadImage(s)) r.images.push(s);
    });
  }

  return r;
}

function scrapeAlibaba() {
  const r = { title: '', price: '', images: [], videos: [], variants: [] };
  const t = document.querySelector('.product-title, h1, [class*="module_title"], [class*="product-name"]');
  if (t) r.title = t.innerText.trim();
  const pe = document.querySelector('.price, [class*="price-info"], [class*="product-price"], [class*="ma-spec-price"]');
  if (pe) {
    const nums = (pe.innerText || '').match(/[$Ã‚Â£Ã¢â€šÂ¬]?\s*\d{1,3}(?:[,.\s]\d{3})*(?:\.\d{1,2})?/g);
    if (nums?.length >= 2) r.price = `${nums[0].trim()} - ${nums[1].trim()}`;
    else if (nums?.length === 1) r.price = nums[0].trim();
  }

  const galleryScope = document.querySelector('.detail-gallery, [class*="gallery-wrap"], [class*="ImageGallery"]') || findProductGalleryContainer() || document;
  collectImagesBySelector('.detail-gallery img, [class*="gallery"] img, .main-image img, .thumb-list img', galleryScope)
    .forEach(s => r.images.push(s.replace(/_\d+x\d+\./, '_960x960.')));
  return r;
}

function scrapeAliExpress() {
  const r = { title: '', price: '', images: [], videos: [], variants: [] };
  const t = document.querySelector('[data-pl="product-title"], h1, .product-title-text, [class*="title--wrap"] h1');
  if (t) r.title = t.innerText.trim();
  r.price = priceFromSelectors([
    '.product-price-value', '[class*="price--current"]',
    '[class*="uniform-banner-box-price"]', '[class*="es--wrap"] span', '.product-price-current'
  ]);

  const galleryScope = document.querySelector('.pdp-comp-product-image, [class*="gallery--wrap"]') || findProductGalleryContainer() || document;
  collectImagesBySelector('.slider--item img, .images--item img, [class*="gallery"] img, [class*="magnifier"] img', galleryScope)
    .forEach(s => r.images.push(s.replace(/_\d+x\d+\./, '_960x960.')));
  // Extract videos from inline page scripts (AliExpress embeds video_url in script JSON)
  try {
    document.querySelectorAll('script:not([src])').forEach(sc => {
      const text = sc.textContent || '';
      const matches = text.match(/"(?:video_url|videoUrl|video_src|mediaUrl)"\s*:\s*"([^"]+\.(?:mp4|m3u8)[^"]*)"/gi) || [];
      matches.forEach(m => {
        const raw = (m.match(/"([^"]{10,}\.(?:mp4|m3u8)[^"]*)"/) || [])[1];
        if (raw) {
          const clean = raw.replace(/\\\//g, '/');
          if (!r.videos.includes(clean)) r.videos.push(clean);
        }
      });
    });
  } catch(_) {}
  return r;
}

async function scrapeTemu() {
  const r = { title: '', price: '', images: [], videos: [], variants: [] };
  const sym = detectPageCurrencySymbol() || '$';

  // Ã¢â€â‚¬Ã¢â€â‚¬ Title Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  const titleEl = document.querySelector(
    '[class*="goods-name"], [class*="GoodsName"], [class*="ProductTitle"], ' +
    '[class*="product-title"], [class*="detail-title"], ' +
    '[data-testid*="product-name"], [data-testid*="title"], h1'
  );
  if (titleEl) r.title = titleEl.innerText.trim();

  // Ã¢â€â‚¬Ã¢â€â‚¬ Helper: upgrade CDN thumbnail URL to full-resolution origin Ã¢â€â‚¬Ã¢â€â‚¬
  // Temu CDNs use suffixes like /thumbnail/200x200 or ?x-oss-process=image/resize,w_200
  // Replacing these gives the full-size product image instead of a preview.
  const temuOriginUrl = (u) => {
    if (!u || typeof u !== 'string') return u;
    return u
      .replace(/\/thumbnail\/\d+x\d+/gi, '/origin')           // /thumbnail/200x200 Ã¢â€ â€™ /origin
      .replace(/\?x-oss-process=image\/resize[^&"]*/gi, '')   // strip Aliyun resize param
      .replace(/[?&]image_resize=\d+/gi, '')                   // strip ?image_resize=300
      .replace(/\?$/, '');                                     // clean trailing ?
  };

  // Ã¢â€â‚¬Ã¢â€â‚¬ Price + Images + Videos: Strategy 1 Ã¢â‚¬â€ window.__init_data__ Ã¢â€â‚¬Ã¢â€â‚¬
  // Content scripts run in an isolated world; __init_data__ is a page-world global.
  // We inject a <script> to postMessage it back to the content script.
  try {
    const temuData = await new Promise((resolve) => {
      const msgKey = '__zhunter_temu_' + Date.now();
      const script = document.createElement('script');
      script.textContent = '(function(){' +
        'var d=window.__init_data__||null;' +
        'window.postMessage({__zhunterKey:"' + msgKey + '",payload:d?JSON.stringify(d):null},"*");' +
        '})();';
      const handler = (e) => {
        if (e.source === window && e.data && e.data.__zhunterKey === msgKey) {
          window.removeEventListener('message', handler);
          resolve(e.data.payload ? JSON.parse(e.data.payload) : null);
        }
      };
      window.addEventListener('message', handler);
      (document.head || document.documentElement).appendChild(script);
      script.remove();
      setTimeout(() => { window.removeEventListener('message', handler); resolve(null); }, 500);
    });

    if (temuData) {
      // FIX A1: Walk the FULL tree Ã¢â‚¬â€ never return early.
      // Images are collected on every node. Price is captured on first match.
      // Videos are also collected alongside images.
      const priceKeys = ['sale_price', 'salePrice', 'price', 'promotion_price',
                         'promotionPrice', 'actual_price', 'actualPrice',
                         'original_price', 'originalPrice', 'min_price', 'minPrice'];
      const imgKeys   = ['origin_url', 'original_img_url', 'img_url', 'thumbnail_url',
                         'goods_img_url', 'product_img_url'];
      const vidKeys   = ['video_url', 'videoUrl', 'video_src', 'goods_video_url',
                         'product_video', 'media_url', 'mp4_url'];

      const _imgSeen = new Set();
      const _vidSeen = new Set();

      function walkTemuInitData(obj, depth) {
        if (!obj || typeof obj !== 'object' || depth > 18) return;

        // Ã¢â€â‚¬Ã¢â€â‚¬ Collect images Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
        for (const k of imgKeys) {
          if (k in obj && typeof obj[k] === 'string' && obj[k]) {
            const clean = temuOriginUrl(obj[k]);
            if (clean && !isBadImage(clean) && !_imgSeen.has(clean)) {
              _imgSeen.add(clean);
              r.images.push(clean);
            }
          }
        }

        // Ã¢â€â‚¬Ã¢â€â‚¬ Collect videos Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
        for (const k of vidKeys) {
          if (k in obj && typeof obj[k] === 'string' && obj[k]) {
            const v = obj[k].replace(/\\\//g, '/');
            if (/\.(mp4|webm|m3u8)/i.test(v) && !_vidSeen.has(v)) {
              _vidSeen.add(v);
              r.videos.push(v);
            }
          }
        }

        // Ã¢â€â‚¬Ã¢â€â‚¬ Capture price (first found, non-returning) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
        if (!r.price) {
          for (const k of priceKeys) {
            if (k in obj) {
              if (typeof obj[k] === 'number' && obj[k] > 0) {
                const dollars = obj[k] >= 100 ? (obj[k] / 100).toFixed(2) : obj[k].toFixed(2);
                r.price = sym + dollars;
                break;
              }
              if (typeof obj[k] === 'string' && /\d/.test(obj[k])) {
                const c = cleanPriceText(obj[k]);
                if (c) { r.price = ensureCurrency(c, sym); break; }
              }
            }
          }
        }

        // Ã¢â€â‚¬Ã¢â€â‚¬ Recurse into children (always, no early exit) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
        if (Array.isArray(obj)) {
          obj.forEach(v => { if (v && typeof v === 'object') walkTemuInitData(v, depth + 1); });
        } else {
          Object.values(obj).forEach(v => { if (v && typeof v === 'object') walkTemuInitData(v, depth + 1); });
        }
      }

      walkTemuInitData(temuData, 0);
    }
  } catch (_) {}

  // Ã¢â€â‚¬Ã¢â€â‚¬ Price: Strategy 2 Ã¢â‚¬â€ DOM selectors (specific Ã¢â€ â€™ generic) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  if (!r.price) {
    r.price = priceFromSelectors([
      // Temu uses CSS modules Ã¢â‚¬â€ look for price-like classes avoiding strikethrough
      '[data-testid="price"]', '[data-testid="selling-price"]',
      '[data-testid*="current-price"]', '[data-testid*="sale-price"]',
      '[class*="price-sale"]', '[class*="priceSale"]',
      '[class*="price-current"]', '[class*="priceCurrent"]',
      '[class*="price-actual"]', '[class*="priceActual"]',
      '[class*="selling-price"]', '[class*="sellingPrice"]',
      '[class*="current-price"]', '[class*="currentPrice"]',
      // Avoid crossed-out / original prices
      '[class*="price"]:not([class*="origin"]):not([class*="Origin"]):not([class*="delete"]):not([class*="Delete"]):not([class*="slash"]):not([class*="Strike"]):not([class*="before"]):not([class*="through"]):not([class*="line-through"]):not([class*="Before"])',
      '[class*="Price"]:not([class*="Origin"]):not([class*="Before"]):not([class*="Cross"]):not([class*="Strike"])',
      // aria-label price
      '[aria-label*="price" i]', '[aria-label*="Price" i]'
    ]);
    if (r.price) r.price = ensureCurrency(r.price, sym);
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ Price: Strategy 3 Ã¢â‚¬â€ inline script regex (multiple patterns) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  if (!r.price) {
    for (const s of document.querySelectorAll('script:not([src])')) {
      const t = s.textContent || '';
      if (t.length < 50 || t.length > 4_000_000) continue;
      if (!/sale_price|actual_price|display_price|price_str|priceStr|promotionPrice/.test(t)) continue;

      // Temu cents prices (integer, divide by 100)
      const centsMatch = t.match(/"(?:sale_price|salePrice|actual_price|actualPrice|promotion_price|promotionPrice)"\s*:\s*(\d{2,6})(?![.\d])/);
      if (centsMatch) {
        const cents = parseInt(centsMatch[1]);
        if (cents > 0) { r.price = `${sym}${(cents / 100).toFixed(2)}`; break; }
      }
      // String price with currency: "display_price":"$8.99"
      const strMatch = t.match(/"(?:display_price|price_str|priceStr|formatted_price|formattedPrice)"\s*:\s*"([^"]+)"/);
      if (strMatch) {
        const c = cleanPriceText(strMatch[1]);
        if (c) { r.price = ensureCurrency(c, sym); break; }
      }
      // Float prices: "price":8.99
      const floatMatch = t.match(/"(?:price|salePrice|sale_price)"\s*:\s*(\d+\.\d{1,2})(?![\d])/);
      if (floatMatch) {
        const v = parseFloat(floatMatch[1]);
        if (v > 0) { r.price = `${sym}${v.toFixed(2)}`; break; }
      }
    }
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ Images: Strategy 2 Ã¢â‚¬â€ inline scripts (fallback when __init_data__ had no images) Ã¢â€â‚¬Ã¢â€â‚¬
  // FIX A2: apply temuOriginUrl() so CDN thumbnail URLs become full-resolution
  if (r.images.length === 0) {
    const scriptTexts = [];
    document.querySelectorAll('script:not([src])').forEach(s => {
      const t = s.textContent || '';
      if (t.includes('origin_url') || t.includes('original_img_url') || t.includes('img_url') || t.includes('goods_gallery')) {
        scriptTexts.push(t);
      }
    });

    for (const t of scriptTexts) {
      for (const m of t.matchAll(/"origin_url"\s*:\s*"(https?:[^"]+)"/g)) {
        const u = temuOriginUrl(m[1].replace(/\\/g, '').replace(/\//g, '/'));
        if (!isBadImage(u) && !r.images.includes(u)) r.images.push(u);
      }
      if (r.images.length === 0) {
        for (const m of t.matchAll(/"original_img_url"\s*:\s*"(https?:[^"]+)"/g)) {
          const u = temuOriginUrl(m[1].replace(/\\/g, '').replace(/\//g, '/'));
          if (!isBadImage(u) && !r.images.includes(u)) r.images.push(u);
        }
      }
      if (r.images.length === 0) {
        for (const m of t.matchAll(/"img_url"\s*:\s*"(https?:[^"]+)"/g)) {
          const u = temuOriginUrl(m[1].replace(/\\/g, '').replace(/\//g, '/'));
          if (!isBadImage(u) && !r.images.includes(u)) r.images.push(u);
        }
      }
    }
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ Images: Strategy 3 Ã¢â‚¬â€ application/json scripts Ã¢â€â‚¬Ã¢â€â‚¬
  // FIX A2: apply temuOriginUrl() here too
  if (r.images.length === 0) {
    document.querySelectorAll('script[type="application/json"]').forEach(s => {
      try {
        const data = JSON.parse(s.textContent || '{}');
        function walkTemuJson(obj, d) {
          if (!obj || typeof obj !== 'object' || d > 12) return;
          if (Array.isArray(obj)) { obj.forEach(v => walkTemuJson(v, d + 1)); return; }
          const rawUrl = obj.origin_url || obj.original_img_url || obj.img_url || '';
          if (typeof rawUrl === 'string' && rawUrl && /\.(jpg|jpeg|png|webp)/i.test(rawUrl) && !isBadImage(rawUrl)) {
            const u = temuOriginUrl(rawUrl);
            if (!r.images.includes(u)) r.images.push(u);
          }
          Object.values(obj).forEach(v => { if (v && typeof v === 'object') walkTemuJson(v, d + 1); });
        }
        walkTemuJson(data, 0);
      } catch (_) {}
    });
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ Images: Strategy 4 Ã¢â‚¬â€ DOM gallery scan Ã¢â€â‚¬Ã¢â€â‚¬
  // FIX A2: temuOriginUrl() already applied here (was the only working strategy before)
  if (r.images.length === 0) {
    const galleryScope = document.querySelector(
      '[class*="goods-gallery"], [class*="GoodsGallery"], [class*="image-view"], ' +
      '[class*="swiper-wrapper"], [class*="gallery-container"], ' +
      '[data-testid*="gallery"], [data-testid*="image"]'
    ) || findProductGalleryContainer() || document;

    galleryScope.querySelectorAll('img').forEach(img => {
      if (isBadImageElement(img)) return;
      const src = pickImgSrc(img);
      if (!src || isBadImage(src)) return;
      const clean = temuOriginUrl(src);
      r.images.push(clean);
    });
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ Videos: Strategy 2 Ã¢â‚¬â€ inline script regex (A3 fallback) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  if (r.videos.length === 0) {
    for (const s of document.querySelectorAll('script:not([src])')) {
      const t = s.textContent || '';
      if (t.length < 50 || t.length > 4_000_000) continue;
      if (!/video_url|videoUrl|video_src|goods_video|mp4_url|media_url/.test(t)) continue;

      const vidMatches = t.matchAll(/"(?:video_url|videoUrl|video_src|goods_video_url|product_video|mp4_url|media_url)"\s*:\s*"(https?:[^"]+\.(?:mp4|webm|m3u8)[^"]*)"/gi);
      for (const m of vidMatches) {
        const v = m[1].replace(/\\\//g, '/');
        if (!r.videos.includes(v)) r.videos.push(v);
      }
      if (r.videos.length > 0) break;
    }
  }

  return r;
}

function scrapeEbay() {
  const r = { title: '', price: '', images: [], videos: [], variants: [] };
  const t = document.querySelector('h1.x-item-title__mainTitle span, h1[itemprop="name"], h1.product-title, .x-item-title span');
  if (t) r.title = t.innerText.trim();
  const pe = document.querySelector('.x-price-primary .ux-textspans, [itemprop="price"], #prcIsum, .x-bin-price__content .ux-textspans');
  if (pe) {
    const raw = pe.getAttribute('content') || pe.innerText;
    r.price = cleanPriceText(raw) || (pe.getAttribute('content') ? `$${pe.getAttribute('content')}` : '');
    if (r.price) r.price = ensureCurrency(r.price, detectPageCurrencySymbol());
  }

  const galleryScope = document.querySelector('#vi-main-img-fs, .ux-image-carousel, [class*="image-carousel"]') || findProductGalleryContainer() || document;
  collectImagesBySelector('#vi-main-img-fs img, .ux-image-carousel img, [class*="image-carousel"] img, .img img', galleryScope)
    .forEach(s => r.images.push(s.replace(/s-l\d+/g, 's-l1600')));
  return r;
}

function scrapeDaraz() {
  const r = { title: '', price: '', images: [], videos: [], variants: [] };
  const t = document.querySelector('.pdp-name, h1, [class*="title"]');
  if (t) r.title = t.innerText.trim();
  r.price = priceFromSelectors(['.pdp-price', '[class*="price"]']);

  const galleryScope = document.querySelector('.gallery-preview-panel, .pdp-gallery, [class*="ImageGallery"]') || findProductGalleryContainer() || document;
  collectImagesBySelector('.gallery-preview-panel img, [class*="gallery"] img, .pdp-image img', galleryScope).forEach(s => r.images.push(s));
  return r;
}

function scrapeShopify() {
  const r = { title: '', price: '', images: [], videos: [], variants: [] };
  const t = document.querySelector('.product__title, .product-single__title, h1, [class*="product-title"]');
  if (t) r.title = t.innerText.trim();
  r.price = priceFromSelectors([
    '.product__price', '.price', '[class*="product-price"]',
    '[data-product-price]', '.price-item--sale', '.price-item--regular',
    '.woocommerce-Price-amount'   // WooCommerce uses same fallback
  ]);
  if (r.price) r.price = ensureCurrency(r.price, detectPageCurrencySymbol());

  const galleryScope = document.querySelector(
    '.product__media-wrapper, .woocommerce-product-gallery, ' +
    '[class*="product-gallery"], [class*="ProductGallery"], ' +
    '[class*="product-images"], [class*="ProductImages"]'
  ) || findProductGalleryContainer() || document;

  collectImagesBySelector('.product__media img, .product-single__photo img, .product-featured-media img, [class*="product-image"] img, .woocommerce-product-gallery__image img', galleryScope)
    .forEach(s => r.images.push(s.replace(/_(small|medium|compact|large|grande|master|\d+x\d*)(?=[._])/, '_1200x1200')));
  return r;
}

// Ã¢â€â‚¬Ã¢â€â‚¬ ISSUE 3 FIX: Flipkart scraper Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
function scrapeFlipkart() {
  const r = { title: '', price: '', images: [], videos: [], variants: [] };
  const t = document.querySelector('span[class*="B_NuCI"], h1, [class*="product-title"]');
  if (t) r.title = t.innerText.trim();
  r.price = priceFromSelectors([
    '._30jeq3._16Jk6d', '._30jeq3', '[class*="finalPrice"]', '[class*="price"]'
  ]);
  if (r.price) r.price = ensureCurrency(r.price, 'Ã¢â€šÂ¹');

  const galleryScope = document.querySelector('._3kidJX, [class*="imgWrapper"], [class*="ImageGallery"]') || findProductGalleryContainer() || document;
  collectImagesBySelector('._2r_T1I img, ._3kidJX img, [class*="productImage"] img, [class*="imgWrapper"] img', galleryScope)
    .forEach(s => r.images.push(s.replace(/\/\d+\/\d+(\/\d+)?(?=\/)/, '/832/832')));
  return r;
}

// Ã¢â€â‚¬Ã¢â€â‚¬ ISSUE 3 FIX: Noon scraper Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
function scrapeNoon() {
  const r = { title: '', price: '', images: [], videos: [], variants: [] };
  const t = document.querySelector('h1, [class*="productTitle"], [class*="product-title"]');
  if (t) r.title = t.innerText.trim();
  r.price = priceFromSelectors(['.priceNow', '.price-now', '[class*="sellingPrice"]', '[class*="price"]']);
  if (r.price) r.price = ensureCurrency(r.price, detectPageCurrencySymbol());

  const galleryScope = document.querySelector('[class*="imageGallery"], [class*="ImageGallery"]') || findProductGalleryContainer() || document;
  collectImagesBySelector('[class*="productImage"] img, [class*="imageGallery"] img', galleryScope).forEach(s => r.images.push(s));
  return r;
}

// Ã¢â€â‚¬Ã¢â€â‚¬ ISSUE 3 FIX: Etsy scraper Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
function scrapeEtsy() {
  const r = { title: '', price: '', images: [], videos: [], variants: [] };
  const t = document.querySelector('h1, [class*="listing-page-title"], [data-buy-box-listing-title]');
  if (t) r.title = t.innerText.trim();
  r.price = priceFromSelectors([
    '[class*="wt-text-title-larger"]', '[class*="currency-value"]',
    'p[class*="price"]', '[class*="price-is"]'
  ]);
  if (r.price) r.price = ensureCurrency(r.price, detectPageCurrencySymbol());

  const galleryScope = document.querySelector('.listing-page-image-carousel, [class*="carousel-pane"]') || findProductGalleryContainer() || document;
  collectImagesBySelector('.listing-page-image-carousel img, [class*="carousel-pane"] img, [data-image-carousel] img', galleryScope)
    .forEach(s => r.images.push(s.replace(/\/il_\d+x[N0-9]+\./, '/il_fullxfull.')));
  return r;
}

// Ã¢â€â‚¬Ã¢â€â‚¬ ISSUE 3 FIX: Shein scraper Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
function scrapeShein() {
  const r = { title: '', price: '', images: [], videos: [], variants: [] };
  const t = document.querySelector('h1, [class*="goods-name"], [class*="product-intro__head-name"]');
  if (t) r.title = t.innerText.trim();
  r.price = priceFromSelectors([
    '[class*="product-intro__price-current"]', '[class*="original"][class*="price"]',
    '[class*="price-new"]', '[class*="goods-price"]', '[class*="price"]'
  ]);
  if (r.price) r.price = ensureCurrency(r.price, detectPageCurrencySymbol());

  const galleryScope = document.querySelector('[class*="product-intro__main-pic"], [class*="ProductGallery"]') || findProductGalleryContainer() || document;
  collectImagesBySelector('[class*="product-intro__main-pic"] img, [class*="gallery"] img, [class*="ProductGallery"] img', galleryScope).forEach(s => r.images.push(s));
  return r;
}

function scrapeYouTube() {
  const r = { title: '', price: '', images: [], videos: [], variants: [] };
  const params = new URLSearchParams(location.search);
  let videoId = params.get('v');
  if (!videoId && location.pathname.includes('/shorts/')) videoId = location.pathname.split('/shorts/')[1]?.split('/')[0];
  if (!videoId && location.hostname.includes('youtu.be')) videoId = location.pathname.slice(1).split('/')[0];

  const t = document.querySelector(
    'h1.ytd-video-primary-info-renderer, h1.ytd-watch-metadata yt-formatted-string, ' +
    '#title h1 yt-formatted-string, h1[class*="title"], meta[property="og:title"]'
  );
  r.title = (t?.content || t?.innerText || document.title || '').replace(/ - YouTube$/, '').trim();

  if (videoId) {
    r.videos.push(`https://www.youtube.com/watch?v=${videoId}`);
    r.images.push(`https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`);
    r.images.push(`https://img.youtube.com/vi/${videoId}/hqdefault.jpg`);
  }
  return r;
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Golf Retail scraper (Shopify based) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
function scrapeGolfRetail() {
  const r = { title: '', price: '', images: [], videos: [], variants: [] };
  const sym = detectPageCurrencySymbol() || '$';

  const titleEl = document.querySelector('h1.product-title, h1.product__title, [data-product-title], h1');
  if (titleEl) r.title = titleEl.innerText.trim();

  r.price = priceFromSelectors([
    '[class*="price"] .money', '[data-price]', '[class*="product-price"]', '.price'
  ]);
  if (r.price) r.price = ensureCurrency(r.price, sym);

  const galleryScope = document.querySelector(
    '.product-gallery, [class*="product-image"], [class*="product__media"]'
  ) || findProductGalleryContainer() || document;

  collectImagesBySelector(
    '[class*="product-image"] img, [class*="product__media"] img, .product-gallery img',
    galleryScope
  ).forEach(s => {
    if (!isBadImage(s)) {
      const large = s
        .replace(/_(\d+)x(\d+)(\.[a-z]+)(\?|$)/i, '_1200x$3$4')
        .replace(/_(\d+)x(\.[a-z]+)(\?|$)/i, '_1200x$2$3');
      r.images.push(large);
    }
  });

  return r;
}

// Ã¢â€â‚¬Ã¢â€â‚¬ World Wide Golf Balls / Worldwide Golf Shops scraper Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// Both worldwidegolfballs.com and worldwidegolfshops.com
function scrapeWorldwideGolfBalls() {
  const r = { title: '', price: '', images: [], videos: [], variants: [] };

  const titleEl = document.querySelector(
    'h1.product__title, h1.product-single__title, h1.product-title, ' +
    '.product__title h1, [class*="product-title"], h1'
  );
  if (titleEl) r.title = titleEl.innerText.trim();

  r.price = priceFromSelectors([
    '.price-item--sale', '.price-item--regular',
    '.product__price .price', '[class*="product-price"]',
    '.price', '[data-product-price]', '[itemprop="price"]'
  ]);
  if (r.price) r.price = ensureCurrency(r.price, '$');

  // ISSUE 4 FIX: Use exact strict selectors from Images Tab
  document.querySelectorAll('img').forEach(img => {
    let src = img.getAttribute('data-src') || img.getAttribute('data-zoom-image') || img.src || '';
    if (!src || !src.startsWith('http')) return;
    if (/logo|icon|badge|sprite|nav|header|footer|payment|trust|related|recommend/i.test(src)) return;

    // EXCLUDE related products / shelves explicitly (VTEX uses product-summary and shelf)
    if (img.closest('[class*="product-summary"], [class*="shelf"], [class*="related"], [class*="recommend"]')) return;

    const isGallery = img.closest('[class*="productImages"], [class*="carouselGallery"], .product__media-wrapper, .product-single__photos, [class*="product-gallery"], [class*="ProductGallery"], .product-images, .product__images, [class*="product-media"], .product-photo-container');
    const hasClass = /productImage|carouselThumb|productImageTag|thumbGridImg/i.test(img.className || '');
    const parentHasClass = /productImage|carouselThumb/i.test((img.parentElement && img.parentElement.className) || '');
    
    if (!isGallery && !hasClass && !parentHasClass) return;

    // Upsize Shopify thumbnails
    let large = src.replace(/_(\d+)x(\d+)(\.[a-z]+)(\?|$)/i, '_1200x$3$4')
                   .replace(/_(\d+)x(\.[a-z]+)(\?|$)/i, '_1200x$2$3');
    
    // Upsize VTEX thumbnails and STRIP query parameters to prevent duplicates!
    if (large.includes('.vtexassets.com/arquivos/ids/')) {
      const idMatch = large.match(/\/ids\/(\d+)/);
      if (idMatch) large = `https://worldwidegolf.vtexassets.com/arquivos/ids/${idMatch[1]}`;
    }
    large = large.split('?')[0];
    r.images.push(large);
  });

  r._strictImages = true;

  return r;
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Upgrade 1: Target, Costco, Home Depot, Best Buy Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
function scrapeTarget() {
  const r = { title: '', price: '', images: [], videos: [], variants: [] };
  const sym = detectPageCurrencySymbol() || '$';
  const titleEl = document.querySelector('[data-test="product-title"], h1[class*="Heading"]');
  if (titleEl) r.title = titleEl.innerText.trim();
  r.price = priceFromSelectors(['[data-test="product-price"]', '[data-test="current-price"]', '[class*="Price"] span']);
  if (r.price) r.price = ensureCurrency(r.price, sym);
  const galleryScope = findProductGalleryContainer() || document;
  collectImagesBySelector('[data-test="image-gallery"] img, [class*="Gallery"] img', galleryScope).forEach(s => {
    if (!isBadImage(s) && !r.images.includes(s)) r.images.push(s);
  });
  return r;
}

function scrapeCostco() {
  const r = { title: '', price: '', images: [], videos: [], variants: [] };
  const sym = detectPageCurrencySymbol() || '$';
  const titleEl = document.querySelector('h1[automation-id="productName"], h1[itemprop="name"]');
  if (titleEl) r.title = titleEl.innerText.trim();
  r.price = priceFromSelectors(['[automation-id="productPrice"]', '.value.product-price']);
  if (r.price) r.price = ensureCurrency(r.price, sym);
  const galleryScope = findProductGalleryContainer() || document;
  collectImagesBySelector('#product-images img, [automation-id="productImage"] img', galleryScope).forEach(s => {
    if (!isBadImage(s) && !r.images.includes(s)) r.images.push(s);
  });
  return r;
}

function scrapeHomeDepot() {
  const r = { title: '', price: '', images: [], videos: [], variants: [] };
  const sym = detectPageCurrencySymbol() || '$';
  const titleEl = document.querySelector('h1[class*="product-title"], h1[class*="product-details__title"]');
  if (titleEl) r.title = titleEl.innerText.trim();
  const w = document.querySelector('.price-format__main-price')?.innerText.trim() || '';
  const f = document.querySelector('.price-format__fraction')?.innerText.trim() || '00';
  if (w) r.price = `$${w}.${f}`;
  if (!r.price) r.price = priceFromSelectors(['[class*="price"]']);
  if (r.price) r.price = ensureCurrency(r.price, sym);
  const galleryScope = findProductGalleryContainer() || document;
  collectImagesBySelector('.mediagallery__mainimage img, [class*="media-gallery"] img', galleryScope).forEach(s => {
    if (!isBadImage(s) && !r.images.includes(s)) r.images.push(s);
  });
  return r;
}

function scrapeBestBuy() {
  const r = { title: '', price: '', images: [], videos: [], variants: [] };
  const sym = detectPageCurrencySymbol() || '$';
  const titleEl = document.querySelector('h1.sku-title, [class*="product-title"]');
  if (titleEl) r.title = titleEl.innerText.trim();
  r.price = priceFromSelectors(['.priceView-customer-price span[aria-hidden="true"]', '.priceView-hero-price span']);
  if (r.price) r.price = ensureCurrency(r.price, sym);
  const galleryScope = findProductGalleryContainer() || document;
  collectImagesBySelector('.primary-image-container img, .shop-media-gallery img', galleryScope).forEach(s => {
    if (!isBadImage(s) && !r.images.includes(s)) r.images.push(s);
  });
  return r;
}

// Ã¢â€â‚¬Ã¢â€â‚¬ ISSUE 3 FIX: Universal generic scraper Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// Works on any e-commerce site with JSON-LD or structured markup.
function scrapeGeneric() {
  const r = { title: '', price: '', images: [], videos: [], variants: [] };
  const og = document.querySelector('meta[property="og:title"]');
  r.title = og?.content || document.title || '';

  // Try JSON-LD product title first
  document.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
    try {
      const j = JSON.parse(s.textContent || '{}');
      const stack = Array.isArray(j) ? [...j] : [j];
      while (stack.length) {
        const it = stack.shift();
        if (!it || typeof it !== 'object') continue;
        if (!r.title && it.name && /Product|Offer/i.test(it['@type'] || '')) {
          r.title = String(it.name).trim();
        }
        if (it.image) {
          (Array.isArray(it.image) ? it.image : [it.image]).forEach(x => {
            const u = typeof x === 'string' ? x : (x.url || x.contentUrl || '');
            if (u && !isBadImage(u)) r.images.push(u);
          });
        }
        Object.values(it).forEach(v => { if (v && typeof v === 'object') stack.push(v); });
      }
    } catch (_) {}
  });

  const ogImg = document.querySelector('meta[property="og:image"]');
  if (ogImg?.content && !isBadImage(ogImg.content)) r.images.push(ogImg.content);

  // ISSUE 1 FIX: Use universalPrice() with currency-symbol detection
  r.price = universalPrice();

  // ISSUE 4 FIX: Images only from product gallery area
  const galleryScope = findProductGalleryContainer();
  if (galleryScope) {
    collectScopedImages(galleryScope)
      .filter(src => !isBadImage(src))
      .forEach(src => r.images.push(src));
  } else {
    // Fallback: only images meeting minimum dimensions, skip known bad patterns
    Array.from(document.querySelectorAll('img'))
      .filter(img => {
        if (isBadImage(img.src || '')) return false;
        // Skip images in known non-product sections
        const ancestor = img.closest(
          'footer, header, nav, [class*="recommend"], [class*="similar"], ' +
          '[class*="related"], [class*="review"], [class*="cart"], ' +
          '[class*="checkout"], [class*="sidebar"], [class*="widget"], ' +
          '[class*="ad-"], [class*="promo"], [id*="footer"], [id*="header"]'
        );
        if (ancestor) return false;
        const w = img.naturalWidth || parseInt(img.getAttribute('width') || '0');
        const h = img.naturalHeight || parseInt(img.getAttribute('height') || '0');
        if (w && w < 200) return false;
        if (h && h < 200) return false;
        return true;
      })
      .slice(0, 12)
      .forEach(img => r.images.push(img.src));
  }

  return r;
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Enhancement (Merge) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
function mergeUnique(target, items, keyFn) {
  const seen = new Set(target.map(keyFn));
  for (const it of items) {
    const k = keyFn(it);
    if (k && !seen.has(k)) {
      seen.add(k);
      target.push(it);
    }
  }
  return target;
}

async function enhanceWithGlobals(data) {
  data.images   = [...new Set((data.images || []).filter(Boolean))];
  data.videos   = [...new Set((data.videos || []).filter(Boolean))];
  data.variants = data.variants || [];

  const harvested = await harvestInlineJson();

  const scItemId = data._scItemId || '';
  const isSamsClubPage = /samsclub\.com/i.test(location.hostname);
  let harvestedImages = harvested.images;
  if (isSamsClubPage && scItemId) {
    const filtered = harvestedImages.filter(u => u.includes(scItemId));
    if (filtered.length > 0) harvestedImages = filtered;
  }

  // ISSUE 2 FIX: Filter harvested images through isBadImage before merging
  harvestedImages = harvestedImages.filter(u => !isBadImage(u));

  // Only merge JSON harvested images if the platform doesn't have a strict DOM image scraper
  if (!data._strictImages) {
    mergeUnique(data.images, harvestedImages, canonImageKey);
  }
  
  mergeUnique(data.videos, harvested.videos, x => (YT_REGEX.test(x) ? ytWatch(x) : x));

  // ISSUE 1 FIX: Only use harvested price if it has a currency symbol
  if (!data.price && harvested.price && /[$Ã‚Â£Ã¢â€šÂ¬Ã‚Â¥Ã¢â€šÂ¹Ã¢â€šÂ©]/.test(harvested.price)) {
    data.price = harvested.price;
  }

  // OG / twitter image fallbacks Ã¢â‚¬â€ use mergeUnique so they don't duplicate
  // images already collected from the gallery or JSON harvest.
  const ogImages = [];
  document.querySelectorAll('meta[property="og:image"], meta[property="og:image:secure_url"], meta[name="twitter:image"]')
    .forEach(m => { if (m.content && !isBadImage(m.content)) ogImages.push(m.content); });
  mergeUnique(data.images, ogImages, canonImageKey);

  // OG video fallbacks
  document.querySelectorAll('meta[property="og:video"], meta[property="og:video:url"], meta[property="og:video:secure_url"], meta[name="twitter:player:stream"]')
    .forEach(m => { if (m.content) data.videos.push(m.content); });

  if (!data.title) {
    const og = document.querySelector('meta[property="og:title"]');
    data.title = og?.content || document.title || '';
  }

  return data;
}

// Ã¢â€â‚¬Ã¢â€â‚¬ ISSUE 3 FIX: Dispatcher Ã¢â‚¬â€ expanded platform detection Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
function pickPlatform() {
  const h = host();
  if (h.includes('amazon.'))                                  return scrapeAmazon;
  if (h.endsWith('walmart.com') || h.includes('walmart.'))   return scrapeWalmart;
  if (h.includes('samsclub.com'))                             return scrapeSamsClub;
  if (h.includes('faire.com'))                               return scrapeFaire;
  if (h.includes('alibaba.com'))                             return scrapeAlibaba;
  if (h.includes('aliexpress.'))                             return scrapeAliExpress;
  if (h.includes('temu.com') || h.includes('temu.'))         return scrapeTemu;
  if (h.includes('ebay.'))                                   return scrapeEbay;
  if (h.includes('daraz.'))                                  return scrapeDaraz;
  if (h.includes('flipkart.com'))                            return scrapeFlipkart;
  if (h.includes('noon.com'))                                return scrapeNoon;
  if (h.includes('etsy.com'))                                return scrapeEtsy;
  if (h.includes('shein.com'))                               return scrapeShein;
  if (h.includes('youtube.com') || h.includes('youtu.be'))   return scrapeYouTube;
  if (h.includes('worldwidegolfballs.com') || h.includes('worldwidegolfshops.com')) return scrapeWorldwideGolfBalls;
  if (h.includes('worldgolfshop.com') || h.includes('golf.com') || h.includes('rockbottomgolf.com')) return scrapeGolfRetail;
  if (h.includes('target.com'))                              return scrapeTarget;
  if (h.includes('costco.com'))                              return scrapeCostco;
  if (h.includes('homedepot.com'))                           return scrapeHomeDepot;
  if (h.includes('bestbuy.com'))                             return scrapeBestBuy;
  // Detect Shopify and WooCommerce by DOM signals
  if (document.querySelector(
    '[data-product-form], form[action*="/cart/add"], ' +
    '.woocommerce-product-gallery, body.woocommerce, ' +
    '[class*="shopify"], meta[name="shopify-digital-wallet"]'
  )) return scrapeShopify;
  // Detect BigCommerce
  if (document.querySelector('[data-product-option-change], [class*="ProductView"], .productView')) return scrapeShopify;
  // Fallback: check JSON-LD for Product type Ã¢â‚¬â€ use generic with full power
  return scrapeGeneric;
}

async function scrapePageData() {
  let data;
  try {
    const platformFn = pickPlatform();
    data = await platformFn() || {};
  } catch (_) {
    data = { title: document.title || '', price: '', images: [], videos: [], variants: [] };
  }

  data = await enhanceWithGlobals(data);

  // Centralized: collect DOM videos not already found by platform scraper
  try {
    collectDomVideos().forEach(v => {
      if (!data.videos.includes(v)) data.videos.push(v);
    });
  } catch(_) {}
  // Centralized: collect variants if platform scraper found none
  if (!data.variants || data.variants.length === 0) {
    try { data.variants = collectVariants(); } catch(_) {}
  }

  data.url      = location.href;
  // Filter out transient browser states ("Adding to Cart...", "Loading...", etc.)
  // that Amazon and other sites temporarily set as the page/tab title.
  const BAD_TITLE = /^(adding to cart|add to cart|added to cart|loading\.\.\.|please wait\.\.\.?|checkout|your amazon\.com cart|amazon\.com shopping cart|cart|processing)/i;
  const docTitle = BAD_TITLE.test((document.title || '').trim()) ? '' : document.title;
  const candidateTitle = (data.title || docTitle || '').trim();
  data.title = BAD_TITLE.test(candidateTitle) ? '' : candidateTitle;

  // ISSUE 1 FIX: Ensure price has a currency symbol Ã¢â‚¬â€ detect from page
  if (data.price && !/[$Ã‚Â£Ã¢â€šÂ¬Ã‚Â¥Ã¢â€šÂ¹Ã¢â€šÂ©]/.test(data.price) && !/^(USD|CAD|AUD|GBP|EUR|PKR|INR)/i.test(data.price)) {
    const sym = detectPageCurrencySymbol();
    data.price = `${sym}${data.price}`;
  }

  data.images   = dedupeImages(data.images).slice(0, IMG_CAP);
  data.videos   = dedupeVideos(data.videos).slice(0, VID_CAP);
  data.variants = [...new Set(data.variants || [])].slice(0, 16);
  data.videoUrl = data.videos[0] || '';

  return data;
}


// Ã¢â€â‚¬Ã¢â€â‚¬ Message Listener Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  try {
    if (message?.action === 'SCRAPE_PAGE') {
      scrapePageData().then(data => {
        sendResponse({ success: true, data });
      }).catch(err => {
        sendResponse({
          success: false,
          error: err?.message || 'scrape_failed',
          data: { title: document.title || '', url: location.href, price: '', images: [], videos: [], variants: [] }
        });
      });
      return true;
    }
    if (message?.action === 'GET_PRODUCT_LINKS') {
      const seen = new Set();
      const links = [];
      document.querySelectorAll('a[href], [data-href]').forEach(anchor => {
        const raw = anchor.getAttribute('href') || anchor.getAttribute('data-href') || '';
        try {
          const u = new URL(raw, location.href);
          if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
          u.hash = '';
          const url = u.href;
          if (seen.has(url)) return;
          seen.add(url);
          links.push({ url, title: (anchor.textContent || anchor.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 300) });
        } catch (_) {}
      });
      sendResponse({ success: true, links: links.slice(0, 500) });
      return true;
    }
    if (message?.action === 'GET_PAGE_INFO') {
      sendResponse({ success: true, url: location.href, title: document.title || '' });
      return true;
    }
    if (message?.action === 'PING') {
      sendResponse({ success: true, ready: true });
      return true;
    }
  } catch (err) {
    sendResponse({
      success: false,
      error: err?.message || 'scrape_failed',
      data: { title: document.title || '', url: location.href, price: '', images: [], videos: [], variants: [] }
    });
  }
  return true;
});

// Ã¢â€â‚¬Ã¢â€â‚¬ In-Page ZHunter Floating Button Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
(function() {
  const BG_PLATFORM_KEYS = [
    'walmart.com', 'amazon.', 'samsclub.com', 'faire.com', 'aliexpress.',
    'alibaba.com', 'temu.', 'ebay.', 'etsy.com', 'shein.com', 'daraz.',
    'worldwidegolfballs.com', 'worldwidegolfshops.com', 'flipkart.com',
    'noon.com', 'lazada.', 'myshopify.com', 'target.com', 'costco.com',
    'bestbuy.com', 'homedepot.com'
  ];

  const currentHost = host();
  const currentPath = location.pathname.toLowerCase();
  const currentUrl  = location.href.toLowerCase();

  // Step 1: Must be a known shopping domain
  const isProductDomain = BG_PLATFORM_KEYS.some(k => currentHost.includes(k));
  if (!isProductDomain) return;

  // Step 2: Must be an actual product page Ã¢â‚¬â€ NOT search/category/home
  const PRODUCT_URL_PATTERNS = [
    /\/ip\//,           // Walmart: /ip/product-name/12345
    /\/dp\//,           // Amazon: /dp/ASIN
    /\/gp\/product\//,  // Amazon alternate
    /\/product\//,      // Sam's Club, generic
    /\/itm\//,          // eBay: /itm/12345
    /\/listing\//,      // Etsy: /listing/12345
    /\/item\//,         // AliExpress, Lazada
    /\/goods[-_]?(detail)?/,  // Temu
    /\/p-/,             // Shein, Daraz: /p-1234
    /\/products?\//,    // Shopify stores
    /\/pd\//,           // BestBuy
    /\/skuId=/,         // Target, BestBuy query param
    /[?&]sku[_-]?id=/i, // generic SKU param
    /\/prd\//,          // Noon
    /\/buy\//,          // Walmart alternate
    /[?&]itemid=/,      // Lazada
    /\/asin\//,         // Amazon alternate paths
  ];

  const NON_PRODUCT_PATTERNS = [
    /\/search[\/?]/,
    /\/s\?/,
    /\/browse\//,
    /\/category\//,
    /\/collection/,
    /\/shop\/?$/,
    /\/deals\/?/,
    /\/offers\/?/,
    /^\/?$/,            // homepage (root path)
    /\/cart\//,
    /\/checkout\//,
    /\/account\//,
    /\/wishlist\//,
  ];

  const isNonProduct = NON_PRODUCT_PATTERNS.some(p => p.test(currentPath) || p.test(currentUrl));
  if (isNonProduct) return;

  const isProductPage = PRODUCT_URL_PATTERNS.some(p => p.test(currentPath) || p.test(currentUrl));
  if (!isProductPage) return;

  // Wait for document to be interactive or complete
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFloatingButton);
  } else {
    initFloatingButton();
  }

  function initFloatingButton() {
    // Avoid double injection
    if (document.getElementById('zhunter-floating-root')) return;

    console.log('[ZHunter] Initializing floating button on:', location.href);

    const root = document.createElement('div');
    root.id = 'zhunter-floating-root';
    root.style.position = 'fixed';
    root.style.top = '20px';
    root.style.right = '20px';
    root.style.zIndex = '2147483647';
    root.style.pointerEvents = 'auto';
    document.body.appendChild(root);

    const shadow = root.attachShadow({ mode: 'open' });

    // Stylesheet matching ZHunter cyberpunk theme (neon cyan / neon green)
    const style = document.createElement('style');
    style.textContent = `
      .zhunter-float-wrap {
        display: flex;
        align-items: center;
        gap: 8px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Outfit", sans-serif;
        pointer-events: auto;
      }
      .zhunter-btn {
        background: linear-gradient(135deg, #06b6d4, #0891b2) !important;
        color: #ffffff !important;
        border: 1px solid rgba(6, 182, 212, 0.4) !important;
        padding: 8px 14px !important;
        border-radius: 20px !important;
        font-size: 12px !important;
        font-weight: 700 !important;
        letter-spacing: 0.5px !important;
        cursor: pointer !important;
        box-shadow: 0 0 16px rgba(6, 182, 212, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.2) !important;
        transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1) !important;
        display: flex !important;
        align-items: center !important;
        gap: 6px !important;
        user-select: none !important;
        backdrop-filter: blur(4px) !important;
        pointer-events: auto !important;
      }
      .zhunter-btn:hover {
        transform: translateY(-2px) !important;
        box-shadow: 0 0 24px rgba(6, 182, 212, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.2) !important;
        border-color: rgba(6, 182, 212, 0.8) !important;
      }
      .zhunter-btn:active {
        transform: translateY(0) !important;
      }
      .zhunter-btn.added {
        background: linear-gradient(135deg, #10b981, #059669) !important;
        border-color: rgba(16, 185, 129, 0.4) !important;
        box-shadow: 0 0 16px rgba(16, 185, 129, 0.25) !important;
      }
      .zhunter-btn.added:hover {
        box-shadow: 0 0 24px rgba(16, 185, 129, 0.45) !important;
        border-color: rgba(16, 185, 129, 0.8) !important;
      }
      .zhunter-icon {
        font-size: 13px !important;
        line-height: 1 !important;
      }
      /* Quick In-Page Toast */
      .zhunter-toast {
        position: fixed;
        top: 70px;
        right: 20px;
        background: rgba(15, 23, 42, 0.95) !important;
        color: #e2e8f0 !important;
        border: 1px solid rgba(6, 182, 212, 0.3) !important;
        padding: 8px 16px !important;
        border-radius: 8px !important;
        font-size: 12px !important;
        font-weight: 500 !important;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3) !important;
        transform: translateY(-20px) !important;
        opacity: 0 !important;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
        pointer-events: none !important;
        display: flex !important;
        align-items: center !important;
        gap: 6px !important;
      }
      .zhunter-toast.show {
        transform: translateY(0) !important;
        opacity: 1 !important;
      }
    `;
    shadow.appendChild(style);

    const wrap = document.createElement('div');
    wrap.className = 'zhunter-float-wrap';

    const btn = document.createElement('button');
    btn.className = 'zhunter-btn';
    btn.innerHTML = '<span class="zhunter-icon">Ã¢Å¡Â¡</span><span>Add to Queue</span>';

    const toast = document.createElement('div');
    toast.className = 'zhunter-toast';
    toast.innerHTML = '<span>Ã°Å¸Å¡â‚¬</span><span>Product added to ZHunter Queue!</span>';

    wrap.appendChild(btn);
    shadow.appendChild(wrap);
    shadow.appendChild(toast);

    const normUrl = location.href.split('#')[0].trim();

    // Check if already in queue
    try {
      console.log('[ZHunter] Checking initial queue status...');
      chrome.runtime.sendMessage({ action: 'GET_BULK_QUEUE' }, (response) => {
        if (chrome.runtime.lastError) {
          console.warn('[ZHunter] Could not fetch queue (extension reloaded/disconnected):', chrome.runtime.lastError.message);
          return;
        }
        const q = response?.queue || [];
        if (q.some(item => item.url === normUrl)) {
          console.log('[ZHunter] Product is already queued.');
          markAdded();
        }
      });
    } catch (e) {
      console.warn('[ZHunter] Exception querying queue:', e);
    }

    function markAdded() {
      btn.classList.add('added');
      btn.innerHTML = '<span class="zhunter-icon">Ã¢Å“â€œ</span><span>Queued</span>';
    }

    function showToast() {
      toast.classList.add('show');
      setTimeout(() => {
        toast.classList.remove('show');
      }, 2500);
    }

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();

      if (btn.classList.contains('added')) {
        console.log('[ZHunter] Product already queued. Ignoring click.');
        return;
      }

      console.log('[ZHunter] Floating button clicked. Sending ADD_TO_BULK_QUEUE...');

      // Detect current platform name
      let platformName = null;
      try {
        const platMatch = BG_PLATFORM_KEYS.find(k => currentHost.includes(k));
        if (platMatch) {
          platformName = platMatch.split('.')[0];
          platformName = platformName.charAt(0).toUpperCase() + platformName.slice(1);
        }
      } catch (_) {}

      try {
        chrome.runtime.sendMessage({
          action: 'ADD_TO_BULK_QUEUE',
          url: normUrl,
          title: document.title,
          platform: platformName
        }, (res) => {
          if (chrome.runtime.lastError) {
            console.error('[ZHunter] Send message error:', chrome.runtime.lastError);
            alert("ZHunter Connection Error!\nThe extension was reloaded in the background. Please refresh this tab to reconnect and add the product.");
            return;
          }
          console.log('[ZHunter] Queue add response:', res);
          if (res?.success || res?.reason === 'duplicate') {
            markAdded();
            showToast();
          } else {
            alert("Failed to add product: " + (res?.reason || 'unknown error'));
          }
        });
      } catch (err) {
        console.error('[ZHunter] Context invalidated error on click:', err);
        alert("ZHunter Connection Error!\nThe extension was reloaded in the background. Please refresh this tab to reconnect and add the product.");
      }
    });
  }
})();

// Ã¢â€â‚¬Ã¢â€â‚¬ ZHunter In-Page Image Panel Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
(function () {
  const PANEL_ID = 'zhunter-img-panel-root';
  const IMG_PLATFORM_KEYS = [
    'walmart.com', 'amazon.', 'samsclub.com', 'faire.com', 'aliexpress.',
    'alibaba.com', 'temu.', 'ebay.', 'etsy.com', 'shein.com', 'daraz.',
    'worldwidegolfballs.com', 'worldwidegolfshops.com', 'flipkart.com',
    'noon.com', 'lazada.', 'myshopify.com', 'target.com', 'costco.com',
    'bestbuy.com', 'homedepot.com'
  ];
  const PRODUCT_PATH_PATTERNS = [
    /\/ip\//,/\/dp\//,/\/gp\/product\//,/\/product\//,/\/itm\//,
    /\/listing\//,/\/item\//,/\/goods[-_]?(detail)?/,/\/p-/,
    /\/products?\//,/\/pd\//,/\/skuId=/,/[?&]sku[_-]?id=/i,
    /\/prd\//,/\/buy\//,/[?&]itemid=/,/\/asin\//
  ];
  const NON_PRODUCT_PATTERNS = [
    /\/search[\/?]/,/\/s\?/,/\/browse\//,/\/category\//,/\/collection/,
    /\/shop\/?$/,/\/deals\/?/,/\/offers\/?/,/^\/?$/,
    /\/cart\//,/\/checkout\//,/\/account\//,/\/wishlist\//
  ];

  const h = host();
  const path = location.pathname.toLowerCase();
  const href = location.href.toLowerCase();

  if (!IMG_PLATFORM_KEYS.some(k => h.includes(k))) return;
  if (NON_PRODUCT_PATTERNS.some(p => p.test(path) || p.test(href))) return;
  if (!PRODUCT_PATH_PATTERNS.some(p => p.test(path) || p.test(href))) return;

  // Ã¢â€â‚¬Ã¢â€â‚¬ Image Collector Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  function collectPageImages() {
    const seen = new Set();
    const imgs = [];

    const push = (url) => {
      if (!url || typeof url !== 'string') return;
      try {
        const abs = new URL(url, location.href).href;
        if (seen.has(abs)) return;
        if (/\.(svg|gif|ico|webp)(\?|$)/i.test(abs) && !/product|item|goods/i.test(abs)) return;
        if (/logo|icon|badge|sprite|avatar|banner|placeholder/i.test(abs)) return;
        seen.add(abs);
        imgs.push(abs);
      } catch (_) {}
    };

    // 1. OG image (most reliable first)
    document.querySelectorAll('meta[property="og:image"], meta[name="og:image"]')
      .forEach(m => push(m.content));

    // 2. JSON-LD images
    document.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
      try {
        const d = JSON.parse(s.textContent);
        const extract = o => {
          if (!o) return;
          if (Array.isArray(o)) { o.forEach(extract); return; }
          if (typeof o === 'string') { push(o); return; }
          if (o.image) extract(o.image);
          if (o.url && /\.(jpe?g|png|webp)/i.test(o.url)) push(o.url);
          if (o.contentUrl) push(o.contentUrl);
        };
        extract(d);
      } catch (_) {}
    });

    // 3. Gallery / product-zone images
    const gallerySelectors = [
      '[data-testid*="product-image"] img', '[data-testid*="hero"] img',
      '.product-image img', '.product__images img', '.product-gallery img',
      '#imageBlock img', '#altImages img', '.imgTagWrapper img',
      '[class*="gallery"] img', '[class*="Gallery"] img',
      '[class*="product"] img', '[class*="Product"] img',
      '[class*="carousel"] img', '[class*="slider"] img',
      'img[data-zoom-image]', 'img[data-large-src]',
      'img[data-src*="product"]', 'img[data-original]',
      '.swiper-slide img', '.slick-slide img'
    ];
    document.querySelectorAll(gallerySelectors.join(', ')).forEach(img => {
      const src = img.dataset.zoomImage || img.dataset.largeSrc ||
                  img.dataset.original || img.dataset.src || img.src || '';
      if (src && img.naturalWidth > 80 && img.naturalHeight > 80) push(src);
    });

    // 4. Amazon-specific hi-res
    document.querySelectorAll('[data-a-dynamic-image]').forEach(el => {
      try {
        const map = JSON.parse(el.dataset.aDynamicImage || '{}');
        Object.keys(map).forEach(push);
      } catch (_) {}
    });

    return imgs.slice(0, 20);
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ Download helper Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  function downloadViaBackground(url, filename) {
    chrome.runtime.sendMessage({ action: 'FETCH_BASE64', url }, res => {
      if (chrome.runtime.lastError || !res?.base64) {
        // Fallback: direct anchor
        const a = document.createElement('a');
        a.href = url; a.download = filename; a.target = '_blank';
        document.body.appendChild(a); a.click();
        setTimeout(() => a.remove(), 500);
        return;
      }
      const ext = url.match(/\.(jpe?g|png|webp|gif)/i)?.[1] || 'jpg';
      const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
                 : ext === 'png' ? 'image/png'
                 : ext === 'webp' ? 'image/webp' : 'image/jpeg';
      const dataUrl = `data:${mime};base64,${res.base64}`;
      const a = document.createElement('a');
      a.href = dataUrl; a.download = filename;
      document.body.appendChild(a); a.click();
      setTimeout(() => a.remove(), 500);
    });
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ Init Panel Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  function initImagePanel() {
    if (document.getElementById(PANEL_ID)) return;

    const root = document.createElement('div');
    root.id = PANEL_ID;
    Object.assign(root.style, {
      position: 'fixed', top: '80px', right: '0',
      zIndex: '2147483640', fontFamily: 'sans-serif'
    });
    document.documentElement.appendChild(root);

    const shadow = root.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      * { box-sizing: border-box; margin: 0; padding: 0; }
      :host { all: initial; }

      @keyframes zh-slide-in {
        from { opacity: 0; transform: translateX(100%) scale(0.95); }
        to   { opacity: 1; transform: translateX(0) scale(1); }
      }
      @keyframes zh-fade-up {
        from { opacity: 0; transform: translateY(10px) scale(0.9); }
        to   { opacity: 1; transform: translateY(0) scale(1); }
      }
      @keyframes zh-border-pulse {
        0%,100% { border-color: rgba(0,229,255,0.35); box-shadow: -4px 0 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(0,229,255,0.08); }
        50%      { border-color: rgba(0,229,255,0.7); box-shadow: -6px 0 40px rgba(0,229,255,0.15), 0 0 0 1px rgba(0,229,255,0.2); }
      }
      @keyframes zh-shimmer {
        0%   { background-position: -200% 0; }
        100% { background-position: 200% 0; }
      }
      @keyframes zh-check-pop {
        0%   { transform: scale(0) rotate(-20deg); opacity: 0; }
        60%  { transform: scale(1.3) rotate(5deg); opacity: 1; }
        100% { transform: scale(1) rotate(0deg); opacity: 1; }
      }
      @keyframes zh-btn-shine {
        0%   { background-position: -200% center; }
        100% { background-position: 200% center; }
      }

      .panel {
        width: 295px;
        background: rgba(4, 8, 20, 0.96);
        backdrop-filter: blur(20px) saturate(180%);
        border: 1px solid rgba(0,229,255,0.35);
        border-right: none;
        border-radius: 16px 0 0 16px;
        box-shadow: -4px 0 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(0,229,255,0.08);
        overflow: hidden;
        font-family: 'Inter', system-ui, -apple-system, sans-serif;
        animation: zh-slide-in 0.45s cubic-bezier(0.16,1,0.3,1) both, zh-border-pulse 4s ease-in-out 1.5s infinite;
        transition: transform 0.4s cubic-bezier(0.16,1,0.3,1);
      }
      .panel.collapsed { transform: translateX(253px); animation: zh-border-pulse 4s ease-in-out infinite; }

      .header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 11px 12px;
        background: linear-gradient(135deg, rgba(0,229,255,0.13) 0%, rgba(6,182,212,0.06) 50%, rgba(14,165,233,0.04) 100%);
        border-bottom: 1px solid rgba(0,229,255,0.15);
        cursor: pointer; user-select: none;
        transition: background 0.2s;
      }
      .header:hover { background: linear-gradient(135deg, rgba(0,229,255,0.18) 0%, rgba(6,182,212,0.10) 100%); }
      .header-left { display: flex; align-items: center; gap: 8px; }
      .header-icon {
        width: 28px; height: 28px;
        background: linear-gradient(135deg, #00e5ff 0%, #0ea5e9 100%);
        border-radius: 8px;
        display: flex; align-items: center; justify-content: center;
        font-size: 14px; flex-shrink: 0;
        box-shadow: 0 2px 12px rgba(0,229,255,0.5), 0 0 0 1px rgba(0,229,255,0.2);
        transition: transform 0.2s, box-shadow 0.2s;
      }
      .header:hover .header-icon { transform: rotate(-5deg) scale(1.08); box-shadow: 0 4px 18px rgba(0,229,255,0.7); }
      .header-title { color: #e0f7fa; font-size: 12px; font-weight: 700; letter-spacing: 0.4px; text-shadow: 0 0 12px rgba(0,229,255,0.4); }
      .header-count {
        font-size: 10px; font-weight: 700; padding: 2px 8px;
        background: rgba(0,229,255,0.15); border: 1px solid rgba(0,229,255,0.35);
        border-radius: 9999px; color: #67e8f9;
        transition: background 0.2s, transform 0.15s;
      }
      .toggle-btn {
        background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1);
        cursor: pointer; color: #7dd3fc; font-size: 11px; padding: 4px 7px;
        line-height: 1; border-radius: 6px;
        transition: background 0.15s, color 0.15s, border-color 0.15s, transform 0.15s;
      }
      .toggle-btn:hover { background: rgba(0,229,255,0.12); border-color: rgba(0,229,255,0.4); color: #00e5ff; transform: scale(1.12); }

      .body { padding: 10px; max-height: 360px; overflow-y: auto; overflow-x: hidden; }
      .body::-webkit-scrollbar { width: 3px; }
      .body::-webkit-scrollbar-track { background: rgba(255,255,255,0.03); }
      .body::-webkit-scrollbar-thumb { background: linear-gradient(to bottom, #00e5ff, #0ea5e9); border-radius: 3px; }

      .empty { text-align: center; padding: 28px 12px; color: #3b6a8a; font-size: 11px; line-height: 1.7; }

      .skeleton { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
      .skel-item {
        aspect-ratio: 1; border-radius: 8px;
        background: linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(0,229,255,0.08) 50%, rgba(255,255,255,0.04) 75%);
        background-size: 200% 100%; animation: zh-shimmer 1.5s ease-in-out infinite;
      }
      .skel-item:nth-child(2) { animation-delay: 0.15s; }
      .skel-item:nth-child(3) { animation-delay: 0.30s; }
      .skel-item:nth-child(4) { animation-delay: 0.45s; }
      .skel-item:nth-child(5) { animation-delay: 0.60s; }
      .skel-item:nth-child(6) { animation-delay: 0.75s; }

      .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; }

      .img-wrap {
        position: relative; border-radius: 9px; overflow: hidden;
        border: 2px solid rgba(255,255,255,0.06); cursor: pointer;
        aspect-ratio: 1; background: #080f1e;
        transition: border-color 0.2s, transform 0.2s, box-shadow 0.2s;
        animation: zh-fade-up 0.4s cubic-bezier(0.16,1,0.3,1) both;
      }
      .img-wrap:nth-child(1)  { animation-delay: 0.05s; }
      .img-wrap:nth-child(2)  { animation-delay: 0.10s; }
      .img-wrap:nth-child(3)  { animation-delay: 0.15s; }
      .img-wrap:nth-child(4)  { animation-delay: 0.20s; }
      .img-wrap:nth-child(5)  { animation-delay: 0.25s; }
      .img-wrap:nth-child(6)  { animation-delay: 0.30s; }
      .img-wrap:nth-child(7)  { animation-delay: 0.35s; }
      .img-wrap:nth-child(8)  { animation-delay: 0.40s; }
      .img-wrap:nth-child(9)  { animation-delay: 0.45s; }
      .img-wrap:nth-child(10) { animation-delay: 0.50s; }
      .img-wrap:nth-child(11) { animation-delay: 0.55s; }
      .img-wrap:nth-child(12) { animation-delay: 0.60s; }
      .img-wrap:hover {
        border-color: rgba(0,229,255,0.5);
        transform: scale(1.06) translateY(-2px);
        box-shadow: 0 6px 20px rgba(0,0,0,0.5), 0 0 12px rgba(0,229,255,0.2);
        z-index: 2;
      }
      .img-wrap.selected { border-color: #00e5ff; box-shadow: 0 0 0 1px rgba(0,229,255,0.4), 0 4px 16px rgba(0,229,255,0.2); }
      .img-wrap img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 0.25s; }
      .img-wrap:hover img { transform: scale(1.08); }

      .img-check {
        position: absolute; top: 5px; left: 5px;
        width: 17px; height: 17px; border-radius: 5px;
        background: rgba(4,8,20,0.75); border: 1.5px solid rgba(255,255,255,0.25);
        backdrop-filter: blur(4px);
        display: flex; align-items: center; justify-content: center;
        transition: background 0.2s, border-color 0.2s;
        pointer-events: none;
      }
      .img-wrap.selected .img-check { background: #00e5ff; border-color: #00e5ff; box-shadow: 0 0 8px rgba(0,229,255,0.6); }
      .img-wrap.selected .img-check::after {
        content: '\2713';
        color: #000; font-size: 10px; font-weight: 900;
        animation: zh-check-pop 0.3s cubic-bezier(0.16,1,0.3,1);
      }
      .img-idx {
        position: absolute; bottom: 4px; right: 4px;
        font-size: 9px; font-weight: 700; color: rgba(255,255,255,0.6);
        background: rgba(0,0,0,0.55); backdrop-filter: blur(4px);
        padding: 1px 5px; border-radius: 4px;
      }

      .footer {
        padding: 9px 10px;
        border-top: 1px solid rgba(0,229,255,0.1);
        background: rgba(0,229,255,0.02);
        display: flex; gap: 6px; align-items: center;
      }
      .btn-sm {
        padding: 6px 10px; border-radius: 7px;
        font-size: 10px; font-weight: 700;
        cursor: pointer; border: 1px solid transparent;
        font-family: inherit; white-space: nowrap;
        transition: all 0.18s cubic-bezier(0.16,1,0.3,1);
        position: relative; overflow: hidden;
      }
      .btn-sm:active { transform: scale(0.94) !important; }
      .btn-ghost { background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.12); color: #7dd3fc; }
      .btn-ghost:hover { background: rgba(0,229,255,0.1); border-color: rgba(0,229,255,0.4); color: #00e5ff; transform: translateY(-1px); }
      .btn-dl {
        flex: 1;
        background: linear-gradient(90deg, #00c8ff, #0ea5e9, #00e5ff, #0ea5e9, #00c8ff);
        background-size: 200% auto;
        color: #000; font-weight: 900; letter-spacing: 0.3px;
        box-shadow: 0 2px 12px rgba(0,229,255,0.3);
        transition: all 0.3s cubic-bezier(0.16,1,0.3,1);
      }
      .btn-dl:not(:disabled):hover {
        background-position: right center;
        box-shadow: 0 4px 20px rgba(0,229,255,0.55);
        transform: translateY(-1px);
        animation: zh-btn-shine 1.2s linear infinite;
      }
      .btn-dl:not(:disabled):active { transform: translateY(1px) scale(0.97); box-shadow: 0 1px 8px rgba(0,229,255,0.3); }
      .btn-dl:disabled { opacity: 0.3; cursor: not-allowed; background: rgba(255,255,255,0.1); box-shadow: none; }

      .status-bar { padding: 4px 10px 8px; font-size: 10px; color: #3b6a8a; text-align: center; min-height: 20px; transition: color 0.3s; }
      .status-bar.ok  { color: #34d399; text-shadow: 0 0 8px rgba(52,211,153,0.4); }
      .status-bar.err { color: #f87171; }
    `;
    shadow.appendChild(style);

    const panel = document.createElement('div');
    panel.className = 'panel';
    shadow.appendChild(panel);

    // â”€â”€ Header
    const header = document.createElement('div');
    header.className = 'header';
    header.innerHTML = `
      <div class="header-left">
        <div class="header-icon">\uD83D\uDDBC</div>
        <span class="header-title">ZHunter Images</span>
        <span class="header-count" id="zh-img-count">0</span>
      </div>
      <button class="toggle-btn" id="zh-toggle-btn" title="Minimize">\u25C0</button>
    `;
    panel.appendChild(header);

    // Ã¢â€â‚¬Ã¢â€â‚¬ Body
    const body = document.createElement('div');
    body.className = 'body';
    body.id = 'zh-img-body';
    body.innerHTML = `<div class="empty">\uD83D\uDD0D Scanning images...</div>`;
    panel.appendChild(body);

    // â”€â”€ Footer
    const footer = document.createElement('div');
    footer.className = 'footer';
    footer.innerHTML = `
      <button class="btn-sm btn-ghost" id="zh-sel-all">All</button>
      <button class="btn-sm btn-ghost" id="zh-sel-none">None</button>
      <button class="btn-sm btn-dl" id="zh-dl-btn" disabled>\u2193 Download</button>
    `;
    panel.appendChild(footer);

    // Ã¢â€â‚¬Ã¢â€â‚¬ Status bar
    const statusBar = document.createElement('div');
    statusBar.className = 'status-bar';
    statusBar.id = 'zh-status';
    panel.appendChild(statusBar);

    // Ã¢â€â‚¬Ã¢â€â‚¬ State
    let images = [];
    let selected = new Set();
    let collapsed = false;

    // Ã¢â€â‚¬Ã¢â€â‚¬ Toggle collapse
    const toggleBtn = shadow.getElementById('zh-toggle-btn');
    const countEl   = shadow.getElementById('zh-img-count');
    const dlBtn     = shadow.getElementById('zh-dl-btn');
    const status    = shadow.getElementById('zh-status');

    header.addEventListener('click', (e) => {
      if (e.target === toggleBtn) return;
      collapsed = !collapsed;
      panel.classList.toggle('collapsed', collapsed);
      toggleBtn.textContent = collapsed ? '\u25B6' : '\u25C0';
    });
    toggleBtn.addEventListener('click', () => {
      collapsed = !collapsed;
      panel.classList.toggle('collapsed', collapsed);
      toggleBtn.textContent = collapsed ? '\u25B6' : '\u25C0';
    });

    // Ã¢â€â‚¬Ã¢â€â‚¬ Render grid
    function renderGrid() {
      const b = shadow.getElementById('zh-img-body');
      if (!images.length) {
        b.innerHTML = `<div class="empty">No product images found<br>on this page.</div>`;
        return;
      }
      countEl.textContent = images.length;
      const grid = document.createElement('div');
      grid.className = 'grid';
      images.forEach((url, i) => {
        const wrap = document.createElement('div');
        wrap.className = 'img-wrap' + (selected.has(i) ? ' selected' : '');
        wrap.innerHTML = `
          <img src="${url}" loading="lazy" alt="img ${i+1}" title="${url}"
               onerror="this.style.opacity='0.2';this.src='data:image/svg+xml,<svg xmlns=\\'http://www.w3.org/2000/svg\\' viewBox=\\'0 0 100 100\\'><text y=\\'.9em\\' font-size=\\'90\\'>\u{1F5BC}</text></svg>'">
          <div class="img-check"></div>
          <div class="img-idx">${i + 1}</div>
        `;
        wrap.addEventListener('click', () => {
          if (selected.has(i)) selected.delete(i);
          else selected.add(i);
          wrap.classList.toggle('selected', selected.has(i));
          updateDlBtn();
        });
        grid.appendChild(wrap);
      });
      b.innerHTML = '';
      b.appendChild(grid);
      updateDlBtn();
    }

    function updateDlBtn() {
      const n = selected.size;
      dlBtn.disabled = n === 0;
      dlBtn.textContent = n > 0 ? `\u2193 Download ${n}` : '\u2193 Download';
    }

    // Ã¢â€â‚¬Ã¢â€â‚¬ Select All / None
    shadow.getElementById('zh-sel-all').addEventListener('click', () => {
      images.forEach((_, i) => selected.add(i));
      renderGrid();
    });
    shadow.getElementById('zh-sel-none').addEventListener('click', () => {
      selected.clear();
      renderGrid();
    });

    // Ã¢â€â‚¬Ã¢â€â‚¬ Download Selected
    dlBtn.addEventListener('click', async () => {
      if (!selected.size) return;
      dlBtn.disabled = true;
      const toDownload = [...selected].sort();
      let done = 0;

      status.className = 'status-bar';
      status.textContent = `Downloading 0 / ${toDownload.length}...`;

      const productSlug = document.title.replace(/[^a-z0-9]/gi, '-').toLowerCase().slice(0, 30);

      for (const idx of toDownload) {
        const url = images[idx];
        const ext = url.match(/\.(jpe?g|png|webp|gif)/i)?.[1] || 'jpg';
        const filename = `${productSlug}-img${idx + 1}.${ext}`;
        try {
          downloadViaBackground(url, filename);
          done++;
          status.textContent = `Downloading ${done} / ${toDownload.length}...`;
          await new Promise(r => setTimeout(r, 400)); // stagger downloads
        } catch (_) {}
      }

      status.className = 'status-bar ok';
      status.textContent = `\u2713 ${done} image${done !== 1 ? 's' : ''} downloaded!`;
      dlBtn.disabled = false;
      setTimeout(() => { status.textContent = ''; status.className = 'status-bar'; }, 4000);
    });

    // Ã¢â€â‚¬Ã¢â€â‚¬ Load images (with delay for SPAs)
    setTimeout(() => {
      images = collectPageImages();
      selected = new Set(images.map((_, i) => i)); // select all by default
      renderGrid();
      if (images.length === 0) {
        // Retry once after 2s for slow SPAs
        setTimeout(() => {
          images = collectPageImages();
          selected = new Set(images.map((_, i) => i));
          renderGrid();
        }, 2000);
      }
    }, 1200);
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ Kick off
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initImagePanel);
  } else {
    initImagePanel();
  }
})();

} // end __zhunterContentLoaded guard
