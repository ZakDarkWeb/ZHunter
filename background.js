// ============================================================
// ZHunter PRO v7.10.0 - Background Service Worker
// Handles storage operations, messaging, content script orchestration, and AI generation
// ============================================================
'use strict';

// ── NO Firebase SDK ── Cloud sync uses Firestore REST API via fetch()
// This avoids loading 500KB+ SDK files that block service worker startup
// and cause bulk hunting failures. Pure fetch() works perfectly in MV3.

const STORAGE_KEY   = 'zakLinkCollectorData';
const PRODUCT_QUEUE_KEY = 'zhunterProductQueue';
const BADGE_COLOR   = '#06b6d4';
const SUCCESS_COLOR = '#10b981';

// Bulk Queue storage key — persistent queue of product URLs to hunt sequentially
const BULK_QUEUE_KEY = 'zhunterBulkQueue';

// Platform hostname patterns for auto-capture (mirrors PLATFORM_PATTERNS in popup.js)
const BG_PLATFORM_KEYS = [
  'walmart.com', 'amazon.', 'samsclub.com', 'faire.com', 'aliexpress.',
  'alibaba.com', 'temu.', 'ebay.', 'etsy.com', 'shein.com', 'daraz.',
  'worldwidegolfballs.com', 'worldwidegolfshops.com', 'flipkart.com',
  'noon.com', 'lazada.', 'myshopify.com', 'target.com', 'costco.com',
  'bestbuy.com', 'homedepot.com'
];
function bgDetectPlatform(url) {
  if (!url) return null;
  try {
    const h = new URL(url).hostname.toLowerCase();
    return BG_PLATFORM_KEYS.find(k => h.includes(k)) || null;
  } catch { return null; }
}

const IMG_CAP = 15;
const VID_CAP = 12;

// Secrets are kept in local storage for the worker only. They are never returned
// by GET_DATA/GET_SETTINGS or synced to the cloud payload.
const SECRET_SETTING_KEYS = new Set([
  'aiApiKey', 'openRouterApiKey', 'groqApiKey', 'geminiApiKey', 'openAiApiKey'
]);
const PUBLIC_SETTING_KEYS = new Set([
  'autoCategory', 'duplicateCheck', 'badgeEnabled', 'saveToCurrentFolder',
  'lastFolder', 'activeAiProvider', 'bulkFilenamePrefix', 'autoSkipDuplicates', 'cloudSyncEnabled',
  'imageFormat', 'imageRatio', 'imageBg', 'imageMinSize', 'imageMax5MB',
  'bulkQueueAutoCapture', 'bulkSheetColumns', 'customBulkColumns',
  'productSheetColumns', 'customProductColumns', 'migratedToOriginal_2'
]);

const FETCH_CONCURRENCY = 8;   // was 16 — moderate concurrency to prevent network congestion
const FETCH_TIMEOUT_MS  = 12000; // was 5000 — safer timeout to prevent image download failures
const FETCH_MAX_BYTES   = 6 * 1024 * 1024;
const AI_TIMEOUT_MS     = 28000;

// ── Write Mutex ──────────────────────────────────────────────
// Serialises all storage-mutating operations to prevent read-modify-write
// race conditions when multiple messages arrive concurrently.
let _writeLock = Promise.resolve();
function withWriteLock(fn) {
  const result = _writeLock.then(fn);
  _writeLock = result.catch(() => {});
  return result;
}

// ── Service Worker Keepalive ─────────────────────────────────
// MV3 service workers are terminated after ~30 s of inactivity.
// Call startKeepAlive() before long bulk operations, stopKeepAlive() after.
let _keepAliveInterval = null;
let _keepAliveTimeout = null;
function startKeepAlive() {
  if (_keepAliveInterval) { clearInterval(_keepAliveInterval); _keepAliveInterval = null; }
  if (_keepAliveTimeout) { clearTimeout(_keepAliveTimeout); _keepAliveTimeout = null; }
  _keepAliveInterval = setInterval(() => {
    chrome.runtime.getPlatformInfo(() => {}); // no-op — just prevents SW termination
  }, 20000);
  _keepAliveTimeout = setTimeout(() => {
    stopKeepAlive();
  }, 15 * 60 * 1000); // 15 mins max
}
function stopKeepAlive() {
  if (_keepAliveInterval) { clearInterval(_keepAliveInterval); _keepAliveInterval = null; }
  if (_keepAliveTimeout) { clearTimeout(_keepAliveTimeout); _keepAliveTimeout = null; }
}

// ── Rate Limiter ─────────────────────────────────────────────
// Prevents a malicious page from flooding the extension with messages.
const _rateLimitMap = new Map();
const RATE_LIMIT_MAX       = 30;    // max requests per window per sender
const RATE_LIMIT_WINDOW_MS = 10000; // 10-second rolling window
function isRateLimited(sender) {
  const key  = sender.tab?.id ?? 'extension';
  const now  = Date.now();
  let   entry = _rateLimitMap.get(key);
  if (!entry || now > entry.resetAt) entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
  entry.count++;
  _rateLimitMap.set(key, entry);
  return entry.count > RATE_LIMIT_MAX;
}

// ── IndexedDB Helper ─────────────────────────────────────────
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('ZHunterMedia', 1);
    request.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('images')) {
        db.createObjectStore('images', { keyPath: 'id' });
      }
    };
    request.onsuccess = e => resolve(e.target.result);
    request.onerror = e => reject(e.target.error);
  });
}

async function saveImagesToIndexedDB(id, imagesBase64) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('images', 'readwrite');
      tx.objectStore('images').put({ id, images: imagesBase64 });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  } catch (_) { return false; }
}

async function getImagesFromIndexedDB(id) {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction('images', 'readonly');
      const req = tx.objectStore('images').get(id);
      req.onsuccess = () => resolve(req.result ? req.result.images : []);
      req.onerror = () => resolve([]);
    });
  } catch (_) { return []; }
}

async function deleteImagesFromIndexedDB(id) {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction('images', 'readwrite');
      tx.objectStore('images').delete(id);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch (_) { return false; }
}

async function clearIndexedDBImages() {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction('images', 'readwrite');
      tx.objectStore('images').clear();
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch (_) { return false; }
}

// ============================================================
// ☁️ CLOUD SYNC MODULE — Firestore REST API (no SDK needed)
// ============================================================
// Uses Firestore REST API via fetch() — zero startup cost.
// No importScripts, no 500KB SDK, no hunting interference.
// Rules must be: allow read, write: if true
// ============================================================

const _FS_PROJECT = 'zhunter-66d4d';
const _FS_API_KEY = 'AIzaSyC8X3tV3oKnZnq2oiJ7VSUAp8M8ei_FyiM';
const _FS_BASE    = `https://firestore.googleapis.com/v1/projects/${_FS_PROJECT}/databases/(default)/documents`;
// Cloud sync is intentionally disabled until authenticated Firebase rules and
// conflict-safe authorization are deployed.
const CLOUD_SYNC_AVAILABLE = false;
let _cloudUserId = null;  // cached user/device ID
let _cloudReady  = false; // true after first successful sync
let _syncPending = false; // debounce flag

/**
 * Get a stable user ID.
 * Tries Google account first, falls back to persistent device UUID.
 */
async function _getCloudUserId() {
  if (_cloudUserId) return _cloudUserId;

  // Try Chrome Google account (cross-device)
  try {
    const info = await new Promise((resolve) => {
      chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' }, (i) => {
        resolve(chrome.runtime.lastError ? null : i);
      });
    });
    if (info && info.id && info.id.length > 4) {
      _cloudUserId = 'g_' + info.id;
      return _cloudUserId;
    }
  } catch (_) {}

  // Fallback: persistent device UUID (always works)
  try {
    const stored = await chrome.storage.local.get('_zhunterDeviceId');
    if (stored._zhunterDeviceId) {
      _cloudUserId = stored._zhunterDeviceId;
      return _cloudUserId;
    }
    const newId = 'd_' + crypto.randomUUID().replace(/-/g, '');
    await chrome.storage.local.set({ _zhunterDeviceId: newId });
    _cloudUserId = newId;
    return _cloudUserId;
  } catch (err) {
    return null;
  }
}

/**
 * Write data to Firestore via REST API.
 * Stores a compact JSON payload in a single string field.
 */
async function _syncToCloud(data) {
  try {
    const uid = await _getCloudUserId();
    if (!uid) return false;

    // Strip large base64 images — only metadata
    const safeLinks = (data.links || []).map(l => {
      const { images, ...rest } = l;
      return { ...rest, _hasImages: Array.isArray(images) && images.length > 0 };
    });

    const payload = JSON.stringify({
      links:      safeLinks,
      folders:    data.folders  || [],
      tags:       data.tags     || [],
      history:    (data.history || []).slice(0, 100),
      settings:   getPublicSettings(data.settings || {}),
      lastSynced: new Date().toISOString(),
      version:    chrome.runtime.getManifest().version
    });

    const url = `${_FS_BASE}/zhunter_users/${encodeURIComponent(uid)}/data/main?key=${_FS_API_KEY}`;
    const res = await fetch(url, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          payload:    { stringValue: payload },
          lastSynced: { stringValue: new Date().toISOString() },
          uid:        { stringValue: uid }
        }
      }),
      signal: AbortSignal.timeout(15000)
    });

    if (res.ok) {
      _cloudReady = true;
      console.log(`[☁️ ZHunter] Synced ${safeLinks.length} products to Firestore.`);
      return true;
    }
    const errBody = await res.text().catch(() => '');
    console.warn(`[☁️ ZHunter] Firestore write failed ${res.status}:`, errBody);
    return false;
  } catch (err) {
    console.warn('[☁️ ZHunter] Cloud sync error:', err.message);
    return false;
  }
}

/**
 * Read data from Firestore via REST API.
 */
