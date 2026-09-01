# ZHunter PRO v7.11.0

## New features

**Import preview before queueing.** "Add All Open Product Tabs" now opens a review dialog instead of writing straight to the queue. Every tab is classified as *Ready to add*, *Duplicate* (already in the queue, or repeated in the same import) or *Unsupported*, with the marketplace and the skip reason shown per row. Ready rows have checkboxes (Select All / None); only the rows you leave checked are added. Duplicates were previously dropped silently — they are now visible.

Implemented via a new read-only `PREVIEW_PRODUCT_QUEUE` background action that runs the same normalization, allowlist and duplicate checks as `ADD_PRODUCT_QUEUE` without saving. Paste-URL, Scan Page and Current Page paths are unchanged.

**Per-product Retry.** The ↻ Retry button on a *Needs Retry* row now retries only that product (`RETRY_PRODUCT_QUEUE` accepts an `ids` array) and starts the queue worker if it is idle. Previously it reset every failed item.

## Bug fixes

- **Broken currency parsing (content.js).** The file had been saved double-UTF-8-encoded. The currency character class `[$£€¥₹₩]`, the currency symbol maps, the Unicode-minus discount stripper and the `span[aria-label*="£"]` price selectors were all corrupted, so non-USD prices could fail to parse. 148 lines repaired; 263 mojibake lines in style.css also repaired. A regression check now guards against this.
- **Inline `onerror` handlers blocked by MV3 CSP.** 17 inline handlers across popup, side panel and options (including the queue hero thumbnails and hunt-preview "image broken" markers) never ran. Replaced with `data-onerror="hide|broken|vidicon"` and one delegated capture-phase listener per page. Handlers inside the exported standalone HTML catalog are intentionally left inline (no CSP there).
- **Version drift.** Manifest said 7.10.7, the three UIs said 7.10.6, the About panel said 7.6.1. All now 7.11.0, and the About value is wired to the runtime manifest version.
- **Import preview promise leak.** Closing the new dialog via backdrop click or Escape resolves the pending import so the caller never hangs.

## Tests

`zhunter-regression-test.js` was failing on stale assertions (version mismatch; asserted the side panel had *no* Open Tabs / Master Sheet views, contradicting the v7.10.6 design; looked for the old `shadow.innerHTML` image card). Assertions updated to the shipped design and extended with 14 new checks for this release. 37 checks pass; queue logic tests pass; all JS passes syntax checks.

## Known, not changed

- `content.js` still has 2 inline `onerror` handlers inside the floating image card; those run under the host page's CSP, which may block them on some sites. Cosmetic only.
- Permissions (`<all_urls>`, `identity`, `clipboardRead`) and the hardcoded Firestore key are unchanged — see the roadmap P0 item.

---

# v7.11.1 — Cloud sync removal

Cloud sync was permanently disabled (`CLOUD_SYNC_AVAILABLE = false`) and never reachable, but its Firestore project ID and API key were still shipped in `background.js` and `firebase-config.js`. Removed:

- Firestore REST sync module, `CLOUD_SYNC_STATUS` / `LOAD_FROM_CLOUD` / `CLOUD_LOGOUT` / `FORCE_CLOUD_SYNC` handlers, the `cloudSyncDebounce` alarm, and the `cloudSyncEnabled` setting.
- `lib/firebase/` (3 files, ~500 KB) and `firebase-config.js`.
- Cloud Sync button in the side-panel header and its UI code.
- `identity` permission and the `googleapis` / `firebaseio` / `firebaseapp` host permissions. `<all_urls>` is intentionally kept.

Regression suite: 37 checks pass.

---

# v7.12.0 — Dead code removal

**Removed (no behaviour change for the side panel or floating card):**
- `popup.html` / `popup.js` (7,000+ lines). The manifest never declared a `default_popup`, so these files were never loaded; the toolbar icon opens the side panel.
- AI enrichment: OpenRouter/Groq/Gemini/OpenAI engine in `background.js`, `GENERATE_AI` handler, the ✨ AI buttons and handlers in the side panel, the "AI Provider and API Key" settings card, all `*ApiKey` / `activeAiProvider` settings, and the dead `parseAndApplyAI` / `applyAiToHuntModal` helpers. `ENRICH_LINK` now only does image enrichment.
- `lib/xlsx.full.min.js` (880 KB, unused — `xlsx-js-style` is the one actually loaded).
- `clipboardRead` permission (extension pages can read the clipboard on user gesture without it).
- Google Fonts CDN links; the font stack now falls back to system fonts.

**Changed:**
- Manifest description rewritten to describe the current product.
- `dom-samples/` and the test scripts moved to `dev/` so they are no longer shipped in the extension folder. Run tests with `node dev/zhunter-regression-test.js`.

Shipped size: 5.4 MB → 1.6 MB (excluding dev/). Regression suite: 39 checks pass.
