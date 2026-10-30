import { loadConfig } from './config-store.js';
import { displayValue, exportExcel } from './export.js';
import { filterConfiguredEsatsApplications, retirementRowsForInterval, rowsForInterval, summarizeEsatsApplications } from './esats-logic.js';
import { shouldRefreshEsats, synchronizeEsats } from './esats-sync.js';
import { loadEsatsSnapshot } from './esats-store.js';
import { applyTableState, nextSort } from './table-state.js';

const state = {
  config: null,
  snapshot: { applications: [], mvos: [], metadata: null },
  applications: [],
  summary: null,
  syncing: false,
  supportedFilter: null,
  retiredFilter: null,
  lifecycleDays: null,
};

const refs = Object.fromEntries([
  'sync-status','refresh-data','close-dashboard','sync-progress','progress-fill','progress-percent',
  'config-count','mvo-list','summary-cards','supported-table','retired-table','lifecycle-table',
  'supported-table-section','retired-table-section','lifecycle-table-section','supported-filter-label','retired-filter-label',
  'lifecycle-filter-label','clear-supported-filter','clear-retired-filter','clear-lifecycle-filter','toast',
].map((id) => [id, document.getElementById(id)]));

const SUPPORTED_COLUMNS = [
  column('esatsId', 'ESATS ID'), column('applicationName', 'Application'), column('extendedName', 'Extended Name'),
  column('mvoName', 'Maintaining Organization'), column('mvoId', 'MO ID'), column('maintainingGroup', 'Maintaining Group'),
  column('maintainingUnit', 'Maintaining Unit'), column('lifecyclePhase', 'Lifecycle Phase'),
  column('isMarkedForDeletion', 'Marked for Deletion', yesNo), column('applicationManagers', 'Application Manager'),
  column('applicationManagerBemsIds', 'Manager BEMS ID'), column('securityAdministrators', 'ASA'),
  column('securityAdministratorBemsIds', 'ASA BEMS ID'), column('applicationArchitects', 'Application Architect'),
  column('businessSystemManagers', 'Business System Manager'), column('businessSystemOwners', 'Business System Owner'),
  dateColumn('targetProductionDate', 'Target Production'), dateColumn('targetRetirementDate', 'Target Retirement'),
  dateColumn('planningStartDate', 'Planning Start'), dateColumn('developmentStartDate', 'Development Start'),
  dateColumn('productionStartDate', 'Production Start'), dateColumn('retiredStartDate', 'Retired Start'),
  dateColumn('lifecycleChangeDate', 'Latest Lifecycle Change'), column('replacementSystem', 'Replacement System'),
  column('onHold', 'On Hold', yesNo), column('onHoldJustification', 'On-Hold Justification'),
  column('lifecycleComment', 'Lifecycle Comment'), column('allContacts', 'All Contacts'),
  column('_syncDetailStatus', 'Detail Sync Status', (_, row) => row.syncErrors?.length ? `Unavailable: ${row.syncErrors.join('; ')}` : 'Complete'),
];

const RETIRED_COLUMNS = [
  column('applicationName', 'Application'), column('esatsId', 'ESATS ID'), column('mvoName', 'Maintaining Organization'),
  column('_retirementStatus', 'Record Type', retirementStatus), column('lifecyclePhase', 'Lifecycle Phase'),
  dateColumn('retirementDate', 'Retired Date'), dateColumn('markedForDeletionDate', 'Marked Date'),
  column('applicationManagers', 'Application Manager'), column('applicationManagerBemsIds', 'Manager BEMS ID'),
  column('securityAdministrators', 'ASA'), column('targetRetirementDate', 'Target Retirement', formatDate),
];

const LIFECYCLE_COLUMNS = [
  column('applicationName', 'Application'), column('esatsId', 'ESATS ID'), column('mvoName', 'Maintaining Organization'),
  column('lifecyclePhase', 'Current Lifecycle Phase'), dateColumn('lifecycleChangeDate', 'Latest Lifecycle Change'),
  dateColumn('planningStartDate', 'Planning Start'), dateColumn('developmentStartDate', 'Development Start'),
  dateColumn('productionStartDate', 'Production Start'), dateColumn('retiredStartDate', 'Retired Start'),
  column('applicationManagers', 'Application Manager'), column('applicationManagerBemsIds', 'Manager BEMS ID'),
  column('lifecycleComment', 'Lifecycle Comment'),
];