async function _loadFromCloud() {
  try {
    const uid = await _getCloudUserId();
    if (!uid) return { success: false, error: 'no_user_id' };

    const url = `${_FS_BASE}/zhunter_users/${encodeURIComponent(uid)}/data/main?key=${_FS_API_KEY}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });

    if (res.status === 404) return { success: false, error: 'no_cloud_data' };
    if (!res.ok) return { success: false, error: `http_${res.status}` };

    const doc = await res.json();
    const payloadStr = doc?.fields?.payload?.stringValue;
    if (!payloadStr) return { success: false, error: 'empty_payload' };

    const data = JSON.parse(payloadStr);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/** Debounced cloud sync — waits ~3 s after last save before pushing. */
function _debouncedSync(data) {
  if (_syncPending) return;
  _syncPending = true;
  chrome.storage.session.set({ _pendingSync: JSON.stringify(data) }).catch(() => {});
  chrome.alarms.create('cloudSyncDebounce', { delayInMinutes: 1 / 20 }); // ~3 s
}

/** Returns cloud sync status for UI indicator. */
async function _getCloudStatus() {
  const uid = await _getCloudUserId();
  const isGoogle = uid && uid.startsWith('g_');
  const isDevice = uid && uid.startsWith('d_');
  return {
    enabled: !!uid,
    userId:  uid,
    ready:   _cloudReady,
    type:    isGoogle ? 'google' : isDevice ? 'device' : 'none',
    label:   isGoogle ? 'Google Account' : isDevice ? 'This Device' : 'Not Connected'
  };
}

// ── AI CONFIGURATION ─────────────────────────────────────────
const AI_BASE_URL = 'https://openrouter.ai/api/v1/chat/completions';
const AI_MODELS = [
  'openai/gpt-oss-120b:free',
  'meta-llama/llama-3.1-8b-instruct:free',
  'mistralai/mistral-7b-instruct:free',
  'google/gemma-2-9b-it:free',
  'nousresearch/hermes-3-llama-3.1-405b:free',
  'meta-llama/llama-3.3-70b-instruct:free'
];

const DEFAULT_DATA = {
  links:   [],
  folders: ['General', 'Favorites', 'Read Later'],
  tags:    ['Important', 'Unread', 'To Buy', 'Reference', 'Watch Later'],
  history: [],
  settings: {
    autoCategory:        true,
    duplicateCheck:      true,
    badgeEnabled:        true,
    saveToCurrentFolder: false,
    lastFolder:          'General',
    aiApiKey:            '',
    bulkFilenamePrefix:  'zhunter_',
    autoSkipDuplicates:  true,
    cloudSyncEnabled:    false,
    imageFormat:         'jpg',        // 'original' | 'jpg' | 'png'
    bulkSheetColumns: {
      no: true,           title: true,        url: true,
      platform: true,     price: true,        labelCost: true,
      listPrice: true,    profit: true,       description: true,
      tags: false,        variants: false,    imageCount: true,
      videoCount: false,  scrapedAt: true,    status: false,
      // Image URL columns — OFF by default; user must enable in Settings → Columns
      img1: false,  img2: false,  img3: false,  img4: false,  img5: false,
      img6: false,  img7: false,  img8: false,  img9: false,  img10: false,
      videoUrl: false,
      weight: false, dimL: false, dimW: false, dimH: false
    },
    customBulkColumns: [],
    // Product Queue Sheet: the original four columns stay enabled by default;
    // optional research fields are opt-in from Settings.
    productSheetColumns: {
      folderNumber: true, title: true, link: true, sourcingPrice: true,
      platform: false, description: false, imageCount: false, videoCount: false,
      imageLinks: false, videoLinks: false, variants: false, status: false,
      source: false, createdAt: false
    },
    customProductColumns: []
  }
};

function getPublicSettings(settings = {}) {
  const publicSettings = {};
  for (const key of PUBLIC_SETTING_KEYS) {
    if (Object.prototype.hasOwnProperty.call(settings, key)) publicSettings[key] = settings[key];
  }
  publicSettings.hasApiKey = [...SECRET_SETTING_KEYS].some(key => typeof settings[key] === 'string' && settings[key].trim());
  publicSettings.configuredProviders = [
    ['OpenRouter', settings.openRouterApiKey || settings.aiApiKey],
    ['Groq', settings.groqApiKey],
    ['Gemini', settings.geminiApiKey],
    ['OpenAI', settings.openAiApiKey]
  ].filter(([, value]) => typeof value === 'string' && value.trim()).map(([provider]) => provider);
  return publicSettings;
}

function sanitizeSettingsPatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return {};
  const clean = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!PUBLIC_SETTING_KEYS.has(key) && !SECRET_SETTING_KEYS.has(key)) continue;
    if (SECRET_SETTING_KEYS.has(key)) {
      if (typeof value === 'string' && value.length <= 500) clean[key] = value.trim();
      continue;
    }
    if (key === 'cloudSyncEnabled' && !CLOUD_SYNC_AVAILABLE) {
      clean[key] = false;
      continue;
    }
    if (typeof value === 'string') clean[key] = value.slice(0, 5000);
    else if (typeof value === 'boolean' || typeof value === 'number') clean[key] = value;
    else if (Array.isArray(value)) clean[key] = value.slice(0, 200);
    else if (value && typeof value === 'object') clean[key] = { ...value };
  }
  return clean;
}

// ── Storage helpers ──────────────────────────────────────────
async function getData() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const stored = result[STORAGE_KEY];
    if (!stored) return JSON.parse(JSON.stringify(DEFAULT_DATA));
    const settings = {
      ...DEFAULT_DATA.settings,
      ...(stored.settings || {}),
      productSheetColumns: {
        ...DEFAULT_DATA.settings.productSheetColumns,
        ...(stored.settings?.productSheetColumns || {})
      },
      customProductColumns: Array.isArray(stored.settings?.customProductColumns)
        ? stored.settings.customProductColumns
        : [...DEFAULT_DATA.settings.customProductColumns]
    };
    
    // Auto-migrate old defaults to the new "Original" values
    if (!settings.migratedToOriginal_2) {
      settings.imageFormat = 'jpg';
      settings.imageRatio = 'original';
      settings.imageBg = 'original';
      settings.imageMinSize = 0;
      settings.migratedToOriginal_2 = true;
      await chrome.storage.local.set({ [STORAGE_KEY]: { ...stored, settings } });
    }

    return {
      links:    Array.isArray(stored.links)   ? stored.links   : [],
      folders:  Array.isArray(stored.folders) ? stored.folders : DEFAULT_DATA.folders,
      tags:     Array.isArray(stored.tags)    ? stored.tags    : DEFAULT_DATA.tags,
      history:  Array.isArray(stored.history) ? stored.history : [],
      settings
    };
  } catch (_) {
    return JSON.parse(JSON.stringify(DEFAULT_DATA));
  }
}

async function saveData(data) {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: data });
    await updateBadge(data.links.length, data.settings.badgeEnabled);
    // Cloud sync is opt-in. The normal free workflow remains local-only.
    if (data.settings?.cloudSyncEnabled === true && CLOUD_SYNC_AVAILABLE) _debouncedSync(data);
    return true;
  } catch (err) {
    console.warn('[ZHunter] Local storage write failed:', err?.message || 'storage_error');
    return false;
  }
}

// ── NO-TAB PRODUCT QUEUE ──────────────────────────────────────
let _queueProcessPromise = null;

function normalizeQueueUrl(raw) {
  try {
    const u = new URL(String(raw || '').trim());
    u.hash = '';
    u.hostname = u.hostname.toLowerCase();
    if ((u.protocol === 'https:' && u.port === '443') || (u.protocol === 'http:' && u.port === '80')) u.port = '';
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|gclid$|fbclid$|msclkid$|ref$)/i.test(key)) u.searchParams.delete(key);
    }
    u.searchParams.sort();
    return u.href;
  } catch (_) { return ''; }
}

function normalizeFolderNumber(value) {
  const n = String(value ?? '').trim().replace(/[^0-9A-Za-z_-]/g, '').slice(0, 20);
  return n || '1';
}

function folderLabel(index) {
  return `Folder ${String(index + 1).padStart(2, '0')}`;
}

function orderedQueueItems(queue, completeOnly = false) {
  return (Array.isArray(queue) ? queue : [])
    .filter(item => !completeOnly || item.status === 'complete')
    .slice()
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || String(a.id || '').localeCompare(String(b.id || '')));
}

function queueFolderMap(queue) {
  return new Map(orderedQueueItems(queue).map((item, index) => [item.id, folderLabel(index)]));
}

async function getProductQueue() {
  try {
    const stored = await chrome.storage.local.get(PRODUCT_QUEUE_KEY);
    return Array.isArray(stored[PRODUCT_QUEUE_KEY]) ? stored[PRODUCT_QUEUE_KEY] : [];
  } catch (_) { return []; }
}

async function saveProductQueue(queue) {
  await chrome.storage.local.set({ [PRODUCT_QUEUE_KEY]: queue.slice(0, 2000) });
}

async function addProductQueueItems(items) {
  const queue = await getProductQueue();
  const known = new Set(queue.map(item => normalizeQueueUrl(item.url)).filter(Boolean));
  const added = [];
  const rejected = [];

  let nextFolder = queue.reduce((max, item) => {
    const match = String(item?.folderNumber || '').match(/\d+/);
    return Math.max(max, match ? Number(match[0]) : 0);
  }, 0) + 1;
  for (const raw of Array.isArray(items) ? items : []) {
    const url = normalizeQueueUrl(raw?.url || raw);
    if (!url || !isSupportedProductUrl(url)) {
      if (raw?.url || raw) rejected.push(String(raw?.url || raw));
      continue;
    }
    if (known.has(url)) continue;
    const item = {
      id: `pq_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      url,
      title: sanitizeText(raw?.title || ''),
      price: sanitizeText(raw?.price || ''),
      folderNumber: String(nextFolder++).padStart(2, '0'),
      status: 'queued',
      error: '',
      attempts: 0,
      platform: '',
      description: '',
      images: [],
      videos: [],
      variants: [],
      source: ['context_menu', 'open_tab', 'page_scan', 'current_page'].includes(raw?.source) ? raw.source : 'manual',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    queue.unshift(item);
    known.add(url);
    added.push(item);
  }

  await saveProductQueue(queue);
  if (added.length) broadcastMessage({ action: 'PRODUCT_QUEUE_UPDATED', added: added.length });
  return { success: true, added, addedCount: added.length, rejected, total: queue.length };
}

async function waitForQueueTab(tabId, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tab = await new Promise(resolve => chrome.tabs.get(tabId, t => resolve(chrome.runtime.lastError ? null : t)));
    if (!tab) throw new Error('processing_tab_closed');
    if (tab.status === 'complete') { await new Promise(r => setTimeout(r, 120)); return tab; }
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error('page_load_timeout');
}

async function queueSendMessage(tabId, message, timeoutMs = 15000) {
  return await new Promise(resolve => {
    let done = false;
    const finish = value => { if (!done) { done = true; clearTimeout(timer); resolve(value); } };
    const timer = setTimeout(() => finish(null), timeoutMs);
    try {
      chrome.tabs.sendMessage(tabId, message, response => {
        if (chrome.runtime.lastError) finish(null);
        else finish(response || null);
      });
    } catch (_) { finish(null); }
  });
}

async function requestQueueScrape(tabId) {
  const tab = await new Promise(resolve => chrome.tabs.get(tabId, t => resolve(chrome.runtime.lastError ? null : t)));
  if (!tab || !/^https?:\/\//i.test(String(tab.url || ''))) throw new Error('unsupported_processing_url');
  // The manifest content script normally exists after document_idle. Ask it
  // directly first; only inject when navigation raced document_idle. The old
  // PING → inject → PING sequence added avoidable latency to every product.
  let response = await queueSendMessage(tabId, { action: 'SCRAPE_PAGE' }, 20000);
  if (response?.success && response.data) return response;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    await new Promise(resolve => setTimeout(resolve, 90));
  } catch (_) { return response; }
  return await queueSendMessage(tabId, { action: 'SCRAPE_PAGE' }, 20000);
}

const QUEUE_MAX_ATTEMPTS = 5;
const QUEUE_RETRY_BASE_MS = 900;

function queueSleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

let _queueUpdateChain = Promise.resolve();

function updateQueueItem(id, patch) {
  const operation = _queueUpdateChain.then(async () => {
    const queue = await getProductQueue();
    const item = queue.find(x => x.id === id);
    if (!item) return null;
    Object.assign(item, patch, { updatedAt: new Date().toISOString() });
    await saveProductQueue(queue);
    return item;
  });
  _queueUpdateChain = operation.catch(() => null);
  return operation;
}

const TRANSIENT_QUEUE_TITLE = /^(adding to cart|add to cart|added to cart|loading(?:\.\.\.)?|please wait(?:\.\.\.?)?|checkout|your amazon\.com cart|amazon\.com shopping cart|cart|processing)$/i;

