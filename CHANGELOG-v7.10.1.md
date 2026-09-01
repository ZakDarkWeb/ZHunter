# ZHunter PRO v7.10.1

## Reliability and security fixes

The in-page **Add to Queue** overlay now uses a narrow queue-check contract and the background worker validates the current tab URL, supported marketplace, normalized URL, duplicate state, title length, and queue size. Bulk queue reads and full-array updates now normalize, deduplicate, bound, and sanitize stored items.

Normal `GET_DATA` and `GET_SETTINGS` responses no longer return raw AI credentials. Popup and side-panel AI flows use provider-status metadata, while the background worker selects credentials internally. The options page now includes a functional provider/API-key editor with local-only save and clear actions, and Reset Settings clears stored provider keys.

Link updates now use an allowlist and type/length/URL validation. URL canonicalization removes common tracking parameters, normalizes host casing/default ports, sorts query parameters, and is reused by duplicate checks. Storage failures now return a failure signal and safe diagnostic instead of being swallowed silently.

Unauthenticated Firestore cloud sync is gated off until authenticated authorization and restrictive rules are deployed. Cloud payload construction also redacts secret settings as defense in depth.

The side panel is now queue-only: obsolete Open Tabs and Master Sheet wrappers were removed, with queue initialization made explicit. Visible floating-button mojibake was corrected.

## Product research and workflow upgrades

The Product Queue now includes search, status filters, Retry problems, and per-product Retry actions. Failed queue items persist status and error information for review. The Master ZIP now contains the existing four-column `product_sheet.xlsx` plus a `research_workbook.xlsx` with Products, Media, Costing, and Errors sheets. Costing includes editable inputs and spreadsheet formulas for landed cost, gross profit, margin, ROI, and break-even price.

## Verification

All non-library JavaScript files pass syntax checks. The queue logic test passes, the expanded ZHunter regression suite passes 28 checks, and release-structure validation passes for version 7.10.1.

## Note

Browser-level marketplace verification still requires loading the unpacked extension in Chromium and testing against live pages while logged in or logged out as applicable. Cloud sync is intentionally unavailable in this release until an authenticated backend authorization model is available.
