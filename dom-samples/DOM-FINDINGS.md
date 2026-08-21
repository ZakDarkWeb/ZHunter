# Marketplace DOM Findings

## Supplied samples

| Sample | Retrieved HTML | Key result |
|---|---:|---|
| Amazon HydroJug | 1,081,516 bytes | Product gallery is server-rendered and exposes `#landingImage`, `#imgTagWrapperId img`, seven `[data-a-dynamic-image]` nodes, and one `data-old-hires` full-size URL. |
| Amazon sweatpants | 867,544 bytes | Product gallery is server-rendered and exposes `#landingImage`, `#imgTagWrapperId img`, five `[data-a-dynamic-image]` nodes, and one `data-old-hires` full-size URL. |
| Sam's Club | 16,078 bytes | Raw request returns a robot-check page with zero images; live DOM must be inspected from the user's browser/session. |
| Walmart | 15,190 bytes | Raw request returns a robot-or-human page with zero images; live DOM must be inspected from the user's browser/session. |

## Amazon observations

The Amazon product pages expose a stable product-gallery pattern. The main image is present under `#landingImage` / `#imgTagWrapperId img`; the full-size image is available in `data-old-hires`; and the gallery thumbnails contain JSON in `data-a-dynamic-image`. The scraper should prioritize `data-old-hires`, then parse `data-a-dynamic-image` keys, then use the thumbnail `src` only as a fallback. It should avoid navigation sprites, tracking pixels, and marketing images.

The two Amazon samples have different gallery counts and layouts but share these selectors. This supports a selector-first extractor that does not depend on the gallery being visually vertical or horizontal.

## Walmart and Sam's Club limitation

The raw HTTP samples cannot reveal the product DOM because both sites returned anti-bot challenge HTML. The extension's content script, running inside the user's already-loaded page, must therefore rely on live DOM selectors and embedded state that are only available after the challenge is passed. The next implementation should expand live DOM extraction around image `src`, `srcset`, `data-src`, `data-lazy-src`, `data-image-url`, `data-testid`, gallery containers, and embedded JSON/state strings, and should use `MutationObserver`/delayed rescans for lazy-loaded galleries.

## Root cause hypothesis

Amazon works because the current scraper already has stable selectors and full-size URL conversion. Walmart/Sam's Club likely fail when images are only present in lazy-loading attributes, JSON state, or are added after initial page load. The page card currently performs one scrape after a fixed delay, so it can miss images that appear later. The fix should add a bounded retry/rescan cycle and marketplace-specific collection from live DOM/state before reporting no images.