function isTransientQueueTitle(value) {
  return !String(value || '').trim() || TRANSIENT_QUEUE_TITLE.test(String(value).trim());
}

function queueFallbackTitle(url) {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/').filter(Boolean);
    const candidate = decodeURIComponent(parts[parts.length - 1] || '').replace(/[-_]+/g, ' ').replace(/\b\d{6,}\b/g, '').trim();
    return candidate ? candidate.slice(0, 500) : parsed.hostname.replace(/^www\./i, '');
  } catch (_) { return 'Product'; }
}

function queueTitle(scrapedTitle, originalTitle, url) {
  const candidates = [scrapedTitle, originalTitle];
  for (const candidate of candidates) {
    const clean = sanitizeText(candidate).trim();
    if (!isTransientQueueTitle(clean)) return clean;
  }
  return queueFallbackTitle(url);
}

async function reloadQueueTab(tabId) {
  await new Promise(resolve => {
    try { chrome.tabs.reload(tabId, {}, () => resolve()); }
    catch (_) { resolve(); }
  });
  await waitForQueueTab(tabId, 25000);
}

async function scrapeQueueItem(tabId, item, total, processed) {
  let lastError = 'processing_failed';
  const firstAttempt = Math.min(QUEUE_MAX_ATTEMPTS, Math.max(1, (item.attempts || 0) + 1));

  for (let attempt = firstAttempt; attempt <= QUEUE_MAX_ATTEMPTS; attempt++) {
    const status = attempt === 1 ? 'processing' : 'retrying';
    // Do not serialize a storage write before every item. The completion or
    // failure write below persists the authoritative state, while this live
    // status is already sent to the side panel immediately.
    broadcastMessage({ action: 'PRODUCT_QUEUE_PROGRESS', id: item.id, status, attempt, maxAttempts: QUEUE_MAX_ATTEMPTS, processed, total });

    try {
      await chrome.tabs.update(tabId, { url: item.url, active: false });
      await waitForQueueTab(tabId);
      const response = await requestQueueScrape(tabId);
      if (!response?.success || !response.data) throw new Error(response?.error || 'scrape_failed');

      // Amazon can briefly expose a transient tab title while its product page
      // hydrates. Re-scrape once after the page settles instead of saving a
      // cart/loading title or treating the tab as skipped.
      if (isTransientQueueTitle(response.data?.title) && /amazon\./i.test(item.url)) {
        await queueSleep(1500);
        const settled = await queueSendMessage(tabId, { action: 'SCRAPE_PAGE' }, 20000);
        if (settled?.success && settled.data) response = settled;
      }
      const scraped = response.data || {};
      const saved = await updateQueueItem(item.id, {
        title: queueTitle(scraped.title, item.title, item.url),
        price: sanitizeText(scraped.price || item.price || ''),
        platform: detectCategory(item.url),
        description: sanitizeText(scraped.description || scraped.notes || ''),
        images: Array.isArray(scraped.images) ? scraped.images.filter(isValidURL).slice(0, 15) : [],
        videos: Array.isArray(scraped.videos) ? scraped.videos.filter(v => typeof v === 'string' && isValidURL(v)).slice(0, 12) : [],
        variants: Array.isArray(scraped.variants) ? scraped.variants.map(v => typeof v === 'string' ? sanitizeText(v) : sanitizeText(v?.name || v?.value || '')).filter(Boolean).slice(0, 20) : [],
        status: 'complete',
        error: '',
        attempts: attempt
      });
      if (!saved) return { success: false, removed: true };
      broadcastMessage({ action: 'PRODUCT_QUEUE_PROGRESS', id: item.id, status: 'complete', attempt, processed: processed + 1, total });
      return { success: true };
    } catch (err) {
      lastError = sanitizeText(err?.message || 'processing_failed');
      const hasRetry = attempt < QUEUE_MAX_ATTEMPTS;
      await updateQueueItem(item.id, {
        status: hasRetry ? 'retrying' : 'needs_retry',
        attempts: attempt,
        error: hasRetry ? `${lastError} — retry ${attempt + 1}/${QUEUE_MAX_ATTEMPTS}` : `${lastError} after ${QUEUE_MAX_ATTEMPTS} attempts`
      });
      broadcastMessage({ action: 'PRODUCT_QUEUE_PROGRESS', id: item.id, status: hasRetry ? 'retrying' : 'needs_retry', attempt, maxAttempts: QUEUE_MAX_ATTEMPTS, error: lastError, processed, total });
      if (!hasRetry) return { success: false, needsRetry: true };

      // The next attempt navigates to the product URL again, so a separate
      // reload here only caused a duplicate page load and made retries slower.
      await queueSleep(Math.min(QUEUE_RETRY_BASE_MS * (2 ** (attempt - 1)), 3000));
    }
  }
  return { success: false, needsRetry: true, error: lastError };
}

async function processProductQueue() {
  if (_queueProcessPromise) return _queueProcessPromise;
  _queueProcessPromise = (async () => {
    const runStartedAt = Date.now();
    let windowId = null;
    const workerTabs = [];
    try {
      const queue = await getProductQueue();
      const pending = queue.filter(item => item.status !== 'complete' && item.status !== 'needs_retry');
      if (!pending.length) {
        return { success: true, processed: 0, total: queue.length, needsRetry: queue.filter(x => x.status === 'needs_retry').length, durationMs: Date.now() - runStartedAt, workerCount: 0 };
      }

      // Two hidden tabs provide a practical speed-up without opening dozens of
      // visible tabs. Each tab has its own navigation/content-script lifecycle.
      try {
        const win = await chrome.windows.create({ url: 'about:blank', focused: false, state: 'minimized', type: 'normal' });
        windowId = win?.id || null;
        if (win?.tabs?.[0]?.id) workerTabs.push(win.tabs[0].id);
        if (windowId && workerTabs.length < 2) {
          const second = await chrome.tabs.create({ windowId, url: 'about:blank', active: false });
          if (second?.id) workerTabs.push(second.id);
        }
      } catch (_) {}
      if (!workerTabs.length) {
        const first = await chrome.tabs.create({ url: 'about:blank', active: false });
        if (first?.id) workerTabs.push(first.id);
      }
      if (!workerTabs.length) throw new Error('could_not_create_processing_tab');

      let processed = 0;
      let cursor = 0;
      await Promise.all(workerTabs.slice(0, 2).map(async tabId => {
        while (true) {
          const index = cursor++;
          if (index >= pending.length) return;
          const item = pending[index];
          const live = (await getProductQueue()).find(x => x.id === item.id);
          if (!live || live.status === 'complete') continue;
          const result = await scrapeQueueItem(tabId, live, pending.length, processed);
          if (result.success) processed++;
        }
      }));
      await _queueUpdateChain;
      const finalQueue = await getProductQueue();
      const durationMs = Date.now() - runStartedAt;
      return {
        success: true,
        processed,
        total: finalQueue.length,
        needsRetry: finalQueue.filter(x => x.status === 'needs_retry').length,
        durationMs,
        workerCount: Math.min(2, workerTabs.length),
        averageMs: processed ? Math.round(durationMs / processed) : 0
      };
    } finally {
      if (windowId) { try { await chrome.windows.remove(windowId); } catch (_) {} }
      else {
        for (const tabId of workerTabs) { try { await chrome.tabs.remove(tabId); } catch (_) {} }
      }
    }
  })();
  try { return await _queueProcessPromise; }
  finally { _queueProcessPromise = null; }
}

function freeResearchScore(item) {
  let score = 0;
  if (item.title) score += 20;
  if (item.price) score += 20;
  if (item.url) score += 10;
  if (item.images?.length) score += 20;
  if (item.videos?.length) score += 10;
  if (item.variants?.length) score += 10;
  if (item.description) score += 10;
  return score;
}

async function getProductSheetRows() {
  const data = await getData();
  const allQueue = await getProductQueue();
  const queue = orderedQueueItems(allQueue, true);
  const folders = queueFolderMap(allQueue);
  const customColumns = Array.isArray(data.settings?.customProductColumns) ? data.settings.customProductColumns : [];
  return queue.map(item => {
    const imageLinks = Array.isArray(item.images) ? item.images.filter(isValidURL).slice(0, 15) : [];
    const videoLinks = Array.isArray(item.videos) ? item.videos.filter(isValidURL).slice(0, 12) : [];
    const row = {
      'Folder Number': folders.get(item.id) || 'Folder 01',
      'Product Title': item.title || '',
      'Link': item.url || '',
      'Sourcing Price': item.price || '',
      'Platform': item.platform || detectCategory(item.url),
      'Description': item.description || '',
      'Image Count': imageLinks.length,
      'Video Count': videoLinks.length,
      'Image Links': imageLinks.join('\\n'),
      'Video Links': videoLinks.join('\\n'),
      'Variants': Array.isArray(item.variants) ? item.variants.join('\\n') : '',
      'Status': item.status || 'complete',
      'Source': item.source || '',
      'Date Added': item.createdAt || ''
    };
    customColumns.forEach(column => { if (column?.key) row[column.key] = ''; });
    return row;
  });
}

async function getProductResearchWorkbook() {
  const queue = await getProductQueue();
  const ordered = orderedQueueItems(queue);
  const folderById = queueFolderMap(queue);
  const products = ordered.map(item => ({
    'Folder Number': folderById.get(item.id) || 'Folder 01',
    'Product Title': item.title || '',
    'Link': item.url || '',
    'Sourcing Price': item.price || '',
    'Platform': item.platform || detectCategory(item.url),
    'Status': item.status || 'queued',
    'Images': Array.isArray(item.images) ? item.images.length : 0,
    'Videos': Array.isArray(item.videos) ? item.videos.length : 0,
    'Variants': Array.isArray(item.variants) ? item.variants.length : 0,
    'Research Score': freeResearchScore(item),
    'Description': item.description || '',
    'Last Updated': item.updatedAt || ''
  }));
  const media = [];
  queue.forEach(item => {
    (item.images || []).forEach((url, index) => media.push({
      'Product Title': item.title || '', 'Link': item.url || '', 'Media Type': 'Image',
      'Position': index + 1, 'Media URL': url, 'Status': item.status || 'queued'
    }));
    (item.videos || []).forEach((url, index) => media.push({
      'Product Title': item.title || '', 'Link': item.url || '', 'Media Type': 'Video',
      'Position': index + 1, 'Media URL': url, 'Status': item.status || 'queued'
    }));
  });
  const costing = ordered.map(item => ({
    'Folder Number': folderById.get(item.id) || 'Folder 01',
    'Product Title': item.title || '',
    'Sourcing Price': item.price || '',
    'Selling Price': '',
    'Shipping Cost': '',
    'Fees %': '',
    'Landed Cost': '',
    'Profit': '',
    'Margin %': '',
    'ROI %': ''
  }));
  const errors = ordered.filter(item => item.status !== 'complete').map(item => ({
    'Folder Number': folderById.get(item.id) || 'Folder 01',
    'Product Title': item.title || '',
    'Link': item.url || '',
    'Status': item.status || 'queued',
    'Attempts': item.attempts || 0,
    'Last Error': item.error || ''
  }));
  return { products, media, costing, errors };
}

