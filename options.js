// ============================================================
// ZHunter PRO v7.6.1 - Options / Settings Page
// Full working settings with API key, toggles,
// stats, export, danger zone, model list
// ============================================================
'use strict';

const STORAGE_KEY = 'zakLinkCollectorData';
const APP_VERSION = chrome.runtime.getManifest().version;
const DEFAULT_AI_API_KEY = ''; // User must add their own OpenRouter API key in Settings


const DEFAULT_SETTINGS = {
  autoCategory:   true,
  duplicateCheck: true,
  badgeEnabled:   true,
  lastFolder:     'General',

  imageFormat:    'jpg',
  imageRatio:     'original',
  imageBg:        'original',
  imageMinSize:   0,
  imageMax5MB:    true,
  customBulkColumns: []
};

// ── State ────────────────────────────────────────────────────
let currentSettings = { ...DEFAULT_SETTINGS };
let currentData     = null;
let confirmCb       = null;


function applyDynamicVersion() {
  const version = `v${APP_VERSION}`;
  document.querySelectorAll('[data-version], .opt-version').forEach(el => { el.textContent = version; });
  document.querySelectorAll('.version-value').forEach(el => { el.textContent = APP_VERSION; });
}

// ── DOM Helper ───────────────────────────────────────────────
function $(id) { return document.getElementById(id); }


// ── Theme / Day-Night Mode ───────────────────────────────────
const UI_KEY = 'zakUIState';
let currentTheme = 'dark';

async function getUIState() {
  try {
    const result = await chrome.storage.local.get(UI_KEY);
    return result[UI_KEY] || {};
  } catch (_) { return {}; }
}

async function saveUIState(updates) {
  try {
    const current = await getUIState();
    await chrome.storage.local.set({ [UI_KEY]: { ...current, ...updates } });
  } catch (_) {}
}

function applyTheme(theme) {
  currentTheme = theme === 'light' ? 'light' : 'dark';
  document.body.classList.toggle('light-mode', currentTheme === 'light');
  const btn = $('optThemeToggleBtn');
  if (btn) {
    btn.classList.toggle('theme-light-active', currentTheme === 'light');
    btn.title = currentTheme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode';
    btn.setAttribute('aria-label', btn.title);
  }
}

async function initTheme() {
  const ui = await getUIState();
  applyTheme(ui.theme === 'light' ? 'light' : 'dark');
  $('optThemeToggleBtn')?.addEventListener('click', async () => {
    applyTheme(currentTheme === 'light' ? 'dark' : 'light');
    await saveUIState({ theme: currentTheme });
    toast(`${currentTheme === 'light' ? '☀️ Light' : '🌙 Dark'} mode activated`, 'info');
  });
}

// ── Storage ──────────────────────────────────────────────────
async function getData() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    return result[STORAGE_KEY] || null;
  } catch (_) { return null; }
}

async function saveSettings(settings) {
  try {
    const res = await chrome.runtime.sendMessage({ action: 'UPDATE_SETTINGS', settings });
    return res && res.success;
  } catch (_) { return false; }
}

// ── Toast ─────────────────────────────────────────────────────
function toast(message, type = 'info') {
  const stack = $('optToastStack');
  if (!stack) return;
  while (stack.children.length >= 4) stack.firstChild?.remove();

  const icons = { ok: '✅', err: '❌', warn: '⚠️', info: 'ℹ️' };
  const item = document.createElement('div');
  item.className = `toast-item ${type}`;
  item.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ️'}</span><span>${escHtml(message)}</span>`;
  stack.appendChild(item);
  item.getBoundingClientRect();
  item.classList.add('visible');
  setTimeout(() => {
    item.classList.add('leaving');
    setTimeout(() => item.remove(), 320);
  }, 3200);
}

function escHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Confirm Modal ─────────────────────────────────────────────
function showConfirm(title, message, okLabel, cb) {
  const tEl = $('optConfirmTitle');
  const mEl = $('optConfirmMessage');
  const oEl = $('optConfirmOk');
  if (tEl) tEl.textContent = title;
  if (mEl) mEl.textContent = message;
  if (oEl) oEl.textContent = okLabel;
  confirmCb = cb;
  $('optConfirmModal')?.classList.remove('hidden');
  setTimeout(() => $('optConfirmOk')?.focus(), 100);
}

