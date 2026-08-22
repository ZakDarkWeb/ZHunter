'use strict';

const PRODUCT_HOST_PATTERNS = [
  'amazon.', 'walmart.com', 'samsclub.com', 'faire.com', 'alibaba.com',
  'aliexpress.', 'temu.', 'ebay.', 'etsy.com', 'daraz.', 'flipkart.com',
  'noon.com', 'shein.com', 'target.com', 'costco.com', 'homedepot.com',
  'bestbuy.com', 'worldwidegolfballs.com', 'worldwidegolfshops.com',
  'worldgolfshop.com', 'golf.com', 'rockbottomgolf.com'
];

function isSupportedProductUrl(str) {
  try {
    const u = new URL(str);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const h = u.hostname.toLowerCase().replace(/^www\./, '');
    return PRODUCT_HOST_PATTERNS.some(pattern =>
      pattern.endsWith('.') ? h.startsWith(pattern) : (h === pattern || h.endsWith('.' + pattern))
    );
  } catch (_) { return false; }
}

function normalizeQueueUrl(raw) {
  try {
    const u = new URL(String(raw || '').trim());
    u.hash = '';
    return u.href;
  } catch (_) { return ''; }
}

const supported = [
  'https://www.amazon.co.uk/dp/ABC123#reviews',
  'https://www.walmart.com/ip/product/123456',
  'https://shop.example.etsy.com/listing/123'
];
const rejected = [
  'https://www.google.com/search?q=product',
  'https://notamazon.com/product',
  'javascript:alert(1)',
  'not a url'
];

for (const url of supported) if (!isSupportedProductUrl(url)) throw new Error(`Expected supported: ${url}`);
for (const url of rejected) if (isSupportedProductUrl(url)) throw new Error(`Expected rejected: ${url}`);
if (normalizeQueueUrl(' https://www.amazon.com/dp/ABC#img ') !== 'https://www.amazon.com/dp/ABC') throw new Error('Hash normalization failed');
console.log('queue logic tests passed');