async function mutateLink(id, mutator) {
  const data = await getData();
  const idx = data.links.findIndex(l => l.id === id);
  if (idx === -1) return null;
  const updated = mutator({ ...data.links[idx] }) || data.links[idx];
  updated.dateModified = new Date().toISOString();
  data.links[idx] = updated;
  await saveData(data);
  return updated;
}

// ── Badge ────────────────────────────────────────────────────
async function updateBadge(count, badgeEnabled) {
  try {
    if (badgeEnabled === undefined || count === undefined) {
      const d = await getData();
      badgeEnabled = d.settings.badgeEnabled;
      count = d.links.length;
    }
    await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
    if (!badgeEnabled) {
      await chrome.action.setBadgeText({ text: '' });
      return;
    }
    const n = typeof count === 'number' ? count : 0;
    const text = n > 99 ? '99+' : n > 0 ? String(n) : '';
    await chrome.action.setBadgeText({ text });
  } catch (_) {}
}

async function flashBadgeSuccess() {
  try {
    await chrome.action.setBadgeText({ text: '✓' });
    await chrome.action.setBadgeBackgroundColor({ color: SUCCESS_COLOR });
    // FIX: setTimeout is unreliable in MV3 service workers — use chrome.alarms instead
    await chrome.alarms.create('badgeFlashReset', { delayInMinutes: 1 / 40 }); // ~1.5 s
  } catch (_) {}
}

// ── Utilities ────────────────────────────────────────────────
function detectCategory(url) {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    const map = {
      amazon: 'Amazon', youtube: 'YouTube', youtu: 'YouTube',
      github: 'GitHub', twitter: 'Twitter/X', x: 'Twitter/X',
      reddit: 'Reddit', linkedin: 'LinkedIn', instagram: 'Instagram',
      facebook: 'Facebook', wikipedia: 'Wikipedia',
      stackoverflow: 'Stack Overflow', medium: 'Medium', netflix: 'Netflix',
      google: 'Google', twitch: 'Twitch', tiktok: 'TikTok',
      pinterest: 'Pinterest', ebay: 'eBay', etsy: 'Etsy',
      apple: 'Apple', microsoft: 'Microsoft', figma: 'Figma',
      notion: 'Notion', temu: 'Temu', aliexpress: 'AliExpress',
      walmart: 'Walmart', shopify: 'Shopify', shein: 'Shein',
      daraz: 'Daraz', faire: 'Faire', samsclub: "Sam's Club",
      alibaba: 'Alibaba', worldwidegolfballs: 'WW Golf Balls',
      worldwidegolfshops: 'WW Golf Shops', worldgolfshop: 'World Golf Shop',
      golf: 'Golf.com', rockbottomgolf: 'Rock Bottom Golf'
    };
    const parts = host.split('.');
    for (const part of parts) if (map[part]) return map[part];
    return parts[0] ? parts[0].charAt(0).toUpperCase() + parts[0].slice(1) : 'Other';
  } catch (_) { return 'Other'; }
}

function getFavicon(url) {
  try { return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=64`; }
  catch (_) { return ''; }
}

function generateId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isValidURL(str) {
  try { const { protocol } = new URL(str); return protocol === 'http:' || protocol === 'https:'; }
  catch (_) { return false; }
}

// Product-only workflow allowlist. General link saving remains available through
// the normal ADD_LINK path, but queue/context-menu product actions use this list
// so search engines and unrelated sites are never added to the hunt queue.
const PRODUCT_HOST_PATTERNS = [
  'amazon.com', 'amazon.co.uk', 'amazon.ca', 'amazon.de', 'amazon.fr', 'amazon.it',
  'amazon.es', 'amazon.co.jp', 'amazon.in', 'amazon.com.au', 'amazon.com.mx',
  'amazon.nl', 'amazon.pl', 'amazon.se', 'amazon.sg', 'amazon.ae', 'amazon.sa',
  'amazon.tr', 'amazon.eg', 'amazon.be', 'walmart.com', 'samsclub.com',
  'faire.com', 'alibaba.com', 'aliexpress.com', 'aliexpress.ru', 'temu.com',
  'ebay.com', 'ebay.co.uk', 'ebay.de', 'ebay.ca', 'ebay.com.au', 'ebay.fr',
  'ebay.it', 'ebay.es', 'etsy.com', 'daraz.pk', 'daraz.com.bd', 'daraz.lk',
  'daraz.com.np', 'daraz.ph', 'daraz.my', 'flipkart.com', 'noon.com', 'shein.com',
  'target.com', 'costco.com', 'homedepot.com', 'bestbuy.com',
  'worldwidegolfballs.com', 'worldwidegolfshops.com', 'worldgolfshop.com',
  'golf.com', 'rockbottomgolf.com'
];

function isSupportedProductUrl(str) {
  try {
    const u = new URL(str);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const h = u.hostname.toLowerCase().replace(/^www\./, '');
    return PRODUCT_HOST_PATTERNS.some(pattern => h === pattern || h.endsWith('.' + pattern));
  } catch (_) { return false; }
}

function sanitizeBulkQueueItem(item) {
  if (!item || typeof item !== 'object') return null;
  const url = normalizeQueueUrl(item.url);
  if (!url || !isSupportedProductUrl(url)) return null;
  const status = ['queued', 'complete', 'needs_retry', 'error', 'fail', 'partial'].includes(item.status) ? item.status : (item.hunted ? 'complete' : 'queued');
  return {
    id: typeof item.id === 'string' && item.id.length <= 100 ? item.id : `q_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    url,
    title: sanitizeText(item.title || url).slice(0, 500),
    platform: sanitizeText(item.platform || bgDetectPlatform(url)).slice(0, 80),
    addedAt: Number.isFinite(item.addedAt) ? item.addedAt : Date.now(),
    checked: item.checked !== false,
    hunted: item.hunted === true,
    status,
    attempts: Number.isFinite(item.attempts) ? Math.max(0, Math.min(20, Math.floor(item.attempts))) : 0,
    error: sanitizeText(item.error || '').slice(0, 500)
  };
}

function sanitizeText(str) {
  return String(str || '').slice(0, 5000).replace(/<[^>]*>/g, '');
}

function broadcastMessage(payload) {
  chrome.runtime.sendMessage(payload).catch(() => {});
}

function broadcastToast(message, type) {
  chrome.runtime.sendMessage({ action: 'SHOW_TOAST', type, message }).catch(() => {});
}

// ── Image to Base64 ──────────────────────────────────────────
function fallbackImageUrl(imageUrl) {
  try {
    const u = new URL(imageUrl);
    let changed = false;
    ['odnHeight', 'odnWidth', 'odnBg', 'wid', 'hei', 'fmt'].forEach(p => {
      if (u.searchParams.has(p)) { u.searchParams.delete(p); changed = true; }
    });
    return changed ? u.href : null;
  } catch (_) { return null; }
}

async function fetchOnce(url, settings) {
  try {
    // Some CDNs (Amazon, etc.) block requests that don't look like browser image loads.
    // Adding Referer + Accept headers makes the fetch look like a normal <img> request.
    const headers = {
      'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
    };
    // Set Referer to the image's own origin so Amazon CDN allows the request
    try {
      const origin = new URL(url).origin;
      headers['Referer'] = origin + '/';
    } catch (_) {}

    const response = await fetch(url, {
      headers,
      credentials: 'omit',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });
    if (!response.ok) return { success: false, status: response.status };
    const cl = response.headers.get('content-length');
    if (cl && parseInt(cl) > FETCH_MAX_BYTES) return { success: false, reason: 'too_large' };
    let contentType = response.headers.get('content-type') || 'image/jpeg';
    if (!contentType.startsWith('image/')) return { success: false, reason: 'not_image' };
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > FETCH_MAX_BYTES) return { success: false, reason: 'too_large' };

    // Apply image formatting preferences
    const fmt = settings?.imageFormat || 'jpg';
    const ratio = settings?.imageRatio || 'original';
    const bg = settings?.imageBg || 'original';
    const minSize = typeof settings?.imageMinSize === 'number' ? settings.imageMinSize : 0;
    const max5MB = settings?.imageMax5MB !== false;
    
    let targetMime = contentType;
    if (fmt === 'png') targetMime = 'image/png';
    else if (fmt === 'jpg') targetMime = 'image/jpeg';
    
    const needsFormatChange = !contentType.startsWith(targetMime);
    
    const isOver5MB = max5MB && buffer.byteLength > 5 * 1024 * 1024;
    // NOTE: minSize is a DISPLAY FILTER (hide small images in the grid), NOT a resize
    // trigger. It must NOT be included here or it causes canvas re-encoding on every
    // 'original' download whenever the user has any minimum size filter set.
    const needsResizeOrPad = ratio !== 'original' || isOver5MB;

    // CRITICAL: When format is 'original', ALWAYS skip canvas processing entirely.
    // Canvas re-encodes the image (JPEG at 96% quality = quality loss).
    // 'original' must return the raw fetched bytes, byte-for-byte identical to
    // right-clicking and saving the image in the browser.
    if (fmt !== 'original' && (needsFormatChange || needsResizeOrPad)) {
      try {
        const blob = new Blob([buffer], { type: contentType });
        const bitmap = await createImageBitmap(blob);
        
        let targetW = bitmap.width;
        let targetH = bitmap.height;
        
        if (ratio === '1:1') {
          targetW = targetH = Math.max(targetW, targetH);
        } else if (ratio === '3:4') {
          if (targetW / targetH > 3/4) targetH = Math.round(targetW * (4/3));
          else targetW = Math.round(targetH * (3/4));
        } else if (ratio === '4:3') {
          if (targetW / targetH > 4/3) targetH = Math.round(targetW * (3/4));
          else targetW = Math.round(targetH * (4/3));
        }
        
        let scale = 1;
        
        const canvas = new OffscreenCanvas(targetW, targetH);
        const ctx = canvas.getContext('2d');
        
        if (bg === 'white' || targetMime === 'image/jpeg') {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, targetW, targetH);
        }
        
        const drawW = Math.round(bitmap.width * scale);
        const drawH = Math.round(bitmap.height * scale);
        const drawX = Math.round((targetW - drawW) / 2);
        const drawY = Math.round((targetH - drawH) / 2);
        
        ctx.drawImage(bitmap, drawX, drawY, drawW, drawH);
        
        let quality = fmt === 'jpg' ? 0.96 : undefined;
        let convertedBlob = await canvas.convertToBlob({ type: targetMime, quality });
        
        // Enforce max 5MB limit by dropping quality or downscaling slightly
        if (max5MB && convertedBlob.size > 5 * 1024 * 1024 && fmt === 'jpg') {
          quality = 0.8;
          convertedBlob = await canvas.convertToBlob({ type: targetMime, quality });
          if (convertedBlob.size > 5 * 1024 * 1024) {
            quality = 0.6;
            convertedBlob = await canvas.convertToBlob({ type: targetMime, quality });
          }
        }

        const convertedBuffer = await convertedBlob.arrayBuffer();
          const bytes2 = new Uint8Array(convertedBuffer);
          let binary2 = '';
          const chunk2 = 8192;
          for (let i = 0; i < bytes2.length; i += chunk2)
            binary2 += String.fromCharCode(...bytes2.subarray(i, i + chunk2));
          return { success: true, base64: `data:${targetMime};base64,${btoa(binary2)}`, byteLength: convertedBlob.size, width: targetW, height: targetH };
        } catch (_) {
          // Fall through to original if conversion fails
        }
    }

    let origW = 0, origH = 0;
    try {
      const bmp = await createImageBitmap(new Blob([buffer], { type: contentType }));
      origW = bmp.width;
      origH = bmp.height;
    } catch (_) {}

    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunk = 8192;
    for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    return { success: true, base64: `data:${contentType};base64,${btoa(binary)}`, byteLength: buffer.byteLength, width: origW, height: origH };
  } catch (_) { return { success: false }; }
}

