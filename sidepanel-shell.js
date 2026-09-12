// ============================================================
// ZHunter v8.0 — Side panel shell glue
// Runs after sidepanel.js. Wires the new 4-tab layout onto the
// existing controllers without changing their logic.
// ============================================================
'use strict';

(function () {
  const $ = id => document.getElementById(id);
  const $$ = sel => [...document.querySelectorAll(sel)];

  // ── Tab hooks ───────────────────────────────────────────────
  // Hunt tab (data-tab="images") also scans videos; Library loads the master sheet.
  document.querySelector('#tab-btn-images')?.addEventListener('click', () => {
    if (typeof scanVideos === 'function' && typeof VidTabState !== 'undefined' && !VidTabState.videos.length && !VidTabState.isScanning) {
      setTimeout(() => scanVideos(), 200);
    }
  });
  document.querySelector('#tab-btn-library')?.addEventListener('click', () => {
    if (typeof updateMasterStats === 'function') updateMasterStats();
  });
  document.querySelector('#tab-btn-bulk')?.addEventListener('click', () => {
    if (typeof loadBulkQueue === 'function') loadBulkQueue();
  });

  // ── Export dropdowns ────────────────────────────────────────
  function closeMenus() { $$('.menu.open').forEach(m => m.classList.remove('open')); }
  [['queueExportMenuBtn', 'queueExportMenu'], ['masterExportMenuBtn', 'masterExportMenu']].forEach(([btnId, menuId]) => {
    const btn = $(btnId), menu = $(menuId);
    if (!btn || !menu) return;
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const open = menu.classList.contains('open');
      closeMenus();
      if (!open) menu.classList.add('open');
    });
    menu.querySelectorAll('button').forEach(b => b.addEventListener('click', closeMenus));
  });
  document.addEventListener('click', e => { if (!e.target.closest('.dd')) closeMenus(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenus(); });

  // Enable the Export menu button whenever any item inside becomes enabled.
  function watchMenuEnable(menuId, btnId) {
    const menu = $(menuId), btn = $(btnId);
    if (!menu || !btn) return;
    const sync = () => { btn.disabled = ![...menu.querySelectorAll('button')].some(b => !b.disabled); };
    new MutationObserver(sync).observe(menu, { attributes: true, subtree: true, attributeFilter: ['disabled'] });
    sync();
  }
  watchMenuEnable('queueExportMenu', 'queueExportMenuBtn');
  watchMenuEnable('masterExportMenu', 'masterExportMenuBtn');

  // ── "Add to queue" → review dialog on the live bulk queue ──
  const addBtn = $('bulkAddAllTabsToQueueBtn');
  if (addBtn && typeof showQueueImportPreview === 'function') {
    const fresh = addBtn.cloneNode(true);          // drops the direct-add listener from sidepanel.js
    addBtn.replaceWith(fresh);
    fresh.addEventListener('click', async () => {
      if (typeof loadBulkTabs === 'function') await loadBulkTabs();
      const tabs = (typeof BulkState !== 'undefined' && Array.isArray(BulkState.tabs)) ? BulkState.tabs : [];
      const candidates = tabs.filter(t => t?.url && /^https?:/i.test(t.url)).map(t => ({ url: t.url, title: t.title || '', source: 'open_tab' }));
      if (!candidates.length) { toast('No web tabs open in this window.', 'warn'); return; }
      await showQueueImportPreview(candidates, 'open_tab', {
        previewAction: 'PREVIEW_BULK_QUEUE',
        adder: async items => {
          const res = await msg({ action: 'ADD_BULK_QUEUE_ITEMS', items: items.map(i => ({ url: i.url, title: i.title })) });
          if (typeof loadBulkQueue === 'function') await loadBulkQueue();
          toast(`${res?.addedCount || 0} added to the queue`, res?.success ? 'ok' : 'err');
          return res || { success: false, addedCount: 0 };
        }
      });
    });
  }

  // ── Queue badge + auto-open the "Paste links" section when it has items ──
  let queueAutoOpened = false;
  function syncBulkBadge() {
    if (typeof QueueState === 'undefined') return;
    const n = (QueueState.items || []).filter(i => !i.hunted && i.status !== 'complete').length;
    const tabEl = $('bulkTabCount'); if (tabEl) tabEl.textContent = n ? String(n) : '';
    const badge = $('bulkQueueBadge'); if (badge) badge.textContent = n ? `${n} waiting` : '';
    const det = $('bulkQueueDetails');
    if (det && n && !queueAutoOpened) { det.open = true; queueAutoOpened = true; }
  }
  // Clicking "Paste links instead" focuses the input.
  $('bulkQueueDetails')?.addEventListener('toggle', e => { if (e.target.open) setTimeout(() => $('queueAddInput')?.focus(), 50); });
  const queueList = $('bulkQueueList');
  if (queueList) new MutationObserver(syncBulkBadge).observe(queueList, { childList: true });


  // ── Store tags: tag text → data-plat so CSS can color them ──
  function tagPlatforms(root) {
    root.querySelectorAll('.bulk-tab-platform, .master-row-platform, .bulk-prog-platform').forEach(el => {
      const t = (el.textContent || '').trim().toLowerCase();
      if (t && t !== '?' && !el.dataset.plat) el.dataset.plat = t;
    });
  }
  tagPlatforms(document);
  new MutationObserver(muts => muts.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType === 1) tagPlatforms(n); }))).observe(document.body, { childList: true, subtree: true });


  // ── Quick settings (side panel) → same keys as the full settings page ──
  const qs = $$('#tab-settings [data-setting]');
  async function loadQuickSettings() {
    try {
      const d = await msg({ action: 'GET_DATA' });
      const st = d?.settings || {};
      qs.forEach(el => {
        const k = el.dataset.setting;
        if (el.type === 'checkbox') el.checked = st[k] !== undefined ? !!st[k] : true;
        else if (st[k] !== undefined) el.value = st[k];
      });
    } catch (_) {}
  }
  qs.forEach(el => el.addEventListener('change', async () => {
    const k = el.dataset.setting;
    const v = el.type === 'checkbox' ? el.checked : el.value;
    try {
      const res = await msg({ action: 'UPDATE_SETTINGS', settings: { [k]: v } });
      if (res?.success === false) throw new Error();
      if (k === 'bulkAutoCloseTabs' && typeof BulkState !== 'undefined') { BulkState.AUTO_CLOSE_TABS = !!v; const c = $('bulkAutoCloseToggle'); if (c) c.checked = !!v; }
      if (typeof State !== 'undefined' && State.data?.settings) State.data.settings[k] = v;
      toast('Saved', 'ok');
    } catch (_) { toast('Could not save setting', 'err'); }
  }));
  document.querySelector('#tab-btn-settings')?.addEventListener('click', () => {
    loadQuickSettings();
    loadSpStats();
  });
  loadQuickSettings();
  loadSpStats();

  // ── Settings tab ────────────────────────────────────────────
  function syncThemeSeg() {
    const light = document.body.classList.contains('light-mode');
    $$('#themeSeg button').forEach(b => b.classList.toggle('on', b.dataset.theme === (light ? 'light' : 'dark')));
  }
  $('themeSeg')?.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const light = document.body.classList.contains('light-mode');
    if ((b.dataset.theme === 'light') !== light) $('themeToggleBtn')?.click();
    setTimeout(syncThemeSeg, 50);
  });
  new MutationObserver(syncThemeSeg).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  syncThemeSeg();

  const FX_KEY = 'zhunter_fx';
  function applyFx(mode) {
    document.documentElement.dataset.fx = ['off', 'subtle', 'full'].includes(mode) ? mode : 'subtle';
    $$('#fxSeg button').forEach(b => b.classList.toggle('on', b.dataset.fx === document.documentElement.dataset.fx));
  }
  chrome.storage.local.get(FX_KEY).then(r => applyFx(r[FX_KEY] || 'full')).catch(() => applyFx('full'));
  $('fxSeg')?.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    applyFx(b.dataset.fx);
    chrome.storage.local.set({ [FX_KEY]: b.dataset.fx }).catch(() => {});
  });

  // ── Storage stats & Backup ──────────────────────────────────
  async function loadSpStats() {
    try {
      const bytes = await chrome.storage.local.getBytesInUse?.();
      const descEl = $('spStorageDesc');
      if (descEl) {
        if (typeof bytes === 'number') {
          const mb = (bytes / (1024 * 1024)).toFixed(2);
          const kb = (bytes / 1024).toFixed(1);
          descEl.textContent = bytes > 1024 * 1024 ? `${mb} MB used` : `${kb} KB used`;
        } else {
          descEl.textContent = 'Active (Local)';
        }
      }
    } catch (_) {}
  }
  $('spRefreshStatsBtn')?.addEventListener('click', loadSpStats);

  // JSON Export Backup
  $('spExportDataBtn')?.addEventListener('click', async () => {
    try {
      const st = await chrome.storage.local.get(['zhunterMasterSheet', 'zhunterMasterBatches', 'zhunterBulkQueue', 'zakLinkCollectorData']);
      const backup = {
        app: 'ZHunter',
        version: '9.0.0',
        exported: new Date().toISOString(),
        settings: st.zakLinkCollectorData?.settings || {},
        masterSheet: Array.isArray(st.zhunterMasterSheet) ? st.zhunterMasterSheet : [],
        batches: Array.isArray(st.zhunterMasterBatches) ? st.zhunterMasterBatches : [],
        queue: Array.isArray(st.zhunterBulkQueue) ? st.zhunterBulkQueue : []
      };
      if (!backup.masterSheet.length && !backup.queue.length && !Object.keys(backup.settings).length) {
        toast('Nothing to back up yet', 'warn');
        return;
      }
      const jsonBlob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      await zhSaveBlob(jsonBlob, `zhunter-backup-${new Date().toISOString().slice(0, 10)}.json`);
      toast(`Backup saved: ${backup.masterSheet.length} products`, 'ok');
    } catch (_) {
      toast('Backup failed', 'err');
    }
  });

  // ── Danger Zone ─────────────────────────────────────────────
  $('spDangerClearProducts')?.addEventListener('click', () => {
    if (typeof showConfirm !== 'function') return;
    showConfirm(
      'Clear All Products',
      'This empties the Library (all hunted products and hunt history). Settings and queue are kept. This cannot be undone.',
      'Delete All Products',
      async () => {
        try {
          const res = await msg({ action: 'CLEAR_ALL' });
          if (!res?.success) throw new Error();
          if (typeof refresh === 'function') await refresh();
          loadSpStats();
          toast('All products deleted', 'ok');
        } catch (_) {
          toast('Failed to clear products', 'err');
        }
      }
    );
  });

  $('spDangerResetSettings')?.addEventListener('click', () => {
    if (typeof showConfirm !== 'function') return;
    showConfirm(
      'Reset All Settings',
      'This will restore all settings to default values. Your saved products will NOT be deleted.',
      'Reset Settings',
      async () => {
        try {
          const defaultSettings = {
            autoCategory: true,
            duplicateCheck: true,
            badgeEnabled: true,
            saveToCurrentFolder: true,
            lastFolder: '',
            bulkFilenamePrefix: 'zhunter_',
            autoSkipDuplicates: true,
            bulkAutoCloseTabs: true,
            imageFormat: 'original',
            imageRatio: 'original',
            imageBg: 'white',
            imageMinSize: 0,
            imageMax5MB: true,
            bulkQueueAutoCapture: false
          };
          await msg({ action: 'UPDATE_SETTINGS', settings: defaultSettings });
          await loadQuickSettings();
          toast('Settings reset to defaults', 'ok');
        } catch (_) {
          toast('Failed to reset settings', 'err');
        }
      }
    );
  });

  $('spDangerWipeAll')?.addEventListener('click', () => {
    if (typeof showConfirm !== 'function') return;
    showConfirm(
      '⚠️ Wipe ALL Data',
      'This will permanently delete ALL products, folders, tags, settings, AND bulk hunt master sheet. This absolutely cannot be undone.',
      'Wipe Everything',
      async () => {
        try {
          await chrome.storage.local.remove([
            'zakLinkCollectorData',
            'zhunterMasterSheet',
            'zhunterMasterBatches',
            'zhunterBulkQueue',
            'zhunterHuntState',
            'zhunterPendingImageHunt',
            'zhunter_fx',
            'zakUIState'
          ]);
          location.reload();
        } catch (_) {
          toast('Failed to wipe data', 'err');
        }
      }
    );
  });


  // ── Sliding tab indicator ───────────────────────────────────
  const nav = document.querySelector('.tab-nav');
  function moveIndicator() {
    const a = nav?.querySelector('.tab-btn.active:not(.hidden)');
    if (!nav || !a) return;
    nav.classList.add('has-indicator');
    const nr = nav.getBoundingClientRect(), r = a.getBoundingClientRect();
    nav.style.setProperty('--tab-x', `${r.left - nr.left + r.width * 0.22}px`);
    nav.style.setProperty('--tab-w', `${r.width * 0.56}px`);
  }
  nav?.addEventListener('click', () => setTimeout(moveIndicator, 0));
  window.addEventListener('resize', moveIndicator);
  setTimeout(moveIndicator, 50);

  // ── Customizable Tab Visibility (v9.1) ───────────────────────
  const TAB_VISIBILITY_KEY = 'zhunter_tabs_visibility';
  const defaultTabVis = { hunt: true, bulk: true, library: true };

  const tabToggleHunt    = $('tabToggleHunt');
  const tabToggleBulk    = $('tabToggleBulk');
  const tabToggleLibrary = $('tabToggleLibrary');

  const btnHunt    = $('tab-btn-images');
  const btnBulk    = $('tab-btn-bulk');
  const btnLibrary = $('tab-btn-library');

  function applyTabVisibility(vis) {
    if (!vis) return;
    const isHunt    = vis.hunt !== false;
    const isBulk    = vis.bulk !== false;
    const isLibrary = vis.library !== false;

    if (btnHunt)    btnHunt.classList.toggle('hidden', !isHunt);
    if (btnBulk)    btnBulk.classList.toggle('hidden', !isBulk);
    if (btnLibrary) btnLibrary.classList.toggle('hidden', !isLibrary);

    if (tabToggleHunt)    tabToggleHunt.checked = isHunt;
    if (tabToggleBulk)    tabToggleBulk.checked = isBulk;
    if (tabToggleLibrary) tabToggleLibrary.checked = isLibrary;

    // If active tab was disabled, switch to first visible tab or settings
    const activeBtn = nav?.querySelector('.tab-btn.active');
    if (activeBtn && activeBtn.classList.contains('hidden')) {
      const fallbackBtn = nav?.querySelector('.tab-btn:not(.hidden)');
      if (fallbackBtn) fallbackBtn.click();
    }
    setTimeout(moveIndicator, 40);
  }

  async function saveTabVisibility() {
    let hunt    = tabToggleHunt ? tabToggleHunt.checked : true;
    let bulk    = tabToggleBulk ? tabToggleBulk.checked : true;
    let library = tabToggleLibrary ? tabToggleLibrary.checked : true;

    // Safeguard: Ensure at least one hunting tab remains enabled
    if (!hunt && !bulk && !library) {
      hunt = true;
      if (tabToggleHunt) tabToggleHunt.checked = true;
      if (typeof toast === 'function') toast('At least one tab must remain enabled', 'warn');
    }

    const vis = { hunt, bulk, library };
    try {
      await chrome.storage.local.set({ [TAB_VISIBILITY_KEY]: vis });
    } catch (_) {}
    applyTabVisibility(vis);
  }

  try {
    chrome.storage.local.get([TAB_VISIBILITY_KEY], res => {
      const saved = res?.[TAB_VISIBILITY_KEY] || defaultTabVis;
      applyTabVisibility(saved);
    });
  } catch (_) {}

  tabToggleHunt?.addEventListener('change', saveTabVisibility);
  tabToggleBulk?.addEventListener('change', saveTabVisibility);
  tabToggleLibrary?.addEventListener('change', saveTabVisibility);

  // ── Count-up on the hunt-complete stats ─────────────────────
  function countUp(el) {
    const target = parseInt(el.textContent, 10);
    if (!Number.isFinite(target) || target === 0 || document.documentElement.dataset.fx === 'off') return;
    const t0 = performance.now(), dur = 600;
    const step = now => { const p = Math.min(1, (now - t0) / dur); el.textContent = String(Math.round(target * (1 - Math.pow(1 - p, 3)))); if (p < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }
  const summary = $('bulkResultSummary');
  if (summary) new MutationObserver(() => { if (!summary.classList.contains('hidden')) ['bulkRsOk','bulkRsPartial','bulkRsFail'].forEach(id => { const el = $(id); if (el) countUp(el); }); })
    .observe(summary, { attributes: true, attributeFilter: ['class'] });

  // ── Live status line while hunting ──────────────────────────
  const progText = $('bulkProgText');
  if (progText) new MutationObserver(() => {
    const t = $('statusLineText'); if (!t) return;
    const modalOpen = !$('bulkProgressModal')?.classList.contains('hidden');
    if (modalOpen && progText.textContent.trim()) t.textContent = `Hunting ${progText.textContent.trim()}`;
    else syncStatus();
  }).observe(progText, { childList: true, characterData: true, subtree: true });

  // ── Status line ─────────────────────────────────────────────
  async function syncStatus() {
    try {
      const bytes = await chrome.storage.local.getBytesInUse(null);
      const mb = bytes / 1048576;
      const size = mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
      const t = $('statusLineText'); if (t) t.textContent = `Local · ${size}`;
    } catch (_) {}
  }
  syncStatus();
  setInterval(syncStatus, 30000);
})();
