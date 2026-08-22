'use strict';

function capAndDedupe(urls) {
  return [...new Set((Array.isArray(urls) ? urls : []).filter(u => /^https?:\/\//i.test(u)))].slice(0, 7);
}

function downloadOne(mockDownloads, url, filename) {
  return new Promise(resolve => {
    mockDownloads.download({ url, filename, saveAs: false, conflictAction: 'uniquify' }, downloadId => {
      const error = mockDownloads.lastError?.message || '';
      resolve(error || !downloadId ? { success: false, error: error || 'download_not_started' } : { success: true, downloadId });
    });
  });
}

(async () => {
  const urls = capAndDedupe(Array.from({ length: 9 }, (_, i) => `https://cdn.example.com/image-${i}.jpg`).concat('https://cdn.example.com/image-0.jpg'));
  if (urls.length !== 7) throw new Error(`Expected 7 URLs, got ${urls.length}`);

  const successApi = { lastError: null, download: (_opts, callback) => callback(101) };
  const success = await downloadOne(successApi, urls[0], 'ZHunter/product/01.jpg');
  if (!success.success || success.downloadId !== 101) throw new Error('Successful download callback was not recognized');

  const failureApi = { lastError: { message: 'Download failed in test' }, download: (_opts, callback) => callback(undefined) };
  const failure = await downloadOne(failureApi, urls[0], 'ZHunter/product/01.jpg');
  if (failure.success || failure.error !== 'Download failed in test') throw new Error('Download error callback was not surfaced');

  console.log('image download tests passed');
})();