const tables = {
  supported: createDataTable(refs['supported-table'], SUPPORTED_COLUMNS, 'esats-supported-applications'),
  retired: createDataTable(refs['retired-table'], RETIRED_COLUMNS, 'esats-retired-and-deletion'),
  lifecycle: createDataTable(refs['lifecycle-table'], LIFECYCLE_COLUMNS, 'esats-lifecycle-changes'),
};

refs['close-dashboard'].addEventListener('click', () => parent.postMessage({ source: 'aca-esats-dashboard', type: 'close' }, '*'));
refs['refresh-data'].addEventListener('click', async () => {
  if (!confirm('ESATS data is refreshed automatically once per day. Do you want to start another full refresh now?')) return;
  await refreshEsatsData();
});
refs['clear-supported-filter'].addEventListener('click', () => { state.supportedFilter = null; renderTables(); });
refs['clear-retired-filter'].addEventListener('click', () => { state.retiredFilter = null; renderTables(); });
refs['clear-lifecycle-filter'].addEventListener('click', () => { state.lifecycleDays = null; renderTables(); });

initialize().catch(showFatal);

async function initialize() {
  state.config = await loadConfig();
  state.snapshot = await loadEsatsSnapshot();
  applySnapshot();
  if (state.snapshot.applications.length) renderAll();
  if (!shouldRefreshEsats(state.snapshot.metadata)) {
    setSyncStatus();
    return;
  }
  await refreshEsatsData();
}

async function refreshEsatsData() {
  if (state.syncing) return;
  state.syncing = true;
  refs['refresh-data'].disabled = true;
  refs['sync-progress'].hidden = false;
  updateProgress(0);
  refs['sync-status'].textContent = 'Refreshing ESATS data…';
  try {
    const token = await requestEsatsToken();
    state.config = await loadConfig();
    state.snapshot = await synchronizeEsats(state.config, { token, onProgress: updateProgress });
    applySnapshot();
    renderAll();
    setSyncStatus();
    if (state.snapshot.metadata.detailErrors) toast(`${state.snapshot.metadata.detailErrors} application detail requests were unavailable; available data was saved.`);
    else toast('ESATS daily data refresh completed.');
  } catch (error) {
    const waitingForToken = /sign-in\/token|http 401|http 403/i.test(error.message);
    refs['sync-status'].textContent = waitingForToken ? 'Waiting for ESATS sign-in/token.' : `Unable to refresh ESATS data: ${error.message}`;
    toast(waitingForToken ? 'Sign in to ESATS, then use Refresh Data.' : 'Refresh failed. Confirm corporate-network access, then try again.');
    if (!state.snapshot.applications.length) renderEmptyDashboard();
  } finally {
    state.syncing = false;
    refs['refresh-data'].disabled = false;
    setTimeout(() => { refs['sync-progress'].hidden = true; }, 900);
  }
}

function requestEsatsToken() {
  return new Promise((resolve, reject) => {
    const requestId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const timeout = setTimeout(() => {
      removeEventListener('message', receive);
      reject(new Error('Waiting for ESATS sign-in/token.'));
    }, 5000);
    function receive(event) {
      if (event.source !== parent || event.origin !== 'https://esats.web.boeing.com') return;
      const message = event.data;
      if (message?.source !== 'aca-esats-host' || message.version !== 1 || message.type !== 'auth-token' || message.requestId !== requestId) return;
      clearTimeout(timeout);
      removeEventListener('message', receive);
      const token = String(message.token ?? '').trim().replace(/^Bearer\s+/i, '');
      if (!token) reject(new Error('Waiting for ESATS sign-in/token.'));
      else resolve(token);
    }
    addEventListener('message', receive);
    parent.postMessage({ source: 'aca-esats-dashboard', version: 1, type: 'request-auth-token', requestId }, 'https://esats.web.boeing.com');
  });
}

function applySnapshot() {
  state.applications = filterConfiguredEsatsApplications(state.snapshot.applications ?? [], state.config);
  state.summary = summarizeEsatsApplications(state.applications);
}

function renderAll() {
  renderConfiguration();
  renderSummary();
  renderTables();
}

