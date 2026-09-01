# ZHunter v8.0.0 — Part 1: new shell, Bulk tab, stylesheet

## What changed
- **New side panel layout**: Hunt · Bulk · Library · Settings tabs on top, status line at the bottom. No bottom nav, no sub-view toggles.
- **Bulk tab**: "Open tabs" card on top with one primary action (**Hunt all open tabs**) plus "Add to queue"; "Queue" card below for pasted links with search, status filter and one **Export ▾** menu (XLSX / CSV / HTML / PDF / ZIP).
- **Hunt tab**: images and videos of the current page on one screen (was two tabs).
- **Library**: Master Sheet moved to its own tab with stats strip, search, and an **Export ▾** menu.
- **Settings tab** (inside the panel): theme toggle, Visual effects Off / Subtle / Full, link to the full settings page. Full inlining comes in Part 3.
- **New `style.css`** (~380 lines, token-based, light + dark) replaces the 8,300-line legacy stylesheet. One spinner is the only infinite animation. Legacy CSS kept as `style-legacy.css` for the options page until Part 3, and in `dev/`.
- `sidepanel-shell.js`: small glue layer — tab hooks, export menus, effects setting, status line. **`sidepanel.js` logic is unchanged**; all 178 element ids are preserved.

## Fixes
- **Import preview and per-item Retry now work.** In v7.11 they were wired to a second "Product Queue" engine whose UI never existed. "Add to queue" now opens the review dialog (ready / duplicate / unsupported) against the live queue via a new read-only `PREVIEW_BULK_QUEUE` action. Retry per row already existed on the live queue.
- All 17 inline `onerror` handlers, mojibake and version drift fixes from v7.11 carry over.

