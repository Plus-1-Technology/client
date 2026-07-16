(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KeehnCheckpointClient = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function checkpointError(code, message, status) {
    const error = new Error(message || code);
    error.code = code;
    error.status = status || 0;
    return error;
  }

  function buildCheckpoint(model, autosave) {
    if (!autosave || typeof autosave !== 'object') {
      throw checkpointError('autosave_required', 'No locally saved review data is available.');
    }
    return {
      model: String(model || ''),
      snapshot_id: String(autosave.snapshot_id || ''),
      saved_at: String(autosave.saved_at || new Date().toISOString()),
      reviewer_fields: Array.isArray(autosave.reviewer_fields) ? autosave.reviewer_fields : [],
      documents: autosave.documents && typeof autosave.documents === 'object' ? autosave.documents : {},
    };
  }

  async function saveCheckpoint(options) {
    const fetchImpl = options.fetchImpl;

    let response;
    try {
      response = await fetchImpl(options.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(buildCheckpoint(options.model, options.autosave)),
      });
    } catch (error) {
      throw checkpointError('network_error', `GitHub save could not reach the server: ${error.message}`);
    }

    let payload = {};
    try { payload = await response.json(); } catch (error) { payload = {}; }
    if (!response.ok) {
      throw checkpointError(
        payload.status || `http_${response.status}`,
        payload.message || `GitHub save failed with HTTP ${response.status}.`,
        response.status
      );
    }
    return payload;
  }

  return { buildCheckpoint, saveCheckpoint };
});
