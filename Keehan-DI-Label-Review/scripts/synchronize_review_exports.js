'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function readState(dataFile) {
  const context = {window: {}};
  vm.runInNewContext(fs.readFileSync(dataFile, 'utf8'), context, {filename: dataFile});
  if (!context.window.KEEHN_LABEL_DATA) throw new Error(`No KEEHN_LABEL_DATA found in ${dataFile}`);
  return JSON.parse(JSON.stringify(context.window.KEEHN_LABEL_DATA));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), {recursive: true});
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function run() {
  const [, , dataFile, coreFile, fullBackupFile, trainingExportFile] = process.argv;
  if (!dataFile || !coreFile || !fullBackupFile) {
    throw new Error('Usage: node synchronize_review_exports.js DATA_JS CORE_JS FULL_BACKUP_JSON [TRAINING_JSON]');
  }
  const state = readState(dataFile);
  writeJson(fullBackupFile, state);
  let trainingDocuments = null;
  if (trainingExportFile) {
    const core = require(path.resolve(coreFile));
    const training = core.buildTrainingExport(state, new Date().toISOString());
    writeJson(trainingExportFile, training);
    trainingDocuments = training.documents.length;
  }
  process.stdout.write(`${JSON.stringify({model: state.model, full_backup_documents: state.documents.length, training_documents: trainingDocuments})}\n`);
}

run();
