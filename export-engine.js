// ============================================================
// ZHunter PRO v9.0.0 — Export Engine
// Builds multi-sheet Research Workbook XLSX exports.
// Exposes window.ZHExport for use by sidepanel.js.
//
// Sheets produced by buildResearchWorkbook():
//   1. Products  — full normalized product fields
//   2. Media     — image/video with role, quality score, dimensions
//   3. Variants  — variant names/prices/stock
//   4. Errors    — failed queue items with stage + last error
// ============================================================
'use strict';

(function () {

  // ── Helpers ──────────────────────────────────────────────────

  /** Convert a 0-indexed column number to Excel column letter (A, B, … Z, AA …) */
  function colLetter(n) {
    let s = '';
    for (n++; n > 0; n = Math.floor((n - 1) / 26)) {
      s = String.fromCharCode(((n - 1) % 26) + 65) + s;
    }
    return s;
  }

  /** Style a worksheet: header row (dark green), alternating body rows, borders, freeze. */
  function styleSheet(ws, headerCount, rowCount) {
    const HEADER_BG = '0D9488'; // teal-600 — ZHunter brand colour
    const EVEN_BG   = 'F0FDFA';
    const ODD_BG    = 'FFFFFF';

    const hBorder = { top: { style:'thin', color:{ rgb:'065F46' } }, bottom: { style:'thin', color:{ rgb:'065F46' } }, left: { style:'thin', color:{ rgb:'065F46' } }, right: { style:'thin', color:{ rgb:'065F46' } } };
    const cBorder = { top: { style:'thin', color:{ rgb:'D1FAE5' } }, bottom: { style:'thin', color:{ rgb:'D1FAE5' } }, left: { style:'thin', color:{ rgb:'D1FAE5' } }, right: { style:'thin', color:{ rgb:'D1FAE5' } } };

    for (let ri = 0; ri <= rowCount; ri++) {
      for (let ci = 0; ci < headerCount; ci++) {
        const ref = colLetter(ci) + (ri + 1);
        if (!ws[ref]) continue;
        if (ri === 0) {
          ws[ref].s = {
            font:      { bold: true, color: { rgb: 'FFFFFF' }, sz: 11, name: 'Calibri' },
            fill:      { patternType: 'solid', fgColor: { rgb: HEADER_BG } },
            alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
            border:    hBorder
          };
        } else {
          const bg = ri % 2 === 0 ? EVEN_BG : ODD_BG;
          ws[ref].s = {
            font:      { name: 'Calibri', sz: 11 },
            fill:      { patternType: 'solid', fgColor: { rgb: bg } },
            alignment: { vertical: 'top', wrapText: true },
            border:    cBorder
          };
          // Hyperlink styling
          if (ws[ref].l) {
            ws[ref].s.font.color     = { rgb: '0563C1' };
            ws[ref].s.font.underline = true;
          }
        }
      }
    }

    // Auto-column widths
    ws['!cols'] = Array.from({ length: headerCount }, (_, ci) => {
      let max = 8;
      for (let ri = 0; ri <= rowCount; ri++) {
        const ref = colLetter(ci) + (ri + 1);
        const v   = ws[ref]?.v;
        const len = v != null ? String(v).length : 0;
        if (len > max) max = len;
      }
      return { wch: Math.min(Math.max(max + 2, 8), 55) };
    });

    // Freeze header row
    ws['!views'] = [{ state: 'frozen', ySplit: 1, xSplit: 0, topLeftCell: 'A2' }];

    // Autofilter
    if (rowCount > 0) {
      ws['!autofilter'] = { ref: `A1:${colLetter(headerCount - 1)}${rowCount + 1}` };
    }
  }

  /** Add a hyperlink cell */
  function linkCell(text, url) {
    return { t: 's', v: text || url || '', l: url ? { Target: url } : undefined };
  }

  /** Safe string */
  function s(v) { return v != null ? String(v) : ''; }

  /** Safe number */
  function n(v) {
    const num = parseFloat(v);
    return isNaN(num) ? '' : num;
  }

  // ── Sheet builders ───────────────────────────────────────────

  /**
   * Build the Products sheet from the full product list.
   * @param {object[]} products
   * @returns {object} XLSX worksheet
   */
  function buildProductsSheet(products) {
    const HEADERS = [
      'Folder', 'Title', 'Price', 'Currency', 'Marketplace', 'Link',
      'Seller', 'Stock', 'Category', 'Image Count', 'Video Count',
      'Description / Notes', 'Tags', 'Date Saved'
    ];

    const rows = [HEADERS];
    for (const p of products) {
      const imgs   = (p.imageUrls || p.images || []);
      const videos = (p.videoUrls || (p.videoUrl ? [p.videoUrl] : []));
      const tags   = Array.isArray(p.tags) ? p.tags.join(', ') : s(p.tags);
      const folder = s(p.folder || p.folderNumber || '');
      const price  = n(p.price);
      rows.push([
        folder,
        s(p.title),
        price === '' ? s(p.price) : price,
        s(p.currency || ''),
        s(p.marketplace || p.store || p.platform || ''),
        linkCell(s(p.url), p.url),
        s(p.seller || p.sellerName || ''),
        s(p.stock  || p.stockStatus || ''),
        s(p.category || ''),
        imgs.length,
        videos.length,
        s(p.notes || p.description || ''),
        tags,
        p.savedAt ? new Date(p.savedAt).toLocaleDateString() : ''
      ]);
    }

    if (typeof XLSX === 'undefined') return null;
    const ws = XLSX.utils.aoa_to_sheet(rows, { cellDates: false });
    styleSheet(ws, HEADERS.length, rows.length - 1);
    return ws;
  }

  /**
   * Build the Media sheet (images + videos with metadata).
   * @param {object[]} products
   * @returns {object} XLSX worksheet
   */
  function buildMediaSheet(products) {
    const HEADERS = [
      'Folder', 'Product Title', 'Media Type', 'URL',
      'Role', 'Quality Score', 'Width (px)', 'Height (px)',
      'Source Page', 'Capture Note'
    ];

    const rows = [HEADERS];
    for (const p of products) {
      const folder = s(p.folder || p.folderNumber || '');
      const title  = s(p.title);
      const imgs   = (p.imageUrls || p.images || []);

      imgs.forEach((img, i) => {
        const url   = typeof img === 'string' ? img : (img.src || img.url || '');
        const role  = (img.role  || (i === 0 ? 'hero' : 'gallery'));
        const score = img.score || '';
        const w     = img.w     || img.width  || '';
        const h     = img.h     || img.height || '';
        rows.push([
          folder, title,
          'Image',
          linkCell(url, url),
          role, score, w, h,
          s(p.url), ''
        ]);
      });

      const videos = (p.videoUrls || (p.videoUrl ? [p.videoUrl] : []));
      videos.forEach(v => {
        const url = typeof v === 'string' ? v : (v.url || v.src || '');
        rows.push([
          folder, title,
          'Video',
          linkCell(url, url),
          'video', '', '', '',
          s(p.url), ''
        ]);
      });
    }

    if (typeof XLSX === 'undefined') return null;
    const ws = XLSX.utils.aoa_to_sheet(rows, { cellDates: false });
    styleSheet(ws, HEADERS.length, rows.length - 1);
    return ws;
  }

  /**
   * Build the Variants sheet.
   * @param {object[]} products
   * @returns {object} XLSX worksheet
   */
  function buildVariantsSheet(products) {
    const HEADERS = ['Folder', 'Product Title', 'Variant Name', 'Variant Value', 'Price', 'Stock', 'Source'];
    const rows    = [HEADERS];

    for (const p of products) {
      const folder   = s(p.folder || p.folderNumber || '');
      const title    = s(p.title);
      const variants = Array.isArray(p.variants) ? p.variants : [];

      if (variants.length) {
        for (const v of variants) {
          rows.push([
            folder, title,
            s(v.name  || v.label || ''),
            s(v.value || ''),
            s(v.price || ''),
            s(v.stock || v.availability || ''),
            s(p.url)
          ]);
        }
      } else {
        // Emit one placeholder row so the sheet is not empty for this product
        rows.push([folder, title, '—', '—', s(p.price), '', s(p.url)]);
      }
    }

    if (typeof XLSX === 'undefined') return null;
    const ws = XLSX.utils.aoa_to_sheet(rows, { cellDates: false });
    styleSheet(ws, HEADERS.length, rows.length - 1);
    return ws;
  }

  /**
   * Build the Errors sheet from failed queue items.
   * @param {object[]} failedItems  - Items with status 'needs_retry' | 'error' | 'blocked'
   * @returns {object} XLSX worksheet
   */
  function buildErrorsSheet(failedItems) {
    const HEADERS = [
      'URL', 'Status', 'Stage Failed', 'Attempt Count', 'Last Error', 'Timestamp'
    ];
    const rows = [HEADERS];

    for (const item of failedItems) {
      rows.push([
        linkCell(s(item.url), item.url),
        s(item.status),
        s(item.stage || item.lastStage || ''),
        item.attempts || item.attemptCount || 0,
        s(item.error  || item.lastError   || ''),
        item.updatedAt ? new Date(item.updatedAt).toLocaleString() : ''
      ]);
    }

    if (typeof XLSX === 'undefined') return null;
    const ws = XLSX.utils.aoa_to_sheet(rows, { cellDates: false });
    styleSheet(ws, HEADERS.length, rows.length - 1);
    return ws;
  }

  // ── Public API ────────────────────────────────────────────────

  /**
   * Build a multi-sheet Research Workbook and trigger a download.
   * @param {object[]} products
   * @param {object[]} failedItems
   * @param {string}   filename    - Without extension
   */
  function downloadResearchWorkbook(products, failedItems, filename) {
    if (typeof XLSX === 'undefined') {
      console.error('[ZHExport] XLSX library not loaded');
      return;
    }

    const wb = XLSX.utils.book_new();

    const wsProducts = buildProductsSheet(products);
    const wsMedia    = buildMediaSheet(products);
    const wsVariants = buildVariantsSheet(products);
    const wsErrors   = buildErrorsSheet(failedItems || []);

    if (wsProducts) XLSX.utils.book_append_sheet(wb, wsProducts, 'Products');
    if (wsMedia)    XLSX.utils.book_append_sheet(wb, wsMedia,    'Media');
    if (wsVariants) XLSX.utils.book_append_sheet(wb, wsVariants, 'Variants');
    if (wsErrors)   XLSX.utils.book_append_sheet(wb, wsErrors,   'Errors');

    const buf  = XLSX.write(wb, { type: 'array', bookType: 'xlsx', cellStyles: true });
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const name = (filename || 'zhunter_research') + '.xlsx';

    // Use chrome.downloads if available, otherwise anchor download
    if (typeof zhSaveBlob === 'function') {
      zhSaveBlob(blob, name);
    } else {
      const a   = document.createElement('a');
      a.href    = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    }
  }

  // Export
  window.ZHExport = {
    downloadResearchWorkbook,
    buildProductsSheet,
    buildMediaSheet,
    buildVariantsSheet,
    buildErrorsSheet
  };

})();
