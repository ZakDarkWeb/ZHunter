from pathlib import Path
from urllib.parse import urljoin, urlsplit, urlunsplit
from bs4 import BeautifulSoup

fixtures = {
    'walmart': Path('/home/ubuntu/browser_html/walmart_com_16307959042_1787215799439.html'),
    'samsclub': Path('/home/ubuntu/browser_html/samsclub_com_7874202847_1787215859947.html'),
}

selectors = [
    '[data-testid="vertical-carousel-container"]',
    '[data-testid="vertical-hero-carousel"]',
    '[data-testid="hero-image-container"]',
    '[data-testid="item-page-vertical-carousel-hero-image-button"]',
    '[data-testid="media-thumbnail"]',
    '[data-testid="zoom-image"]',
    '[data-testid="zoom-panel"]',
    '[data-automation-id="product-media"]',
    '[data-testid="product-media"]',
    '[class*="prod-hero"]',
    '[class*="product-media"]',
    '[class*="ProductMedia"]',
    '[class*="gallery"]',
    '[class*="Gallery"]',
    'main',
]

attrs = ('data-old-hires', 'data-zoom-image', 'data-image-url', 'data-image-src', 'data-large-image', 'data-src', 'data-lazy-src', 'data-original', 'src')

for name, path in fixtures.items():
    html = path.read_text(errors='ignore')
    soup = BeautifulSoup(html, 'html.parser')
    scopes = []
    for selector in selectors:
        scopes.extend(soup.select(selector))
    elements = set()
    for scope in scopes:
        elements.update(scope.select('img, source, [data-image-url], [data-image-src], [data-zoom-image], [data-src], [data-lazy-src]'))
    urls = set()
    for el in elements:
        for attr in attrs:
            raw = el.get(attr)
            if raw and (raw.startswith('http') or raw.startswith('//')):
                urls.add(urljoin('https://example.com', raw).split('?')[0])
        srcset = el.get('srcset') or el.get('data-srcset') or ''
        for part in srcset.split(','):
            raw = part.strip().split()[0] if part.strip() else ''
            if raw and (raw.startswith('http') or raw.startswith('//')):
                urls.add(urljoin('https://example.com', raw).split('?')[0])
    product_urls = [u for u in urls if ('walmartimages.com/seo/' in u or 'walmartimages.com/asr/' in u or 'samsclubimages.com/asr/' in u)]
    print(name, 'candidate_product_images=', len(product_urls))
    if len(product_urls) < 2:
        raise SystemExit(f'{name}: expected at least two product image candidates')

print('marketplace DOM fixture tests passed')
