// ============================================================
// ZHunter PRO v8.1.1 — Side Panel Controller
// v9: image role badges, quality scores, role filters,
//     Research Workbook export, queue-engine module
// ============================================================
'use strict';

// ── CSP-safe <img> error handling (MV3 blocks inline onerror=) ─────────
// Usage: <img data-onerror="hide|broken|vidicon">
document.addEventListener('error', e => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement)) return;
  const mode = img.dataset.onerror;
  if (!mode) return;
  const parent = img.parentElement;
  if (mode === 'hide') {
    img.style.display = 'none';
  } else if (mode === 'broken' && parent) {
    parent.classList.add('broken');
    img.style.display = 'none';
    if (!parent.querySelector('.hunt-img-broken')) {
      const d = document.createElement('div');
      d.className = 'hunt-img-broken';
      d.textContent = 'Image broken \u2014 auto-skipped';
      parent.appendChild(d);
    }
  } else if (mode === 'vidicon' && parent) {
    parent.innerHTML = '<div class=vid-thumb-icon>&#9654;</div>';
  }
}, true);

const UI_KEY = 'zakUIState';
const APP_VERSION = chrome.runtime.getManifest().version;

// ── State ────────────────────────────────────────────────────
const State = {
  data: { links: [], folders: [], tags: [], settings: {} },
  view: 'list',
  inputMode: 'manual', // v8.3.1: the auto 'Review before saving' modal is off; Hunt tab + Bulk are the workflow
  theme: 'dark',
  selectedTags: [],
  editTags: [],
  editImages: [],
  collectImages: [],
  collectVideoUrl: '',      // video URL for current product
  collectVideos: [],        // multiple product videos
  openFolders: new Set(),
  confirmCb: null,
  bulkMode: false,
  selectedIds: new Set(),
  folderSearch: '',
  imageUrlTarget: 'collect', // 'collect' or 'edit'
  renderPage: 0,
  PAGE_SIZE: 30
};


function applyDynamicVersion() {
  const version = `v${APP_VERSION}`;
  document.querySelectorAll('.brand-version, [data-version]').forEach(el => { el.textContent = version; });
}

// ── DOM Helper ───────────────────────────────────────────────
function $(id) { return document.getElementById(id); }

// ── Message Helper ───────────────────────────────────────────
function msg(payload) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(payload, res => {
      if (chrome.runtime.lastError) {
        resolve({ success: false, error: chrome.runtime.lastError.message });
      } else {
        resolve(res || { success: false, error: 'no_response' });
      }
    });
  });
}

// ── Utility Functions ────────────────────────────────────────
function isValidURL(s) {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch { return false; }
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Unicode-safe base64 encode/decode (btoa crashes on non-ASCII)
function safeEncode(obj) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
}
function safeDecode(str) {
  return JSON.parse(decodeURIComponent(escape(atob(str))));
}

function safeHref(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'http:' || u.protocol === 'https:') return esc(url);
  } catch (_) {}
  return '#';
}

function trunc(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function csvEsc(v) {
  const s = String(v || '');
  return (s.includes(',') || s.includes('"') || s.includes('\n'))
    ? `"${s.replace(/"/g, '""')}"` : s;
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: '2-digit'
    });
  } catch { return ''; }
}

// ── Save a Blob with a real filename ─────────────────────────
// The library's writeFile inside the side panel produced a uuid-named download.
// chrome.downloads keeps the filename; falls back to an anchor if needed.
async function zhSaveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const cleanup = () => setTimeout(() => URL.revokeObjectURL(url), 60000);
  try {
    if (chrome?.downloads?.download) {
      await chrome.downloads.download({ url, filename, conflictAction: 'uniquify' });
      cleanup();
      return;
    }
  } catch (_) {}
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
}

function dlFile(content, name, mime) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), {
    href: url, download: name, style: 'display:none'
  });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}

function makeBtn(className, title, svgHTML) {
  const btn = document.createElement('button');
  btn.className = className;
  btn.title = title;
  btn.setAttribute('aria-label', title);
  btn.type = 'button';
  btn.innerHTML = svgHTML;
  return btn;
}

// MIRRORED: detectCat / isValidURL / getFav are intentionally repeated from background.js.
// Extension pages and service workers run in separate contexts \u2014 no shared module without a bundler.
// Keep logic in sync with background.js if either copy changes.
function detectCat(url) {
  try {
    const h = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    const map = {
      'amazon': 'Amazon', 'youtube': 'YouTube', 'youtu.be': 'YouTube',
      'github': 'GitHub', 'twitter': 'Twitter/X', 'x.com': 'Twitter/X',
      'reddit': 'Reddit', 'linkedin': 'LinkedIn', 'instagram': 'Instagram',
      'facebook': 'Facebook', 'wikipedia': 'Wikipedia',
      'stackoverflow': 'Stack Overflow', 'medium': 'Medium',
      'netflix': 'Netflix', 'google': 'Google', 'twitch': 'Twitch',
      'tiktok': 'TikTok', 'pinterest': 'Pinterest', 'ebay': 'eBay',
      'etsy': 'Etsy', 'apple': 'Apple', 'microsoft': 'Microsoft',
      'figma': 'Figma', 'notion': 'Notion', 'temu': 'Temu',
      'aliexpress': 'AliExpress', 'walmart': 'Walmart',
      'shopify': 'Shopify', 'shein': 'Shein', 'daraz': 'Daraz', 'faire': 'Faire', 'samsclub': "Sam's Club",
      'alibaba': 'Alibaba'
    };
    // Try exact host or subdomain match first
    for (const [k, v] of Object.entries(map)) {
      if (h === k || h === `${k}.com` || h.endsWith(`.${k}`) || h.endsWith(`.${k}.com`)) return v;
    }
    // Fallback: derive a clean name from the registrable domain
    const parts = h.split('.');
    // For 'product.walmart.com' → 'walmart'; for 'walmart.com' → 'walmart'
    const root = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
    if (root && map[root]) return map[root];
    return root ? root.charAt(0).toUpperCase() + root.slice(1) : 'Other';
  } catch { return 'Other'; }
}

function catClass(cat) {
  const m = {
    'Amazon': 'cc-amazon', 'YouTube': 'cc-youtube', 'GitHub': 'cc-github',
    'Twitter/X': 'cc-twitter', 'Reddit': 'cc-reddit', 'LinkedIn': 'cc-linkedin',
    'Instagram': 'cc-instagram', 'Facebook': 'cc-facebook', 'Temu': 'cc-temu',
    'AliExpress': 'cc-aliexpress', 'eBay': 'cc-ebay', 'Etsy': 'cc-etsy',
    'Shein': 'cc-shein', 'Daraz': 'cc-daraz', 'Faire': 'cc-faire', "Sam's Club": 'cc-sams'
  };
  return m[cat] || 'cc-default';
}

function getFav(url) {
  try {
    return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=64`;
  } catch { return ''; }
}

// ── Ripple Effect ────────────────────────────────────────────
function addRipple(btn) {
  if (btn.classList.contains('hdr-btn')) return;
  btn.addEventListener('click', function (e) {
    if (this.querySelector('.ripple')) return;
    const ripple = document.createElement('span');
    ripple.className = 'ripple';
    const rect = this.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 2;
    ripple.style.cssText = `
      position: absolute;
      pointer-events: none;
      border-radius: 50%;
      width: ${size}px;
      height: ${size}px;
      left: ${e.clientX - rect.left - size / 2}px;
      top: ${e.clientY - rect.top - size / 2}px;
      background: rgba(0, 229, 255, 0.22);
      transform: scale(0);
      animation: zh-ripple-anim 0.5s ease-out;
    `;
    this.appendChild(ripple);
    setTimeout(() => ripple.remove(), 500);
  });
}

function applyRipples() {
  document.querySelectorAll('.btn:not(.hdr-btn), .btn-hunt-main, .btn-ai-magic, .quick-btn')
    .forEach(addRipple);
}

// ── Hunt Progress UI ───────────────────────────────────────
function showProgress(label, pct) {
  const el = $('huntProgress');
  const fill = $('fpFill');
  const lbl = $('fpLabel');
  if (!el) return;
  el.classList.remove('hidden');
  if (fill) fill.style.width = `${Math.min(100, pct)}%`;
  if (lbl) lbl.textContent = label;
}

function hideProgress() {
  $('huntProgress')?.classList.add('hidden');
  const fill = $('fpFill');
  if (fill) fill.style.width = '0%';
}

// ── Video Helpers ────────────────────────────────────────────
function extractYouTubeId(url) {
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    if (h.includes('youtu.be')) return u.pathname.split('/').filter(Boolean)[0] || null;
    if (h.includes('youtube.com')) {
      if (u.searchParams.get('v')) return u.searchParams.get('v');
      const parts = u.pathname.split('/').filter(Boolean);
      for (const key of ['embed', 'shorts', 'live']) {
        const idx = parts.indexOf(key);
        if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
      }
    }
  } catch {}
  return null;
}

function getYouTubeEmbedUrl(videoId) {
  return `https://www.youtube.com/embed/${videoId}`;
}

function getYouTubeWatchUrl(videoId) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function getYouTubeThumbnail(videoId) {
  return `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
}

function detectVideoUrl(scrapedData, pageUrl) {
  // 1. Explicit video URL from scraper
  if (scrapedData.videoUrl) return scrapedData.videoUrl;

  // 2. YouTube detection from page URL — save watch URL, not embed, to avoid Error 153 in exported HTML
  const ytId = extractYouTubeId(pageUrl);
  if (ytId) return getYouTubeWatchUrl(ytId);

  // 3. Check for video elements in scraped data
  if (scrapedData.videos && scrapedData.videos.length > 0) {
    return scrapedData.videos[0];
  }

  return '';
}

// ── Scraper (injected into page) ─────────────────────────────
function scrapePageData() {
  try {
    const data = { title: document.title || '', url: location.href, images: [], videos: [], videoUrl: '', price: '', variants: [] };
    const abs = (u) => { try { return new URL(u, location.href).href; } catch { return u || ''; } };
    const txt = (el) => (el?.innerText || el?.textContent || el?.getAttribute?.('aria-label') || el?.getAttribute?.('content') || '').trim();
    const addUnique = (arr, val) => { val = abs(String(val || '').trim()); if (val && !val.startsWith('data:') && !val.startsWith('blob:') && !arr.includes(val)) arr.push(val); };
    const cleanPrice = (raw) => {
      let s = String(raw || '')
        .replace(/[-−]\s*\d{1,3}\s*%/g, ' ')
        .replace(/\d{1,3}\s*%\s*(off|save)?/gi, ' ')
        .replace(/(was|list price|typical price|original price|save|discount)\s*:?/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const patterns = [
        /(?:US\s*)?[$£€¥₹₩]\s*\d+(?:[.,]\d{3})*(?:[.,]\d{1,2})?/,
        /(?:USD|CAD|AUD|GBP|EUR|PKR|INR)\s*\d+(?:[.,]\d{3})*(?:[.,]\d{1,2})?/i,
        /\d+(?:[.,]\d{3})*(?:[.,]\d{1,2})?\s*(?:USD|CAD|AUD|GBP|EUR|PKR|INR|[$£€¥₹₩])/i,
        /\d+(?:[.,]\d{3})*(?:[.,]\d{1,2})?/
      ];
      for (const p of patterns) { const m = s.match(p); if (m) return m[0].replace(/\s+/g, ' ').trim(); }
      return '';
    };
    const firstPrice = (selectors) => {
      for (const sel of selectors) {
        for (const el of document.querySelectorAll(sel)) {
          const v = cleanPrice(el.getAttribute('content') || el.getAttribute('aria-label') || el.innerText || el.textContent);
          if (v) return v;
        }
      }
      return '';
    };
    // Helper: strip ALL Amazon size tokens (handles chained tokens like ._AC_US40_QL65_.)
    const upscaleAmazonUrl = (src) => {
      let s = src;
      // Replace every size token globally until none remain
      let prev;
      do { prev = s; s = s.replace(/\._[A-Z0-9_,]{2,}_\./, '._AC_SL1500_.'); } while (s !== prev);
      return s;
    };

    const addImgs = (selector, limit = 14) => document.querySelectorAll(selector).forEach(i => {
      // Prioritise hi-res data attributes before falling back to img.src (which may be a small thumbnail)
      let src = i.getAttribute('data-old-hires') || i.getAttribute('data-zoom-image') ||
                i.getAttribute('data-large-image') || i.getAttribute('data-src') ||
                i.getAttribute('data-image') || i.getAttribute('src') || i.src || '';
      if (!src && i.getAttribute('srcset')) src = i.getAttribute('srcset').split(',').pop().trim().split(/\s+/)[0];
      // Try data-a-dynamic-image (Amazon: JSON map of url→[width,height], pick largest)
      const dynRaw = i.getAttribute('data-a-dynamic-image');
      if (dynRaw && dynRaw.startsWith('{')) {
        try {
          const entries = Object.entries(JSON.parse(dynRaw));
          entries.sort((a, b) => (b[1]?.[0] || 0) - (a[1]?.[0] || 0));
          if (entries[0]?.[0]) src = entries[0][0];
        } catch (_) {}
      }
      src = upscaleAmazonUrl(abs(src));
      if (src && !/sprite|pixel|blank|placeholder|\.svg|logo|favicon|banner|\bicon\b/i.test(src)) addUnique(data.images, src);
      if (data.images.length >= limit) return;
    });
    const addVideos = () => {
      document.querySelectorAll('video, video source').forEach(v => addUnique(data.videos, v.currentSrc || v.src || v.getAttribute('src')));
      document.querySelectorAll('meta[property="og:video"],meta[property="og:video:url"],meta[name="twitter:player"]').forEach(m => addUnique(data.videos, m.content));
      document.querySelectorAll('iframe[src*="youtube.com"],iframe[src*="vimeo.com"]').forEach(f => addUnique(data.videos, f.src));
    };
    const ytIdFromUrl = (url) => { try { const u = new URL(url); const parts = u.pathname.split('/').filter(Boolean); if (u.hostname.includes('youtu.be')) return parts[0]; if (u.searchParams.get('v')) return u.searchParams.get('v'); for (const k of ['embed','shorts','live']) { const idx = parts.indexOf(k); if (idx >= 0 && parts[idx+1]) return parts[idx+1]; } return null; } catch { return null; } };

    document.querySelectorAll('meta[property="og:image"], meta[name="twitter:image"]').forEach(m => {
      if (m.content && !/logo|favicon|icon|banner|sprite|placeholder/i.test(m.content)) addUnique(data.images, m.content);
    });
    addVideos();

    document.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
      try {
        const json = JSON.parse(s.textContent || '{}');
        const stack = Array.isArray(json) ? [...json] : [json];
        while (stack.length) {
          const item = stack.shift(); if (!item || typeof item !== 'object') continue;
          if (item.name && !data.title) data.title = String(item.name).trim();
          if (item.image) (Array.isArray(item.image) ? item.image : [item.image]).forEach(x => addUnique(data.images, typeof x === 'string' ? x : x.url));
          const offer = Array.isArray(item.offers) ? item.offers[0] : item.offers;
          if (offer && !data.price) data.price = cleanPrice(`${offer.priceCurrency || ''} ${offer.price || offer.lowPrice || ''}`);
          const video = Array.isArray(item.video) ? item.video : (item.video ? [item.video] : []);
          video.forEach(v => addUnique(data.videos, v.contentUrl || v.embedUrl || v.url || v.thumbnailUrl));
          Object.values(item).forEach(v => { if (v && typeof v === 'object') Array.isArray(v) ? stack.push(...v) : stack.push(v); });
        }
      } catch {}
    });

    const h = location.hostname.toLowerCase();
    const ytId = ytIdFromUrl(location.href);
    if (ytId) {
      data.videoUrl = `https://www.youtube.com/watch?v=${ytId}`;
      addUnique(data.images, `https://img.youtube.com/vi/${ytId}/maxresdefault.jpg`);
      data.title = txt(document.querySelector('h1.ytd-watch-metadata, h1.title')) || data.title || document.title;
    }

    if (h.includes('amazon.')) {
      data.title = txt(document.querySelector('#productTitle, #title span, h1')) || data.title;
      data.price = data.price || firstPrice(['#corePrice_feature_div .a-price:not(.a-text-price) .a-offscreen','.priceToPay .a-offscreen','.apexPriceToPay .a-offscreen','#apex_offerDisplay_desktop .a-price .a-offscreen','#priceblock_ourprice','#priceblock_dealprice','input[name="priceValue"]']);

      // ── AMAZON IMAGE FIX (bulk hunt) ──────────────────────────────────────
      // Root cause of duplicates:
      //   og:image and JSON-LD images are collected ABOVE (lines 323-343) before
      //   the Amazon-specific block runs. They are small/medium-size URLs.
      //   colorImages JSON then adds the SAME images but upscaled — different URL
      //   strings, so addUnique() exact-match dedup doesn't catch them.
      //
      // Fix: reset data.images for Amazon pages (colorImages JSON is always
      // superior in quality and completeness). Use a canonical-key Set so the
      // same base image is never added twice regardless of size token.

      data.images = []; // discard og:image / JSON-LD images — colorImages is better

      const amazonSeenKeys = new Set();
      const addAmazonImg = (rawUrl) => {
        if (!rawUrl || typeof rawUrl !== 'string' || !rawUrl.startsWith('http')) return;
        const norm = upscaleAmazonUrl(abs(rawUrl));
        // Canonical key: hostname + path with ALL size tokens stripped
        let key = norm;
        try { key = new URL(norm).hostname + new URL(norm).pathname.replace(/\._[A-Z0-9_,]+_\./gi, '.').toLowerCase(); } catch (_) {}
        if (amazonSeenKeys.has(key)) return;
        amazonSeenKeys.add(key);
        if (!data.images.includes(norm)) data.images.push(norm);
      };

      // Strategy 1: colorImages JSON from inline scripts — ONLY "initial" variant
      // Raw regex over entire script collects hiRes/large from ALL color variants.
      // Fix: parse colorImages JSON and read only the "initial" (active) variant.
      document.querySelectorAll('script:not([src])').forEach(s => {
        const t = s.textContent || '';
        if (!t.includes('colorImages') && !t.includes('hiRes') && !t.includes('ImageBlockATF')) return;

        // Try JSON parse first — extract only colorImages.initial
        const ciMatch = t.match(/['"]?colorImages['"]?\s*:\s*(\{[^;]{20,}?\}\s*[,;])/s)
                     || t.match(/P\.colorImages\s*=\s*(\{[^;]{20,}?\}\s*;)/s);
        if (ciMatch) {
          try {
            const ci = JSON.parse(ciMatch[1].trimEnd().replace(/[,;]$/, ''));
            const initial = Array.isArray(ci.initial) ? ci.initial : [];
            initial.forEach(entry => {
              if (typeof entry !== 'object' || !entry) return;
              const url = entry.hiRes || entry.large || '';
              if (url && typeof url === 'string' && url.startsWith('http')) addAmazonImg(url);
            });
            if (data.images.length > 0) return;
          } catch (_) {}
        }

        // Regex fallback scoped to "initial" block only
        const initM = t.match(/"initial"\s*:\s*(\[\s*\{[\s\S]*?\}\s*\])/);
        const scope = initM ? initM[1] : t;
        (scope.match(/"hiRes"\s*:\s*"(https?:[^"]+)"/g) || []).forEach(m => {
          const u = (m.match(/"hiRes"\s*:\s*"(https?:[^"]+)"/) || [])[1];
          if (u) addAmazonImg(u);
        });
        (scope.match(/"large"\s*:\s*"(https?:[^"]+)"/g) || []).forEach(m => {
          const u = (m.match(/"large"\s*:\s*"(https?:[^"]+)"/) || [])[1];
          if (u) addAmazonImg(u);
        });
      });

      // Strategy 2: DOM scan — only when colorImages JSON found nothing
      if (data.images.length === 0) {
        addImgs('#landingImage, #imgBlkFront, #altImages img, #imageBlock img, img[data-old-hires]');
      }
      // ── END AMAZON IMAGE FIX ─────────────────────────────────────────────

      document.querySelectorAll('#twister [class*="swatch"], #variation_color_name li, #variation_size_name li').forEach(v => { const val = txt(v); if (val && !data.variants.includes(val)) data.variants.push(val); });
    } else if (h.includes('walmart.')) {
      data.title = txt(document.querySelector('h1[itemprop="name"], [data-automation-id="product-title"], h1')) || data.title;
      data.price = data.price || firstPrice(['[itemprop="price"]','[data-testid="price-wrap"] [itemprop="price"]','[data-automation-id="product-price"]','span[aria-label*="$"]','div[aria-label*="current price"]','[class*="price"]']);
      // Walmart CDN upscaler: strip ?odnWidth= and similar size-capping params
      const wmUp = (src) => src ? src.split('?')[0] : src;
      // Strategy 1: __NEXT_DATA__ JSON — targeted paths + canonical dedup (prevents recommendation images)
      const wmNextEl = document.getElementById('__NEXT_DATA__');
      if (wmNextEl) {
        try {
          const wmNd = JSON.parse(wmNextEl.textContent || '{}');
          const wmSeen = new Set();
          const addWmImg2 = (raw) => { if (!raw) return; const c = wmUp(raw); const k = c.replace(/^https?:\/\//, '').split('?')[0].toLowerCase(); if (!wmSeen.has(k)) { wmSeen.add(k); addUnique(data.images, c); } };
          const extractWm = (info) => {
            if (!info || !Array.isArray(info.allImages)) return false;
            info.allImages.forEach(img => {
              let url = img.url || '';
              if (Array.isArray(img.assetSizeList) && img.assetSizeList.length) { const last = img.assetSizeList[img.assetSizeList.length - 1]; if (last?.url) url = last.url; }
              addWmImg2(url);
            });
            return info.allImages.length > 0;
          };
          const wmRoot = wmNd?.props?.pageProps?.initialData?.data?.product || wmNd?.pageProps?.initialData?.data?.product || wmNd?.initialData?.data?.product;
          if (wmRoot) { extractWm(wmRoot.imageInfo); if (data.images.length === 0) extractWm(wmRoot.primaryOffer?.imageInfo); }
          if (data.images.length === 0) {
            const dfsWm = (o, d) => { if (!o || typeof o !== 'object' || d > 6) return false; if (o.imageInfo && Array.isArray(o.imageInfo.allImages)) return extractWm(o.imageInfo); for (const v of Object.values(o)) { if (v && typeof v === 'object' && dfsWm(v, d + 1)) return true; } return false; };
            dfsWm(wmNd, 0);
          }
        } catch (_) {}
      }

      // Strategy 2: DOM fallback
      if (data.images.length === 0) {
        addImgs('[data-testid="media-thumbnail"] img, [data-automation-id="hero-image"] img, [data-testid="product-image"] img, picture img, img[src*="i5.walmartimages.com"]');
      }
      document.querySelectorAll('[data-testid*="variant"], [data-automation-id*="variant"], button[aria-label*="Size"], button[aria-label*="Color"]').forEach(v => { const val = txt(v); if (val && val.length < 80 && !data.variants.includes(val)) data.variants.push(val); });
    } else if (h.includes('samsclub.com')) {
      data.title = txt(document.querySelector('h1[data-testid="product-title"], h1.sc-product-title, h1')) || data.title;
      data.price = data.price || firstPrice(['[data-testid="price"]','[itemprop="price"]','.Price-characteristic','span[aria-label*="$"]','[class*="Price"]','[class*="price"]']);
      // Sam's Club scene7 CDN upscaler: strip $SC_Item_Medium_Image$ qualifiers and ?wid= params
      const scUp = (src) => {
        if (!src) return src;
        if (/scene7\.samsclub\.com/i.test(src)) return src.split('?')[0].replace(/\$SC_Item[^$]*\$/, '').replace(/\$[^$]+\$/, '');
        return src.split('?')[0];
      };
      // Strategy 1: __NEXT_DATA__ JSON — zoomImage is highest resolution
      const scNextEl = document.getElementById('__NEXT_DATA__');
      if (scNextEl) {
        try {
          const scNd = JSON.parse(scNextEl.textContent || '{}');
          const scSeen2 = new Set();
          const addScImg2 = (raw) => { if (!raw) return; const c = scUp(raw); const k = c.replace(/^https?:\/\//, '').split('?')[0].toLowerCase(); if (!scSeen2.has(k)) { scSeen2.add(k); addUnique(data.images, c); } };
          const extractSc = (assets) => { if (!Array.isArray(assets) || !assets.length || (!assets[0].largeImage && !assets[0].zoomImage)) return false; assets.forEach(a => addScImg2(a.zoomImage || a.largeImage || '')); return true; };
          const scRoot = scNd?.props?.pageProps?.initialData?.data?.product || scNd?.pageProps?.initialData?.data?.product;
          if (scRoot) { extractSc(scRoot.assets); if (data.images.length === 0) extractSc(scRoot.imageAssets || scRoot.images); }
          if (data.images.length === 0) {
            const dfsSc = (o, d) => { if (!o || typeof o !== 'object' || d > 6) return false; if (extractSc(o.assets)) return true; for (const v of Object.values(o)) { if (v && typeof v === 'object' && dfsSc(v, d + 1)) return true; } return false; };
            dfsSc(scNd, 0);
          }
        } catch (_) {}
      }
      // Strategy 2: DOM fallback
      if (data.images.length === 0) {
        document.querySelectorAll('[data-testid="product-image"] img, .sc-product-image img, picture img, img[src*="scene7.samsclub.com"]').forEach(img => {
          const src = img.getAttribute('data-old-hires') || img.getAttribute('data-zoom-image') || img.getAttribute('data-src') || img.src || '';
          if (src && !/logo|icon|badge/i.test(src)) addUnique(data.images, scUp(src));
        });
      }
      document.querySelectorAll('[data-testid*="variant"], button[aria-label*="Size"], button[aria-label*="Color"]').forEach(v => { const val = txt(v); if (val && val.length < 80 && !data.variants.includes(val)) data.variants.push(val); });
    } else if (h.includes('faire.com')) {
      data.title = txt(document.querySelector('h1, [data-testid*="product-title"], [class*="ProductTitle"]')) || data.title;
      data.price = data.price || firstPrice(['[data-testid*="price"]','[class*="Price"]','[class*="price"]','span[aria-label*="$"]']);
      addImgs('picture img, [data-testid*="image"] img, [class*="carousel"] img, [class*="gallery"] img, [class*="Product"] img');
      document.querySelectorAll('[class*="variant"], [data-testid*="variant"], button[aria-label]').forEach(v => { const val = txt(v); if (val && val.length < 80 && !data.variants.includes(val)) data.variants.push(val); });
    } else if (h.includes('aliexpress.')) {
      data.title = txt(document.querySelector('[data-pl="product-title"], h1')) || data.title;
      data.price = data.price || firstPrice(['.product-price-current','.price-current','[class*="price"]']);
      addImgs('.slider--item img, .images--item img, .product-img, picture img');
    } else if (h.includes('alibaba.')) {
      data.title = txt(document.querySelector('h1, [class*="product-title"], [data-testid*="title"]')) || data.title;
      data.price = data.price || firstPrice(['[class*="price"]','[data-testid*="price"]','span[aria-label*="$"]']);
      addImgs('[class*="main-image"] img, [class*="gallery"] img, [class*="thumb"] img, picture img');
    }

    if (!data.price) data.price = firstPrice(['meta[property="product:price:amount"]','meta[itemprop="price"]','[itemprop="price"]','[aria-label*="$"]']);
    if (data.images.length < 2) {
      // Generic fallback: only grab large images (product images are typically big)
      document.querySelectorAll('img').forEach(i => {
        if (data.images.length >= 12) return;
        const w = i.naturalWidth || parseInt(i.getAttribute('width') || '0');
        const h2 = i.naturalHeight || parseInt(i.getAttribute('height') || '0');
        if ((w && w < 200) || (h2 && h2 < 200)) return; // skip tiny images
        let src = i.getAttribute('data-old-hires') || i.getAttribute('data-zoom-image') ||
                  i.getAttribute('data-src') || i.getAttribute('src') || i.src || '';
        if (!src) return;
        src = upscaleAmazonUrl(abs(src));
        if (/sprite|pixel|blank|placeholder|\.svg|logo|favicon|banner|icon/i.test(src)) return;
        if (!src.startsWith('data:') && !src.startsWith('blob:')) addUnique(data.images, src);
      });
    }
    if (!data.videoUrl && data.videos.length) data.videoUrl = data.videos[0];
    data.images = [...new Set(data.images)].slice(0, 12);
    data.videos = [...new Set(data.videos)].slice(0, 8);
    data.variants = [...new Set(data.variants)].slice(0, 12);
    return data;
  } catch (e) {
    return { title: document.title || '', url: location.href, images: [], videos: [], videoUrl: '', price: '', variants: [] };
  }
}

// ── Data Loading ─────────────────────────────────────────────
async function loadData() {
  try {
    const d = await msg({ action: 'GET_DATA' });
    State.data = {
      links:    Array.isArray(d?.links)   ? d.links   : [],
      folders:  Array.isArray(d?.folders) ? d.folders : ['General'],
      tags:     Array.isArray(d?.tags)    ? d.tags    : [],
      settings: d?.settings || {}
    };
    const ui = await chrome.storage.local.get(UI_KEY);
    if (ui?.[UI_KEY]) {
      const s = ui[UI_KEY];
      if (['list', 'grid'].includes(s.viewMode)) State.view = s.viewMode;
      State.inputMode = 'manual';
      if (['dark', 'light'].includes(s.theme)) State.theme = s.theme;
    }
  } catch (_) {
    State.data = { links: [], folders: ['General'], tags: [], settings: {} };
  }
}

async function saveUIState() {
  try {
    const current = await chrome.storage.local.get(UI_KEY);
    await chrome.storage.local.set({
      [UI_KEY]: {
        ...(current?.[UI_KEY] || {}),
        viewMode: State.view,
        inputMode: State.inputMode,
        theme: State.theme
      }
    });
  } catch (_) {}
}

async function refresh() {
  await loadData();
  renderAll();
}

// ── Theme ────────────────────────────────────────────────────
function initTheme() {
  applyTheme(State.theme);

  const btn = $('themeToggleBtn');
  if (btn) {
    btn.addEventListener('click', async () => {
      State.theme = State.theme === 'dark' ? 'light' : 'dark';
      applyTheme(State.theme);
      await saveUIState();
      toast(`${State.theme === 'light' ? '☀️ Light' : '🌙 Dark'} mode activated`, 'info');
    });
  }

  // Keep the popup in sync when the Settings page changes Day/Night mode.
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes[UI_KEY]) return;
    const nextTheme = changes[UI_KEY].newValue?.theme;
    if (!['dark', 'light'].includes(nextTheme) || nextTheme === State.theme) return;
    State.theme = nextTheme;
    applyTheme(State.theme);
  });
}

function applyTheme(theme = State.theme) {
  State.theme = theme === 'light' ? 'light' : 'dark';
  const isLight = State.theme === 'light';

  // Apply to both roots so every selector path updates immediately.
  document.documentElement.classList.toggle('light-mode', isLight);
  document.documentElement.dataset.theme = State.theme;
  document.body?.classList.toggle('light-mode', isLight);
  document.body?.setAttribute('data-theme', State.theme);

  const btn = $('themeToggleBtn');
  if (!btn) return;
  btn.classList.toggle('theme-light-active', isLight);
  btn.title = isLight ? 'Switch to Dark Mode' : 'Switch to Light Mode';
  btn.setAttribute('aria-label', btn.title);
}

// ── Tab System ───────────────────────────────────────────────
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      $(`tab-${id}`)?.classList.add('active');
      if (id === 'links')   renderLinksTab();
      if (id === 'folders') renderFolderAccordion();
      if (id === 'export')  updateExportStats();
      if (id === 'images')  scanPageImages();
      if (id === 'videos' && typeof VidTabState !== 'undefined' && !VidTabState.videos.length && !VidTabState.isScanning) {
        setTimeout(() => scanVideos(), 120);
      }
    });
  });
}

// ── Render All ───────────────────────────────────────────────
function renderAll() {
  updateHeaderCount();
  updateStatsDashboard();
  renderLinksTab();
  renderFolderAccordion();
  renderTagsManage();
  renderTagsPicker('tagsSelector', State.selectedTags);
  syncFolderSelect('folderSelect');
  if (typeof syncBulkFolderSelect === 'function') syncBulkFolderSelect();
  syncFilterDropdowns();
  updateExportStats();
  syncViewButtons();
}

function updateHeaderCount() {
  const el = $('totalCount');
  if (!el) return;
  // Header pill = products in the Library (master sheet), not the legacy links store.
  getMasterRows().then(rows => { el.textContent = String(rows.length); }).catch(() => {});
}

function updateStatsDashboard() {
  if (!$('dashTotalProducts')) return;
  $('dashTotalProducts').textContent = State.data.links.length;
  $('dashTotalFolders').textContent = State.data.folders.length;
  $('dashTotalTags').textContent = State.data.tags.length;
  
  if (chrome.storage && chrome.storage.local && chrome.storage.local.getBytesInUse) {
    chrome.storage.local.getBytesInUse(null, bytes => {
      let size = bytes || 0;
      let unit = 'B';
      if (size > 1024 * 1024) {
        size = (size / (1024 * 1024)).toFixed(1);
        unit = 'MB';
      } else if (size > 1024) {
        size = (size / 1024).toFixed(1);
        unit = 'KB';
      }
      const sizeEl = $('dashStorageUsed');
      if (sizeEl) sizeEl.textContent = `${size} ${unit}`;
    });
  }
}

function syncViewButtons() {
  $('viewList')?.classList.toggle('active', State.view === 'list');
  $('viewGrid')?.classList.toggle('active', State.view === 'grid');
  $('viewList')?.setAttribute('aria-pressed', State.view === 'list' ? 'true' : 'false');
  $('viewGrid')?.setAttribute('aria-pressed', State.view === 'grid' ? 'true' : 'false');
}

// ── Collect Tab ──────────────────────────────────────────────
function initCollectTab() {
  const modeSelect = $('inputMode');
  const urlInput   = $('urlInput');
  const titleInput = $('titleInput');

  // Mode
  if (modeSelect) {
    modeSelect.value = State.inputMode;
    modeSelect.addEventListener('change', () => {
      State.inputMode = modeSelect.value;
      saveUIState();
      if (State.inputMode === 'auto') {
        huntCurrentTab();
        toast('Auto-hunting active tab', 'info');
      } else {
        if (urlInput) urlInput.value = '';
        if (titleInput) titleInput.value = '';
        updateCatDisplay('');
        urlInput?.focus();
        toast('Manual mode ready', 'info');
      }
    });
  }

  // ── Supported e-commerce domains for auto-scrape ────────────
  const AUTO_SCRAPE_HOSTS = [
    'amazon.', 'walmart.', 'samsclub.com', 'temu.', 'ebay.',
    'etsy.com', 'aliexpress.', 'alibaba.com', 'faire.com',
    'shein.com', 'daraz.', 'flipkart.com', 'noon.com',
    'worldwidegolfballs.com', 'worldwidegolfshops.com',
    'worldgolfshop.com', 'golf.com', 'rockbottomgolf.com'
  ];

  function isSupportedEcomPage(url) {
    try {
      const h = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
      return AUTO_SCRAPE_HOSTS.some(p => h.includes(p));
    } catch { return false; }
  }

  // Track last auto-hunted URL to avoid re-scraping same page
  let _lastAutoHuntUrl = '';

  function huntCurrentTab() {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      const tab = tabs?.[0];
      if (tab?.url && isValidURL(tab.url) && !tab.url.startsWith('chrome://')) {
        if (urlInput) urlInput.value = tab.url;
        if (titleInput) titleInput.value = tab.title || '';
        updateCatDisplay(tab.url);
      }
    });
  }

  // ── Auto-scrape: fires when panel opens on a supported page ──
  async function autoScrapeCurrentTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.url || !isValidURL(tab.url) || tab.url.startsWith('chrome://')) return;
      if (!isSupportedEcomPage(tab.url)) return;          // not a supported store
      if (_lastAutoHuntUrl === tab.url) return;           // already scraped this URL

      // Fill URL/title immediately
      if (urlInput)   urlInput.value   = tab.url;
      if (titleInput) titleInput.value = tab.title || '';
      updateCatDisplay(tab.url);

      // Show subtle progress so user knows it's working
      showProgress('Auto-scanning product…', 30);

      const scraped = await new Promise(resolve => {
        let done = false;
        const finish = v => { if (!done) { done = true; resolve(v); } };
        const t = setTimeout(() => finish(null), 8000);
        chrome.tabs.sendMessage(tab.id, { action: 'SCRAPE_PAGE' }, res => {
          clearTimeout(t);
          if (chrome.runtime.lastError || !res?.success || !res?.data) finish(null);
          else finish(res.data);
        });
      });

      hideProgress();

      if (!scraped) return; // silent fail — user can still click Hunt manually

      _lastAutoHuntUrl = tab.url; // mark as done
      openHuntPreviewModal(scraped, tab);
      toast('Product auto-scanned! Review and save 🛍️', 'ok');

    } catch (_) {
      hideProgress();
    }
  }

  if (State.inputMode === 'auto') {
    huntCurrentTab();
    // Slight delay so DOM is ready before modal opens
    setTimeout(() => autoScrapeCurrentTab(), 500);
  }

  // URL input → category
  urlInput?.addEventListener('input', debounce(() => {
    updateCatDisplay(urlInput.value.trim());
  }, 280));

  // Copy URL
  $('copyBtn')?.addEventListener('click', async () => {
    const val = urlInput?.value.trim();
    if (!val) { toast('Nothing to copy', 'warn'); return; }
    try {
      await navigator.clipboard.writeText(val);
      toast('URL copied!', 'ok');
    } catch { toast('Failed to copy', 'err'); }
  });

  // Char counter for notes
  $('notesInput')?.addEventListener('input', () => {
    const len = $('notesInput').value.length;
    const el = $('charCount');
    if (el) el.textContent = len;
  });

  // ── Hunt Product (opens preview modal — user reviews, then saves) ──
  $('autoHuntBtn')?.addEventListener('click', async () => {
    const btn = $('autoHuntBtn');
    const textEl = btn.querySelector('.hunt-title') || btn.querySelector('.hunt-text');
    const origText = textEl?.textContent;
    if (textEl) textEl.textContent = 'Scraping page…';
    btn.disabled = true;
    btn.classList.add('loading');
    showProgress('Connecting to page…', 15);

    const releaseBtn = () => {
      btn.disabled = false;
      btn.classList.remove('loading');
      if (textEl) textEl.textContent = origText || 'Hunt Product';
    };

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error('no_tab');

      showProgress('Scraping product data…', 50);

      const scraped = await new Promise((resolve) => {
        let done = false;
        const finish = (v) => { if (!done) { done = true; resolve(v); } };
        const t = setTimeout(() => finish(null), 8000);
        chrome.tabs.sendMessage(tab.id, { action: 'SCRAPE_PAGE' }, (results) => {
          clearTimeout(t);
          if (chrome.runtime.lastError || !results?.success || !results?.data) finish(null);
          else finish(results.data);
        });
      });

      if (!scraped) {
        toast('Cannot hunt this page. Refresh once and try again.', 'warn');
        hideProgress();
        releaseBtn();
        return;
      }

      hideProgress();
      releaseBtn();

      // Open the preview modal pre-populated with scraped data
      openHuntPreviewModal(scraped, tab);

    } catch (e) {
      hideProgress();
      releaseBtn();
      toast('Hunt failed — try manual mode', 'err');
    }
  });

  // ── Image Management (Collect) ───────────────────────────────
  $('addImageUrlBtn')?.addEventListener('click', () => {
    State.imageUrlTarget = 'collect';
    openImageUrlModal();
  });

  $('clearImagesBtn')?.addEventListener('click', () => {
    if (!State.collectImages.length) return;
    showConfirm('Clear Images', 'Remove all product images?', 'Clear', () => {
      State.collectImages = [];
      renderCollectImages();
      toast('Images cleared', 'info');
    });
  });

  // ── Video Management ─────────────────────────────────────────
  $('clearVideoBtn')?.addEventListener('click', () => {
    State.collectVideoUrl = '';
    renderVideoPreview();
    toast('Video removed', 'info');
  });

  // ── Save Link ───────────────────────────────────────────────
  $('addLinkBtn')?.addEventListener('click', handleAddLink);
  urlInput?.addEventListener('keydown', e => {
    if (e.key === 'Enter') handleAddLink();
  });

  // ── Save All Tabs ───────────────────────────────────────────
  $('saveAllTabsBtn')?.addEventListener('click', async () => {
    const folder = $('folderSelect')?.value || 'General';
    showFeedback('Saving all open tabs…', 'info');
    try {
      const res = await msg({ action: 'SAVE_ALL_TABS', folder, tags: [...State.selectedTags] });
      if (res?.success) {
        const saved = res.results?.filter(r => r.success).length || 0;
        await refresh();
        showFeedback(`✓ ${saved} tabs saved to "${folder}"`, 'ok');
        toast(`Saved ${saved} tabs`, 'ok');
      }
    } catch { showFeedback('Failed to save tabs', 'err'); }
  });

  // ── Copy All Tab URLs ───────────────────────────────────────
  $('copyAllTabsBtn')?.addEventListener('click', async () => {
    try {
      const res = await msg({ action: 'COPY_ALL_TABS' });
      if (res?.success && res.urls?.length) {
        await navigator.clipboard.writeText(res.urls.join('\n'));
        toast(`${res.urls.length} URLs copied!`, 'ok');
      } else {
        toast('No valid URLs found', 'warn');
      }
    } catch { toast('Failed to copy URLs', 'err'); }
  });

  // ── Open Clipboard Links ────────────────────────────────────
  $('openClipboardLinksBtn')?.addEventListener('click', async () => {
    try {
      // FIXED: Check clipboard permission before reading
      let permState = 'prompt';
      try {
        const perm = await navigator.permissions.query({ name: 'clipboard-read' });
        permState = perm.state;
      } catch (e) {
        // Some browsers don't support querying clipboard-read
      }
      if (permState === 'denied') {
        toast('Clipboard permission denied. Please allow clipboard access.', 'err');
        return;
      }

      const text = await navigator.clipboard.readText();
      if (!text?.trim()) { toast('Clipboard is empty', 'warn'); return; }
      const lines = text.split('\n').map(l => l.trim()).filter(l => isValidURL(l));
      if (!lines.length) { toast('No valid URLs in clipboard', 'warn'); return; }
      showConfirm(
        'Open Clipboard Links',
        `Open ${lines.length} URL(s) in new tabs?`,
        'Open All',
        () => {
          lines.forEach(url => chrome.tabs.create({ url, active: false }));
          toast(`Opened ${lines.length} tabs`, 'ok');
        }
      );
    } catch { toast('Cannot read clipboard', 'err'); }
  });

  // Apply ripples to all action buttons
  applyRipples();
}

// ── Video Preview Renderer ───────────────────────────────────
function renderVideoPreview() {
  const preview = $('videoPreview');
  const empty = $('videoEmpty');
  const thumb = $('videoThumb');
  const title = $('videoTitle');

  if (!preview || !empty) return;

  if (!State.collectVideoUrl) {
    preview.classList.add('hidden');
    empty.style.display = 'flex';
    if (thumb) thumb.src = '';
    return;
  }

  empty.style.display = 'none';
  preview.classList.remove('hidden');

  // Determine thumbnail
  const ytId = extractYouTubeId(State.collectVideoUrl);
  if (ytId && thumb) {
    thumb.src = getYouTubeThumbnail(ytId);
    if (title) title.textContent = 'YouTube Video';
  } else {
    if (thumb) thumb.src = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><rect width="640" height="360" fill="#050816"/><circle cx="320" cy="180" r="58" fill="#06b6d4" opacity=".92"/><path d="M300 145v70l62-35z" fill="white"/></svg>');
    if (title) title.textContent = 'Product Video';
  }
}

// ── Collect Images Renderer ──────────────────────────────────
function renderCollectImages() {
  const grid = $('imagesGrid');
  const emptyState = $('imgEmptyState');
  if (!grid) return;

  Array.from(grid.children).forEach(c => {
    if (c !== emptyState) c.remove();
  });

  if (!State.collectImages.length) {
    if (emptyState) emptyState.style.display = 'flex';
    return;
  }
  if (emptyState) emptyState.style.display = 'none';

  State.collectImages.forEach((imgSrc, idx) => {
    const thumb = buildImageThumb(imgSrc, idx, (i) => {
      State.collectImages.splice(i, 1);
      renderCollectImages();
    });
    grid.appendChild(thumb);
  });
}

function buildImageThumb(imgSrc, idx, onRemove) {
  const wrap = document.createElement('div');
  wrap.className = 'img-thumb-wrap';
  if (idx === 0) wrap.classList.add('img-thumb-primary');

  const img = document.createElement('img');
  img.className = 'img-thumb';
  img.loading = 'lazy';
  img.alt = `Product image ${idx + 1}`;
  if (typeof imgSrc === 'string' && (imgSrc.startsWith('data:image') || imgSrc.startsWith('https'))) {
    img.src = imgSrc;
  }

  const removeBtn = document.createElement('button');
  removeBtn.className = 'img-thumb-remove';
  removeBtn.type = 'button';
  removeBtn.setAttribute('aria-label', `Remove image ${idx + 1}`);
  removeBtn.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  removeBtn.addEventListener('click', e => {
    e.stopPropagation();
    onRemove(idx);
  });

  if (idx === 0) {
    const badge = document.createElement('span');
    badge.className = 'img-primary-badge';
    badge.textContent = 'Main';
    wrap.appendChild(badge);
  }

  wrap.appendChild(img);
  wrap.appendChild(removeBtn);
  return wrap;
}

// ── Image URL Modal ──────────────────────────────────────────
function openImageUrlModal() {
  const input = $('imageUrlInput');
  if (input) input.value = '';
  $('imageUrlModal')?.classList.remove('hidden');
  setTimeout(() => input?.focus(), 100);
}

function initImageUrlModal() {
  $('closeImageUrlModal')?.addEventListener('click', () => {
    $('imageUrlModal')?.classList.add('hidden');
  });
  $('cancelImageUrl')?.addEventListener('click', () => {
    $('imageUrlModal')?.classList.add('hidden');
  });
  $('confirmImageUrl')?.addEventListener('click', async () => {
    const url = $('imageUrlInput')?.value.trim();
    if (!url || !isValidURL(url)) { toast('Enter a valid image URL', 'warn'); return; }

    const btn = $('confirmImageUrl');
    btn.disabled = true;
    btn.textContent = 'Hunting…';

    const res = await msg({ action: 'FETCH_BASE64', url });
    btn.disabled = false;
    btn.textContent = 'Add Image';
    $('imageUrlModal')?.classList.add('hidden');

    if (res?.success && res.base64) {
      if (State.imageUrlTarget === 'collect') {
        if (State.collectImages.length >= 10) {
          toast('Maximum 10 images allowed', 'warn');
          return;
        }
        State.collectImages.push(res.base64);
        renderCollectImages();
        toast('Image added!', 'ok');
      } else if (State.imageUrlTarget === 'edit') {
        if (State.editImages.length >= 10) {
          toast('Maximum 10 images allowed', 'warn');
          return;
        }
        State.editImages.push(res.base64);
        renderEditImages();
        toast('Image added!', 'ok');
      }
    } else {
      toast('Could not load image — check URL', 'err');
    }
  });

  $('imageUrlInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') $('confirmImageUrl')?.click();
  });
}

// ── Category Display ─────────────────────────────────────────
function updateCatDisplay(url) {
  const el = $('detectedCategory');
  if (!el) return;
  if (url && isValidURL(url)) {
    const cat = detectCat(url);
    el.textContent = cat;
    el.className = `cat-badge ${catClass(cat)}`;
  } else {
    el.textContent = 'Auto';
    el.className = 'cat-badge';
  }
}

// ── Feedback ─────────────────────────────────────────────────
function showFeedback(text, type) {
  const el = $('feedback');
  if (!el) return;
  el.textContent = text;
  el.className = `feedback-box visible ${type}`;
  if (type !== 'err') {
    setTimeout(() => { el.className = 'feedback-box'; }, 3500);
  }
}

// ── Handle Add Link ──────────────────────────────────────────
async function handleAddLink() {
  const url    = $('urlInput')?.value.trim();
  const title  = $('titleInput')?.value.trim();
  const notes  = $('notesInput')?.value.trim();
  const price  = $('priceInput')?.value.trim();
  const folder = $('folderSelect')?.value || 'General';

  if (!url) { showFeedback('Please enter a URL', 'err'); return; }
  if (!isValidURL(url)) { showFeedback('Invalid URL — must be http/https', 'err'); return; }

  const btn = $('addLinkBtn');
  btn.disabled = true;
  btn.classList.add('loading');

  try {
    const res = await msg({
      action: 'ADD_LINK',
      url, title, folder, notes,
      tags: [...State.selectedTags],
      images: [...State.collectImages],
      videoUrl: State.collectVideoUrl || '',
      videos: State.collectVideos || [],
      price: price || ''
    });

    if (res?.success) {
      // Reset form completely
      ['urlInput', 'titleInput', 'notesInput', 'priceInput'].forEach(id => {
        const el = $(id);
        if (el) el.value = '';
      });
      State.selectedTags = [];
      State.collectImages = [];
      State.collectVideoUrl = '';
      State.collectVideos = [];
      updateCatDisplay('');
      renderTagsPicker('tagsSelector', State.selectedTags);
      renderCollectImages();
      renderVideoPreview(); // FIXED: clear video preview
      const charEl = $('charCount');
      if (charEl) charEl.textContent = '0';

      await refresh();
      showFeedback(`✓ Product saved to "${folder}"`, 'ok');
      toast('Product saved! 🛍️', 'ok');
      State.openFolders.add(folder);

      // Re-hunt current tab in auto mode
      if (State.inputMode === 'auto') {
        chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
          const tab = tabs?.[0];
          if (tab?.url && isValidURL(tab.url)) {
            const uEl = $('urlInput');
            const tEl = $('titleInput');
            if (uEl) uEl.value = tab.url;
            if (tEl) tEl.value = tab.title || '';
            updateCatDisplay(tab.url);
          }
        });
      }
    } else if (res?.reason === 'duplicate') {
      showFeedback('This link is already saved', 'err');
      toast('Duplicate product', 'warn');
    } else {
      showFeedback('Error saving — try again', 'err');
    }
  } catch (e) {
    showFeedback('Unexpected error', 'err');
  }

  btn.disabled = false;
  btn.classList.remove('loading');
}

// ── Tags Picker ──────────────────────────────────────────────
function renderTagsPicker(containerId, selectedArr, onChangeCb) {
  const container = $(containerId);
  if (!container) return;
  container.innerHTML = '';
  if (!State.data.tags.length) {
    container.innerHTML = '<span class="tags-empty">No tags yet — create some in Folders tab</span>';
    return;
  }
  State.data.tags.forEach(tag => {
    const chip = document.createElement('div');
    chip.className = `tag-chip ${selectedArr.includes(tag) ? 'on' : 'off'}`;
    chip.textContent = tag;
    chip.setAttribute('role', 'checkbox');
    chip.setAttribute('aria-checked', selectedArr.includes(tag) ? 'true' : 'false');
    chip.tabIndex = 0;
    chip.addEventListener('click', () => toggleTag(chip, tag, selectedArr, onChangeCb));
    chip.addEventListener('keydown', e => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        toggleTag(chip, tag, selectedArr, onChangeCb);
      }
    });
    container.appendChild(chip);
  });
}

function toggleTag(chip, tag, selectedArr, onChangeCb) {
  const idx = selectedArr.indexOf(tag);
  if (idx === -1) selectedArr.push(tag);
  else selectedArr.splice(idx, 1);
  const isOn = selectedArr.includes(tag);
  chip.className = `tag-chip ${isOn ? 'on' : 'off'}`;
  chip.setAttribute('aria-checked', isOn ? 'true' : 'false');
  if (onChangeCb) onChangeCb([...selectedArr]);
}

function syncFolderSelect(selId) {
  const sel = $(selId);
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = '';
  State.data.folders.forEach(f => {
    const o = document.createElement('option');
    o.value = f;
    o.textContent = f;
    if (f === prev) o.selected = true;
    sel.appendChild(o);
  });
}

// ── Links Tab ────────────────────────────────────────────────
function initLinksTab() {
  $('searchInput')?.addEventListener('input', debounce(() => {
    const v = $('searchInput')?.value;
    $('searchClear')?.classList.toggle('hidden', !v);
    State.renderPage = 0;
    renderLinksTab();
  }, 220));

  $('searchClear')?.addEventListener('click', () => {
    const si = $('searchInput');
    if (si) si.value = '';
    $('searchClear')?.classList.add('hidden');
    State.renderPage = 0;
    renderLinksTab();
  });

  ['filterCategory', 'filterFolder', 'filterTag'].forEach(id => {
    $(id)?.addEventListener('change', () => {
      State.renderPage = 0;
      renderLinksTab();
    });
  });

  $('viewList')?.addEventListener('click', () => {
    State.view = 'list';
    syncViewButtons();
    saveUIState();
    renderLinksTab();
  });
  $('viewGrid')?.addEventListener('click', () => {
    State.view = 'grid';
    syncViewButtons();
    saveUIState();
    renderLinksTab();
  });

  $('bulkSelectBtn')?.addEventListener('click', () => {
    State.bulkMode = !State.bulkMode;
    if (!State.bulkMode) {
      State.selectedIds.clear();
      $('bulkBar')?.classList.add('hidden');
    }
    $('bulkSelectBtn')?.classList.toggle('active', State.bulkMode);
    $('bulkSelectBtn')?.setAttribute('aria-pressed', State.bulkMode ? 'true' : 'false');
    renderLinksTab();
  });

  $('linksBulkCancelBtn')?.addEventListener('click', () => {
    State.bulkMode = false;
    State.selectedIds.clear();
    $('bulkBar')?.classList.add('hidden');
    $('bulkSelectBtn')?.classList.remove('active');
    $('bulkSelectBtn')?.setAttribute('aria-pressed', 'false');
    renderLinksTab();
  });

  $('bulkDeleteBtn')?.addEventListener('click', () => {
    if (!State.selectedIds.size) return;
    showConfirm(
      'Delete Selected',
      `Permanently delete ${State.selectedIds.size} product(s)?`,
      'Delete',
      async () => {
        const ids = [...State.selectedIds];
        await Promise.all(ids.map(id => msg({ action: 'REMOVE_LINK', id })));
        State.selectedIds.clear();
        State.bulkMode = false;
        $('bulkBar')?.classList.add('hidden');
        $('bulkSelectBtn')?.classList.remove('active');
        await refresh();
        toast(`${ids.length} product(s) deleted`, 'info');
      }
    );
  });

  $('bulkExportBtn')?.addEventListener('click', () => {
    if (!State.selectedIds.size) return;
    const selected = State.data.links.filter(l => State.selectedIds.has(l.id));
    exportLinksAsHtml(selected, 'zhunter-selected-products.html');
    toast(`Exported ${selected.length} products`, 'ok');
  });

  $('clearAllBtn')?.addEventListener('click', () => {
    if (!State.data.links.length) return;
    showConfirm(
      'Clear All Products',
      `This will permanently delete all ${State.data.links.length} saved products. This cannot be undone.`,
      'Delete All',
      async () => {
        await msg({ action: 'CLEAR_ALL' });
        await refresh();
        toast('All products cleared', 'info');
      }
    );
  });
}

// ── Filter Logic ─────────────────────────────────────────────
function getFiltered() {
  const q   = $('searchInput')?.value.toLowerCase().trim() || '';
  const cat = $('filterCategory')?.value || '';
  const fol = $('filterFolder')?.value || '';
  const tag = $('filterTag')?.value || '';

  return State.data.links.filter(l => {
    const matchQ = !q || (
      (l.title || '').toLowerCase().includes(q) ||
      (l.url || '').toLowerCase().includes(q) ||
      (l.category || '').toLowerCase().includes(q) ||
      (l.notes || '').toLowerCase().includes(q) ||
      (l.price || '').toLowerCase().includes(q) ||
      (l.tags || []).some(t => t.toLowerCase().includes(q))
    );
    return matchQ &&
      (!cat || l.category === cat) &&
      (!fol || l.folder === fol) &&
      (!tag || (l.tags || []).includes(tag));
  });
}

// ── Links Renderer (paginated) ───────────────────────────────
function renderLinksTab() {
  const container  = $('linksContainer');
  const emptyState = $('emptyState');
  const countEl    = $('resultsCount');
  if (!container) return;

  const filtered = getFiltered();
  if (countEl) countEl.textContent = `${filtered.length} product${filtered.length !== 1 ? 's' : ''}`;

  // Clear old cards but keep emptyState
  Array.from(container.children).forEach(c => {
    if (c.id !== 'emptyState') c.remove();
  });

  if (!filtered.length) {
    if (emptyState) emptyState.style.display = 'flex';
    return;
  }
  if (emptyState) emptyState.style.display = 'none';

  // FIXED: apply grid class to container directly
  container.classList.toggle('grid', State.view === 'grid');
  container.classList.toggle('bulk-mode', State.bulkMode);

  const visible = filtered.slice(0, (State.renderPage + 1) * State.PAGE_SIZE);
  const frag = document.createDocumentFragment();
  visible.forEach(link => frag.appendChild(buildLinkCard(link)));

  if (visible.length < filtered.length) {
    const more = document.createElement('button');
    more.className = 'load-more-btn';
    more.type = 'button';
    more.textContent = `Load more (${filtered.length - visible.length} remaining)`;
    more.addEventListener('click', () => {
      State.renderPage++;
      renderLinksTab();
    });
    frag.appendChild(more);
  }

  container.appendChild(frag);
  updateBulkBar();
}

function updateBulkBar() {
  const count = State.selectedIds.size;
  const bulkCountEl = $('bulkCount');
  if (bulkCountEl) bulkCountEl.textContent = `${count} selected`;
  const bulkBar = $('bulkBar');
  if (!State.bulkMode || count === 0) {
    bulkBar?.classList.add('hidden');
  } else {
    bulkBar?.classList.remove('hidden');
  }
}

// ── Link Card Builder ─────────────────────────────────────────
function buildLinkCard(link) {
  const card = document.createElement('div');
  card.className = `link-card${State.selectedIds.has(link.id) ? ' selected' : ''}`;
  card.dataset.id = link.id;
  card.setAttribute('role', 'listitem');

  // Checkbox
  const cbWrap = document.createElement('div');
  cbWrap.className = 'lc-cb-wrap';
  const cb = document.createElement('div');
  cb.className = `lc-cb${State.selectedIds.has(link.id) ? ' checked' : ''}`;
  cb.setAttribute('role', 'checkbox');
  cb.setAttribute('aria-checked', State.selectedIds.has(link.id) ? 'true' : 'false');
  cb.setAttribute('aria-label', `Select ${link.title}`);
  cb.tabIndex = 0;

  const toggleSelect = e => {
    e?.stopPropagation();
    if (State.selectedIds.has(link.id)) {
      State.selectedIds.delete(link.id);
      cb.classList.remove('checked');
      card.classList.remove('selected');
      cb.setAttribute('aria-checked', 'false');
    } else {
      State.selectedIds.add(link.id);
      cb.classList.add('checked');
      card.classList.add('selected');
      cb.setAttribute('aria-checked', 'true');
    }
    updateBulkBar();
  };
  cb.addEventListener('click', toggleSelect);
  cb.addEventListener('keydown', e => {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggleSelect(); }
  });
  cbWrap.appendChild(cb);



  // Body
  const body = document.createElement('div');
  body.className = 'lc-body';

  const titleEl = document.createElement('div');
  titleEl.className = 'lc-title';
  titleEl.textContent = trunc(link.title || link.url, 60);
  titleEl.addEventListener('click', () => chrome.tabs.create({ url: link.url }));

  const urlEl = document.createElement('div');
  urlEl.className = 'lc-url';
  urlEl.textContent = trunc(link.url, 55);
  urlEl.title = link.url;

  const meta = document.createElement('div');
  meta.className = 'lc-meta';

  const foldPill = document.createElement('span');
  foldPill.className = 'meta-pill mp-fold';
  foldPill.textContent = `📁 ${link.folder}`;
  meta.appendChild(foldPill);

  if (link.price) {
    const pricePill = document.createElement('span');
    pricePill.className = 'meta-pill mp-price';
    pricePill.textContent = `💰 ${link.price}`;
    meta.appendChild(pricePill);
  }

  // Video badge
  if (link.videoUrl) {
    const vidPill = document.createElement('span');
    vidPill.className = 'meta-pill mp-video';
    vidPill.textContent = '▶ Video';
    meta.appendChild(vidPill);
  }

  (link.tags || []).slice(0, 3).forEach(t => {
    const tp = document.createElement('span');
    tp.className = 'meta-pill mp-tag';
    tp.textContent = t;
    meta.appendChild(tp);
  });

  const dateEl = document.createElement('span');
  dateEl.className = 'lc-date';
  dateEl.textContent = fmtDate(link.dateAdded);
  meta.appendChild(dateEl);

  body.appendChild(titleEl);
  body.appendChild(urlEl);

  if (link.notes) {
    const notesEl = document.createElement('div');
    notesEl.className = 'lc-notes';
    notesEl.textContent = trunc(link.notes, 100);
    body.appendChild(notesEl);
  }
  body.appendChild(meta);

  // Actions
  const actions = document.createElement('div');
  actions.className = 'lc-actions';

  const SVG = {
    open: `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`,
    edit: `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
    share:`<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>`,
    down: `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
    del:  `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>`
  };

  const openBtn = makeBtn('lc-btn open', 'Open URL', SVG.open);
  openBtn.addEventListener('click', e => {
    e.stopPropagation();
    chrome.tabs.create({ url: link.url });
  });
  openBtn.addEventListener('focus', () => {});

  const editBtn = makeBtn('lc-btn edit', 'Edit Product', SVG.edit);
  editBtn.addEventListener('click', e => { e.stopPropagation(); openEditModal(link); });

  const shareBtn = makeBtn('lc-btn share', 'Share Product', SVG.share);
  shareBtn.addEventListener('click', async e => {
    e.stopPropagation();
    const text = `${link.title}\nPrice: ${link.price || 'N/A'}\n${link.url}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: link.title, url: link.url, text: `Check out this product: ${link.price || ''}` });
      } else {
        await navigator.clipboard.writeText(text);
        toast('Copied to clipboard', 'ok');
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        try {
          await navigator.clipboard.writeText(text);
          toast('Copied to clipboard', 'ok');
        } catch {
          toast('Failed to share', 'err');
        }
      }
    }
  });

  const downBtn = makeBtn('lc-btn down', 'Export Product', SVG.down);
  downBtn.addEventListener('click', e => {
    e.stopPropagation();
    exportLinksAsHtml([link], `product-${link.id.slice(0, 8)}.html`);
    toast('Product exported', 'ok');
  });

  const delBtn = makeBtn('lc-btn del', 'Delete Product', SVG.del);
  delBtn.addEventListener('click', e => {
    e.stopPropagation();
    showConfirm(
      'Delete Product',
      `Delete "${trunc(link.title, 50)}"?`,
      'Delete',
      async () => {
        await msg({ action: 'REMOVE_LINK', id: link.id });
        await refresh();
        toast('Product deleted', 'info');
      }
    );
  });

  // Focus-visible on all action buttons
  [openBtn, editBtn, shareBtn, downBtn, delBtn].forEach(b => {
    b.addEventListener('focus', () => b.classList.add('focus-visible'));
    b.addEventListener('blur', () => b.classList.remove('focus-visible'));
  });

  actions.append(openBtn, editBtn, shareBtn, downBtn, delBtn);
  card.append(cbWrap, body, actions);
  return card;
}

// ── Filter Dropdowns ─────────────────────────────────────────
function syncFilterDropdowns() {
  const cats = [...new Set(State.data.links.map(l => l.category).filter(Boolean))].sort();
  const fols = [...new Set(State.data.links.map(l => l.folder).filter(Boolean))].sort();
  const tags = [...new Set(State.data.links.flatMap(l => l.tags || []).filter(Boolean))].sort();
  syncFilter('filterCategory', cats, 'All Categories');
  syncFilter('filterFolder',   fols, 'All Folders');
  syncFilter('filterTag',      tags, 'All Tags');
}

function syncFilter(selId, values, placeholder) {
  const sel = $(selId);
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = `<option value="">${placeholder}</option>`;
  values.forEach(v => {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = v;
    if (v === prev) o.selected = true;
    sel.appendChild(o);
  });
}

// ── Folders Tab ───────────────────────────────────────────────
function initFoldersTab() {
  // New Folder — inline
  const confirmFolder = async () => {
    const name = $('newFolderInput')?.value.trim();
    if (!name) { toast('Enter a folder name', 'warn'); return; }
    const res = await msg({ action: 'ADD_FOLDER', folder: name });
    const el = $('newFolderInput');
    if (el) el.value = '';
    if (res?.success) {
      State.openFolders.add(name);
      await refresh();
      toast(`Folder "${name}" created`, 'ok');
    } else {
      toast(res?.reason === 'duplicate' ? 'Folder already exists' : 'Error creating folder', 'err');
    }
  };
  $('newFolderBtn')?.addEventListener('click', confirmFolder);
  $('newFolderInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') confirmFolder(); });

  // New Tag — inline
  const confirmTag = async () => {
    const name = $('newTagInput')?.value.trim();
    if (!name) { toast('Enter a tag name', 'warn'); return; }
    const res = await msg({ action: 'ADD_TAG', tag: name });
    const el = $('newTagInput');
    if (el) el.value = '';
    if (res?.success) {
      await refresh();
      toast(`Tag "${name}" added`, 'ok');
    } else {
      toast(res?.reason === 'duplicate' ? 'Tag already exists' : 'Error adding tag', 'err');
    }
  };
  $('newTagBtn')?.addEventListener('click', confirmTag);
  $('newTagInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') confirmTag(); });

  // Search
  $('folderLinkSearch')?.addEventListener('input', debounce(() => {
    State.folderSearch = $('folderLinkSearch')?.value.toLowerCase().trim() || '';
    renderFolderAccordion();
  }, 220));
}

// ── Folder Accordion ──────────────────────────────────────────
function renderFolderAccordion() {
  const container = $('folderAccordion');
  if (!container) return;
  container.innerHTML = '';

  State.data.folders.forEach(folderName => {
    const allLinks    = State.data.links.filter(l => l.folder === folderName);
    const isProtected = folderName === 'General';
    const isOpen      = State.openFolders.has(folderName);
    const filtered    = State.folderSearch
      ? allLinks.filter(l =>
          (l.title || '').toLowerCase().includes(State.folderSearch) ||
          (l.url || '').toLowerCase().includes(State.folderSearch) ||
          (l.tags || []).some(t => t.toLowerCase().includes(State.folderSearch))
        )
      : allLinks;

    const item = document.createElement('div');
    item.className = `folder-item${isOpen ? ' open' : ''}`;
    item.dataset.folder = folderName;
    item.setAttribute('role', 'listitem');

    const header = document.createElement('div');
    header.className = 'folder-header';

    const chevron = document.createElement('div');
    chevron.className = 'folder-chevron';
    chevron.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>`;

    const ico = document.createElement('div');
    ico.className = 'folder-ico-badge';
    ico.textContent = '📁';

    const meta = document.createElement('div');
    meta.className = 'folder-meta';
    const lbl = document.createElement('div');
    lbl.className = 'folder-label';
    lbl.textContent = folderName;
    const ct = document.createElement('div');
    ct.className = 'folder-ct-badge';
    ct.textContent = allLinks.length;
    meta.append(lbl, ct);

    const acts = document.createElement('div');
    acts.className = 'folder-acts';

    const dlBtn = document.createElement('button');
    dlBtn.className = 'folder-act-btn dl-btn';
    dlBtn.type = 'button';
    dlBtn.title = 'Export folder';
    dlBtn.setAttribute('aria-label', `Export ${folderName} folder`);
    dlBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
    dlBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (!allLinks.length) { toast('Folder is empty', 'warn'); return; }
      exportLinksAsHtml(allLinks, `zhunter-${folderName.replace(/\s+/g, '-')}.html`);
      toast('Folder exported!', 'ok');
    });
    acts.appendChild(dlBtn);

    if (!isProtected) {
      const delBtn = document.createElement('button');
      delBtn.className = 'folder-act-btn del-btn';
      delBtn.type = 'button';
      delBtn.title = 'Delete folder';
      delBtn.setAttribute('aria-label', `Delete ${folderName} folder`);
      delBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
      delBtn.addEventListener('click', e => {
        e.stopPropagation();
        showConfirm(
          'Delete Folder',
          `Delete "${folderName}"? All ${allLinks.length} products will move to General.`,
          'Delete',
          async () => {
            await msg({ action: 'REMOVE_FOLDER', folder: folderName });
            State.openFolders.delete(folderName);
            await refresh();
            toast('Folder deleted', 'info');
          }
        );
      });
      acts.appendChild(delBtn);
    }

    header.append(chevron, ico, meta, acts);
    header.addEventListener('click', e => {
      if (e.target.closest('.folder-acts')) return;
      if (State.openFolders.has(folderName)) {
        State.openFolders.delete(folderName);
        item.classList.remove('open');
      } else {
        State.openFolders.add(folderName);
        item.classList.add('open');
      }
    });

    const content = document.createElement('div');
    content.className = 'folder-content';

    const toolbar = document.createElement('div');
    toolbar.className = 'folder-toolbar';
    const tbCount = document.createElement('span');
    tbCount.className = 'folder-tb-count';
    tbCount.textContent = `${allLinks.length} product${allLinks.length !== 1 ? 's' : ''}`;
    const tbDl = document.createElement('button');
    tbDl.className = 'folder-dl-btn';
    tbDl.type = 'button';
    tbDl.textContent = 'Export Folder';
    tbDl.addEventListener('click', () => {
      if (!allLinks.length) return;
      exportLinksAsHtml(allLinks, `zhunter-${folderName.replace(/\s+/g, '-')}.html`);
      toast('Exported!', 'ok');
    });
    toolbar.append(tbCount, tbDl);
    content.appendChild(toolbar);

    const list = document.createElement('div');
    list.className = 'folder-links-list';
    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'folder-empty-msg';
      empty.textContent = State.folderSearch ? 'No matching products' : 'No products in this folder';
      list.appendChild(empty);
    } else {
      filtered.forEach(link => list.appendChild(buildFolderLinkRow(link)));
    }
    content.appendChild(list);
    item.append(header, content);
    container.appendChild(item);
  });
}

function buildFolderLinkRow(link) {
  const row = document.createElement('div');
  row.className = 'folder-link-row';
  row.setAttribute('role', 'listitem');

  const images = Array.isArray(link.images) && link.images.length > 0 ? link.images : [];
  const imgSrc = images[0] || link.base64Image || (Array.isArray(link.imageUrls) && link.imageUrls[0]) || link.favicon || '';

  const fav = document.createElement('img');
  fav.className = 'flr-fav';
  fav.loading = 'lazy';
  fav.alt = '';
  fav.onerror = () => { fav.style.display = 'none'; };
  if (imgSrc && (imgSrc.startsWith('data:image') || imgSrc.startsWith('https') || imgSrc.startsWith('http'))) {
    fav.src = imgSrc;
  }

  const info = document.createElement('div');
  info.className = 'flr-info';
  const titleEl = document.createElement('div');
  titleEl.className = 'flr-title';
  titleEl.textContent = trunc(link.title || link.url, 42);
  titleEl.addEventListener('click', () => chrome.tabs.create({ url: link.url }));
  const urlEl = document.createElement('div');
  urlEl.className = 'flr-url';
  urlEl.textContent = trunc(link.url, 40);
  info.append(titleEl, urlEl);

  const btns = document.createElement('div');
  btns.className = 'flr-btns';

  const editBtn = makeBtn('flr-btn edit', 'Edit', `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`);
  editBtn.addEventListener('click', () => openEditModal(link));

  const delBtn = makeBtn('flr-btn del', 'Delete', `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>`);
  delBtn.addEventListener('click', () => {
    showConfirm('Delete Product', `Delete "${trunc(link.title, 40)}"?`, 'Delete', async () => {
      await msg({ action: 'REMOVE_LINK', id: link.id });
      await refresh();
      toast('Deleted', 'info');
    });
  });

  btns.append(editBtn, delBtn);
  row.append(fav, info, btns);
  return row;
}

// ── Tags Manage ───────────────────────────────────────────────
function renderTagsManage() {
  const list = $('tagsManageList');
  if (!list) return;
  list.innerHTML = '';

  // Wire up "Clear All Tags" button every render
  const clearAllBtn = $('clearAllTagsBtn');
  if (clearAllBtn) {
    // Remove old listener to prevent duplicates
    clearAllBtn.replaceWith(clearAllBtn.cloneNode(true));
    const freshBtn = $('clearAllTagsBtn');
    freshBtn.addEventListener('click', () => {
      if (!State.data.tags.length) { toast('No tags to delete', 'warn'); return; }
      showConfirm(
        'Clear All Tags',
        `Delete all ${State.data.tags.length} tags? This will remove them from every product too.`,
        'Delete All',
        async () => {
          const tagsToDelete = [...State.data.tags];
          for (const tag of tagsToDelete) {
            await msg({ action: 'REMOVE_TAG', tag });
          }
          await refresh();
          toast(`All ${tagsToDelete.length} tags deleted`, 'ok');
        }
      );
    });
  }

  if (!State.data.tags.length) {
    list.innerHTML = '<div class="folder-empty-msg">No tags yet — create your first tag above</div>';
    return;
  }
  State.data.tags.forEach(tag => {
    const pill = document.createElement('div');
    pill.className = 'tag-pill';
    pill.setAttribute('role', 'listitem');
    const span = document.createElement('span');
    span.textContent = `🏷 ${tag}`;
    const del = document.createElement('button');
    del.className = 'tag-del';
    del.type = 'button';
    del.setAttribute('aria-label', `Delete tag ${tag}`);
    del.textContent = '✕';
    del.addEventListener('click', () => {
      showConfirm('Delete Tag', `Remove tag "${tag}" from all products?`, 'Delete', async () => {
        await msg({ action: 'REMOVE_TAG', tag });
        await refresh();
        toast(`Tag "${tag}" removed`, 'info');
      });
    });
    pill.append(span, del);
    list.appendChild(pill);
  });
}

// ── Export Tab ────────────────────────────────────────────────
function initExportTab() {
  $('exportHtmlBtn')?.addEventListener('click', () => doExportHtml());
  $('exportTxtBtn')?.addEventListener('click', () => doExportTxt());

  $('exportJsonBtn')?.addEventListener('click', () => doExportJson());
  $('exportMdBtn')?.addEventListener('click', () => doExportMd());
  $('copyAllBtn')?.addEventListener('click', () => doCopyAll());
}

function updateExportStats() {
  const el1 = $('expTotal');
  const el2 = $('expFolders');
  const el3 = $('expCats');
  if (el1) el1.textContent = State.data.links.length;
  if (el2) el2.textContent = State.data.folders.length;
  if (el3) el3.textContent = new Set(State.data.links.map(l => l.category)).size;
}

function doExportTxt() {
  if (!State.data.links.length) { toast('No products to export', 'warn'); return; }
  let txt = `ZHunter PRO — Product Collection\nExported: ${new Date().toLocaleString()}\n${'─'.repeat(50)}\n\n`;
  State.data.links.forEach((l, i) => {
    txt += `[${i + 1}] ${l.title}\n`;
    txt += `URL: ${l.url}\n`;
    if (l.price) txt += `Price: ${l.price}\n`;
    txt += `Folder: ${l.folder} | Category: ${l.category}\n`;
    if (l.tags?.length) txt += `Tags: ${l.tags.join(', ')}\n`;
    if (l.videoUrl) txt += `Video: ${l.videoUrl}\n`;
    if (l.notes) txt += `Notes: ${l.notes}\n`;
    txt += `Saved: ${fmtDate(l.dateAdded)}\n\n`;
  });
  dlFile(txt, 'zhunter-products.txt', 'text/plain');
  toast('TXT exported', 'ok');
}


function doExportJson() {
  if (!State.data.links.length) { toast('No products to export', 'warn'); return; }
  const clean = State.data.links.map(l => ({
    ...l,
    images: (l.images || []).map((_, i) => `[image_${i + 1}_base64_omitted]`),
    base64Image: l.base64Image ? '[base64_omitted]' : ''
  }));
  dlFile(
    JSON.stringify({
      exported: new Date().toISOString(),
      version: `v${APP_VERSION}`,
      links: clean,
      folders: State.data.folders,
      tags: State.data.tags
    }, null, 2),
    'zhunter-products.json',
    'application/json'
  );
  toast('JSON exported', 'ok');
}

function doExportMd() {
  if (!State.data.links.length) { toast('No products to export', 'warn'); return; }
  let md = `# ZHunter PRO — Product Collection\n\n> Exported: ${new Date().toLocaleString()}\n\n`;
  const byFolder = {};
  State.data.links.forEach(l => { (byFolder[l.folder] = byFolder[l.folder] || []).push(l); });
  Object.entries(byFolder).forEach(([folder, links]) => {
    md += `## 📁 ${folder}\n\n`;
    links.forEach(l => {
      md += `### [${l.title}](${l.url})\n`;
      if (l.price) md += `**Price:** ${l.price}  \n`;
      md += `**Category:** ${l.category} | **Saved:** ${fmtDate(l.dateAdded)}  \n`;
      if (l.tags?.length) md += `**Tags:** ${l.tags.map(t => `\`${t}\``).join(' ')}  \n`;
      if (l.videoUrl) md += `**Video:** [Watch](${l.videoUrl})  \n`;
      if (l.notes) md += `\n${l.notes}\n`;
      md += '\n---\n\n';
    });
  });
  dlFile(md, 'zhunter-products.md', 'text/markdown');
  toast('Markdown exported', 'ok');
}

async function doCopyAll() {
  if (!State.data.links.length) { toast('No URLs to copy', 'warn'); return; }
  await navigator.clipboard.writeText(State.data.links.map(l => l.url).join('\n'));
  toast(`${State.data.links.length} URLs copied!`, 'ok');
}

function doExportHtml() {
  if (!State.data.links.length) { toast('No products to export', 'warn'); return; }
  exportLinksAsHtml(State.data.links, 'zhunter-catalog.html');
}

// ── HTML Export Engine ────────────────────────────────────────
function exportLinksAsHtml(linksArr, filename) {
  const byFolder = {};
  linksArr.forEach(l => { (byFolder[l.folder] = byFolder[l.folder] || []).push(l); });

  const folderSections = Object.entries(byFolder).map(([folder, fLinks]) => {
    const cards = fLinks.map(l => {
      const images = Array.isArray(l.imageUrls) && l.imageUrls.length > 0
        ? l.imageUrls
        : Array.isArray(l.images) && l.images.length > 0
          ? l.images
          : (l.base64Image ? [l.base64Image] : []);
      const safeUrl   = safeHref(l.url);
      const safeTitle = esc(l.title || l.url);
      const safeNotes = esc(l.notes || '').replace(/\n/g, '<br>');
      const safePrice = esc(l.price || '');
      const safeCat   = esc(l.category || 'Other');
      const safeTags  = (l.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join('');
      const safeDate  = esc(fmtDate(l.dateAdded));
      const safeVideoUrl = l.videoUrl ? esc(l.videoUrl) : '';

      // Image gallery — omit huge base64 from src to keep file manageable
      const imgGallery = images.length > 0
        ? `<div class="img-gallery">
            <div class="img-main-wrap">
              <img class="img-main" src="${esc(images[0])}" alt="${safeTitle}" loading="lazy" onerror="this.style.display='none'"/>
            </div>
            ${images.length > 1
              ? `<div class="img-thumbs">${images.slice(1, 6).map((src, i) =>
                  `<img class="img-thumb-exp" src="${esc(src)}" alt="Image ${i + 2}" loading="lazy"
                   onclick="switchImg(this,'${esc(images[0])}')" onerror="this.style.display='none'"/>`
                ).join('')}</div>`
              : ''}
           </div>`
        : `<div class="img-placeholder"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#475569" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg><span>No Image</span></div>`;

      // Video section — YouTube uses thumbnail + button to avoid embed Error 153
      let videoSection = '';
      if (safeVideoUrl) {
        const ytMatch = (safeVideoUrl.match(/[?&]v=([^&]+)/) || safeVideoUrl.match(/youtu\.be\/([^?&/]+)/) || safeVideoUrl.match(/embed\/([^?&/]+)/) || safeVideoUrl.match(/shorts\/([^?&/]+)/));
        const isYT = !!ytMatch || safeVideoUrl.includes('youtube.com') || safeVideoUrl.includes('youtu.be');
        if (isYT) {
          const ytId = ytMatch ? ytMatch[1] : '';
          const thumbUrl = ytId ? `https://img.youtube.com/vi/${ytId}/hqdefault.jpg` : '';
          videoSection = `
          <div class="video-section yt-video-card">
            ${thumbUrl ? `<img class="yt-video-thumb" src="${thumbUrl}" alt="YouTube thumbnail" loading="lazy"/>` : ''}
            <a class="yt-play-btn" href="${safeVideoUrl}" target="_blank" rel="noopener">▶ Watch Video on YouTube</a>
          </div>`;
        } else {
          videoSection = `
          <div class="video-section">
            <video controls class="video-player" preload="metadata" poster="${images[0] ? esc(images[0]) : ''}">
              <source src="${safeVideoUrl}" />
              Your browser does not support video playback.
            </video>
          </div>`;
        }
      }

      // Download buttons - user can choose: ZIP or individual files
      const downloadableImgs = images.filter(s => typeof s === 'string' && s.length > 0);
      const safeName = (l.title || 'product').substring(0, 40)
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'product';
      const encodedImgs = safeEncode(downloadableImgs);
      const dlAllBtn = downloadableImgs.length > 0
        ? '<div class="dl-btn-row">'
          + '<button class="btn btn-dl btn-zip" onclick="downloadCardImagesAsZip(this, safeDecode(\'' + encodedImgs + '\'),' + " '" + safeName + "'" + ')">ZIP (' + downloadableImgs.length + ')</button>'
          + '<button class="btn btn-dl btn-individual" onclick="downloadCardImages(this, safeDecode(\'' + encodedImgs + '\'),' + " '" + safeName + "'" + ')">Individual (' + downloadableImgs.length + ')</button>'
          + '</div>'
        : '';

      return `
      <div class="card" id="card-${esc(l.id)}">
        ${imgGallery}
        ${videoSection}
        <div class="card-body">
          <div class="card-cat">${safeCat}</div>
          <div class="card-title-row">
            <a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="card-title">${safeTitle}</a>
            <button class="copy-btn" onclick="copyText('${esc(l.title || l.url)}', this)" title="Copy title">📋</button>
          </div>
          ${safePrice ? `<div class="card-price">${safePrice}</div>` : ''}
          ${safeNotes
            ? `<div class="card-notes-wrap">
                <div class="card-notes" id="notes-${esc(l.id)}">${safeNotes}</div>
                <button class="copy-desc-btn" onclick="copyText(document.getElementById('notes-${esc(l.id)}').innerText, this)">📋 Copy Description</button>
               </div>`
            : ''}
          ${safeTags ? `<div class="card-tags">${safeTags}</div>` : ''}
          <div class="card-meta">
            <span>📅 ${safeDate}</span>
            <span>📁 ${esc(l.folder)}</span>
            ${safeVideoUrl ? '<span>▶ Has Video</span>' : ''}
          </div>
          <div class="btn-row">
            <a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-view">🔗 View Product</a>
            ${dlAllBtn}
            <button onclick="removeCard('${esc(l.id)}')" class="btn btn-rm">✕ Remove</button>
          </div>
        </div>
      </div>`;
    }).join('');

    return `
    <section class="folder-section" data-folder="${esc(folder)}">
      <div class="folder-header-exp">
        <span class="folder-icon">📁</span>
        <h2>${esc(folder)}</h2>
        <span class="folder-count">${fLinks.length} product${fLinks.length !== 1 ? 's' : ''}</span>
      </div>
      <div class="cards-grid">${cards}</div>
    </section>`;
  }).join('');

  const totalProducts = linksArr.length;
  const totalFolders  = Object.keys(byFolder).length;
  const totalCats     = new Set(linksArr.map(l => l.category)).size;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>ZHunter PRO — Product Catalog</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#050816;--surface:#0a0f24;--card:#0e1530;--border:#1a2347;
  --theme:#06b6d4;--theme-soft:rgba(6,182,212,0.12);--theme-glow:rgba(6,182,212,0.35);
  --text1:#fafafa;--text2:#d4d4d8;--text3:#a1a1aa;--text4:#71717a;
  --green:#10b981;--blue:#3b82f6;--red:#ef4444;--orange:#f59e0b;
}
body{font-family:system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--text1);min-height:100vh}
a{color:inherit;text-decoration:none}
.site-header{background:linear-gradient(135deg,#0f0f1a,#1a0a12);border-bottom:1px solid var(--border);padding:24px 40px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px}
.site-title{font-size:26px;font-weight:900;background:linear-gradient(135deg,#ffffff,#67e8f9,#06b6d4);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.site-meta{font-size:12px;color:var(--text3);margin-top:4px}
.site-stats{display:flex;gap:16px;flex-wrap:wrap}
.stat-box{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:10px 18px;text-align:center}
.stat-box .num{font-size:22px;font-weight:900;color:var(--theme)}
.stat-box .lbl{font-size:10px;color:var(--text4);text-transform:uppercase;letter-spacing:1px}
.search-bar{padding:16px 40px;background:var(--surface);border-bottom:1px solid var(--border);display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.search-inp{flex:1;min-width:200px;padding:10px 16px;background:var(--card);border:1px solid var(--border);border-radius:10px;color:var(--text1);font-size:13px;outline:none}
.search-inp:focus{border-color:var(--theme)}
.filter-sel{padding:10px 12px;background:var(--card);border:1px solid var(--border);border-radius:10px;color:var(--text1);font-size:12px;cursor:pointer;outline:none}
.container{max-width:1400px;margin:0 auto;padding:28px 40px}
.folder-section{margin-bottom:44px}
.folder-header-exp{display:flex;align-items:center;gap:10px;margin-bottom:18px;padding-bottom:12px;border-bottom:1px solid var(--border)}
.folder-icon{font-size:20px}
.folder-header-exp h2{font-size:18px;font-weight:800;color:var(--text1)}
.folder-count{background:var(--theme-soft);color:var(--theme);border:1px solid var(--theme-glow);padding:2px 10px;border-radius:999px;font-size:11px;font-weight:700;margin-left:auto}
.cards-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:18px}
.card{background:var(--card);border:1px solid var(--border);border-radius:16px;overflow:hidden;display:flex;flex-direction:column;transition:all 0.25s}
.card:hover{border-color:rgba(225,29,72,0.35);box-shadow:0 8px 32px rgba(225,29,72,0.12);transform:translateY(-2px)}
.card.removing{animation:cardRemove 0.35s ease forwards}
@keyframes cardRemove{to{opacity:0;transform:scale(0.92) translateY(10px)}}
.img-gallery{background:#0a0a0f}
.img-main-wrap{width:100%;aspect-ratio:4/3;overflow:hidden;background:#0d0d14;display:flex;align-items:center;justify-content:center}
.img-main{width:100%;height:100%;object-fit:contain;transition:transform 0.3s;cursor:zoom-in}
.img-main:hover{transform:scale(1.05)}
.img-thumbs{display:flex;gap:5px;padding:6px;background:#0d0d14;overflow-x:auto;scrollbar-width:thin}
.img-thumb-exp{width:52px;height:52px;object-fit:cover;border-radius:6px;cursor:pointer;border:2px solid transparent;transition:all 0.2s;flex-shrink:0}
.img-thumb-exp:hover{border-color:var(--theme)}
.img-placeholder{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:36px;background:#0d0d14;color:var(--text4);font-size:11px}
.video-section{background:#0a0a0f;padding:6px}
.video-iframe{width:100%;aspect-ratio:16/9;border-radius:8px;display:block}
.video-player{width:100%;aspect-ratio:16/9;border-radius:8px;background:#000;display:block}
.card-body{padding:14px;display:flex;flex-direction:column;gap:8px;flex:1}
.card-cat{display:inline-block;padding:2px 9px;border-radius:999px;font-size:9px;font-weight:700;background:var(--theme-soft);color:var(--theme);border:1px solid var(--theme-glow);width:fit-content}
.card-title-row{display:flex;align-items:flex-start;gap:8px}
.card-title{font-size:14px;font-weight:700;color:var(--text1);line-height:1.4;flex:1;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.card-title:hover{color:#67e8f9}
.copy-btn{background:none;border:none;cursor:pointer;font-size:13px;padding:2px 4px;border-radius:4px;color:var(--text3);flex-shrink:0;transition:all 0.15s}
.copy-btn:hover{background:rgba(255,255,255,0.08);color:var(--text1)}
.card-price{font-size:17px;font-weight:800;color:var(--green)}
.card-notes-wrap{background:rgba(255,255,255,0.03);border-radius:8px;padding:8px 10px;border:1px solid var(--border)}
.card-notes{font-size:12px;color:var(--text2);line-height:1.6;display:-webkit-box;-webkit-line-clamp:5;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-wrap;margin-bottom:6px}
.copy-desc-btn{background:rgba(6,182,212,0.1);border:1px solid rgba(6,182,212,0.25);color:#67e8f9;border-radius:6px;padding:4px 10px;font-size:10px;font-weight:700;cursor:pointer;transition:all 0.15s;width:100%}
.copy-desc-btn:hover{background:rgba(225,29,72,0.2)}
.card-tags{display:flex;flex-wrap:wrap;gap:4px}
.tag{padding:2px 8px;border-radius:999px;font-size:10px;font-weight:600;background:rgba(6,182,212,0.12);color:#67e8f9;border:1px solid rgba(6,182,212,0.22)}
.card-meta{display:flex;gap:10px;font-size:10px;color:var(--text4);margin-top:auto;padding-top:6px;border-top:1px solid var(--border);flex-wrap:wrap}
.btn-row{display:flex;gap:6px;flex-wrap:wrap}
.btn{display:inline-flex;align-items:center;justify-content:center;padding:7px 12px;border-radius:7px;font-size:11px;font-weight:700;cursor:pointer;border:none;transition:all 0.2s;text-decoration:none;white-space:nowrap}
.btn-view{background:linear-gradient(135deg,var(--theme),#0e7490);color:white;flex:1}
.btn-view:hover{opacity:0.9;transform:translateY(-1px)}
.btn-dl{background:rgba(16,185,129,0.12);color:var(--green);border:1px solid rgba(16,185,129,0.28)}
.btn-dl:hover{background:rgba(16,185,129,0.22)}
.dl-btn-row{display:flex;gap:6px;flex-wrap:wrap;margin-top:4px}
.btn-zip{background:rgba(6,182,212,0.12);color:#67e8f9;border:1px solid rgba(6,182,212,0.28);flex:1}
.btn-zip:hover{background:rgba(6,182,212,0.22);transform:translateY(-1px)}
.btn-individual{background:rgba(16,185,129,0.12);color:var(--green);border:1px solid rgba(16,185,129,0.28);flex:1}
.btn-individual:hover{background:rgba(16,185,129,0.22);transform:translateY(-1px)}
.btn-rm{background:rgba(239,68,68,0.10);color:#f87171;border:1px solid rgba(239,68,68,0.22);padding:7px 9px}
.btn-rm:hover{background:rgba(239,68,68,0.22)}
.card.hidden{display:none!important}
.folder-section.hidden{display:none!important}
.site-footer{text-align:center;padding:28px;color:var(--text4);font-size:11px;border-top:1px solid var(--border);margin-top:16px}
.save-all-fab{position:fixed;top:20px;right:20px;z-index:9998;background:linear-gradient(135deg,#06b6d4,#0e7490);color:#050816;border:none;border-radius:999px;padding:12px 22px;font-size:14px;font-weight:800;cursor:pointer;display:flex;align-items:center;gap:8px;box-shadow:0 6px 20px rgba(6,182,212,0.45),0 0 0 1px rgba(255,255,255,0.12),0 0 28px rgba(6,182,212,0.30);transition:transform 0.2s,box-shadow 0.2s,filter 0.2s}
.save-all-fab:hover{transform:translateY(-2px);filter:brightness(1.1);box-shadow:0 10px 28px rgba(6,182,212,0.6),0 0 0 1px rgba(255,255,255,0.2),0 0 40px rgba(6,182,212,0.5)}
.save-all-fab:active{transform:translateY(0)}
.save-all-panel{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.7);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:20px;animation:fadeIn 0.2s}
.save-all-panel.hidden{display:none}
.save-all-card{background:var(--card);border:1px solid var(--border);border-radius:16px;width:100%;max-width:480px;box-shadow:0 24px 60px rgba(0,0,0,0.5);overflow:hidden}
.save-all-head{display:flex;align-items:center;justify-content:space-between;padding:20px 24px;border-bottom:1px solid var(--border);background:linear-gradient(135deg,rgba(225,29,72,0.08),rgba(225,29,72,0))}
.save-all-head h3{font-size:18px;font-weight:800;color:var(--text1)}
.save-all-close{background:none;border:none;color:var(--text3);font-size:18px;cursor:pointer;padding:4px 10px;border-radius:6px;transition:all 0.15s}
.save-all-close:hover{background:rgba(255,255,255,0.06);color:var(--text1)}
.save-all-body{padding:24px}
.save-all-desc{color:var(--text2);font-size:13px;line-height:1.6;margin-bottom:16px}
.save-all-info{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:16px;font-size:13px;color:var(--text2)}
.save-all-info strong{color:var(--theme);font-size:16px;font-weight:800}
.save-all-progress{margin-bottom:16px}
.save-all-progress.hidden{display:none}
.save-all-bar{height:8px;background:var(--surface);border-radius:999px;overflow:hidden;border:1px solid var(--border)}
.save-all-bar-fill{height:100%;background:linear-gradient(90deg,#06b6d4,#67e8f9,#06b6d4);background-size:200% 100%;width:0%;transition:width 0.3s;border-radius:999px;box-shadow:0 0 12px rgba(6,182,212,0.6);animation:zh-export-flow 1.6s linear infinite}
@keyframes zh-export-flow{0%{background-position:0% 50%}100%{background-position:200% 50%}}
.save-all-status{font-size:12px;color:var(--text3);margin-top:8px;text-align:center}
.save-all-actions{display:flex;gap:8px;flex-wrap:wrap}
.save-all-btn{padding:10px 16px;border-radius:10px;border:1px solid var(--border);font-size:13px;font-weight:600;cursor:pointer;transition:all 0.15s;flex:1;min-width:100px}
.save-all-btn.hidden{display:none}
.save-all-btn-primary{background:linear-gradient(135deg,#06b6d4,#0e7490);color:#050816;border-color:transparent;font-weight:800}
.save-all-btn-primary:hover{filter:brightness(1.1);transform:translateY(-1px)}
.save-all-btn-primary:disabled{opacity:0.5;cursor:not-allowed;transform:none}
.save-all-btn-stop{background:rgba(239,68,68,0.12);color:#f87171;border-color:rgba(239,68,68,0.3)}
.save-all-btn-stop:hover{background:rgba(239,68,68,0.22)}
.save-all-btn-ghost{background:transparent;color:var(--text2)}
.save-all-btn-ghost:hover{background:var(--surface);color:var(--text1)}
.save-all-note{margin-top:14px;padding-top:14px;border-top:1px solid var(--border);color:var(--text4);font-size:11px;line-height:1.5}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
@media(max-width:768px){
  .site-header,.container,.search-bar{padding-left:14px;padding-right:14px}
  .cards-grid{grid-template-columns:1fr}
}
@media(max-width:520px){.save-all-fab{padding:10px 16px;font-size:12px;top:12px;right:12px}.save-all-fab span:last-child{display:none}}
@media print{.btn-rm,.search-bar,.save-all-fab,.save-all-panel{display:none!important}}
</style>
</head>
<body>
<header class="site-header">
  <div>
    <div class="site-title">🛍️ ZHunter PRO Catalog</div>
    <div class="site-meta">Exported ${new Date().toLocaleString()} · v${APP_VERSION}</div>
  </div>
  <div class="site-stats">
    <div class="stat-box"><div class="num">${totalProducts}</div><div class="lbl">Products</div></div>
    <div class="stat-box"><div class="num">${totalFolders}</div><div class="lbl">Folders</div></div>
    <div class="stat-box"><div class="num">${totalCats}</div><div class="lbl">Categories</div></div>
  </div>
</header>

<!-- Floating master "Save All Images" button -->
<button id="saveAllImagesBtn" class="save-all-fab" onclick="openSaveAllPanel()">
  <span style="font-size:18px">💾</span>
  <span>Save All Images</span>
</button>

<!-- Save-all panel (popup overlay) -->
<div id="saveAllPanel" class="save-all-panel hidden">
  <div class="save-all-card">
    <div class="save-all-head">
      <h3>💾 Save All Images</h3>
      <button class="save-all-close" onclick="closeSaveAllPanel()">✕</button>
    </div>
    <div class="save-all-body">
      <p class="save-all-desc">Download every product image to your computer, one by one. Your browser will save them all to your Downloads folder.</p>
      <div class="save-all-info">
        <div><strong id="saveAllTotal">0</strong> images across <strong id="saveAllProducts">0</strong> products</div>
      </div>
      <div class="save-all-progress hidden" id="saveAllProgressWrap">
        <div class="save-all-bar">
          <div class="save-all-bar-fill" id="saveAllBarFill"></div>
        </div>
        <div class="save-all-status" id="saveAllStatus">Starting…</div>
      </div>
      <div class="save-all-actions">
        <button id="saveAllStartBtn" class="save-all-btn save-all-btn-primary" onclick="startSaveAll()">Start Downloading</button>
        <button id="saveAllStopBtn" class="save-all-btn save-all-btn-stop hidden" onclick="stopSaveAll()">Stop</button>
        <button class="save-all-btn save-all-btn-ghost" onclick="closeSaveAllPanel()">Close</button>
      </div>
      <div class="save-all-note">
        <small>💡 Browser may ask permission for multiple downloads — click "Allow" once.</small>
      </div>
    </div>
  </div>
</div>

<div class="search-bar">
  <input class="search-inp" type="search" id="liveSearch" placeholder="🔍 Search products, titles, tags, notes…" oninput="filterCards(this.value)" autocomplete="off"/>
  <select class="filter-sel" onchange="filterByFolder(this.value)">
    <option value="">All Folders</option>
    ${Object.keys(byFolder).map(f => `<option value="${esc(f)}">${esc(f)}</option>`).join('')}
  </select>
</div>
<div class="container" id="mainContainer">${folderSections}</div>
<footer class="site-footer">Generated by ZHunter PRO v${APP_VERSION}</footer>
<script>
function copyText(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.textContent;
    btn.textContent = '✓ Copied!';
    btn.style.color = '#10b981';
    setTimeout(() => { btn.textContent = orig; btn.style.color = ''; }, 2000);
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove();
    btn.textContent = '✓ Copied!';
    setTimeout(() => { btn.textContent = btn.dataset.orig || '📋'; }, 2000);
  });
}
function removeCard(id) {
  const card = document.getElementById('card-' + id);
  if (!card) return;
  card.classList.add('removing');
  setTimeout(() => card.remove(), 350);
}
function filterCards(q) {
  q = q.toLowerCase().trim();
  document.querySelectorAll('.card').forEach(card => {
    const text = card.textContent.toLowerCase();
    card.classList.toggle('hidden', q.length > 0 && !text.includes(q));
  });
}
function filterByFolder(folder) {
  document.querySelectorAll('.folder-section').forEach(sec => {
    if (!folder) { sec.classList.remove('hidden'); return; }
    sec.classList.toggle('hidden', sec.dataset.folder !== folder);
  });
}
function switchImg(thumb, defaultSrc) {
  const gallery = thumb.closest('.img-gallery');
  const main = gallery ? gallery.querySelector('.img-main') : null;
  if (main) main.src = thumb.src;
  gallery.querySelectorAll('.img-thumb-exp').forEach(t => t.style.borderColor = 'transparent');
  thumb.style.borderColor = '#06b6d4';
}
document.querySelectorAll('.img-thumb-exp').forEach(t => {
  t.addEventListener('click', function() { switchImg(this); });
});

// ── Per-card downloader: download all images of one product ─
async function downloadCardImages(btn, urls, safeName) {
  if (!urls || !urls.length) return;
  const orig = btn ? btn.textContent : '';
  if (btn) btn.disabled = true;

  for (let i = 0; i < urls.length; i++) {
    if (btn) btn.textContent = '⬇ ' + (i+1) + ' of ' + urls.length + '…';
    
    const urlPath = urls[i].split('?')[0];
    const lastPart = urlPath.split('.').pop().toLowerCase();
    const validImgExts  = ['jpg','jpeg','png','gif','webp'];
    const validVidExts  = ['mp4','mov','webm','avi','mkv'];
    const allValidExts  = [...validImgExts, ...validVidExts];
    const ext = allValidExts.includes(lastPart) ? lastPart
              : validVidExts.some(v => urls[i].toLowerCase().includes(v)) ? 'mp4'
              : 'jpg';
    // Smart naming: product-name-1.jpg
    const filename = (safeName || 'product') + '-' + (i+1) + '.' + ext;

    let downloaded = false;
    try {
      const response = await fetch(urls[i]);
      if (response.ok) {
        const blob = await response.blob();
        if (blob.size > 0) {
          const blobUrl = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = blobUrl;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
          downloaded = true;
        }
      }
    } catch(e) {
      downloaded = false;
    }

    if (!downloaded) {
      const a = document.createElement('a');
      a.href = urls[i];
      a.download = filename;
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }

    await new Promise(r => setTimeout(r, 800));
  }

  if (btn) {
    btn.textContent = '✓ Done ' + urls.length + ' images';
    btn.disabled = false;
    setTimeout(() => { btn.textContent = orig; }, 3000);
  }
}

// ── ZIP Download ─────────────────────────────────────────────
async function downloadCardImagesAsZip(btn, urls, safeName) {
  if (!urls || !urls.length) return;
  if (typeof JSZip === 'undefined') {
    toast('JSZip not loaded', 'err');
    return;
  }

  const orig = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Preparing ZIP...'; }

  const zip = new JSZip();
  const folder = zip.folder(safeName || 'images');
  let added = 0;

  for (let i = 0; i < urls.length; i++) {
    if (btn) btn.textContent = 'Fetching ' + (i+1) + '/' + urls.length + '...';
    
    const urlPath = urls[i].split('?')[0];
    const lastPart = urlPath.split('.').pop().toLowerCase();
    const validExts = ['jpg','jpeg','png','gif','webp'];
    const ext = validExts.includes(lastPart) ? lastPart : 'jpg';
    // Smart naming: product-name-1.jpg
    const filename = (safeName || 'product') + '-' + (i+1) + '.' + ext;

    try {
      const response = await fetch(urls[i]);
      if (response.ok) {
        const blob = await response.blob();
        if (blob.size > 0) {
          folder.file(filename, blob);
          added++;
        }
      }
    } catch(e) {
      console.warn('ZHunter ZIP: could not fetch', urls[i]);
    }
  }

  if (added === 0) {
    toast('Could not fetch any images for ZIP', 'err');
    if (btn) { btn.disabled = false; btn.textContent = orig; }
    return;
  }

  if (btn) btn.textContent = 'Generating ZIP...';

  try {
    const content = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 3 } });
    const objUrl = URL.createObjectURL(content);
    const a = document.createElement('a');
    a.href = objUrl;
    a.download = (safeName || 'images') + '.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
    toast('ZIP saved: ' + added + ' images', 'ok');
  } catch(e) {
    toast('ZIP generation failed', 'err');
  }

  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Done ZIP (' + added + ')';
    setTimeout(() => { btn.textContent = orig; }, 3000);
  }
}

// ── Save All Images — sequential downloader (master button) ─
let _saveAllStop = false;
let _saveAllRunning = false;

function collectAllImages() {
  const all = [];
  document.querySelectorAll('.card').forEach(card => {
    const id = card.id.replace('card-', '');
    const titleEl = card.querySelector('.card-title');
    const safeTitle = (titleEl ? titleEl.textContent : 'product')
      .replace(/[^a-zA-Z0-9 _-]/g, '').trim().slice(0, 30).replace(/\s+/g, '_') || 'product';
    const imgs = card.querySelectorAll('img.img-main, img.img-thumb-exp');
    const seen = new Set();
    let n = 1;
    imgs.forEach(im => {
      const src = im.src || im.getAttribute('src');
      if (!src || seen.has(src)) return;
      seen.add(src);
      all.push({ src, name: safeTitle + '_img' + n + extFromSrc(src), card: id });
      n++;
    });
  });
  return all;
}
function extFromSrc(src) {
  if (src.startsWith('data:image/png')) return '.png';
  if (src.startsWith('data:image/webp')) return '.webp';
  if (src.startsWith('data:image/gif')) return '.gif';
  const m = src.match(/\.(jpg|jpeg|png|webp|gif|avif)(?:\?|#|$)/i);
  return m ? '.' + m[1].toLowerCase() : '.jpg';
}

function openSaveAllPanel() {
  const all = collectAllImages();
  const totalImgs = all.length;
  const totalCards = document.querySelectorAll('.card').length;
  const t = document.getElementById('saveAllTotal'); if (t) t.textContent = totalImgs;
  const p = document.getElementById('saveAllProducts'); if (p) p.textContent = totalCards;
  document.getElementById('saveAllPanel').classList.remove('hidden');
  document.getElementById('saveAllProgressWrap').classList.add('hidden');
  document.getElementById('saveAllStartBtn').classList.remove('hidden');
  document.getElementById('saveAllStopBtn').classList.add('hidden');
  document.getElementById('saveAllStartBtn').disabled = (totalImgs === 0);
  document.getElementById('saveAllStartBtn').textContent = totalImgs === 0 ? 'No images to save' : 'Start Downloading';
}
function closeSaveAllPanel() {
  if (_saveAllRunning) {
    if (!confirm('A download is in progress. Stop and close?')) return;
    _saveAllStop = true;
  }
  document.getElementById('saveAllPanel').classList.add('hidden');
}
function stopSaveAll() {
  _saveAllStop = true;
  document.getElementById('saveAllStatus').textContent = 'Stopping…';
}
async function downloadOne(src, name) {
  return new Promise((resolve) => {
    try {
      const a = document.createElement('a');
      a.href = src;
      a.download = name;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { a.remove(); resolve(true); }, 50);
    } catch (e) {
      resolve(false);
    }
  });
}
async function startSaveAll() {
  if (_saveAllRunning) return;
  const all = collectAllImages();
  if (!all.length) return;

  _saveAllRunning = true;
  _saveAllStop = false;

  document.getElementById('saveAllStartBtn').classList.add('hidden');
  document.getElementById('saveAllStopBtn').classList.remove('hidden');
  document.getElementById('saveAllProgressWrap').classList.remove('hidden');

  const fill = document.getElementById('saveAllBarFill');
  const status = document.getElementById('saveAllStatus');

  let ok = 0, fail = 0;
  for (let i = 0; i < all.length; i++) {
    if (_saveAllStop) break;
    const item = all[i];
    status.textContent = 'Downloading ' + (i + 1) + ' of ' + all.length + ' — ' + item.name;
    fill.style.width = ((i / all.length) * 100).toFixed(1) + '%';
    const res = await downloadOne(item.src, item.name);
    res ? ok++ : fail++;
    // 300ms delay so the browser doesn't cancel a wave of downloads
    await new Promise(r => setTimeout(r, 300));
  }

  fill.style.width = '100%';
  status.textContent = _saveAllStop
    ? ('Stopped — ' + ok + ' saved, ' + (all.length - ok) + ' skipped')
    : ('Done! ' + ok + ' saved' + (fail ? ', ' + fail + ' failed' : ''));

  document.getElementById('saveAllStopBtn').classList.add('hidden');
  document.getElementById('saveAllStartBtn').classList.remove('hidden');
  document.getElementById('saveAllStartBtn').textContent = 'Download Again';

  _saveAllRunning = false;
}
<\/script>
</body>
</html>`;

  dlFile(html, filename, 'text/html');
  toast('Professional HTML catalog exported! ✨', 'ok');
}

// ── Modals ────────────────────────────────────────────────────
function initModals() {
  $('closeEditModal')?.addEventListener('click', closeEdit);
  $('cancelEditBtn')?.addEventListener('click', closeEdit);
  $('saveEditBtn')?.addEventListener('click', handleSaveEdit);
  $('editAddImageBtn')?.addEventListener('click', () => {
    State.imageUrlTarget = 'edit';
    openImageUrlModal();
  });

  $('confirmCancel')?.addEventListener('click', () => {
    $('confirmModal')?.classList.add('hidden');
    State.confirmCb = null;
  });
  $('confirmOk')?.addEventListener('click', () => {
    $('confirmModal')?.classList.add('hidden');
    if (State.confirmCb) { State.confirmCb(); State.confirmCb = null; }
  });

  ['editModal', 'confirmModal', 'imageUrlModal', 'huntPreviewModal', 'huntBulkModal', 'queueImportPreviewModal'].forEach(id => {
    $(id)?.addEventListener('click', e => {
      if (e.target === $(id)) {
        const box = $(id).querySelector('.modal-box');
        if (box) {
          box.classList.add('closing');
          setTimeout(() => {
            $(id).classList.add('hidden');
            box.classList.remove('closing');
          }, 150);
        } else {
          $(id).classList.add('hidden');
        }
        if (id === 'editModal') State.confirmCb = null;
        if (id === 'queueImportPreviewModal') closeQueueImportPreview();
      }
    });
  });

  document.addEventListener('keydown', e => {
    // Search Shortcut
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      $('searchQuery')?.focus();
    }
    // Escape handler
    if (e.key === 'Escape') {
      let closedModal = false;
      ['editModal', 'confirmModal', 'imageUrlModal', 'huntPreviewModal', 'huntBulkModal', 'queueImportPreviewModal'].forEach(id => {
        const m = $(id);
        if (m && !m.classList.contains('hidden')) {
          const box = m.querySelector('.modal-box');
          if (box) {
            box.classList.add('closing');
            setTimeout(() => {
              m.classList.add('hidden');
              box.classList.remove('closing');
            }, 150);
          } else {
            m.classList.add('hidden');
          }
          if (id === 'queueImportPreviewModal') closeQueueImportPreview();
          closedModal = true;
        }
      });
      // Clear bulk selection if no modal is open
      if (!closedModal && State.selectedIds && State.selectedIds.size > 0) {
        State.selectedIds.clear();
        renderLinksTab();
      }
    }
  });
}

// ── Hunt Preview Modal ───────────────────────────────────────
// Pre-save review: lets user pick which scraped images to keep
// and edit all fields before committing the save.
const HuntState = {
  url:      '',
  imageUrls: [],
  selected:  new Set(),    // indices of huntImageUrls that are checked
  tags:      [],
  videos:    []
};

function openHuntPreviewModal(scraped, tab) {
  HuntState.url       = scraped.url || tab?.url || '';
  HuntState.imageUrls = (Array.isArray(scraped.images) ? scraped.images : []).slice(0, 15);
  HuntState.selected  = new Set(HuntState.imageUrls.map((_, i) => i));
  HuntState.tags      = [];
  HuntState.videos    = (Array.isArray(scraped.videos) ? scraped.videos : []).slice(0, 12);

  const setVal = (id, val) => { const el = $(id); if (el) el.value = val || ''; };
  setVal('huntUrl',      HuntState.url);
  setVal('huntTitle',    scraped.title || tab?.title || '');
  setVal('huntPrice',    scraped.price || '');
  setVal('huntCategory', detectCat(HuntState.url));
  setVal('huntVideoUrl', HuntState.videos[0] || '');
  setVal('huntNotes',    '');

  // Folder dropdown
  const folderSel = $('huntFolder');
  if (folderSel) {
    folderSel.innerHTML = '';
    const folders = State.data?.folders || ['General'];
    const lastFolder = State.data?.settings?.lastFolder || 'General';
    folders.forEach(f => {
      const opt = document.createElement('option');
      opt.value = f;
      opt.textContent = f;
      if (f === lastFolder) opt.selected = true;
      folderSel.appendChild(opt);
    });
  }

  renderHuntImages();
  renderHuntTags();
  $('huntPreviewModal')?.classList.remove('hidden');
}

function closeHuntPreviewModal() {
  $('huntPreviewModal')?.classList.add('hidden');
}

function renderHuntImages() {
  const grid = $('huntImagesGrid');
  if (!grid) return;
  grid.innerHTML = '';

  if (HuntState.imageUrls.length === 0) {
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--text3);padding:24px;font-size:12px">No images scraped from this page</div>';
    updateHuntCounter();
    return;
  }

  HuntState.imageUrls.forEach((url, i) => {
    const card = document.createElement('div');
    card.className = 'hunt-img-card' + (HuntState.selected.has(i) ? ' selected' : '');
    card.dataset.idx = i;
    card.title = HuntState.selected.has(i) ? 'Click to skip this image' : 'Click to include this image';
    card.innerHTML = `
      <img src="${url}" alt="Image ${i + 1}" loading="lazy"
           data-onerror="broken" />
      <div class="hunt-img-mark"></div>`;
    card.addEventListener('click', () => {
      const idx = parseInt(card.dataset.idx, 10);
      if (HuntState.selected.has(idx)) HuntState.selected.delete(idx);
      else HuntState.selected.add(idx);
      card.classList.toggle('selected');
      card.title = HuntState.selected.has(idx) ? 'Click to skip this image' : 'Click to include this image';
      updateHuntCounter();
    });
    // If image fails to load, auto-deselect it
    const imgEl = card.querySelector('img');
    if (imgEl) {
      imgEl.addEventListener('error', () => {
        const idx = parseInt(card.dataset.idx, 10);
        HuntState.selected.delete(idx);
        card.classList.remove('selected');
        updateHuntCounter();
      });
    }
    grid.appendChild(card);
  });
  updateHuntCounter();
}

function updateHuntCounter() {
  const el = $('huntImgCounter');
  if (el) el.textContent = `${HuntState.selected.size}/${HuntState.imageUrls.length} selected`;
}

function renderHuntTags() {
  // Reuse the existing global tag picker helper for consistent style + behavior
  renderTagsPicker('huntTagsSelector', HuntState.tags);
}

// Wire up modal buttons (run on DOMContentLoaded inside the main IIFE)
function initHuntPreviewModal() {
  $('closeHuntModal')?.addEventListener('click', closeHuntPreviewModal);
  $('cancelHuntBtn')?.addEventListener('click', closeHuntPreviewModal);

  $('huntSelectAllBtn')?.addEventListener('click', () => {
    HuntState.selected = new Set(HuntState.imageUrls.map((_, i) => i));
    renderHuntImages();
  });
  $('huntDeselectAllBtn')?.addEventListener('click', () => {
    HuntState.selected = new Set();
    renderHuntImages();
  });

  $('confirmHuntSaveBtn')?.addEventListener('click', async () => {
    const btn = $('confirmHuntSaveBtn');
    btn.disabled = true;
    const origText = btn.textContent;
    btn.textContent = 'Saving…';

    try {
      const url      = ($('huntUrl')?.value      || HuntState.url || '').trim();
      const title    = ($('huntTitle')?.value    || '').trim();
      const price    = ($('huntPrice')?.value    || '').trim();
      const category = ($('huntCategory')?.value || '').trim();
      const folder   = $('huntFolder')?.value    || 'General';
      const videoUrl = ($('huntVideoUrl')?.value || '').trim();
      const notes    = ($('huntNotes')?.value    || '').trim();

      // Picked images only
      const pickedUrls = HuntState.imageUrls.filter((_, i) => HuntState.selected.has(i));

      const fastRes = await msg({
        action:   'ADD_LINK_FAST',
        url, title, folder, notes, price,
        tags:     [...HuntState.tags],
        imageUrls: pickedUrls,
        videos:    HuntState.videos,
        videoUrl
      });

      if (!fastRes?.success) {
        btn.disabled = false;
        btn.textContent = origText;
        if (fastRes?.reason === 'duplicate') {
          toast('This product is already saved', 'warn');
        } else {
          toast('Save failed — please try again', 'err');
        }
        return;
      }

      // If user picked a custom category that's different from auto-detected,
      // patch it via UPDATE_LINK
      if (category && fastRes.link.category !== category) {
        msg({ action: 'UPDATE_LINK', id: fastRes.link.id, updates: { category } }).catch(() => {});
      }

      closeHuntPreviewModal();
      State.openFolders.add(folder);
      await refresh();
      toast('Product saved! 🛍️ Images loading in background…', 'ok');

      // Background enrichment (base64 images)
      msg({ action: 'ENRICH_LINK', linkId: fastRes.link.id }).catch(() => {});

    } finally {
      const b = $('confirmHuntSaveBtn');
      if (b) {
        b.disabled = false;
        b.textContent = origText;
      }
    }
  });

  // Click outside to close
  $('huntPreviewModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'huntPreviewModal') closeHuntPreviewModal();
  });
}

function openEditModal(link) {
  State.editTags   = [...(link.tags || [])];
  State.editImages = Array.isArray(link.images) && link.images.length > 0
    ? [...link.images]
    : link.base64Image ? [link.base64Image] : [];

  const setVal = (id, val) => { const el = $(id); if (el) el.value = val || ''; };
  setVal('editLinkId',   link.id);
  setVal('editUrl',      link.url);
  setVal('editTitle',    link.title);
  setVal('editNotes',    link.notes || '');
  setVal('editPrice',    link.price || '');
  setVal('editCategory', link.category || '');
  setVal('editVideoUrl', link.videoUrl || '');

  syncFolderSelect('editFolder');
  const ef = $('editFolder');
  if (ef) ef.value = link.folder;

  renderTagsPicker('editTagsSelector', State.editTags);
  renderEditImages();

  $('editModal')?.classList.remove('hidden');
  setTimeout(() => $('editTitle')?.focus(), 100);
}

function renderEditImages() {
  const grid = $('editImagesGrid');
  if (!grid) return;
  grid.innerHTML = '';
  if (!State.editImages.length) {
    grid.innerHTML = '<div class="edit-imgs-empty">No images — click Add Image to upload</div>';
    return;
  }
  State.editImages.forEach((imgSrc, idx) => {
    const thumb = buildImageThumb(imgSrc, idx, (i) => {
      State.editImages.splice(i, 1);
      renderEditImages();
    });
    grid.appendChild(thumb);
  });
}

function closeEdit() {
  $('editModal')?.classList.add('hidden');
}

async function handleSaveEdit() {
  const id  = $('editLinkId')?.value;
  const url = $('editUrl')?.value.trim();
  if (!id) return;
  if (!url || !isValidURL(url)) {
    toast('Please enter a valid URL', 'err');
    return;
  }

  const btn = $('saveEditBtn');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  const updates = {
    url,
    title:    $('editTitle')?.value.trim() || url,
    notes:    $('editNotes')?.value.trim() || '',
    price:    $('editPrice')?.value.trim() || '',
    folder:   $('editFolder')?.value || 'General',
    category: $('editCategory')?.value.trim() || '',
    tags:     [...State.editTags],
    images:   [...State.editImages],
    videoUrl: $('editVideoUrl')?.value.trim() || ''
  };

  await msg({ action: 'UPDATE_LINK', id, updates });
  btn.disabled = false;
  btn.textContent = 'Save Changes';
  closeEdit();
  await refresh();
  toast('Product updated!', 'ok');
}

function showConfirm(title, message, btnLabel, cb) {
  const tEl = $('confirmTitle');
  const mEl = $('confirmMessage');
  const oEl = $('confirmOk');
  const modal = $('confirmModal');
  if (tEl) tEl.textContent = title;
  if (mEl) mEl.textContent = message;
  if (oEl) oEl.textContent = btnLabel;
  State.confirmCb = cb;
  if (modal) {
    modal.style.zIndex = '999999';
    modal.classList.remove('hidden');
  }
  setTimeout(() => $('confirmOk')?.focus(), 100);
}

// ── Toast ─────────────────────────────────────────────────────
function toast(message, type = 'info') {
  const stack = $('toastStack');
  if (!stack) return;
  while (stack.children.length >= 4) {
    stack.firstChild?.remove();
  }
  const item = document.createElement('div');
  item.className = `toast-item ${type}`;
  const icons = { ok: '✅', err: '❌', warn: '⚠️', info: 'ℹ️' };
  item.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ️'}</span><span>${esc(message)}</span>`;
  stack.appendChild(item);
  item.getBoundingClientRect(); // force reflow
  item.classList.add('visible');
  setTimeout(() => {
    item.classList.add('leaving');
    setTimeout(() => item.remove(), 320);
  }, 3200);
}

// ── Header Buttons ────────────────────────────────────────────
function initHeaderButtons() {
  $('settingsBtn')?.addEventListener('click', () => {
    $('tab-btn-settings')?.click();
  });
}

// ── DOMContentLoaded ──────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  applyDynamicVersion();
  await loadData();
  initTheme();
  initTabs();
  initHeaderButtons();
  initModals();
  initImageUrlModal();
  initHuntPreviewModal();
  initBulkTab();
  renderAll();
  applyRipples();
  initImagesTab();

  // ── Check for pending image hunt from right-click context menu ──
  setTimeout(async () => {
    try {
      const res = await msg({ action: 'GET_PENDING_IMAGE_HUNT' });
      if (res?.success && res.pending) {
        const pending = res.pending;
        // Switch to Images tab
        document.querySelector('[data-tab="images"]')?.click();
        // Scrape the tab if still open
        let scraped = null;
        if (pending.tabId) {
          scraped = await new Promise(resolve => {
            let done = false;
            const finish = v => { if (!done) { done = true; resolve(v); } };
            const t = setTimeout(() => finish(null), 6000);
            chrome.tabs.sendMessage(pending.tabId, { action: 'SCRAPE_PAGE' }, res2 => {
              clearTimeout(t);
              if (chrome.runtime.lastError || !res2?.success || !res2?.data) finish(null);
              else finish(res2.data);
            });
          });
        }
        if (!scraped) {
          // Fallback: open modal with just the page URL and the image
          scraped = { title: pending.tabTitle || '', url: pending.tabUrl, price: '', images: pending.imageUrl ? [pending.imageUrl] : [], videos: [], variants: [] };
        } else if (pending.imageUrl) {
          // Ensure the right-clicked image is first in the list
          const imgList = scraped.images || [];
          const withoutDup = imgList.filter(u => u !== pending.imageUrl);
          scraped.images = [pending.imageUrl, ...withoutDup].slice(0, 15);
        }
        const fakeTab = { id: pending.tabId, url: pending.tabUrl, title: pending.tabTitle };
        openHuntPreviewModal(scraped, fakeTab);
        toast('Right-click image hunt ready — review and save!', 'info');
      }
    } catch (_) {}
  }, 300);

  // Listen for background messages
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action === 'LINK_ADDED') {
      refresh();
      toast('Product saved via context menu!', 'ok');
    }
    if (message.action === 'LINK_UPDATED') {
      // Background enrichment finished (images base64).
      // Update local state silently — no toast spam.
      if (message.link?.id && Array.isArray(State.data?.links)) {
        const i = State.data.links.findIndex(l => l.id === message.link.id);
        if (i !== -1) {
          State.data.links[i] = message.link;
          renderAll();
        } else {
          refresh();
        }
      } else {
        refresh();
      }
    }
    if (message.action === 'SHOW_TOAST') {
      toast(message.message, message.type || 'info');
    }
    return true;
  });
});
// ── Queue Import Preview (v7.11.0) ─────────────────────────────
// Classifies candidates via the background (no write), lets the user
// review accepted / duplicate / unsupported groups and untick rows,
// then adds only the checked accepted rows.
const QueueImportPreviewState = { accepted: [], source: 'manual', resolve: null, previewAction: 'PREVIEW_BULK_QUEUE', adder: null };

function qipPlatformLabel(p) {
  const map = { amazon: 'Amazon', walmart: 'Walmart', samsclub: "Sam's Club", faire: 'Faire' };
  return map[String(p || '').toLowerCase()] || (p ? String(p) : 'Web');
}

function qipReasonLabel(r) {
  return r === 'already_queued' ? 'already in queue'
    : r === 'repeated_in_batch' ? 'repeated in this import'
    : r === 'unsupported_url' ? 'not a supported product page'
    : (r || '');
}

function qipRenderGroup(title, rows, opts = {}) {
  if (!rows.length) return '';
  const { checkable = false, open = true, cls = '' } = opts;
  const items = rows.map((row, i) => {
    const label = esc(row.title || row.url);
    const sub = esc(row.url);
    const reason = row.reason ? `<span class="qip-reason">${esc(qipReasonLabel(row.reason))}</span>` : '';
    const plat = `<span class="qip-plat">${esc(qipPlatformLabel(row.platform))}</span>`;
    const box = checkable ? `<input type="checkbox" class="qip-check" data-idx="${i}" checked>` : '';
    return `<label class="qip-row ${cls}">${box}<div class="qip-row-main"><div class="qip-row-title" title="${sub}">${label}</div><div class="qip-row-sub">${plat}${reason}</div></div></label>`;
  }).join('');
  return `<details class="qip-group ${cls}" ${open ? 'open' : ''}><summary>${esc(title)} <span class="qip-count">${rows.length}</span></summary>${items}</details>`;
}

function qipUpdateConfirm() {
  const n = document.querySelectorAll('#qipGroups .qip-check:checked').length;
  const btn = $('qipConfirmBtn');
  if (btn) { btn.textContent = `Add ${n} to queue`; btn.disabled = n === 0; }
}

function closeQueueImportPreview(result) {
  $('queueImportPreviewModal')?.classList.add('hidden');
  const r = QueueImportPreviewState.resolve;
  QueueImportPreviewState.resolve = null;
  if (r) r(result || { success: false, addedCount: 0, rejected: [] });
}

async function showQueueImportPreview(items, source = 'manual', opts = {}) {
  QueueImportPreviewState.previewAction = opts.previewAction || 'PREVIEW_BULK_QUEUE';
  QueueImportPreviewState.adder = typeof opts.adder === 'function' ? opts.adder : null;
  const payload = items.map(item => typeof item === 'string' ? { url: item, source } : { ...item, source: item.source || source });
  if (!payload.length) { toast('Nothing to import.', 'warn'); return { success: false, addedCount: 0, rejected: [] }; }
  const preview = await msg({ action: QueueImportPreviewState.previewAction, items: payload });
  if (!preview?.success) {
    toast(preview?.error || 'Could not check links.', 'err');
    return { success: false, addedCount: 0, rejected: [] };
  }
  const { accepted = [], duplicate = [], unsupported = [] } = preview;
  if (!accepted.length && !duplicate.length && !unsupported.length) {
    toast('Nothing to import.', 'warn');
    return { success: false, addedCount: 0, rejected: [] };
  }
  QueueImportPreviewState.accepted = accepted;
  QueueImportPreviewState.source = source;

  const parts = [];
  parts.push(`<b class="qip-ok">${accepted.length}</b> ready`);
  if (duplicate.length) parts.push(`<b class="qip-dup">${duplicate.length}</b> duplicate`);
  if (unsupported.length) parts.push(`<b class="qip-bad">${unsupported.length}</b> unsupported`);
  if ($('qipSummary')) $('qipSummary').innerHTML = parts.join(' <span class="qip-sep">·</span> ');

  if ($('qipGroups')) {
    $('qipGroups').innerHTML =
      qipRenderGroup('Ready to add', accepted, { checkable: true, open: true, cls: 'ok' }) +
      qipRenderGroup('Duplicates (skipped)', duplicate, { open: false, cls: 'dup' }) +
      qipRenderGroup('Unsupported (skipped)', unsupported, { open: false, cls: 'bad' }) ||
      '<div class="bulk-empty"><p>No supported product pages were found.</p></div>';
    $('qipGroups').querySelectorAll('.qip-check').forEach(cb => cb.addEventListener('change', qipUpdateConfirm));
  }
  qipUpdateConfirm();
  $('queueImportPreviewModal')?.classList.remove('hidden');
  return new Promise(resolve => { QueueImportPreviewState.resolve = resolve; });
}

async function confirmQueueImportPreview() {
  const checked = [...document.querySelectorAll('#qipGroups .qip-check:checked')]
    .map(cb => QueueImportPreviewState.accepted[Number(cb.dataset.idx)])
    .filter(Boolean)
    .map(row => ({ url: row.url, title: row.title || '', source: QueueImportPreviewState.source }));
  if (!checked.length) { closeQueueImportPreview(); return; }
  const btn = $('qipConfirmBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Adding…'; }
  const adder = QueueImportPreviewState.adder;
  if (!adder) { closeQueueImportPreview(); return; }
  const result = await adder(checked, QueueImportPreviewState.source);
  closeQueueImportPreview(result);
}

// ============================================================
// v7.6.1 — BULK HUNT MODULE
// All open tabs → checkbox select → parallel scrape → sheet + ZIP
// ============================================================

const PLATFORM_PATTERNS = {
  'walmart.com':              { name: 'Walmart',          tag: 'WMT' },
  'amazon.':                  { name: 'Amazon',           tag: 'AMZ' },
  'samsclub.com':             { name: "Sam's Club",       tag: "SAM" },
  'faire.com':                { name: 'Faire',            tag: 'FAR' },
  'aliexpress.':              { name: 'AliExpress',       tag: 'ALI' },
  'alibaba.com':              { name: 'Alibaba',          tag: 'ALB' },
  'temu.':                    { name: 'Temu',             tag: 'TMU' },
  'ebay.':                    { name: 'eBay',             tag: 'EBY' },
  'etsy.com':                 { name: 'Etsy',             tag: 'ETY' },
  'shein.com':                { name: 'Shein',            tag: 'SHN' },
  'daraz.':                   { name: 'Daraz',            tag: 'DRZ' },
  'worldwidegolfballs.com':   { name: 'WW Golf Balls',   tag: 'WGB' },
  'worldwidegolfshops.com':   { name: 'WW Golf Shops',   tag: 'WGS' }
};

function detectTabPlatform(url) {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.toLowerCase();
    for (const [pat, info] of Object.entries(PLATFORM_PATTERNS)) {
      if (host.includes(pat)) return info;
    }
  } catch (_) {
    // Fallback to broad URL substring matching if URL parsing fails
    const lower = url.toLowerCase();
    for (const [pat, info] of Object.entries(PLATFORM_PATTERNS)) {
      if (lower.includes(pat)) return info;
    }
  }
  return null;
}

const BulkState = {
  tabs:        [],   // [{tabId, url, title, platform}]
  selectedIds: new Set(),
  view:        'tabs', // 'queue' | 'tabs' | 'master'
  isHunting:   false,
  isPaused:    false,
  isCancelled: false,
  results:     [],   // [{tabId, status, data, error}]
  currentBatchId: null,
  huntStartTime:  null, // for live speed/ETA stats
  speedMode:   localStorage.getItem('zhunter_bulk_speed') || 'safe',
  targetFolder: 'General',

  // Tunables — balanced speed/reliability pipeline
  PARALLEL:    10,    // concurrent workers (14 starved slow SPAs of CPU and caused false timeouts)
  CHUNK_SIZE:  40,
  TAB_TIMEOUT: 8000,  // first SCRAPE_PAGE attempt; heavy pages need >4s to hydrate
  TAB_TIMEOUT_RETRY: 15000, // after a refresh the page starts cold, allow more
  ITEM_HARD_LIMIT: 90000,   // absolute cap per tab so one frozen tab can never wedge the hunt
  CHUNK_PAUSE: 200,
  MAX_RETRIES: 1,
  AUTO_CLOSE_TABS: true,
  consecutiveFailures: 0    // adaptive backoff when a site starts blocking us
};

function setBulkSpeedMode(mode) {
  BulkState.speedMode = mode === 'turbo' ? 'turbo' : 'safe';
  try { localStorage.setItem('zhunter_bulk_speed', BulkState.speedMode); } catch (_) {}
  document.querySelectorAll('.speed-pill-group').forEach(group => {
    group.querySelectorAll('.speed-pill').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.speed === BulkState.speedMode);
    });
  });
  if (BulkState.speedMode === 'turbo') {
    BulkState.PARALLEL = 12;
    BulkState.CHUNK_PAUSE = 100;
  } else {
    BulkState.PARALLEL = 5;
    BulkState.CHUNK_PAUSE = 800;
  }
  updateBulkSummary();
  updateQueueSummary();
}

function syncBulkFolderSelect() {
  const sel = $('bulkFolderSelect');
  if (!sel) return;
  const current = sel.value || BulkState.targetFolder || 'General';
  sel.innerHTML = '';
  const folders = Array.isArray(State.data?.folders) && State.data.folders.length ? State.data.folders : ['General'];
  folders.forEach(f => {
    const opt = document.createElement('option');
    opt.value = f;
    opt.textContent = f;
    if (f === current) opt.selected = true;
    sel.appendChild(opt);
  });
  BulkState.targetFolder = sel.value || 'General';
}

// Resolves when the hunt is not paused (or has been cancelled).
async function waitWhileBulkPaused() {
  while (BulkState.isPaused && !BulkState.isCancelled) await sleep(200);
}

// Wraps a scrape so a stuck tab (frozen renderer, hung dialog, never-ending
// load) is recorded as 'fail' instead of blocking the worker forever.
function withHardLimit(promise, ms, label) {
  let timer;
  const guard = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label || 'hard_timeout')), ms); });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

// Waits for a tab to finish loading. Returns the tab or null if it vanished.
async function waitForTabComplete(tabId, maxMs) {
  const deadline = Date.now() + maxMs;
  let tab = null;
  while (Date.now() < deadline && !BulkState.isCancelled) {
    tab = await new Promise(r => { try { chrome.tabs.get(tabId, t => r(chrome.runtime.lastError ? null : t)); } catch (_) { r(null); } });
    if (!tab || tab.status === 'complete') return tab;
    await sleep(250);
  }
  return tab;
}

const HUNT_STATE_KEY = 'zhunterHuntState'; // for auto-resume

const BULK_QUEUE_KEY = 'zhunterBulkQueue'; // persistent queue of URLs to hunt sequentially

const MASTER_KEY  = 'zhunterMasterSheet';
const BATCHES_KEY = 'zhunterMasterBatches';

// ── Init ─────────────────────────────────────────────────────
function initBulkTab() {
  // View switching and Open Tabs controls.
  $('bulkViewTabsBtn')?.addEventListener('click', () => switchBulkView('tabs'));
  $('bulkViewQueueBtn')?.addEventListener('click', () => switchBulkView('queue'));
  $('bulkViewMasterBtn')?.addEventListener('click', () => switchBulkView('master'));
  $('bulkRefreshTabsBtn')?.addEventListener('click', loadBulkTabs);
  $('bulkSelectAllBtn')?.addEventListener('click', () => toggleAllBulkTabs(true));
  $('bulkDeselectAllBtn')?.addEventListener('click', () => toggleAllBulkTabs(false));
  $('bulkResumeBtn')?.addEventListener('click', resumePendingHunt);
  $('bulkDiscardBtn')?.addEventListener('click', discardPendingHunt);
  $('bulkFailedToggle')?.addEventListener('click', toggleFailedList);
  $('bulkColumnsToggleBtn')?.addEventListener('click', toggleBulkColumnsPanel);
  $('bulkAddAllTabsToQueueBtn')?.addEventListener('click', async () => {
    await loadBulkTabs();
    const candidates = BulkState.tabs.filter(tab => tab.platform);
    toggleAllBulkTabs(true);
    if (!candidates.length) {
      toast('No supported product tabs found.', 'warn');
      return;
    }
    const result = await msg({
      action: 'ADD_BULK_QUEUE_ITEMS',
      items: candidates.map(tab => ({ url: tab.url, title: tab.title, platform: tab.platform.name }))
    });
    await loadBulkQueue();
    toast(`${result?.addedCount || 0} new open product tab(s) added to the queue; ${candidates.length} selected for this hunt.`, 'ok');
  });
  $('bulkAutoCloseToggle')?.addEventListener('change', e => {
    BulkState.AUTO_CLOSE_TABS = !!e.target.checked;
    msg({ action: 'UPDATE_SETTINGS', settings: { bulkAutoCloseTabs: BulkState.AUTO_CLOSE_TABS } }).catch(() => {});
  });
  // Restore the persisted preference.
  msg({ action: 'GET_DATA' }).then(d => {
    const v = d?.settings?.bulkAutoCloseTabs;
    if (v !== undefined) {
      BulkState.AUTO_CLOSE_TABS = v !== false;
      const chk = $('bulkAutoCloseToggle'); if (chk) chk.checked = BulkState.AUTO_CLOSE_TABS;
    }
  }).catch(() => {});
  $('bulkHuntStartBtn')?.addEventListener('click', () => startBulkHunt());

  // Master Sheet exports and actions.
  $('masterDlXlsxBtn')?.addEventListener('click', () => downloadMasterSheet('xlsx'));
  $('masterDlZipBtn')?.addEventListener('click', downloadLibraryZip);
  $('masterDlCsvBtn')?.addEventListener('click', () => downloadMasterSheet('csv'));
  $('masterDlHtmlBtn')?.addEventListener('click', () => downloadMasterSheet('html'));
  $('masterCopyTsvBtn')?.addEventListener('click', () => {
    if (typeof copyMasterSheetToClipboard === 'function') copyMasterSheetToClipboard();
    else toast('Clipboard export is not available in this build.', 'warn');
  });
  $('masterDlPdfBtn')?.addEventListener('click', () => downloadMasterSheet('pdf'));
  // v9: Research Workbook
  $('masterDlWorkbookBtn')?.addEventListener('click', () => {
    if (typeof ZHExport === 'undefined') { toast('Export engine not loaded', 'err'); return; }
    const data  = State.data || {};
    const rows  = data.links || [];
    if (!rows.length) { toast('No products to export', 'warn'); return; }
    const prefix = data.settings?.bulkFilenamePrefix || 'zhunter_';
    ZHExport.downloadResearchWorkbook(rows, [], prefix + 'research_workbook');
    toast(`Research Workbook downloaded (${rows.length} products)`, 'ok');
  });
  $('masterResetBtn')?.addEventListener('click', resetMasterSheet);
  $('masterImportBtn')?.addEventListener('click', () => $('masterImportFile')?.click());
  $('masterImportFile')?.addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (file) doImport(file);
    e.target.value = '';
  });
  $('masterSelectAllBtn')?.addEventListener('click', masterSelectAll);
  $('masterSelectFailedBtn')?.addEventListener('click', () => masterSelectByStatus('fail'));
  $('masterSelectPartialBtn')?.addEventListener('click', () => masterSelectByStatus('partial'));
  $('masterDeselectAllBtn')?.addEventListener('click', masterDeselectAll);
  $('masterBulkDeleteBtn')?.addEventListener('click', bulkDeleteMasterRows);
  $('masterBulkCancelBtn')?.addEventListener('click', masterDeselectAll);
  $('masterSearchInp')?.addEventListener('input', () => updateMasterStats());

  // Progress modal and result downloads.
  $('bulkPauseBtn')?.addEventListener('click', toggleBulkPause);
  $('bulkCancelBtn')?.addEventListener('click', cancelBulkHunt);
  $('bulkProgressCloseBtn')?.addEventListener('click', closeBulkProgressModal);
  $('bulkResultDoneBtn')?.addEventListener('click', closeBulkProgressModal);
  $('bulkDlXlsxBtn')?.addEventListener('click', () => downloadBatchSheet('xlsx'));
  $('bulkDlZipBtn')?.addEventListener('click', downloadBatchZip);
  $('bulkDlSeqBtn')?.addEventListener('click', downloadBatchSequential);
  $('bulkDlPdfBtn')?.addEventListener('click', () => downloadPdfCatalog(BulkState.results.filter(r => r.status !== 'fail'), 'Bulk Hunt Catalog'));

  // Queue view controls.
  $('queueAddBtn')?.addEventListener('click', onQueueAddUrl);
  $('queuePasteClipboardBtn')?.addEventListener('click', onQueuePasteClipboard);
  $('queueToggleListBtn')?.addEventListener('click', onQueueToggleList);
  $('queueImportFileBtn')?.addEventListener('click', () => $('queueFileInput')?.click());
  $('queueFileInput')?.addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (file) onQueueImportFile(file);
    e.target.value = '';
  });
  $('queueListTextarea')?.addEventListener('input', onQueueListInputChange);
  $('queueListClearBtn')?.addEventListener('click', onQueueListClear);
  $('queueListAddBtn')?.addEventListener('click', onQueueListAdd);
  $('queueAddInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') onQueueAddUrl(); });
  $('queueSelectAllBtn')?.addEventListener('click', () => toggleAllQueue(true));
  $('queueDeselectAllBtn')?.addEventListener('click', () => toggleAllQueue(false));
  $('queueClearDoneBtn')?.addEventListener('click', clearHuntedQueueItems);
  $('queueClearAllBtn')?.addEventListener('click', clearAllQueue);
  $('queueRetryProblemsBtn')?.addEventListener('click', retryProblemQueueItems);
  $('queueSearchInput')?.addEventListener('input', e => { QueueState.search = e.target.value || ''; renderBulkQueueList(); });
  $('queueStatusFilter')?.addEventListener('change', e => { QueueState.statusFilter = e.target.value || 'all'; renderBulkQueueList(); });
  $('bulkQueueHuntBtn')?.addEventListener('click', startQueueHunt);

  // Speed mode & folder controls
  document.querySelectorAll('.speed-pill-group .speed-pill').forEach(btn => {
    btn.addEventListener('click', () => setBulkSpeedMode(btn.dataset.speed));
  });
  $('bulkFolderSelect')?.addEventListener('change', e => {
    BulkState.targetFolder = e.target.value;
  });
  document.querySelectorAll('#queueStoreFilterBar .store-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#queueStoreFilterBar .store-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      QueueState.storeFilter = chip.dataset.store || 'all';
      renderBulkQueueList();
    });
  });
  setBulkSpeedMode(BulkState.speedMode);
  syncBulkFolderSelect();

  $('queueExportXlsxBtn')?.addEventListener('click', () => downloadBatchSheet('xlsx'));
  $('queueExportCsvBtn')?.addEventListener('click', downloadQueueCsv);
  $('queueExportHtmlBtn')?.addEventListener('click', downloadBatchHtmlCatalog);
  $('queueExportPdfBtn')?.addEventListener('click', downloadQueuePdf);
  $('queueExportZipBtn')?.addEventListener('click', downloadBatchZip);
  // v9: Research Workbook from queue
  $('queueExportWorkbookBtn')?.addEventListener('click', () => {
    if (typeof ZHExport === 'undefined') { toast('Export engine not loaded', 'err'); return; }
    const items    = (QueueState?.items || []);
    const done     = items.filter(i => i.hunted || i.status === 'complete');
    const failed   = items.filter(i => i.status === 'needs_retry' || i.status === 'error');
    const products = done.map(i => i.result || i).filter(Boolean);
    if (!products.length) { toast('No completed items to export', 'warn'); return; }
    ZHExport.downloadResearchWorkbook(products, failed, 'zhunter_queue_workbook');
    toast(`Research Workbook downloaded (${products.length} products)`, 'ok');
  });
  $('queueAutoCaptureToggle')?.addEventListener('change', e => msg({ action: 'GET_DATA' }).then(d => {
    const settings = d?.settings || {};
    settings.bulkQueueAutoCapture = e.target.checked;
    return msg({ action: 'UPDATE_SETTINGS', settings });
  }));

  chrome.runtime.onMessage.addListener(m => {
    if (m?.action === 'BULK_QUEUE_UPDATED') loadBulkQueue();
    if (m?.action === 'BULK_PRODUCT_QUEUE_UPDATED') updateMasterStats();
  });
  document.querySelector('[data-tab="bulk"]')?.addEventListener('click', () => {
    if (BulkState.view === 'tabs') loadBulkTabs();
    else if (BulkState.view === 'queue') loadBulkQueue();
    else updateMasterStats();
  });

  const closeToggle = $('bulkAutoCloseToggle');
  if (closeToggle) closeToggle.checked = BulkState.AUTO_CLOSE_TABS;
  switchBulkView('tabs');
  loadBulkQueue();
  updateQueueExportButtons();
  updateMasterStats();
  checkPendingHunt();
  msg({ action: 'GET_DATA' }).then(d => {
    const v = d?.settings?.bulkQueueAutoCapture;
    const chk = $('queueAutoCaptureToggle');
    if (chk) chk.checked = v === true;
  });
}

function switchBulkView(view = 'tabs') {
  BulkState.view = ['tabs', 'queue', 'master'].includes(view) ? view : 'tabs';
  $('bulkViewTabsBtn')?.classList.toggle('active', BulkState.view === 'tabs');
  $('bulkViewQueueBtn')?.classList.toggle('active', BulkState.view === 'queue');
  $('bulkViewMasterBtn')?.classList.toggle('active', BulkState.view === 'master');
  $('bulkTabsView')?.classList.toggle('active', BulkState.view === 'tabs');
  $('bulkQueueView')?.classList.toggle('active', BulkState.view === 'queue');
  $('bulkMasterView')?.classList.toggle('active', BulkState.view === 'master');
  if (BulkState.view === 'tabs') loadBulkTabs();
  if (BulkState.view === 'queue') loadBulkQueue();
  if (BulkState.view === 'master') updateMasterStats();
}

// ══════════════════════════════════════════════════════════════
// BULK QUEUE — persistent URL queue + sequential hunt
// ══════════════════════════════════════════════════════════════

const QueueState = { items: [], search: '', statusFilter: 'all', storeFilter: 'all' };

async function loadBulkQueue() {
  try {
    const res = await msg({ action: 'GET_BULK_QUEUE' });
    QueueState.items = Array.isArray(res?.queue) ? res.queue : [];
    renderBulkQueueList();
  } catch { toast('Failed to load queue', 'err'); }
}

function renderBulkQueueList() {
  const list = $('bulkQueueList');
  if (!list) return;
  const items = QueueState.items;
  const query = QueueState.search.trim().toLowerCase();
  const storeFilter = (QueueState.storeFilter || 'all').toLowerCase();
  const filtered = items.filter(item => {
    const status = item.status || (item.hunted ? 'complete' : 'queued');
    const matchesStatus = QueueState.statusFilter === 'all' || status === QueueState.statusFilter;
    const haystack = `${item.title || ''} ${item.url || ''} ${item.platform || ''}`.toLowerCase();
    let matchesStore = true;
    if (storeFilter !== 'all') {
      const plat = (typeof item.platform === 'string' ? item.platform : (item.platform?.name || '')).toLowerCase();
      const urlLower = (item.url || '').toLowerCase();
      if (storeFilter === 'other') {
        matchesStore = !['amazon', 'walmart', 'aliexpress', 'temu', 'ebay'].some(s => plat.includes(s) || urlLower.includes(s));
      } else {
        matchesStore = plat.includes(storeFilter) || urlLower.includes(storeFilter);
      }
    }
    return matchesStatus && matchesStore && (!query || haystack.includes(query));
  });
  if (items.length === 0 || filtered.length === 0) {
    list.innerHTML = items.length === 0
      ? `<div class="bulk-empty"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 9h6M9 12h6M9 15h4"/></svg><p>Queue is empty — browse product pages<br>or paste a URL above to add them.</p></div>`
      : `<div class="bulk-empty"><p>No queue items match the current filter.</p></div>`;
    updateQueueSummary();
    return;
  }
  list.innerHTML = '';
  filtered.forEach(item => {
    const isChecked = !!item.checked;
    const isHunted  = !!item.hunted;
    const status = item.status || (isHunted ? 'complete' : 'queued');
    const platLabel = item.platform
      ? `<span class="bulk-tab-platform">${esc(item.platform.substring(0,3).toUpperCase())}</span>`
      : `<span class="bulk-tab-platform unknown">?</span>`;
    const huntedBadge = isHunted ? `<span class="bulk-tab-dup-badge" title="Already hunted">✅</span>` : '';
    const shortUrl = (() => { try { const u = new URL(item.url); return u.hostname.replace(/^www\./, '') + u.pathname.slice(0,35); } catch { return item.url.slice(0,50); } })();
    const row = document.createElement('div');
    row.className = 'bulk-tab-row' + (isChecked ? ' checked' : '') + (isHunted ? ' duplicate' : '');
    row.dataset.queueId = item.id;
    const retryButton = (status === 'needs_retry' || status === 'error')
      ? `<button class="queue-retry-btn" data-id="${esc(item.id)}" title="Retry this product">&#8635; Retry</button>` : '';
    // Stage progress bar for active items
    const isActive = status === 'loading' || status === 'scraping' || status === 'processing' || status === 'retrying';
    const stagePct = status === 'loading' ? 25 : status === 'scraping' ? 55 : status === 'processing' ? 75 : status === 'retrying' ? 40 : 0;
    const stageBar = isActive
      ? `<div class="pq-stage-bar"><div class="pq-stage-fill" style="width:${stagePct}%"></div></div>`
      : '';
    // Stage label upgrade
    const stageLabel = status === 'loading' ? '&#x23F3; Loading page…'
      : status === 'scraping' ? '&#x1F50D; Scraping data…'
      : status === 'processing' ? '&#x2699;&#xFE0F; Processing…'
      : status === 'retrying' ? '&#x21BB; Retrying…'
      : status === 'needs_retry' ? '&#x26A0; Needs Retry'
      : status === 'error' ? '&#x26A0; Error'
      : status === 'complete' || isHunted ? '&#x2705; Done' : '&#x23F8; Queued';
    // Hero image (first image from scraped images if available)
    const heroImg = Array.isArray(item.images) && item.images.length
      ? `<img class="pq-hero-thumb" src="${esc(typeof item.images[0]==='string'?item.images[0]:item.images[0]?.url||'')}" alt="" data-onerror="hide">`
      : '';
    row.innerHTML = `<div class="bulk-tab-checkbox"></div>${platLabel}<div class="bulk-tab-info">${heroImg}<div class="bulk-tab-platform-lbl">${esc(item.title ? trunc(item.title,50) : shortUrl)}${huntedBadge}</div><div class="bulk-tab-title">${esc(shortUrl)}</div>${stageBar}<div class="pq-stage-label">${stageLabel}</div>${item.error && (status === 'needs_retry' || status === 'error') ? `<div class="pq-error-msg">&#9888; ${esc(item.error)}</div>` : ''}</div>${retryButton}<button class="queue-remove-btn" data-id="${esc(item.id)}" title="Remove from queue">&#10005;</button>`;
    row.addEventListener('click', e => {
      if (e.target.closest('.queue-remove-btn, .queue-retry-btn')) return;
      item.checked = !item.checked;
      saveBulkQueue();
      renderBulkQueueList();
    });
    row.querySelector('.queue-remove-btn').addEventListener('click', e => {
      e.stopPropagation();
      removeQueueItem(item.id);
    });
    row.querySelector('.queue-retry-btn')?.addEventListener('click', e => {
      e.stopPropagation();
      retrySingleQueueItem(item.id);
    });
    list.appendChild(row);
  });
  updateQueueSummary();
}

function updateQueueSummary() {
  const checked = QueueState.items.filter(i => i.checked && !i.hunted).length;
  const total   = QueueState.items.length;
  const cnt = $('bulkQueueCount');
  const eta = $('bulkQueueEta');
  const btn = $('bulkQueueHuntBtn');
  const done = QueueState.items.filter(i => i.hunted || i.status === 'complete').length;
  const failed = QueueState.items.filter(i => i.status === 'needs_retry' || i.status === 'error').length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  if (cnt) cnt.textContent = BulkState.isHunting
    ? `${done}/${total} done (${pct}%) · ${checked} selected · ${failed} failed`
    : `${total} queued · ${checked} selected${failed ? ' · ' + failed + ' failed' : ''}`;
  if (eta) {
    if (checked === 0) eta.textContent = '';
    else {
      const speedMultiplier = BulkState.speedMode === 'turbo' ? 2.5 : 7.0;
      const sec = Math.ceil(checked * speedMultiplier);
      const m = Math.floor(sec / 60), s = sec % 60;
      const speedTag = BulkState.speedMode === 'turbo' ? ' ⚡ Turbo' : ' 🛡️ Safe';
      eta.textContent = `~${m ? m + 'm ' : ''}${s}s est.${speedTag}`;
    }
  }
  if (btn) btn.disabled = (checked === 0 || BulkState.isHunting);
}

function saveBulkQueue() { msg({ action: 'UPDATE_BULK_QUEUE', queue: QueueState.items }).catch(() => {}); }

function removeQueueItem(id) {
  QueueState.items = QueueState.items.filter(i => i.id !== id);
  saveBulkQueue(); renderBulkQueueList();
}

function toggleAllQueue(selectAll) {
  QueueState.items.forEach(i => { i.checked = selectAll; });
  saveBulkQueue(); renderBulkQueueList();
}

function clearHuntedQueueItems() {
  QueueState.items = QueueState.items.filter(i => !i.hunted);
  saveBulkQueue(); renderBulkQueueList();
}

function clearAllQueue() {
  QueueState.items = []; saveBulkQueue(); renderBulkQueueList();
}

function retrySingleQueueItem(id) {
  const item = QueueState.items.find(entry => entry.id === id);
  if (!item) return;
  item.hunted = false;
  item.checked = true;
  item.status = 'queued';
  item.attempts = 0;
  item.error = '';
  saveBulkQueue();
  renderBulkQueueList();
  toast('Product queued for retry', 'ok');
}

function retryProblemQueueItems() {
  QueueState.items.forEach(item => {
    const status = item.status || (item.hunted ? 'complete' : 'queued');
    if (status === 'needs_retry' || status === 'error') {
      item.hunted = false;
      item.checked = true;
      item.status = 'queued';
      item.attempts = 0;
      item.error = '';
    }
  });
  saveBulkQueue();
  renderBulkQueueList();
}

async function addUrlsToBulkQueue(rawText, inputElement) {
  const text = (rawText || '').trim();
  if (!text) return;
  const urlRegex = /https?:\/\/[^\s,"'<>()]+/gi;
  let matches = text.match(urlRegex) || [];
  if (matches.length === 0) {
    try {
      const fixed = new URL(text.startsWith('http') ? text : 'https://' + text).href;
      matches = [fixed];
    } catch (_) {}
  }
  if (matches.length === 0) {
    toast('No valid product URLs found', 'err');
    return;
  }

  const uniqueUrls = [...new Set(matches.map(u => u.split('#')[0]))];
  let added = 0, duplicates = 0, errors = 0;

  for (const normUrl of uniqueUrls) {
    try {
      const platform = detectTabPlatform(normUrl);
      const res = await msg({ action: 'ADD_TO_BULK_QUEUE', url: normUrl, title: normUrl, platform: platform?.name || null });
      if (res?.success) added++;
      else if (res?.reason === 'duplicate') duplicates++;
      else errors++;
    } catch (_) {
      errors++;
    }
  }

  if (inputElement) inputElement.value = '';
  await loadBulkQueue();

  if (added > 0) {
    const dupMsg = duplicates > 0 ? ` (${duplicates} duplicates skipped)` : '';
    toast(`Added ${added} URL${added > 1 ? 's' : ''} to queue${dupMsg}`, 'ok');
  } else if (duplicates > 0) {
    toast(`${duplicates} URL${duplicates > 1 ? 's' : ''} already in queue`, 'warn');
  } else {
    toast('Failed to add URLs', 'err');
  }
}

function onQueueAddUrl() {
  const input = $('queueAddInput');
  addUrlsToBulkQueue(input?.value, input);
}

async function onQueuePasteClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    if (!text || !text.trim()) {
      toast('Clipboard is empty', 'warn');
      return;
    }
    const input = $('queueAddInput');
    await addUrlsToBulkQueue(text, input);
  } catch (err) {
    toast('Clipboard access unavailable or empty', 'err');
  }
}

function onQueueToggleList() {
  const box = $('queueListContainer');
  if (!box) return;
  const isHidden = box.classList.toggle('hidden');
  const btn = $('queueToggleListBtn');
  if (btn) btn.classList.toggle('active', !isHidden);
  if (!isHidden) {
    $('queueListTextarea')?.focus();
    onQueueListInputChange();
  }
}

function onQueueListInputChange() {
  const text = $('queueListTextarea')?.value || '';
  const urlRegex = /https?:\/\/[^\s,"'<>()]+/gi;
  const matches = text.match(urlRegex) || [];
  const uniqueUrls = [...new Set(matches.map(u => u.split('#')[0]))];
  const count = uniqueUrls.length;
  const counter = $('queueListCounter');
  if (counter) counter.textContent = count === 1 ? '1 link detected' : `${count} links detected`;
  const addBtn = $('queueListAddBtn');
  if (addBtn) {
    addBtn.disabled = count === 0;
    addBtn.textContent = count > 0 ? `Add ${count} Link${count > 1 ? 's' : ''}` : 'Add to Queue';
  }
}

async function onQueueListAdd() {
  const textarea = $('queueListTextarea');
  const text = textarea?.value || '';
  if (!text.trim()) return;
  await addUrlsToBulkQueue(text, textarea);
  $('queueListContainer')?.classList.add('hidden');
  $('queueToggleListBtn')?.classList.remove('active');
  onQueueListInputChange();
}

function onQueueListClear() {
  const textarea = $('queueListTextarea');
  if (textarea) textarea.value = '';
  onQueueListInputChange();
}

function onQueueImportFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    const content = e.target?.result;
    if (typeof content === 'string' && content.trim()) {
      await addUrlsToBulkQueue(content);
    } else {
      toast('File is empty or could not be read', 'warn');
    }
  };
  reader.onerror = () => toast('Error reading file', 'err');
  reader.readAsText(file);
}

// ── Sequential queue hunt — one reusable inactive worker tab
let queueWorkerTabId = null;

async function ensureQueueWorkerTab() {
  if (queueWorkerTabId) {
    try {
      const existing = await new Promise(resolve => chrome.tabs.get(queueWorkerTabId, tab => resolve(chrome.runtime.lastError ? null : tab)));
      if (existing?.id) return existing;
    } catch (_) {}
  }
  const created = await chrome.tabs.create({ url: 'about:blank', active: false });
  queueWorkerTabId = created.id;
  return created;
}

async function closeQueueWorkerTab() {
  const id = queueWorkerTabId;
  queueWorkerTabId = null;
  if (!id) return;
  try { await chrome.tabs.remove(id); } catch (_) {}
}

async function waitForQueueTabReady(tabId, timeoutMs = 60000, targetUrl = '') {
  const deadline = Date.now() + timeoutMs;
  const targetHost = safeHost(targetUrl);
  // Right after tabs.update() the tab still reports the PREVIOUS page as
  // status:'complete'. Returning immediately scraped the wrong product, so we
  // first wait for navigation to start (status 'loading' or URL change).
  let sawNavigation = false;
  const navDeadline = Date.now() + 4000;
  while (Date.now() < deadline && !BulkState.isCancelled) {
    let tab = null;
    try { tab = await new Promise(resolve => chrome.tabs.get(tabId, t => resolve(chrome.runtime.lastError ? null : t))); }
    catch (_) { return false; }
    if (!tab) return false;
    const onTarget = !targetHost || safeHost(tab.url || tab.pendingUrl || '') === targetHost;
    if (!sawNavigation) {
      if (tab.status === 'loading' || (onTarget && tab.url && tab.url !== 'about:blank')) sawNavigation = true;
      else if (Date.now() > navDeadline) sawNavigation = true; // give up waiting for the loading signal
    }
    if (sawNavigation && tab.status === 'complete' && onTarget) {
      await sleep(400); // let late-hydrating SPAs paint before we inject
      return true;
    }
    await sleep(250);
  }
  return false;
}

async function sendQueueScrape(tabId) {
  return await new Promise(resolve => {
    let done = false;
    const finish = value => { if (!done) { done = true; clearTimeout(timer); resolve(value); } };
    const timer = setTimeout(() => finish(null), 30000);
    try {
      chrome.tabs.sendMessage(tabId, { action: 'SCRAPE_PAGE' }, response => {
        if (chrome.runtime.lastError || !response?.success || !response?.data) finish(null);
        else finish(response.data);
      });
    } catch (_) { finish(null); }
  });
}

async function scrapeQueueItem(queueItem, workerTabId) {
  const fakeId = queueItem.id;
  setBulkRowStatus(fakeId, 'active');
  if (BulkState.isCancelled) { setBulkRowStatus(fakeId, 'fail'); return; }

  let scraped = null;
  let errorCode = '';
  try {
    await chrome.tabs.update(workerTabId, { url: queueItem.url, active: false });
    setBulkRowMeta(fakeId, 'Loading in background…');
    const ready = await waitForQueueTabReady(workerTabId, 60000, queueItem.url);
    if (!ready) throw new Error(BulkState.isCancelled ? 'cancelled' : 'page_timeout');

    // Two attempts: the second one re-injects and nudges lazy SPAs to hydrate.
    for (let attempt = 1; attempt <= 2 && !scraped; attempt++) {
      await waitWhileBulkPaused();
      if (BulkState.isCancelled) throw new Error('cancelled');
      setBulkRowMeta(fakeId, attempt === 1 ? 'Injecting…' : 'Retrying…');
      try { await chrome.scripting.executeScript({ target: { tabId: workerTabId }, files: ['content.js'] }); }
      catch (_) { /* The script may already be present after navigation. */ }
      if (attempt === 2) {
        try {
          await chrome.scripting.executeScript({ target: { tabId: workerTabId }, func: () => {
            window.scrollTo(0, Math.min(1200, document.body.scrollHeight));
            window.dispatchEvent(new Event('scroll')); window.dispatchEvent(new Event('resize'));
          } });
        } catch (_) {}
        await sleep(BulkState.speedMode === 'turbo' ? 400 : 1500);
      } else {
        await sleep(BulkState.speedMode === 'turbo' ? 150 : 500);
      }
      setBulkRowMeta(fakeId, 'Scraping…');
      scraped = await sendQueueScrape(workerTabId);
    }
    if (!scraped) throw new Error('no_response');

    // Same integrity check as tab hunts: the worker might have been redirected
    // (login wall, bot check, region redirect) — never store the wrong product.
    const expectedHost = safeHost(queueItem.url), scrapedHost = safeHost(scraped.url);
    if (expectedHost && scrapedHost && expectedHost !== scrapedHost) { scraped = null; throw new Error('url_mismatch'); }
  } catch (error) {
    errorCode = error?.message || 'queue_worker_error';
  }

  if (!scraped && errorCode !== 'cancelled') BulkState.consecutiveFailures++; else BulkState.consecutiveFailures = 0;

  const status = !scraped
    ? 'fail'
    : (!scraped.title && (!scraped.images || !scraped.images.length) && !scraped.price) ? 'partial' : 'ok';
  const resultItem = {
    tabId: fakeId,
    url: scraped?.url || queueItem.url,
    title: scraped?.title || queueItem.title || queueItem.url,
    price: scraped?.price || '',
    platform: typeof queueItem.platform === 'string' ? queueItem.platform : (queueItem.platform?.name || 'Other'),
    images: scraped?.images || [], imagesBase64: [],
    videos: scraped?.videos || [], variants: scraped?.variants || [],
    description: scraped?.description || '',
    status,
    error: status === 'fail' ? (errorCode || 'no_response') : '',
    scrapedAt: new Date().toISOString()
  };
  BulkState.results.push(resultItem);
  if (status !== 'fail') BulkState.pendingFlush.push(resultItem);

  const qi = QueueState.items.find(i => i.id === fakeId);
  if (qi) {
    qi.hunted = status !== 'fail';
    qi.status = status === 'fail' ? 'needs_retry' : 'complete';
    qi.error = resultItem.error;
    qi.attempts = Number(qi.attempts || 0) + 1;
  }
  setBulkRowStatus(fakeId, status, { images: Array.isArray(resultItem.images) ? resultItem.images.length : 0, error: resultItem.error });
  updateBulkProgressBar();
}

async function processQueueSequential(items) {
  let worker = null;
  try {
    worker = await ensureQueueWorkerTab();
    for (const item of items) {
      await waitWhileBulkPaused();
      if (BulkState.isCancelled) break;
      worker = await ensureQueueWorkerTab();
      try {
        await withHardLimit(scrapeQueueItem(item, worker.id), BulkState.ITEM_HARD_LIMIT || 90000, 'hard_timeout');
      } catch (_) {
        // The worker tab is wedged — record the failure and replace the tab.
        setBulkRowStatus(item.id, 'fail', { error: 'hard_timeout' });
        const qi = QueueState.items.find(i => i.id === item.id);
        if (qi) { qi.status = 'needs_retry'; qi.error = 'hard_timeout'; qi.attempts = Number(qi.attempts || 0) + 1; }
        BulkState.consecutiveFailures++;
        await closeQueueWorkerTab();
      }
      // Cooldown grows when a site starts rejecting us; resets after a success.
      const baseCooldown = BulkState.speedMode === 'turbo' ? 150 : 500;
      const cooldown = BulkState.consecutiveFailures >= 3 ? Math.min(10000, 1500 * BulkState.consecutiveFailures) : baseCooldown;
      if (!BulkState.isCancelled) await sleep(cooldown);
    }
  } finally {
    await closeQueueWorkerTab();
  }
}

function queueResultRows() {
  return BulkState.results
    .filter(result => result.status !== 'fail')
    .sort((a, b) => (a.originalIndex ?? 0) - (b.originalIndex ?? 0));
}

function updateQueueExportButtons() {
  const enabled = queueResultRows().length > 0;
  for (const id of ['queueExportXlsxBtn', 'queueExportCsvBtn', 'queueExportHtmlBtn', 'queueExportPdfBtn', 'queueExportZipBtn']) {
    const button = $(id);
    if (button) button.disabled = !enabled;
  }
}

function downloadQueueCsv() {
  const rows = queueResultRows();
  if (!rows.length) { toast('No completed queue results to export.', 'warn'); return; }
  downloadCsvRich(buildRichSheetData(rows), buildFilename('csv', '_queue'));
  toast(`Downloaded queue CSV (${rows.length} products)`, 'ok');
}

function downloadQueuePdf() {
  const rows = queueResultRows();
  if (!rows.length) { toast('No completed queue results to export.', 'warn'); return; }
  downloadPdfCatalog(rows, 'Queue Hunt Catalog');
}

async function startQueueHunt() {
  if (BulkState.isHunting) return;
  const toHunt = QueueState.items.filter(i => i.checked && !i.hunted);
  if (toHunt.length === 0) { toast('No items selected in queue', 'warn'); return; }
  BulkState.isHunting = true; BulkState.isPaused = false; BulkState.isCancelled = false; BulkState.consecutiveFailures = 0;
  { const cb = $('bulkCancelBtn'); if (cb) { cb.disabled = false; cb.textContent = 'Cancel'; } const pb = $('bulkPauseBtn'); if (pb) { pb.disabled = false; pb.textContent = 'Pause'; } }
  BulkState.results = []; BulkState.pendingFlush = []; BulkState._flushActive = false;
  BulkState.currentBatchId = `queue_${Date.now()}`; BulkState.huntStartTime = Date.now();
  BulkState.selectedIds = new Set(toHunt.map(i => i.id));
  const fakeTabs = toHunt.map(i => ({ tabId: i.id, url: i.url, title: i.title || i.url,
    platform: typeof i.platform === 'string' ? { name: i.platform, tag: i.platform.substring(0,3).toUpperCase() } : (i.platform ? { name: i.platform, tag: String(i.platform).substring(0,3).toUpperCase() } : null) }));
  openBulkProgressModal(fakeTabs);
  $('bulkQueueHuntBtn').disabled = true;
  await savePendingHunt(fakeTabs);
  msg({ action: 'START_KEEPALIVE' }).catch(() => {});
  const flushLoop = async () => {
    BulkState._flushActive = true;
    while (BulkState.isHunting || BulkState.pendingFlush.length > 0) {
      if (BulkState.pendingFlush.length > 0) { const rows = BulkState.pendingFlush.splice(0, 50); await appendToMasterSheet(rows); }
      else await sleep(500);
    }
    BulkState._flushActive = false;
  };
  flushLoop();
  try {
    updateBulkProgressTitle(`🚀 Processing ${toHunt.length} queued items…`);
    await processQueueSequential(toHunt);
    if (!BulkState.isCancelled) await imageDownloadPhase();
  } catch (e) { toast('Queue hunt error: ' + (e?.message || 'unknown'), 'err'); }
  BulkState.isHunting = false;
  const flushDeadline = Date.now() + 10000;
  while (BulkState._flushActive && Date.now() < flushDeadline) await sleep(100);
  BulkState._flushActive = false;
  saveBulkQueue();
  await clearPendingHunt();
  finishBulkHunt();
  updateQueueExportButtons();
  loadBulkQueue();
}


// ── Tab list loading ────────────────────────────────────────
async function loadBulkTabs() {
  try {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const masterRows = await getMasterRows();
    const masterUrls = new Set(masterRows.map(r => (r.url || '').toLowerCase()));

    BulkState.tabs = tabs
      .filter(t => t.url && /^https?:/.test(t.url))
      .map(t => ({
        tabId:      t.id,
        url:        t.url,
        title:      t.title || t.url,
        platform:   detectTabPlatform(t.url),
        isDuplicate: masterUrls.has((t.url || '').toLowerCase())
      }));

    // Pre-select all product-detected tabs (skip duplicates if setting is on)
    const skipDup = State.data?.settings?.autoSkipDuplicates !== false;
    BulkState.selectedIds = new Set(
      BulkState.tabs
        .filter(t => t.platform && (!skipDup || !t.isDuplicate))
        .map(t => t.tabId)
    );
    renderBulkTabsList();
  } catch (e) {
    toast('Failed to load tabs', 'err');
  }
}

function renderBulkTabsList() {
  const list = $('bulkTabsList');
  if (!list) return;

  if (BulkState.tabs.length === 0) {
    list.innerHTML = `
      <div class="bulk-empty">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
        <p>No web tabs in this window</p>
      </div>`;
    updateBulkSummary();
    return;
  }

  // Banner: live count of product tabs; hint when none are product pages.
  const productTabs = BulkState.tabs.filter(t => t.platform).length;
  const sub = document.querySelector('#tab-bulk .section-banner-sub');
  if (sub) sub.textContent = productTabs
    ? `${productTabs} product tab${productTabs !== 1 ? 's' : ''} open → one sheet + ZIP`
    : `${BulkState.tabs.length} tab${BulkState.tabs.length !== 1 ? 's' : ''} open, none are product pages`;

  list.innerHTML = '';
  if (!productTabs) {
    list.insertAdjacentHTML('afterbegin', '<div class="notice" style="margin:8px"><span>Open product pages (Amazon, Walmart, Sam\'s Club, Alibaba…) in this window, then press Refresh.</span></div>');
  }
  BulkState.tabs.forEach(t => {
    const isProduct = !!t.platform;
    const isChecked = BulkState.selectedIds.has(t.tabId);
    const isDup     = !!t.isDuplicate;
    const row = document.createElement('div');
    row.className = 'bulk-tab-row'
      + (isChecked ? ' checked' : '')
      + (!isProduct ? ' disabled' : '')
      + (isDup ? ' duplicate' : '');
    row.dataset.tabId = t.tabId;
    if (isDup) row.title = 'Already in Master Sheet — re-saving will create a duplicate row';

    const platformLbl = isProduct
      ? `<span class="bulk-tab-platform">${esc(t.platform.tag)}</span>`
      : `<span class="bulk-tab-platform unknown">?</span>`;

    const platformName = isProduct ? esc(t.platform.name) : 'Other';
    const titleText = esc(trunc(t.title, 80));
    const dupBadge = isDup ? `<span class="bulk-tab-dup-badge" title="Already in Master Sheet">🔁</span>` : '';

    row.innerHTML = `
      <div class="bulk-tab-checkbox"></div>
      ${platformLbl}
      <div class="bulk-tab-info">
        <div class="bulk-tab-platform-lbl">${platformName}${dupBadge}</div>
        <div class="bulk-tab-title">${titleText}</div>
      </div>`;

    row.addEventListener('click', () => {
      if (!isProduct && !BulkState.selectedIds.has(t.tabId)) {
        BulkState.selectedIds.add(t.tabId);
      } else if (BulkState.selectedIds.has(t.tabId)) {
        BulkState.selectedIds.delete(t.tabId);
      } else {
        BulkState.selectedIds.add(t.tabId);
      }
      renderBulkTabsList();
    });

    list.appendChild(row);
  });
  updateBulkSummary();
}

function toggleAllBulkTabs(selectAll) {
  if (selectAll) {
    BulkState.selectedIds = new Set(
      BulkState.tabs.filter(t => t.platform).map(t => t.tabId)
    );
  } else {
    BulkState.selectedIds = new Set();
  }
  renderBulkTabsList();
}

function updateBulkSummary() {
  const n = BulkState.selectedIds.size;
  const cnt = $('bulkSelectedCount');
  const eta = $('bulkTimeEstimate');
  if (cnt) cnt.textContent = n + (n === 1 ? ' tab selected' : ' tabs selected');
  if (eta) {
    if (n === 0) eta.textContent = '';
    else {
      const speedMultiplier = BulkState.speedMode === 'turbo' ? 1.0 : 2.5;
      const chunks = Math.ceil(n / BulkState.CHUNK_SIZE);
      const sec = Math.ceil((n * speedMultiplier) / BulkState.PARALLEL) + (chunks - 1) * Math.ceil(BulkState.CHUNK_PAUSE / 1000);
      const m = Math.floor(sec / 60), s = sec % 60;
      const speedTag = BulkState.speedMode === 'turbo' ? ' ⚡ Turbo' : ' 🛡️ Safe';
      eta.textContent = '~' + (m ? m + 'm ' : '') + s + 's estimated' + speedTag;
    }
  }
  const btn = $('bulkHuntStartBtn');
  if (btn) btn.disabled = (n === 0 || BulkState.isHunting);
}

// ── Bulk Hunt main pipeline ─────────────────────────────────
async function startBulkHunt(tabsOverride) {
  if (BulkState.isHunting) return;
  if (!tabsOverride && BulkState.selectedIds.size === 0) return;

  if (BulkState.speedMode === 'turbo') {
    BulkState.PARALLEL = 12;
    BulkState.CHUNK_PAUSE = 100;
  } else {
    BulkState.PARALLEL = 5;
    BulkState.CHUNK_PAUSE = 800;
  }

  BulkState.isHunting   = true;
  BulkState.isPaused    = false;
  BulkState.isCancelled = false;
  BulkState.results     = [];
  BulkState.pendingFlush = [];
  BulkState._flushActive = false;
  BulkState.currentBatchId = `batch_${Date.now()}`;
  BulkState.huntStartTime  = Date.now();

  const selectedTabs = (Array.isArray(tabsOverride) ? tabsOverride : null)
    || BulkState.tabs.filter(t => BulkState.selectedIds.has(t.tabId));
  // ── Stamp each tab with its original position NOW, before parallel execution
  // reorders them. This index is carried through to the result and used to
  // sort both the sheet rows and the ZIP folders so they always match.
  selectedTabs.forEach((t, i) => { t.originalIndex = i; });

  openBulkProgressModal(selectedTabs);
  updateBulkSummary();

  // Save hunt state for auto-resume
  await savePendingHunt(selectedTabs);

  // Keep the MV3 service worker alive for the duration of the bulk hunt
  // (it terminates after ~30s of inactivity otherwise, aborting all FETCH_BASE64 calls)
  msg({ action: 'START_KEEPALIVE' }).catch(() => {});

  const flushLoop = async () => {
    BulkState._flushActive = true;
    while (BulkState.isHunting || BulkState.pendingFlush.length > 0) {
      if (BulkState.pendingFlush.length > 0) {
        const rows = BulkState.pendingFlush.splice(0, 50);
        await appendToMasterSheet(rows);
      } else {
        // Only sleep when nothing to flush — exits promptly when hunt ends
        await sleep(500);
      }
    }
    BulkState._flushActive = false;
  };
  flushLoop();

  try {
    updateBulkProgressTitle(`🔄 Processing ${selectedTabs.length} tabs…`);
    await processSmartQueue(selectedTabs); // Phase 1: scrape all tabs

    // Phase 2: download images after all tabs scraped
    if (!BulkState.isCancelled) {
      await imageDownloadPhase();
    }
  } catch (e) {
    toast('Bulk hunt error: ' + (e?.message || 'unknown'), 'err');
  }

  BulkState.isHunting = false;
  // Wait for flush loop to finish — 10s safety timeout so we never hang
  const flushDeadline = Date.now() + 10000;
  while (BulkState._flushActive && Date.now() < flushDeadline) await sleep(100);
  BulkState._flushActive = false; // force-clear in case of timeout

  await clearPendingHunt();
  finishBulkHunt();
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ── Auto-Resume: Save / Clear / Check pending hunt ────────────
async function savePendingHunt(tabs) {
  const state = {
    tabs: tabs.map(t => ({ tabId: t.tabId, url: t.url, title: t.title, platform: t.platform })),
    savedAt: Date.now()
  };
  chrome.storage.local.set({ [HUNT_STATE_KEY]: state });
}

async function clearPendingHunt() {
  chrome.storage.local.remove(HUNT_STATE_KEY);
  $('bulkResumeBar')?.classList.add('hidden');
}

async function checkPendingHunt() {
  chrome.storage.local.get(HUNT_STATE_KEY, (res) => {
    const state = res[HUNT_STATE_KEY];
    if (!state || !state.tabs || !state.tabs.length) return;
    const ageMs = Date.now() - (state.savedAt || 0);
    if (ageMs > 3 * 24 * 60 * 60 * 1000) { // keep an unfinished hunt for 3 days
      chrome.storage.local.remove(HUNT_STATE_KEY);
      return;
    }
    const n = state.tabs.length;
    const bar = $('bulkResumeBar');
    const msg2 = $('bulkResumeMsg');
    if (bar) bar.classList.remove('hidden');
    if (msg2) msg2.textContent = `Unfinished hunt — ${n} tab${n !== 1 ? 's' : ''} remaining`;
    BulkState._pendingResumeTabs = state.tabs;
  });
}

async function resumePendingHunt() {
  const saved = BulkState._pendingResumeTabs;
  if (!saved || !saved.length) return;
  $('bulkResumeBar')?.classList.add('hidden');
  BulkState._pendingResumeTabs = null;

  // After a browser restart the old tab ids are gone. Reuse a tab only if it
  // still exists and still shows the same URL; otherwise reopen the URL in a
  // background tab and wait for it to load before hunting.
  const sameUrl = (a, b) => { try { const x = new URL(a), y = new URL(b); return x.host === y.host && x.pathname === y.pathname; } catch { return a === b; } };
  const waitLoaded = tabId => new Promise(resolve => {
    const started = Date.now();
    const tick = () => chrome.tabs.get(tabId, t => {
      if (chrome.runtime.lastError || !t) return resolve(false);
      if (t.status === 'complete' || Date.now() - started > 20000) return resolve(true);
      setTimeout(tick, 400);
    });
    tick();
  });
  const tabs = [];
  let reopened = 0;
  for (const t of saved) {
    let live = null;
    // Queue hunts store string ids ("q_...") — chrome.tabs.get throws on those.
    if (Number.isInteger(t.tabId)) live = await new Promise(r => { try { chrome.tabs.get(t.tabId, x => r(chrome.runtime.lastError ? null : x)); } catch (_) { r(null); } });
    if (live && live.url && sameUrl(live.url, t.url)) { tabs.push({ ...t, tabId: live.id }); continue; }
    try {
      const created = await chrome.tabs.create({ url: t.url, active: false });
      reopened++;
      await waitLoaded(created.id);
      tabs.push({ ...t, tabId: created.id });
    } catch (_) { /* skip tabs that cannot be reopened */ }
  }
  if (!tabs.length) { toast('Could not reopen the remaining tabs.', 'err'); return; }
  if (reopened) toast(`Reopened ${reopened} tab${reopened !== 1 ? 's' : ''} — resuming hunt`, 'ok');
  await startBulkHunt(tabs);
}

async function discardPendingHunt() {
  await clearPendingHunt();
  BulkState._pendingResumeTabs = null;
}

function toggleFailedList() {
  const list = $('bulkFailedList');
  const btn  = $('bulkFailedToggle');
  if (!list || !btn) return;
  const hidden = list.classList.toggle('hidden');
  btn.textContent = (hidden ? '▶' : '▼') + ' ' + (hidden ? 'Show' : 'Hide') + ' failed tabs';
}

async function processSmartQueue(tabs) {
  const activeDomains = {};
  const running = new Set();
  const MAX_GLOBAL = BulkState.PARALLEL || 8;
  const MAX_PER_DOMAIN = 3;

  // Returns true if there are any tabs not yet started
  const hasUnstarted = () => tabs.some(t => !t._started);

  while (hasUnstarted() || running.size > 0) {
    if (BulkState.isCancelled) break;
    while (BulkState.isPaused && !BulkState.isCancelled) await sleep(300);

    // Fill up to MAX_GLOBAL slots with eligible tabs
    let startedAny = true;
    while (startedAny && running.size < MAX_GLOBAL && hasUnstarted()) {
      startedAny = false;
      for (let i = 0; i < tabs.length; i++) {
        if (tabs[i]._started) continue;
        if (running.size >= MAX_GLOBAL) break;
        const host = safeHost(tabs[i].url);
        if ((activeDomains[host] || 0) >= MAX_PER_DOMAIN) continue;

        const tab = tabs[i];
        tab._started = true;
        activeDomains[host] = (activeDomains[host] || 0) + 1;
        startedAny = true;

        const p = (async () => {
          try {
            await waitWhileBulkPaused();
            // Adaptive backoff: if several tabs in a row fail the site is likely
            // throttling us — slow down instead of burning the whole batch.
            if (BulkState.consecutiveFailures >= 3 && !BulkState.isCancelled) {
              const backoff = Math.min(8000, 1000 * (BulkState.consecutiveFailures - 2));
              setBulkRowMeta(tab.tabId, `Backing off ${Math.round(backoff / 1000)}s…`);
              await sleep(backoff);
            }
            await runScrapeGuarded(tab);
            // _done is set in finally — marking it here dropped the tab from the
            // resume snapshot while retries were still running.
            if (!BulkState.isCancelled) {
              for (let attempt = 2; attempt <= BulkState.MAX_RETRIES + 1; attempt++) {
                if (BulkState.isCancelled) break;

                // Small delay so scrapeOneTab can push its result before we check
                await sleep(100);

                let lastResIndex = -1;
                for (let j = BulkState.results.length - 1; j >= 0; j--) {
                  if (BulkState.results[j].tabId === tab.tabId) { lastResIndex = j; break; }
                }
                if (lastResIndex === -1) break;
                const res = BulkState.results[lastResIndex];
                if (res.status !== 'fail' && res.status !== 'partial') break;

                // Do not retry errors that a retry cannot fix.
                if (['tab_closed', 'url_mismatch', 'tab_navigated', 'product_mismatch', 'cancelled'].includes(res.error)) break;

                BulkState.results.splice(lastResIndex, 1);
                await waitWhileBulkPaused();
                if (BulkState.isCancelled) break;
                setBulkRowMeta(tab.tabId, `Retry ${attempt}/${BulkState.MAX_RETRIES + 1}…`);

                try {
                  const td = await new Promise(r => chrome.tabs.get(tab.tabId, t => r(chrome.runtime.lastError ? null : t)));
                  if (!td) break; // tab gone — nothing to retry
                  if (td.discarded || td.status !== 'complete') {
                    chrome.tabs.reload(tab.tabId, {}, () => { void chrome.runtime.lastError; });
                    await waitForTabComplete(tab.tabId, 20000);
                    await sleep(300);
                  }
                } catch (_) {}

                try {
                  await chrome.scripting.executeScript({ target: { tabId: tab.tabId }, files: ['content.js'] });
                  await sleep(300);
                } catch (_) {}

                if (!BulkState.isCancelled) await runScrapeGuarded(tab);
              }
            }

            // ── Auto-close tab after successful scrape ──
            if (BulkState.AUTO_CLOSE_TABS && !BulkState.isCancelled) {
              const finalRes = BulkState.results.find(r => r.tabId === tab.tabId);
              if (finalRes && finalRes.status === 'ok') {
                try {
                  chrome.tabs.remove(tab.tabId, () => { void chrome.runtime.lastError; });
                } catch (_) {}
              }
            }
          } finally {
            tab._done = true;
            activeDomains[host]--;
            running.delete(p);
          }
        })();

        running.add(p);
      }
    }

    if (running.size > 0) {
      // Wait for at least one worker to finish before re-filling slots
      await Promise.race(running);
      // Persist what is still left so a browser close/crash can resume from here.
      const remaining = tabs.filter(t => !t._done);
      if (remaining.length) savePendingHunt(remaining); else clearPendingHunt();
    } else if (hasUnstarted()) {
      // All slots blocked by domain limits but tabs remain — wait briefly and retry
      await sleep(200);
    } else {
      break; // truly done
    }
    await sleep(50);
  }
}

// Runs scrapeOneTab under an absolute time cap and tracks the failure streak
// used for adaptive backoff. Guarantees a result row exists for the tab.
async function runScrapeGuarded(tabInfo) {
  try {
    await withHardLimit(scrapeOneTab(tabInfo), BulkState.ITEM_HARD_LIMIT || 90000, 'hard_timeout');
  } catch (e) {
    const code = e?.message || 'hard_timeout';
    const already = BulkState.results.some(r => r.tabId === tabInfo.tabId);
    if (!already) {
      BulkState.results.push({
        tabId: tabInfo.tabId, url: tabInfo.url, title: tabInfo.title || '', price: '',
        platform: tabInfo.platform?.name || 'Other', images: [], imagesBase64: [], videos: [], variants: [],
        status: 'fail', error: code, scrapedAt: new Date().toISOString()
      });
    }
    setBulkRowStatus(tabInfo.tabId, 'fail', { error: code });
  }
  const last = [...BulkState.results].reverse().find(r => r.tabId === tabInfo.tabId);
  if (last && last.status === 'fail' && last.error !== 'cancelled') BulkState.consecutiveFailures++;
  else BulkState.consecutiveFailures = 0;
}

async function scrapeOneTab(tabInfo) {
  setBulkRowStatus(tabInfo.tabId, 'active');

  let scraped = null;
  let error = null;

  // Early exit if cancelled
  if (BulkState.isCancelled) { setBulkRowStatus(tabInfo.tabId, 'fail'); return; }

  try {
    // ── Wait for tab to load / Wake discarded tabs ──
    let tabDetails = await new Promise(resolve => chrome.tabs.get(tabInfo.tabId, t => resolve(chrome.runtime.lastError ? null : t)));
    if (tabDetails) {
      if (tabDetails.discarded) {
        setBulkRowMeta(tabInfo.tabId, 'Waking tab…');
        chrome.tabs.reload(tabInfo.tabId, {}, () => { void chrome.runtime.lastError; });
      }
      if (tabDetails.discarded || tabDetails.status !== 'complete') {
        // A discarded tab reloads from scratch — 2s was far too short and produced
        // 'no_response' on perfectly good pages. Allow up to 20s.
        tabDetails = await waitForTabComplete(tabInfo.tabId, tabDetails.discarded ? 20000 : 8000);
        if (BulkState.isCancelled) { setBulkRowStatus(tabInfo.tabId, 'fail', { error: 'cancelled' }); return; }
        if (tabDetails) await sleep(300);
      }
    } else {
      // Tab was closed by the user mid-hunt — record and move on immediately.
      error = 'tab_closed';
      throw new Error('tab_closed');
    }

    // PING first — only inject content script if not already alive
    const isPingAlive = await new Promise((resolve) => {
      try {
        chrome.tabs.sendMessage(tabInfo.tabId, { action: 'PING' }, (res) => {
          if (chrome.runtime.lastError || !res?.ready) { resolve(false); return; }
          resolve(true);
        });
      } catch (_) { resolve(false); }
    });

    if (!isPingAlive) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tabInfo.tabId },
          files: ['content.js']
        });
        await sleep(100);
      } catch (_) {}
    }

    // ── Temu: direct executeScript scrape (bypasses SPA background-tab issue) ──
    // Temu is a heavy SPA that never hydrates in background tabs, so the normal
    // SCRAPE_PAGE message always times out (30s wait for nothing).
    // Instead: executeScript in MAIN world so we can read page globals AND inline
    // scripts that are always present, even in background tabs.
    const isTemuTab = /temu\./i.test(tabInfo.url);
    const isWgsTab  = /worldwidegolfshops\.com|worldwidegolfballs\.com/i.test(tabInfo.url);
    if (isTemuTab || isWgsTab) {
      // Check cancel before starting
      if (BulkState.isCancelled) { error = 'cancelled'; scraped = null; throw new Error('cancelled'); }

      // Hoisted so the post-refresh retry runs the SAME scraper. The old retry
      // injected a stub that returned null, so every Temu/WGS retry failed.
      const temuMainWorldScrape = () => {
              const h = location.hostname.toLowerCase();
              const isWgs = h.includes('worldwidegolfshops.com') || h.includes('worldwidegolfballs.com');

              const result = { title: '', price: '', images: [], videos: [], variants: [], url: location.href };

              // ── TITLE (works for both Temu and Shopify) ────────────────
              const titleEl = document.querySelector(
                'h1.product__title, h1.product-single__title, h1.product-title,' +
                '[class*="goods-name"], [class*="GoodsName"], [class*="ProductTitle"],' +
                '[class*="product-title"], [class*="detail-title"],' +
                '[data-testid*="product-name"], [data-testid*="title"], h1'
              );
              if (titleEl) result.title = titleEl.innerText.trim();
              if (!result.title) {
                const og = document.querySelector('meta[property="og:title"]');
                result.title = og?.content || document.title || '';
              }

              if (isWgs) {
                // ══ WGS / Worldwide Golf Shops — Shopify scraper ══

                // Price — Strategy 1: itemprop="price" content attr (most reliable on Shopify)
                const priceItemprop = document.querySelector('[itemprop="price"]');
                if (priceItemprop) {
                  const raw = priceItemprop.getAttribute('content') || priceItemprop.innerText || priceItemprop.textContent || '';
                  const num = parseFloat(raw.replace(/[^0-9.]/g, ''));
                  if (num > 0) result.price = '$' + num.toFixed(2);
                }

                // Price — Strategy 2: meta og:price:amount
                if (!result.price) {
                  const ogPrice = document.querySelector('meta[property="og:price:amount"], meta[property="product:price:amount"]');
                  if (ogPrice && ogPrice.content) {
                    const num = parseFloat(ogPrice.content.replace(/[^0-9.]/g, ''));
                    if (num > 0) result.price = '$' + num.toFixed(2);
                  }
                }

                // Price — Strategy 3: Shopify inline JSON (window.ShopifyAnalytics or similar)
                if (!result.price) {
                  for (const s of document.querySelectorAll('script:not([src])')) {
                    const t = s.textContent || '';
                    if (t.length < 20 || t.length > 2000000) continue;
                    // Shopify stores price in cents: "price":5999
                    const cm = t.match(/"price"\s*:\s*(\d{3,7})(?![.\d])/);
                    if (cm) {
                      const cents = parseInt(cm[1]);
                      if (cents > 0 && cents < 10000000) { result.price = '$' + (cents / 100).toFixed(2); break; }
                    }
                    // Sometimes as float string: "price":"59.99"
                    const fm = t.match(/"price"\s*:\s*"(\d+\.\d{1,2})"/);
                    if (fm) { const v = parseFloat(fm[1]); if (v > 0) { result.price = '$' + v.toFixed(2); break; } }
                  }
                }

                // Price — Strategy 4: DOM selectors
                if (!result.price) {
                  const priceSels = [
                    '.price-item--sale', '.price-item--regular',
                    '.product__price .price', '[class*="product-price"]',
                    '.price', '[data-product-price]'
                  ];
                  for (const sel of priceSels) {
                    const el = document.querySelector(sel);
                    if (!el) continue;
                    const raw = (el.getAttribute('content') || el.innerText || el.textContent || '').trim();
                    // Remove discount noise (e.g. "$59.99 $79.99" — take first price)
                    const m = raw.match(/\$\s*(\d+(?:[.,]\d{1,2})?)/);
                    if (m) { result.price = '$' + m[1].replace(',', '.'); break; }
                    const plain = raw.match(/\b(\d+\.\d{1,2})\b/);
                    if (plain) { result.price = '$' + plain[1]; break; }
                  }
                }

                // WGS Images — Pure DOM Gallery Scraper (VTEX)
                // We skip JSON-LD to avoid grabbing "Related Products" which WGS injects heavily
                const scope = document.querySelector(
                  '[class*="productImages"], [class*="carouselGallery"],' +
                  '.product__media-wrapper, .product-single__photos,' +
                  '[class*="product-gallery"], [class*="ProductGallery"],' +
                  '.product-images, .product__images'
                );
                const imgs = scope ? scope.querySelectorAll('img') : document.querySelectorAll('img');
                imgs.forEach(img => {
                  const src = img.getAttribute('data-src') || img.getAttribute('data-zoom-image') || img.src || '';
                  if (!src || !src.startsWith('http')) return;
                  if (/logo|icon|badge|sprite|nav|header|footer|payment|trust|related|recommend/i.test(src)) return;
                  const w = img.naturalWidth || img.width || 0;
                  if (w > 0 && w < 120) return;

                  // If we had to fall back to the whole document, be strictly limited to product images
                  if (!scope) {
                    const cls = (img.className || '') + ' ' + ((img.parentElement && img.parentElement.className) || '');
                    if (!/productImage|carouselThumb/i.test(cls)) return;
                  }

                  // Upsize Shopify thumbnails (if they ever switch back)
                  let large = src
                    .replace(/_(\d+)x(\d+)(\.[a-z]+)(\?|$)/i, '_1200x$3$4')
                    .replace(/_(\d+)x(\.[a-z]+)(\?|$)/i, '_1200x$2$3');
                  
                  // Upsize VTEX thumbnails and STRIP query parameters to prevent duplicates!
                  if (large.includes('.vtexassets.com/arquivos/ids/')) {
                    const idMatch = large.match(/\/ids\/(\d+)/);
                    if (idMatch) large = `https://worldwidegolf.vtexassets.com/arquivos/ids/${idMatch[1]}`;
                  }
                  large = large.split('?')[0]; // Strip query strings like ?v=...&width=... to prevent duplicates

                  if (!result.images.includes(large)) result.images.push(large);
                });

                // OG image fallback
                const ogImg = document.querySelector('meta[property="og:image"]');
                if (ogImg && ogImg.content && !result.images.includes(ogImg.content)) {
                  result.images.unshift(ogImg.content);
                }

              } else {
                // ══ TEMU scraper (existing logic) ══

                // Price: Strategy 1 — window.__init_data__
                try {
                  const initData = (typeof __init_data__ !== 'undefined' && __init_data__) // eslint-disable-line no-undef
                                || window.__init_data__ || null;
                  if (initData) {
                    const walkInit = (obj, depth) => {
                      if (!obj || typeof obj !== 'object' || depth > 15) return '';
                      const centKeys = ['sale_price','salePrice','actual_price','actualPrice',
                                        'promotion_price','promotionPrice','min_price','minPrice'];
                      for (const k of centKeys) {
                        if (k in obj && typeof obj[k] === 'number' && obj[k] > 0)
                          return '$' + (obj[k] >= 100 ? (obj[k] / 100).toFixed(2) : obj[k].toFixed(2));
                        if (k in obj && typeof obj[k] === 'string' && /\d/.test(obj[k])) {
                          const m = obj[k].match(/[$£€¥₹₩]?\s*\d+(?:[.,]\d+)?/);
                          if (m) return m[0];
                        }
                      }
                      const imgKeys = ['origin_url','original_img_url','img_url','thumbnail_url'];
                      for (const k of imgKeys) {
                        if (k in obj && typeof obj[k] === 'string' && obj[k].startsWith('http'))
                          if (!result.images.includes(obj[k])) result.images.push(obj[k]);
                      }
                      for (const v of Object.values(obj)) {
                        if (v && typeof v === 'object') { const r2 = walkInit(v, depth + 1); if (r2) return r2; }
                      }
                      return '';
                    };
                    const p = walkInit(initData, 0);
                    if (p) result.price = p;
                  }
                } catch (_) {}

                // Price: Strategy 2 — inline script regex
                if (!result.price) {
                  for (const s of document.querySelectorAll('script:not([src])')) {
                    const t = s.textContent || '';
                    if (t.length < 50 || t.length > 5000000) continue;
                    if (!/sale_price|actual_price|display_price|price_str|priceStr/.test(t)) continue;
                    const c = t.match(/"(?:sale_price|actual_price|promotion_price|salePrice|actualPrice)"\s*:\s*(\d{2,7})(?![.\d])/);
                    if (c) { const cents = parseInt(c[1]); if (cents > 0) { result.price = '$' + (cents / 100).toFixed(2); break; } }
                    const sp = t.match(/"(?:display_price|price_str|priceStr|formatted_price)"\s*:\s*"([^"]+)"/);
                    if (sp) { const pm = sp[1].match(/[$£€¥₹₩]\s*\d[\d.,]*/); if (pm) { result.price = pm[0]; break; } }
                    const fp = t.match(/"(?:price|salePrice)"\s*:\s*(\d+\.\d{1,2})(?!\d)/);
                    if (fp) { const v = parseFloat(fp[1]); if (v > 0) { result.price = '$' + v.toFixed(2); break; } }
                  }
                }

                // Price: Strategy 3 — DOM selectors
                if (!result.price) {
                  const pSels = ['[data-testid="price"]','[data-testid="selling-price"]','[class*="price-sale"]','[class*="priceSale"]','[class*="price-current"]','[aria-label*="price" i]'];
                  for (const sel of pSels) {
                    const el = document.querySelector(sel);
                    if (!el) continue;
                    const m = (el.innerText || el.textContent || '').match(/[$£€¥₹₩]\s*\d[\d.,]*/);
                    if (m) { result.price = m[0]; break; }
                  }
                }

                // Images: inline scripts
                if (result.images.length === 0) {
                  for (const s of document.querySelectorAll('script:not([src])')) {
                    const t = s.textContent || '';
                    if (!t.includes('origin_url') && !t.includes('img_url') && !t.includes('goods_gallery')) continue;
                    for (const m of t.matchAll(/"origin_url"\s*:\s*"(https?:[^"]+)"/g)) { const u = m[1].replace(/\\/g, ''); if (!result.images.includes(u)) result.images.push(u); }
                    for (const m of t.matchAll(/"original_img_url"\s*:\s*"(https?:[^"]+)"/g)) { const u = m[1].replace(/\\/g, ''); if (!result.images.includes(u)) result.images.push(u); }
                    for (const m of t.matchAll(/"img_url"\s*:\s*"(https?:[^"]+)"/g)) { const u = m[1].replace(/\\/g, ''); if (!result.images.includes(u)) result.images.push(u); }
                  }
                }

                // Images: DOM fallback
                if (result.images.length === 0) {
                  const gallery = document.querySelector('[class*="goods-gallery"],[class*="GoodsGallery"],[class*="image-view"],[class*="swiper-wrapper"],[data-testid*="gallery"],[data-testid*="image"]') || document.body;
                  gallery.querySelectorAll('img').forEach(img => {
                    const src = img.src || img.dataset.src || img.dataset.lazySrc || '';
                    if (!src || !src.startsWith('http')) return;
                    const w = img.naturalWidth || img.width || 0;
                    const h = img.naturalHeight || img.height || 0;
                    if (w > 0 && w < 100) return;
                    if (/logo|icon|badge|nav|platform|header/i.test(src)) return;
                    const clean = src.replace(/\/thumbnail\/\d+x\d+/, '/origin');
                    if (!result.images.includes(clean)) result.images.push(clean);
                  });
                }

                // OG image fallback
                const ogImg2 = document.querySelector('meta[property="og:image"]');
                if (ogImg2 && ogImg2.content && !result.images.includes(ogImg2.content)) {
                  result.images.unshift(ogImg2.content);
                }
              }

              result.images = result.images.slice(0, 15);
              return result;
      };

      try {
        const temuResults = await Promise.race([
          chrome.scripting.executeScript({
            target: { tabId: tabInfo.tabId },
            world: 'MAIN',   // access page-scope globals like window.__init_data__
            func: temuMainWorldScrape
          }),
          // If executeScript hangs for any reason, time out after 12s
          new Promise((_, reject) => {
            let elapsed = 0;
            const iv = setInterval(() => {
              elapsed += 200;
              if (BulkState.isCancelled) {
                clearInterval(iv);
                reject(new Error('cancelled'));
              } else if (elapsed >= 12000) {
                clearInterval(iv);
                reject(new Error('temu_exec_timeout'));
              }
            }, 200);
          })
        ]);

        if (temuResults?.[0]?.result) {
          scraped = temuResults[0].result;
          if (scraped.url && scraped.url !== tabInfo.url) scraped.url = tabInfo.url;
        }
      } catch (execErr) {
        const isCancelled = execErr?.message === 'cancelled';
        error = isCancelled ? 'cancelled'
              : execErr?.message === 'temu_exec_timeout' ? 'timeout'
              : (execErr?.message || 'exec_failed');
        scraped = null;

        // ── AUTO-REFRESH on Temu/WGS executeScript timeout ────────────────
        if (!isCancelled && !BulkState.isCancelled && error === 'timeout') {
          setBulkRowMeta(tabInfo.tabId, 'Not responding — refreshing…');
          try { await new Promise(r => chrome.tabs.reload(tabInfo.tabId, {}, r)); } catch (_) {}
          let reloadDetails = null;
          for (let i = 0; i < 30; i++) {               // 30 �� 500ms = 15s max
            if (BulkState.isCancelled) break;
            reloadDetails = await new Promise(r => chrome.tabs.get(tabInfo.tabId, t => r(chrome.runtime.lastError ? null : t)));
            if (!reloadDetails || reloadDetails.status === 'complete') break;
            await sleep(500);
          }
          if (reloadDetails) await sleep(1500);

          if (!BulkState.isCancelled) {
            setBulkRowMeta(tabInfo.tabId, 'Retrying after refresh…');
            try {
              const retryResults = await Promise.race([
                chrome.scripting.executeScript({
                  target: { tabId: tabInfo.tabId },
                  world: 'MAIN',
                  func: temuMainWorldScrape
                }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('temu_exec_timeout')), 12000))
              ]);
              if (retryResults?.[0]?.result) {
                scraped = retryResults[0].result;
                error = null;
              } else {
                setBulkRowMeta(tabInfo.tabId, 'Skipped (no response after refresh)');
                error = 'no_response_after_refresh';
              }
            } catch (_) {
              setBulkRowMeta(tabInfo.tabId, 'Skipped (no response after refresh)');
              error = 'no_response_after_refresh';
            }
          }
        }
        // ── END AUTO-REFRESH ─────────────────────────────────────────────
      }
    } else {
      // ── Normal path: isLazy wake + SCRAPE_PAGE message ──────────────────
      const isLazy = /faire\.com|samsclub\.com|worldwidegolfshops\.com|worldwidegolfballs\.com|amazon\.|walmart\.com/i.test(tabInfo.url);
      if (isLazy) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tabInfo.tabId },
            func: () => {
              window.dispatchEvent(new Event('scroll'));
              window.dispatchEvent(new Event('resize'));
              document.dispatchEvent(new Event('visibilitychange'));
            }
          });
          await sleep(300); // PERF: events fire synchronously, 300ms is plenty
        } catch (_) {}
      }

      // Check cancel before sending SCRAPE_PAGE
      if (BulkState.isCancelled) { error = 'cancelled'; scraped = null; throw new Error('cancelled'); }

      // Send SCRAPE_PAGE message with strict timeout
      scraped = await new Promise((resolve) => {
        let done = false;
        let finish = (v) => { if (!done) { done = true; resolve(v); } };
        // Check cancelled flag every 200ms so cancel responds quickly
        let cancelCheck = setInterval(() => { if (BulkState.isCancelled) finish(null); }, 200);
        const t = setTimeout(() => finish(null), BulkState.TAB_TIMEOUT);
        const origFinish = finish;
        finish = (v) => { clearTimeout(t); clearInterval(cancelCheck); origFinish(v); };
        try {
          chrome.tabs.sendMessage(tabInfo.tabId, { action: 'SCRAPE_PAGE' }, (res) => {
            clearTimeout(t);
            if (chrome.runtime.lastError) { finish(null); return; }
            if (!res?.success || !res?.data) { finish(null); return; }
            finish(res.data);
          });
        } catch (e) { finish(null); }
      });

      // ── AUTO-REFRESH on no-response ──────────────────────────────────────
      // If the tab didn't respond (timed out, frozen, or content script wasn't
      // injected), refresh the tab and try exactly one more time before skipping.
      if (!scraped && !BulkState.isCancelled) {
        setBulkRowMeta(tabInfo.tabId, 'Not responding — refreshing…');

        // Refresh the tab and wait for it to finish loading (up to 20 seconds).
        // Previously only 3s — a cold reload of Amazon/Walmart never made it.
        try { await new Promise(r => chrome.tabs.reload(tabInfo.tabId, {}, () => { void chrome.runtime.lastError; r(); })); } catch (_) {}
        const reloadDetails = await waitForTabComplete(tabInfo.tabId, 20000);
        if (reloadDetails) await sleep(400);

        if (!BulkState.isCancelled) {
          setBulkRowMeta(tabInfo.tabId, 'Retrying after refresh…');

          // Re-inject content script after reload
          try {
            await chrome.scripting.executeScript({ target: { tabId: tabInfo.tabId }, files: ['content.js'] });
            await sleep(400);
          } catch (_) {}

          // Lazy-wake events (for SPA sites that need scroll to hydrate)
          if (isLazy) {
            try {
              await chrome.scripting.executeScript({
                target: { tabId: tabInfo.tabId },
                func: () => {
                  window.dispatchEvent(new Event('scroll'));
                  window.dispatchEvent(new Event('resize'));
                  document.dispatchEvent(new Event('visibilitychange'));
                }
              });
              await sleep(500);
            } catch (_) {}
          }

          // Single retry attempt after refresh — cold page, so allow the longer window
          scraped = await new Promise((resolve) => {
            let done = false;
            let finish = (v) => { if (!done) { done = true; resolve(v); } };
            let cancelCheck = setInterval(() => { if (BulkState.isCancelled) finish(null); }, 200);
            const t = setTimeout(() => finish(null), BulkState.TAB_TIMEOUT_RETRY || 15000);
            const origFinish = finish;
            finish = (v) => { clearTimeout(t); clearInterval(cancelCheck); origFinish(v); };
            try {
              chrome.tabs.sendMessage(tabInfo.tabId, { action: 'SCRAPE_PAGE' }, (res) => {
                clearTimeout(t);
                if (chrome.runtime.lastError) { finish(null); return; }
                if (!res?.success || !res?.data) { finish(null); return; }
                finish(res.data);
              });
            } catch (e) { finish(null); }
          });

          if (!scraped) {
            // Still no response after refresh — skip this tab
            setBulkRowMeta(tabInfo.tabId, 'Skipped (no response after refresh)');
            error = 'no_response_after_refresh';
          }
        }
      }
      // ── END AUTO-REFRESH ─────────────────────────────────────────────────
    }


    if (!scraped) {
      error = 'no_response';
    } else {
      // ── DATA INTEGRITY CHECK ──────────────────────────────────
      // Verify the scraped data actually belongs to the tab we scraped.
      // Use BOTH hostname AND path comparison so that same-domain but
      // different-product URLs (e.g. two Amazon ASINs) are caught.
      const tabUrlNow = await getTabUrl(tabInfo.tabId);
      const scrapedHost  = safeHost(scraped.url);
      const expectedHost = safeHost(tabInfo.url);
      const currentHost  = safeHost(tabUrlNow);

      // Sam's Club rewrites its URL after load (removes ?from=/search etc.)
      // Temu: URL set directly from location.href inside executeScript — always correct.
      const isSamsClub = /samsclub\.com/i.test(tabInfo.url);
      const isTemuScrape = /temu\./i.test(tabInfo.url);
      const isGolfSite = /worldwidegolfshops\.com|worldwidegolfballs\.com/i.test(tabInfo.url);

      if (!isSamsClub && !isTemuScrape && !isGolfSite) {
        // Hostname mismatch — definitely wrong page
        if (scrapedHost && expectedHost && scrapedHost !== expectedHost) {
          error = 'url_mismatch';
          scraped = null;
        } else if (currentHost && expectedHost && currentHost !== expectedHost) {
          error = 'tab_navigated';
          scraped = null;
        } else {
          // ── PATH-LEVEL CHECK (catches same-domain different-product) ──
          // Compare the meaningful path segments (product ID portion).
          // For Amazon, Walmart, eBay, etc. the product ID is a distinct
          // path segment; if the scraped URL has a different path than the
          // tab URL, the content script returned stale data from a previous
          // navigation.
          const expectedPath = safePathKey(tabInfo.url);
          const scrapedPath  = safePathKey(scraped.url);
          if (expectedPath && scrapedPath && expectedPath !== scrapedPath) {
            error = 'product_mismatch';
            scraped = null;
          }
        }
      }
    }
  } catch (e) {
    error = e?.message || 'scrape_error';
  }

  // Determine final status
  let status;
  if (!scraped) {
    status = 'fail';
  } else if (!scraped.title || (!scraped.price && (!scraped.images || !scraped.images.length))) {
    status = 'partial';
  } else {
    status = 'ok';
  }

  // PERF: Image download deferred to imageDownloadPhase() after all tabs scraped.
  const imagesBase64 = [];

  const result = {
    tabId:    tabInfo.tabId,
    url:      tabInfo.url,
    title:    scraped?.title || '',
    price:    scraped?.price || '',
    platform: tabInfo.platform?.name || 'Other',
    images:   scraped?.images || [],
    imagesBase64,
    videos:   scraped?.videos || [],
    variants: scraped?.variants || [],
    description: scraped?.description || '',
    status,
    error,
    scrapedAt: new Date().toISOString(),
    originalIndex: tabInfo.originalIndex ?? BulkState.results.length // fallback: append order
  };

  if (error === 'cancelled' || BulkState.isCancelled) {
    setBulkRowStatus(tabInfo.tabId, 'fail', { error: 'cancelled' });
    return;
  }

  // Lightweight stub — must include images (for imageDownloadPhase) and price (for export)
  BulkState.results.push({
    tabId:       result.tabId,
    url:         result.url,
    title:       result.title,
    price:       result.price,
    platform:    result.platform,
    status:      result.status,
    error:       result.error,
    images:      result.images || [],
    imagesBase64: [],
    videos:      result.videos || [],
    variants:    result.variants || [],
    description: result.description || '',
    scrapedAt:   result.scrapedAt,
    originalIndex: result.originalIndex
  });

  if (status !== 'fail') {
    BulkState.pendingFlush.push(result);
  }
  setBulkRowStatus(tabInfo.tabId, status, {
    images: imagesBase64.length,
    error
  });
  updateBulkProgressBar();
}

// ── Phase 2: Image Download (runs after all tabs scraped) ─────────────────
async function imageDownloadPhase() {
  const pending = BulkState.results.filter(r => r.images?.length > 0 && r.status !== 'fail');
  if (!pending.length) return;

  updateBulkProgressTitle(`📷 Downloading images for ${pending.length} products…`);

  let cursor = 0;
  const CONCUR = 4; // 4 parallel image batches (was 2) — 2x faster image phase

  const workers = Array.from({ length: CONCUR }, async () => {
    while (cursor < pending.length && !BulkState.isCancelled) {
      const r = pending[cursor++];
      if (!r) break;
      try {
        const urls = (r.images || []).slice(0, 7);
        const batchRes = await msg({ action: 'FETCH_BASE64_BATCH', urls });
        if (batchRes?.success && Array.isArray(batchRes.results)) {
          r.imagesBase64 = batchRes.results.filter(x => x?.success && x.base64).map(x => x.base64);
        } else {
          r.imagesBase64 = [];
        }
      } catch (_) {
        r.imagesBase64 = [];
      }
      const imgCount = r.imagesBase64?.length || 0;
      setBulkRowMeta(r.tabId, `${imgCount} imgs`);
      if (r.status === 'ok' && r.images?.length > 0 && imgCount === 0) {
        r.status = 'partial'; r.error = 'img_fetch_failed';
        // The row was already flushed to the Library as "ok" — mirror the downgrade
        // so the Library status and the result modal do not disagree.
        BulkState.pendingStatusPatches = BulkState.pendingStatusPatches || [];
        BulkState.pendingStatusPatches.push({ url: r.url, status: 'partial' });
        setBulkRowStatus(r.tabId, 'partial', { images: 0, error: 'img_fetch_failed' });
      } else {
        setBulkRowStatus(r.tabId, r.status, { images: imgCount, error: r.error });
      }
    }
  });
  await Promise.all(workers);
}

function getTabUrl(tabId) {
  return new Promise(resolve => {
    chrome.tabs.get(tabId, t => {
      if (chrome.runtime.lastError) resolve('');
      else resolve(t?.url || '');
    });
  });
}

function safeHost(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); }
  catch { return ''; }
}

// Returns a short product-identity key from the URL path so we can detect
// when the scraped data belongs to a DIFFERENT product on the same domain.
// For Amazon: the ASIN; for Walmart/Sam's: the numeric item ID; for eBay:
// the item number; for generic sites: the last path segment.
function safePathKey(url) {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    // Amazon: /dp/ASIN or /gp/product/ASIN
    const dpIdx = parts.indexOf('dp');
    if (dpIdx >= 0 && parts[dpIdx + 1]) return parts[dpIdx + 1].toLowerCase();
    const gpIdx = parts.indexOf('product');
    if (gpIdx >= 0 && parts[gpIdx + 1]) return parts[gpIdx + 1].toLowerCase();
    // eBay: /itm/ITEM_ID
    const itmIdx = parts.indexOf('itm');
    if (itmIdx >= 0 && parts[itmIdx + 1]) return parts[itmIdx + 1].toLowerCase();
    // Walmart/Sam's Club/Daraz: last all-digit segment of length 6+
    const numPart = [...parts].reverse().find(p => /^\d{6,}$/.test(p));
    if (numPart) return numPart;
    // AliExpress / Faire: last segment before query string
    return (parts[parts.length - 1] || '').toLowerCase().split('?')[0];
  } catch { return ''; }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Progress UI ──────────────────────────────────────────────
function openBulkProgressModal(tabs) {
  const list = $('bulkProgList');
  if (list) {
    list.innerHTML = '';
    tabs.forEach(t => {
      const row = document.createElement('div');
      row.className = 'bulk-prog-row waiting';
      row.dataset.tabId = t.tabId;
      const tag = t.platform?.tag || '?';
      row.innerHTML = `
        <span class="bulk-prog-status">⌛</span>
        <span class="bulk-prog-platform">${esc(tag)}</span>
        <span class="bulk-prog-name">${esc(trunc(t.title, 60))}</span>
        <span class="bulk-prog-meta"></span>`;
      list.appendChild(row);
    });
  }

  $('bulkResultSummary')?.classList.add('hidden');
  $('bulkProgStats')?.classList.remove('hidden');
  $('bpsCurrent')?.classList.remove('hidden');
  $('bulkProgressFoot')?.classList.remove('hidden');
  $('bulkProgressCloseBtn')?.classList.add('hidden');
  $('bulkPauseBtn').textContent = '⏸ Pause';
  $('bulkProgFill').style.width = '0%';
  $('bulkProgText').textContent = `0 of ${tabs.length} done`;
  $('bulkProgressTitle').textContent = '⚡ Hunting in Progress';

  $('bulkProgressModal')?.classList.remove('hidden');
}

function closeBulkProgressModal() {
  $('bulkProgressModal')?.classList.add('hidden');
}

function updateBulkProgressTitle(text) {
  const el = $('bulkProgressTitle');
  if (el) el.textContent = text;
}

function setBulkRowStatus(tabId, status, opts = {}) {
  const row = document.querySelector(`.bulk-prog-row[data-tab-id="${tabId}"]`);
  if (!row) return;
  row.classList.remove('waiting', 'active', 'ok', 'partial', 'fail');
  row.classList.add(status);
  const statusEl = row.querySelector('.bulk-prog-status');
  const metaEl   = row.querySelector('.bulk-prog-meta');
  if (statusEl) {
    statusEl.textContent = ({
      'waiting': '⌛',
      'active':  '⏳',
      'ok':      '✓',
      'partial': '◐',
      'fail':    '✗'
    })[status] || '·';
  }
  if (metaEl) {
    if (status === 'ok')      metaEl.textContent = `${opts.images || 0} imgs`;
    else if (status === 'partial') metaEl.textContent = 'partial';
    else if (status === 'fail') {
      const errMap = {
        'cancelled':       'cancelled',
        'no_response':     'timeout',
        'timeout':         'timeout',
        'no_product':      'not a product page',
        'img_fetch_failed':'images failed',
        'url_mismatch':    'wrong page loaded',
        'tab_navigated':   'tab navigated away',
        'product_mismatch':'data mismatch',
        'scrape_error':    'scrape error',
        'tab_closed':      'tab closed',
        'no_script':       'no script access',
        'network_error':   'network error',
      };
      const raw = opts.error || '';
      const label = errMap[raw] || (raw ? raw.replace(/_/g,' ') : 'failed');
      metaEl.textContent = label;
    }
  }
}

function setBulkRowMeta(tabId, text) {
  const row = document.querySelector(`.bulk-prog-row[data-tab-id="${tabId}"]`);
  const meta = row?.querySelector('.bulk-prog-meta');
  if (meta) meta.textContent = text;
}

function updateBulkProgressBar(currentItemTitle) {
  const total   = BulkState.selectedIds.size;
  const done    = BulkState.results.length;
  const failed  = BulkState.results.filter(r => r.status === 'fail' || r.status === 'error' || r.status === 'needs_retry').length;
  const pct     = total ? Math.round((done / total) * 100) : 0;
  const fill    = $('bulkProgFill');
  if (fill) fill.style.width = pct + '%';

  // Color progress bar red if there are failures
  if (fill) fill.style.background = failed > 0 && done === total
    ? 'linear-gradient(90deg,#16a34a,#dc2626)'
    : '';

  $('bulkProgText').textContent = `${done} of ${total} done (${pct}%)${failed ? ' · ' + failed + ' failed' : ''}`;

  // Live stats
  const elapsedSec = BulkState.huntStartTime ? (Date.now() - BulkState.huntStartTime) / 1000 : 0;
  const speed      = elapsedSec > 1 ? (done / elapsedSec).toFixed(1) : '—';
  const totalImgs  = BulkState.results.reduce((s, r) => s + (Array.isArray(r.images) ? r.images.length : (r.imageCount || 0)), 0);
  const totalVids  = BulkState.results.reduce((s, r) => s + (Array.isArray(r.videos) ? r.videos.length : (r.videoCount || 0)), 0);
  const remaining  = total - done;
  let etaStr = '—';
  if (elapsedSec > 2 && done > 0 && remaining > 0) {
    const secLeft = Math.ceil(remaining * (elapsedSec / done));
    const m = Math.floor(secLeft / 60), s = secLeft % 60;
    etaStr = m > 0 ? `${m}m ${s}s` : `${s}s`;
  }
  const el = (id, txt, cls) => {
    const e = $(id);
    if (!e) return;
    e.textContent = txt;
    if (cls) e.className = 'bps-item ' + cls;
  };
  el('bpsSpeed',  `⚡ ${speed} tabs/s`);
  el('bpsImages', `📸 ${totalImgs} imgs`);
  el('bpsVideos', `🎬 ${totalVids} vids`);
  el('bpsFailed', `⚠ ${failed} failed`, failed > 0 ? 'bps-item bps-fail bps-fail-active' : 'bps-item bps-fail');
  el('bpsEta',    `⏱ ${etaStr === '—' ? 'calculating…' : etaStr + ' left'}`);

  // Show currently processing item name
  const curEl = $('bpsCurrent');
  if (curEl) {
    if (currentItemTitle) {
      curEl.textContent = `🔍 Now: ${currentItemTitle}`;
      curEl.style.display = 'block';
    } else if (done === total && total > 0) {
      curEl.textContent = '✅ All done!';
      curEl.style.display = 'block';
    } else {
      curEl.style.display = 'none';
    }
  }
}

function toggleBulkPause() {
  BulkState.isPaused = !BulkState.isPaused;
  const btn = $('bulkPauseBtn');
  if (btn) btn.textContent = BulkState.isPaused ? '▶ Resume' : '⏸ Pause';
  updateBulkProgressTitle(BulkState.isPaused ? '⏸ Paused — click Resume to continue' : '⚡ Hunting in Progress');
  // Actually pause/resume the background queue worker
}

function cancelBulkHunt() {
  if (!BulkState.isHunting) {
    closeBulkProgressModal();
    return;
  }
  showConfirm(
    'Cancel Bulk Hunt?',
    'Saved data so far will still be available.',
    'Yes, Cancel',
    () => {
      updateBulkProgressTitle('Cancelling…');
      BulkState.isCancelled = true;
      BulkState.isPaused = false;
      const cb = $('bulkCancelBtn'); if (cb) { cb.disabled = true; cb.textContent = 'Cancelling…'; }
      const pb = $('bulkPauseBtn'); if (pb) pb.disabled = true;
      const cur = $('bpsCurrent'); if (cur) cur.textContent = 'Stopping after the current tab…';
    }
  );
}

// ── Hunt finished ────────────────────────────────────────────
async function finishBulkHunt() {
  msg({ action: 'STOP_KEEPALIVE' }).catch(() => {});

  const patches = BulkState.pendingStatusPatches || [];
  BulkState.pendingStatusPatches = [];
  if (patches.length) {
    try {
      const rows = await getMasterRows();
      const byUrl = new Map(patches.map(p => [String(p.url || '').toLowerCase(), p.status]));
      let changed = false;
      rows.forEach(row => { const s = byUrl.get(String(row.url || '').toLowerCase()); if (s && row.status !== s) { row.status = s; changed = true; } });
      if (changed) await setMasterRows(rows);
    } catch (_) {}
  }

  const ok      = BulkState.results.filter(r => r.status === 'ok').length;
  const partial = BulkState.results.filter(r => r.status === 'partial').length;
  const fail    = BulkState.results.filter(r => r.status === 'fail').length;
  // Results carry images/videos arrays (imageCount is only on Library rows).
  const totalImgs = BulkState.results.reduce((s, r) => s + (r.imagesBase64?.length || r.images?.length || r.imageCount || 0), 0);
  const totalVids = BulkState.results.reduce((s, r) => s + (r.videos?.length || r.videoCount || 0), 0);

  // Compute hunt duration for summary
  const durMs  = BulkState.huntStartTime ? Date.now() - BulkState.huntStartTime : 0;
  const durSec = Math.round(durMs / 1000);
  const durStr = durSec >= 60 ? `${Math.floor(durSec/60)}m ${durSec%60}s` : `${durSec}s`;

  $('bulkRsOk').textContent      = ok;
  $('bulkRsPartial').textContent = partial;
  $('bulkRsFail').textContent    = fail;
  $('bulkResultMeta').textContent = `${totalImgs} images · ${totalVids} videos · ${durStr} total`;

  // Mark progress bar complete (turn green)
  const fill = $('bulkProgFill');
  if (fill) { fill.style.width = '100%'; fill.classList.add('complete'); }

  // Show failed tabs detail
  const failedRows = BulkState.results.filter(r => r.status === 'fail');
  const detailEl = $('bulkFailedDetail');
  const listEl   = $('bulkFailedList');
  if (detailEl && listEl && failedRows.length > 0) {
    detailEl.classList.remove('hidden');
    const errMap = {
      'cancelled':'cancelled','no_response':'timeout','timeout':'timeout',
      'no_product':'not a product page','img_fetch_failed':'images failed',
      'url_mismatch':'wrong page','tab_navigated':'tab navigated','product_mismatch':'data mismatch',
      'scrape_error':'scrape error','tab_closed':'tab closed','no_script':'no script access','network_error':'network error'
    };
    listEl.innerHTML = failedRows.map(r => {
      const raw    = r.error || '';
      const reason = errMap[raw] || (raw ? raw.replace(/_/g,' ') : 'failed');
      const host = (() => { try { return new URL(r.url).hostname.replace(/^www\./, ''); } catch { return r.url; } })();
      return `<div class="bulk-failed-item"><span class="bfi-url" title="${esc(r.url)}">✗ ${esc(host)}</span><span class="bfi-reason">→ ${esc(reason)}</span></div>`;
    }).join('');
  } else if (detailEl) {
    detailEl.classList.add('hidden');
  }

  // Results are already saved to master sheet via continuous flush loop

  // Show result summary
  $('bulkResultSummary')?.classList.remove('hidden');
  $('bulkProgStats')?.classList.add('hidden');
  $('bpsCurrent')?.classList.add('hidden');
  $('bulkProgressFoot')?.classList.add('hidden');
  $('bulkProgressCloseBtn')?.classList.remove('hidden');
  updateBulkProgressTitle(BulkState.isCancelled ? '⏹ Hunt Cancelled' : '✓ Hunt Complete');

    updateMasterStats();
  updateBulkSummary();
  updateQueueExportButtons();

  // v8.3.2: no automatic download — the result modal is where the user picks what to save.
}

// ── Master Sheet storage ─────────────────────────────────────
async function getMasterRows() {
  return new Promise(resolve => {
    chrome.storage.local.get(MASTER_KEY, res => resolve(res[MASTER_KEY] || []));
  });
}

async function setMasterRows(rows) {
  return new Promise(resolve => {
    chrome.storage.local.set({ [MASTER_KEY]: rows }, () => resolve());
  });
}

async function getMasterBatches() {
  return new Promise(resolve => {
    chrome.storage.local.get(BATCHES_KEY, res => resolve(res[BATCHES_KEY] || []));
  });
}

async function setMasterBatches(batches) {
  return new Promise(resolve => {
    chrome.storage.local.set({ [BATCHES_KEY]: batches }, () => resolve());
  });
}

async function appendToMasterSheet(rows) {
  // Strip base64 images from master storage (would explode storage)
  const existing = await getMasterRows();
  const existingUrls = new Set(existing.map(r => (r.url || '').toLowerCase()));
  const newRows = rows.filter(r => !existingUrls.has((r.url || '').toLowerCase()));

  if (newRows.length === 0) return;

  const lean = newRows.map(r => ({
    id:           `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    title:        r.title,
    url:          r.url,
    platform:     r.platform,
    folder:       r.folder || BulkState.targetFolder || 'General',
    price:        r.price,
    labelCost:    '',                                     // empty — user fills
    listPrice:    '',                                     // empty — user fills
    description:  r.description,
    tags:         Array.isArray(r.tags) ? r.tags.join(', ') : '',
    variants:     (r.variants || []).join(', '),
    imageCount:   Array.isArray(r.images) ? r.images.length : 0,
    videoCount:   Array.isArray(r.videos) ? r.videos.length : 0,
    images:       Array.isArray(r.images) ? r.images.slice(0, 7) : [],   // raw URLs only (for re-hunt)
    videos:       Array.isArray(r.videos) ? r.videos.slice(0, 4) : [],
    status:       r.status,
    scrapedAt:    r.scrapedAt,
    lastRehunted: ''
  }));
  await setMasterRows([...existing, ...lean]);

  const batches = await getMasterBatches();
  const batch = batches.find(b => b.id === BulkState.currentBatchId);
  if (batch) {
    batch.count += newRows.length;
    batch.platforms = [...new Set([...batch.platforms, ...newRows.map(r => r.platform)])];
    if (!batch.folder && BulkState.targetFolder) batch.folder = BulkState.targetFolder;
  } else {
    batches.unshift({
      id:        BulkState.currentBatchId,
      date:      new Date().toISOString(),
      folder:    BulkState.targetFolder || 'General',
      count:     newRows.length,
      platforms: [...new Set(newRows.map(r => r.platform))]
    });
  }
  await setMasterBatches(batches.slice(0, 50));
}

async function updateMasterStats() {
  const rows = await getMasterRows();
  const batches = await getMasterBatches();
  $('masterRowCount').textContent  = rows.length;
  $('masterBatchCount').textContent = batches.length;
  if (batches.length === 0) {
    $('masterStartDate').textContent = '—';
  } else {
    const oldest = batches[batches.length - 1];
    const d = new Date(oldest.date);
    $('masterStartDate').textContent = d.toLocaleDateString();
  }

  updateHeaderCount();
  const dlEnabled = rows.length > 0;
  $('masterDlXlsxBtn').disabled = !dlEnabled;
  if ($('masterDlCsvBtn'))       $('masterDlCsvBtn').disabled       = !dlEnabled;
  if ($('masterDlHtmlBtn'))      $('masterDlHtmlBtn').disabled      = !dlEnabled;
  if ($('masterCopyTsvBtn'))     $('masterCopyTsvBtn').disabled     = !dlEnabled;
  if ($('masterDlPdfBtn'))       $('masterDlPdfBtn').disabled       = !dlEnabled;
  if ($('masterDlZipBtn'))       $('masterDlZipBtn').disabled       = !dlEnabled;
  if ($('masterDlWorkbookBtn'))  $('masterDlWorkbookBtn').disabled  = !dlEnabled; // v9

  $('masterWarning')?.classList.toggle('hidden', rows.length < 200);

  renderMasterBatches(batches);
  renderMasterRows(rows);
}

// Master sheet UI state — selection set + filters
const MasterUIState = {
  selectedIds: new Set()
};

function renderMasterRows(rows) {
  const list = $('masterRowsList');
  if (!list) return;
  if (!rows || rows.length === 0) {
    list.innerHTML = '<div class="bulk-empty"><p>No products yet. Hunt some tabs first!</p></div>';
    updateMasterBulkBar();
    return;
  }

  list.innerHTML = '';
  // Show newest first (rows are appended in chronological order, reverse for display)
  const display = [...rows].reverse();
  display.forEach(r => {
    const sel = MasterUIState.selectedIds.has(r.id);
    const status = r.status || 'ok';
    const date = r.scrapedAt ? new Date(r.scrapedAt) : null;
    const dateStr = date ? `${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')} ${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}` : '—';
    const priceStr = r.price ? r.price : '—';
    const tagInfo = (PLATFORM_PATTERNS[(Object.keys(PLATFORM_PATTERNS).find(k => (r.platform || '').toLowerCase().includes(k.split('.')[0])) || '')]) || null;
    const platTag = tagInfo?.tag || (r.platform ? r.platform.slice(0, 3).toUpperCase() : '?');

    const row = document.createElement('div');
    row.className = 'master-row' + (sel ? ' selected' : '') + ' status-' + status;
    row.dataset.id = r.id;

    // v8.1.1: Get first image for thumbnail
    const thumbSrc = (() => {
      const imgs = r.imageUrls || r.images || [];
      if (!imgs.length) return '';
      const first = imgs[0];
      return typeof first === 'string' ? first : (first?.src || first?.url || '');
    })();

    row.innerHTML = `
      <div class="master-row-check"></div>
      ${thumbSrc
        ? `<div class="master-row-thumb"><img src="${esc(thumbSrc)}" alt="" loading="lazy" onerror="this.parentElement.classList.add('thumb-err')"/></div>`
        : `<span class="master-row-platform">${esc(platTag)}</span>`}
      <div class="master-row-info">
        <div class="master-row-title">${esc(trunc(r.title || '(untitled)', 50))}</div>
        <div class="master-row-meta">
          <span class="m-price">${esc(priceStr)}</span>
          <span class="m-sep">·</span>
          <span class="m-platform">${esc(r.platform || '')}</span>
          <span class="m-sep">·</span>
          <span class="m-date">${esc(dateStr)}</span>
          ${status !== 'ok' ? `<span class="m-status ${esc(status)}">${esc(status)}</span>` : ''}
          ${r.lastRehunted ? `<span class="m-rehunted" title="Re-fetched ${new Date(r.lastRehunted).toLocaleString()}">↻</span>` : ''}
        </div>
      </div>
      <button class="master-row-rehunt" title="Re-fetch latest data" data-id="${esc(r.id)}">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 12a9 9 0 0 1 14.85-6.85L21 8"/><path d="M3 4v4h4"/><path d="M21 12a9 9 0 0 1-14.85 6.85L3 16"/><path d="M21 20v-4h-4"/></svg>
      </button>`;

    // Click row → toggle selection (but ignore re-hunt button click)
    row.addEventListener('click', (e) => {
      if (e.target.closest('.master-row-rehunt')) return;
      if (MasterUIState.selectedIds.has(r.id)) {
        MasterUIState.selectedIds.delete(r.id);
        row.classList.remove('selected');
      } else {
        MasterUIState.selectedIds.add(r.id);
        row.classList.add('selected');
      }
      updateMasterBulkBar();
    });

    // Re-hunt click
    row.querySelector('.master-row-rehunt')?.addEventListener('click', (e) => {
      e.stopPropagation();
      reHuntMasterRow(r.id);
    });

    list.appendChild(row);
  });
  updateMasterBulkBar();
}

function updateMasterBulkBar() {
  const bar = $('masterBulkBar');
  const cnt = $('masterBulkSelCount');
  const n = MasterUIState.selectedIds.size;
  if (!bar) return;
  if (n === 0) {
    bar.classList.add('hidden');
  } else {
    bar.classList.remove('hidden');
    if (cnt) cnt.textContent = `${n} selected`;
  }
}

async function masterSelectByStatus(targetStatus) {
  const rows = await getMasterRows();
  rows.forEach(r => {
    if (r.status === targetStatus) MasterUIState.selectedIds.add(r.id);
  });
  renderMasterRows(rows);
}

async function masterSelectAll() {
  const rows = await getMasterRows();
  rows.forEach(r => MasterUIState.selectedIds.add(r.id));
  renderMasterRows(rows);
}

function masterDeselectAll() {
  MasterUIState.selectedIds.clear();
  updateMasterStats(); // re-render
}

// ── Bulk tab inline columns panel ───────────────────────────
function toggleBulkColumnsPanel() {
  const panel = $('bulkColumnsPanel');
  if (!panel) return;
  const isHidden = panel.classList.contains('hidden');
  if (isHidden) {
    renderBulkColumnsGrid();
    panel.classList.remove('hidden');
  } else {
    panel.classList.add('hidden');
  }
}

function renderBulkColumnsGrid() {
  const grid = $('bulkColumnsGrid');
  if (!grid) return;
  const prefs = State.data?.settings?.bulkSheetColumns || {};
  const hasSaved = Object.keys(prefs).length > 0;

  // Add "Reset to default" button at top if not already there
  let resetBtn = document.getElementById('bulkColsResetBtn');
  if (!resetBtn) {
    resetBtn = document.createElement('button');
    resetBtn.id = 'bulkColsResetBtn';
    resetBtn.type = 'button';
    resetBtn.className = 'btn btn-ghost btn-xs';
    resetBtn.style.cssText = 'margin-bottom:8px;font-size:11px;opacity:.7';
    resetBtn.textContent = '↺ Reset to default';
    resetBtn.addEventListener('click', async () => {
      const defaults = { no: true, title: true, url: true, platform: true, price: true,
        labelCost: false, listPrice: false, profit: false, description: false,
        tags: false, variants: false, imageCount: false, videoCount: false,
        scrapedAt: false, status: false, videoUrl: false,
        weight: false, dimL: false, dimW: false, dimH: false,
        img1:false,img2:false,img3:false,img4:false,img5:false,
        img6:false,img7:false,img8:false,img9:false,img10:false };
      const updated = await msg({ action: 'UPDATE_SETTINGS', settings: { bulkSheetColumns: defaults } });
      if (updated?.success) {
        State.data.settings.bulkSheetColumns = defaults;
        renderBulkColumnsGrid();
      }
    });
    grid.parentElement.insertBefore(resetBtn, grid);
  }

  grid.innerHTML = '';
  ALL_BULK_COLS.forEach(col => {
    // Use saved pref if it exists, otherwise fall back to DEFAULT_ON_COLS
    let checked;
    if (hasSaved && prefs[col.key] !== undefined) {
      checked = prefs[col.key] === true;
    } else {
      checked = DEFAULT_ON_COLS.has(col.key);
    }
    const item = document.createElement('label');
    item.className = 'bulk-col-toggle' + (checked ? ' on' : '');
    item.innerHTML = `
      <span class="bulk-col-checkbox"></span>
      <span class="bulk-col-label">${esc(col.label)}</span>`;
    item.addEventListener('click', async (e) => {
      e.preventDefault();
      const newPrefs = { ...prefs };
      newPrefs[col.key] = !checked;
      const updated = await msg({
        action: 'UPDATE_SETTINGS',
        settings: { bulkSheetColumns: newPrefs }
      });
      if (updated?.success) {
        State.data.settings.bulkSheetColumns = newPrefs;
        renderBulkColumnsGrid();
      }
    });
    grid.appendChild(item);
  });
}

async function bulkDeleteMasterRows() {
  const ids = [...MasterUIState.selectedIds];
  if (ids.length === 0) return;

  // Get a few sample titles for the confirm dialog
  const rows = await getMasterRows();
  const samples = rows.filter(r => ids.includes(r.id)).slice(0, 3).map(r => trunc(r.title || '(untitled)', 40));
  const more = ids.length > 3 ? `\n  …and ${ids.length - 3} more` : '';
  const preview = samples.map(s => `  • ${s}`).join('\n');

  showConfirm(
    'Delete from Master Sheet',
    `Delete ${ids.length} product${ids.length === 1 ? '' : 's'} from Master Sheet?\n\n${preview}${more}\n\nThis cannot be undone.`,
    'Delete',
    async () => {
      const remaining = rows.filter(r => !ids.includes(r.id));
      await setMasterRows(remaining);
      MasterUIState.selectedIds.clear();
      await updateMasterStats();
      toast(`Deleted ${ids.length} product${ids.length === 1 ? '' : 's'}`, 'ok');
    }
  );
}

// ── Quick Re-hunt ────────────────────────────────────────────
async function reHuntMasterRow(rowId) {
  const rows = await getMasterRows();
  const target = rows.find(r => r.id === rowId);
  if (!target) { toast('Row not found', 'err'); return; }

  // Visual feedback
  const rowEl = document.querySelector(`.master-row[data-id="${esc(rowId)}"]`);
  const rehuntBtn = rowEl?.querySelector('.master-row-rehunt');
  if (rowEl) rowEl.classList.add('rehunting');
  if (rehuntBtn) rehuntBtn.classList.add('spinning');

  toast(`Re-fetching: ${trunc(target.title, 30)}…`, 'info');

  let scraped = null;
  let newTab = null;
  try {
    // Open the URL in a NEW background tab (active: false to avoid focus shift)
    newTab = await chrome.tabs.create({ url: target.url, active: false });

    // Wait for the page to load (poll for status='complete' up to 10s)
    const waitLoad = async () => {
      for (let i = 0; i < 50; i++) {
        await new Promise(r => setTimeout(r, 200));
        try {
          const t = await chrome.tabs.get(newTab.id);
          if (t.status === 'complete') return;
        } catch { return; }
      }
    };
    await waitLoad();

    // For lazy-loaded sites (Faire, Sam's), briefly activate the tab
    const isLazy = /faire\.com|samsclub\.com|amazon\.|walmart\.com/i.test(target.url);
    if (isLazy) {
      try {
        await chrome.tabs.update(newTab.id, { active: true });
        await new Promise(r => setTimeout(r, 1200));
      } catch {}
    }

    // Inject content script (idempotent)
    try {
      await chrome.scripting.executeScript({ target: { tabId: newTab.id }, files: ['content.js'] });
    } catch {}
    await new Promise(r => setTimeout(r, 200));

    // Send scrape message with timeout
    scraped = await new Promise(resolve => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      const t = setTimeout(() => finish(null), 18000);
      try {
        chrome.tabs.sendMessage(newTab.id, { action: 'SCRAPE_PAGE' }, (res) => {
          clearTimeout(t);
          if (chrome.runtime.lastError || !res?.success || !res?.data) finish(null);
          else finish(res.data);
        });
      } catch { finish(null); }
    });
  } catch (err) {
    // continue to cleanup
  } finally {
    if (newTab?.id) {
      try { await chrome.tabs.remove(newTab.id); } catch {}
    }
  }

  if (rowEl) rowEl.classList.remove('rehunting');
  if (rehuntBtn) rehuntBtn.classList.remove('spinning');

  if (!scraped) {
    toast('Re-hunt failed — try again later', 'err');
    return;
  }

  // Update the master row in place
  const updatedRows = rows.map(r => {
    if (r.id !== rowId) return r;
    return {
      ...r,
      title:        scraped.title || r.title,
      price:        scraped.price || r.price,
      description:  scraped.description || r.description,
      variants:     Array.isArray(scraped.variants) ? scraped.variants.join(', ') : r.variants,
      imageCount:   Array.isArray(scraped.images) ? scraped.images.length : r.imageCount,
      videoCount:   Array.isArray(scraped.videos) ? scraped.videos.length : r.videoCount,
      images:       Array.isArray(scraped.images) ? scraped.images.slice(0, 7) : r.images,
      videos:       Array.isArray(scraped.videos) ? scraped.videos.slice(0, 4) : r.videos,
      status:       'ok',
      lastRehunted: new Date().toISOString()
    };
  });
  await setMasterRows(updatedRows);
  await updateMasterStats();
  toast('✓ Updated with latest data', 'ok');
}

function renderMasterBatches(batches) {
  const list = $('masterBatchList');
  if (!list) return;
  if (batches.length === 0) {
    list.innerHTML = '<div class="bulk-empty"><p>No batches yet. Hunt some tabs first!</p></div>';
    return;
  }
  list.innerHTML = '';
  batches.slice(0, 20).forEach(b => {
    const d = new Date(b.date);
    const row = document.createElement('div');
    row.className = 'master-batch-row';
    row.innerHTML = `
      <span class="bdate">${d.toLocaleDateString()} ${d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span>
      <span class="bcount">${b.count} products</span>`;
    list.appendChild(row);
  });
}

async function resetMasterSheet() {
  showConfirm(
    'Reset Master Sheet',
    'Delete all master sheet data? This cannot be undone.',
    'Delete All',
    async () => {
      await setMasterRows([]);
      await setMasterBatches([]);
      toast('Master sheet reset', 'ok');
      updateMasterStats();
    }
  );
}

// ── Filename helper ──────────────────────────────────────────
function buildFilename(ext, suffix = '') {
  const prefix = (State.data?.settings?.bulkFilenamePrefix || 'zhunter_').trim();
  const d = new Date();
  const ymd = d.toISOString().slice(0, 10);
  const hm = `${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}`;
  return `${prefix}${ymd}_${hm}${suffix}.${ext}`;
}

// ── Sheet generation ─────────────────────────────────────────
// All possible columns. `defaultOn` matches background.js DEFAULT_DATA.settings.bulkSheetColumns.
const ALL_BULK_COLS = [
  { key: 'no',          label: '#'              },
  { key: 'title',       label: 'Tital'          },  // hyperlink to URL
  { key: 'url',         label: 'Soursing link'  },  // hyperlink
  { key: 'platform',    label: 'Platform'       },
  { key: 'price',       label: 'Price'          },  // numeric
  { key: 'labelCost',   label: 'Label Cost'     },  // empty for user
  { key: 'listPrice',   label: 'List Price'     },  // empty for user
  { key: 'profit',      label: 'Profit'         },  // formula
  { key: 'weight',      label: 'Weight'         },
  { key: 'dimL',        label: 'Length'         },
  { key: 'dimW',        label: 'Width'          },
  { key: 'dimH',        label: 'Height'         },
  { key: 'variants',    label: 'Variants'       },
  { key: 'imageCount',  label: 'Image Count'    },
  { key: 'videoCount',  label: 'Video Count'    },
  { key: 'videoUrl',    label: 'Video URL'      },
  { key: 'img1',        label: 'Image 1'        },
  { key: 'img2',        label: 'Image 2'        },
  { key: 'img3',        label: 'Image 3'        },
  { key: 'img4',        label: 'Image 4'        },
  { key: 'img5',        label: 'Image 5'        },
  { key: 'img6',        label: 'Image 6'        },
  { key: 'img7',        label: 'Image 7'        },
  { key: 'img8',        label: 'Image 8'        },
  { key: 'img9',        label: 'Image 9'        },
  { key: 'img10',       label: 'Image 10'       },
  { key: 'description', label: 'Description'    },
  { key: 'tags',        label: 'Tags'           },
  { key: 'status',      label: 'Status'         },
  { key: 'scrapedAt',   label: 'Date Added'     }
];

// Columns that are OFF by default (must be explicitly enabled by user)
const OPT_IN_COLS = new Set([
  'labelCost', 'listPrice', 'profit',
  'weight', 'dimL', 'dimW', 'dimH', 'variants',
  'imageCount', 'videoCount', 'videoUrl',
  'img1','img2','img3','img4','img5','img6','img7','img8','img9','img10',
  'description', 'tags', 'status', 'scrapedAt'
]);

// Columns ON by default: #, Title, Sourcing Link, Platform, Price
const DEFAULT_ON_COLS = new Set(['no', 'title', 'url', 'price']);

function getEnabledColumns() {
  const prefs = State.data?.settings?.bulkSheetColumns || {};
  const customCols = State.data?.settings?.customBulkColumns || [];
  const fullCols = [...ALL_BULK_COLS, ...customCols];
  const hasSavedPrefs = Object.keys(prefs).length > 0;

  const enabled = fullCols.filter(c => {
    if (hasSavedPrefs && prefs[c.key] !== undefined) {
      // User explicitly set this column — respect it
      return prefs[c.key] === true;
    }
    // Not in prefs → use DEFAULT_ON_COLS
    return DEFAULT_ON_COLS.has(c.key);
  });

  // Safety: always return at least the 5 default columns
  return enabled.length ? enabled : fullCols.filter(c => DEFAULT_ON_COLS.has(c.key));
}

// Spreadsheet column letter from 0-based index. 0 → A, 25 → Z, 26 → AA
function colLetter(idx) {
  let s = '';
  let n = idx;
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

// Strip currency symbols and commas, return number or empty string
function parsePriceNum(raw) {
  if (raw === null || typeof raw === 'undefined') return '';
  const s = String(raw).replace(/[^\d.]/g, '');
  if (!s || isNaN(parseFloat(s))) return '';
  return parseFloat(s);
}

function formatDateShort(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
  } catch { return ''; }
}

// Build a 2D representation of rows that includes both cell values AND
// hyperlink/formula metadata. The XLSX writer reads this rich form;
// the CSV writer flattens it.
function buildRichSheetData(rows) {
  const cols = getEnabledColumns();
  const header = cols.map(c => ({ value: c.label }));
  const out = [header];

  // ── Sort by originalIndex to match folder numbering ──
  // (remove platform-grouping sort — it mismatches folder numbers)
  const sortedRows = [...rows].sort((a, b) => (a.originalIndex ?? 0) - (b.originalIndex ?? 0));

  // Determine spreadsheet column letters for formula references
  const idxOf = {};
  cols.forEach((c, i) => { idxOf[c.key] = i; });

  sortedRows.forEach((r, rowIdx) => {
    const sheetRow = rowIdx + 2; // header is row 1 in spreadsheet

    const cellsByKey = {};

    cellsByKey.no       = { value: rowIdx + 1 };
    cellsByKey.title    = { value: r.title || '' };  // plain text, no hyperlink
    cellsByKey.url      = r.url
      ? { value: r.url, hyperlink: r.url, type: 'url' }
      : { value: '' };
    cellsByKey.platform = { value: r.platform || '' };

    const priceNum = parsePriceNum(r.price);
    cellsByKey.price = priceNum === ''
      ? { value: r.price || '' }
      : { value: priceNum, type: 'price' };

    cellsByKey.labelCost = { value: '', type: 'price' }; // empty
    cellsByKey.listPrice = { value: '', type: 'price' }; // empty

    // Profit formula: =IF(<List>="","",<List>-<Source>-<Label>)
    // Only emit when all three columns are visible
    if (idxOf.listPrice !== undefined && idxOf.price !== undefined && idxOf.labelCost !== undefined) {
      const listCol  = colLetter(idxOf.listPrice)  + sheetRow;
      const priceCol = colLetter(idxOf.price)      + sheetRow;
      const labelCol = colLetter(idxOf.labelCost)  + sheetRow;
      cellsByKey.profit = {
        value: '',
        formula: `IF(OR(${listCol}="",${priceCol}=""),"", ${listCol}-${priceCol}-IF(${labelCol}="",0,${labelCol}))`,
        type: 'price'
      };
    } else {
      cellsByKey.profit = { value: '' };
    }

    cellsByKey.description = { value: r.description || '' };
    cellsByKey.tags        = { value: typeof r.tags === 'string' ? r.tags : (Array.isArray(r.tags) ? r.tags.join(', ') : '') };
    cellsByKey.variants    = { value: Array.isArray(r.variants) ? r.variants.join(', ') : (r.variants || '') };
    cellsByKey.imageCount  = { value: r.imageCount || (Array.isArray(r.images) ? r.images.length : 0) };
    cellsByKey.videoCount  = { value: r.videoCount || (Array.isArray(r.videos) ? r.videos.length : 0) };
    
    // New fields for Phase 1
    cellsByKey.weight      = { value: r.weight || '' };
    cellsByKey.dimL        = { value: r.dimL || '' };
    cellsByKey.dimW        = { value: r.dimW || '' };
    cellsByKey.dimH        = { value: r.dimH || '' };
    cellsByKey.videoUrl    = r.videoUrl ? { value: r.videoUrl, hyperlink: r.videoUrl, type: 'url' } : { value: '' };

    const imgs = Array.isArray(r.images) ? r.images : [];
    for (let i = 0; i < 10; i++) {
      const u = imgs[i] || '';
      cellsByKey[`img${i+1}`] = u ? { value: u, hyperlink: u, type: 'url' } : { value: '' };
    }

    cellsByKey.scrapedAt   = { value: formatDateShort(r.scrapedAt) };
    cellsByKey.status      = { value: r.status || '' };

    const sheetRowCells = cols.map(c => cellsByKey[c.key] || { value: '' });
    out.push(sheetRowCells);
  });

  return { aoa: out, cols };
}

// Shared helper — returns a styled XLSX array buffer (green header, alternating rows,
// hyperlinks, frozen row, autofilter). Used by both the direct download and Master ZIP.
function buildStyledXlsxBuffer(rows) {
  if (typeof XLSX === 'undefined') return null;
  const rich = buildRichSheetData(rows);
  const aoaPlain = rich.aoa.map(r => r.map(cell => {
    if (cell.formula) return { f: cell.formula, v: '' };
    return cell.value;
  }));
  const ws = XLSX.utils.aoa_to_sheet(aoaPlain, { cellDates: false });
  const header = rich.aoa[0];
  const statusColIdx = header.findIndex(c => String(c.value||'').toLowerCase() === 'status');
  const headerBorder = {
    top:    { style: 'thin', color: { rgb: '1A7A40' } },
    bottom: { style: 'thin', color: { rgb: '1A7A40' } },
    left:   { style: 'thin', color: { rgb: '1A7A40' } },
    right:  { style: 'thin', color: { rgb: '1A7A40' } }
  };
  const cellBorder = {
    top:    { style: 'thin', color: { rgb: 'D1D5DB' } },
    bottom: { style: 'thin', color: { rgb: 'D1D5DB' } },
    left:   { style: 'thin', color: { rgb: 'D1D5DB' } },
    right:  { style: 'thin', color: { rgb: 'D1D5DB' } }
  };
  rich.aoa.forEach((row, ri) => {
    const rowBg = ri > 0 ? (ri % 2 === 0 ? 'F2F2F2' : 'FFFFFF') : null;
    row.forEach((cell, ci) => {
      const ref = colLetter(ci) + (ri + 1);
      if (!ws[ref]) ws[ref] = { t: 's', v: cell.value };
      if (ri === 0) {
        ws[ref].s = {
          font:      { bold: true, color: { rgb: 'FFFFFF' }, sz: 11, name: 'Calibri' },
          fill:      { patternType: 'solid', fgColor: { rgb: '217346' } },
          alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
          border:    headerBorder
        };
        return;
      }
      ws[ref].s = {
        fill:      { patternType: 'solid', fgColor: { rgb: rowBg } },
        font:      { name: 'Calibri', sz: 11, color: { rgb: '1F2937' } },
        alignment: { vertical: 'top' },
        border:    cellBorder
      };
      if (cell.hyperlink) {
        ws[ref].l = { Target: cell.hyperlink, Tooltip: 'Open link' };
        ws[ref].s.font = { name: 'Calibri', sz: 11, color: { rgb: '0563C1' }, underline: true };
      }
      if (cell.formula) { ws[ref].f = cell.formula; ws[ref].t = 'n'; }
      if (cell.type === 'price') {
        ws[ref].z = '#,##0.00';
        ws[ref].s.alignment = { ...ws[ref].s.alignment, horizontal: 'right' };
      }
      if (typeof cell.value === 'number' && !cell.formula) ws[ref].t = 'n';
      if (ci === statusColIdx) {
        const sv = String(cell.value || '').toLowerCase();
        if      (sv.includes('ok') || sv === 'done')        ws[ref].s.font = { name: 'Calibri', sz: 11, color: { rgb: '16A34A' }, bold: true };
        else if (sv.includes('partial'))                    ws[ref].s.font = { name: 'Calibri', sz: 11, color: { rgb: 'D97706' }, bold: true };
        else if (sv.includes('fail') || sv.includes('err')) ws[ref].s.font = { name: 'Calibri', sz: 11, color: { rgb: 'DC2626' }, bold: true };
      }
    });
  });
  const widths = rich.aoa[0].map((_, ci) => {
    let maxLen = 8;
    rich.aoa.forEach(r => {
      const v = r[ci] && r[ci].value;
      const s = (v === '' || v === null || v === undefined) ? '' : String(v);
      if (s.length > maxLen) maxLen = s.length;
    });
    return { wch: Math.min(Math.max(maxLen + 2, 8), 60) };
  });
  ws['!cols'] = widths;
  ws['!views'] = [{ state: 'frozen', ySplit: 1, xSplit: 0, topLeftCell: 'A2' }];
  if (rich.aoa.length > 1) {
    const lastCol = colLetter(rich.aoa[0].length - 1);
    const lastRow = rich.aoa.length;
    ws['!autofilter'] = { ref: `A1:${lastCol}${lastRow}` };
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Products');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx', cellStyles: true });
}

// XLSX with bold header, frozen top row, hyperlinks, currency format
function downloadXlsxRich(rich, filename) {
  if (typeof XLSX === 'undefined') {
    toast('XLSX library not loaded', 'err');
    return;
  }

  const aoaPlain = rich.aoa.map(r => r.map(cell => {
    if (cell.formula) return { f: cell.formula, v: '' };
    return cell.value;
  }));
  const ws = XLSX.utils.aoa_to_sheet(aoaPlain, { cellDates: false });

  const header = rich.aoa[0];
  const statusColIdx = header.findIndex(c => String(c.value||'').toLowerCase() === 'status');

  const headerBorder = {
    top:    { style: 'thin', color: { rgb: '1A7A40' } },
    bottom: { style: 'thin', color: { rgb: '1A7A40' } },
    left:   { style: 'thin', color: { rgb: '1A7A40' } },
    right:  { style: 'thin', color: { rgb: '1A7A40' } }
  };
  const cellBorder = {
    top:    { style: 'thin', color: { rgb: 'D1D5DB' } },
    bottom: { style: 'thin', color: { rgb: 'D1D5DB' } },
    left:   { style: 'thin', color: { rgb: 'D1D5DB' } },
    right:  { style: 'thin', color: { rgb: 'D1D5DB' } }
  };

  rich.aoa.forEach((row, ri) => {
    const rowBg = ri > 0 ? (ri % 2 === 0 ? 'F2F2F2' : 'FFFFFF') : null;

    row.forEach((cell, ci) => {
      const ref = colLetter(ci) + (ri + 1);
      if (!ws[ref]) ws[ref] = { t: 's', v: cell.value };

      if (ri === 0) {
        ws[ref].s = {
          font:      { bold: true, color: { rgb: 'FFFFFF' }, sz: 11 },
          fill:      { fgColor: { rgb: '00B050' } },
          alignment: { horizontal: 'center', vertical: 'center' },
          border: {
            top:    { style: 'medium', color: { rgb: '00B050' } },
            bottom: { style: 'medium', color: { rgb: '00B050' } },
            left:   { style: 'thin',   color: { rgb: '00B050' } },
            right:  { style: 'thin',   color: { rgb: '00B050' } },
          }
        };
        return;
      }

      ws[ref].s = {
        fill:      { patternType: 'solid', fgColor: { rgb: rowBg } },
        font:      { name: 'Calibri', sz: 11, color: { rgb: '1F2937' } },
        alignment: { vertical: 'top' },
        border:    cellBorder
      };

      if (cell.hyperlink) {
        ws[ref].l = { Target: cell.hyperlink, Tooltip: 'Open link' };
        ws[ref].s.font = { name: 'Calibri', sz: 11, color: { rgb: '0563C1' }, underline: true };
      }

      if (cell.formula) { ws[ref].f = cell.formula; ws[ref].t = 'n'; }

      if (cell.type === 'price') {
        ws[ref].z = '#,##0.00';   // no currency symbol
        ws[ref].s.alignment = { horizontal: 'right' };
      }

      if (typeof cell.value === 'number' && !cell.formula) ws[ref].t = 'n';

      if (ci === statusColIdx) {
        const sv = String(cell.value || '').toLowerCase();
        if      (sv.includes('ok') || sv === 'done')        ws[ref].s.font = { name: 'Calibri', sz: 11, color: { rgb: '16A34A' }, bold: true };
        else if (sv.includes('partial'))                    ws[ref].s.font = { name: 'Calibri', sz: 11, color: { rgb: 'D97706' }, bold: true };
        else if (sv.includes('fail') || sv.includes('err')) ws[ref].s.font = { name: 'Calibri', sz: 11, color: { rgb: 'DC2626' }, bold: true };
      }
    });
  });

  const widths = rich.aoa[0].map((_, ci) => {
    let maxLen = 8;
    rich.aoa.forEach(r => {
      const v = r[ci] && r[ci].value;
      const s = (v === '' || v === null || v === undefined) ? '' : String(v);
      if (s.length > maxLen) maxLen = s.length;
    });
    return { wch: Math.min(Math.max(maxLen + 2, 8), 60) };
  });
  ws['!cols'] = widths;
  ws['!views'] = [{ state: 'frozen', ySplit: 1, xSplit: 0, topLeftCell: 'A2' }];




  const wb = XLSX.utils.book_new();
  wb.Props = { Title: 'ZHunter PRO Catalog', Subject: 'Product hunt export', Author: 'ZHunter PRO', CreatedDate: new Date() };
  XLSX.utils.book_append_sheet(wb, ws, 'Products');
  zhSaveBlob(new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
}

// PDF Catalog - opens print dialog so user saves as PDF
function downloadPdfCatalog(rows, titleText) {
  if (!rows || rows.length === 0) { toast('No data to export', 'warn'); return; }

  const PLAT_COLOR = {
    'amazon':'#FFF3E0','walmart':'#E3F2FD',"sam's club":'#F3E5F5',
    'faire':'#E8F5E9','aliexpress':'#FBE9E7','alibaba':'#FBE9E7',
    'temu':'#E0F7FA','ebay':'#FFFDE7','etsy':'#FFF8E1',
    'daraz':'#FCE4EC','shein':'#FDE8F3',
  };
  function platColor(p) {
    const lp = (p||'').toLowerCase();
    for (const [k,v] of Object.entries(PLAT_COLOR)) if (lp.includes(k)) return v;
    return '#F5F5F5';
  }
  function escPdf(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  const cards = rows.map(r => {
    const bg = platColor(r.platform || r.category || '');
    const imgs = (r.imageUrls || r.images || []).slice(0,5).map(u =>
      '<a href="' + escPdf(u) + '" style="font-size:10px;color:#0563C1;word-break:break-all;display:block">' + escPdf(u) + '</a>'
    ).join('');
    return '<div class="card" style="background:' + bg + '">'
      + '<div class="card-header">'
      + (r.url ? '<a class="title" href="' + escPdf(r.url) + '">' + escPdf(r.title||r.url) + '</a>'
               : '<span class="title">' + escPdf(r.title||'Untitled') + '</span>')
      + '</div>'
      + '<div class="meta">'
      + (r.platform||r.category ? '<span class="badge">' + escPdf(r.platform||r.category) + '</span>' : '')
      + (r.price ? '<span class="price">' + escPdf(r.price) + '</span>' : '')
      + (r.scrapedAt ? '<span class="date">' + new Date(r.scrapedAt).toLocaleDateString() + '</span>' : '')
      + '</div>'
      + (r.description ? '<p class="desc">' + escPdf(r.description).slice(0,300) + (r.description.length>300?'...':'') + '</p>' : '')
      + (imgs ? '<div class="imgs"><strong>Images:</strong>' + imgs + '</div>' : '')
      + (r.videoUrl ? '<div class="vid"><strong>Video:</strong> <a href="' + escPdf(r.videoUrl) + '">' + escPdf(r.videoUrl) + '</a></div>' : '')
      + '</div>';
  }).join('');

  const html = '<!DOCTYPE html><html><head><meta charset="utf-8">'
    + '<title>' + escPdf(titleText||'ZHunter PRO Catalog') + '</title>'
    + '<style>'
    + 'body{font-family:Arial,sans-serif;font-size:12px;margin:20px;color:#111}'
    + 'h1{font-size:20px;margin-bottom:16px;color:#0E7490}'
    + '.card{border:1px solid #ccc;border-radius:6px;padding:14px 16px;margin-bottom:16px;page-break-inside:avoid}'
    + '.card-header{margin-bottom:6px}'
    + '.title{font-size:14px;font-weight:bold;color:#0563C1;text-decoration:none}'
    + '.meta{display:flex;gap:12px;align-items:center;margin-bottom:8px;flex-wrap:wrap}'
    + '.badge{background:#0E7490;color:#fff;border-radius:4px;padding:2px 8px;font-size:10px;font-weight:bold}'
    + '.price{font-weight:bold;color:#16A34A;font-size:13px}'
    + '.date{color:#666;font-size:10px}'
    + '.desc{margin:6px 0;color:#333;line-height:1.5}'
    + '.imgs{margin-top:6px}'
    + '.vid{margin-top:4px;font-size:10px;color:#555}'
    + '@media print{body{margin:10px}.card{border:1px solid #aaa}}'
    + '</style></head><body>'
    + '<h1>' + escPdf(titleText||'ZHunter PRO Catalog') + ' (' + rows.length + ' products)</h1>'
    + cards + '</body></html>';

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const blobUrl = URL.createObjectURL(blob);
  const safeTitle = (titleText || 'catalog').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'catalog';
  const filename = 'zhunter-' + safeTitle + '-' + new Date().toISOString().slice(0,10) + '.html';

  if (typeof chrome !== 'undefined' && chrome.downloads) {
    chrome.downloads.download({ url: blobUrl, filename: filename, saveAs: false }, () => {
      setTimeout(() => URL.revokeObjectURL(blobUrl), 3000);
      toast('PDF catalog saved as HTML — open the file and press Ctrl+P to print/save as PDF', 'ok');
    });
  } else {
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 3000);
    toast('PDF catalog saved — open the file and press Ctrl+P to print/save as PDF', 'ok');
  }
}

// CSV with =HYPERLINK() formulas (works in Google Sheets + Excel)
function downloadCsvRich(rich, filename) {
  const escapeCsv = (s) => {
    const v = String(s ?? '');
    if (v.includes(',') || v.includes('"') || v.includes('\n')) {
      return '"' + v.replace(/"/g, '""') + '"';
    }
    return v;
  };

  const lines = rich.aoa.map((row, ri) => row.map((cell, ci) => {
    if (ri === 0) return escapeCsv(cell.value);

    // Hyperlink as =HYPERLINK formula (Google Sheets + Excel both render)
    if (cell.hyperlink) {
      const target = cell.hyperlink.replace(/"/g, '""');
      const label  = String(cell.value || cell.hyperlink).replace(/"/g, '""');
      return `"=HYPERLINK(""${target}"",""${label}"")"`;
    }

    // Formula cell — output as Excel formula
    if (cell.formula) {
      return `"=${cell.formula.replace(/"/g, '""')}"`;
    }

    return escapeCsv(cell.value);
  }).join(','));

  const csv = lines.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 3000);
}

function downloadBatchSheet(format) {
  const rows = BulkState.results
    .filter(r => r.status !== 'fail')
    .sort((a, b) => (a.originalIndex ?? 0) - (b.originalIndex ?? 0));
  if (rows.length === 0) { toast('No data to download', 'warn'); return; }
  if (format !== 'xlsx') {
    toast('CSV export is disabled. Please download XLSX instead.', 'warn');
    return;
  }
  const rich = buildRichSheetData(rows);
  downloadXlsxRich(rich, buildFilename('xlsx'));
  toast(`Downloaded XLSX (${rows.length} products)`, 'ok');
}

async function copyMasterSheetToClipboard() {
  const rows = await getMasterRows();
  if (!rows.length) { toast('Master sheet is empty', 'warn'); return; }
  const rich = buildRichSheetData(rows);
  const tsv = rich.aoa.map(row => row.map(cell => {
    if (cell.hyperlink) return cell.hyperlink;
    if (cell.formula) return `=${cell.formula}`;
    return String(cell.value ?? '');
  }).join('\t')).join('\n');
  try {
    await navigator.clipboard.writeText(tsv);
    toast(`Copied ${rows.length} Master Sheet row(s) to clipboard`, 'ok');
  } catch (_) {
    toast('Clipboard permission denied. Download XLSX instead.', 'err');
  }
}

// ── Library import (CSV / XLSX / JSON backup) ────────────────
// Accepts: the Settings "Backup everything" JSON ({ masterSheet, batches }),
// a plain JSON array of rows, or a sheet with Title / Link / Price columns.
async function doImport(file) {
  const name = (file.name || '').toLowerCase();
  const toRow = r => {
    const pick = (...keys) => { for (const k of keys) { const v = r[k]; if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim(); } return ''; };
    const url = pick('url', 'Link', 'link', 'URL', 'Product Link', 'Soursing link', 'Sourcing link');
    if (!/^https?:\/\//i.test(url)) return null;
    return {
      id: `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      title: pick('title', 'Product Title', 'Title', 'name') || url,
      url, platform: pick('platform', 'Platform') || bgPlatformGuess(url),
      price: pick('price', 'Price', 'Scraped Price'),
      labelCost: pick('labelCost', 'Sourcing Price', 'Label Cost'), listPrice: pick('listPrice', 'List Price'),
      description: pick('description', 'Description'), tags: pick('tags', 'Tags'), variants: pick('variants', 'Variants'),
      imageCount: Number(pick('imageCount', 'Images')) || 0, videoCount: Number(pick('videoCount', 'Videos')) || 0,
      images: Array.isArray(r.images) ? r.images.slice(0, 7) : [], videos: Array.isArray(r.videos) ? r.videos.slice(0, 4) : [],
      status: pick('status', 'Status') || 'ok', scrapedAt: pick('scrapedAt', 'Date') || new Date().toISOString(), lastRehunted: ''
    };
  };
  const bgPlatformGuess = u => { try { return new URL(u).hostname.replace(/^www\./, '').split('.')[0]; } catch { return ''; } };
  try {
    let rows = [], batches = null;
    if (name.endsWith('.json')) {
      const parsed = JSON.parse(await file.text());
      const list = Array.isArray(parsed) ? parsed : (parsed.masterSheet || parsed.rows || parsed.links || []);
      rows = list.map(toRow).filter(Boolean);
      if (Array.isArray(parsed.batches)) batches = parsed.batches;
    } else if (name.endsWith('.csv') || name.endsWith('.tsv')) {
      if (typeof XLSX === 'undefined') throw new Error('Sheet library not loaded');
      const wb = XLSX.read(await file.text(), { type: 'string' });
      rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' }).map(toRow).filter(Boolean);
    } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
      if (typeof XLSX === 'undefined') throw new Error('Sheet library not loaded');
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' }).map(toRow).filter(Boolean);
    } else { toast('Use a .json, .csv or .xlsx file', 'warn'); return; }
    if (!rows.length) { toast('No product rows with links found in that file', 'warn'); return; }
    const existing = await getMasterRows();
    const seen = new Set(existing.map(r => (r.url || '').toLowerCase()));
    const fresh = rows.filter(r => !seen.has(r.url.toLowerCase()));
    await setMasterRows([...existing, ...fresh]);
    if (batches && batches.length) { const cur = await getMasterBatches(); await chrome.storage.local.set({ [BATCHES_KEY]: [...batches, ...cur].slice(0, 200) }); }
    await updateMasterStats();
    toast(`Imported ${fresh.length} product${fresh.length !== 1 ? 's' : ''}${rows.length - fresh.length ? ` (${rows.length - fresh.length} already in Library)` : ''}`, 'ok');
  } catch (e) {
    toast('Import failed: ' + (e?.message || 'unreadable file'), 'err');
  }
}

// ── Library → Master ZIP ─────────────────────────────────────
// Same layout as the bulk-hunt ZIP: products_sheet.xlsx + "Folder NN" per
// product with images and info.txt. Uses the selected rows if any are
// selected, otherwise every row in the Library. Images are re-fetched from
// their URLs (the Library only stores URLs, never image data).
async function downloadLibraryZip() {
  if (typeof JSZip === 'undefined') { toast('JSZip not loaded', 'err'); return; }
  const all = await getMasterRows();
  if (!all.length) { toast('Library is empty', 'warn'); return; }
  const picked = MasterUIState.selectedIds.size
    ? all.filter(r => MasterUIState.selectedIds.has(r.id))
    : all;
  if (!picked.length) { toast('Nothing selected', 'warn'); return; }

  const btn = $('masterExportMenuBtn');
  const originalLabel = btn ? btn.innerHTML : '';
  const setLabel = t => { if (btn) btn.textContent = t; };
  if (btn) btn.disabled = true;
  try {
    const zip = new JSZip();
    const rows = picked.map((r, i) => ({ ...r, originalIndex: i }));
    const xlsxBuf = buildStyledXlsxBuffer(rows);
    if (xlsxBuf) zip.file('products_sheet.xlsx', xlsxBuf);

    let fetched = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      setLabel(`Images ${i + 1}/${rows.length}…`);
      const folder = zip.folder(`Folder ${String(i + 1).padStart(2, '0')}`);
      let b64s = [];
      const urls = (r.images || []).slice(0, 7);
      if (urls.length) {
        try {
          const res = await msg({ action: 'FETCH_BASE64_BATCH', urls });
          if (res?.success && Array.isArray(res.results)) b64s = res.results.filter(x => x?.success && x.base64).map(x => x.base64);
        } catch (_) {}
      }
      fetched += b64s.length;
      folder.file('info.txt', [
        `Title:       ${r.title || '(none)'}`,
        `URL:         ${r.url}`,
        `Platform:    ${r.platform || ''}`,
        `Price:       ${r.price || ''}`,
        `Scraped:     ${r.scrapedAt ? new Date(r.scrapedAt).toLocaleString() : ''}`,
        `Images:      ${b64s.length}`,
        `Videos:      ${r.videos?.length || 0}`,
        '',
        'Description:',
        r.description || '(none)',
        '',
        'Video URLs:',
        ...(r.videos || []).map(v => '  - ' + v)
      ].join('\n'));
      if (b64s.length) {
        b64s.forEach((b64, ii) => {
          try { folder.file(`img_${String(ii + 1).padStart(2, '0')}.${extFromBase64(b64)}`, base64ToBytes(b64)); } catch (_) {}
        });
      } else if (urls.length) {
        folder.file('image_urls.txt', urls.join('\n'));
      }
    }

    setLabel('Building ZIP…');
    const blob = await zip.generateAsync(
      { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 3 } },
      m => setLabel(`Building ZIP… ${Math.round(m.percent)}%`)
    );
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = buildFilename('zip', '_library');
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 200);
    toast(`Library ZIP: ${rows.length} products, ${fetched} images`, 'ok');
  } catch (e) {
    toast('ZIP build failed: ' + (e?.message || ''), 'err');
  } finally {
    if (btn) { btn.innerHTML = originalLabel; btn.disabled = false; }
    updateMasterStats();
  }
}

async function downloadMasterSheet(format) {
  const rows = await getMasterRows();
  if (rows.length === 0) { toast('Master sheet is empty', 'warn'); return; }
  if (format === 'pdf') {
    downloadPdfCatalog(rows, 'Master Catalog');
    return;
  }
  const rich = buildRichSheetData(rows);
  if (format === 'xlsx') {
    downloadXlsxRich(rich, buildFilename('xlsx', '_master'));
  } else if (format === 'csv') {
    downloadCsvRich(rich, buildFilename('csv', '_master'));
  } else if (format === 'html') {
    downloadHtmlCatalog(rich, buildFilename('html', '_master'), 'Master Catalog');
  } else { return; }
  toast('Master ' + format.toUpperCase() + ' downloaded (' + rows.length + ' rows)', 'ok');
}

function downloadBatchHtmlCatalog() {
  const rows = BulkState.results
    .filter(r => r.status !== 'fail')
    .sort((a, b) => (a.originalIndex ?? 0) - (b.originalIndex ?? 0));
  if (rows.length === 0) { toast('No data to export', 'warn'); return; }
  const rich = buildRichSheetData(rows);
  downloadHtmlCatalog(rich, buildFilename('html'), 'Bulk Hunt Catalog');
  toast(`Downloaded HTML catalog (${rows.length} products)`, 'ok');
}

// Build a self-contained HTML catalog with table view + Copy-as-Sheet button.
// Uses SAME column structure as XLSX/CSV (consistent across formats).
function downloadHtmlCatalog(rich, filename, titleText) {
  const cols = rich.cols;
  const dataRows = rich.aoa.slice(1); // skip header

  // Build TSV (tab-separated) for clipboard — pastes cleanly into Google Sheets
  const tsvLines = [];
  tsvLines.push(rich.aoa[0].map(c => String(c.value || '')).join('\t'));
  dataRows.forEach((row) => {
    const cells = row.map(cell => {
      // For copy: prefer URL hyperlink as =HYPERLINK formula too
      if (cell.hyperlink) {
        return `=HYPERLINK("${cell.hyperlink}","${String(cell.value || '').replace(/"/g, "'")}")`;
      }
      if (cell.formula) {
        return `=${cell.formula}`;
      }
      return String(cell.value ?? '');
    });
    tsvLines.push(cells.join('\t'));
  });
  const tsvData = tsvLines.join('\n').replace(/`/g, '\\`'); // safe for template literal

  // Build HTML table cells
  const headerHtml = rich.aoa[0].map(c => `<th>${esc(c.value)}</th>`).join('');
  const bodyHtml = dataRows.map(row => {
    const cells = row.map((cell, ci) => {
      const colKey = cols[ci]?.key;
      let val = '';
      if (cell.hyperlink) {
        val = `<a href="${esc(cell.hyperlink)}" target="_blank" rel="noopener" class="cell-link">${esc(cell.value || cell.hyperlink)}</a>`;
      } else if (cell.formula) {
        val = `<span class="cell-formula" title="Auto-formula in XLSX/CSV">—</span>`;
      } else {
        const text = (cell.value === '' || cell.value === null || typeof cell.value === 'undefined') ? '' : String(cell.value);
        val = esc(text);
      }
      const classes = ['cell'];
      if (colKey === 'profit' || colKey === 'price' || colKey === 'listPrice' || colKey === 'labelCost') classes.push('cell-numeric');
      if (colKey === 'description') classes.push('cell-description');
      return `<td class="${classes.join(' ')}">${val}</td>`;
    }).join('');
    return `<tr>${cells}</tr>`;
  }).join('');

  const totalProducts = dataRows.length;
  const dateStr = new Date().toLocaleString();

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>ZHunter — ${esc(titleText)}</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #050816; color: #e2e8f0; padding: 24px; }
.container { max-width: 1400px; margin: 0 auto; }
.header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 14px; padding-bottom: 18px; border-bottom: 1px solid rgba(6,182,212,0.20); margin-bottom: 22px; }
.header h1 { font-size: 22px; font-weight: 800; background: linear-gradient(135deg, #06b6d4, #67e8f9); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
.header .subtitle { font-size: 12px; color: #64748b; margin-top: 4px; }
.actions { display: flex; gap: 10px; }
.btn { padding: 10px 16px; border-radius: 8px; border: 1px solid rgba(6,182,212,0.32); background: rgba(6,182,212,0.10); color: #67e8f9; font-size: 13px; font-weight: 700; cursor: pointer; transition: all 0.2s; }
.btn:hover { background: linear-gradient(135deg, #06b6d4, #0891b2); color: #050816; box-shadow: 0 0 20px rgba(6,182,212,0.45); }
.btn.copied { background: #10b981; color: white; border-color: #10b981; }
.table-wrap { overflow-x: auto; background: #0a1020; border: 1px solid rgba(6,182,212,0.15); border-radius: 12px; padding: 0; }
table { width: 100%; border-collapse: collapse; font-size: 12px; }
thead { background: linear-gradient(135deg, #0e7490, #06b6d4); position: sticky; top: 0; z-index: 5; }
thead th { padding: 12px 14px; text-align: left; color: white; font-weight: 800; letter-spacing: 0.04em; font-size: 11px; text-transform: uppercase; border-right: 1px solid rgba(255,255,255,0.10); white-space: nowrap; }
thead th:last-child { border-right: none; }
tbody tr { border-bottom: 1px solid rgba(148,163,184,0.06); transition: background 0.15s; }
tbody tr:hover { background: rgba(6,182,212,0.04); }
tbody tr:nth-child(even) { background: rgba(255,255,255,0.012); }
tbody tr:nth-child(even):hover { background: rgba(6,182,212,0.06); }
tbody td { padding: 10px 14px; color: #cbd5e1; vertical-align: top; max-width: 280px; }
.cell-link { color: #67e8f9; text-decoration: none; border-bottom: 1px dashed rgba(103,232,249,0.40); }
.cell-link:hover { color: #06b6d4; border-bottom-color: #06b6d4; }
.cell-numeric { text-align: right; font-variant-numeric: tabular-nums; color: #67e8f9; font-weight: 600; }
.cell-formula { color: #475569; font-style: italic; font-size: 10px; }
.cell-description { font-size: 11px; color: #94a3b8; max-width: 360px; line-height: 1.5; }
.footer { margin-top: 30px; padding-top: 16px; border-top: 1px solid rgba(6,182,212,0.10); font-size: 11px; color: #475569; text-align: center; }
@media print { body { background: white; color: black; } .actions { display: none; } thead { background: #0e7490; } }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <div>
      <h1>🛍️ ZHunter — ${esc(titleText)}</h1>
      <div class="subtitle">${totalProducts} product${totalProducts === 1 ? '' : 's'} · Generated ${esc(dateStr)}</div>
    </div>
    <div class="actions">
      <button class="btn" id="copySheetBtn" type="button">📋 Copy as Sheet</button>
      <button class="btn" onclick="window.print()" type="button">🖨 Print</button>
    </div>
  </div>

  <div class="table-wrap">
    <table>
      <thead><tr>${headerHtml}</tr></thead>
      <tbody>${bodyHtml}</tbody>
    </table>
  </div>

  <div class="footer">
    Generated by ZHunter PRO · Click "Copy as Sheet" then paste into Google Sheets / Excel
  </div>
</div>

<script>
(function() {
  var TSV_DATA = \`${tsvData}\`;
  document.getElementById('copySheetBtn').addEventListener('click', function() {
    var btn = this;
    var origText = btn.textContent;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(TSV_DATA).then(function() {
        btn.classList.add('copied');
        btn.textContent = '✓ Copied! Paste into Sheets';
        setTimeout(function() { btn.classList.remove('copied'); btn.textContent = origText; }, 2500);
      }).catch(function() { fallbackCopy(); });
    } else { fallbackCopy(); }
    function fallbackCopy() {
      var ta = document.createElement('textarea');
      ta.value = TSV_DATA;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); btn.classList.add('copied'); btn.textContent = '✓ Copied!'; setTimeout(function() { btn.classList.remove('copied'); btn.textContent = origText; }, 2500); }
      catch (e) { btn.textContent = '✗ Copy failed'; }
      document.body.removeChild(ta);
    }
  });
})();
</script>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 3000);
}

// Legacy helpers kept as thin wrappers for ZIP generator
function buildSheetData(rows, includeColumns = null) {
  const rich = buildRichSheetData(rows);
  return rich.aoa.map(r => r.map(cell => cell.value));
}

function downloadXlsxFromAOA(aoa, filename) {
  // Used only by ZIP — minimal version
  if (typeof XLSX === 'undefined') return;
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const widths = aoa[0].map((_, ci) => {
    const maxLen = aoa.reduce((m, row) => Math.max(m, String(row[ci] || '').length), 0);
    return { wch: Math.min(Math.max(maxLen + 2, 8), 60) };
  });
  ws['!cols'] = widths;
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Products');
  zhSaveBlob(new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
}

function downloadCsvFromAOA(aoa, filename) {
  const lines = aoa.map(row =>
    row.map(cell => {
      const s = String(cell ?? '');
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    }).join(',')
  );
  const csv = lines.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 3000);
}

// ── ZIP generation (Master ZIP) ──────────────────────────────
function safeSlug(s, max = 30) {
  return String(s || 'product')
    .replace(/[^a-zA-Z0-9 _-]/g, '')
    .trim()
    .slice(0, max)
    .replace(/\s+/g, '_') || 'product';
}

function extFromBase64(b64) {
  if (!b64) return 'jpg';
  if (b64.startsWith('data:image/png'))  return 'png';
  if (b64.startsWith('data:image/webp')) return 'webp';
  if (b64.startsWith('data:image/gif'))  return 'gif';
  if (b64.startsWith('data:image/avif')) return 'avif';
  return 'jpg';
}

function base64ToBytes(b64) {
  const comma = b64.indexOf(',');
  const data = comma >= 0 ? b64.slice(comma + 1) : b64;
  const bin = atob(data);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function downloadBatchZip() {
  if (typeof JSZip === 'undefined') { toast('JSZip not loaded', 'err'); return; }
  // Sort by originalIndex so Folder 01 == Sheet Row 1 == original tab order
  const rows = BulkState.results
    .filter(r => r.status !== 'fail')
    .sort((a, b) => (a.originalIndex ?? 0) - (b.originalIndex ?? 0));
  if (rows.length === 0) { toast('No data to ZIP', 'warn'); return; }

  const btn = $('bulkDlZipBtn');
  if (btn) { btn.disabled = true; btn.querySelector('.bulk-dl-text').textContent = 'Building ZIP…'; }

  try {
    const zip = new JSZip();

    // Styled XLSX — same green header as standalone XLSX download
    const xlsxBuf = buildStyledXlsxBuffer(rows);
    if (xlsxBuf) zip.file('products_sheet.xlsx', xlsxBuf);


    // Per-product folders — preserve ORIGINAL scraping order so Folder 01
    // always matches the first tab the user hunted (not a platform-sorted shuffle).
    // Users compare folders against their open tabs in order, so order matters.
    rows.forEach((r, i) => {
      const idx = String(i + 1).padStart(2, '0');
      const folderName = `Folder ${idx}`;
      const folder = zip.folder(folderName);

      // Info file
      const info = [
        `Title:       ${r.title || '(none)'}`,
        `URL:         ${r.url}`,
        `Platform:    ${r.platform || ''}`,
        `Price:       ${r.price || ''}`,
        `Status:      ${r.status}`,
        `Scraped:     ${new Date(r.scrapedAt).toLocaleString()}`,
        `Images:      ${r.imagesBase64?.length || 0}`,
        `Videos:      ${r.videos?.length || 0}`,
        ``,
        `Description:`,
        r.description || '(none)',
        ``,
        `Video URLs:`,
        ...(r.videos || []).map(v => '  - ' + v)
      ].join('\n');
      folder.file('info.txt', info);

      // Images — write base64 if available, otherwise note missing
      if (r.imagesBase64 && r.imagesBase64.length > 0) {
        r.imagesBase64.forEach((b64, ii) => {
          const ext = extFromBase64(b64);
          const num = String(ii + 1).padStart(2, '0');
          try {
            folder.file(`img_${num}.${ext}`, base64ToBytes(b64));
          } catch (_) {}
        });
      } else if (r.images && r.images.length > 0) {
        // If base64 conversion failed, save raw URLs in a txt so user can re-download manually
        folder.file('image_urls.txt', r.images.join('\n'));
      }
    });

    // Failed list
    const failed = BulkState.results.filter(r => r.status === 'fail');
    if (failed.length > 0) {
      const failedTxt = failed.map(r => `${r.url}  →  ${r.error || 'failed'}`).join('\n');
      zip.file('FAILED_URLS.txt', failedTxt);
    }

    // Generate ZIP blob (use chunked compression for memory)
    const blob = await zip.generateAsync(
      { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 3 } },
      (m) => {
        if (btn) btn.querySelector('.bulk-dl-text').textContent = `Building ZIP… ${Math.round(m.percent)}%`;
      }
    );

    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = buildFilename('zip');
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 200);
    toast(`ZIP downloaded (${rows.length} products)`, 'ok');
  } catch (e) {
    toast('ZIP build failed: ' + (e?.message || ''), 'err');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.querySelector('.bulk-dl-text').textContent = 'Download Master ZIP';
    }
  }
}

// ── Sequential image download (browser native) ───────────────
async function downloadBatchSequential() {
  const rows = BulkState.results.filter(r =>
    r.status !== 'fail' && r.imagesBase64?.length > 0
  );
  if (rows.length === 0) { toast('No images to download', 'warn'); return; }

  let total = 0;
  rows.forEach(r => total += r.imagesBase64.length);

  showConfirm(
    'Download Images Sequentially',
    `Download ${total} images one by one? The browser may ask for download permission.`,
    `Download ${total} Images`,
    async () => {
      const btn = $('bulkDlSeqBtn');
      if (btn) { btn.disabled = true; }
      let saved = 0;

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const idx = String(i + 1).padStart(2, '0');
        const baseName = `Folder ${idx}`;

        for (let ii = 0; ii < r.imagesBase64.length; ii++) {
          const ext = extFromBase64(r.imagesBase64[ii]);
          const num = String(ii + 1).padStart(2, '0');
          const a = document.createElement('a');
          a.href = r.imagesBase64[ii];
          a.download = `${baseName}_img_${num}.${ext}`;
          a.style.display = 'none';
          document.body.appendChild(a);
          a.click();
          setTimeout(() => a.remove(), 50);
          saved++;
          if (btn) btn.querySelector('.bulk-dl-text').textContent = `${saved}/${total}…`;
          await sleep(300);
        }
      }

      if (btn) {
        btn.disabled = false;
        btn.querySelector('.bulk-dl-text').textContent = 'Sequential';
      }
      toast(`Downloaded ${saved} images`, 'ok');
    }
  );
}

async function exportImagesAsZip(products) {
  const zip = new JSZip();
  const btn = document.getElementById('bulkZipBtn');
  const btnLabel = btn?.querySelector('.bulk-dl-text') || btn;
  if (btnLabel) btnLabel.textContent = 'Creating ZIP…';
  btn.disabled = true;

  for (const product of products) {
    // Clean folder name
    const folderName = (product.title || 'product')
      .replace(/[^a-zA-Z0-9\s-]/g, '')
      .trim()
      .substring(0, 50);
    
    const folder = zip.folder(folderName);
    const urls = product.imageUrls || product.images || [];
    
    for (let i = 0; i < urls.length; i++) {
      try {
        const response = await fetch(urls[i]);
        const blob = await response.blob();
        const ext = urls[i].includes('.png') ? 'png' : 'jpg';
        folder.file(`image_${i + 1}.${ext}`, blob);
      } catch(e) {
        console.log('Image fetch failed:', urls[i]);
      }
    }
  }

  const content = await zip.generateAsync({ type: 'blob' });
  const date = new Date().toISOString().slice(0,10);
  const url = URL.createObjectURL(content);
  const a = document.createElement('a');
  a.href = url;
  a.download = `zhunter_images_${date}.zip`;
  a.click();
  URL.revokeObjectURL(url);

  if (btnLabel) btnLabel.textContent = 'Images only';
  btn.disabled = false;
}

document.getElementById('bulkZipBtn')
  ?.addEventListener('click', () => {
    const products = BulkState.results.filter(r => r.status !== 'fail');
    exportImagesAsZip(products);
  });

// ════════���═════════════════════════════════════════════════════
// IMAGES TAB — Temu Image Downloader
// Scans the active page for product images (>=100×100px),
// lets the user select them in a 3-column grid, then downloads
// each as a square-cropped PNG or JPG ready for Temu upload.
// ══════════════════════════════════════════════════════════════

// ── State ─────────────────────────────────────────────────────
const ImgState = {
  images:      [],      // [{ src, w, h, role?, score? }]
  selected:    new Set(), // indices of visible (filtered) images
  roleFilter:  'all'   // v9: current role filter chip
};

// ── Inject into active tab via chrome.scripting ───────────────
async function scanPageImages() {
  const grid    = $('imgGrid');
  const scanner = $('imgScanningState');
  const countEl = $('imgFoundCount');

  if (!grid) return;

  grid.style.display = 'none';
  scanner?.classList.remove('hidden');
  setImgStatus('Hunting product images…', 'info');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
      scanner?.classList.add('hidden');
      grid.style.display = '';
      showImgEmpty('Navigate to a product page on Amazon, Walmart, or Sam\'s Club first.');
      setImgStatus('', '');
      return;
    }

const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const isAmz = location.hostname.includes('amazon');
        const isWal = location.hostname.includes('walmart');
        const isSam = location.hostname.includes('samsclub');
        const isWgs = location.hostname.includes('worldwidegolf');

        let images = [];

        if (isAmz) {
          // ── amzStrip: strip ALL Amazon CDN size/quality tokens ────────────────
          // Returns the BARE URL with no size token at all.
          // This is exactly what Amazon's "Click to see full view" lightbox uses —
          // the bare URL serves the full original image at whatever resolution the
          // seller uploaded (could be 2000×2000, 3000×3000, etc.).
          // e.g. .../I/91XXXXX._AC_SL500_.jpg → .../I/91XXXXX.jpg (full original!)
          const amzStrip = (url) => {
            if (!url) return '';
            if (!url.includes('media-amazon.com') && !url.includes('images-amazon.com')) return url;
            let u = url.split('?')[0];
            let prev = '';
            while (u !== prev) { prev = u; u = u.replace(/\._[A-Z0-9_,]{2,}_\./i, '.'); }
            return u.replace(/\.{2,}/g, '.');
          };

          // Dedup by Amazon image ID + reject obvious thumbnails
          const seenIds = new Set();
          const addImg = (url, keepBare) => {
            if (!url || !url.startsWith('http')) return;
            // Reject thumbnail-sized Amazon URLs (small token = tiny image)
            // e.g. ._AC_SR38,50_. (38x50px) or ._SX48_. (48px) etc.
            if (/\._[A-Z]{2,}_S[RXY]\d{1,3}[,_]/i.test(url)) return;
            if (/\._S[XY]\d{1,3}_\./i.test(url)) return; // _SX48_, _SY60_ etc.
            const final = keepBare ? amzStrip(url) || url : url;
            const m = final.match(/\/images\/I\/([A-Za-z0-9+/]+=*)/);
            const id = m ? m[1] : final;
            if (seenIds.has(id)) return;
            seenIds.add(id);
            images.push(final);
          };

          // Upgrade a 'large' URL to ._AC_SL1500_. (reliable 500-1500px CDN version)
          // NOTE: 'large' image IDs are stored as 500px source files.
          // Stripping their token gives the same 500px. But ._AC_SL1500_. asks Amazon
          // for the best it can serve up to 1500px, which is more reliable.
          const amzUpgrade = (url) => {
            if (!url) return url;
            const bare = amzStrip(url);
            return bare.replace(/\.(jpg|jpeg|png|webp|gif|avif)$/i, '._AC_SL1500_.$1');
          };

          // ── Strategy 1: Simple Extension Logic (ImageBlockATF) ───────────────
          let foundInitial = false;
          for (let script of document.querySelectorAll('script:not([src])')) {
            const t = script.textContent || '';
            if (t.includes('ImageBlockATF') && t.includes('initial')) {
              try {
                const hiResRegex = /"hiRes":"(https:\/\/[^"]+)"/g;
                const largeRegex = /"large":"(https:\/\/[^"]+)"/g;
                
                let match;
                let hiResCount = 0;
                while ((match = hiResRegex.exec(t)) !== null) {
                  addImg(match[1], false); // As requested, use exact hiRes URL
                  hiResCount++;
                }
                
                if (hiResCount > 0) {
                  foundInitial = true;
                  break;
                }
                
                // If no hiRes, fallback to large
                let largeCount = 0;
                while ((match = largeRegex.exec(t)) !== null) {
                  addImg(amzUpgrade(match[1]), false);
                  largeCount++;
                }
                
                if (largeCount > 0) {
                  foundInitial = true;
                  break;
                }
              } catch (e) {
                console.error("Error parsing ImageBlockATF", e);
              }
            }
          }

          // ── Strategy 2: Simple Extension DOM Fallback ────────────────────────
          if (!foundInitial) {
            const landingImage = document.getElementById('landingImage');
            if (landingImage) {
              const dataOldHires = landingImage.getAttribute('data-old-hires');
              if (dataOldHires) addImg(dataOldHires, false);
              else addImg(landingImage.src, false);
            }
            
            // Also look for alternate image thumbnails to extract their hi-res versions
            const altImages = document.querySelectorAll('.a-button-thumbnail img, .imageThumbnail img');
            altImages.forEach(img => {
              let src = img.src || '';
              // Simple extension strips size tokens to get original
              let hiResSrc = src.replace(/\._.*_\./, '.');
              if (hiResSrc) addImg(hiResSrc, false);
            });
          }

        } else if (isWal) {
          // Walmart: Only left thumbnail strip selectors - ignore logos
          const imgs = document.querySelectorAll('[data-testid="vertical-carousel-container"] img, [data-testid="media-thumbnail"] img');
          imgs.forEach(img => {
            let src = img.src || img.srcset?.split(' ')[0];
            if (!src) return;
            src = src.split('?')[0];
            images.push(src);
          });
        } else if (isSam) {
          // Sam's Club: Only left thumbnail strip selectors - ignore samsclub.com/content/dam/logos
          const imgs = document.querySelectorAll('[data-testid="item-page-vertical-carousel-hero-image-button"] img, [data-seo-id="hero-carousel-image"] img, [data-testid="media-thumbnail"] img');
          imgs.forEach(img => {
            let src = img.src || img.srcset?.split(' ')[0];
            if (!src) return;
            if (src.includes('samsclub.com/content/dam/logos')) return;
            src = src.split('?')[0]; // Strip ?odnHeight=117 parameters to get full size
            images.push(src);
          });
        } else if (isWgs) {
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
            images.push(large);
          });
        } else {
          // Generic fallback: filter out obvious non-product images
          const badGeneric = ['logo','icon','badge','banner','sprite','nav','header','footer','avatar','payment','star','rating','arrow','btn','button','social','share','close','menu'];
          document.querySelectorAll('img').forEach(img => {
            const src = img.src || '';
            if (!src.startsWith('http')) return;
            const lower = src.toLowerCase();
            if (badGeneric.some(w => lower.includes(w))) return;
            // Only include images with meaningful natural dimensions
            if (img.naturalWidth > 0 && img.naturalWidth < 100) return;
            images.push(src);
          });
        }

        // Apply Global Filters: max 20 images, no duplicates, filter out logo, icon, badge, banner
        // Apply Global Filters: max 20 images, robust duplicate removal, filter out logo, icon, badge, banner
        const finalImages = [];
        const seen = new Set();
        const badWords = ['logo', 'icon', 'badge', 'banner'];

        images.forEach(src => {
          if (!src || !src.startsWith('http')) return;
          const lower = src.toLowerCase();
          if (badWords.some(w => lower.includes(w))) return;
          
          let baseId = src;
          if (isAmz) {
            // Extract the core Amazon image ID (e.g., 71R1sB2V+AL)
            const match = src.match(/\/I\/([^.]+)/);
            if (match) baseId = match[1];
          } else {
            // Extract the core filename for Walmart/Sam's Club
            const parts = src.split('?')[0].split('/');
            baseId = parts[parts.length - 1];
          }

          if (seen.has(baseId)) return;
          seen.add(baseId);
          finalImages.push(src);
        });

        return finalImages.slice(0, 20);
      }
    });

    const scrapedUrls = results[0]?.result || [];

    scanner?.classList.add('hidden');
    grid.style.display = '';

    if (!scrapedUrls.length) {
      showImgEmpty('No product images found on this page.');
      setImgStatus('0 images found', '');
      return;
    }

    setImgStatus(`Found ${scrapedUrls.length} images. Filtering by size…`, 'info');

    // ── Bug fix: read user's imageMinSize setting (default 200) ──
    let minSize = 200;
    try {
      const d = await msg({ action: 'GET_DATA' });
      const userMin = parseInt(d?.settings?.imageMinSize, 10);
      if (!isNaN(userMin)) minSize = Math.max(0, userMin);
    } catch (_) {}

    // ── Bug fix: measure ALL images in parallel (3-5x faster) ────
    const allDims = await Promise.all(
      scrapedUrls.map(url => measureImage(url).catch(() => null))
    );
    const validImages = allDims.filter(
      dim => dim && dim.w >= minSize && dim.h >= minSize
    );

    if (!validImages.length) {
      showImgEmpty(`No valid product images found (all smaller than ${minSize}×${minSize}px).`);
      setImgStatus('0 images found', '');
      return;
    }

    // Sort by resolution: largest first so best quality images appear at the top
    validImages.sort((a, b) => (b.w * b.h) - (a.w * a.h));

    // ── v9: classify images with ZHClassifier if available ────
    if (window.ZHClassifier && typeof window.ZHClassifier.classifyAndDeduplicateImages === 'function') {
      ImgState.images   = window.ZHClassifier.classifyAndDeduplicateImages(validImages);
    } else {
      ImgState.images   = validImages;
    }
    ImgState.selected  = new Set(ImgState.images.map((_, i) => i));
    ImgState.roleFilter = 'all';

    // Reset role filter chips UI
    document.querySelectorAll('.role-chip').forEach(c => c.classList.toggle('active', c.dataset.role === 'all'));

    renderImgGrid();
    setImgStatus(`${ImgState.images.length} image${ImgState.images.length !== 1 ? 's' : ''} found`, 'ok');

  } catch (err) {
    console.error('[ImagesTab] scan error:', err);
    scanner?.classList.add('hidden');
    grid.style.display = '';
    showImgEmpty('Scan failed — refresh the page and try again.');
    setImgStatus('Error scanning page', 'err');
  }
}

// Resolve natural dimensions of an image URL.
// NOTE: Do NOT set crossOrigin = 'anonymous' here — Amazon CDN does not send
// CORS headers, so setting that attribute causes the browser to block the load
// entirely (the image errors out and gets silently dropped).
function measureImage(src) {
  return new Promise(resolve => {
    const img = new Image();
    // No crossOrigin — we only need width/height, not pixel data

    img.onload = () => resolve({ src, w: img.naturalWidth, h: img.naturalHeight });

    img.onerror = () => {
      // Amazon CDN images often fail to load via <img> due to CORS.
      // Keep ONLY genuine product image URLs (/images/I/ path, no thumbnail tokens).
      // Thumbnail tokens: _SR38,50_, _SX48_, _SY60_, _AC_US40_, etc. (tiny sizes)
      if ((src.includes('media-amazon.com') || src.includes('images-amazon.com'))
           && src.includes('/images/I/')) {
        // Reject obvious thumbnails
        if (/\._[A-Z]{2,}_S[RXY]\d{1,3}[,_]/i.test(src)) { resolve(null); return; }
        if (/\._S[XY]\d{1,3}_\./i.test(src)) { resolve(null); return; }
        if (/\._AC_US\d{1,3}_\./i.test(src)) { resolve(null); return; }
        // Bare URL (no token) = seller's original upload = highest quality
        const isBare = !/\._[A-Z0-9_,]{2,}_\./i.test(src);
        resolve({ src, w: isBare ? 2000 : 1500, h: isBare ? 2000 : 1500 });
      } else {
        resolve(null);
      }
    };

    img.src = src;
    // Timeout — if still loading after 5s, keep it (don't drop valid images)
    setTimeout(() => {
      if (img.naturalWidth > 0) {
        resolve({ src, w: img.naturalWidth, h: img.naturalHeight });
      } else {
        // Keep ALL Amazon CDN URLs on timeout
        if (src.includes('media-amazon.com') || src.includes('images-amazon.com')) {
          const isBare = !/\._[A-Z0-9_,]{2,}_\./i.test(src);
          resolve({ src, w: isBare ? 2000 : 1500, h: isBare ? 2000 : 1500 });
        } else {
          resolve(null);
        }
      }
    }, 6000);
  });
}

// ── Render grid ───��───────────────────────────────────────────
function renderImgGrid() {
  const grid    = $('imgGrid');
  const countEl = $('imgFoundCount');
  if (!grid) return;

  grid.innerHTML = '';

  const images = ImgState.images;
  if (!images.length) {
    showImgEmpty();
    if (countEl) countEl.textContent = '0 images';
    return;
  }
  if (countEl) countEl.textContent = `${images.length} image${images.length !== 1 ? 's' : ''}`;

  images.forEach((img, idx) => {
    const card = document.createElement('div');
    card.className = 'img-card' + (ImgState.selected.has(idx) ? ' selected' : '');
    card.dataset.idx = idx;

    card.innerHTML = `
      <div class="img-card-check">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      </div>
      <img class="img-card-thumb loading" src="${esc(img.src)}" alt="" crossorigin="anonymous" />
      <div class="img-card-label">${img.w && img.h ? img.w + '×' + img.h : ''}</div>
    `;

    // Fade in when loaded
    const thumbEl = card.querySelector('.img-card-thumb');
    thumbEl.addEventListener('load',  () => thumbEl.classList.remove('loading'));
    thumbEl.addEventListener('error', () => { thumbEl.style.opacity = '0.3'; thumbEl.alt = 'failed'; });

    card.addEventListener('click', () => {
      if (ImgState.selected.has(idx)) {
        ImgState.selected.delete(idx);
        card.classList.remove('selected');
      } else {
        ImgState.selected.add(idx);
        card.classList.add('selected');
      }
    });

    // Hover Zoom Preview listeners
    card.addEventListener('mouseenter', e => {
      if (typeof window.showHoverPreview === 'function') window.showHoverPreview(img, e);
    });
    card.addEventListener('mousemove', e => {
      if (typeof window.positionHoverPreview === 'function') window.positionHoverPreview(e);
    });
    card.addEventListener('mouseleave', () => {
      if (typeof window.hideHoverPreview === 'function') window.hideHoverPreview();
    });

    grid.appendChild(card);
  });
}

function showImgEmpty(msg) {
  const grid  = $('imgGrid');
  const empty = $('imgEmptyState');
  const countEl = $('imgFoundCount');
  if (!grid) return;
  grid.innerHTML = '';
  if (countEl) countEl.textContent = '0 images';
  const el = document.createElement('div');
  el.className = 'img-tab-empty';
  el.innerHTML = `
    <div class="img-tab-empty-ico">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
        <circle cx="8.5" cy="8.5" r="1.5"/>
        <polyline points="21 15 16 10 5 21"/>
      </svg>
    </div>
    <div class="img-tab-empty-title">No product images found</div>
    <div class="img-tab-empty-sub">${msg || 'Navigate to a product page on Amazon, Walmart, or Sam\'s Club, then click Refresh.'}</div>
  `;
  grid.appendChild(el);
}

// ── Download logic ────────────────────────────────────────────
async function downloadSelectedImages() {
  const selected = [...ImgState.selected];
  if (!selected.length) {
    setImgStatus('Select at least one image first', 'err');
    return;
  }

  const fmt = $('imgFormatSel')?.value || 'original';
  const btn = $('imgDownloadBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Processing…'; }
  setImgStatus(`Processing ${selected.length} image(s)…`, 'info');

  let ok = 0, failed = 0;

  for (let i = 0; i < selected.length; i++) {
    const idx     = selected[i];
    const imgData = ImgState.images[idx];
    if (!imgData) continue;

    setImgStatus(`Processing ${i + 1}/${selected.length}…`, 'info');

    try {
      let dataUrl = null;
      let ext     = 'jpg';

      if (fmt === 'original') {
        // ── ORIGINAL MODE: fetch raw bytes via background, zero re-encoding ──
        // This is the same quality as right-click → Save Image.
        const resp = await chrome.runtime.sendMessage({
          action: 'FETCH_BASE64',
          url:    imgData.src,
          // Pass settings that force bypass of all canvas conversion
          settings: { imageFormat: 'original', imageRatio: 'original', imageBg: 'original', imageMinSize: 0, imageMax5MB: false }
        });
        if (resp?.success && resp.base64) {
          dataUrl = resp.base64;
          // Derive extension from the actual content type returned
          if (resp.base64.startsWith('data:image/png'))       ext = 'png';
          else if (resp.base64.startsWith('data:image/webp')) ext = 'webp';
          else if (resp.base64.startsWith('data:image/gif'))  ext = 'gif';
          else if (resp.base64.startsWith('data:image/avif')) ext = 'avif';
          else                                                 ext = 'jpg';
        }
      } else {
        // ── JPG / PNG MODE: canvas conversion at high quality ──
        const mime = fmt === 'png' ? 'image/png' : 'image/jpeg';
        ext = fmt;
        dataUrl = await imgToDataUrl(imgData.src, mime);
      }

      if (!dataUrl) { failed++; continue; }

      const a = document.createElement('a');
      a.href     = dataUrl;
      a.download = `product_image_${i + 1}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      ok++;

      await new Promise(r => setTimeout(r, 200));
    } catch (e) {
      console.warn('[ImagesTab] download failed:', imgData.src, e);
      failed++;
    }
  }

  if (btn) {
    btn.disabled = false;
    btn.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      Download Selected`;
  }

  if (failed === 0) {
    setImgStatus(`✅ ${ok} image(s) downloaded`, 'ok');
    toast(`${ok} image(s) downloaded`, 'ok');
  } else {
    setImgStatus(`⚠️ ${ok} ok, ${failed} failed (CORS/blocked)`, 'err');
    toast(`${failed} image(s) failed (CORS/blocked)`, 'warn');
  }
}

// Convert image URL → data URL (JPG or PNG), high quality, aspect ratio preserved
// Used only when user explicitly selects JPG or PNG format.
function imgToDataUrl(src, mime) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width  = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');

      // White background (needed for JPG which has no transparency)
      if (mime === 'image/jpeg') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      ctx.drawImage(img, 0, 0);

      // Use 97% quality — near-lossless for JPEG
      const quality = mime === 'image/jpeg' ? 0.97 : 1.0;
      resolve(canvas.toDataURL(mime, quality));
    };

    img.onerror = () => resolve(null);
    img.src = src;
    setTimeout(() => resolve(null), 8000);
  });
}

function setImgStatus(text, type) {
  const bar = $('imgStatusBar');
  if (!bar) return;
  bar.textContent = text;
  bar.className = `img-status-bar${type ? ' ' + type : ''}`;
}

// ── Wire up Images tab buttons ────────────────────────────────
function initImagesTab() {
  // Refresh button — re-runs the hunt
  $('imgRefreshBtn')?.addEventListener('click', () => {
    ImgState.images = [];
    ImgState.selected.clear();
    scanPageImages();
  });

  // Hunt Images button — same as Refresh but with its own loading state
  $('imgHuntBtn')?.addEventListener('click', async () => {
    const btn      = $('imgHuntBtn');
    const titleEl  = btn?.querySelector('.img-hunt-title');
    const origText = titleEl?.textContent || '🎯 Hunt Images';
    if (btn) { btn.disabled = true; btn.classList.add('loading'); }
    if (titleEl) titleEl.textContent = 'Hunting…';
    ImgState.images = [];
    ImgState.selected.clear();
    await scanPageImages();
    if (btn) { btn.disabled = false; btn.classList.remove('loading'); }
    if (titleEl) titleEl.textContent = origText;
  });

  $('imgSelectAllBtn')?.addEventListener('click', () => {
    ImgState.images.forEach((_, i) => ImgState.selected.add(i));
    document.querySelectorAll('.img-card').forEach(c => c.classList.add('selected'));
  });

  $('imgDeselectAllBtn')?.addEventListener('click', () => {
    ImgState.selected.clear();
    document.querySelectorAll('.img-card').forEach(c => c.classList.remove('selected'));
  });

  // ── Smart Filter: Select 1000px+ HD Images Only (v9.1) ──
  $('imgSelectHdBtn')?.addEventListener('click', () => {
    ImgState.selected.clear();
    let count = 0;
    ImgState.images.forEach((img, i) => {
      const w = parseInt(img.w, 10) || 0;
      const h = parseInt(img.h, 10) || 0;
      let isHd = (w >= 1000 || h >= 1000);
      if (!isHd && img.src) {
        const match = img.src.match(/[_-](\d{3,5})x(\d{3,5})[_.]/);
        if (match) {
          const mw = parseInt(match[1], 10) || 0;
          const mh = parseInt(match[2], 10) || 0;
          if (mw >= 1000 || mh >= 1000) isHd = true;
        }
      }
      if (isHd) {
        ImgState.selected.add(i);
        count++;
      }
    });
    document.querySelectorAll('.img-card').forEach((c, idx) => {
      c.classList.toggle('selected', ImgState.selected.has(idx));
    });
    toast(count ? `Selected ${count} HD images (1000px+)` : 'No 1000px+ images found', count ? 'ok' : 'info');
  });

  // ── Direct 1-Click Save to Library (v9.1) ──
  $('huntDirectSaveBtn')?.addEventListener('click', directSaveProductToLibrary);

  // Initialize Hover Preview
  initImgHoverPreview();

  $('imgDownloadBtn')?.addEventListener('click', () => downloadSelectedImages());

  // ── Copy URLs button ──────────────────────────────────────────
  $('imgCopyUrlsBtn')?.addEventListener('click', async () => {
    const urls = [...ImgState.selected]
      .map(i => ImgState.images[i]?.src)
      .filter(Boolean);
    if (!urls.length) { toast('No images selected', 'warn'); return; }
    try {
      await navigator.clipboard.writeText(urls.join('\n'));
      toast(`${urls.length} URL${urls.length !== 1 ? 's' : ''} copied to clipboard`, 'ok');
    } catch (_) {
      toast('Clipboard access denied', 'err');
    }
  });

  // ── v9: Role filter chip bar ──────────────────────────────────
  document.querySelectorAll('.role-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.role-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      ImgState.roleFilter = chip.dataset.role || 'all';
      if (ImgState.roleFilter === 'all') {
        ImgState.selected = new Set(ImgState.images.map((_, i) => i));
      } else {
        ImgState.selected = new Set(
          ImgState.images
            .map((img, i) => ({ img, i }))
            .filter(({ img }) => (img.role || 'unknown') === ImgState.roleFilter)
            .map(({ i }) => i)
        );
      }
      renderImgGrid();
    });
  });

  // ── Auto re-scan when user switches/navigates to a new tab ───
  let _lastAutoScanUrl = '';
  function _autoRescan(tabId, url) {
    // Only trigger if Hunt tab is currently active in the sidepanel
    const huntPanel = document.getElementById('tab-hunt');
    if (!huntPanel || huntPanel.classList.contains('hidden')) return;
    if (!url || url === _lastAutoScanUrl) return;
    if (url.startsWith('chrome://') || url.startsWith('chrome-extension://')) return;
    _lastAutoScanUrl = url;
    // Small delay so the page has a moment to exist
    setTimeout(() => {
      ImgState.images = [];
      ImgState.selected.clear();
      scanPageImages();
    }, 800);
  }

  chrome.tabs.onActivated.addListener(async (info) => {
    try {
      const tab = await chrome.tabs.get(info.tabId);
      _autoRescan(info.tabId, tab.url);
    } catch (_) {}
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.active) {
      _autoRescan(tabId, tab.url);
    }
  });
}

// ── Image Hover Zoom Preview ─────────────────────────────────
function initImgHoverPreview() {
  const preview = $('imgHoverPreview');
  const previewImg = $('imgHoverPreviewImg');
  const previewBadge = $('imgHoverPreviewBadge');
  if (!preview || !previewImg) return;

  window.showHoverPreview = (img, e) => {
    if (!img?.src) return;
    previewImg.src = img.src;
    if (previewBadge) {
      const res = (img.w && img.h) ? `${img.w} × ${img.h}` : 'HD View';
      previewBadge.textContent = res;
    }
    preview.classList.remove('hidden');
    window.positionHoverPreview(e);
  };

  window.positionHoverPreview = (e) => {
    if (!preview || preview.classList.contains('hidden')) return;
    const pad = 14;
    const w = 240;
    const h = 240;
    let left = e.clientX + pad;
    let top = e.clientY - (h / 2);

    if (left + w > window.innerWidth) {
      left = Math.max(8, e.clientX - w - pad);
    }
    if (top < 8) top = 8;
    if (top + h > window.innerHeight - 8) {
      top = Math.max(8, window.innerHeight - h - 8);
    }

    preview.style.left = `${left}px`;
    preview.style.top = `${top}px`;
  };

  window.hideHoverPreview = () => {
    if (preview) {
      preview.classList.add('hidden');
      if (previewImg) previewImg.src = '';
    }
  };
}

// ── Direct 1-Click Save to Library ───────────────────────────
async function directSaveProductToLibrary() {
  const btn = $('huntDirectSaveBtn');
  if (!btn) return;
  btn.disabled = true;
  const origHtml = btn.innerHTML;
  btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;display:inline-block;vertical-align:middle;margin-right:6px"></span><span>Saving…</span>';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url || !/^https?:/i.test(tab.url)) {
      toast('Please open a product page on a website first', 'warn');
      return;
    }

    // Request active page scrape
    let scraped = await new Promise(resolve => {
      let done = false;
      const finish = val => { if (!done) { done = true; resolve(val); } };
      const timer = setTimeout(() => finish(null), 5000);
      chrome.tabs.sendMessage(tab.id, { action: 'SCRAPE_PAGE' }, res => {
        clearTimeout(timer);
        if (chrome.runtime.lastError || !res?.success || !res?.data) finish(null);
        else finish(res.data);
      });
    });

    const title = (scraped?.title || tab.title || 'Product').trim();
    const url = tab.url;
    const price = (scraped?.price || '').trim();
    const pickedImages = (scraped?.images && scraped.images.length)
      ? scraped.images.slice(0, 15)
      : (ImgState.images.map(img => img.src).slice(0, 15));

    const fastRes = await msg({
      action: 'ADD_LINK_FAST',
      url,
      title,
      folder: 'General',
      notes: '',
      price,
      tags: [],
      imageUrls: pickedImages,
      videos: scraped?.videos || []
    });

    if (fastRes?.success) {
      if (typeof refresh === 'function') await refresh();
      toast('Product saved to Library! 🛍️', 'ok');
      if (fastRes.link?.id) msg({ action: 'ENRICH_LINK', linkId: fastRes.link.id }).catch(() => {});
    } else if (fastRes?.reason === 'duplicate') {
      toast('Product already exists in Library', 'warn');
    } else {
      toast('Could not save product', 'err');
    }
  } catch (_) {
    toast('Save to library failed', 'err');
  } finally {
    btn.disabled = false;
    btn.innerHTML = origHtml;
  }
}

// ============================================================
// VIDEO TAB MODULE
// ============================================================

const VidTabState = {
  videos:        [],
  isScanning:    false,
  currentTabUrl: '',
  currentAsin:   null
};

function classifyVideo(url) {
  if (!url || typeof url !== 'string') return null;
  const u = url.toLowerCase().trim();
  if (/(youtube\.com|youtu\.be)/i.test(url)) {
    let ytId = null;
    try {
      const m = url.match(/(?:v=|\/embed\/|youtu\.be\/|\/v\/|\/shorts\/)([a-zA-Z0-9_-]{11})/);
      ytId = m ? m[1] : null;
    } catch (_) {}
    const thumbnail = ytId ? `https://img.youtube.com/vi/${ytId}/hqdefault.jpg` : null;
    return { url, type: 'youtube', label: 'YouTube', thumbnail, ytId };
  }
  // Brightcove CDN domains
  if (/brightcove\.net|bcovlive\.io|players\.brightcove\.com/i.test(url))
    if (u.includes('.m3u8')) return { url, type: 'hls', label: 'Brightcove', thumbnail: null, ytId: null };
    if (/\.(mp4|mov|webm)(\?|$)/.test(u)) return { url, type: 'mp4', label: 'Brightcove', thumbnail: null, ytId: null };
    // A player page (index.html?videoId=…) is not a media file — open it like YouTube.
    return { url, type: 'embed', label: 'Player', thumbnail: null, ytId: null };
  if (u.includes('.m3u8')) return { url, type: 'hls',    label: 'HLS',   thumbnail: null, ytId: null };
  if (u.includes('.mp4'))  return { url, type: 'mp4',    label: 'MP4',   thumbnail: null, ytId: null };
  if (u.includes('.webm')) return { url, type: 'webm',   label: 'WebM',  thumbnail: null, ytId: null };
  return { url, type: 'direct', label: 'Video', thumbnail: null, ytId: null };
}

function vidExtractAsin(url) {
  if (!url) return null;
  try {
    const m = url.match(/\/dp\/([A-Z0-9]{10})/i) || url.match(/\/gp\/product\/([A-Z0-9]{10})/i);
    return m ? m[1].toUpperCase() : null;
  } catch { return null; }
}

function initVideoTab() {
  $('vidHuntBtn')?.addEventListener('click', scanVideos);
  $('vidRefreshBtn')?.addEventListener('click', scanVideos);
  $('vidCopyAllBtn')?.addEventListener('click', copyAllVideoUrls);
  $('vidDownloadZipBtn')?.addEventListener('click', downloadAllVideosAsZip);
}

async function scanVideos() {
  if (VidTabState.isScanning) return;
  VidTabState.isScanning = true;

  const huntBtn       = $('vidHuntBtn');
  const scanningState = $('vidScanningState');
  const emptyState    = $('vidEmptyState');
  const statusBar     = $('vidStatusBar');
  const countEl       = $('vidFoundCount');

  if (huntBtn)       huntBtn.disabled = true;
  if (scanningState) scanningState.classList.remove('hidden');
  if (emptyState)    emptyState.style.display = 'none';
  if (statusBar)     statusBar.textContent = 'Scanning for videos…';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('no_tab');

    VidTabState.currentTabUrl = tab.url || '';
    VidTabState.currentAsin   = vidExtractAsin(tab.url || '');

    const scraped = await new Promise(resolve => {
      let done = false;
      const finish = v => { if (!done) { done = true; resolve(v); } };
      const t = setTimeout(() => finish(null), 10000);
      chrome.tabs.sendMessage(tab.id, { action: 'SCRAPE_PAGE' }, res => {
        clearTimeout(t);
        if (chrome.runtime.lastError || !res?.success || !res?.data) finish(null);
        else finish(res.data);
      });
    });

    const rawVideos = scraped?.videos || [];
    const seen = new Set();
    VidTabState.videos = rawVideos
      .filter(v => v && typeof v === 'string')
      .map(v => classifyVideo(v))
      .filter(v => {
        if (!v || seen.has(v.url)) return false;
        seen.add(v.url);
        return true;
      });

    // MP4 first (plays everywhere), then HLS (converted to MP4 on download),
    // then WebM, then YouTube. If a WebM has an MP4 twin (same path, different
    // extension) drop the WebM — the MP4 is the one people can open.
    const rank = { mp4: 0, direct: 1, hls: 2, webm: 3, youtube: 4, embed: 5 };
    const stem = u => u.split('?')[0].replace(/\.(mp4|webm|m4v|mov)$/i, '');
    const mp4Stems = new Set(VidTabState.videos.filter(v => v.type === 'mp4').map(v => stem(v.url)));
    VidTabState.videos = VidTabState.videos
      .filter(v => !(v.type === 'webm' && mp4Stems.has(stem(v.url))))
      .sort((a, b) => (rank[a.type] ?? 9) - (rank[b.type] ?? 9));

    renderVideoCards();

    const count = VidTabState.videos.length;
    if (countEl)   countEl.textContent  = `${count} video${count !== 1 ? 's' : ''}`;
    if (statusBar) statusBar.textContent = '';

    if (count === 0) {
      if (emptyState) emptyState.style.display = 'flex';
      toast('No videos found on this page', 'info');
    } else {
      toast(`Found ${count} video${count !== 1 ? 's' : ''}! 🎬`, 'ok');
    }
  } catch (e) {
    if (emptyState) emptyState.style.display = 'flex';
    if (statusBar)  statusBar.textContent  = 'Could not scan this page';
    toast('Could not scan this page — try refreshing', 'warn');
  } finally {
    VidTabState.isScanning = false;
    if (huntBtn)       huntBtn.disabled = false;
    if (scanningState) scanningState.classList.add('hidden');
  }
}

// Render-session counter: unique IDs per renderVideoCards() call
let _vidRenderSeed = 0;

function renderVideoCards() {
  const grid       = $('vidGrid');
  const emptyState = $('vidEmptyState');
  if (!grid) return;
  Array.from(grid.children).forEach(c => { if (c.id !== 'vidEmptyState') c.remove(); });
  if (!VidTabState.videos.length) {
    if (emptyState) emptyState.style.display = 'flex';
    return;
  }
  if (emptyState) emptyState.style.display = 'none';
  const frag = document.createDocumentFragment();
  _vidRenderSeed++;
  const seed = _vidRenderSeed;
  VidTabState.videos.forEach((video, idx) => frag.appendChild(buildVideoCard(video, idx, seed)));
  grid.appendChild(frag);
}

function buildVideoCard(video, idx, seed) {
  const uid = `${seed}_${idx}`; // unique per render-session + index
  const TYPE_CLASS = {
    hls: 'vid-badge-hls', mp4: 'vid-badge-mp4', webm: 'vid-badge-webm',
    youtube: 'vid-badge-youtube', direct: 'vid-badge-direct'
  };
  const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const trunc = (s,n) => { s=String(s||''); return s.length>n ? s.slice(0,n-1)+'…':s; };

  const card = document.createElement('div');
  card.className = 'vid-card';
  card.dataset.idx = idx;

  const thumbAreaId = 'vta-' + uid;

  // YouTube: use known thumbnail URL
  // MP4: will be generated async after card is in DOM
  // HLS/WebM/other: show site favicon
  let thumbHTML;
  if (video.type === 'youtube' && video.thumbnail) {
    thumbHTML = '<img class="vid-thumb-img" src="' + esc(video.thumbnail) + '" alt="Thumbnail" loading="lazy" data-onerror="vidicon">';
  } else if (video.type === 'mp4') {
    thumbHTML = '<div class="vid-thumb-icon">&#9654;</div>';
  } else {
    // Use tab's page favicon (e.g. Amazon logo) instead of CDN domain
    try {
      const pageDomain = new URL(VidTabState.currentTabUrl || video.url).hostname;
      thumbHTML = '<img class="vid-thumb-img" src="https://www.google.com/s2/favicons?domain=' + pageDomain + '&sz=128" alt="" style="width:64px;height:64px;object-fit:contain;opacity:0.85" data-onerror="vidicon">';
    } catch(_) {
      thumbHTML = '<div class="vid-thumb-icon">&#9654;</div>';
    }
  }

  card.innerHTML = `
    <div class="vid-card-top">
      <span class="vid-type-badge ${TYPE_CLASS[video.type] || 'vid-badge-direct'}">${esc(video.label)}</span>
      <span class="vid-url-preview" title="${esc(video.url)}">${esc(trunc(video.url, 55))}</span>
    </div>
    <div class="vid-thumbnail-area" id="vta-${uid}">${thumbHTML}</div>
    <div class="vid-progress-wrap hidden" id="vp-${uid}">
      <div class="vid-progress-bar"><div class="vid-progress-fill" id="vpf-${uid}" style="width:0%"></div></div>
      <span class="vid-progress-text" id="vpt-${uid}">Preparing...</span>
    </div>
    <div class="vid-card-actions">
      <button class="vid-action-btn vid-dl-btn"   id="vdl-${uid}" type="button">Download</button>
      <button class="vid-action-btn vid-copy-btn" id="vcp-${uid}" type="button">Copy URL</button>
      <button class="vid-action-btn vid-open-btn" id="vop-${uid}" type="button">Open</button>
    </div>`;

  card.querySelector('#vdl-' + uid).addEventListener('click', () => downloadVideo(video, uid));
  card.querySelector('#vcp-' + uid).addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(video.url); toast('URL copied!', 'ok'); }
    catch (_) { toast('Failed to copy', 'err'); }
  });
  card.querySelector('#vop-' + uid).addEventListener('click', () => chrome.tabs.create({ url: video.url }));

  // Generate MP4 frame thumbnail async after card is in DOM
  if (video.type === 'mp4') {
    setTimeout(() => generateMp4Thumbnail(video.url, thumbAreaId), 100);
  }

  return card;
}

// Capture a frame from an MP4 video using hidden video + canvas
function generateMp4Thumbnail(url, areaId) {
  const area = document.getElementById(areaId);
  if (!area) return;

  const vid = document.createElement('video');
  vid.crossOrigin = 'anonymous';
  vid.muted = true;
  vid.preload = 'metadata';
  vid.style.display = 'none';
  vid.src = url;
  document.body.appendChild(vid);

  const cleanup = () => { try { document.body.removeChild(vid); } catch(_) {} };

  vid.addEventListener('loadedmetadata', () => {
    // Seek to 10% of video duration for a meaningful frame
    vid.currentTime = Math.min(vid.duration * 0.1, 5);
  });

  vid.addEventListener('seeked', () => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width  = 320;
      canvas.height = 180;
      canvas.getContext('2d').drawImage(vid, 0, 0, 320, 180);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      // Replace play icon with captured frame
      const img = document.createElement('img');
      img.className = 'vid-thumb-img';
      img.src = dataUrl;
      img.alt = 'Thumbnail';
      const freshArea = document.getElementById(areaId);
      if (freshArea) { freshArea.innerHTML = ''; freshArea.appendChild(img); }
    } catch(_) {}
    cleanup();
  });

  // Timeout: if video fails to load in 8s, give up silently
  setTimeout(cleanup, 8000);
  vid.load();
}

async function downloadVideo(video, uid) {
  const progWrap = $(`vp-${uid}`);
  const progFill = $(`vpf-${uid}`);
  const progText = $(`vpt-${uid}`);
  const dlBtn    = $(`vdl-${uid}`);
  const setP = (pct, txt) => {
    if (progFill) progFill.style.width = pct + '%';
    if (progText) progText.textContent  = txt;
  };
  if (dlBtn)    dlBtn.disabled = true;
  if (progWrap) progWrap.classList.remove('hidden');
  const base = VidTabState.currentAsin ? `${VidTabState.currentAsin}_video` : 'product_video';
  try {
    if (video.type === 'youtube' || video.type === 'embed') {
      chrome.tabs.create({ url: video.url });
      toast(video.type === 'youtube' ? 'YouTube opened in a new tab (YouTube cannot be downloaded here)' : 'Player page opened in a new tab', 'info');
      return;
    }
    if (video.type === 'hls') {
      setP(5, 'Fetching HLS manifest…');
      const tsData = await downloadHLSStream(video.url, (done, total, note) =>
        setP(Math.round(5 + done / total * 88), note || `Segment ${done}/${total}…`)
      );
      setP(100, 'Saving file…');
      await zhSaveBlob(new Blob([tsData], { type: 'video/mp4' }), `${base}.mp4`);
      toast('Video saved as MP4', 'ok');
    } else {
      setP(30, 'Downloading…');
      const urlPath = video.url.split('?')[0];
      const extRaw  = urlPath.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '');
      const ext     = ['mp4','webm','mov','avi','mkv','m4v'].includes(extRaw) ? extRaw : 'mp4';
      let downloaded = false;
      try {
        // Fetch first so we can name the file; some CDNs need cookies → try with, then without.
        let resp = null;
        try { resp = await fetch(video.url, { credentials: 'include' }); } catch (_) {}
        if (!resp || !resp.ok) { try { resp = await fetch(video.url, { credentials: 'omit' }); } catch (_) {} }
        if (resp && resp.ok && !/text\/html/i.test(resp.headers.get('content-type') || '')) {
          const blob = await resp.blob();
          if (blob.size > 1024) { await zhSaveBlob(blob, `${base}.${ext}`); downloaded = true; }
        }
      } catch (_) {}
      if (!downloaded) {
        // Let Chrome download the URL itself (cross-origin anchors ignore the download name
        // and would just open the video in a tab).
        try { await chrome.downloads.download({ url: video.url, filename: `${base}.${ext}`, conflictAction: 'uniquify' }); downloaded = true; }
        catch (_) { chrome.tabs.create({ url: video.url }); toast('Could not download directly — opened the video in a tab', 'warn'); return; }
      }
      setP(100, 'Download started!');
      toast(ext === 'webm' ? 'Saved as WebM — this site only offers WebM for this video' : 'Video download started', ext === 'webm' ? 'warn' : 'ok');
    }
  } catch (e) {
    if (progText) progText.textContent = `Error: ${e.message || 'failed'}`;
    toast(`Download failed: ${e.message || 'Unknown error'}`, 'err');
  } finally {
    if (dlBtn) dlBtn.disabled = false;
    setTimeout(() => {
      if (progWrap) progWrap.classList.add('hidden');
      if (progFill) progFill.style.width = '0%';
    }, 3500);
  }
}

async function downloadHLSStream(m3u8Url, progressCb) {
  const MAX_SEG = 500, MAX_DEPTH = 3, CONCUR = 5;
  async function fetchSegments(url, depth) {
    if (depth > MAX_DEPTH) throw new Error('HLS playlist nested too deeply');
    const resp = await fetch(url, { credentials: 'omit' });
    if (!resp.ok) throw new Error(`Manifest fetch failed: HTTP ${resp.status}`);
    const text    = await resp.text();
    const baseUrl = url.substring(0, url.lastIndexOf('/') + 1);
    if (text.includes('#EXT-X-STREAM-INF')) {
      if (/#EXT-X-MEDIA:[^\n]*TYPE=AUDIO[^\n]*URI=/i.test(text)) separateAudio = true;
      const lines = text.split('\n');
      let bestBw = -1, bestVariant = null;
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i].startsWith('#EXT-X-STREAM-INF')) continue;
        const bwM = lines[i].match(/BANDWIDTH=(\d+)/);
        const bw  = bwM ? parseInt(bwM[1]) : 0;
        const nxt = lines[i + 1]?.trim();
        if (nxt && !nxt.startsWith('#') && bw > bestBw) {
          bestBw = bw; bestVariant = nxt.startsWith('http') ? nxt : baseUrl + nxt;
        }
      }
      if (!bestVariant) throw new Error('No variants in master playlist');
      return fetchSegments(bestVariant, depth + 1);
    }
    // fMP4 playlists carry an init segment (#EXT-X-MAP). Remember it so the
    // output is a valid MP4 (init + media segments) instead of raw fragments.
    const mapM = text.match(/#EXT-X-MAP:[^\n]*URI="([^"]+)"/);
    if (mapM) initSegmentUrl = mapM[1].startsWith('http') ? mapM[1] : baseUrl + mapM[1];
    return text.split('\n').filter(l => l.trim() && !l.startsWith('#'))
      .slice(0, MAX_SEG).map(l => l.trim().startsWith('http') ? l.trim() : baseUrl + l.trim());
  }
  let initSegmentUrl = null, separateAudio = false;
  const segments = await fetchSegments(m3u8Url, 0);
  if (separateAudio) toast('This stream keeps audio in a separate track — the MP4 may be silent', 'warn');
  if (!segments.length) throw new Error('No segments found in HLS playlist');
  const buffers = new Array(segments.length);
  let completed = 0;
  for (let i = 0; i < segments.length; i += CONCUR) {
    const batch   = segments.slice(i, i + CONCUR);
    const results = await Promise.all(batch.map(async (segUrl, bi) => {
      const r = await fetch(segUrl, { credentials: 'omit' });
      if (!r.ok) throw new Error(`Segment ${i + bi} failed`);
      return { idx: i + bi, buf: await r.arrayBuffer() };
    }));
    for (const { idx, buf } of results) { buffers[idx] = buf; progressCb?.(++completed, segments.length); }
  }
  const totalLen = buffers.reduce((s, b) => s + b.byteLength, 0);
  const combined = new Uint8Array(totalLen);
  let offset = 0;
  for (const buf of buffers) { combined.set(new Uint8Array(buf), offset); offset += buf.byteLength; }

  // ── Make it a real MP4 ──────────────────────────────────────
  // Case 1: fMP4 segments → prepend the init segment; the result is a valid MP4.
  if (initSegmentUrl) {
    const r = await fetch(initSegmentUrl, { credentials: 'omit' });
    if (r.ok) {
      const init = new Uint8Array(await r.arrayBuffer());
      const out = new Uint8Array(init.byteLength + combined.byteLength);
      out.set(init, 0); out.set(combined, init.byteLength);
      return out;
    }
  }
  // Case 2: MPEG-TS segments (0x47 sync byte) → remux to MP4 with mux.js (no re-encode).
  if (combined.byteLength && combined[0] === 0x47 && typeof muxjs !== 'undefined') {
    progressCb?.(segments.length, segments.length, 'Converting to MP4…');
    return await tsToMp4(combined);
  }
  return combined;
}

// MPEG-TS → fragmented MP4 using mux.js. Lossless container change only.
function tsToMp4(tsBytes) {
  return new Promise((resolve, reject) => {
    try {
      const Transmuxer = (muxjs.mp4 && muxjs.mp4.Transmuxer) || muxjs.Transmuxer;
      const t = new Transmuxer({ remux: true, keepOriginalTimestamps: true });
      const parts = [];
      let gotInit = false;
      t.on('data', seg => {
        if (seg.initSegment && !gotInit) { parts.push(seg.initSegment); gotInit = true; }
        if (seg.data) parts.push(seg.data);
      });
      t.on('done', () => {
        if (!parts.length) { reject(new Error('Remux produced no data')); return; }
        const len = parts.reduce((n, p) => n + p.byteLength, 0);
        const out = new Uint8Array(len);
        let o = 0;
        for (const p of parts) { out.set(p, o); o += p.byteLength; }
        resolve(out);
      });
      t.on('error', e => reject(e instanceof Error ? e : new Error('Remux failed')));
      // Feed in chunks so very long streams do not block the UI.
      const CH = 2 * 1024 * 1024;
      for (let i = 0; i < tsBytes.byteLength; i += CH) t.push(tsBytes.subarray(i, i + CH));
      t.flush();
    } catch (e) { reject(e); }
  });
}

async function copyAllVideoUrls() {
  if (!VidTabState.videos.length) { toast('No videos scanned yet', 'warn'); return; }
  try {
    await navigator.clipboard.writeText(VidTabState.videos.map(v => v.url).join('\n'));
    toast(`${VidTabState.videos.length} URL${VidTabState.videos.length !== 1 ? 's' : ''} copied! 📋`, 'ok');
  } catch { toast('Failed to copy URLs', 'err'); }
}

async function downloadAllVideosAsZip() {
  if (!VidTabState.videos.length) { toast('No videos scanned yet', 'warn'); return; }
  if (typeof JSZip === 'undefined') { toast('JSZip not loaded', 'err'); return; }
  const btn = $('vidDownloadZipBtn');
  const statusBar = $('vidStatusBar');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Preparing…'; }
  const baseName     = VidTabState.currentAsin || 'product';
  const downloadable = VidTabState.videos.filter(v => v.type !== 'youtube');
  const ytVids       = VidTabState.videos.filter(v => v.type === 'youtube');
  if (!downloadable.length && ytVids.length) {
    toast('Only YouTube videos — use Copy All URLs instead', 'warn');
    if (btn) { btn.disabled = false; btn.textContent = '🗂 Download All'; }
    return;
  }
  try {
    const zip = new JSZip();
    if (ytVids.length) zip.file('youtube_links.txt', ytVids.map(v => v.url).join('\n'));
    for (let i = 0; i < downloadable.length; i++) {
      const video    = downloadable[i];
      const num      = String(i + 1).padStart(2, '0');
      const fileBase = `${baseName}_video_${num}`;
      if (statusBar) statusBar.textContent = `Processing ${i + 1}/${downloadable.length}…`;
      try {
        if (video.type === 'hls') {
          const tsData = await downloadHLSStream(video.url, (done, total, note) => {
            if (statusBar) statusBar.textContent = note ? `Video ${i + 1}: ${note}` : `Video ${i + 1}: ${done}/${total} segments…`;
          });
          zip.file(`${fileBase}.mp4`, tsData);
        } else {
          let resp = null;
          try { resp = await fetch(video.url, { credentials: 'include' }); } catch (_) {}
          if (!resp || !resp.ok) resp = await fetch(video.url, { credentials: 'omit' });
          if (resp.ok) {
            const extRaw = video.url.split('?')[0].split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '');
            const ext    = ['mp4','webm','mov'].includes(extRaw) ? extRaw : 'mp4';
            zip.file(`${fileBase}.${ext}`, await resp.arrayBuffer());
          } else {
            zip.file(`${fileBase}_url.txt`, video.url);
          }
        }
      } catch (e) {
        zip.file(`${fileBase}_failed.txt`, `Failed: ${e.message}\nURL: ${video.url}`);
      }
    }
    if (statusBar) statusBar.textContent = 'Building ZIP…';
    const blob   = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 3 } });
    await zhSaveBlob(blob, `${baseName}_videos_${new Date().toISOString().slice(0, 10)}.zip`);
    toast(`ZIP downloaded (${downloadable.length} video${downloadable.length !== 1 ? 's' : ''})`, 'ok');
    if (statusBar) statusBar.textContent = `Done`;
  } catch (e) {
    toast(`ZIP failed: ${e.message || 'Unknown error'}`, 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🗂 Download All'; }
  }
}

// Init video tab on load
document.addEventListener('DOMContentLoaded', () => initVideoTab(), { once: true });

// ── Import Preview Dialog ─────────────────────────────────────
// Called by sidepanel-shell.js when the user clicks "Add open tabs to queue".
// Shows a grouped modal: Accepted / Already queued / Unsupported.
// User can deselect individual rows before confirming.
//
// @param {Array}  candidates  - [{url, title, source}] raw tabs from the browser
// @param {string} sourceLabel - label for display only (e.g. 'open_tab')
// @param {Object} opts        - { adder: async(items) => result }
async function showQueueImportPreview(candidates, sourceLabel, opts = {}) {
  const $ = id => document.getElementById(id);
  const modal    = $('queueImportPreviewModal');
  const summary  = $('qipSummary');
  const groups   = $('qipGroups');
  const confirmBtn = $('qipConfirmBtn');
  const cancelBtn  = $('qipCancelBtn');
  const closeBtn   = $('qipClose');
  const selAllBtn  = $('qipSelectAllBtn');
  const selNoneBtn = $('qipSelectNoneBtn');
  if (!modal) return;

  // ── Show loading state ─────��───────────────────────────────
  summary.innerHTML = '';
  groups.innerHTML  = `<div class="qip-loading"><span class="spinner"></span> Checking ${candidates.length} tab${candidates.length !== 1 ? 's' : ''} against queue…</div>`;
  confirmBtn.disabled = true;
  confirmBtn.textContent = 'Add 0 to queue';
  modal.classList.remove('hidden');

  // ── Call backend preview ───────────────────────────────────
  let preview = { accepted: [], duplicates: [], rejected: [] };
  try {
    const res = await msg({ action: 'PREVIEW_BULK_QUEUE', items: candidates });
    if (res) {
      preview.accepted   = Array.isArray(res.accepted)   ? res.accepted   : [];
      preview.duplicates = Array.isArray(res.duplicates) ? res.duplicates : [];
      preview.rejected   = Array.isArray(res.rejected)   ? res.rejected   : [];
    }
  } catch (e) {
    // If preview action unavailable, treat all as accepted
    preview.accepted = candidates;
  }

  // ── Build summary pills ───────────────────────────────────
  const pills = [
    preview.accepted.length   ? `<span class="qip-pill qip-pill-ok">✓ ${preview.accepted.length} new</span>`   : '',
    preview.duplicates.length ? `<span class="qip-pill qip-pill-dup">⚑ ${preview.duplicates.length} duplicate${preview.duplicates.length !== 1 ? 's' : ''}</span>` : '',
    preview.rejected.length   ? `<span class="qip-pill qip-pill-skip">✕ ${preview.rejected.length} unsupported</span>` : '',
  ].filter(Boolean).join('');
  summary.innerHTML = pills || '<span class="qip-pill qip-pill-skip">Nothing to import</span>';

  // ── Render grouped item rows ──────────────────────────────
  function makeRow(item, kind) {
    const isOk   = kind === 'ok';
    const isDup  = kind === 'dup';
    const isSkip = kind === 'skip';
    const host = (() => { try { return new URL(item.url).hostname.replace(/^www\./,''); } catch(_){ return ''; } })();
    const faviconUrl = `https://www.google.com/s2/favicons?sz=16&domain=${encodeURIComponent(host)}`;
    const row = document.createElement('label');
    row.className = `qip-item${isDup ? ' is-dup' : ''}${isSkip ? ' is-skip' : ''}`;
    row.dataset.url = item.url;
    const cb = isSkip ? '' : `<input type="checkbox" ${isOk ? 'checked' : ''} data-url="${item.url.replace(/"/g,'&quot;')}">`;
    const badge = isDup  ? `<span class="qip-badge qip-badge-dup">Already queued</span>`
                : isSkip ? `<span class="qip-badge qip-badge-skip">Unsupported</span>` : '';
    row.innerHTML = `
      ${cb}
      <img class="qip-item-favicon" src="${faviconUrl}" alt="" loading="lazy" onerror="this.style.display='none'">
      <span class="qip-item-text">
        <span class="qip-item-title">${(item.title || host || item.url).substring(0, 80)}</span>
        <span class="qip-item-url">${host || item.url.substring(0, 60)}</span>
      </span>
      ${badge}`;
    return row;
  }

  function renderGroups() {
    groups.innerHTML = '';

    if (preview.accepted.length) {
      const g = document.createElement('div');
      g.innerHTML = `<div class="qip-group-label">New — will be added</div>`;
      preview.accepted.forEach(i => g.appendChild(makeRow(i, 'ok')));
      groups.appendChild(g);
    }
    if (preview.duplicates.length) {
      const g = document.createElement('div');
      g.innerHTML = `<div class="qip-group-label">Already in queue</div>`;
      preview.duplicates.forEach(i => g.appendChild(makeRow(i, 'dup')));
      groups.appendChild(g);
    }
    if (preview.rejected.length) {
      const g = document.createElement('div');
      g.innerHTML = `<div class="qip-group-label">Unsupported sites</div>`;
      preview.rejected.forEach(i => g.appendChild(makeRow(i, 'skip')));
      groups.appendChild(g);
    }
    if (!preview.accepted.length && !preview.duplicates.length && !preview.rejected.length) {
      groups.innerHTML = '<div class="empty"><p>No product tabs found in your open tabs.</p></div>';
    }
    syncConfirmBtn();
  }

  function syncConfirmBtn() {
    const checked = [...groups.querySelectorAll('input[type=checkbox]:checked')];
    confirmBtn.disabled = checked.length === 0;
    confirmBtn.textContent = `Add ${checked.length} to queue`;
  }

  renderGroups();
  groups.addEventListener('change', syncConfirmBtn);

  // ── Select All / None ────────────────────────────────────
  selAllBtn.onclick  = () => { groups.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = true);  syncConfirmBtn(); };
  selNoneBtn.onclick = () => { groups.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = false); syncConfirmBtn(); };

  // ── Close helpers ────────────────────────────────────────
  function closeModal() {
    modal.classList.add('hidden');
    groups.innerHTML  = '';
    summary.innerHTML = '';
  }
  closeBtn.onclick  = closeModal;
  cancelBtn.onclick = closeModal;
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); }, { once: false });

  // ── Confirm: gather checked items and call adder ─────────
  confirmBtn.onclick = async () => {
    const checkedUrls = new Set([...groups.querySelectorAll('input[type=checkbox]:checked')].map(cb => cb.dataset.url));
    const toAdd = [...preview.accepted, ...preview.duplicates]
      .filter(i => checkedUrls.has(i.url))
      .map(i => ({ url: i.url, title: i.title || '', source: sourceLabel || 'open_tab' }));
    if (!toAdd.length) { closeModal(); return; }

    confirmBtn.disabled = true;
    confirmBtn.textContent = `Adding ${toAdd.length}…`;
    try {
      if (typeof opts.adder === 'function') {
        await opts.adder(toAdd);
      }
    } catch(e) {
      if (typeof toast === 'function') toast('Failed to add items: ' + (e.message || 'Unknown error'), 'err');
    }
    closeModal();
  };
}
