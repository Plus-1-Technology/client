'use strict';

const assert = require('assert');
const path = require('path');

const words = [
  {text: 'WHEN', rect: [0.05, 0.2, 0.12, 0.23], order: 0},
  {text: 'DELIVERING', rect: [0.13, 0.2, 0.25, 0.23], order: 1},
  {text: 'TO', rect: [0.26, 0.2, 0.29, 0.23], order: 2},
  {text: 'THE', rect: [0.30, 0.2, 0.34, 0.23], order: 3},
  {text: 'SOUTH', rect: [0.35, 0.2, 0.41, 0.23], order: 4},
  {text: 'IN', rect: [0.42, 0.2, 0.45, 0.23], order: 5},
];

for (const folder of ['packing-slip', 'purchase-order', 'vendor-invoice']) {
  const core = require(path.resolve(__dirname, '..', folder, 'editor', 'label_editor_core.js'));
  assert.deepStrictEqual(core.wordRangeSelection(words, 0, 5), [0, 1, 2, 3, 4, 5], folder);
  assert.deepStrictEqual(
    core.completeWordSelection(words, [], 0, 5),
    [0, 1, 2, 3, 4, 5],
    `${folder}: a mouse drag must capture every OCR word between its endpoints`
  );
  assert.deepStrictEqual(
    core.completeWordSelection(words, [], 0, 0),
    [0],
    `${folder}: an ordinary click must still select one OCR word`
  );
  assert.deepStrictEqual(
    core.completeWordSelection(words, [0], 5, 5),
    [0, 1, 2, 3, 4, 5],
    `${folder}: two separate endpoint clicks must still capture the full range`
  );
  assert.strictEqual(core.pageIndexAfterTurn(0, 3, -1), 0, `${folder}: previous page must clamp at page one`);
  assert.strictEqual(core.pageIndexAfterTurn(0, 3, 1), 1, `${folder}: next page must advance one page`);
  assert.strictEqual(core.pageIndexAfterTurn(2, 3, 1), 2, `${folder}: next page must clamp at the final page`);
  const app = require('fs').readFileSync(path.resolve(__dirname, '..', folder, 'editor', 'label_editor_app.js'), 'utf8');
  assert(app.includes("button.addEventListener('pointerdown'"), `${folder}: word gestures must record their starting word`);
  assert(app.includes('core.completeWordSelection(currentPage().words, selectedWords, wordGestureAnchor, index)'), `${folder}: word gestures must capture their full range`);
  assert(app.includes("if (mode === 'area') return;"), `${folder}: area selection must not reopen a covered label`);
  assert(app.includes("$('prev-page').addEventListener('click'"), `${folder}: previous-page control must be wired`);
  assert(app.includes("$('next-page').addEventListener('click'"), `${folder}: next-page control must be wired`);
  const css = require('fs').readFileSync(path.resolve(__dirname, '..', 'shared', 'selection_layer_order.css'), 'utf8');
  assert(/#label-layer\s*{\s*z-index:\s*2/.test(css), `${folder}: saved labels must remain visible below selectable OCR words`);
  assert(/#word-layer\s*{\s*z-index:\s*3/.test(css), `${folder}: OCR words must receive drag gestures above saved labels`);
}

for (const htmlPath of [
  ['packing-slip', 'Label-Review-packing_slip_list.html'],
  ['purchase-order', 'Label-Review-purchase_order.html'],
  ['purchase-order', 'Label-Review-purchase_order-received_status.html'],
  ['vendor-invoice', 'Label-Review-vendor_invoice.html'],
]) {
  const html = require('fs').readFileSync(path.resolve(__dirname, '..', ...htmlPath), 'utf8');
  assert(html.includes('id="prev-page"'), `${htmlPath.join('/')}: previous-page button is required`);
  assert(html.includes('id="page-position"'), `${htmlPath.join('/')}: current page indicator is required`);
  assert(html.includes('id="next-page"'), `${htmlPath.join('/')}: next-page button is required`);
}

console.log('live_editor_word_range: all assertions passed');
