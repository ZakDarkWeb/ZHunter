from pathlib import Path
import json
import re
from bs4 import BeautifulSoup

for path in sorted(Path('.').glob('*.html')):
    html = path.read_text(errors='ignore')
    soup = BeautifulSoup(html, 'html.parser')
    print(f'=== {path.name} ===')
    print('bytes', len(html), 'title', (soup.title.get_text(' ', strip=True) if soup.title else ''))
    print('images', len(soup.find_all('img')), 'scripts', len(soup.find_all('script')), 'jsonld', len(soup.select('script[type="application/ld+json"]')))
    selectors = [
        '#landingImage', '#imgTagWrapperId img', '#altImages img', '[data-a-dynamic-image]',
        '[data-testid*="product"]', '[data-testid*="image"]', '[class*="product-image"]',
        '[class*="ProductImage"]', '[class*="gallery"]', '[class*="Gallery"]',
        '[data-image-url]', '[data-src]', '[data-lazy-src]', '[srcset]'
    ]
    for sel in selectors:
        try:
            n = len(soup.select(sel))
        except Exception:
            n = 0
        if n:
            print('selector', sel, n)
    attrs = {}
    samples = []
    for img in soup.find_all('img'):
        for attr in ('src', 'data-src', 'data-lazy-src', 'data-old-hires', 'srcset', 'data-image-url', 'data-image'):
            val = img.get(attr)
            if val:
                attrs[attr] = attrs.get(attr, 0) + 1
                if len(samples) < 12:
                    samples.append((attr, val[:500]))
    print('image attrs', attrs)
    for attr, val in samples:
        print('sample', attr, val)
    text = html.lower()
    for marker in ('mediaurl', 'imageurl', 'imagegallery', 'productimages', 'imagegallerydata', 'athena', 'media', 'lazy'):
        count = text.count(marker)
        if count:
            print('marker', marker, count)
    print()
