# ZHunter PRO v7.10.6

## Safe Queue processing and complete exports

Queue Hunt now uses one reusable inactive background worker tab. It navigates that same tab to one queued URL at a time, waits up to 60 seconds for slow pages, scrapes the DOM, records the result, and then proceeds to the next URL. The previous three-worker queue implementation has been removed to reduce memory pressure, tab bursts, and failures on slow connections.

The queue worker now applies a short cooldown between navigations, retries through the existing queue retry flow, preserves failed items for retry, and closes only its single worker tab at the end of the queue run. Pause, Resume, Cancel, and persistent queue state remain available.

Queue results now expose the same export family as Open Tabs: XLSX Sheet, CSV, HTML catalog, PDF catalog, and ZIP media export. Export buttons become active after successful or partial results are available. The existing Open Tabs workflow remains available separately and continues to operate on already-open tabs.

The side panel restores Open Tabs, Queue, and Master Sheet as distinct workflows. Add All Open Product Tabs now persists validated URLs to the queue and selects those existing tabs for the direct Open Tabs hunt. The Open Tabs Hunt + Export action keeps automatic successful-tab closing enabled by default.

The website connection path continues to use retry-based service-worker messaging rather than a blocking connection alert.

## Verification

All main JavaScript files pass syntax checks. Queue export controls and side-panel structure tests pass. Image DOM fixtures and queue tests pass. The expanded regression suite passes 42 checks, and release validation passes for v7.10.6.
