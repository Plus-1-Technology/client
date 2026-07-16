'use strict';

const assert = require('assert');
const {repairCandidate, repairState} = require('../scripts/repair_endpoint_gap_labels.js');

const words = ['WHEN', 'DELIVERING', 'TO', 'THE', 'SOUTH', 'SHOP,', 'DRIVER', 'MUST', 'BACK', 'IN']
  .map((text, index) => ({text, order: index, rect: [0.05 + index * 0.07, 0.2, 0.11 + index * 0.07, 0.23]}));
const document = {file: 'example.pdf', approved: true, pages: [{number: 1, words}]};
const incomplete = {
  id: 'reviewer-1', field: 'Document Typed Notes', level: 'Document', item_index: null,
  page: 1, text: 'WHEN IN', rect: [0.05, 0.2, 0.74, 0.23], source: 'reviewer-added',
};
const candidate = repairCandidate(document, incomplete, 'string');
assert(candidate);
assert.strictEqual(candidate.before, 'WHEN IN');
assert.strictEqual(candidate.after, 'WHEN DELIVERING TO THE SOUTH SHOP, DRIVER MUST BACK IN');
assert.strictEqual(candidate.approved, true);

const punctuationWords = ['Prepay', '&', 'Add'].map((text, index) => ({
  text, order: index, rect: [0.1 + index * 0.1, 0.3, 0.18 + index * 0.1, 0.33],
}));
const punctuationDoc = {file: 'punctuation.pdf', approved: false, pages: [{number: 1, words: punctuationWords}]};
const punctuationLabel = {
  id: 'reviewer-2', field: 'Freight Terms', level: 'Document', item_index: null,
  page: 1, text: 'Prepay Add', rect: [0.1, 0.3, 0.38, 0.33], source: 'reviewer-added',
};
assert.strictEqual(repairCandidate(punctuationDoc, punctuationLabel, 'string').after, 'Prepay & Add');
assert.strictEqual(repairCandidate(document, {...incomplete, source: 'azure-saved'}, 'string'), null);
assert.strictEqual(repairCandidate(document, {...incomplete, field: 'ReceivedStatus'}, 'selectionMark'), null);
assert.strictEqual(repairCandidate(document, {...incomplete, text: candidate.after}, 'string'), null);

const state = {
  fields: [{level: 'Document', name: 'Document Typed Notes', field_type: 'string'}],
  documents: [{...document, labels: [{...incomplete}]}],
};
const changes = repairState(state);
assert.strictEqual(changes.length, 1);
assert.strictEqual(state.documents[0].labels[0].text, candidate.after);

console.log('repair_endpoint_gap_labels: all assertions passed');
