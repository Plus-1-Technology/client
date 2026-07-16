'use strict';

const assert = require('assert');
const path = require('path');

const client = require(path.resolve(__dirname, '..', 'shared', 'checkpoint_client.js'));

const autosave = {
  snapshot_id: 'db6f99eb1d694ddd7b0c498a371b4d19016eb9eb5b5f904838e1281a39e29e71',
  saved_at: '2026-07-16T16:00:00Z',
  reviewer_fields: [{level: 'Document', name: 'Route', sources: ['reviewer_added'], field_type: 'string'}],
  documents: {
    'sample.pdf': {
      labels: [{id: 'reviewer-1', field: 'Route', level: 'Document', item_index: null, page: 1, text: 'OUR DELIVERY', rect: [0.1, 0.1, 0.3, 0.2]}],
      approved: true,
      approved_at: '2026-07-16T16:00:00Z',
      notes: 'reviewed',
    },
  },
};

const payload = client.buildCheckpoint('purchase_order', autosave);
assert.strictEqual(payload.model, 'purchase_order');
assert.strictEqual(payload.snapshot_id, autosave.snapshot_id);
assert.deepStrictEqual(payload.documents, autosave.documents);
assert.strictEqual(Object.prototype.hasOwnProperty.call(payload, 'pages'), false);
assert.strictEqual(JSON.stringify(payload).includes('ocr'), false);

for (const htmlPath of [
  ['packing-slip', 'Label-Review-packing_slip_list.html'],
  ['purchase-order', 'Label-Review-purchase_order.html'],
  ['purchase-order', 'Label-Review-purchase_order-received_status.html'],
  ['vendor-invoice', 'Label-Review-vendor_invoice.html'],
]) {
  const html = require('fs').readFileSync(path.resolve(__dirname, '..', ...htmlPath), 'utf8');
  assert(html.includes('id="save-github"'), `${htmlPath.join('/')}: Save to GitHub button is required`);
  assert(html.includes('../shared/checkpoint_client.js'), `${htmlPath.join('/')}: checkpoint client script is required`);
}

for (const folder of ['packing-slip', 'purchase-order', 'vendor-invoice']) {
  const app = require('fs').readFileSync(path.resolve(__dirname, '..', folder, 'editor', 'label_editor_app.js'), 'utf8');
  assert(app.includes("$('save-github').addEventListener('click', saveToGitHub)"), `${folder}: save button must be wired`);
  assert(!app.includes('promptForKey'), `${folder}: team members must not be prompted for a key`);
  assert(!app.includes('sessionStorage'), `${folder}: no browser credential storage is allowed`);
  assert(app.includes('GitHub save failed: ${detail}'), `${folder}: the persistent status must show the exact save error`);
}

let sentRequest = null;
const fetchImpl = async (url, options) => {
  sentRequest = {url, options};
  return {
    ok: true,
    status: 200,
    json: async () => ({status: 'saved', commit_sha: '1234567890abcdef', saved_at: '2026-07-16T16:01:00Z'}),
  };
};

(async () => {
  const result = await client.saveCheckpoint({
    endpoint: 'https://example.test/api/label-review-checkpoint',
    model: 'purchase_order',
    autosave,
    fetchImpl,
  });
  assert.strictEqual(result.status, 'saved');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(sentRequest.options.headers, 'x-functions-key'), false);
  assert.strictEqual(JSON.parse(sentRequest.options.body).snapshot_id, autosave.snapshot_id);

  console.log('checkpoint_client: all assertions passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
