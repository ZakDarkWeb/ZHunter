# ZHunter Next Improvements

## Current release improvements

The Product Queue now includes **Add All Suitable Open Tabs**. It imports HTTP(S) tabs from the current browser window, sends them through the existing marketplace allowlist, rejects Google and unrelated sites, removes duplicates, and preserves the source as `open_tab`. Queue URL normalization also removes common tracking parameters such as `utm_*`, `gclid`, `fbclid`, `msclkid`, and `ref` without removing marketplace variant parameters.

## Recommended next free features

| Priority | Feature | Benefit | Implementation direction |
|---|---|---|---|
| 1 | Import preview before queueing | Users can see accepted, duplicate, and rejected tabs before saving them. | Add a review dialog with checkboxes and counts. |
| 2 | Queue filters and search | Large queues become easier to manage. | Filter by status, marketplace, folder, source, and image count. |
| 3 | Per-product retry | Users can retry one failed product instead of the whole problem set. | Add a Retry button to each `Needs Retry` row. |
| 4 | Download progress history | Users can see which images were downloaded and which failed. | Persist media status per URL and include it in the workbook/ZIP. |
| 5 | Duplicate product merge | Variant/tracking URLs for the same product can be grouped safely. | Use marketplace product IDs where available, with URL fallback. |
| 6 | Folder auto-numbering | Manual folder numbering becomes optional. | Continue numbering from the highest existing queue folder. |
| 7 | Queue pause/resume | Large batches can be stopped without losing progress. | Persist the current item and resume from the next pending record. |
| 8 | Marketplace health diagnostics | Users can quickly see why a site returned no images or price. | Show selector, login, region, timeout, and blocked-page diagnostics. |
| 9 | Image quality selector | Users can choose original, large, or compressed images before export. | Reuse the existing local image conversion settings. |
| 10 | Export presets | One click can export Quick Sheet, Research Workbook, or Master ZIP. | Add a compact export menu while keeping the current buttons. |

## Current limitations to keep visible

The open-tab importer uses the **current browser window** and only imports HTTP(S) tabs. Unsupported domains are rejected by the background allowlist. The importer does not open new tabs; it only queues URLs that are already open. Product processing still uses the minimized queue worker, so Chrome is not overloaded by opening a new tab for every product.

## Suggested release order

First add the import preview and queue filters because they improve safety and daily usability immediately. Next add per-product retry, automatic folder numbering, and pause/resume. After that, improve media diagnostics and export presets. These features can remain local and do not require paid APIs.

## Bug-audit focus for the next pass

The next audit should exercise mixed windows containing supported product pages, Google/search pages, internal browser pages, duplicate tracking URLs, marketplace variants, logged-out pages, lazy-loaded galleries, blocked image CDNs, and long queues. The expected behavior is explicit classification rather than silent skipping: accepted, duplicate, unsupported, completed, or needs retry.
