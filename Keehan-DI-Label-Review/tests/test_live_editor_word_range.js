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
  const app = require('fs').readFileSync(path.resolve(__dirname, '..', folder, 'editor', 'label_editor_app.js'), 'utf8');
  assert(app.includes('core.wordRangeSelection(currentPage().words, selectedWords[0], index)'), folder);
}

console.log('live_editor_word_range: all assertions passed');
