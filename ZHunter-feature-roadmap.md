# ZHunter Feature and Upgrade Roadmap

**Prepared for:** ZHunter PRO  
**Repository reviewed:** [ZakDarkWeb/ZHunter](https://github.com/ZakDarkWeb/ZHunter)  
**Current baseline:** The extension already has marketplace-specific scraping, generic JSON-LD extraction, image and video URL collection, reverse-image context actions, AI enrichment, IndexedDB media storage, XLSX/CSV/HTML/PDF exports, cloud-sync code, bulk hunting, and the newer no-tab Product Queue.[1] [2]

## Executive recommendation

ZHunter should evolve from a simple “save product links” extension into a **product-research and sourcing workspace**. The strongest differentiation is not merely downloading images or videos; it is converting scattered product pages into a clean, comparable, supplier-ready dataset with reliable media, sourcing price, product identity, profitability signals, and exportable evidence.

The next major release should not begin with many cosmetic features. First, strengthen the queue and data model, then add media intelligence, supplier discovery, and product scoring. Otherwise, new image/video features will produce more incomplete, duplicate, and difficult-to-audit records.

> **Recommended direction:** Product Queue → reliable capture → media intelligence → supplier matching → profit/research scoring → professional exports.

## 1. What ZHunter already does well

The scraper is already the project’s strongest technical asset. It contains site-specific handlers for major marketplaces, generic fallback extraction, JSON-LD and application-state harvesting, gallery-scoped image collection, video URL discovery, variant extraction, and price normalization attempts. The background worker also has image conversion, IndexedDB storage, batching, concurrency controls, and a service-worker keepalive strategy.[2]

The current product surface is broad, but the implementation is distributed across very large popup, side-panel, content-script, and service-worker files. That makes feature additions possible in the short term but increases the chance that popup and side-panel behavior will diverge. The repository would benefit from a shared schema and shared business modules before the next major feature wave.

| Existing capability | Current value | Main gap to address |
| --- | --- | --- |
| Marketplace scraper | High | Needs fixture-based regression tests and stronger product identity checks. |
| Images | High | Needs quality ranking, perceptual duplicate detection, provenance, and gallery roles. |
| Videos | Medium | URLs are collected, but metadata, thumbnails, source quality, and user-safe handling are limited. |
| Product Queue | High | Needs persistent retry rounds, multi-worker hidden processing, pause/resume, and richer error reporting. |
| AI enrichment | Medium/High | Needs structured product scoring, confidence, factuality warnings, and cost/key isolation. |
| Exports | High | Needs a research workbook with multiple sheets and an error/provenance sheet. |
| Cloud sync | Potentially high | Must be secured before being expanded; current authorization design is a release blocker. |

## 2. Highest-priority upgrades

### P0 — Security and data integrity foundation

Before adding more integrations, remove secrets from general data responses, restrict privileged message actions, validate update fields with an allowlist, and replace the open-rule Firestore design with authenticated authorization. The current worker contains API-key-bearing settings and cloud-sync logic that should not be exposed to content-script contexts.[2] Firebase’s own documentation warns that unrestricted Firestore rules allow anyone to overwrite the database and should not be used in production.[3]

This work has high value and medium effort. It does not create a visible marketing feature, but it protects the extension, its users, and any future marketplace integrations. A secure foundation also makes it easier to publish ZHunter or share it with other users.

### P1 — Production-grade queue engine

The current no-tab queue is the right direction for large batches. The next upgrade should turn it into a durable job engine with a state machine such as `queued`, `loading`, `scraping`, `media`, `retrying`, `complete`, `needs_retry`, `blocked`, and `cancelled`. Every job should have an attempt history, last error, last successful stage, start time, end time, and source tab.

The current one-hidden-tab design protects Chrome responsiveness but limits throughput. A good next step is a configurable **2–3 hidden-worker mode** with per-domain limits. This should be an opt-in performance setting rather than a return to 50 visible tabs. Each worker can process a different product while the queue maintains domain throttling and persistent checkpoints.

| Queue upgrade | Value | Effort | Risk | Recommendation |
| --- | ---: | ---: | ---: | --- |
| Attempt history and stage-level errors | High | Low | Low | Implement immediately. |
| Pause/resume after browser restart | High | Medium | Low | Implement immediately after history. |
| Retry failed links with backoff | High | Medium | Low | Implement immediately. |
| Two or three hidden workers | High | Medium | Medium | Implement after stable single-worker behavior. |
| Per-domain concurrency and delay settings | High | Medium | Medium | Add with hidden workers. |
| Infinite automatic retries | Low/Medium | Low | High | Avoid; use bounded rounds plus a Retry Problems action. |

### P1 — Stronger product identity and duplicate detection

URL equality is not enough. The same product may appear with tracking parameters, localized domains, affiliate redirects, variant parameters, or different URL paths. ZHunter should generate a normalized identity containing marketplace, product ID, canonical URL, seller/store ID, selected variant, and a fallback fingerprint from title plus image hashes.

The duplicate engine should show the reason for a match and offer three actions: merge records, keep both as different sellers, or save as a new variant. This is especially valuable for sourcing because the same product from two suppliers must not always be treated as a duplicate.

## 3. Image-hunting upgrades

### 3.1 Image quality and role classification

Instead of saving images as an undifferentiated list, classify them as `hero`, `gallery`, `variant`, `packaging`, `infographic`, `lifestyle`, `seller/logo`, or `unknown`. The current scraper already filters many UI and non-product images; the next step is to rank the remaining images using dimensions, file size, aspect ratio, URL quality, DOM position, and optional AI classification.[2]

The UI should display a preferred hero image, the number of gallery images, and rejected-image reasons. Users should be able to change the hero image manually and preserve the original source URL.

### 3.2 Perceptual duplicate removal

URL-based deduplication does not catch the same image served from different CDNs or resized paths. Add a perceptual hash such as pHash or a compact image fingerprint in the background worker. Images with a close hash should be grouped as the same asset, while the highest-resolution version is retained.

This is a high-value, medium-effort feature because it reduces clutter in exports and prevents the same product image from appearing repeatedly under different URLs.

### 3.3 Image evidence and provenance

Each saved image should include its original URL, fetched URL, source page, capture time, dimensions, byte size, MIME type, and whether it was transformed. Export a separate **Media** sheet containing those fields. This makes it possible to audit where an image came from instead of treating a downloaded base64 file as unexplained content.

A useful compliance-oriented enhancement is a visible **Source and Usage Notes** field. The extension should not claim that an image is legally reusable; it should simply preserve source and let the user record permission or licensing notes.

### 3.4 Image comparison and supplier matching

Add a **Compare Images** view where users can select two or more product images and see them side by side with resolution, aspect ratio, file size, and perceptual similarity. The existing reverse-image action can evolve into a supplier workflow: open the selected image in Google Lens, Bing Visual Search, or another user-approved visual search service, then capture candidate supplier URLs into a review queue.

The safest first version should open search services with the image URL and let the user review results. Automated scraping of search results should be treated separately because services may restrict automated access and results can change frequently.

## 4. Video-hunting upgrades

### 4.1 Video metadata capture

The current scraper collects direct video URLs and YouTube-style URLs. The next version should save a structured video object containing `sourceUrl`, `normalizedUrl`, platform, thumbnail URL, duration when available, width, height, MIME type, bitrate when available, poster frame, capture time, and whether it is a direct file or an embedded player.

The video UI should show a thumbnail grid with source labels and a **Copy URL**, **Open Source**, and **Add to Export** action. A single product may have a main demonstration video, variant video, short-form video, and seller video; these should not be flattened into one `videoUrl` field.

### 4.2 Safe video download support

Add downloading only for openly served media that the browser can fetch without bypassing authentication, DRM, access controls, or platform restrictions. For YouTube and similar platforms, the safer product feature is link and metadata capture rather than bypass downloading. The extension should preserve the source URL and clearly label whether it has a locally downloaded copy.

### 4.3 Video quality and relevance ranking

Rank videos by product relevance, duration, resolution, and source type. A product demonstration video should rank above an advertisement or platform promotional clip. The existing DOM and inline-script collectors provide the raw candidates; a post-processing layer can remove duplicates and score the list.

### 4.4 Video-to-product AI extraction

For a user-selected video or transcript, AI can produce structured fields such as product benefits, observed features, dimensions mentioned, use cases, and claims requiring verification. Every AI-generated field should carry a `generated` flag and never overwrite raw scraped data. This prevents uncertain descriptions from being mistaken for supplier facts.

## 5. Product research and sourcing intelligence

### 5.1 Landed-cost and profitability calculator

Add fields for sourcing price, shipping, marketplace fees, payment fees, estimated duties, packaging, advertising cost, target margin, and selling price. Calculate landed cost, gross profit, margin percentage, ROI, and break-even selling price. Keep the raw sourcing price separate from the calculated estimate so users can audit the result.

| Suggested calculation | Purpose |
| --- | --- |
| Landed cost | Sourcing price plus shipping, duties, packaging, and other costs. |
| Gross profit | Selling price minus landed cost and selling costs. |
| Margin percentage | Profit divided by selling price. |
| ROI | Profit divided by total invested cost. |
| Break-even price | Minimum selling price needed to avoid a loss. |

### 5.2 Currency normalization

Store both the original displayed price and a normalized numeric amount with currency code. Add an explicit exchange-rate source and capture time if conversion is enabled. Never replace the original price with a converted estimate. The export should contain `Original Price`, `Currency`, `Converted Price`, and `Rate Timestamp` when the user enables conversion.

### 5.3 Seller, stock, MOQ, and shipping fields

For sourcing, add seller/store name, seller URL, rating, review count, stock status, minimum order quantity, shipping cost, shipping country, delivery estimate, and variant availability. These fields should be optional and source-specific because marketplaces expose different levels of detail.

### 5.4 Product scorecard

Create a configurable score from product demand signals, selling price, sourcing cost, review quality, image quality, video presence, shipping difficulty, seller confidence, and competition. The score should show its components rather than being a mysterious AI number.

A useful initial scorecard could include:

| Score component | Example interpretation |
| --- | --- |
| Data completeness | Title, price, images, variants, and seller data are present. |
| Sourcing attractiveness | Price and estimated landed cost support the target margin. |
| Supplier confidence | Seller identity, rating, stock, and source stability are clear. |
| Media quality | Hero image, gallery, and product video are usable. |
| Risk flags | Missing price, ambiguous variant, restricted claim, or unstable URL. |

### 5.5 Change tracking and price history

Allow users to re-check a saved product later and compare title, price, stock, images, and seller changes. Store snapshots rather than overwriting old values. This turns ZHunter into a lightweight research tracker instead of a one-time scraper.

## 6. AI features worth adding

AI should be used for **organization and review**, not for inventing facts. The strongest features are title cleanup, attribute extraction, category prediction, duplicate explanation, image role classification, product-benefit summarization, and risk-flag generation.

Recommended AI outputs should be structured and confidence-aware:

| AI feature | User benefit | Guardrail |
| --- | --- | --- |
| Clean product title | Consistent sheet and catalog names | Preserve original title separately. |
| Extract attributes | Size, color, material, capacity, and key features | Store source text and confidence. |
| Generate tags | Faster organization | Let users approve or edit tags. |
| Product comparison | Compare several suppliers | Show evidence for each comparison. |
| Risk detection | Find missing or suspicious data | Label as a warning, not a definitive judgment. |
| SEO draft | Prepare listing copy | Clearly mark generated copy and require review. |

## 7. Export and workflow upgrades

The current four-column sheet is excellent as a fast output. Keep it as the **Quick Sheet**, then add a **Research Workbook** with separate sheets:

| Sheet | Contents |
| --- | --- |
| Quick Sheet | Folder Number, Product Title, Link, Sourcing Price. |
| Products | Full normalized product fields. |
| Media | Image/video URLs, dimensions, source, quality, and capture time. |
| Variants | Variant name, value, price, stock, and source. |
| Costing | Selling price, fees, landed cost, profit, margin, and ROI. |
| Errors | URL, stage, attempt count, last error, and retry action. |
| Change Log | Previous and current price, title, stock, or seller values. |

Add export presets so users can choose **Quick Sheet**, **Supplier Research**, **Marketplace Listing**, or **Full Backup**. Export should never silently omit failed records; the Errors sheet should explain what still needs attention.

## 8. User experience upgrades

The queue should become the central dashboard. Add filters for `All`, `Queued`, `Retrying`, `Completed`, `Needs Retry`, and `Blocked`; a search box; bulk retry; bulk delete; pause/resume; clear completed; and an error-details drawer. The user should be able to see which stage is slow: page loading, scraping, media fetching, AI enrichment, or export.

A small **Quick Add popup** would be valuable. It could show the current page’s product title, price, supported-site status, and an **Add to Queue** button without requiring the user to open the full side panel. For a page containing many product links, the popup could show the count found and provide **Add All Suitable Links**.

A **review inbox** would also improve trust. Products with missing price, low image quality, ambiguous seller, or repeated retries should appear in a review list before export.

## 9. Architecture and engineering upgrades

The current JavaScript files are very large and duplicate behavior between popup and side panel. Move shared logic into modules such as `schema.js`, `url-utils.js`, `queue-engine.js`, `scraper-contract.js`, `media-engine.js`, `export-engine.js`, and `security.js`. Keep popup and side panel as thin UI layers.

Add a versioned schema migration system. Every saved record should include a schema version, and migrations should be idempotent. Add fixture-based tests for each supported marketplace using saved HTML or JSON snapshots. The test suite should cover title, price, canonical URL, image selection, video selection, variants, duplicate identity, retries, and exports.

| Engineering improvement | Benefit |
| --- | --- |
| Shared product schema | Prevents popup/side-panel drift. |
| Scraper fixture tests | Detects marketplace markup changes early. |
| Type checking or JSDoc contracts | Reduces malformed record and message bugs. |
| CI syntax/lint/test workflow | Prevents broken releases. |
| Structured logging | Makes retries and marketplace failures diagnosable. |
| One export engine | Ensures XLSX, CSV, HTML, and PDF agree. |

## 10. Recommended release sequence

### Release A — Reliability and trust

Complete the secure message boundary, remove API keys from general responses, secure cloud authorization, stabilize the queue state machine, add attempt history, add the Errors sheet, and add regression tests. This is the foundation for every later feature.

### Release B — Media Intelligence

Add image roles, perceptual duplicates, quality scoring, provenance, structured video metadata, thumbnails, and a media comparison view. Keep original URLs and raw captures separate from transformed files.

### Release C — Supplier Discovery

Add reverse-image supplier workflows, candidate supplier review queues, product identity matching, seller fields, MOQ, stock, shipping, and supplier comparison. Start with user-reviewed search results rather than fully automated scraping of external search engines.

### Release D — Product Economics

Add currency normalization, landed cost, fees, margin, ROI, break-even price, and configurable product scorecards. Add a research workbook with Products, Media, Variants, Costing, Errors, and Change Log sheets.

### Release E — Automation and collaboration

Add scheduled re-checks, price/stock change alerts, user-approved batch refreshes, backup/restore, and optional team or cloud workspaces—but only after authentication, authorization, privacy, and conflict resolution are properly implemented.

## Final prioritization

If only five upgrades can be implemented next, choose these:

| Rank | Upgrade | Why it should come first |
| ---: | --- | --- |
| 1 | Secure data and API-key boundaries | Prevents the most serious user and platform risk. |
| 2 | Durable queue with retries, resume, and Errors sheet | Makes 50+ product workflows dependable. |
| 3 | Image quality, roles, perceptual deduplication, and provenance | Produces cleaner sourcing assets and better exports. |
| 4 | Structured video metadata and safe link/download handling | Makes video hunting useful without unsafe platform bypasses. |
| 5 | Landed-cost, margin, ROI, and supplier comparison | Turns collected links into actual sourcing decisions. |

The most valuable long-term identity for ZHunter is **“a reliable product sourcing research desk inside the browser.”** Image and video hunting should support that identity by improving product evidence, supplier discovery, and listing preparation—not become isolated download buttons.

## References

[1]: https://github.com/ZakDarkWeb/ZHunter — ZHunter repository and current feature surface.  
[2]: https://github.com/ZakDarkWeb/ZHunter/blob/main/background.js — Service worker, queue, media, AI, storage, and cloud-sync implementation.  
[3]: https://firebase.google.com/docs/firestore/security/get-started — Firestore security rules and warning against unrestricted access.
