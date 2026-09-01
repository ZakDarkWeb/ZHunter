# ZHunter PRO

Chrome side-panel extension for product research. Open product pages on Amazon, Walmart, Sam's Club, Alibaba, AliExpress and 40+ other stores, then hunt them all with one click: title, link, price, images and videos → one sheet + one ZIP.

## Install (developer mode)

1. Download this repository (Code → Download ZIP) and unzip it, or `git clone` it.
2. Open `chrome://extensions`, turn on **Developer mode** (top right).
3. **Load unpacked** → select the `ZHunter-main` folder (the one containing `manifest.json`).
4. Pin the ZHunter icon. Clicking it opens the side panel. `Ctrl+Shift+L` also opens it.

To update: pull/download the new version, then press **Reload** on the ZHunter card in `chrome://extensions`.

## Daily workflow

1. Open the product pages you want in tabs.
2. Side panel → **Bulk** → **Hunt all open tabs**.
3. When it finishes: **Download Master ZIP** (`products_sheet.xlsx` + `Folder 01…NN` with images and `info.txt`), or **Sheet only**.

Other ways in:
- **Hunt tab** – images and videos of the page you're on; select and download.
- **Floating card** on product pages – minimized by default, click to open, pick images, download.
- **Right-click** a product page or link → *ZHunter: Add to queue*; then Bulk → *Paste links instead* → *Hunt these links*.
- **Library** – everything you've hunted; search, folders, export sheet/ZIP.

## Settings

Side panel → Settings for the everyday ones (close tabs after hunt, auto-skip duplicates, filename prefix, image format/ratio). The full page (⚙ in the header) adds data backup, keyboard shortcuts, danger zone.

## Notes

- Everything is stored locally in Chrome (`chrome.storage.local`). No accounts, no servers.
- HLS videos are remuxed to real MP4 in the browser (no re-encode). WebM-only videos stay WebM.
- Bulk hunts can be resumed after a browser restart (Bulk tab shows an "Unfinished hunt" bar for 3 days).

## Development

```
node dev/zhunter-regression-test.js     # static checks across all files
node dev/queue-logic-test.js
python3 dev/amazon-scrape-test.py dev/dom-samples/amazon-hydro.html https://www.amazon.com/dp/X
```

`dev/` is not loaded by Chrome. Changelog: `CHANGELOG-v8.0.0.md` (v8.x) and `CHANGELOG-v7.*.md`.

## Structure

| File | Role |
|---|---|
| `manifest.json` | MV3 manifest |
| `background.js` | service worker: storage, queue, context menu, image fetch/convert |
| `content.js` | page scrapers (per store), floating image card, in-page toast |
| `sidepanel.html/.js` | side panel UI and controllers |
| `sidepanel-shell.js` | v8 layout glue (tabs, export menus, quick settings) |
| `options.html/.js/.css` | full settings page |
| `style.css` | the one stylesheet (dark/light, cyberpunk shell) |
| `lib/` | `xlsx-js-style`, `jszip`, `mux-mp4` |