## Test checklist (please run in Chrome)
1. Reload extension → open side panel. Bulk tab is selected by default; header shows product count.
2. Open 3–4 product tabs (Amazon/Walmart/Sam's) + one Google tab → Bulk → Open tabs list shows the product tabs checked, Google unchecked.
3. **Hunt all open tabs** → progress modal → result → **Master ZIP** and **Sheet (XLSX)** download. Sheet is the same 4-column green format.
4. **Add to queue** → review dialog appears with groups → Add → rows appear in Queue card. Try again → they show as duplicates.
5. Queue: paste a link → Add; search; status filter; hover a row → ✕ remove; **Hunt queue in background**; then **Export ▾** enables.
6. Hunt tab on a product page: Hunt images → grid → select → Download selected. Hunt videos → cards → Download.
7. Library: stats, search, select rows → bulk delete bar; **Export ▾**; Import; Reset.
8. Settings tab: Theme toggle, Effects Off/Subtle/Full (rows stop animating on Off), Open → full settings page (still old look until Part 3).
9. Theme toggle in the header: both light and dark should look consistent.

## Known / next
- Options page still uses the legacy stylesheet (Part 3).
- Floating image card on product pages unchanged (Part 3).
- Dead "Product Queue" engine code (~800 lines in sidepanel.js + background) to be removed in Part 3.

---

# v8.0.1 — Bulk tab: one button

- **Bulk tab now has a single primary action: "Hunt all open tabs".** The "Add to queue" button is gone — it duplicated the hunt with an extra step nobody needed.
- The link queue is tucked behind **"Paste links instead"** (collapsed). It opens by itself only when it already has waiting items, and shows "N waiting" on the row. Its button is now "Hunt these links".
- **Auto-capture is off by default.** Previously every product page you visited was silently added to the queue. Turn it on inside "Paste links instead" if you want that.
- **Floating image card starts minimized on every page.** Click the small ZH button to open it. Position is still remembered; open/closed state is not.
- Open-tabs list: "Products" chip renamed "All" (it selects all product tabs).

---

# v8.0.2 — Brand polish + page button removed

- **On-page "Add to Queue" button removed** from product pages. Only the floating image card remains (minimized until clicked).
- **Brand identity back on top of the clean base**: cyan glow on primary buttons with hover lift, accent-lit active tab, header gradient with accent hairline and logo ring, selected rows tinted with an accent bar, glowing progress bars, and **store tags colored per marketplace** (Amazon amber, Walmart blue, Sam's green, Alibaba/AliExpress orange, Temu/Shein pink, eBay red, golf shops green).
- **Visual effects default is now Full**: soft animated aurora behind the header, a periodic shine sweep on the primary button, pulsing status dot. "Subtle" keeps the glow and lift without the ambient motion; "Off" is flat. Change it in Settings.

---

# v8.0.3 — The ZHunter look is back

Rebuilt the visual language of the original extension on top of the v8 structure, using the values from the old stylesheet (v7.10.6):
- Deep navy palette (#03060F → #0A1428), electric cyan #00E5FF, the 28 px grid background with ambient glow.
- 64 px header: 40 px logo with breathing glow ring, gradient "ZHunter" wordmark, pulsing **PRO** badge, version + "Ultimate Product Hunter".
- Icon tabs with cyan active glow; "Bulk Hunt" banner at the top of the Bulk tab.
- Pill-shaped outline buttons that glow cyan on hover; cyan-gradient primary buttons with dark text.
- Rows: square cyan store tags, glowing checkboxes, cyan selection bar; hunt rows with the glowing icon tile.
- Glass toasts and modals with cyan borders.
- Light mode keeps the same structure with the "clean" cyan palette from the old light theme.
Still one stylesheet (~530 lines) instead of 8,300, so it stays consistent everywhere.

---

# v8.0.4 — Videos always come out as real MP4

**Bug:** HLS videos were "downloaded" by gluing the MPEG-TS segments together and naming the file `.mp4`. The container was still TS, so Windows Media Player, QuickTime and most editors refused to open it.

**Fix:**
- MPEG-TS streams are now remuxed in the browser to a genuine MP4 (H.264/AAC kept as-is, no re-encode, no quality loss) using `mux.js`. Verified with ffprobe: output is `mov,mp4` with h264 + aac and decodes cleanly.
- fMP4 playlists (`#EXT-X-MAP` init segment) are assembled correctly (init + segments) instead of missing the header.
- Applies to single-video download and "Download all" ZIP.
- Video list now shows MP4 sources first; a WebM that has an MP4 twin is hidden. If a site offers only WebM, the download says so (WebM → MP4 needs re-encoding, which a browser extension cannot do losslessly).

Adds `lib/mux-mp4.min.js` (86 KB, Apache-2.0).

---

# v8.0.5 — Close-tabs control, resume after restart, new Settings page

**Close tabs after hunt — your choice, remembered.** The checkbox under "Hunt all open tabs" now saves to settings (`bulkAutoCloseTabs`), so it stays how you left it across sessions. The same switch is on the Settings page under Bulk hunt. Failed tabs are never closed.

**Resume survives a browser close.** Before: the "Unfinished hunt" bar only appeared within 2 hours and Resume silently failed after a restart because the old tab ids no longer existed. Now:
- Progress is saved after every tab finishes (not just at the start).
- The unfinished hunt is kept for 3 days.
- Resume checks each saved tab: if it still exists it is reused; if not, the URL is reopened in a background tab, waited for, and hunted. Products that finished before the close are already in the Library (they are flushed there as the hunt runs).

**Settings page rebuilt** on the v8 stylesheet — same cyberpunk look as the side panel, sticky section nav, and only settings that actually do something:
- Bulk hunt: filename prefix, close tabs after hunt, auto-skip duplicates, fixed 4-column sheet note.
- Images: format, ratio, padding colour, minimum size, 5 MB limit.
- General: auto category, duplicate check, badge counter.
- Data: stats, storage, JSON backup, HTML catalog.
- Shortcuts, About, Danger zone.
- Removed: "Configure AI" copy, the empty Product Sheet column grid + "Reset to defaults", legacy stylesheet (`style-legacy.css` deleted).
- Fixed a pre-existing crash in `options.js` (`ALL_QUEUE_COLS_OPT` undefined) that stopped part of the page from initialising.

---

# v8.1.0 — Dead engine removed, Library ZIP

**Removed the second "Product Queue" engine.** It had no UI since the v7.10 side-panel rewrite: `sidepanel.js` 8,000 → 7,400 lines, `background.js` 2,300 → 1,700 lines (hidden-worker scraper, its 11 message handlers, research-workbook builders, state and renderers). The live "Paste links" queue is untouched. The import-review dialog now defaults to the live queue.

**Library → ZIP.** Library's Export menu gains **ZIP — sheet + images**: same layout as the bulk-hunt Master ZIP (`products_sheet.xlsx` + `Folder 01…NN` with images and `info.txt`). Uses the selected rows if any are selected, otherwise all rows. Images are re-fetched from their URLs (the Library stores URLs only), up to 7 per product; if a fetch fails the URLs are written to `image_urls.txt` in that folder. This is how you get a complete batch ZIP after a resumed hunt.

Regression suite: 44 checks (dead-engine assertions retired, 4 new).

---

# v8.1.1 — Right-click "Add to queue" works

The context menu existed already (4 items) but wrote to the dead Product Queue engine, so nothing ever showed up. Now:
- Right-click a product page → **ZHunter: Add this product to queue**; right-click a link → **Add link to queue**; select a URL as text → **Add selected URL to queue**; right-click an image → **Find supplier for this image** (Google Lens).
- Goes straight into the live "Paste links" queue in the Bulk tab; the panel refreshes and the Bulk tab badge updates.
- Feedback on the page itself (a small ZHunter toast bottom-right) plus the toolbar badge flash — works even when the side panel is closed.
- Fixed: `background.js` contained a duplicated 190-line block (folders, history, context-menu setup and handler defined twice) introduced during the v7.12 cleanup. Removed.

---

# v8.2.0 — UX pass + QA

Ran an automated click-through of every control on the Settings page (11) and every side-panel tab (28 controls) in headless Chrome: no runtime errors. Theme is shared between the panel and the Settings page (same storage key, live sync).

**Hunt-complete modal** — the screen you see most: **Download Master ZIP** is now the single big primary action at the top; below it a 2×2 of Sheet only (XLSX) · PDF catalog · Images only (one ZIP) · Images only (separate files); then Done. The live "tabs/s … calculating" line is hidden once the hunt finishes.

**Bulk tab banner** shows a live count ("7 product tabs open → one sheet + ZIP"), and when tabs are open but none is a product page it says so and tells you what to do.

**Quick settings inside the side panel** (Settings tab): close tabs after hunt, auto-skip duplicates, filename prefix, image format, ratio, 5 MB limit — saved to the same keys the full page uses, mirrored instantly to the Bulk tab checkbox. The full page remains for data backup, shortcuts and the danger zone.

---

# v8.2.1 — Amazon images: full resolution

**Bug:** Amazon images came out tiny (e.g. 354×283) in the ZIP and in direct downloads, while Walmart/Sam's were fine.

**Cause:** Amazon uses a *different image ID* for each resolution of the same photo (`hiRes` 41I8AN0RAgL vs `large` 21lIynVSvcL). The scraper added the hi-res URL and then also every `large`/thumbnail URL. Because the IDs differ, de-duplication could not see they were the same photo, so the 7-image cap filled up with low-res copies and the real hi-res images were cut off. Reproduced on the saved Amazon DOM samples in `dev/dom-samples`: before the fix 1 hi-res + 6 low-res duplicates; after, 6 distinct hi-res originals.

**Fix (`content.js`, Amazon scraper):**
- Parse the page's `colorImages` entries and take exactly one URL per gallery photo: `hiRes` if present, else the largest size in `main`, else `large`.
- The DOM gallery is now only a fallback and also takes one best candidate per `<img>` instead of every attribute.
- Applies to bulk hunt, the Hunt tab and the floating image card (they share the scraper).

Test script: `python3 dev/amazon-scrape-test.py dev/dom-samples/amazon-hydro.html https://www.amazon.com/dp/X`

---

# v8.2.2 — Settings fixes, repo ready for GitHub

**Settings bugs**
- Defaults were inconsistent: the full Settings page defaulted `autoSkipDuplicates` to off and had no filename prefix, while the extension actually defaulted both on; and the extension had no defaults for image ratio / padding / min size / 5 MB, so the page showed values that didn't match what was applied. Both now share one set of defaults (ratio Original, padding White, min size 0, 5 MB on, auto-skip on, prefix `zhunter_`).
- Hard-coded `selected` options in the Settings page could show a value different from the saved one. Removed; the saved value is always shown.
- Theme button showed a moon in both modes; now moon in dark, sun in light (panel and page).
- Panel Settings → Theme is a Dark / Light control that shows the current mode instead of a blind "Toggle".

**Repo**
- Added `README.md`, `.gitignore`, and `GITHUB-UPDATE.md` (step-by-step to replace the v7.6.1 repo, tag a release, and deal with the leaked Firebase key).

---

# v8.3.0 — Polish: rainbow rings, motion, loading states

- **Rainbow gradient borders are back** on the actions that matter: Hunt all open tabs, Hunt these links, Hunt images, Hunt videos, and Download Master ZIP. Implemented as an animated conic-gradient ring inside the element (no wrapper markup), 4 s rotation, faster on hover, frozen in Subtle, hidden in Off.
- Tabs: the active underline now **slides** between tabs.
- Buttons press down on click; primary glow spreads on hover.
- Rows: checkbox tick pops in; the cyan selection bar slides in.
- Cards, stats and banners enter with a short stagger.
- Open-tabs list shows **shimmer skeleton rows** while loading instead of "Loading tabs…".
- Progress bars have a moving shine; thumbnails fade in.
- Toasts have an icon (✓ / ! / ✕ / i) and slide up.
- Hunt-complete stats **count up**; successful rows flash green.
- Status line shows live "Hunting 4/12" while a hunt runs.
- Header scanline in Full mode. Effects levels now clearly differ: Full = everything, Subtle = static rings + hover only, Off = flat.
- Light mode: slightly stronger borders and secondary text for contrast.

No logic changes; CSS + `sidepanel-shell.js` only.

---

# v8.3.1 — Settings accuracy pass

Every setting and every number on the Settings page now refers to something that actually exists.

**Bugs fixed**
- **Library → Import did nothing** ("Import is not available in this build" — the handler was missing). Implemented: accepts the Settings backup JSON, a plain JSON array, CSV or XLSX with Title / Link / Price columns; skips rows already in the Library.
- **Header count, toolbar badge and Settings → Data counted the wrong thing** — the legacy "saved links" store from the old Collect tab, which has no UI anymore. All three now count the Library (master sheet). Badge refreshes whenever the Library changes.
- **Backup everything** exported the legacy links; it now exports Library + hunt history + queue + settings, and Library → Import restores it.
- **Clear Library** (was "Clear all products") now actually clears the Library. **Wipe everything** also clears the queue, unfinished-hunt state and UI state.
- **Ctrl+Shift+S** saved to the invisible legacy store; it now adds the current tab to the queue (with on-page toast).
- The auto "Review before saving" modal that popped up when the panel opened on a product page saved into that same invisible store. Turned off; Hunt tab and Bulk are the workflow.

**Removed from Settings (did nothing useful)**
- "Sheet format: fixed 4 columns" note (described the deleted engine; the live sheet uses the Columns panel).
- Auto category, Duplicate check (legacy-links only), HTML catalog (Library has its own).
- Data stats renamed: In Library · Hunt sessions · Queue waiting; storage shows total extension usage.

---

# v8.3.2 — No automatic download after a hunt

- **Removed the automatic XLSX download** that fired the moment a bulk hunt finished. It also came out with a random uuid filename (the sheet library's own save routine loses the name inside the side panel), which is what the "Save As" dialog was showing. Nothing is saved now until you click Master ZIP / Sheet only / PDF / Images in the result modal.
- All XLSX downloads (Sheet only, Library export) now go through `chrome.downloads` with the proper `zhunter_<date>.xlsx` name.
- Hunt-complete summary showed "0 images · 0 videos" — it was reading a field that only exists on Library rows. Now counts the images/videos actually captured.

---

# v8.3.3 — Cancel during a bulk hunt works

The Cancel button did register — it opened a "Cancel Bulk Hunt?" confirm dialog — but that dialog rendered **behind** the progress modal (same z-index, later in the DOM), so it looked like nothing happened. The confirm dialog now sits above every other modal. After confirming, the buttons show "Cancelling…" and the hunt stops after the tab currently in progress; results captured so far stay in the Library.

---

# v8.3.4 — Video download audit

Checked the whole video path (detect → classify → download) for every store.

**How each type is handled**
- **Direct MP4 / MOV / M4V / WebM** (Walmart, Alibaba, AliExpress, Temu, Shein, Shopify stores, most others): fetched with the site's cookies so CDNs that reject anonymous requests still work; if that fails Chrome downloads the URL itself with the right filename; last resort opens it in a tab. `.mov` / `.m4v` are now detected (were ignored).
- **HLS (.m3u8)** (Amazon product videos, Sam's Club / Brightcove): segments are fetched, TS is remuxed to a real MP4, fMP4 init segments handled. New: if the stream keeps audio in a separate track (rare, DASH-style HLS) you get a warning that the MP4 may be silent — a browser extension cannot merge two tracks losslessly.
- **YouTube embeds**: open in a tab (YouTube cannot be downloaded by an extension).
- **Download all (ZIP)**: same rules per video; failures write a `_url.txt` instead of aborting the ZIP.

**Bug found and fixed:** page scripts on Amazon contain the literal placeholder `https://...mp4`; it was being listed as a video. URLs must now have a real hostname. Verified on the saved Amazon samples: the real HLS stream is detected, the placeholder is gone.

What I could not test here: a live download from each store (needs a real browser session). If a specific store's video fails, send the product link.
