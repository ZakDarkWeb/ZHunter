# Live Browser DOM Findings

## Walmart supplied product page

The live page loaded successfully in the browser, unlike the raw unauthenticated HTTP response. The extracted live page shows a gallery with at least eight media items: six thumbnail images, a `View all media` image, a hero image, and a video thumbnail. The page exposes a `canvas#zoom-panel`, a `next media item` button, a Share button, a Zoom image modal button, and a View video button.

The live page title is `Ascent, Whey Protein Powder, Orange Mango, 20 Servings - Walmart.com`. The product title is visible as `Ascent Clear 100% Whey Protein Powder, Orange Mango, 20 Servings`. The markdown extractor shows Walmart CDN URLs under `i5.walmartimages.com/seo/` and `i5.walmartimages.com/asr/`, with query parameters such as `odnHeight=117`, `odnWidth=117`, and `odnBg=FFFFFF` for thumbnails and `odnHeight=573`, `odnWidth=573` for the hero image.

The page’s gallery is clearly dynamic and includes media controls; a fixed single scrape can miss images that appear after React hydration or after selecting `View all media`. The updated collector should prefer the live product-media subtree, collect `src`, `currentSrc`, `srcset`, and lazy `data-*` attributes, and strip Walmart size parameters before downloading.

The browser saved the full HTML at `/home/ubuntu/browser_html/walmart_com_16307959042_1787215799439.html` for selector-level parsing.

## Sam’s Club supplied product page

The live page loaded successfully and exposes seven product media items in the extracted content. The image URLs use `i5.samsclubimages.com/asr/` and the same Walmart-style query parameters (`odnHeight`, `odnWidth`, `odnBg`). The extracted live content identifies the media as `thumbnail interactive-video image`, followed by thumbnail image 2 through 7, and a separate interactive-video control.

The live page has `next image`, `next media item`, and `Try Interactive Video` controls. It uses a product page route under `/ip/` and renders the gallery dynamically in the main content area. The screenshot shows the primary hero image and a vertical thumbnail rail, while the initial state includes some grey placeholders before images finish loading.

The browser saved the full HTML at `/home/ubuntu/browser_html/samsclub_com_7874202847_1787215859947.html` for selector-level parsing.

## Combined implementation implication

The stable live selectors observed in Walmart/Sam’s Club include `data-testid="vertical-carousel-container"`, `data-testid="vertical-hero-carousel"`, `data-testid="item-page-vertical-carousel-hero-image-button"`, `data-testid="media-thumbnail"`, `data-testid="hero-image"`, `data-testid="hero-image-container"`, `data-testid="zoom-image"`, and `data-testid="zoom-panel"`. The extractor must not depend on `data-testid="product-media"` alone. It should include these vertical-carousel selectors, use all lazy attributes and `srcset`, and rescan after hydration.
