// ============================================================
// ZHunter PRO v9.0.0 — Queue Engine
// Lightweight queue state machine extracted from sidepanel.js.
// Manages per-item state transitions, attempt tracking, and
// pause/resume. Does NOT do any scraping itself — that remains
// in background.js / sidepanel.js.
//
// Job states:
//   queued → loading → scraping → media → complete
//                    ↘ needs_retry → (retry) → scraping
//                    ↘ blocked
//                    ↘ cancelled
// ============================================================
'use strict';

(function () {

  const VALID_STATUSES = new Set([
    'queued', 'loading', 'scraping', 'media',
    'complete', 'needs_retry', 'blocked', 'cancelled'
  ]);

  // ── QueueEngine class ────────────────────────────────────────

  class QueueEngine {
    constructor() {
      this._items   = [];   // { id, url, title, status, attempts, lastError, lastStage, addedAt, updatedAt, source }
      this._paused  = false;
      this._listeners = [];
    }

    // ── Bulk load from persisted data ────────────────────────
    load(items) {
      this._items = (items || []).map(raw => this._normalize(raw));
      this._emit('load');
      return this;
    }

    // ── Add items ─────────────────────────────────────────────
    add(urlOrItems) {
      const list = Array.isArray(urlOrItems) ? urlOrItems : [urlOrItems];
      let added = 0;
      for (const entry of list) {
        const url = typeof entry === 'string' ? entry : entry.url;
        if (!url || this._items.some(i => i.url === url)) continue;
        this._items.push(this._normalize({ url, title: entry.title || '', source: entry.source || 'manual' }));
        added++;
      }
      if (added) this._emit('change');
      return added;
    }

    // ── Remove by id ─────────────────────────────────────────
    remove(id) {
      const before = this._items.length;
      this._items = this._items.filter(i => i.id !== id);
      if (this._items.length !== before) this._emit('change');
    }

    // ── Transition status ────────────────────────────────────
    transition(id, status, extra) {
      if (!VALID_STATUSES.has(status)) {
        console.warn('[QueueEngine] invalid status:', status);
        return false;
      }
      const item = this._items.find(i => i.id === id);
      if (!item) return false;

      item.status    = status;
      item.updatedAt = Date.now();
      if (extra) {
        if (extra.lastError) item.lastError = extra.lastError;
        if (extra.lastStage) item.lastStage = extra.lastStage;
        if (status === 'loading' || status === 'scraping') item.attempts = (item.attempts || 0) + 1;
      }
      this._emit('change', item);
      return true;
    }

    // ── Retry failed items ───────────────────────────────────
    retryAll() {
      let count = 0;
      for (const item of this._items) {
        if (item.status === 'needs_retry' || item.status === 'blocked') {
          item.status    = 'queued';
          item.updatedAt = Date.now();
          item.lastError = '';
          count++;
        }
      }
      if (count) this._emit('change');
      return count;
    }

    retryOne(id) {
      const item = this._items.find(i => i.id === id);
      if (!item || (item.status !== 'needs_retry' && item.status !== 'blocked')) return false;
      item.status    = 'queued';
      item.updatedAt = Date.now();
      item.lastError = '';
      this._emit('change', item);
      return true;
    }

    // ── Clear helpers ────────────────────────────────────────
    clearDone() {
      const before = this._items.length;
      this._items = this._items.filter(i => i.status !== 'complete');
      if (this._items.length !== before) this._emit('change');
    }

    clearAll() {
      this._items = [];
      this._emit('change');
    }

    // ── Pause / Resume ───────────────────────────────────────
    pause()  { this._paused = true;  this._emit('pause');  }
    resume() { this._paused = false; this._emit('resume'); }
    get paused() { return this._paused; }

    // ── Queries ──────────────────────────────────────────────
    getAll()       { return [...this._items]; }
    getQueued()    { return this._items.filter(i => i.status === 'queued'); }
    getActive()    { return this._items.filter(i => ['loading','scraping','media'].includes(i.status)); }
    getFailed()    { return this._items.filter(i => i.status === 'needs_retry' || i.status === 'blocked'); }
    getCompleted() { return this._items.filter(i => i.status === 'complete'); }

    getStatus() {
      const all = this._items;
      return {
        total:     all.length,
        queued:    all.filter(i => i.status === 'queued').length,
        active:    all.filter(i => ['loading','scraping','media'].includes(i.status)).length,
        complete:  all.filter(i => i.status === 'complete').length,
        failed:    all.filter(i => i.status === 'needs_retry').length,
        blocked:   all.filter(i => i.status === 'blocked').length,
        cancelled: all.filter(i => i.status === 'cancelled').length,
        paused:    this._paused
      };
    }

    // ── Search / filter ──────────────────────────────────────
    query({ status, search } = {}) {
      let items = this._items;
      if (status && status !== 'all') {
        items = items.filter(i => i.status === status);
      }
      if (search) {
        const q = search.toLowerCase();
        items = items.filter(i =>
          i.url.toLowerCase().includes(q) ||
          (i.title || '').toLowerCase().includes(q)
        );
      }
      return items;
    }

    // ── Event system ─────────────────────────────────────────
    on(event, cb) {
      this._listeners.push({ event, cb });
      return () => { this._listeners = this._listeners.filter(l => l.cb !== cb); };
    }

    _emit(event, data) {
      for (const l of this._listeners) {
        if (l.event === event || l.event === '*') {
          try { l.cb(data); } catch (e) { console.warn('[QueueEngine] listener error:', e); }
        }
      }
    }

    // ── Internal helpers ─────────────────────────────────────
    _normalize(raw) {
      return {
        id:        raw.id        || _uid(),
        url:       raw.url       || '',
        title:     raw.title     || '',
        status:    VALID_STATUSES.has(raw.status) ? raw.status : 'queued',
        attempts:  raw.attempts  || 0,
        lastError: raw.lastError || '',
        lastStage: raw.lastStage || '',
        source:    raw.source    || 'manual',
        addedAt:   raw.addedAt   || Date.now(),
        updatedAt: raw.updatedAt || Date.now()
      };
    }
  }

  // ── UID generator ────────────────────────────────────────────
  let _uidCounter = 0;
  function _uid() {
    return `zh-${Date.now()}-${_uidCounter++}`;
  }

  // Export singleton + class
  window.ZHQueueEngine = QueueEngine;
  window.zhQueue       = new QueueEngine();

})();