function renderConfiguration() {
  if (!state.config) {
    refs['config-count'].textContent = 'Unavailable';
    refs['mvo-list'].replaceChildren(el('span', { class: 'mvo-chip is-missing' }, 'Supported MO configuration could not be loaded.'));
    return;
  }
  const matched = new Set((state.snapshot.mvos ?? []).map((mvo) => normalize(mvo.name)));
  refs['config-count'].textContent = `${state.config.includedOrganizations.length} configured`;
  refs['mvo-list'].replaceChildren(...state.config.includedOrganizations.map((name) => el('span', {
    class: `mvo-chip${matched.has(normalize(name)) ? '' : ' is-missing'}`,
    title: matched.has(normalize(name)) ? 'Matched in the latest ESATS synchronization' : 'Not matched in the latest ESATS synchronization',
  }, name)));
}

function renderSummary() {
  const summary = state.summary;
  const allSupported = el('button', { class: 'supported-count-button', type: 'button' },
    el('small', {}, 'Supported applications'), el('strong', {}, formatNumber(summary.supported)), el('span', {}, 'Show all supported MO applications'),
  );
  const newApplications = el('button', { class: 'supported-count-button is-new', type: 'button' },
    el('small', {}, 'New applications'), el('strong', {}, formatNumber(summary.newApplications)), el('span', {}, 'Supported applications without an ASA'),
  );
  allSupported.addEventListener('click', () => applySupportedCardFilter('all'));
  newApplications.addEventListener('click', () => applySupportedCardFilter('new'));
  const supported = el('article', { class: 'summary-card' },
    el('h3', {}, 'Supported Applications Count'),
    el('p', { class: 'card-note' }, 'Click a count to filter the supported MO table.'),
    el('div', { class: 'supported-count-grid' }, allSupported, newApplications),
  );

  const maxRetired = Math.max(1, ...summary.intervals.map((item) => item.retired + item.markedForDeletion));
  const retirement = el('article', { class: 'summary-card retirement' },
    el('h3', {}, 'Retired Applications'),
    el('p', { class: 'card-note' }, 'Click a specific count to filter the table.'),
    ...summary.intervals.map((item) => retirementIntervalRow(item, maxRetired)),
    el('div', { class: 'card-footer-counts' },
      el('span', {}, 'Retired total: ', el('strong', {}, formatNumber(summary.retiredTotal))),
      el('span', {}, 'Marked total: ', el('strong', {}, formatNumber(summary.markedForDeletionTotal))),
      summary.markedForDeletionUndated ? el('span', { title: 'The source did not provide a marked date for these applications.' }, 'Marked without date: ', el('strong', {}, formatNumber(summary.markedForDeletionUndated))) : null,
    ),
  );

  const maxLifecycle = Math.max(1, ...summary.intervals.map((item) => item.lifecycleChanges));
  const lifecycle = el('article', { class: 'summary-card lifecycle' },
    el('h3', {}, 'Lifecycle Changes'),
    el('p', { class: 'card-note' }, 'Latest lifecycle transition by rolling interval.'),
    ...summary.intervals.map((item) => lifecycleIntervalRow(item, maxLifecycle)),
  );
  refs['summary-cards'].replaceChildren(supported, retirement, lifecycle);
}

function applySupportedCardFilter(type) {
  state.supportedFilter = type;
  renderTables();
  scrollToSection(refs['supported-table-section']);
}

function retirementIntervalRow(item, maximum) {
  const row = el('div', { class: 'interval-row' }, el('span', { class: 'interval-label' }, `Last ${item.days} days`));
  const retired = el('button', { class: 'metric-count-button', type: 'button' }, el('small', {}, 'Retired'), el('strong', {}, formatNumber(item.retired)));
  const marked = el('button', { class: 'metric-count-button', type: 'button' }, el('small', {}, 'Marked'), el('strong', {}, formatNumber(item.markedForDeletion)));
  retired.addEventListener('click', () => applyRetiredCardFilter(item.days, 'retired'));
  marked.addEventListener('click', () => applyRetiredCardFilter(item.days, 'marked'));
  row.append(retired, marked, el('div', { class: 'mini-bar' }, el('i', { style: `width:${(item.retired + item.markedForDeletion) / maximum * 100}%` })));
  return row;
}

function lifecycleIntervalRow(item, maximum) {
  const button = el('button', { class: 'lifecycle-count-button', type: 'button' },
    el('span', {}, `Last ${item.days} days`), el('strong', {}, formatNumber(item.lifecycleChanges)),
    el('span', { class: 'mini-bar' }, el('i', { style: `width:${item.lifecycleChanges / maximum * 100}%` })),
  );
  button.addEventListener('click', () => {
    state.lifecycleDays = item.days;
    renderTables();
    scrollToSection(refs['lifecycle-table-section']);
  });
  return button;
}

