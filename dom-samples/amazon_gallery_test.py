from pathlib import Path
from bs4 import BeautifulSoup
import json, re

expected = {'amazon-sweatpants.html': 5, 'amazon-hydro.html': 7}

def canonical(url):
    return re.sub(r'\._[A-Z0-9_,]+_\.', '.', url.split('?')[0], flags=re.I).lower()

BASE = Path(__file__).parent
for name, expected_count in expected.items():
    soup = BeautifulSoup((BASE / name).read_text(errors='ignore'), 'html.parser')
    urls = []
    for img in soup.select('#landingImage, #imgTagWrapperId img, #altImages img, .a-button-thumbnail img, .imageThumbnail img'):
        candidates = [img.get('data-old-hires', ''), img.get('data-zoom-image', ''), img.get('data-large-image', ''), img.get('src', ''), img.get('data-src', '')]
        raw = img.get('data-a-dynamic-image')
        if raw:
            try:
                candidates.extend(json.loads(raw).keys())
            except Exception:
                pass
        for value in candidates:
            if not value or '/images/I/' not in value or re.search(r'play[-_]?button|video[-_]?thumbnail|pkplay', value, re.I):
                continue
            urls.append(value)
    unique = {canonical(url) for url in urls}
    print(name, 'unique_gallery_images=', len(unique))
    if len(unique) != expected_count:
        raise SystemExit(f'{name}: expected {expected_count}, got {len(unique)}')
print('Amazon gallery regression tests passed')
