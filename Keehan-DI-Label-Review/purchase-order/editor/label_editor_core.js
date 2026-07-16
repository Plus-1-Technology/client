(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KeehnLabelCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function overlap(first, second) {
    const left = Math.max(first[0], second[0]);
    const top = Math.max(first[1], second[1]);
    const right = Math.min(first[2], second[2]);
    const bottom = Math.min(first[3], second[3]);
    const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
    const area = Math.max(0, second[2] - second[0]) * Math.max(0, second[3] - second[1]);
    return area > 0 ? intersection / area : 0;
  }

  function readingOrder(words) {
    return [...words].sort((a, b) => {
      const aOrder = Number.isFinite(a.order) ? a.order : null;
      const bOrder = Number.isFinite(b.order) ? b.order : null;
      if (aOrder !== null && bOrder !== null && aOrder !== bOrder) return aOrder - bOrder;
      const y = a.rect[1] - b.rect[1];
      if (Math.abs(y) > 0.01) return y;
      return a.rect[0] - b.rect[0];
    });
  }

  function wordsInRect(words, rect) {
    return readingOrder(words.filter(word => overlap(rect, word.rect) > 0));
  }

  function toggleWordSelection(selectedWords, wordIndex) {
    const selected = Array.isArray(selectedWords) ? [...selectedWords] : [];
    return selected.includes(wordIndex)
      ? selected.filter(index => index !== wordIndex)
      : [...selected, wordIndex];
  }

  function wordRangeSelection(words, anchorIndex, targetIndex) {
    const pageWords = Array.isArray(words) ? words : [];
    if (!Number.isInteger(anchorIndex) || !Number.isInteger(targetIndex)) return [];
    const anchor = pageWords[anchorIndex];
    const target = pageWords[targetIndex];
    if (!anchor || !target || !Array.isArray(anchor.rect) || !Array.isArray(target.rect)) return [];
    const rect = [
      Math.min(anchor.rect[0], target.rect[0]),
      Math.min(anchor.rect[1], target.rect[1]),
      Math.max(anchor.rect[2], target.rect[2]),
      Math.max(anchor.rect[3], target.rect[3]),
    ];
    return wordsInRect(pageWords, rect)
      .map(word => pageWords.indexOf(word))
      .filter(index => index >= 0);
  }

  function createReviewerField(fields, name, level) {
    const current = Array.isArray(fields) ? [...fields] : [];
    const trimmed = String(name || '').trim();
    if (!trimmed) {
      return { valid: false, code: 'field_name_required', field: null, fields: current, added: false };
    }
    if (!['Document', 'Line'].includes(level)) {
      return { valid: false, code: 'field_level_invalid', field: null, fields: current, added: false };
    }
    const existing = current.find(field =>
      field.level === level && String(field.name || '').toLocaleLowerCase() === trimmed.toLocaleLowerCase()
    );
    if (existing) {
      return { valid: true, code: 'existing_field', field: existing, fields: current, added: false };
    }
    const field = {
      level,
      name: trimmed,
      sources: ['reviewer_added'],
      field_type: 'string',
    };
    return { valid: true, code: 'created', field, fields: [...current, field], added: true };
  }

  const QUANTITY_FIELD_RENAMES = Object.freeze({
    'Order Quanity': 'Order Quantity',
    'Quanity Invoiced': 'Quantity Invoiced',
    'Order Quanitiy': 'Order Quantity',
  });

  function canonicalQuantityName(name) {
    return QUANTITY_FIELD_RENAMES[name] || name;
  }

  function canonicalizeQuantityFields(input) {
    const state = clone(input);
    const fields = [];
    (state.fields || []).forEach(sourceField => {
      const field = {...sourceField, name: canonicalQuantityName(sourceField.name)};
      const existing = fields.find(item => item.level === field.level && item.name === field.name);
      if (!existing) {
        fields.push(field);
        return;
      }
      existing.sources = [...new Set([...(existing.sources || []), ...(field.sources || [])])];
      if (!existing.field_type && field.field_type) existing.field_type = field.field_type;
    });
    state.fields = fields;

    (state.documents || []).forEach(document => {
      ['labels', 'suggestions', 'excluded'].forEach(collectionName => {
        (document[collectionName] || []).forEach(item => {
          const originalName = item.field;
          const canonicalName = canonicalQuantityName(originalName);
          if (canonicalName === originalName) return;
          if (!item.original_label) item.original_label = originalName;
          item.field = canonicalName;
        });
      });
    });
    return state;
  }

  function validateLabel(label, fieldType) {
    if (!label || !String(label.field || '').trim()) return { valid: false, code: 'field_required' };
    if (!['Document', 'Line'].includes(label.level)) return { valid: false, code: 'level_invalid' };
    if (!Array.isArray(label.rect) || label.rect.length !== 4 || label.rect.some(value => !Number.isFinite(value))) {
      return { valid: false, code: 'region_invalid' };
    }
    if (label.rect[2] <= label.rect[0] || label.rect[3] <= label.rect[1]) {
      return { valid: false, code: 'region_invalid' };
    }
    if (fieldType !== 'selectionMark' && !String(label.text || '').trim()) {
      return { valid: false, code: 'text_required' };
    }
    if (label.level === 'Line' && (!Number.isInteger(label.item_index) || label.item_index < 0)) {
      return { valid: false, code: 'line_index_required' };
    }
    if (label.level === 'Document' && label.item_index !== null && label.item_index !== undefined) {
      return { valid: false, code: 'document_cannot_have_line_index' };
    }
    return { valid: true, code: 'ok' };
  }

  function autosaveKey(model, snapshotId) {
    return `keehn-label-editor:v3:${model}:${snapshotId}`;
  }

  function fieldToken(field) {
    return `${field.level} - ${field.name}`;
  }

  function fieldFromToken(fields, token) {
    const exact = fields.filter(field => fieldToken(field) === token);
    if (exact.length === 1) return exact[0];
    const byName = fields.filter(field => field.name === token);
    return byName.length === 1 ? byName[0] : null;
  }

  function buildFieldInventory(fields, labels, suggestions) {
    const saved = Array.isArray(labels) ? labels : [];
    const proposed = Array.isArray(suggestions) ? suggestions : [];
    return (Array.isArray(fields) ? fields : []).map(field => {
      const matches = item => item.level === field.level && item.field === field.name;
      const savedMatches = saved.filter(matches);
      const suggestionMatches = proposed.filter(matches);
      const lineRows = [...savedMatches, ...suggestionMatches]
        .filter(item => field.level === 'Line' && Number.isInteger(item.item_index) && item.item_index >= 0)
        .map(item => item.item_index + 1)
        .filter((row, index, rows) => rows.indexOf(row) === index)
        .sort((a, b) => a - b);
      return {
        name: field.name,
        level: field.level,
        sources: [...(field.sources || [])],
        saved_count: savedMatches.length,
        suggestion_count: suggestionMatches.length,
        status: savedMatches.length ? 'saved' : suggestionMatches.length ? 'suggested' : 'open',
        line_rows: lineRows,
      };
    });
  }

  function mergeAutosave(baseline, saved) {
    const state = clone(baseline);
    if (!saved || saved.snapshot_id !== baseline.snapshot_id) {
      return { applied: false, reason: 'snapshot_mismatch', state: canonicalizeQuantityFields(state) };
    }
    if (Array.isArray(saved.reviewer_fields)) {
      saved.reviewer_fields.forEach(field => {
        if (!field || !Array.isArray(field.sources) || !field.sources.includes('reviewer_added')) return;
        const result = createReviewerField(state.fields, field.name, field.level);
        if (result.valid) state.fields = result.fields;
      });
    }
    const changes = saved.documents || {};
    state.documents.forEach(document => {
      const update = changes[document.file];
      if (!update) return;
      if (Array.isArray(update.labels)) {
        const baselineLabels = new Map((document.labels || []).map(label => [label.id, label]));
        const deletedBaselineIds = new Set(update.deleted_baseline_label_ids || []);
        const quarantinedIds = new Set(
          (document.quarantined_labels || []).map(item => item && item.label && item.label.id).filter(Boolean)
        );
        document.labels = clone(update.labels)
          .filter(label => !quarantinedIds.has(label.id))
          .map(label => {
            const repaired = baselineLabels.get(label.id);
            return repaired && repaired.source === 'reviewer-repaired-from-ocr' && !String(label.text || '').trim()
              ? clone(repaired)
              : label;
          });
        const restoredIds = new Set(document.labels.map(label => label.id));
        baselineLabels.forEach(label => {
          if (label.source !== 'reviewer-promoted-existing-field') return;
          if (restoredIds.has(label.id) || deletedBaselineIds.has(label.id)) return;
          document.labels.push(clone(label));
        });
      }
      if (typeof update.approved === 'boolean') document.approved = update.approved;
      if (typeof update.approved_at === 'string' || update.approved_at === null) {
        document.approved_at = update.approved_at;
      }
      if (typeof update.notes === 'string') document.notes = update.notes;
      if (Array.isArray(update.dismissed_suggestion_ids)) {
        const dismissed = new Set(update.dismissed_suggestion_ids);
        document.suggestions = (document.suggestions || []).filter(suggestion => !dismissed.has(suggestion.id));
      }
    });
    return { applied: true, reason: 'restored', state: canonicalizeQuantityFields(state) };
  }

  function buildExport(state, exportedAt) {
    const output = canonicalizeQuantityFields(state);
    const fieldTypes = new Map(
      (output.fields || []).map(field => [fieldToken(field), field.field_type || 'string'])
    );
    output.exported_at = exportedAt || new Date().toISOString();
    output.export_version = 3;
    output.documents.forEach(document => {
      delete document.deleted_azure_labels;
      document.validation = (document.labels || []).map(label => ({
        id: label.id,
        ...validateLabel(label, fieldTypes.get(fieldToken({name: label.field, level: label.level}))),
      }));
    });
    return output;
  }

  function buildTrainingExport(state, exportedAt) {
    const canonical = canonicalizeQuantityFields(state);
    const sourceDocuments = canonical.documents || [];
    const approved = sourceDocuments.filter(document => document.approved === true);
    const included = approved.filter(document => Array.isArray(document.labels) && document.labels.length > 0);
    const usedFields = new Set(
      included.flatMap(document => document.labels.map(label => fieldToken({name: label.field, level: label.level})))
    );
    const fields = (canonical.fields || []).filter(field => usedFields.has(fieldToken(field)));
    const documents = included.map(document => ({
      file: document.file,
      approved: true,
      approved_at: document.approved_at || null,
      notes: document.notes || '',
      labels: clone(document.labels),
      source_artifacts: clone(document.source_artifacts || {}),
    }));
    return {
      model: canonical.model,
      title: canonical.title,
      snapshot_id: canonical.snapshot_id,
      fields,
      documents,
      exported_at: exportedAt || new Date().toISOString(),
      export_version: 3,
      export_scope: 'approved_training_only',
      summary: {
        source_documents: sourceDocuments.length,
        included_documents: documents.length,
        excluded_unapproved_documents: sourceDocuments.length - approved.length,
        excluded_unlabeled_documents: approved.length - included.length,
        included_label_regions: documents.reduce((total, document) => total + document.labels.length, 0),
        included_fields: fields.length,
      },
    };
  }

  return {
    autosaveKey,
    buildFieldInventory,
    buildExport,
    buildTrainingExport,
    canonicalizeQuantityFields,
    createReviewerField,
    fieldFromToken,
    fieldToken,
    mergeAutosave,
    readingOrder,
    toggleWordSelection,
    validateLabel,
    wordRangeSelection,
    wordsInRect,
  };
});