async function fetchImageAsBase64(imageUrl, settings) {
  if (!imageUrl || typeof imageUrl !== 'string') return { success: false };
  if (!/^https?:\/\//i.test(imageUrl)) return { success: false };

  const primary = await fetchOnce(imageUrl, settings);
  if (primary.success) return primary;

  const fallback = fallbackImageUrl(imageUrl);
  if (fallback && fallback !== imageUrl) {
    const retry = await fetchOnce(fallback, settings);
    if (retry.success) return retry;
  }
  return primary;
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  const workers = Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      try { out[i] = await fn(items[i], i); } catch (_) { out[i] = null; }
    }
  });
  await Promise.all(workers);
  return out;
}

// ── AI Engine ────────────────────────────────────────────────
async function generateAiDescription(title, apiKey, opts = {}, retryCount = 0) {
  const key = apiKey || (await getData()).settings.aiApiKey;
  if (!key || !key.trim()) return { success: false, error: 'no_api_key' };

  const provider = opts.provider || 'OpenRouter';
  const existingNotes = (opts.existingNotes || '').trim();

  const prompt = `Return ONLY a valid JSON object (no markdown, no extra text):
{
  "description": "800+ character professional ecommerce product description for ${sanitizeText(title)}. Make it compelling, detailed, and persuasive.",
  "weight_lb": "realistic estimated weight in pounds as a number (e.g. 2.5), or null if unknown",
  "length_in": "realistic estimated package length in inches as a number (e.g. 12.5), or null if unknown",
  "width_in": "realistic estimated package width in inches as a number (e.g. 8), or null if unknown",
  "height_in": "realistic estimated package height in inches as a number (e.g. 4), or null if unknown"
}

Product title: ${sanitizeText(title)}`;

  let url, headers, body;
  const model = opts.fallbackModelIndex !== undefined ? AI_MODELS[opts.fallbackModelIndex] :
             provider === 'Groq' ? 'llama-3.3-70b-versatile' 
             : provider === 'Gemini' ? 'gemini-2.0-flash'
             : provider === 'OpenAI' ? 'gpt-4o-mini'
             : AI_MODELS[0];

  if (provider === 'Gemini') {
    url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(key)}`;
    headers = { 'Content-Type': 'application/json' };
    // FIX: Use the correct Gemini v1beta generateContent body format.
    // The old prompt/messages format was deprecated PaLM 1.0 and silently failed.
    body = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 1500 }
    };
  } else if (provider === 'Groq') {
    url = 'https://api.groq.com/openai/v1/chat/completions';
    headers = { 'Authorization': `Bearer ${key.trim()}`, 'Content-Type': 'application/json' };
    body = { model, messages: [{ role: 'user', content: prompt }], temperature: 0.7, max_tokens: 1500 };
  } else if (provider === 'OpenAI') {
    url = 'https://api.openai.com/v1/chat/completions';
    headers = { 'Authorization': `Bearer ${key.trim()}`, 'Content-Type': 'application/json' };
    body = { model, messages: [{ role: 'user', content: prompt }], temperature: 0.7, max_tokens: 1500 };
  } else {
    url = AI_BASE_URL;
    headers = {
      'Authorization': `Bearer ${key.trim()}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://zhunter.extension',
      'X-Title': 'ZHunter PRO'
    };
    body = { model, messages: [{ role: 'user', content: prompt }], temperature: 0.7, max_tokens: 1500 };
  }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), AI_TIMEOUT_MS);

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
    clearTimeout(timer);

    if (!res.ok) {
      if (retryCount < AI_MODELS.length - 1 && (res.status === 429 || res.status >= 500)) {
        opts.provider = 'OpenRouter';
        opts.fallbackModelIndex = retryCount + 1;
        return await generateAiDescription(title, apiKey, opts, retryCount + 1);
      }
      if (retryCount >= AI_MODELS.length - 1) {
        return { success: false, error: 'All AI models failed. Server is busy, please try again.' };
      }
      const errBody = await res.json().catch(() => ({}));
      const errMsg = errBody?.error?.message || `HTTP_${res.status}`;
      if (res.status === 401 || res.status === 403) return { success: false, error: 'invalid_api_key' };
      return { success: false, error: errMsg };
    }

    const data = await res.json();
    let text = '';
    if (provider === 'Gemini') {
      text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } else {
      text = data?.choices?.[0]?.message?.content || '';
    }

    if (!text || text.trim().length < 50) return { success: false, error: 'empty_response' };

    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found');
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        success: true,
        description: parsed.description || '',
        weight_lb: parsed.weight_lb || null,
        length_in: parsed.length_in || null,
        width_in: parsed.width_in || null,
        height_in: parsed.height_in || null,
        model_used: model
      };
    } catch (parseErr) {
      return { success: false, error: 'json_parse_failed', raw: text };
    }
  } catch (err) {
    const errMsg = err.name === 'AbortError' ? 'timeout' : (err.message || 'network_error');
    if (retryCount < AI_MODELS.length - 1) {
      opts.provider = 'OpenRouter';
      opts.fallbackModelIndex = retryCount + 1;
      return await generateAiDescription(title, apiKey, opts, retryCount + 1);
    }
    if (retryCount >= AI_MODELS.length - 1) {
      return { success: false, error: 'All AI models failed. Server is busy, please try again.' };
    }
    return { success: false, error: errMsg };
  }
}


// ── ADD LINK ─────────────────────────────────────────────────
async function addLink({
  url,
  title    = '',
  tags     = [],
  folder   = 'General',
  notes    = '',
  images   = [],
  videoUrl = '',
  price    = '',
  videos   = [],
  imageUrls = [],
  enrichmentStatus = ''
} = {}) {
  if (!url || !isValidURL(url)) return { success: false, reason: 'invalid_url' };

  const data = await getData();
  const normalizedUrl = normalizeQueueUrl(url);
  if (data.settings.duplicateCheck) {
    const dup = data.links.find(l => normalizeQueueUrl(l.url) === normalizedUrl);
    if (dup) return { success: false, reason: 'duplicate', existingId: dup.id };
  }

  if (!data.folders.includes(folder)) folder = 'General';

  const validImages = Array.isArray(images)
    ? images.filter(i => typeof i === 'string' && isValidURL(i)).slice(0, IMG_CAP) : [];
  const validImageUrls = Array.isArray(imageUrls)
    ? imageUrls.filter(i => typeof i === 'string' && /^https?:\/\//i.test(i)).slice(0, IMG_CAP) : [];
  const validVideos = Array.isArray(videos)
    ? videos.filter(v => typeof v === 'string' && v.length > 0).slice(0, VID_CAP) : [];

  const newLink = {
    id:               generateId(),
    url,
    title:            sanitizeText(title) || url,
    category:         data.settings.autoCategory ? detectCategory(url) : 'Other',
    folder,
    tags:             Array.isArray(tags) ? tags.filter(t => String(t).trim()).slice(0, 15) : [],
    favicon:          getFavicon(url),
    images:           validImages,
    imageUrls:        validImageUrls,
    dateAdded:        new Date().toISOString(),
    dateModified:     new Date().toISOString(),
    notes:            sanitizeText(notes),
    price:            sanitizeText(price),
    videoUrl:         typeof videoUrl === 'string' ? videoUrl : '',
    videos:           validVideos,
    visited:          false,
    visitCount:       0,
    enrichmentStatus: enrichmentStatus || (validImages.length === 0 && validImageUrls.length > 0 ? 'pending' : '')
  };

  data.links.unshift(newLink);
  data.history.unshift({
    id:   generateId(),
    type: 'add',
    text: `Saved: ${newLink.title.substring(0, 50)}`,
    date: new Date().toISOString()
  });
  data.history = data.history.slice(0, 200);

  await saveData(data);
  return { success: true, link: newLink };
}

async function addLinkFast(payload) {
  const r = await addLink({
    url:       payload.url,
    title:     payload.title,
    folder:    payload.folder,
    notes:     payload.notes,
    tags:      payload.tags || [],
    price:     payload.price || '',
    videoUrl:  payload.videoUrl || '',
    videos:    payload.videos || [],
    imageUrls: payload.imageUrls || [],
    images:    [],
    enrichmentStatus: 'pending'
  });
  return r;
}

// ── ENRICH LINK ──────────────────────────────────────────────
async function enrichLink({ linkId, runAi = false }) {
  // FIX: Removed duplicate getData() call — read once, reuse both link and settings
  const data0 = await getData();
  let link = data0.links.find(l => l.id === linkId);
  if (!link) return { success: false, reason: 'not_found' };

  const urls = Array.isArray(link.imageUrls) ? link.imageUrls.slice(0, IMG_CAP) : [];
  const settings = data0.settings || {};

  if (urls.length) {
    const results = await mapPool(urls, FETCH_CONCURRENCY, u => fetchImageAsBase64(u, settings));
    
    let validImages = results.filter(r => r && r.success && typeof r.base64 === 'string');
    
    if (validImages.length > 1) {
      // Sort images by file size (largest first) to prioritize quality
      validImages.sort((a, b) => (b.byteLength || 0) - (a.byteLength || 0));
      
      // Filter out tiny thumbnails. Keep if dimensions are >= 400px OR file size >= 15KB.
      const highQualityImages = validImages.filter(img => 
        (img.width >= 400 || img.height >= 400) || (img.byteLength || 0) >= 15 * 1024
      );
      
      if (highQualityImages.length > 0) {
        validImages = highQualityImages;
      } else {
        // If all images are small, keep ONLY the single largest one so the tab succeeds
        // without flooding the folder with useless thumbnails.
        validImages = [validImages[0]];
      }
    }

    const base64s = validImages.map(r => r.base64);

    await saveImagesToIndexedDB(linkId, base64s);

    link = await mutateLink(linkId, l => ({
      ...l,
      enrichmentStatus: runAi ? 'images_done' : 'complete'
    }));
    if (link) broadcastMessage({ action: 'LINK_UPDATED', link });
  } else {
    link = await mutateLink(linkId, l => ({ ...l, enrichmentStatus: runAi ? 'images_done' : 'complete' }));
  }

  if (runAi) {
    try {
      const ai = await generateAiDescription(link?.title || '');
      // FIX: AI response now returns JSON with `description` field, not a text string.
      // The old parseAiText(ai.text) path was completely dead code — ai.text never existed.
      if (ai?.success && ai.description) {
        link = await mutateLink(linkId, l => ({
          ...l,
          notes: l.notes && l.notes.length > 50 ? l.notes : (ai.description || l.notes),
          enrichmentStatus: 'complete'
        }));
        if (link) broadcastMessage({ action: 'LINK_UPDATED', link });
      } else {
        link = await mutateLink(linkId, l => ({ ...l, enrichmentStatus: 'complete' }));
      }
    } catch (_) {
      await mutateLink(linkId, l => ({ ...l, enrichmentStatus: 'complete' }));
    }
  }

  return { success: true };
}

// ── REMOVE / UPDATE / FOLDERS / TAGS ─────────────────────────
async function removeLink(id) {
  const data = await getData();
  const before = data.links.length;
  data.links = data.links.filter(l => l.id !== id);
  if (data.links.length === before) return { success: false, reason: 'not_found' };
  await saveData(data);
  await deleteImagesFromIndexedDB(id);
  return { success: true };
}

function sanitizeLinkUpdates(updates) {
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) return {};
  const clean = {};
  const allowed = new Set([
    'url', 'title', 'category', 'folder', 'tags', 'notes', 'images', 'imageUrls',
    'price', 'videoUrl', 'videos', 'visited', 'visitCount', 'enrichmentStatus'
  ]);
  for (const [key, value] of Object.entries(updates)) {
    if (!allowed.has(key)) continue;
    if (['title', 'category', 'notes', 'price', 'enrichmentStatus'].includes(key)) {
      if (typeof value === 'string') clean[key] = sanitizeText(value);
      continue;
    }
    if (key === 'url') {
      if (typeof value === 'string' && isValidURL(value)) clean[key] = value;
      continue;
    }
    if (key === 'folder' || key === 'videoUrl') {
      if (typeof value === 'string' && value.length <= 2000) clean[key] = key === 'videoUrl' && value && !isValidURL(value) ? '' : value;
      continue;
    }
    if (key === 'tags') {
      if (Array.isArray(value)) clean[key] = value.map(v => sanitizeText(v)).filter(Boolean).slice(0, 15);
      continue;
    }
    if (key === 'images' || key === 'imageUrls' || key === 'videos') {
      if (Array.isArray(value)) clean[key] = value.filter(v => typeof v === 'string' && isValidURL(v)).slice(0, key === 'videos' ? VID_CAP : IMG_CAP);
      continue;
    }
    if (key === 'visited') {
      if (typeof value === 'boolean') clean[key] = value;
      continue;
    }
    if (key === 'visitCount') {
      if (Number.isFinite(value)) clean[key] = Math.max(0, Math.min(1000000, Math.floor(value)));
    }
  }
  return clean;
}