function applyRetiredCardFilter(days, eventType) {
  state.retiredFilter = { days, eventType };
  renderTables();
  scrollToSection(refs['retired-table-section']);
}

function renderTables() {
  const supportedRows = state.supportedFilter === 'new' ? state.summary.newRows : state.applications;
  tables.supported.setRows(supportedRows);
  const retiredRows = state.retiredFilter
    ? retirementRowsForInterval(state.summary.retiredRows, state.retiredFilter.days, state.retiredFilter.eventType)
    : state.summary.retiredRows;
  tables.retired.setRows(retiredRows);
  const lifecycleRows = state.lifecycleDays
    ? rowsForInterval(state.summary.lifecycleRows, 'lifecycleChangeTimestamp', state.lifecycleDays)
    : state.summary.lifecycleRows;
  tables.lifecycle.setRows(lifecycleRows);
  refs['clear-supported-filter'].hidden = !state.supportedFilter;
  refs['supported-filter-label'].textContent = state.supportedFilter === 'new'
    ? 'Card filter: New applications — supported MO applications without an Application Security Administrator (ASA).'
    : state.supportedFilter === 'all'
      ? 'Card selection: All supported MO applications.'
      : 'Card filter: None — showing all supported MO applications.';
  refs['clear-retired-filter'].hidden = !state.retiredFilter;
  refs['retired-filter-label'].textContent = state.retiredFilter
    ? `Card filter: ${state.retiredFilter.eventType === 'retired' ? 'Retired applications' : 'Applications marked for deletion'} in the last ${state.retiredFilter.days} days.`
    : 'Card filter: None — showing all retired and marked-for-deletion applications.';
  refs['clear-lifecycle-filter'].hidden = !state.lifecycleDays;
  refs['lifecycle-filter-label'].textContent = state.lifecycleDays
    ? `Card filter: Lifecycle changes in the last ${state.lifecycleDays} days.`
    : 'Card filter: None — showing all applications with lifecycle-change dates.';
}

function createDataTable(root, columns, filename) {
  let rows = [];
  let globalSearch = '';
  let columnSearches = {};
  let sort = null;
  let page = 1;
  let pageSize = 10;

  function setRows(nextRows) {
    rows = nextRows;
    page = 1;
    render();
  }

  function render(focusKey = '', cursor = null) {
    const processed = applyTableState(rows, columns, { globalSearch, columnSearches, sort });
    const pageCount = Math.max(1, Math.ceil(processed.length / pageSize));
    page = Math.min(page, pageCount);
    const pageRows = processed.slice((page - 1) * pageSize, page * pageSize);

    const globalInput = el('input', { class: 'search-input', type: 'search', value: globalSearch, placeholder: 'Search all columns…', 'aria-label': 'Search all table columns', 'data-focus-key': 'global' });
    globalInput.addEventListener('input', () => { globalSearch = globalInput.value; page = 1; render('global', globalInput.selectionStart); });
    const pageSizeSelect = el('select', { class: 'page-size-select', 'aria-label': 'Rows per page' }, ...[10,25,50,100].map((size) => el('option', { value: size, selected: size === pageSize }, `${size} rows`)));
    pageSizeSelect.addEventListener('change', () => { pageSize = Number(pageSizeSelect.value); page = 1; render(); });
    const exportButton = el('button', { class: 'button button-secondary', type: 'button' }, 'Export Excel');
    exportButton.addEventListener('click', () => exportExcel(processed, columns, filename));
    const toolbar = el('div', { class: 'table-toolbar' },
      globalInput,
      el('div', { class: 'toolbar-group' }, el('span', { class: 'table-count' }, `${formatNumber(processed.length)} of ${formatNumber(rows.length)} records`), pageSizeSelect, exportButton),
    );

    const heading = el('tr', { class: 'heading-row' }, ...columns.map((column, index) => {
      const indicator = sort?.columnIndex === index ? (sort.direction === 'asc' ? '▲' : '▼') : '↕';
      const button = el('button', { class: 'sort-button', type: 'button' }, el('span', {}, column.label), el('span', {}, indicator));
      button.addEventListener('click', () => { sort = nextSort(sort, index); render(); });
      return el('th', { scope: 'col' }, button);
    }));
    const filters = el('tr', { class: 'filter-row' }, ...columns.map((column, index) => {
      const input = el('input', { class: 'column-search', type: 'search', value: columnSearches[index] ?? '', placeholder: `Filter ${column.label}`, 'aria-label': `Filter ${column.label}`, 'data-focus-key': `column-${index}` });
      input.addEventListener('input', () => { columnSearches[index] = input.value; page = 1; render(`column-${index}`, input.selectionStart); });
      return el('th', {}, input);
    }));
    const body = el('tbody', {}, ...pageRows.map((row) =>
      el('tr', {}, ...columns.map((column) => el('td', {}, displayValue(row, column)))),
    ));
    const tableContent = pageRows.length
      ? el('div', { class: 'table-scroll' }, el('table', {}, el('thead', {}, heading, filters), body))
      : el('div', { class: 'empty-state' }, 'No records match the current filters.');
    const previous = el('button', { class: 'page-button', type: 'button', disabled: page <= 1 }, 'Previous');
    const next = el('button', { class: 'page-button', type: 'button', disabled: page >= pageCount }, 'Next');
    previous.addEventListener('click', () => { page -= 1; render(); });
    next.addEventListener('click', () => { page += 1; render(); });
    const pagination = el('div', { class: 'pagination' }, previous, el('span', { class: 'table-count' }, `Page ${page} of ${pageCount}`), next);
    root.replaceChildren(toolbar, tableContent, pagination);
    if (focusKey) {
      const target = root.querySelector(`[data-focus-key="${focusKey}"]`);
      target?.focus();
      if (cursor != null && target?.setSelectionRange) target.setSelectionRange(cursor, cursor);
    }
  }
  return { setRows };
}