function initConfirmModal() {
  $('optConfirmClose')?.addEventListener('click', closeConfirm);
  $('optConfirmCancel')?.addEventListener('click', closeConfirm);
  $('optConfirmOk')?.addEventListener('click', () => {
    closeConfirm();
    if (confirmCb) { confirmCb(); confirmCb = null; }
  });
  $('optConfirmModal')?.addEventListener('click', e => {
    if (e.target === $('optConfirmModal')) closeConfirm();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeConfirm();
  });
}

function closeConfirm() {
  $('optConfirmModal')?.classList.add('hidden');
}

// ── Toggle Switches ───────────────────────────────────────────
function initToggle(id, settingKey) {
  const track = $(id);
  if (!track) return;

  // Inject thumb into track
  const thumb = document.createElement('div');
  thumb.className = 'toggle-thumb';
  track.appendChild(thumb);

  const updateVisual = (val) => {
    track.classList.toggle('on', !!val);
    track.setAttribute('aria-checked', val ? 'true' : 'false');
  };

  updateVisual(currentSettings[settingKey]);

  const toggle = async () => {
    currentSettings[settingKey] = !currentSettings[settingKey];
    updateVisual(currentSettings[settingKey]);
    const ok = await saveSettings({ [settingKey]: currentSettings[settingKey] });
    if (ok) {
      toast(`${settingKey === 'autoCategory' ? 'Auto Category'
        : settingKey === 'duplicateCheck' ? 'Duplicate Check'
        : 'Badge Counter'} ${currentSettings[settingKey] ? 'enabled' : 'disabled'}`, 'ok');
    } else {
      toast('Failed to save setting', 'err');
    }
  };

  track.addEventListener('click', toggle);
  track.addEventListener('keydown', e => {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); }
  });
}


// ── Data Stats ────────────────────────────────────────────────
async function loadStats() {
  const data = await getData();
  currentData = data;

  const links   = data?.links   || [];
  const folders = data?.folders || [];
  const tags    = data?.tags    || [];

  const pEl = $('statProducts');
  const fEl = $('statFolders');
  const tEl = $('statTags');
  if (pEl) pEl.textContent = links.length;
  if (fEl) fEl.textContent = folders.length;
  if (tEl) tEl.textContent = tags.length;

  // Estimate storage usage
  try {
    const bytes = await chrome.storage.local.getBytesInUse(STORAGE_KEY);
    const kb    = (bytes / 1024).toFixed(1);
    const mb    = (bytes / (1024 * 1024)).toFixed(2);
    const desc  = $('storageDesc');
    if (desc) {
      desc.textContent = bytes > 1024 * 1024
        ? `${mb} MB used (${links.length} products)`
        : `${kb} KB used (${links.length} products)`;
    }
  } catch (_) {
    const desc = $('storageDesc');
    if (desc) desc.textContent = `${(data?.links || []).length} products stored`;
  }
}

// ── Export ────────────────────────────────────────────────────
function dlFile(content, name, mime) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), {
    href: url, download: name, style: 'display:none'
  });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: '2-digit'
    });
  } catch { return ''; }
}

function initExport() {
  // JSON Export
  $('exportDataBtn')?.addEventListener('click', async () => {
    const data = await getData();
    if (!data?.links?.length) { toast('No products to export', 'warn'); return; }

    const clean = {
      exported: new Date().toISOString(),
      version:  APP_VERSION,
      links:    (data.links || []).map(l => ({
        ...l,
        // Preserve real https:// image URLs — only strip inline base64 blobs (huge, non-restorable)
        images:     (l.images || []).filter(img => typeof img === 'string' && !img.startsWith('data:')),
        base64Image: l.base64Image ? '[omitted]' : ''
      })),
      folders: data.folders || [],
      tags:    data.tags    || []
    };

    dlFile(JSON.stringify(clean, null, 2), 'zhunter-backup.json', 'application/json');
    toast('JSON backup exported', 'ok');
  });

  // HTML Export
  $('exportHtmlOptBtn')?.addEventListener('click', async () => {
    const data = await getData();
    if (!data?.links?.length) { toast('No products to export', 'warn'); return; }
    buildHtmlExport(data.links);
    toast('HTML catalog exported', 'ok');
  });
}

