'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function overlap(first, second) {
  const left = Math.max(first[0], second[0]);
  const top = Math.max(first[1], second[1]);
  const right = Math.min(first[2], second[2]);
  const bottom = Math.min(first[3], second[3]);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  const area = Math.max(0, second[2] - second[0]) * Math.max(0, second[3] - second[1]);
  return area > 0 ? intersection / area : 0;
}

function normalizedToken(value) {
  const raw = String(value || '').toLocaleLowerCase();
  const alphanumeric = raw.replace(/[^\p{L}\p{N}]+/gu, '');
  return alphanumeric || raw.replace(/\s+/g, '');
}

function textTokens(value) {
  return String(value || '').trim().split(/\s+/).map(normalizedToken).filter(Boolean);
}

function minimumSubsequenceWindow(needle, haystack) {
  let best = null;
  for (let start = 0; start < haystack.length; start += 1) {
    if (haystack[start] !== needle[0]) continue;
    let needleIndex = 1;
    let end = start;
    while (needleIndex < needle.length && ++end < haystack.length) {
      if (haystack[end] === needle[needleIndex]) needleIndex += 1;
    }
    if (needleIndex !== needle.length) continue;
    const candidate = {start, end};
    if (!best || candidate.end - candidate.start < best.end - best.start) best = candidate;
  }
  return best;
}

function repairCandidate(document, label, fieldType) {
  if (!['reviewer-added', 'reviewer-modified'].includes(label.source)) return null;
  if (fieldType === 'selectionMark') return null;
  const page = (document.pages || []).find(item => item.number === label.page);
  if (!page || !Array.isArray(page.words) || !Array.isArray(label.rect)) return null;
  const words = page.words
    .filter(word => Array.isArray(word.rect) && overlap(label.rect, word.rect) >= 0.5)
    .sort((a, b) => (Number.isFinite(a.order) ? a.order : 0) - (Number.isFinite(b.order) ? b.order : 0));
  const needle = textTokens(label.text);
  const haystack = words.map(word => normalizedToken(word.text));
  if (!needle.length || words.length <= needle.length) return null;
  const window = minimumSubsequenceWindow(needle, haystack);
  if (!window || window.end - window.start + 1 <= needle.length) return null;
  const replacementWords = words.slice(window.start, window.end + 1);
  const replacement = replacementWords.map(word => word.text).join(' ').trim();
  if (!replacement || replacement === String(label.text || '').trim()) return null;
  return {
    file: document.file,
    approved: document.approved === true,
    label_id: label.id,
    field: label.field,
    level: label.level,
    item_index: label.item_index,
    page: label.page,
    source: label.source,
    before: label.text,
    after: replacement,
    inserted_words: replacementWords.length - needle.length,
  };
}

function repairState(state) {
  const fieldTypes = new Map((state.fields || []).map(field => [`${field.level}|${field.name}`, field.field_type || 'string']));
  const changes = [];
  for (const document of state.documents || []) {
    for (const label of document.labels || []) {
      const candidate = repairCandidate(document, label, fieldTypes.get(`${label.level}|${label.field}`));
      if (!candidate) continue;
      label.text = candidate.after;
      changes.push(candidate);
    }
  }
  return changes;
}

function readDataFile(filePath) {
  const context = {window: {}};
  vm.runInNewContext(fs.readFileSync(filePath, 'utf8'), context, {filename: filePath});
  if (!context.window.KEEHN_LABEL_DATA) throw new Error(`No KEEHN_LABEL_DATA found in ${filePath}`);
  return JSON.parse(JSON.stringify(context.window.KEEHN_LABEL_DATA));
}

function writeDataFile(filePath, state) {
  fs.writeFileSync(filePath, `window.KEEHN_LABEL_DATA=${JSON.stringify(state)};\n`, 'utf8');
}

function runCli() {
  const [, , dataFile, auditFile] = process.argv;
  if (!dataFile || !auditFile) throw new Error('Usage: node repair_endpoint_gap_labels.js DATA_JS AUDIT_JSON');
  const state = readDataFile(dataFile);
  const changes = repairState(state);
  state.endpoint_gap_repair = {
    repaired_at: new Date().toISOString(),
    method: 'reviewer endpoint subsequence expanded from overlapping OCR words',
    repaired_labels: changes.length,
    repaired_approved_documents: new Set(changes.filter(item => item.approved).map(item => item.file)).size,
  };
  writeDataFile(dataFile, state);
  fs.mkdirSync(path.dirname(auditFile), {recursive: true});
  fs.writeFileSync(auditFile, `${JSON.stringify({model: state.model, ...state.endpoint_gap_repair, changes}, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(state.endpoint_gap_repair)}\n`);
}

if (require.main === module) runCli();

module.exports = {minimumSubsequenceWindow, normalizedToken, repairCandidate, repairState, textTokens};