function setSyncStatus() {
  const metadata = state.snapshot.metadata;
  if (!metadata?.completedAt) {
    refs['sync-status'].textContent = 'No completed ESATS synchronization is stored.';
    return;
  }
  const configChanged = state.config.updatedAt && metadata.configUpdatedAt && Date.parse(state.config.updatedAt) > Date.parse(metadata.configUpdatedAt);
  const detailNote = metadata.detailErrors ? ` · ${metadata.detailErrors} detail requests unavailable` : '';
  refs['sync-status'].textContent = `Last refreshed ${formatDateTime(metadata.completedAt)}${detailNote}${configChanged ? ' · Configuration changed after this refresh; use Refresh Data to include additions.' : ''}`;
}

function updateProgress(value) {
  const percent = Math.min(100, Math.max(0, Math.round(value)));
  refs['progress-fill'].style.width = `${percent}%`;
  refs['progress-percent'].textContent = `${percent}%`;
  refs['progress-fill'].parentElement.setAttribute('aria-valuenow', percent);
}

function renderEmptyDashboard() {
  state.applications = [];
  state.summary = summarizeEsatsApplications([]);
  renderAll();
}

function showFatal(error) {
  refs['sync-status'].textContent = `Unable to initialize the ESATS dashboard: ${error.message}`;
  renderEmptyDashboard();
}

function scrollToSection(section) {
  section.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  section.querySelector('input,button')?.focus({ preventScroll: true });
}

function toast(message) {
  refs.toast.textContent = message;
  refs.toast.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { refs.toast.hidden = true; }, 5000);
}

function column(key, label, value = null) { return { key, label, ...(value ? { value: (row) => value(row[key], row) } : {}) }; }
function dateColumn(key, label) { return column(key, label, formatDate); }
function yesNo(value) { return value ? 'Yes' : 'No'; }
function retirementStatus(_, row) { return row.isRetired && row.isMarkedForDeletion ? 'Retired and marked for deletion' : row.isRetired ? 'Retired' : 'Marked for deletion'; }
function formatDate(value) {
  if (!value || Number.isNaN(Date.parse(value))) return '';
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value));
}
function formatDateTime(value) {
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }).format(new Date(value)) + ' IST';
}
function formatNumber(value) { return new Intl.NumberFormat('en-IN').format(value); }
function normalize(value) { return String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US'); }
function el(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'value') node.value = value;
    else if (key === 'selected') node.selected = Boolean(value);
    else if (key === 'disabled') node.disabled = Boolean(value);
    else node.setAttribute(key, String(value));
  }
  for (const child of children.flat(Infinity)) if (child != null) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}