async function updateLink(id, updates) {
  const data = await getData();
  updates = sanitizeLinkUpdates(updates);
  const idx = data.links.findIndex(l => l.id === id);
  if (idx === -1) return { success: false, reason: 'not_found' };

  if (updates.folder && !data.folders.includes(updates.folder)) updates.folder = data.links[idx].folder;

  data.links[idx] = { ...data.links[idx], ...updates, dateModified: new Date().toISOString() };
  await saveData(data);
  return { success: true, link: data.links[idx] };
}

async function addFolder(name) {
  const n = String(name || '').trim().slice(0, 40);
  if (!n) return { success: false, reason: 'empty' };
  const data = await getData();
  if (data.folders.includes(n)) return { success: false, reason: 'duplicate' };
  data.folders.push(n);
  await saveData(data);
  return { success: true, folder: n };
}

async function renameFolder(oldName, newName) {
  const n = String(newName || '').trim().slice(0, 40);
  if (!n) return { success: false, reason: 'empty' };
  if (oldName === 'General') return { success: false, reason: 'protected' };
  const data = await getData();
  if (data.folders.includes(n)) return { success: false, reason: 'duplicate' };
  data.folders = data.folders.map(f => f === oldName ? n : f);
  data.links = data.links.map(l => l.folder === oldName
    ? { ...l, folder: n, dateModified: new Date().toISOString() } : l);
  await saveData(data);
  return { success: true };
}

async function removeFolder(folderName) {
  if (folderName === 'General') return { success: false, reason: 'protected' };
  const data = await getData();
  data.folders = data.folders.filter(f => f !== folderName);
  data.links = data.links.map(l => l.folder === folderName
    ? { ...l, folder: 'General', dateModified: new Date().toISOString() } : l);
  await saveData(data);
  return { success: true };
}

async function addTag(name) {
  const t = String(name || '').trim().slice(0, 30);
  if (!t) return { success: false, reason: 'empty' };
  const data = await getData();
  if (data.tags.includes(t)) return { success: false, reason: 'duplicate' };
  data.tags.push(t);
  await saveData(data);
  return { success: true, tag: t };
}

async function removeTag(tagName) {
  const data = await getData();
  data.tags = data.tags.filter(t => t !== tagName);
  data.links = data.links.map(l => ({
    ...l,
    tags: (l.tags || []).filter(t => t !== tagName),
    dateModified: new Date().toISOString()
  }));
  await saveData(data);
  return { success: true };
}

// FIX: Batch all tab saves into a single getData() + saveData() round-trip
// instead of N sequential read/mutate/write cycles.
async function saveAllTabs(folder = 'General', tags = []) {
  const tabs  = await chrome.tabs.query({});
  const data  = await getData();
  if (!data.folders.includes(folder)) folder = 'General';

  const results  = [];
  const nowIso   = new Date().toISOString();
  let   anyAdded = false;

  for (const tab of tabs) {
    if (!tab.url || !isValidURL(tab.url) || tab.url.startsWith('chrome://')) continue;
    if (data.settings.duplicateCheck && data.links.some(l => normalizeQueueUrl(l.url) === normalizeQueueUrl(tab.url))) {
      results.push({ url: tab.url, success: false, reason: 'duplicate' });
      continue;
    }
    const newLink = {
      id:               generateId(),
      url:              tab.url,
      title:            sanitizeText(tab.title || tab.url) || tab.url,
      category:         data.settings.autoCategory ? detectCategory(tab.url) : 'Other',
      folder,
      tags:             Array.isArray(tags) ? tags.filter(t => String(t).trim()).slice(0, 15) : [],
      favicon:          getFavicon(tab.url),
      images:           [], imageUrls: [],
      dateAdded:        nowIso, dateModified: nowIso,
      notes:            '', price: '', videoUrl: '', videos: [],
      visited:          false, visitCount: 0, enrichmentStatus: ''
    };
    data.links.unshift(newLink);
    results.push({ url: tab.url, success: true, link: newLink });
    anyAdded = true;
  }

  if (anyAdded) {
    data.history.unshift({
      id: generateId(), type: 'save_tabs',
      text: `Saved ${results.filter(r => r.success).length} tabs`,
      date: nowIso
    });
    data.history = data.history.slice(0, 200);
    await saveData(data);
  }
  return { success: true, results };
}

// ── Context menus ────────────────────────────────────────────
function setupContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'zh-save-page',      title: '📄 Add Product Page to Queue — ZHunter',     contexts: ['page'] });
    chrome.contextMenus.create({ id: 'zh-save-link',      title: '🔗 Add Product Link to Queue — ZHunter',     contexts: ['link'] });
    chrome.contextMenus.create({ id: 'zh-save-selection', title: '📎 Add Selected Product URL — ZHunter',     contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'zh-hunt-product',   title: '🛍️ Add Product to Queue — ZHunter',          contexts: ['page', 'link'] });
    // NEW: Reverse Image Search
    chrome.contextMenus.create({ id: 'zh-reverse-image',  title: '🔍 Find Supplier (AliExpress/Temu)',  contexts: ['image'] });
  });
}

// ── Hunt from image right-click: open preview in popup ───────
// We store the pending hunt info in storage so the popup can pick it up.
async function storePendingImageHunt(tabId, tabUrl, tabTitle, imageUrl) {
  try {
    await chrome.storage.local.set({
      zhunterPendingImageHunt: {
        tabId,
        tabUrl,
        tabTitle,
        imageUrl,
        ts: Date.now()
      }
    });
  } catch (_) {}
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const data = await getData();
  const imageFormat = data.settings.imageFormat || 'jpg';

  let url = '', title = '', images = [], imageUrls = [];

  switch (info.menuItemId) {
    case 'zh-save-page':
      url = tab?.url || '';
      title = tab?.title || url;
      break;

    case 'zh-save-link':
      url = info.linkUrl || '';
      title = info.linkText || url;
      break;

    case 'zh-save-selection':
      url = (info.selectionText || '').trim();
      if (!isValidURL(url)) { broadcastToast('Selected text is not a valid URL', 'err'); return; }
      title = url;
      break;

    case 'zh-hunt-product':
      url   = info.linkUrl || tab?.url || '';
      title = tab?.title || url;
      break;

    case 'zh-reverse-image': {
      const srcUrl = info.srcUrl;
      if (srcUrl) {
        const searchUrl = 'https://lens.google.com/uploadbyurl?url=' + encodeURIComponent(srcUrl);
        chrome.tabs.create({ url: searchUrl });
      } else {
        broadcastToast('Could not find image URL', 'err');
      }
      return;
    }

    default: return;
  }

  if (!url) return;
  if (!isSupportedProductUrl(url)) {
    broadcastToast('Only supported shopping-product links can be added to the queue.', 'warn');
    return;
  }
  const result = await withWriteLock(() => addProductQueueItems([{
    url,
    title,
    source: 'context_menu'
  }]));
  if (result.success && result.addedCount) {
    await flashBadgeSuccess();
    broadcastToast('Product added to queue. Open the Product Queue tab to process it.', 'ok');
  } else if (result.success && !result.addedCount) {
    broadcastToast('Product is already in the queue.', 'warn');
  }
});

// ── MESSAGE ROUTER ───────────────────────────────────────────
// Rate limiting alone is not enough: explicitly distinguish extension-page
// requests from the small set of actions allowed to page content scripts.
const CONTENT_SCRIPT_ACTIONS = new Set([
  'ADD_PRODUCT_QUEUE', 'DOWNLOAD_PAGE_IMAGES', 'FETCH_BASE64',
  'FETCH_BASE64_BATCH', 'GET_PENDING_IMAGE_HUNT', 'CHECK_BULK_QUEUE',
  'ADD_TO_BULK_QUEUE'
]);

function isAuthorizedMessage(msg, sender) {
  if (!msg || typeof msg.action !== 'string' || msg.action.length > 80) return false;
  if (sender?.id && sender.id !== chrome.runtime.id) return false;
  if (sender?.tab) {
    const tabUrl = String(sender.tab.url || '');
    return /^https?:\/\//i.test(tabUrl) && CONTENT_SCRIPT_ACTIONS.has(msg.action);
  }
  // Messages from sidepanel, popup, options, or the service worker itself.
  return !sender?.url || sender.url.startsWith(`chrome-extension://${chrome.runtime.id}/`);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!isAuthorizedMessage(msg, sender)) {
    sendResponse({ success: false, error: 'unauthorized_message' });
    return true;
  }
  if (isRateLimited(sender)) {
    sendResponse({ success: false, error: 'rate_limited' });
    return true;
  }
  handleMessage(msg, sender).then(sendResponse).catch(err => sendResponse({ success: false, error: err.message }));
  return true;
});