function buildHtmlExport(links) {
  const byFolder = {};
  links.forEach(l => {
    (byFolder[l.folder] = byFolder[l.folder] || []).push(l);
  });

  const sections = Object.entries(byFolder).map(([folder, fLinks]) => {
    const cards = fLinks.map(l => {
      const images = Array.isArray(l.images) && l.images.length > 0
        ? l.images : (l.base64Image ? [l.base64Image] : []);
      const safeUrl   = escHtml(l.url || '');
      const safeTitle = escHtml(l.title || l.url || '');
      const safeNotes = escHtml(l.notes || '').replace(/\n/g, '<br>');
      const safePrice = escHtml(l.price || '');
      const safeCat   = escHtml(l.category || 'Other');
      const safeTags  = (l.tags || []).map(t => `<span class="tag">${escHtml(t)}</span>`).join('');
      const safeDate  = escHtml(fmtDate(l.dateAdded));
      const safeVideo = l.videoUrl ? escHtml(l.videoUrl) : '';

      const imgGallery = images.length > 0
        ? `<div class="img-gallery">
            <div class="img-main-wrap">
              <img class="img-main" src="${escHtml(images[0])}" alt="${safeTitle}" loading="lazy" onerror="this.style.display='none'"/>
            </div>
            ${images.length > 1
              ? `<div class="img-thumbs">${images.slice(1, 6).map((src, i) =>
                  `<img class="img-thumb-exp" src="${escHtml(src)}" alt="Image ${i+2}" loading="lazy"
                   onclick="switchImg(this)" onerror="this.style.display='none'"/>`
                ).join('')}</div>`
              : ''}
           </div>`
        : `<div class="img-placeholder">No Image</div>`;

      let videoSection = '';
      if (safeVideo) {
        const isYT = safeVideo.includes('youtube.com/embed') || safeVideo.includes('youtu.be');
        videoSection = isYT
          ? `<iframe src="${safeVideo}" frameborder="0" allowfullscreen class="video-iframe" loading="lazy"></iframe>`
          : `<video controls class="video-player" preload="none"><source src="${safeVideo}"/></video>`;
      }

      return `
      <div class="card" id="card-${escHtml(l.id)}">
        ${imgGallery}
        ${videoSection ? `<div class="video-section">${videoSection}</div>` : ''}
        <div class="card-body">
          <div class="cat-badge">${safeCat}</div>
          <div class="title-row">
            <a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="card-title">${safeTitle}</a>
            <button class="copy-btn" onclick="copyText('${safeTitle.replace(/'/g, "\\'")}', this)" title="Copy title">📋</button>
          </div>
          ${safePrice ? `<div class="card-price">${safePrice}</div>` : ''}
          ${safeNotes
            ? `<div class="notes-wrap">
                <div class="card-notes" id="notes-${escHtml(l.id)}">${safeNotes}</div>
                <button class="copy-desc-btn" onclick="copyText(document.getElementById('notes-${escHtml(l.id)}').innerText,this)">📋 Copy Description</button>
               </div>`
            : ''}
          ${safeTags ? `<div class="card-tags">${safeTags}</div>` : ''}
          <div class="card-meta">
            <span>📅 ${safeDate}</span>
            <span>📁 ${escHtml(l.folder)}</span>
            ${safeVideo ? '<span>▶ Video</span>' : ''}
          </div>
          <div class="btn-row">
            <a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="btn-view">🔗 View Product</a>
            <button onclick="removeCard('${escHtml(l.id)}')" class="btn-rm">✕ Remove</button>
          </div>
        </div>
      </div>`;
    }).join('');

    return `
    <section class="folder-section" data-folder="${escHtml(folder)}">
      <div class="folder-head">
        <span>📁</span>
        <h2>${escHtml(folder)}</h2>
        <span class="folder-count">${fLinks.length} product${fLinks.length !== 1 ? 's' : ''}</span>
      </div>
      <div class="cards-grid">${cards}</div>
    </section>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>ZHunter PRO — Catalog</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#050816;--card:#0e1530;--border:#1a2347;--theme:#06b6d4;--green:#10b981;--text1:#fafafa;--text2:#d4d4d8;--text3:#a1a1aa;--text4:#71717a}
body{font-family:system-ui,sans-serif;background:var(--bg);color:var(--text1);min-height:100vh}
a{color:inherit;text-decoration:none}
header{background:linear-gradient(135deg,#0f0f1a,#1a0a12);padding:24px 32px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px}
.site-title{font-size:24px;font-weight:900;background:linear-gradient(135deg,#ffffff,#06b6d4);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.site-meta{font-size:11px;color:var(--text3);margin-top:3px}
.search-bar{padding:14px 32px;background:#111113;border-bottom:1px solid var(--border);display:flex;gap:8px;flex-wrap:wrap}
.search-inp{flex:1;min-width:180px;padding:9px 14px;background:var(--card);border:1px solid var(--border);border-radius:8px;color:var(--text1);font-size:13px;outline:none}
.search-inp:focus{border-color:var(--theme)}
.filter-sel{padding:9px 12px;background:var(--card);border:1px solid var(--border);border-radius:8px;color:var(--text1);font-size:12px;cursor:pointer;outline:none}
.container{max-width:1300px;margin:0 auto;padding:24px 32px}
.folder-section{margin-bottom:40px}
.folder-head{display:flex;align-items:center;gap:10px;margin-bottom:16px;padding-bottom:10px;border-bottom:1px solid var(--border)}
.folder-head h2{font-size:17px;font-weight:800}
.folder-count{margin-left:auto;font-size:11px;background:rgba(6,182,212,0.12);color:var(--theme);border:1px solid rgba(6,182,212,0.25);padding:2px 10px;border-radius:999px;font-weight:700}
.cards-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}
.card{background:var(--card);border:1px solid var(--border);border-radius:14px;overflow:hidden;display:flex;flex-direction:column;transition:all 0.22s}
.card:hover{border-color:rgba(6,182,212,0.3);box-shadow:0 6px 24px rgba(6,182,212,0.1);transform:translateY(-2px)}
.card.removing{animation:fadeOut 0.32s ease forwards}
@keyframes fadeOut{to{opacity:0;transform:scale(0.93) translateY(8px)}}
.img-gallery{background:#0a0a0f}
.img-main-wrap{width:100%;aspect-ratio:4/3;overflow:hidden;background:#0d0d14;display:flex;align-items:center;justify-content:center}
.img-main{width:100%;height:100%;object-fit:contain;cursor:zoom-in;transition:transform 0.3s}
.img-main:hover{transform:scale(1.04)}
.img-thumbs{display:flex;gap:5px;padding:5px;background:#0d0d14;overflow-x:auto}
.img-thumb-exp{width:48px;height:48px;object-fit:cover;border-radius:5px;cursor:pointer;border:2px solid transparent;flex-shrink:0;transition:border-color 0.15s}
.img-thumb-exp:hover{border-color:var(--theme)}
.img-placeholder{display:flex;align-items:center;justify-content:center;padding:32px;background:#0d0d14;color:var(--text4);font-size:12px}
.video-section{background:#0a0a0f;padding:5px}
.video-iframe{width:100%;aspect-ratio:16/9;border-radius:7px;display:block;border:none}
.video-player{width:100%;aspect-ratio:16/9;border-radius:7px;background:#000;display:block}
.card-body{padding:13px;display:flex;flex-direction:column;gap:7px;flex:1}
.cat-badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:9px;font-weight:700;background:rgba(6,182,212,0.12);color:var(--theme);border:1px solid rgba(6,182,212,0.22);width:fit-content}
.title-row{display:flex;align-items:flex-start;gap:7px}
.card-title{font-size:13.5px;font-weight:700;line-height:1.4;flex:1;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.card-title:hover{color:#67e8f9}
.copy-btn{background:none;border:none;cursor:pointer;font-size:12px;padding:2px 4px;border-radius:4px;color:var(--text3);flex-shrink:0;transition:all 0.15s}
.copy-btn:hover{background:rgba(255,255,255,0.08);color:var(--text1)}
.card-price{font-size:16px;font-weight:800;color:var(--green)}
.notes-wrap{background:rgba(255,255,255,0.03);border-radius:7px;padding:7px 9px;border:1px solid var(--border)}
.card-notes{font-size:11.5px;color:var(--text2);line-height:1.6;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-wrap;margin-bottom:5px}
.copy-desc-btn{width:100%;background:rgba(6,182,212,0.1);border:1px solid rgba(6,182,212,0.22);color:#67e8f9;border-radius:5px;padding:4px 8px;font-size:10px;font-weight:700;cursor:pointer;transition:background 0.15s}
.copy-desc-btn:hover{background:rgba(6,182,212,0.2)}
.card-tags{display:flex;flex-wrap:wrap;gap:4px}
.tag{padding:2px 7px;border-radius:999px;font-size:9.5px;font-weight:600;background:rgba(6,182,212,0.12);color:#67e8f9;border:1px solid rgba(6,182,212,0.2)}
.card-meta{display:flex;gap:8px;font-size:10px;color:var(--text4);margin-top:auto;padding-top:5px;border-top:1px solid var(--border);flex-wrap:wrap}
.btn-row{display:flex;gap:5px;flex-wrap:wrap}
.btn-view{display:inline-flex;align-items:center;justify-content:center;flex:1;padding:7px 10px;border-radius:6px;font-size:11px;font-weight:700;background:linear-gradient(135deg,var(--theme),#0e7490);color:white;cursor:pointer;text-decoration:none;border:none;transition:opacity 0.15s}
.btn-view:hover{opacity:0.88}
.btn-rm{padding:7px 9px;border-radius:6px;font-size:11px;font-weight:700;background:rgba(239,68,68,0.1);color:#f87171;border:1px solid rgba(239,68,68,0.22);cursor:pointer;transition:background 0.15s}
.btn-rm:hover{background:rgba(239,68,68,0.2)}
.hidden{display:none!important}
footer{text-align:center;padding:24px;color:var(--text4);font-size:11px;border-top:1px solid var(--border);margin-top:16px}
@media(max-width:600px){.container,.search-bar,header{padding-left:12px;padding-right:12px}.cards-grid{grid-template-columns:1fr}}
</style>
</head>
<body>
<header>
  <div>
    <div class="site-title">🛍️ ZHunter PRO Catalog</div>
    <div class="site-meta">Exported ${new Date().toLocaleString()} · ${links.length} products · v7.6.1</div>
  </div>
</header>
<div class="search-bar">
  <input class="search-inp" type="search" placeholder="🔍 Search products…" oninput="filterCards(this.value)" autocomplete="off"/>
  <select class="filter-sel" onchange="filterByFolder(this.value)">
    <option value="">All Folders</option>
    ${Object.keys(byFolder).map(f => `<option value="${escHtml(f)}">${escHtml(f)}</option>`).join('')}
  </select>
</div>
<div class="container">${sections}</div>
<footer>Generated by ZHunter PRO v7.6.1</footer>
<script>
function copyText(text,btn){
  navigator.clipboard.writeText(text).then(()=>{
    const orig=btn.textContent;
    btn.textContent='✓ Copied!';
    btn.style.color='#10b981';
    setTimeout(()=>{btn.textContent=orig;btn.style.color='';},2000);
  }).catch(()=>{
    const ta=document.createElement('textarea');
    ta.value=text;ta.style.cssText='position:fixed;opacity:0';
    document.body.appendChild(ta);ta.select();
    try{document.execCommand('copy');}catch(e){}
    ta.remove();
    btn.textContent='✓ Copied!';
    setTimeout(()=>{btn.textContent=btn.dataset.orig||'📋';},2000);
  });
}
function removeCard(id){
  const c=document.getElementById('card-'+id);
  if(!c)return;
  c.classList.add('removing');
  setTimeout(()=>c.remove(),320);
}
function filterCards(q){
  q=q.toLowerCase().trim();
  document.querySelectorAll('.card').forEach(c=>{
    c.classList.toggle('hidden',q.length>0&&!c.textContent.toLowerCase().includes(q));
  });
}
function filterByFolder(f){
  document.querySelectorAll('.folder-section').forEach(s=>{
    if(!f){s.classList.remove('hidden');return;}
    s.classList.toggle('hidden',s.dataset.folder!==f);
  });
}
function switchImg(thumb){
  const g=thumb.closest('.img-gallery');
  const m=g&&g.querySelector('.img-main');
  if(m)m.src=thumb.src;
  g&&g.querySelectorAll('.img-thumb-exp').forEach(t=>t.style.borderColor='transparent');
  thumb.style.borderColor='#06b6d4';
}
<\/script>
</body>
</html>`;

  dlFile(html, 'zhunter-catalog.html', 'text/html');
}

// ── Danger Zone ───────────────────────────────────────────────
function initDangerZone() {
  $('dangerClearProducts')?.addEventListener('click', () => {
    showConfirm(
      'Clear All Products',
      `This will permanently delete all saved products. Folders and tags will be kept. This cannot be undone.`,
      'Delete All Products',
      async () => {
        try {
          // Use background.js CLEAR_ALL action — this triggers updateBadge()
          const res = await chrome.runtime.sendMessage({ action: 'CLEAR_ALL' });
          if (!res?.success) throw new Error('clear_failed');
          await loadStats();
          toast('All products deleted', 'ok');
        } catch (_) {
          toast('Failed to clear products', 'err');
        }
      }
    );
  });

  $('dangerResetSettings')?.addEventListener('click', () => {
    showConfirm(
      'Reset All Settings',
      'This will restore all settings to defaults. Your saved products will NOT be deleted.',
      'Reset Settings',
      async () => {
        try {
          // Sync via background so badge respects new badgeEnabled flag
          await chrome.runtime.sendMessage({
            action: 'UPDATE_SETTINGS',
            settings: { ...DEFAULT_SETTINGS }
          });
          currentSettings = { ...DEFAULT_SETTINGS };

          // Reload UI
          const apiInput = $('apiKeyInput');
          if (apiInput) apiInput.value = '';

          ['autoCategory', 'duplicateCheck', 'badgeEnabled'].forEach(key => {
            const track = document.querySelector(`#toggle-${key}`);
            if (track) {
              track.classList.toggle('on', !!DEFAULT_SETTINGS[key]);
              track.setAttribute('aria-checked', DEFAULT_SETTINGS[key] ? 'true' : 'false');
            }
          });

          toast('Settings reset to defaults', 'ok');
        } catch (_) {
          toast('Failed to reset settings', 'err');
        }
      }
    );
  });

  $('dangerWipeAll')?.addEventListener('click', () => {
    showConfirm(
      '⚠️ Wipe ALL Data',
      'This will permanently delete ALL products, folders, tags, settings, AND bulk hunt master sheet. This absolutely cannot be undone.',
      'Wipe Everything',
      async () => {
        try {
          // Remove all extension storage keys
          await chrome.storage.local.remove([
            STORAGE_KEY,
            'zhunterMasterSheet',     // v7.5 — bulk hunt master rows
            'zhunterMasterBatches'    // v7.5 — batch history
          ]);
          currentSettings = { ...DEFAULT_SETTINGS };

          // Tell background.js to refresh its state + clear badge
          try {
            await chrome.runtime.sendMessage({ action: 'CLEAR_ALL' });
          } catch (_) {}
          // Explicit badge clear (in case CLEAR_ALL fails — e.g., if STORAGE_KEY was just removed)
          try {
            await chrome.action.setBadgeText({ text: '' });
          } catch (_) {}

          await loadStats();

          const apiInput = $('apiKeyInput');
          if (apiInput) apiInput.value = '';

          ['autoCategory', 'duplicateCheck', 'badgeEnabled'].forEach(key => {
            const track = document.querySelector(`#toggle-${key}`);
            if (track) {
              track.classList.toggle('on', !!DEFAULT_SETTINGS[key]);
              track.setAttribute('aria-checked', DEFAULT_SETTINGS[key] ? 'true' : 'false');
            }
          });

          toast('All data wiped', 'info');
        } catch (_) {
          toast('Failed to wipe data', 'err');
        }
      }
    );
  });
}

// ── Init ──────────────────────────────────────────────────────
async function init() {
  try {
    const data = await getData();
    currentSettings = {
      ...DEFAULT_SETTINGS,
      ...(data?.settings || {})
    };
  } catch (_) {
    currentSettings = { ...DEFAULT_SETTINGS };
  }

  await initTheme();

  initToggle('toggle-autoCategory',   'autoCategory');
  initToggle('toggle-duplicateCheck', 'duplicateCheck');
  initToggle('toggle-badgeEnabled',   'badgeEnabled');

  initBulkSettings();
  initExport();
  initDangerZone();
  initConfirmModal();

  await loadStats();

  $('refreshStatsBtn')?.addEventListener('click', async () => {
    await loadStats();
    toast('Stats refreshed', 'info');
  });
}

document.addEventListener('DOMContentLoaded', () => { applyDynamicVersion(); init(); });
// ── Bulk Hunt Settings ───────────────────────────────────────
function initBulkSettings() {
  const input    = $('bulkPrefixInput');
  const saveBtn  = $('saveBulkPrefixBtn');
  const status   = $('bulkPrefixStatus');
  const preview  = $('filenamePreview');
  if (!input) return;

  const refreshPreview = () => {
    const prefix = (input.value || 'zhunter_').trim();
    const d = new Date();
    const ymd = d.toISOString().slice(0, 10);
    const hm = `${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}`;
    preview.textContent = `${prefix}${ymd}_${hm}.xlsx`;
  };

  input.value = currentSettings.bulkFilenamePrefix || 'zhunter_';
  refreshPreview();
  input.addEventListener('input', refreshPreview);

  saveBtn?.addEventListener('click', async () => {
    let prefix = (input.value || '').trim();
    if (!prefix) prefix = 'zhunter_';
    prefix = prefix.replace(/[^a-zA-Z0-9_\-]/g, '');
    if (!prefix.endsWith('_')) prefix += '_';
    input.value = prefix;

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    const ok = await saveSettings({ bulkFilenamePrefix: prefix });
    currentSettings.bulkFilenamePrefix = prefix;

    if (status) {
      status.classList.remove('hidden', 'error');
      status.textContent = ok ? '✓ Filename prefix saved' : '✗ Save failed';
      if (!ok) status.classList.add('error');
      setTimeout(() => status.classList.add('hidden'), 2500);
    }
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save';
    refreshPreview();
  });

  // ── Column toggles grid ──
  const ALL_BULK_COLS_OPT = [
    { key: 'no',          label: '#'              },
    { key: 'title',       label: 'Title'          },
    { key: 'url',         label: 'Source URL'     },
    { key: 'platform',    label: 'Platform'       },
    { key: 'price',       label: 'Source Price'   },
    { key: 'labelCost',   label: 'Label Cost'     },
    { key: 'listPrice',   label: 'List Price'     },
    { key: 'profit',      label: 'Profit'         },
    { key: 'description', label: 'Description'    },
    { key: 'tags',        label: 'Tags'           },
    { key: 'variants',    label: 'Variants'       },
    { key: 'imageCount',  label: 'Image Count'    },
    { key: 'videoCount',  label: 'Video Count'    },
    { key: 'scrapedAt',   label: 'Date Added'     },
    { key: 'status',      label: 'Status'         }
  ];

  const grid = $('optBulkColumnsGrid');
  const colStatus = $('optBulkColumnsStatus');

  const renderColGrid = () => {
    if (!grid) return;
    const prefs = currentSettings.bulkSheetColumns || {};
    const customCols = currentSettings.customBulkColumns || [];
    
    grid.innerHTML = '';
    
    // Merge standard columns with custom columns
    const allCols = [...ALL_BULK_COLS_OPT, ...customCols];
    
    allCols.forEach(col => {
      const isCustom = customCols.some(c => c.key === col.key);
      const checked = prefs[col.key] !== false;
      const item = document.createElement('label');
      item.className = 'opt-col-item' + (checked ? ' on' : '') + (isCustom ? ' custom-col' : '');
      
      let innerHTML = `
        <span class="opt-col-checkbox"></span>
        <span class="opt-col-label">${col.label}</span>`;
      
      if (isCustom) {
        innerHTML += `<span class="opt-col-del" title="Delete custom column" data-key="${col.key}">✕</span>`;
      }
      
      item.innerHTML = innerHTML;
      
      // Handle click on delete button
      if (isCustom) {
        const delBtn = item.querySelector('.opt-col-del');
        delBtn.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const newCustomCols = customCols.filter(c => c.key !== col.key);
          const ok = await saveSettings({ customBulkColumns: newCustomCols });
          if (ok) {
            currentSettings.customBulkColumns = newCustomCols;
            renderColGrid();
            toast(`Column "${col.label}" deleted`, 'ok');
          }
        });
      }
      
      // Handle click on the checkbox/label
      item.addEventListener('click', async (e) => {
        if (e.target.classList.contains('opt-col-del')) return;
        e.preventDefault();
        const newPrefs = { ...prefs };
        newPrefs[col.key] = !(newPrefs[col.key] !== false);
        const ok = await saveSettings({ bulkSheetColumns: newPrefs });
        if (ok) {
          currentSettings.bulkSheetColumns = newPrefs;
          renderColGrid();
          if (colStatus) {
            colStatus.classList.remove('hidden', 'error');
            colStatus.textContent = '✓ Saved';
            setTimeout(() => colStatus.classList.add('hidden'), 1200);
          }
        }
      });
      grid.appendChild(item);
    });
  };
  renderColGrid();
  
  // Logic for adding a new custom column
  const customColInput = $('customColInput');
  const addCustomColBtn = $('addCustomColBtn');
  
  if (customColInput && addCustomColBtn) {
    addCustomColBtn.addEventListener('click', async () => {
      const label = customColInput.value.trim();
      if (!label) {
        toast('Column name cannot be empty', 'warn');
        return;
      }
      
      const customCols = currentSettings.customBulkColumns || [];
      const keyStr = 'custom_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
      
      // Check for duplicates
      if (customCols.some(c => c.label.toLowerCase() === label.toLowerCase()) || 
          ALL_BULK_COLS_OPT.some(c => c.label.toLowerCase() === label.toLowerCase())) {
        toast('A column with this name already exists', 'warn');
        return;
      }
      
      const newCustomCols = [...customCols, { key: keyStr, label: label }];
      const prefs = { ...(currentSettings.bulkSheetColumns || {}) };
      prefs[keyStr] = true; // enable by default
      
      addCustomColBtn.disabled = true;
      const ok = await saveSettings({ customBulkColumns: newCustomCols, bulkSheetColumns: prefs });
      
      if (ok) {
        currentSettings.customBulkColumns = newCustomCols;
        currentSettings.bulkSheetColumns = prefs;
        customColInput.value = '';
        renderColGrid();
        toast(`Column "${label}" added!`, 'ok');
      } else {
        toast('Failed to save column', 'err');
      }
      addCustomColBtn.disabled = false;
    });
    
    // Add on enter key
    customColInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addCustomColBtn.click();
      }
    });
  }

  // ── autoSkipDuplicates toggle ──
  initToggle('toggle-autoSkipDuplicates', 'autoSkipDuplicates');

  // ── imageMax5MB toggle ──
  initToggle('toggle-imageMax5MB', 'imageMax5MB');

  // ── Image Format select ──
  const imgFmtSel = $('imageFormatSelect');
  if (imgFmtSel) {
    imgFmtSel.value = currentSettings.imageFormat || 'jpg';
    imgFmtSel.addEventListener('change', async () => {
      const fmt = imgFmtSel.value;
      const ok = await saveSettings({ imageFormat: fmt });
      currentSettings.imageFormat = fmt;
      if (ok) {
        toast(`Image format set to ${fmt.toUpperCase()}`, 'ok');
      } else {
        toast('Failed to save image format', 'err');
      }
    });
  }

  const imgRatioSel = $('imageRatioSelect');
  if (imgRatioSel) {
    imgRatioSel.value = currentSettings.imageRatio || 'original';
    imgRatioSel.addEventListener('change', async () => {
      currentSettings.imageRatio = imgRatioSel.value;
      await saveSettings({ imageRatio: currentSettings.imageRatio });
      toast('Image ratio updated', 'ok');
    });
  }

  const imgBgSel = $('imageBgSelect');
  if (imgBgSel) {
    imgBgSel.value = currentSettings.imageBg || 'original';
    imgBgSel.addEventListener('change', async () => {
      currentSettings.imageBg = imgBgSel.value;
      await saveSettings({ imageBg: currentSettings.imageBg });
      toast('Image background updated', 'ok');
    });
  }

  const imgMinSizeInp = $('imageMinSizeInput');
  if (imgMinSizeInp) {
    imgMinSizeInp.value = currentSettings.imageMinSize !== undefined ? currentSettings.imageMinSize : 0;
    imgMinSizeInp.addEventListener('change', async () => {
      let val = parseInt(imgMinSizeInp.value, 10);
      if (isNaN(val) || val < 0) val = 0;
      currentSettings.imageMinSize = val;
      await saveSettings({ imageMinSize: val });
      toast('Minimum dimension saved', 'ok');
    });
  }
}
