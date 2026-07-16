(function () {
  'use strict';
  const core = window.KeehnLabelCore;
  const checkpointClient = window.KeehnCheckpointClient;
  const checkpointEndpoint = 'https://func-ksc-di-prod.azurewebsites.net/api/label-review-checkpoint';
  const baseline = JSON.parse(JSON.stringify(window.KEEHN_LABEL_DATA));
  const key = core.autosaveKey(baseline.model, baseline.snapshot_id);
  let state = restore();
  let documentIndex = 0;
  let pageIndex = 0;
  let mode = 'word';
  let zoom = 1;
  let selectedWords = [];
  let wordGestureAnchor = null;
  let draft = null;
  let activeLabelId = null;
  let editing = false;
  let drawStart = null;
  let drawGhost = null;
  let labelsPanelMode = 'all';
  let fieldInventorySearch = '';
  let fieldInventoryLevel = 'All';
  let queuedFieldToken = null;
  const layerState = { azure: true, suggestions: true, words: false };

  const $ = id => document.getElementById(id);
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const currentDocument = () => state.documents[documentIndex];
  const currentPage = () => currentDocument().pages[pageIndex];

  function restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(key) || 'null');
      return core.mergeAutosave(baseline, saved).state;
    } catch (error) {
      setTimeout(() => toast(`Local autosave unavailable: ${error.message}`), 0);
      return JSON.parse(JSON.stringify(baseline));
    }
  }

  function saveLocal() {
    const documents = {};
    const reviewer_fields = state.fields.filter(field => Array.isArray(field.sources) && field.sources.includes('reviewer_added'));
    state.documents.forEach(doc => {
      const baselineDocument = baseline.documents.find(item => item.file === doc.file);
      const currentSuggestionIds = new Set((doc.suggestions || []).map(suggestion => suggestion.id));
      const currentLabelIds = new Set((doc.labels || []).map(label => label.id));
      const dismissed_suggestion_ids = (baselineDocument?.suggestions || [])
        .filter(suggestion => !currentSuggestionIds.has(suggestion.id))
        .map(suggestion => suggestion.id);
      const deleted_baseline_label_ids = (baselineDocument?.labels || [])
        .filter(label => !currentLabelIds.has(label.id))
        .map(label => label.id);
      const update = {};
      if (JSON.stringify(doc.labels || []) !== JSON.stringify(baselineDocument?.labels || [])) {
        update.labels = doc.labels;
        update.deleted_baseline_label_ids = deleted_baseline_label_ids;
      }
      if (!!doc.approved !== !!baselineDocument?.approved) {
        update.approved = !!doc.approved;
        update.approved_at = doc.approved_at || null;
      }
      if ((doc.notes || '') !== (baselineDocument?.notes || '')) update.notes = doc.notes || '';
      if (dismissed_suggestion_ids.length) update.dismissed_suggestion_ids = dismissed_suggestion_ids;
      if (Object.keys(update).length) documents[doc.file] = update;
    });
    try {
      const savedAt = new Date().toISOString();
      localStorage.setItem(key, JSON.stringify({snapshot_id: state.snapshot_id, saved_at: savedAt, reviewer_fields, documents}));
      $('save-status').textContent = `Saved locally ${new Date(savedAt).toLocaleTimeString()}`;
    } catch (error) {
      $('save-status').textContent = 'Autosave failed - export now';
      toast(`Autosave failed: ${error.message}`);
    }
  }

  function toast(message) {
    const node = $('toast');
    if (!node) return;
    node.textContent = message;
    node.classList.add('show');
    clearTimeout(node._timer);
    node._timer = setTimeout(() => node.classList.remove('show'), 3200);
  }

  function fieldForName(name) { return core.fieldFromToken(state.fields, name); }

  function validateEditorLabel(label) {
    const fieldSpec = state.fields.find(field => field.name === label.field && field.level === label.level);
    return core.validateLabel(label, fieldSpec ? fieldSpec.field_type : undefined);
  }

  function rectStyle(rect) {
    return `left:${rect[0]*100}%;top:${rect[1]*100}%;width:${(rect[2]-rect[0])*100}%;height:${(rect[3]-rect[1])*100}%`;
  }

  function render() {
    renderHeader();
    renderDocumentList();
    renderPageTabs();
    renderPage();
    renderReview();
  }

  function renderHeader() {
    const doc = currentDocument();
    $('source-status').textContent = `Read-only Azure snapshot ${state.snapshot_id.slice(0,12)} | ${state.documents.length} documents | no DI calls`;
    $('document-position').textContent = `DOCUMENT ${documentIndex + 1} OF ${state.documents.length}`;
    $('document-title').textContent = doc.vendor ? `${doc.vendor} - ${doc.file}` : doc.file;
    $('document-metrics').innerHTML = [
      `${doc.pages.length} page${doc.pages.length === 1 ? '' : 's'}`,
      `${doc.labels.length} saved/reviewer labels`,
      `${doc.suggestions.length} suggestions`,
      `${(doc.quarantined_labels || []).length} quarantined label evidence needs manual review`,
      `${(doc.errors || []).length} errors`,
    ].map(value => `<span class="metric">${esc(value)}</span>`).join('');
    $('prev-doc').disabled = documentIndex === 0;
    $('next-doc').disabled = documentIndex >= state.documents.length - 1;
  }

  function renderDocumentList() {
    const query = $('document-search').value.trim().toLowerCase();
    const visible = state.documents.map((doc, index) => ({doc,index})).filter(({doc}) => !query || `${doc.vendor || ''} ${doc.file}`.toLowerCase().includes(query));
    $('document-count').textContent = `${visible.length} of ${state.documents.length} documents`;
    $('document-list').innerHTML = visible.map(({doc,index}) => `<button class="document-button ${index===documentIndex?'active':''} ${doc.approved?'approved':''}" data-doc-index="${index}"><strong>${esc(doc.vendor || doc.file)}</strong><small>${esc(doc.file)} | ${doc.labels.length} labels | ${doc.suggestions.length} suggestions</small></button>`).join('') || '<div class="empty">No matching documents</div>';
    $('document-list').querySelectorAll('[data-doc-index]').forEach(button => button.addEventListener('click', () => openDocument(Number(button.dataset.docIndex))));
  }

  function renderPageTabs() {
    const doc = currentDocument();
    $('page-tabs').innerHTML = doc.pages.map((page,index) => `<button class="page-tab ${index===pageIndex?'active':''}" data-page-index="${index}">Page ${page.number}</button>`).join('');
    $('page-tabs').querySelectorAll('[data-page-index]').forEach(button => button.addEventListener('click', () => { pageIndex = Number(button.dataset.pageIndex); clearSelection(); render(); }));
    $('page-position').textContent = `Page ${pageIndex + 1} of ${doc.pages.length}`;
    $('prev-page').disabled = pageIndex === 0;
    $('next-page').disabled = pageIndex >= doc.pages.length - 1;
  }

  function turnPage(direction) {
    pageIndex = core.pageIndexAfterTurn(pageIndex, currentDocument().pages.length, direction);
    clearSelection();
    render();
    $('page-scroll').scrollTop = 0;
  }

  function renderPage() {
    const doc = currentDocument();
    const page = currentPage();
    const stage = $('page-stage');
    $('page-image').src = page.img;
    $('page-image').onload = () => {
      stage.style.width = `${$('page-image').naturalWidth * zoom}px`;
      stage.style.height = `${$('page-image').naturalHeight * zoom}px`;
      $('page-image').style.width = `${$('page-image').naturalWidth * zoom}px`;
    };
    if ($('page-image').complete && $('page-image').naturalWidth) $('page-image').onload();
    $('zoom-value').textContent = `${Math.round(zoom*100)}%`;
    $('mode-word').classList.toggle('active', mode === 'word');
    $('mode-area').classList.toggle('active', mode === 'area');
    $('word-layer').innerHTML = layerState.words || mode === 'word' ? page.words.map((word,index) => `<button class="ocr-word ${selectedWords.includes(index)?'selected':''}" style="${rectStyle(word.rect)}" data-word-index="${index}" title="${esc(word.text)}"></button>`).join('') : '';
    $('label-layer').innerHTML = layerState.azure ? doc.labels.filter(label => label.page === page.number).map(label => {
      const validation = validateEditorLabel(label);
      const reviewer = label.source !== 'azure-saved';
      return `<button class="label-box ${reviewer?'reviewer':''} ${validation.valid?'':'invalid'}" style="${rectStyle(label.rect)}" data-label-id="${esc(label.id)}"><span class="box-tag">${esc(label.field)}${label.level==='Line'?` | Line ${label.item_index+1}`:''}</span></button>`;
    }).join('') : '';
    $('suggestion-layer').innerHTML = layerState.suggestions ? doc.suggestions.filter(label => label.page === page.number).map(label => `<button class="suggestion-box" style="${rectStyle(label.rect)}" data-suggestion-id="${esc(label.id)}"><span class="box-tag">Suggestion: ${esc(label.field)}</span></button>`).join('') : '';
    $('selection-layer').innerHTML = draft && draft.page === page.number ? `<div class="selection-box" style="${rectStyle(draft.rect)}"></div>` : '';
    bindPageEvents();
    renderLabelsList();
  }

  function bindPageEvents() {
    $('word-layer').querySelectorAll('[data-word-index]').forEach(button => {
      button.addEventListener('pointerdown', event => {
        if (mode !== 'word') return;
        event.preventDefault();
        event.stopPropagation();
        wordGestureAnchor = Number(button.dataset.wordIndex);
      });
      button.addEventListener('pointerup', event => {
        if (mode !== 'word' || !Number.isInteger(wordGestureAnchor)) return;
        event.preventDefault();
        event.stopPropagation();
        const index = Number(button.dataset.wordIndex);
        selectedWords = core.completeWordSelection(currentPage().words, selectedWords, wordGestureAnchor, index);
        wordGestureAnchor = null;
        draftFromWords();
        renderPage();
        openDraftPanel('WORD SELECTION', false);
      });
    });
    $('label-layer').querySelectorAll('[data-label-id]').forEach(button => button.addEventListener('click', event => {
      if (mode === 'area') return;
      event.stopPropagation();
      openExisting(button.dataset.labelId);
    }));
    $('suggestion-layer').querySelectorAll('[data-suggestion-id]').forEach(button => button.addEventListener('click', event => {
      if (mode === 'area') return;
      event.stopPropagation();
      openSuggestion(button.dataset.suggestionId);
    }));
  }

  function draftFromWords() {
    const words = core.readingOrder(selectedWords.map(index => currentPage().words[index]));
    if (!words.length) return clearSelection();
    draft = {
      page: currentPage().number,
      rect: [Math.min(...words.map(word=>word.rect[0])),Math.min(...words.map(word=>word.rect[1])),Math.max(...words.map(word=>word.rect[2])),Math.max(...words.map(word=>word.rect[3]))],
      text: words.map(word => word.text).join(' '),
    };
  }

  function pointerRect(event) {
    const rect = $('page-stage').getBoundingClientRect();
    return [Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width)),Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height))];
  }

  function beginArea(event) {
    if (mode !== 'area' || event.target.closest('[data-label-id],[data-suggestion-id]')) return;
    event.preventDefault();
    drawStart = pointerRect(event);
    drawGhost = {page: currentPage().number,rect:[...drawStart,...drawStart],text:''};
    draft = drawGhost;
    $('page-stage').setPointerCapture(event.pointerId);
    renderPage();
  }
  function moveArea(event) {
    if (!drawStart || mode !== 'area') return;
    const point = pointerRect(event);
    drawGhost.rect = [Math.min(drawStart[0],point[0]),Math.min(drawStart[1],point[1]),Math.max(drawStart[0],point[0]),Math.max(drawStart[1],point[1])];
    draft = drawGhost;
    $('selection-layer').innerHTML = `<div class="selection-box" style="${rectStyle(draft.rect)}"></div>`;
  }
  function endArea(event) {
    if (!drawStart || mode !== 'area') return;
    moveArea(event);
    const words = core.wordsInRect(currentPage().words, draft.rect);
    draft.text = words.map(word => word.text).join(' ');
    selectedWords = words.map(word => currentPage().words.indexOf(word));
    drawStart = null;
    drawGhost = null;
    renderPage();
    openDraftPanel('AREA SELECTION');
  }

  function openInventoryField(token) {
    const field = fieldForName(token);
    if (!field) return;
    const doc = currentDocument();
    const saved = doc.labels.find(item => item.level === field.level && item.field === field.name);
    const suggestion = doc.suggestions.find(item => item.level === field.level && item.field === field.name);
    const evidence = saved || suggestion;
    if (evidence) {
      const targetPage = doc.pages.findIndex(page => page.number === evidence.page);
      if (targetPage >= 0 && targetPage !== pageIndex) {
        pageIndex = targetPage;
        renderPage();
      }
      if (saved) openExisting(saved.id);
      else openSuggestion(suggestion.id);
      return;
    }
    queuedFieldToken = core.fieldToken(field);
    toast(`${queuedFieldToken} is open. Select words or an area to add its evidence.`);
  }

  function renderLabelsList() {
    const doc = currentDocument();
    const page = currentPage();
    const labels = doc.labels.filter(label => label.page === page.number);
    const suggestions = doc.suggestions.filter(label => label.page === page.number);
    $('page-errors').textContent = (doc.errors || []).join(' | ');
    $('show-page-labels').classList.toggle('active', labelsPanelMode === 'page');
    $('show-all-fields').classList.toggle('active', labelsPanelMode === 'all');
    $('field-inventory-controls').hidden = labelsPanelMode !== 'all';
    if (labelsPanelMode === 'page') {
      $('labels-panel-title').textContent = 'Populated on page';
      $('page-label-count').textContent = `${labels.length} labels | ${suggestions.length} suggestions`;
      $('labels-list').innerHTML = [
        ...labels.map(label => {
          const validation = validateEditorLabel(label);
          const reviewer = label.source !== 'azure-saved';
          return `<div class="label-card ${reviewer?'reviewer':''} ${validation.valid?'':'invalid'}" data-label-id="${esc(label.id)}"><strong>${esc(label.field)}${label.level==='Line'?` - Line ${label.item_index+1}`:''}</strong><small>${esc(label.text)} | ${esc(label.source)}</small></div>`;
        }),
        ...suggestions.map(label => `<div class="label-card suggestion" data-suggestion-id="${esc(label.id)}"><strong>${esc(label.field)}${label.level==='Line'&&label.item_index!=null?` - Line ${label.item_index+1}`:''}</strong><small>${esc(label.text)} | click to review</small></div>`),
      ].join('') || '<div class="empty">No labels on this page</div>';
      $('labels-list').querySelectorAll('[data-label-id]').forEach(card => card.addEventListener('click', () => openExisting(card.dataset.labelId)));
      $('labels-list').querySelectorAll('[data-suggestion-id]').forEach(card => card.addEventListener('click', () => openSuggestion(card.dataset.suggestionId)));
      return;
    }

    $('labels-panel-title').textContent = 'All fields';
    const query = fieldInventorySearch.trim().toLocaleLowerCase();
    const inventory = core.buildFieldInventory(state.fields, doc.labels, doc.suggestions).filter(field => {
      if (fieldInventoryLevel !== 'All' && field.level !== fieldInventoryLevel) return false;
      return !query || field.name.toLocaleLowerCase().includes(query);
    });
    $('page-label-count').textContent = `${inventory.length} of ${state.fields.length}`;
    const groups = ['Document', 'Line'].map(level => {
      const fields = inventory.filter(field => field.level === level);
      if (!fields.length) return '';
      const cards = fields.map(field => {
        const counts = field.status === 'saved'
          ? `${field.saved_count} saved${field.suggestion_count ? ` | ${field.suggestion_count} suggestion${field.suggestion_count===1?'':'s'}` : ''}`
          : field.status === 'suggested'
            ? `${field.suggestion_count} suggestion${field.suggestion_count===1?'':'s'} - review needed`
            : 'Open - select evidence to label';
        const rows = field.line_rows.length ? ` | Rows ${field.line_rows.join(', ')}` : '';
        const source = field.sources.includes('reviewer_added')
          ? 'reviewer-added field'
          : field.sources.includes('di_schema') && field.sources.includes('stored_extraction')
            ? 'current DI + observed extraction'
            : field.sources.includes('di_schema') ? 'current DI field' : 'observed extracted field';
        return `<button type="button" class="field-inventory-card status-${field.status}" data-field-token="${esc(core.fieldToken(field))}"><strong>${esc(field.name)}</strong><small>${esc(counts+rows)}</small><span>${esc(source)}</span></button>`;
      }).join('');
      return `<section class="field-inventory-group"><h4>${level} fields <span>${fields.length}</span></h4>${cards}</section>`;
    }).join('');
    $('labels-list').innerHTML = groups || '<div class="empty">No fields match this filter</div>';
    $('labels-list').querySelectorAll('[data-field-token]').forEach(card => card.addEventListener('click', () => openInventoryField(card.dataset.fieldToken)));
  }

  function populateFields() {
    $('field-options').innerHTML = state.fields.map(field => `<option value="${esc(core.fieldToken(field))}" label="${esc(field.sources.join(' + '))}"></option>`).join('');
  }

  function openDraftPanel(kind, shouldScroll = true) {
    activeLabelId = null;
    editing = true;
    $('selection-kind').textContent = kind;
    $('captured-text').value = draft.text || '';
    const queued = queuedFieldToken ? fieldForName(queuedFieldToken) : null;
    $('field-search').value = queued ? queuedFieldToken : '';
    $('field-level').textContent = queued ? queued.level : '-';
    $('field-level').dataset.level = queued ? queued.level : '';
    $('field-source').textContent = queued ? '' : 'Select an allowed field';
    if (queued) showFieldDetails(queued.name, queued.level);
    $('line-index-wrap').hidden = true;
    $('line-index').value = '';
    $('save-label').hidden = false;
    $('add-new-label').hidden = false;
    $('edit-label').hidden = true;
    $('delete-label').hidden = true;
    $('label-panel').hidden = false;
    $('label-validation').textContent = '';
    $('new-field-creator').hidden = true;
    if (shouldScroll) $('label-panel').scrollIntoView({behavior:'smooth',block:'nearest'});
  }

  function openExisting(id) {
    const label = currentDocument().labels.find(item => item.id === id);
    if (!label) return;
    activeLabelId = id;
    draft = {page: label.page,rect:[...label.rect],text:label.text};
    if (currentPage().number !== label.page) pageIndex = currentDocument().pages.findIndex(page => page.number === label.page);
    editing = false;
    $('selection-kind').textContent = label.source === 'azure-saved' ? 'SAVED AZURE LABEL' : 'REVIEWER LABEL';
    $('captured-text').value = label.text;
    $('captured-text').disabled = true;
    $('field-search').value = core.fieldToken({name:label.field,level:label.level});
    $('field-search').disabled = true;
    showFieldDetails(label.field, label.level);
    $('line-index').value = label.item_index == null ? '' : label.item_index + 1;
    $('line-index').disabled = true;
    $('save-label').hidden = true;
    $('add-new-label').hidden = true;
    $('edit-label').hidden = false;
    $('delete-label').textContent = 'Delete label';
    $('delete-label').hidden = false;
    $('label-panel').hidden = false;
    renderPage();
  }

  function openSuggestion(id) {
    const suggestion = currentDocument().suggestions.find(item => item.id === id);
    if (!suggestion) return;
    activeLabelId = `suggestion:${id}`;
    draft = {page:suggestion.page,rect:[...suggestion.rect],text:suggestion.text};
    $('selection-kind').textContent = 'EXTRACTION SUGGESTION';
    $('captured-text').value = suggestion.text;
    $('field-search').value = core.fieldToken({name:suggestion.field,level:suggestion.level});
    showFieldDetails(suggestion.field, suggestion.level);
    $('line-index').value = suggestion.item_index == null ? '' : suggestion.item_index + 1;
    editing = true;
    enablePanelFields(true);
    $('save-label').hidden = false;
    $('add-new-label').hidden = false;
    $('edit-label').hidden = true;
    $('delete-label').textContent = 'Delete label';
    $('delete-label').hidden = false;
    $('label-panel').hidden = false;
    renderPage();
  }

  function showFieldDetails(name, preferredLevel) {
    const field = core.fieldFromToken(state.fields, name) || state.fields.find(item => item.name === name && item.level === preferredLevel) || null;
    if (!field) {
      $('field-source').textContent = 'Not in approved allowlist';
      $('field-level').textContent = '-';
      $('field-level').dataset.level = '';
      $('line-index-wrap').hidden = true;
      return null;
    }
    $('field-source').textContent = field.sources.includes('reviewer_added') ? 'Reviewer-added field' : (field.sources.includes('di_schema') ? (field.sources.length > 1 ? 'Current DI + observed extraction' : 'Current DI field') : 'Observed extracted field');
    $('field-level').textContent = field.level;
    $('field-level').dataset.level = field.level;
    $('line-index-wrap').hidden = field.level !== 'Line';
    if (field.level !== 'Line') $('line-index').value = '';
    return field;
  }

  function enablePanelFields(enabled) {
    $('captured-text').disabled = !enabled;
    $('field-search').disabled = !enabled;
    $('line-index').disabled = !enabled;
  }

  function labelCandidate(field, existing) {
    const itemIndex = field.level === 'Line' && $('line-index').value ? Number($('line-index').value) - 1 : null;
    return {
      id: existing ? existing.id : `reviewer-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      field: field.name,
      level: field.level,
      item_index: itemIndex,
      page: draft.page,
      text: $('captured-text').value.trim(),
      rect: [...draft.rect],
      source: existing ? 'reviewer-modified' : 'reviewer-added',
      original_label: existing ? (existing.original_label || existing.id) : null,
      confidence: existing ? existing.confidence : null,
    };
  }

  function commitLabel(label, existing, message) {
    if (existing) Object.assign(existing, label);
    else currentDocument().labels.push(label);
    if (activeLabelId && activeLabelId.startsWith('suggestion:')) {
      const suggestionId = activeLabelId.slice('suggestion:'.length);
      currentDocument().suggestions = currentDocument().suggestions.filter(item => item.id !== suggestionId);
    }
    queuedFieldToken = null;
    saveLocal(); clearSelection(); render(); toast(message);
  }

  function openNewFieldCreator() {
    if (!draft) {
      $('label-validation').textContent = 'Select document evidence before adding a field.';
      return;
    }
    $('new-field-name').value = $('field-search').value.trim();
    $('new-field-level').value = '';
    $('new-field-creator').hidden = false;
    $('label-validation').textContent = '';
    $('new-field-name').focus();
  }

  function cancelNewFieldCreator() {
    $('new-field-creator').hidden = true;
    $('label-validation').textContent = '';
  }

  function addFieldAndSave() {
    if (!draft) {
      $('label-validation').textContent = 'Select document evidence before adding a field.';
      return;
    }
    const result = core.createReviewerField(state.fields, $('new-field-name').value, $('new-field-level').value);
    if (!result.valid) {
      $('label-validation').textContent = result.code === 'field_name_required' ? 'New field name is required.' : 'Select Document or Line item.';
      return;
    }
    const label = labelCandidate(result.field, null);
    const validation = validateEditorLabel(label);
    if (!validation.valid) {
      $('label-validation').textContent = validation.code === 'line_index_required' ? 'Line-item row is required.' : validation.code.replaceAll('_', ' ');
      return;
    }
    state.fields = result.fields;
    populateFields();
    $('field-search').value = core.fieldToken(result.field);
    showFieldDetails(result.field.name, result.field.level);
    $('new-field-creator').hidden = true;
    commitLabel(label, null, result.added ? 'New field added across this document type and label saved' : 'Existing field reused and label saved');
  }

  function saveLabel() {
    const field = fieldForName($('field-search').value);
    if (!field || !draft) {
      $('label-validation').textContent = 'Select an exact allowed field.';
      return;
    }
    const existing = activeLabelId && !activeLabelId.startsWith('suggestion:') ? currentDocument().labels.find(item => item.id === activeLabelId) : null;
    const label = labelCandidate(field, existing);
    const validation = validateEditorLabel(label);
    if (!validation.valid) {
      $('label-validation').textContent = validation.code.replaceAll('_',' ');
      return;
    }
    commitLabel(label, existing, 'Label saved');
  }

  function editExisting() {
    editing = true;
    enablePanelFields(true);
    $('save-label').hidden = false;
    $('edit-label').hidden = true;
    $('selection-kind').textContent = 'EDITING LABEL';
  }

  function deleteExisting() {
    const suggestionId = activeLabelId && activeLabelId.startsWith('suggestion:')
      ? activeLabelId.slice('suggestion:'.length)
      : null;
    const item = suggestionId
      ? currentDocument().suggestions.find(suggestion => suggestion.id === suggestionId)
      : currentDocument().labels.find(label => label.id === activeLabelId);
    if (!item) return;
    if (!window.confirm(`Remove ${item.field}: ${item.text} from this local review?`)) return;
    if (suggestionId) {
      currentDocument().suggestions = currentDocument().suggestions.filter(suggestion => suggestion.id !== suggestionId);
    } else {
      currentDocument().labels = currentDocument().labels.filter(label => label.id !== activeLabelId);
    }
    saveLocal();
    clearSelection();
    render();
    toast('Removed from this local review only — Azure unchanged.');
  }

  function clearSelection() {
    selectedWords = []; wordGestureAnchor = null; draft = null; activeLabelId = null; editing = false; drawStart = null; drawGhost = null;
    $('label-panel').hidden = true;
    enablePanelFields(true);
  }

  function renderReview() {
    const doc = currentDocument();
    $('doc-notes').value = doc.notes || '';
    const invalid = doc.labels.some(label => !validateEditorLabel(label).valid) || (doc.errors || []).length > 0;
    $('approve-doc').disabled = invalid;
    $('approve-doc').textContent = doc.approved ? 'Approved - click to reopen' : invalid ? 'Resolve errors before approval' : 'Approve this document';
  }

  function openDocument(index) {
    documentIndex = index; pageIndex = 0; zoom = 1; queuedFieldToken = null; clearSelection(); render(); $('page-scroll').scrollTop = 0;
  }

  function exportAll() {
    const output = core.buildExport(state);
    const blob = new Blob([JSON.stringify(output,null,2)], {type:'application/json'});
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `full-review-backup-${state.model}-${state.snapshot_id.slice(0,12)}.json`;
    link.click(); URL.revokeObjectURL(link.href); toast('Complete review backup created');
  }

  async function saveToGitHub() {
    const button = $('save-github');
    const originalText = button.textContent;
    saveLocal();
    const autosave = JSON.parse(localStorage.getItem(key) || 'null');
    button.disabled = true;
    button.textContent = 'Saving...';
    try {
      const result = await checkpointClient.saveCheckpoint({
        endpoint: checkpointEndpoint,
        model: state.model,
        autosave,
        storage: sessionStorage,
        promptForKey: message => window.prompt(message),
        fetchImpl: window.fetch.bind(window),
      });
      const savedTime = result.saved_at ? new Date(result.saved_at).toLocaleTimeString() : 'now';
      const shortSha = String(result.commit_sha || '').slice(0, 7);
      $('save-status').textContent = `Saved to private GitHub ${savedTime}${shortSha ? ` · ${shortSha}` : ''}`;
      toast('Private GitHub checkpoint saved.');
    } catch (error) {
      $('save-status').textContent = 'Saved locally - GitHub save failed';
      toast(error.message || 'GitHub save failed. Local work is still safe.');
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  function exportTraining() {
    const output = core.buildTrainingExport(state);
    if (!output.documents.length) {
      toast('No approved labeled documents are ready for training');
      return;
    }
    const blob = new Blob([JSON.stringify(output,null,2)], {type:'application/json'});
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `training-ready-approved-labels-${state.model}-${state.snapshot_id.slice(0,12)}.json`;
    link.click(); URL.revokeObjectURL(link.href);
    toast(`${output.documents.length} approved labeled documents exported for training`);
  }

  function resetDocument() {
    if (!window.confirm('Reset this document to the imported Azure baseline?')) return;
    const canonicalBaseline = core.canonicalizeQuantityFields({
      fields: state.fields,
      documents: [baseline.documents[documentIndex]],
    });
    state.documents[documentIndex] = canonicalBaseline.documents[0];
    saveLocal();
    clearSelection();
    render();
  }

  function bindControls() {
    $('document-search').addEventListener('input', renderDocumentList);
    $('prev-doc').addEventListener('click', () => openDocument(documentIndex-1));
    $('next-doc').addEventListener('click', () => openDocument(documentIndex+1));
    $('prev-page').addEventListener('click', () => turnPage(-1));
    $('next-page').addEventListener('click', () => turnPage(1));
    $('mode-word').addEventListener('click', () => {mode='word';clearSelection();render();});
    $('mode-area').addEventListener('click', () => {mode='area';clearSelection();render();});
    $('toggle-azure').addEventListener('change', event => {layerState.azure=event.target.checked;renderPage();});
    $('toggle-suggestions').addEventListener('change', event => {layerState.suggestions=event.target.checked;renderPage();});
    $('toggle-words').addEventListener('change', event => {layerState.words=event.target.checked;renderPage();});
    $('show-page-labels').addEventListener('click', () => {labelsPanelMode='page';renderLabelsList();});
    $('show-all-fields').addEventListener('click', () => {labelsPanelMode='all';renderLabelsList();});
    $('field-inventory-search').addEventListener('input', event => {fieldInventorySearch=event.target.value;renderLabelsList();});
    $('field-inventory-level').addEventListener('change', event => {fieldInventoryLevel=event.target.value;renderLabelsList();});
    $('zoom-in').addEventListener('click', () => {zoom=Math.min(2.5,zoom+.15);renderPage();});
    $('zoom-out').addEventListener('click', () => {zoom=Math.max(.5,zoom-.15);renderPage();});
    $('field-search').addEventListener('input', event => {$('label-validation').textContent='';showFieldDetails(event.target.value, $('field-level').dataset.level);});
    $('line-index').addEventListener('input', () => {$('label-validation').textContent='';});
    $('save-label').addEventListener('click', saveLabel);
    $('add-new-label').addEventListener('click', openNewFieldCreator);
    $('new-field-name').addEventListener('input', () => {$('label-validation').textContent='';});
    $('new-field-level').addEventListener('change', event => {
      $('label-validation').textContent='';
      const isLine = event.target.value === 'Line';
      $('line-index-wrap').hidden = !isLine;
      if (!isLine) $('line-index').value = '';
    });
    $('confirm-new-field').addEventListener('click', addFieldAndSave);
    $('cancel-new-field').addEventListener('click', cancelNewFieldCreator);
    $('edit-label').addEventListener('click', editExisting);
    $('delete-label').addEventListener('click', deleteExisting);
    $('cancel-label').addEventListener('click', () => {clearSelection();renderPage();});
    $('doc-notes').addEventListener('input', event => {currentDocument().notes=event.target.value;saveLocal();});
    $('approve-doc').addEventListener('click', () => {const doc=currentDocument();doc.approved=!doc.approved;doc.approved_at=doc.approved?new Date().toISOString():null;saveLocal();render();});
    $('reset-doc').addEventListener('click', resetDocument);
    $('export-all').addEventListener('click', exportAll);
    $('export-training').addEventListener('click', exportTraining);
    $('save-github').addEventListener('click', saveToGitHub);
    $('page-stage').addEventListener('pointerdown', beginArea);
    $('page-stage').addEventListener('pointermove', moveArea);
    $('page-stage').addEventListener('pointerup', endArea);
  }

  populateFields(); bindControls(); render();
})();