async function handleMessage(msg, sender) {
  switch (msg.action) {
    // ── Read-only / non-storage actions (no lock needed) ─────
    case 'GET_DATA': {
      const data = await getData();
      return { ...data, settings: getPublicSettings(data.settings) };
    }
    case 'GET_LINK_IMAGES':    return { success: true, images: await getImagesFromIndexedDB(msg.id) };
    case 'START_KEEPALIVE':    startKeepAlive(); return { success: true };
    case 'STOP_KEEPALIVE':     stopKeepAlive();  return { success: true };
    case 'FETCH_BASE64': {
      // Allow the caller to pass explicit settings (e.g. imageFormat:'original'
      // from the Images tab) to bypass canvas conversion and preserve quality.
      const storedSettings = (await getData())?.settings || {};
      const effectiveSettings = msg.settings
        ? { ...storedSettings, ...msg.settings }
        : storedSettings;
      return await fetchImageAsBase64(msg.url, effectiveSettings);
    }
    // PERF: Batch image download — reads settings once, downloads all images
    // in parallel using mapPool. Eliminates N separate message round-trips
    // during bulk hunt (was the #1 bottleneck).
    case 'FETCH_BASE64_BATCH': {
      const settings = (await getData())?.settings || {};
      const urls = Array.isArray(msg.urls) ? msg.urls.slice(0, 15) : [];
      const results = await mapPool(urls, FETCH_CONCURRENCY, u => fetchImageAsBase64(u, settings));
      return { success: true, results: results || [] };
    }
    case 'DOWNLOAD_PAGE_IMAGES': {
      const settings = (await getData())?.settings || {};
      const urls = Array.isArray(msg.urls) ? [...new Set(msg.urls.filter(isValidURL))].slice(0, 7) : [];
      const rawName = sanitizeText(msg.title || 'product-images').replace(/[<>:"/\\|?*]+/g, '_').trim().slice(0, 70) || 'product-images';
      const downloadOne = (url, filename) => new Promise(resolve => {
        try {
          chrome.downloads.download({ url, filename, saveAs: false, conflictAction: 'uniquify' }, downloadId => {
            const error = chrome.runtime.lastError?.message || '';
            resolve(error || !downloadId ? { success: false, error: error || 'download_not_started' } : { success: true, downloadId });
          });
        } catch (err) { resolve({ success: false, error: err?.message || 'download_error' }); }
      });
      const downloadResults = await Promise.all(urls.map(async (url, index) => {
        const match = url.match(/\.(png|webp|gif|jpeg|jpg)(?:[?#]|$)/i);
        const directExt = (match?.[1] || 'jpg').toLowerCase().replace('jpeg', 'jpg');
        const directName = `ZHunter/${rawName}/${String(index + 1).padStart(2, '0')}.${directExt}`;
        const direct = await downloadOne(url, directName);
        if (direct.success) return { ...direct, url };

        // Some marketplace CDNs reject a direct downloads request. In that case,
        // fetch once through the existing extension worker and retry with a data URL.
        const fetched = await fetchImageAsBase64(url, settings);
        if (!fetched?.success || typeof fetched.base64 !== 'string') return { success: false, url, error: direct.error || 'image_fetch_failed' };
        const fallbackExt = fetched.base64.startsWith('data:image/png') ? 'png' : fetched.base64.startsWith('data:image/webp') ? 'webp' : 'jpg';
        const fallback = await downloadOne(fetched.base64, `ZHunter/${rawName}/${String(index + 1).padStart(2, '0')}.${fallbackExt}`);
        return { ...fallback, url };
      }));
      const started = downloadResults.filter(result => result?.success).length;
      const failed = downloadResults.filter(result => !result?.success).length;
      return { success: started > 0, requested: urls.length, started, failed, errors: downloadResults.filter(result => !result?.success).map(result => result.error).slice(0, 7), failedUrls: downloadResults.filter(result => !result?.success).map(result => result.url).filter(Boolean).slice(0, 7) };
    }
    // FIX: Security — never accept apiKey from the message payload.
    // Content scripts or malicious pages could send forged GENERATE_AI messages
    // to exfiltrate an API key that was previously passed through sendMessage.
    // Background always reads the key directly from secure storage.
    case 'GENERATE_AI': {
      const _aiData = await getData();
      const _provider = msg.provider || 'OpenRouter';
      const _providerKeys = {
        OpenRouter: _aiData.settings.openRouterApiKey || _aiData.settings.aiApiKey,
        Groq: _aiData.settings.groqApiKey,
        Gemini: _aiData.settings.geminiApiKey,
        OpenAI: _aiData.settings.openAiApiKey
      };
      return await generateAiDescription(msg.title, _providerKeys[_provider] || _aiData.settings.aiApiKey, {
        existingNotes: msg.existingNotes || '',
        provider: _provider
      });
    }

    case 'GET_PENDING_IMAGE_HUNT': {
      const res = await chrome.storage.local.get('zhunterPendingImageHunt');
      const pending = res.zhunterPendingImageHunt || null;
      // Only return if recent (within 30s)
      if (pending && (Date.now() - pending.ts) < 30000) {
        await chrome.storage.local.remove('zhunterPendingImageHunt');
        return { success: true, pending };
      }
      return { success: true, pending: null };
    }
    case 'GET_SETTINGS': {
      const d = await getData();
      return { success: true, settings: getPublicSettings(d.settings) };
    }
    case 'GET_PRODUCT_QUEUE':
      return { success: true, queue: await getProductQueue() };
    case 'GET_PRODUCT_SHEET_ROWS': {
      const sheetData = await getData();
      return {
        success: true,
        rows: await getProductSheetRows(),
        settings: {
          productSheetColumns: sheetData.settings?.productSheetColumns || DEFAULT_DATA.settings.productSheetColumns,
          customProductColumns: Array.isArray(sheetData.settings?.customProductColumns) ? sheetData.settings.customProductColumns : []
        }
      };
    }
    case 'GET_PRODUCT_RESEARCH_WORKBOOK':
      return { success: true, workbook: await getProductResearchWorkbook() };
    case 'ADD_PRODUCT_QUEUE':
      return await withWriteLock(() => addProductQueueItems(msg.items || []));
    case 'PROCESS_PRODUCT_QUEUE': {
      if (!_queueProcessPromise) {
        startKeepAlive();
        processProductQueue()
          .then(result => broadcastMessage({ action: 'PRODUCT_QUEUE_DONE', ...result }))
          .catch(err => broadcastMessage({ action: 'PRODUCT_QUEUE_DONE', success: false, error: err?.message || 'queue_failed' }))
          .finally(() => stopKeepAlive());
      }
      return { success: true, started: true };
    }
    case 'RETRY_PRODUCT_QUEUE':
      return await withWriteLock(async () => {
        const queue = await getProductQueue();
        let reset = 0;
        queue.forEach(item => {
          if (item.status === 'needs_retry' || item.status === 'error') {
            item.status = 'queued';
            item.attempts = 0;
            item.error = '';
            item.updatedAt = new Date().toISOString();
            reset++;
          }
        });
        await saveProductQueue(queue);
        if (reset) broadcastMessage({ action: 'PRODUCT_QUEUE_UPDATED', added: 0, reset });
        return { success: true, reset, total: queue.length };
      });
    case 'CLEAR_PRODUCT_QUEUE':
      return await withWriteLock(async () => {
        await saveProductQueue([]);
        broadcastMessage({ action: 'PRODUCT_QUEUE_UPDATED', added: 0 });
        return { success: true };
      });
    case 'COPY_ALL_TABS': {
      const tabs = await chrome.tabs.query({});
      const urls = tabs.filter(t => t.url && isValidURL(t.url)).map(t => t.url);
      return { success: true, urls };
    }

    // ── Storage-mutating actions (serialised via withWriteLock) ──
    // Prevents read-modify-write race conditions when multiple messages
    // arrive concurrently (e.g. 5 parallel bulk enrichments).
    case 'ADD_LINK':           return await withWriteLock(() => addLink({
                                  url:       msg.url,
                                  title:     msg.title,
                                  tags:      msg.tags,
                                  folder:    msg.folder,
                                  notes:     msg.notes,
                                  images:    msg.images || [],
                                  videoUrl:  msg.videoUrl || '',
                                  price:     msg.price || '',
                                  videos:    msg.videos || [],
                                  imageUrls: msg.imageUrls || []
                                }));
    case 'ADD_LINK_FAST':      return await withWriteLock(() => addLinkFast(msg));
    case 'ENRICH_LINK':        return await withWriteLock(() => enrichLink({ linkId: msg.linkId, runAi: !!msg.runAi }));
    case 'REMOVE_LINK':        return await withWriteLock(() => removeLink(msg.id));
    case 'UPDATE_LINK':        return await withWriteLock(() => updateLink(msg.id, msg.updates));
    case 'ADD_FOLDER':         return await withWriteLock(() => addFolder(msg.folder));
    case 'RENAME_FOLDER':      return await withWriteLock(() => renameFolder(msg.oldName, msg.newName));
    case 'REMOVE_FOLDER':      return await withWriteLock(() => removeFolder(msg.folder));
    case 'ADD_TAG':            return await withWriteLock(() => addTag(msg.tag));
    case 'REMOVE_TAG':         return await withWriteLock(() => removeTag(msg.tag));
    case 'SAVE_ALL_TABS':      return await withWriteLock(() => saveAllTabs(msg.folder, msg.tags));
    case 'CLEAR_ALL':          return await withWriteLock(async () => {
      const data = await getData();
      data.links = [];
      data.history.unshift({ id: generateId(), type: 'clear', text: 'Cleared all saved products', date: new Date().toISOString() });
      data.history = data.history.slice(0, 200);
      await saveData(data);
      await clearIndexedDBImages();
      return { success: true };
    });
    case 'UPDATE_SETTINGS':    return await withWriteLock(async () => {
      const data = await getData();
      const patch = sanitizeSettingsPatch(msg.settings);
      data.settings = { ...data.settings, ...patch };
      await saveData(data);
      return { success: true, settings: getPublicSettings(data.settings) };
    });
    case 'LOG_ACTION':         return await withWriteLock(async () => {
      const data = await getData();
      data.history.unshift({ id: generateId(), type: msg.type || 'info', text: sanitizeText(msg.text), date: new Date().toISOString() });
      data.history = data.history.slice(0, 200);
      await saveData(data);
      return { success: true };
    });
    case 'CLEAR_HISTORY':      return await withWriteLock(async () => {
      const data = await getData();
      data.history = [];
      await saveData(data);
      return { success: true };
    });
    case 'ADD_IMAGE_TO_LINK':  return await withWriteLock(async () => {
      const data = await getData();
      const idx = data.links.findIndex(l => l.id === msg.id);
      if (idx === -1) return { success: false, reason: 'not_found' };
      const link = data.links[idx];
      const images = Array.isArray(link.images) ? [...link.images] : [];
      const imageUrls = Array.isArray(link.imageUrls) ? [...link.imageUrls] : [];
      if (images.length >= IMG_CAP) return { success: false, reason: 'max_images' };
      if (typeof msg.image === 'string' && isValidURL(msg.image)) {
        images.push(msg.image);
        imageUrls.push(msg.image);
        data.links[idx] = { ...link, images, imageUrls, dateModified: new Date().toISOString() };
        await saveData(data);
        return { success: true, images };
      }
      return { success: false, reason: 'invalid_image' };
    });
    case 'REMOVE_IMAGE_FROM_LINK': return await withWriteLock(async () => {
      const data = await getData();
      const idx = data.links.findIndex(l => l.id === msg.id);
      if (idx === -1) return { success: false, reason: 'not_found' };
      const link = data.links[idx];
      const images = Array.isArray(link.images) ? [...link.images] : [];
      const imageUrls = Array.isArray(link.imageUrls) ? [...link.imageUrls] : [];
      // FIX: Validate the index — an unvalidated splice(negativeIndex, 1) silently
      // deletes from the end of the array, removing the wrong image.
      const rmIdx = parseInt(msg.imageIndex);
      if (isNaN(rmIdx) || rmIdx < 0 || rmIdx >= images.length) return { success: false, reason: 'invalid_index' };
      images.splice(rmIdx, 1);
      imageUrls.splice(rmIdx, 1);
      data.links[idx] = { ...link, images, imageUrls, dateModified: new Date().toISOString() };
      await saveData(data);
      return { success: true, images };
    });

    // ── ☁️ Cloud Sync Actions ────────────────────────────────
    case 'CLOUD_SYNC_STATUS': {
      return { enabled: false, available: false, ready: false, type: 'disabled', label: 'Cloud sync unavailable until secure sign-in is enabled' };
    }
    case 'LOAD_FROM_CLOUD': {
      if (!CLOUD_SYNC_AVAILABLE) return { success: false, error: 'cloud_sync_disabled_until_authentication' };
      // Fetch latest data from Firestore and merge into local storage
      const cloudResult = await _loadFromCloud();
      if (!cloudResult.success) return cloudResult;
      return await withWriteLock(async () => {
        const local = await getData();
        const cloud = cloudResult.data;
        // Merge: cloud links take priority, keep local images (IndexedDB)
        const mergedLinks = (cloud.links || []).map(cl => {
          const localLink = local.links.find(ll => ll.id === cl.id);
          return localLink ? { ...cl, images: localLink.images } : cl;
        });
        const merged = {
          ...local,
          links:    mergedLinks,
          folders:  cloud.folders  || local.folders,
          tags:     cloud.tags     || local.tags,
          history:  cloud.history  || local.history,
          settings: { ...local.settings, ...(cloud.settings || {}) }
        };
        await chrome.storage.local.set({ [STORAGE_KEY]: merged });
        await updateBadge(merged.links.length, merged.settings.badgeEnabled);
        broadcastMessage({ action: 'DATA_LOADED_FROM_CLOUD', count: mergedLinks.length });
        return { success: true, count: mergedLinks.length, lastSynced: cloud.lastSynced };
      });
    }
    case 'CLOUD_LOGOUT': {
      // Clear cached user ID so next call re-fetches
      _cloudUserId = null;
      _cloudReady  = false;
      return { success: true };
    }
    case 'FORCE_CLOUD_SYNC': {
      if (!CLOUD_SYNC_AVAILABLE) return { success: false, error: 'cloud_sync_disabled_until_authentication' };
      // Immediately push local data to cloud (used by sync button)
      const data = await getData();
      const ok   = await _syncToCloud(data);
      return { success: ok };
    }

    // ── Bulk Queue CRUD ─────────────────────────────────────────
    case 'GET_BULK_QUEUE': {
      const res = await chrome.storage.local.get(BULK_QUEUE_KEY);
      const rawQueue = Array.isArray(res[BULK_QUEUE_KEY]) ? res[BULK_QUEUE_KEY] : [];
      const queue = [];
      const seen = new Set();
      rawQueue.slice(0, 2000).forEach(rawItem => {
        const item = sanitizeBulkQueueItem(rawItem);
        if (item && !seen.has(item.url)) { seen.add(item.url); queue.push(item); }
      });
      return { success: true, queue };
    }
    case 'CHECK_BULK_QUEUE': {
      const normUrl = normalizeQueueUrl(msg.url || sender?.tab?.url || '');
      const res = await chrome.storage.local.get(BULK_QUEUE_KEY);
      const queue = Array.isArray(res[BULK_QUEUE_KEY]) ? res[BULK_QUEUE_KEY] : [];
      return { success: true, queued: !!normUrl && queue.some(item => normalizeQueueUrl(item?.url) === normUrl) };
    }
    case 'ADD_TO_BULK_QUEUE': {
      const normUrl = normalizeQueueUrl(msg.url || sender?.tab?.url || '');
      if (!normUrl) return { success: false, reason: 'invalid_url' };
      if (!isSupportedProductUrl(normUrl)) return { success: false, reason: 'unsupported_url' };
      if (sender?.tab?.url && normalizeQueueUrl(sender.tab.url) !== normUrl) return { success: false, reason: 'tab_url_mismatch' };
      const res2 = await chrome.storage.local.get(BULK_QUEUE_KEY);
      const q = Array.isArray(res2[BULK_QUEUE_KEY]) ? res2[BULK_QUEUE_KEY] : [];
      if (q.some(i => normalizeQueueUrl(i?.url) === normUrl)) return { success: false, reason: 'duplicate' };
      const newItem = {
        id: `q_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
        url: normUrl,
        title: sanitizeText(msg.title || normUrl),
        platform: bgDetectPlatform(normUrl),
        addedAt: Date.now(),
        checked: true,
        status: 'queued',
        attempts: 0,
        error: ''
      };
      q.push(newItem);
      await chrome.storage.local.set({ [BULK_QUEUE_KEY]: q.slice(0, 2000) });
      broadcastMessage({ action: 'BULK_QUEUE_UPDATED', item: newItem });
      return { success: true, item: newItem };
    }
    case 'REMOVE_FROM_BULK_QUEUE': {
      const res3 = await chrome.storage.local.get(BULK_QUEUE_KEY);
      const q3 = (res3[BULK_QUEUE_KEY] || []).filter(i => i.id !== msg.id);
      await chrome.storage.local.set({ [BULK_QUEUE_KEY]: q3 });
      return { success: true };
    }
    case 'UPDATE_BULK_QUEUE': {
      // Full replace — popup sends updated array (check/uncheck, reorder).
      if (!Array.isArray(msg.queue)) return { success: false, reason: 'invalid_queue' };
      const cleanQueue = [];
      const seen = new Set();
      for (const rawItem of msg.queue.slice(0, 2000)) {
        const item = sanitizeBulkQueueItem(rawItem);
        if (!item || seen.has(item.url)) continue;
        seen.add(item.url);
        cleanQueue.push(item);
      }
      await chrome.storage.local.set({ [BULK_QUEUE_KEY]: cleanQueue });
      return { success: true, count: cleanQueue.length };
    }
    case 'CLEAR_BULK_QUEUE': {
      await chrome.storage.local.set({ [BULK_QUEUE_KEY]: [] });
      return { success: true };
    }

    default: return { success: false, reason: 'unknown_action' };
  }
}

// ── Lifecycle ────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get(STORAGE_KEY);
  if (!existing[STORAGE_KEY]) {
    await chrome.storage.local.set({ [STORAGE_KEY]: JSON.parse(JSON.stringify(DEFAULT_DATA)) });
  } else {
    const data = await getData();
    let migrated = false;
    data.links = data.links.map(link => {
      let changed = false;
      const u = { ...link };
      if (Array.isArray(u.images)) {
        const filteredImages = u.images.filter(i => typeof i === 'string' && isValidURL(i));
        if (filteredImages.length !== u.images.length) { u.images = filteredImages; changed = true; }
      } else {
        u.images = [];
        changed = true;
      }
      if (u.base64Image) {
        delete u.base64Image;
        changed = true;
      }
      if (!Array.isArray(u.imageUrls))  { u.imageUrls = []; changed = true; }
      if (typeof u.price    === 'undefined') { u.price = ''; changed = true; }
      if (typeof u.videoUrl === 'undefined') { u.videoUrl = ''; changed = true; }
      if (!Array.isArray(u.videos))     { u.videos = []; changed = true; }
      if (typeof u.enrichmentStatus === 'undefined') { u.enrichmentStatus = ''; changed = true; }
      if (changed) migrated = true;
      return u;
    });
    if (!data.settings.bulkSheetColumns) {
      data.settings.bulkSheetColumns = JSON.parse(JSON.stringify(DEFAULT_DATA.settings.bulkSheetColumns));
      migrated = true;
    }
    if (!data.settings.productSheetColumns) {
      data.settings.productSheetColumns = JSON.parse(JSON.stringify(DEFAULT_DATA.settings.productSheetColumns));
      migrated = true;
    }
    if (!Array.isArray(data.settings.customProductColumns)) {
      data.settings.customProductColumns = [];
      migrated = true;
    }
    if (typeof data.settings.autoSkipDuplicates === 'undefined') {
      data.settings.autoSkipDuplicates = true;
      migrated = true;
    }
    // Migrate imageFormat setting
    if (typeof data.settings.imageFormat === 'undefined') {
      data.settings.imageFormat = 'jpg';
      migrated = true;
    }
    if (migrated) await saveData(data);
  }

  const migFlag = await chrome.storage.local.get('zhunter_v76_migrated');
  if (!migFlag.zhunter_v76_migrated) {
    await chrome.storage.local.remove(['zhunterMasterSheet', 'zhunterMasterBatches']);
    await chrome.storage.local.set({ zhunter_v76_migrated: true });
  }

  setupContextMenus();
  await updateBadge();
});

chrome.runtime.onStartup.addListener(() => {
  updateBadge();
  setupContextMenus();
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'save-current-tab') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url && isValidURL(tab.url)) {
      await withWriteLock(() => addLink({ url: tab.url, title: tab.title || tab.url }));
    }
  }
});

chrome.alarms.create('badgeSync', { periodInMinutes: 5 });
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'badgeSync')       await updateBadge();
  // FIX: Handle the badge flash reset alarm set by flashBadgeSuccess()
  if (alarm.name === 'badgeFlashReset') await updateBadge();
  // ☁️ Debounced cloud sync alarm fires ~3s after last save
  if (alarm.name === 'cloudSyncDebounce') {
    _syncPending = false;
    try {
      const raw = await chrome.storage.session.get('_pendingSync');
      if (raw._pendingSync) {
        const pendingData = JSON.parse(raw._pendingSync);
        await _syncToCloud(pendingData);
        await chrome.storage.session.remove('_pendingSync');
      }
    } catch (e) {
      console.warn('[ZHunter] Debounced sync alarm error:', e);
    }
  }
});

// FIX: Removed the redundant action.onClicked listener.
// When openPanelOnActionClick: true, Chrome does NOT fire action.onClicked,
// so the listener below was dead code that would cause a double-open bug
// if Chrome's behaviour ever changes.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// ── Auto-Capture: add product pages to Bulk Queue as user browses ─────────
// Fires when a tab finishes loading. If the URL matches a known sourcing
// platform, the URL is appended to the persistent Bulk Queue (deduped).
// A message is broadcast so open popup/sidepanel panels refresh their list.
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  const url = tab.url || '';
  if (!url.startsWith('http')) return;
  if (!bgDetectPlatform(url)) return;

  // Check auto-capture enabled setting (default: true)
  const stored = await chrome.storage.local.get(['zakLinkCollectorData', BULK_QUEUE_KEY]);
  const settings = stored['zakLinkCollectorData']?.settings || {};
  if (settings.bulkQueueAutoCapture === false) return;

  const queue = stored[BULK_QUEUE_KEY] || [];
  const normUrl = url.split('#')[0].trim();
  if (queue.some(i => i.url === normUrl)) return; // already queued

  const newItem = {
    id:        `q_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    url:       normUrl,
    title:     tab.title || normUrl,
    platform:  bgDetectPlatform(normUrl),
    addedAt:   Date.now(),
    checked:   true
  };
  queue.push(newItem);
  // Keep queue from growing unbounded
  const trimmed = queue.slice(-500);
  await chrome.storage.local.set({ [BULK_QUEUE_KEY]: trimmed });

  // Notify open popup / sidepanel to refresh their queue list
  chrome.runtime.sendMessage({ action: 'BULK_QUEUE_UPDATED', item: newItem }).catch(() => {});
});
