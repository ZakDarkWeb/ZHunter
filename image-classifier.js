// ============================================================
// ZHunter PRO v9.0.0 — Image Classifier
// Classifies images into roles (hero/gallery/variant/lifestyle/unknown)
// and scores their quality (0-100). Used by the Hunt tab and
// export engine to produce richer media metadata.
// ============================================================
'use strict';

/**
 * Classify an image's role based on URL, dimensions, position, and alt text.
 * @param {string} src    - Image URL
 * @param {number} w      - Natural width (px)
 * @param {number} h      - Natural height (px)
 * @param {number} pos    - DOM position index (0 = first/top image)
 * @param {string} alt    - Alt text or empty string
 * @returns {'hero'|'gallery'|'variant'|'packaging'|'lifestyle'|'unknown'}
 */
function classifyImageRole(src, w, h, pos, alt) {
  const url   = (src  || '').toLowerCase();
  const label = (alt  || '').toLowerCase();
  const area  = (w || 0) * (h || 0);
  const ratio = h > 0 ? w / h : 1;

  // ── Variant: small square image (swatch-like), or URL suggests color/swatch ──
  if ((w <= 120 && h <= 120) ||
      /swatch|color|variant|thumb\d|_sm_|_s\.|_xs_|_t\./i.test(url) ||
      /swatch|color option/i.test(label)) {
    return 'variant';
  }

  // ── Lifestyle: wide aspect ratio (16:9+) or scene/outdoor keywords ──
  if (ratio >= 1.6 ||
      /lifestyle|banner|scene|outdoor|model|room|kitchen|office|people|person|woman|man|child/i.test(label) ||
      /lifestyle|banner|outdoor/i.test(url)) {
    return 'lifestyle';
  }

  // ── Packaging: keywords suggesting box/package imagery ──
  if (/packag|box|carton|label|shipper/i.test(label) ||
      /packag|box|carton/i.test(url)) {
    return 'packaging';
  }

  // ── Hero: first/largest image, roughly square or portrait (1:1 to 3:4) ──
  if (pos === 0 && area >= 200 * 200 && ratio >= 0.65 && ratio <= 1.5) {
    return 'hero';
  }

  // ── Gallery: subsequent decent-sized images ──
  if (area >= 150 * 150) return 'gallery';

  return 'unknown';
}

/**
 * Score image quality on a 0-100 scale.
 * Higher resolution + better role = higher score.
 * @param {number} w    - Natural width (px)
 * @param {number} h    - Natural height (px)
 * @param {string} role - Result of classifyImageRole()
 * @returns {number} 0–100
 */
function scoreImageQuality(w, h, role) {
  const area = (w || 0) * (h || 0);

  // Resolution score (0-60): caps at 2000×2000 = 4M px
  const resSc = Math.min(60, Math.round((area / (2000 * 2000)) * 60));

  // Role bonus (0-40)
  const roleBonus = {
    hero:      40,
    gallery:   25,
    packaging: 20,
    lifestyle: 15,
    variant:   10,
    unknown:    5
  };
  const roleSc = roleBonus[role] || 5;

  return Math.min(100, resSc + roleSc);
}

/**
 * Deduplicate images by URL (removing query params) and by approximate
 * dimension bucket. Returns a clean list with role + score attached.
 * @param {{ src: string, w: number, h: number }[]} images
 * @returns {{ src: string, w: number, h: number, role: string, score: number }[]}
 */
function classifyAndDeduplicateImages(images) {
  const seen     = new Set();
  const result   = [];

  // Sort by area desc so we process the largest (hero candidates) first
  const sorted = [...images].sort((a, b) => (b.w * b.h) - (a.w * a.h));

  sorted.forEach((img, pos) => {
    // Build a dedup key: strip query strings + common CDN size tokens
    const baseKey = buildDedupeKey(img.src);
    if (seen.has(baseKey)) return;
    seen.add(baseKey);

    const role  = classifyImageRole(img.src, img.w, img.h, pos, img.alt || '');
    const score = scoreImageQuality(img.w, img.h, role);

    result.push({ ...img, role, score });
  });

  // Sort final result: hero first, then by score desc
  return result.sort((a, b) => {
    if (a.role === 'hero' && b.role !== 'hero') return -1;
    if (b.role === 'hero' && a.role !== 'hero') return  1;
    return b.score - a.score;
  });
}

/**
 * Build a normalised deduplication key for an image URL.
 * Strips query strings and common CDN size tokens.
 * @param {string} src
 * @returns {string}
 */
function buildDedupeKey(src) {
  if (!src) return '';
  // Strip query string
  let key = src.split('?')[0];
  // Strip Amazon CDN size tokens like ._AC_SL500_. or ._SX300_.
  key = key.replace(/\._[A-Z0-9_,]{2,}_\./gi, '.');
  // Strip double dots left behind
  key = key.replace(/\.{2,}/g, '.');
  // Lowercase for case-insensitive comparison
  return key.toLowerCase();
}

// Export for use in sidepanel.js (loaded as plain <script> in MV3)
if (typeof window !== 'undefined') {
  window.ZHClassifier = {
    classifyImageRole,
    scoreImageQuality,
    classifyAndDeduplicateImages,
    buildDedupeKey
  };
}
