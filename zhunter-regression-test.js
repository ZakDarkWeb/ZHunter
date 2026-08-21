'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = __dirname;
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const checks = [];
function assert(name, condition) {
  checks.push({ name, pass: !!condition });
  if (!condition) throw new Error(`FAIL: ${name}`);
}
for (const file of ['background.js', 'content.js', 'sidepanel.js', 'popup.js', 'options.js']) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
  assert(`syntax: ${file}`, result.status === 0);
}
const sidepanelHtml = read('sidepanel.html');
const popupHtml = read('popup.html');
const optionsHtml = read('options.html');
const sidepanel = read('sidepanel.js');
const background = read('background.js');
const content = read('content.js');
const cardStart = content.indexOf('shadow.innerHTML = `');
const cardEnd = content.indexOf('document.body.appendChild(_zhunterPageCard)', cardStart);
const cardMarkup = cardStart >= 0 && cardEnd > cardStart ? content.slice(cardStart, cardEnd) : '';
const version = `v${manifest.version}`;
assert('sidepanel version matches manifest', sidepanelHtml.includes(`data-version>${version}`));
assert('popup version matches manifest', popupHtml.includes(`data-version>${version}`));
assert('options version matches manifest', optionsHtml.includes(`data-version>${version}`));
assert('queue-only sidepanel has no Open Tabs view', !sidepanelHtml.includes('id="bulkTabsView"') && !sidepanelHtml.includes('bulkViewTabsBtn'));
assert('queue-only sidepanel has no Master Sheet view', !sidepanelHtml.includes('id="bulkMasterView"') && !sidepanelHtml.includes('bulkViewMasterBtn'));
assert('Product Sheet has the four core fields', background.includes("'Folder Number'") && background.includes("'Product Title'") && background.includes("'Link'") && background.includes("'Sourcing Price'"));
assert('all exports use creation-order folder mapping', background.includes('queueFolderMap') && sidepanel.includes('folderById.get(item.id)'));
assert('shared final green workbook builder exists', sidepanel.includes('function buildFinalProductSheetWorkbook') && sidepanel.includes("const green = '00B050'"));
assert('Master ZIP uses the shared four-column builder', sidepanel.includes('buildFinalProductSheetWorkbook(sheetRows)') && !sidepanel.slice(sidepanel.indexOf('async function downloadProductQueueMasterZip'), sidepanel.indexOf('async function loadProductQueue')).includes('GET_PRODUCT_RESEARCH_WORKBOOK'));
assert('Settings advertises fixed four-column format', optionsHtml.includes('Final export format is fixed') && !optionsHtml.includes('id="customColInput"'));
assert('image card template was found', cardMarkup.length > 0);
assert('image card has no visible title element', !cardMarkup.includes('<div class="title" id="title">'));
assert('image card has no visible price element', !cardMarkup.includes('id="price"'));
assert('image card has no upper count badge', !cardMarkup.includes('id="headCount"'));
assert('image card uses larger four-column grid', cardMarkup.includes('grid-template-columns:repeat(4,1fr)') && cardMarkup.includes('height:48px'));
assert('runtime message authorization exists', background.includes('function isAuthorizedMessage') && background.includes('CONTENT_SCRIPT_ACTIONS'));
assert('processing URL is restricted to HTTP(S)', background.includes('unsupported_processing_url'));
assert('queue progress avoids unconditional full reload', sidepanel.includes('const liveItem = ProductQueueState.items.find'));
console.log(`ZHunter regression checks passed: ${checks.length}`);
