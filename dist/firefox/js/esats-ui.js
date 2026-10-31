import { loadConfig, loadEsatsConfig, saveEsatsConfig } from './config-store.js';
import { fetchApplicationsForOrganization, fetchMaintainingOrganizations } from './esats-api.js';
import { displayValue, exportExcel, exportJson } from './export.js';
import { filterConfiguredEsatsApplications, personIdentity, retirementRowsForInterval, rowsForInterval, summarizeEsatsApplications } from './esats-logic.js';
import { shouldRefreshEsats, synchronizeEsats } from './esats-sync.js';
import { loadEsatsSnapshot } from './esats-store.js';
import { applyTableState, nextSort, uniqueColumnValues } from './table-state.js';

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
let activeColumnFilterPanel = null;
let activeColumnFilterOutsideHandler = null;
let configPickerSequence = 0;

const refs = Object.fromEntries([
  'sync-status','refresh-data','close-dashboard','sync-progress','progress-fill','progress-percent',
  'summary-cards','supported-table','retired-table','lifecycle-table',
  'supported-table-section','retired-table-section','lifecycle-table-section','supported-filter-label','retired-filter-label',
  'supported-section-count','retired-section-count','lifecycle-section-count',
  'lifecycle-filter-label','clear-supported-filter','clear-retired-filter','clear-lifecycle-filter',
  'esats-config-button','config-modal-backdrop','config-modal','config-modal-close','config-modal-subtitle',
  'config-modal-toolbar','config-modal-content','config-modal-footer',
  'page-top','page-bottom','page-progress-ring','page-progress-value','toast',
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
  column('lifecycleComment', 'Lifecycle Comment'), column('allContacts', 'All Contacts', null, { className: 'contacts-column', expandable: true }),
  column('_syncDetailStatus', 'Detail Sync Status', (_, row) => row.syncErrors?.length ? `Unavailable: ${row.syncErrors.join('; ')}` : 'Complete'),
];

const RETIRED_COLUMNS = [
  column('applicationName', 'Application'), column('esatsId', 'ESATS ID'), column('mvoName', 'Maintaining Organization'),
  column('_retirementStatus', 'Record Type', retirementStatus), column('lifecyclePhase', 'Lifecycle Phase'),
  dateColumn('retirementDate', 'Retired Date'), dateColumn('markedForDeletionDate', 'Marked Date'),
  dateColumn('hardDeletionDate', 'Hard Delete Date'),
  column('applicationManagers', 'Application Manager'), column('applicationManagerBemsIds', 'Manager BEMS ID'),
  column('securityAdministrators', 'ASA'), column('targetRetirementDate', 'Target Retirement', formatDate),
];

const LIFECYCLE_COLUMNS = [
  column('applicationName', 'Application'), column('esatsId', 'ESATS ID'), column('mvoName', 'Maintaining Organization'),
  column('lifecyclePhase', 'Current Lifecycle Phase'), dateColumn('lifecycleChangeDate', 'Latest Lifecycle Change'),
  dateColumn('planningStartDate', 'Planning Start'), dateColumn('developmentStartDate', 'Development Start'),
  dateColumn('productionStartDate', 'Production Start'), dateColumn('retiredStartDate', 'Retired Start'),
  column('applicationManagers', 'Application Manager'), column('applicationManagerBemsIds', 'Manager BEMS ID'),
  column('securityAdministrators', 'ASA'),
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
refs['esats-config-button'].addEventListener('click', openEsatsConfiguration);
refs['config-modal-close'].addEventListener('click', closeEsatsConfiguration);
refs['config-modal-backdrop'].addEventListener('click', (event) => { if (event.target === refs['config-modal-backdrop']) closeEsatsConfiguration(); });
refs['page-top'].addEventListener('click', () => scrollPageTo(0));
refs['page-bottom'].addEventListener('click', () => scrollPageTo(document.documentElement.scrollHeight));
addEventListener('scroll', updatePageProgress, { passive: true });
addEventListener('resize', updatePageProgress, { passive: true });
refs['clear-supported-filter'].addEventListener('click', () => { state.supportedFilter = null; renderTables(); });
refs['clear-retired-filter'].addEventListener('click', () => { state.retiredFilter = null; renderTables(); });
refs['clear-lifecycle-filter'].addEventListener('click', () => { state.lifecycleDays = null; renderTables(); });
addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (activeColumnFilterPanel) closeColumnValueFilter();
  else if (!refs['config-modal-backdrop'].hidden) closeEsatsConfiguration();
});
addEventListener('resize', closeColumnValueFilter, { passive: true });

initialize().catch(showFatal);

async function initialize() {
  state.config = await loadEsatsConfig();
  state.snapshot = await loadEsatsSnapshot();
  applySnapshot();
  renderAll();
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
    state.config = await loadEsatsConfig();
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

async function openEsatsConfiguration() {
  refs['config-modal-backdrop'].hidden = false;
  document.body.classList.add('modal-open');
  refs['config-modal-subtitle'].textContent = 'Loading ESATS maintaining organizations and the current daily application inventory…';
  refs['config-modal-toolbar'].replaceChildren();
  refs['config-modal-content'].replaceChildren(el('div', { class: 'config-loading' }, 'Loading configuration inventory…'));
  refs['config-modal-footer'].replaceChildren();
  let organizations = state.snapshot.mvos ?? [];
  let directApplications = [];
  let inventoryStatus = 'Using the stored daily ESATS inventory.';
  try {
    const token = await requestEsatsToken();
    const liveOrganizations = await fetchMaintainingOrganizations({ token });
    if (Array.isArray(liveOrganizations)) {
      organizations = liveOrganizations;
      const included = new Set(state.config.includedOrganizations.map(normalize));
      const selectedOrganizations = liveOrganizations.filter((item) => included.has(normalize(item.name)));
      const applicationGroups = await mapWithLimit(selectedOrganizations, 5, async (organization) => {
        try {
          const applications = await fetchApplicationsForOrganization(organization.id, { token });
          return (Array.isArray(applications) ? applications : []).map((application) => ({
            applicationName: String(application.name ?? '').trim(),
            mvoName: String(application.maintainingOrganization?.name ?? organization.name ?? '').trim(),
          }));
        } catch { return []; }
      });
      directApplications = applicationGroups.flat();
      inventoryStatus = 'MOs and application names loaded directly from ESATS; manager and ASA suggestions use the current daily detail inventory.';
    }
  } catch (error) {
    inventoryStatus = `Live MO lookup unavailable (${error.message}); using stored data and retaining unmatched rules.`;
  }
  renderEsatsConfigurationForm(organizations, inventoryStatus, directApplications);
}

function closeEsatsConfiguration() {
  refs['config-modal-backdrop'].hidden = true;
  document.body.classList.remove('modal-open');
}

function renderEsatsConfigurationForm(organizations, inventoryStatus, directApplications = []) {
  const inventory = state.snapshot.applications ?? [];
  const organizationNames = [...new Set([
    ...organizations.map((item) => String(item.name ?? '').trim()),
    ...state.config.includedOrganizations,
    ...Object.keys(state.config.restrictedOrganizations ?? {}),
  ].filter(Boolean))].sort(localeSort);
  const applicationNames = [...new Set([...inventory, ...directApplications].map((item) => item.applicationName).filter(Boolean))].sort(localeSort);
  const managers = uniquePeopleOptions(inventory, 'applicationManagers', 'applicationManagerBemsIds');
  const asas = uniquePeopleOptions(inventory, 'securityAdministrators', 'securityAdministratorBemsIds');
  const applicationsByOrganization = new Map();
  for (const application of [...inventory, ...directApplications]) {
    const key = normalize(application.mvoName);
    if (!applicationsByOrganization.has(key)) applicationsByOrganization.set(key, new Set());
    applicationsByOrganization.get(key).add(application.applicationName);
  }

  refs['config-modal-subtitle'].textContent = 'Configure ESATS independently. Values missing from the current inventory are retained and ignored until they match.';
  refs['config-modal-toolbar'].replaceChildren(
    el('span', { class: 'config-inventory-status' }, inventoryStatus),
    el('span', { class: 'config-update-status' }, `Last updated: ${formatDateTime(state.config.updatedAt)}`),
  );

  const selectedOrganizations = new Set(state.config.includedOrganizations.map(normalize));
  const organizationList = el('div', { class: 'config-check-list' });
  for (const name of organizationNames) {
    const found = organizations.some((item) => normalize(item.name) === normalize(name));
    organizationList.append(configCheckRow(name, selectedOrganizations.has(normalize(name)), found));
  }
  const organizationSearch = el('input', { class: 'config-search-input', type: 'search', placeholder: 'Search maintaining organizations…', 'aria-label': 'Search maintaining organizations' });
  organizationSearch.addEventListener('input', () => {
    const term = normalize(organizationSearch.value);
    for (const row of organizationList.children) row.hidden = Boolean(term && !normalize(row.dataset.label).includes(term));
  });

  const scopedList = el('div', { class: 'config-rule-list' });
  for (const [organization, applications] of Object.entries(state.config.restrictedOrganizations ?? {})) {
    for (const application of applications) scopedList.append(scopedApplicationRuleRow(organization, application, organizationNames, applicationsByOrganization));
  }
  const managerList = el('div', { class: 'config-rule-list' });
  for (const value of state.config.managerExceptions ?? []) managerList.append(configValueRuleRow(value, managers, 'manager', 'Type to search application managers'));
  const asaList = el('div', { class: 'config-rule-list' });
  for (const value of state.config.asaExceptions ?? []) asaList.append(configValueRuleRow(value, asas, 'person', 'Type to search ASAs'));
  const applicationList = el('div', { class: 'config-rule-list' });
  for (const value of state.config.applicationExceptions ?? []) applicationList.append(configValueRuleRow(value, applicationNames, 'application', 'Type to search applications'));

  const addScoped = el('button', { class: 'button button-secondary', type: 'button' }, 'Add scoped application');
  addScoped.addEventListener('click', () => scopedList.append(scopedApplicationRuleRow('', '', organizationNames, applicationsByOrganization)));
  const addManager = el('button', { class: 'button button-secondary', type: 'button' }, 'Add manager exception');
  addManager.addEventListener('click', () => managerList.append(configValueRuleRow('', managers, 'manager', 'Type to search application managers')));
  const addAsa = el('button', { class: 'button button-secondary', type: 'button' }, 'Add ASA exception');
  addAsa.addEventListener('click', () => asaList.append(configValueRuleRow('', asas, 'person', 'Type to search ASAs')));
  const addApplication = el('button', { class: 'button button-secondary', type: 'button' }, 'Add application exception');
  addApplication.addEventListener('click', () => applicationList.append(configValueRuleRow('', applicationNames, 'application', 'Type to search applications')));

  refs['config-modal-content'].replaceChildren(el('div', { class: 'esats-config-layout' },
    el('div', {},
      configFormSection('Included maintaining organizations', 'Applications are included when their normalized maintaining organization is selected.', organizationSearch, organizationList),
      configFormSection('Scoped MO application rules', 'When an MO has scoped rules, only the listed applications are included for that MO.', scopedList, addScoped),
    ),
    el('div', {},
      configFormSection('Application manager exceptions', 'Exclude all applications managed by these people, regardless of MO.', managerList, addManager),
      configFormSection('ASA exceptions', 'Exclude all applications assigned to these ASAs, regardless of MO.', asaList, addAsa),
      configFormSection('Application exceptions', 'Exclude these application names regardless of MO.', applicationList, addApplication),
    ),
  ));

  const importInput = el('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  const importButton = el('button', { class: 'button button-secondary', type: 'button' }, 'Import JSON');
  const exportButton = el('button', { class: 'button button-secondary', type: 'button' }, 'Export JSON');
  const copyButton = el('button', { class: 'button button-quiet', type: 'button' }, 'Copy Compliance Configuration');
  const saveButton = el('button', { class: 'button button-primary', type: 'button' }, 'Save ESATS configuration');
  importButton.addEventListener('click', () => importInput.click());
  exportButton.addEventListener('click', () => exportJson(state.config, 'esats-supported-mo-configuration'));
  copyButton.addEventListener('click', async () => {
    if (!confirm('Replace the separate ESATS configuration with the current Compliance configuration?')) return;
    try {
      state.config = await saveEsatsConfig(await loadConfig());
      renderEsatsConfigurationForm(organizations, inventoryStatus, directApplications);
      toast('Compliance configuration copied into the ESATS configuration.');
    } catch (error) { toast(`Configuration copy failed: ${error.message}`); }
  });
  importInput.addEventListener('change', async () => {
    const file = importInput.files?.[0];
    if (!file) return;
    try {
      state.config = await saveEsatsConfig(JSON.parse(await file.text()));
      renderEsatsConfigurationForm(organizations, inventoryStatus, directApplications);
      toast('ESATS configuration imported.');
    } catch (error) { toast(`Import failed: ${error.message}`); }
  });
  saveButton.addEventListener('click', async () => {
    try {
      const includedOrganizations = [...organizationList.querySelectorAll('input:checked')].map((input) => input.value);
      const restrictedOrganizations = {};
      for (const row of scopedList.querySelectorAll('.config-rule-row')) {
        const organization = row.querySelector('[data-config-field="organization"]').value.trim();
        const application = row.querySelector('[data-config-field="application"]').value.trim();
        if (!organization || !application) continue;
        (restrictedOrganizations[organization] ??= []).push(application);
      }
      const managerExceptions = configRuleValues(managerList);
      const asaExceptions = configRuleValues(asaList);
      const applicationExceptions = configRuleValues(applicationList);
      state.config = await saveEsatsConfig({
        schemaVersion: 1,
        bemsId: state.config.bemsId,
        includedOrganizations,
        restrictedOrganizations,
        managerExceptions,
        asaExceptions,
        excludeBlankAsaFromScmp: state.config.excludeBlankAsaFromScmp,
        applicationExceptions,
      });
      applySnapshot();
      renderAll();
      setSyncStatus();
      closeEsatsConfiguration();
      toast('ESATS supported MO configuration saved. Use Refresh Data to fetch newly included MOs.');
    } catch (error) { toast(`Configuration was not saved: ${error.message}`); }
  });
  refs['config-modal-footer'].replaceChildren(el('div', { class: 'toolbar-group' }, importInput, importButton, exportButton, copyButton), saveButton);
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
  renderSummary();
  renderTables();
  updatePageProgress();
}

function renderSummary() {
  const summary = state.summary;
  const allSupported = el('button', { class: 'supported-count-button', type: 'button' },
    el('small', {}, 'Active supported applications'), el('strong', {}, formatNumber(summary.supported)), el('span', {}, 'Retired and marked records excluded'),
  );
  const newApplications = el('button', { class: 'supported-count-button is-new', type: 'button' },
    el('small', {}, 'New applications'), el('strong', {}, formatNumber(summary.newApplications)), el('span', {}, 'Supported applications without an ASA'),
  );
  allSupported.addEventListener('click', () => applySupportedCardFilter('all'));
  newApplications.addEventListener('click', () => applySupportedCardFilter('new'));
  const supported = el('article', { class: 'summary-card' },
    el('h3', {}, 'Supported Applications Count'),
    el('p', { class: 'card-note' }, `${formatNumber(summary.excludedFromSupported)} retired or marked-for-deletion record${summary.excludedFromSupported === 1 ? '' : 's'} moved to the dedicated table.`),
    el('div', { class: 'supported-count-grid' }, allSupported, newApplications),
  );

  const maxRetired = Math.max(1, ...summary.intervals.map((item) => item.retired + item.markedForDeletion), summary.olderThan90.retired + summary.olderThan90.markedForDeletion);
  const retirement = el('article', { class: 'summary-card retirement' },
    el('h3', {}, 'Retired Applications'),
    el('p', { class: 'card-note' }, 'Click a specific count to filter the table.'),
    ...summary.intervals.map((item) => retirementIntervalRow(item, maxRetired)),
    retirementIntervalRow({ ...summary.olderThan90, label: '90+ days', olderThan: true }, maxRetired),
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
  const row = el('div', { class: 'interval-row' }, el('span', { class: 'interval-label' }, item.label ?? `Last ${item.days} days`));
  const retired = el('button', { class: 'metric-count-button', type: 'button' }, el('small', {}, 'Retired'), el('strong', {}, formatNumber(item.retired)));
  const marked = el('button', { class: 'metric-count-button', type: 'button' }, el('small', {}, 'Marked'), el('strong', {}, formatNumber(item.markedForDeletion)));
  retired.addEventListener('click', () => applyRetiredCardFilter(item.days, 'retired', Boolean(item.olderThan)));
  marked.addEventListener('click', () => applyRetiredCardFilter(item.days, 'marked', Boolean(item.olderThan)));
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

function applyRetiredCardFilter(days, eventType, olderThan = false) {
  state.retiredFilter = { days, eventType, olderThan };
  renderTables();
  scrollToSection(refs['retired-table-section']);
}

function renderTables() {
  const supportedRows = state.supportedFilter === 'new' ? state.summary.newRows : state.summary.supportedRows;
  tables.supported.setRows(supportedRows);
  const retiredRows = state.retiredFilter
    ? retirementRowsForInterval(state.summary.retiredRows, state.retiredFilter.days, state.retiredFilter.eventType, new Date(), state.retiredFilter.olderThan)
    : state.summary.retiredRows;
  tables.retired.setRows(retiredRows);
  const lifecycleRows = state.lifecycleDays
    ? rowsForInterval(state.summary.lifecycleRows, 'lifecycleChangeTimestamp', state.lifecycleDays)
    : state.summary.lifecycleRows;
  tables.lifecycle.setRows(lifecycleRows);
  refs['supported-section-count'].textContent = `${formatNumber(supportedRows.length)} records`;
  refs['retired-section-count'].textContent = `${formatNumber(retiredRows.length)} records`;
  refs['lifecycle-section-count'].textContent = `${formatNumber(lifecycleRows.length)} records`;
  refs['clear-supported-filter'].hidden = !state.supportedFilter;
  refs['supported-filter-label'].textContent = state.supportedFilter === 'new'
    ? 'Card filter: New applications — supported MO applications without an Application Security Administrator (ASA).'
    : state.supportedFilter === 'all'
      ? 'Card selection: All active supported MO applications; retired and marked-for-deletion records remain excluded.'
      : 'Card filter: None — showing active supported MO applications. Retired and marked-for-deletion records are shown in the dedicated table below.';
  refs['clear-retired-filter'].hidden = !state.retiredFilter;
  refs['retired-filter-label'].textContent = state.retiredFilter
    ? `Card filter: ${state.retiredFilter.eventType === 'retired' ? 'Retired applications' : 'Applications marked for deletion'} ${state.retiredFilter.olderThan ? 'older than' : 'in the last'} ${state.retiredFilter.days} days.`
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
  let columnSelections = {};
  let sort = null;
  let page = 1;
  let pageSize = 10;

  function setRows(nextRows) {
    rows = nextRows;
    page = 1;
    render();
  }

  function render(focusKey = '', cursor = null) {
    const processed = applyTableState(rows, columns, { globalSearch, columnSearches, columnSelections, sort });
    const pageCount = Math.max(1, Math.ceil(processed.length / pageSize));
    page = Math.min(page, pageCount);
    const pageRows = processed.slice((page - 1) * pageSize, page * pageSize);

    const globalInput = el('input', { class: 'search-input', type: 'search', value: globalSearch, placeholder: 'Search all columns…', 'aria-label': 'Search all table columns', 'data-focus-key': 'global' });
    globalInput.addEventListener('input', () => { globalSearch = globalInput.value; page = 1; render('global', globalInput.selectionStart); });
    const pageSizeSelect = el('select', { class: 'page-size-select', 'aria-label': 'Rows per page' }, ...[10,25,50,100].map((size) => el('option', { value: size, selected: size === pageSize }, `${size} rows`)));
    pageSizeSelect.addEventListener('change', () => { pageSize = Number(pageSizeSelect.value); page = 1; render(); });
    const hasTableFilters = Boolean(globalSearch.trim())
      || Object.values(columnSearches).some((value) => String(value).trim())
      || Object.keys(columnSelections).length > 0;
    const clearFiltersButton = el('button', { class: 'button button-quiet', type: 'button', hidden: !hasTableFilters }, 'Clear all filters');
    clearFiltersButton.addEventListener('click', () => {
      globalSearch = '';
      columnSearches = {};
      columnSelections = {};
      page = 1;
      closeColumnValueFilter();
      render();
    });
    const exportButton = el('button', { class: 'button button-secondary', type: 'button' }, 'Export Excel');
    exportButton.addEventListener('click', () => exportExcel(processed, columns, filename));
    const toolbar = el('div', { class: 'table-toolbar' },
      globalInput,
      el('div', { class: 'toolbar-group' }, el('span', { class: 'table-count' }, `${formatNumber(processed.length)} of ${formatNumber(rows.length)} records`), pageSizeSelect, clearFiltersButton, exportButton),
    );
    const filterSummary = el('div', { class: 'table-filter-summary' }, describeTableFilters(columns, globalSearch, columnSearches, columnSelections));

    const heading = el('tr', { class: 'heading-row' }, ...columns.map((column, index) => {
      const indicator = sort?.columnIndex === index ? (sort.direction === 'asc' ? '▲' : '▼') : '↕';
      const sortButton = el('button', { class: 'sort-button', type: 'button' }, el('span', {}, column.label), el('span', {}, indicator));
      sortButton.addEventListener('click', () => { sort = nextSort(sort, index); render(); });
      const valueFilterButton = el('button', {
        class: `column-value-filter-button${Object.hasOwn(columnSelections, index) ? ' is-filtered' : ''}`,
        type: 'button', title: `Filter ${column.label} by value`, 'aria-label': `Filter ${column.label} by value`,
      }, '▾');
      valueFilterButton.addEventListener('click', (event) => {
        event.stopPropagation();
        openColumnValueFilter({
          anchor: valueFilterButton,
          rows,
          column,
          selected: columnSelections[index],
          onApply(selection) {
            if (selection == null) delete columnSelections[index];
            else columnSelections[index] = selection;
            page = 1;
            render();
          },
        });
      });
      return el('th', { scope: 'col', class: column.className ?? '' }, el('div', { class: 'column-heading-control' }, sortButton, valueFilterButton));
    }));
    const filters = el('tr', { class: 'filter-row' }, ...columns.map((column, index) => {
      const input = el('input', { class: 'column-search', type: 'search', value: columnSearches[index] ?? '', placeholder: `Filter ${column.label}`, 'aria-label': `Filter ${column.label}`, 'data-focus-key': `column-${index}` });
      input.addEventListener('input', () => { columnSearches[index] = input.value; page = 1; render(`column-${index}`, input.selectionStart); });
      return el('th', { class: column.className ?? '' }, input);
    }));
    const bodyRows = pageRows.length
      ? pageRows.map((row) => el('tr', {}, ...columns.map((column) => renderTableCell(row, column))))
      : [el('tr', { class: 'table-empty-row' }, el('td', { colspan: columns.length }, 'No records match the current filters.'))];
    const body = el('tbody', {}, ...bodyRows);
    const tableContent = el('div', { class: 'table-scroll' }, el('table', {}, el('thead', {}, heading, filters), body));
    const previous = el('button', { class: 'page-button', type: 'button', disabled: page <= 1 }, 'Previous');
    const next = el('button', { class: 'page-button', type: 'button', disabled: page >= pageCount }, 'Next');
    previous.addEventListener('click', () => { page -= 1; render(); });
    next.addEventListener('click', () => { page += 1; render(); });
    const pagination = el('div', { class: 'pagination' }, previous, el('span', { class: 'table-count' }, `Page ${page} of ${pageCount}`), next);
    root.replaceChildren(toolbar, filterSummary, tableContent, pagination);
    if (focusKey) {
      const target = root.querySelector(`[data-focus-key="${focusKey}"]`);
      target?.focus();
      if (cursor != null && target?.setSelectionRange) target.setSelectionRange(cursor, cursor);
    }
  }
  return { setRows };
}

function renderTableCell(row, column) {
  const value = displayValue(row, column);
  const cell = el('td', { class: column.className ?? '' });
  if (!column.expandable) {
    cell.textContent = value;
    return cell;
  }
  const wrapper = el('div', { class: 'expandable-cell' }, el('span', { class: 'expandable-cell-text' }, value));
  if (value.length > 110) {
    const button = el('button', { class: 'expand-cell-button', type: 'button', 'aria-expanded': 'false' }, 'Expand contacts');
    button.addEventListener('click', () => {
      const expanded = wrapper.classList.toggle('is-expanded');
      cell.classList.toggle('is-expanded', expanded);
      button.textContent = expanded ? 'Collapse contacts' : 'Expand contacts';
      button.setAttribute('aria-expanded', String(expanded));
    });
    wrapper.append(button);
  }
  cell.append(wrapper);
  return cell;
}

function describeTableFilters(columns, globalSearch, columnSearches, columnSelections) {
  const conditions = [];
  if (globalSearch.trim()) conditions.push(`Search contains “${globalSearch.trim()}”`);
  for (const [index, value] of Object.entries(columnSearches)) {
    if (String(value).trim()) conditions.push(`${columns[index]?.label ?? 'Column'} contains “${String(value).trim()}”`);
  }
  for (const [index, selection] of Object.entries(columnSelections)) {
    conditions.push(`${columns[index]?.label ?? 'Column'} has ${selection.size} selected value${selection.size === 1 ? '' : 's'}`);
  }
  return conditions.length ? `Active table filters: ${conditions.join(' · ')}` : 'Active table filters: None.';
}

function openColumnValueFilter({ anchor, rows, column, selected, onApply }) {
  closeColumnValueFilter();
  const values = uniqueColumnValues(rows, column);
  const allKeys = new Set(values.map((item) => item.key));
  const working = new Set(selected instanceof Set ? selected : allKeys);
  const panel = el('section', { class: 'column-value-filter-panel', role: 'dialog', 'aria-label': `Filter ${column.label} values` });
  const search = el('input', { class: 'column-value-search', type: 'search', placeholder: 'Search values…', 'aria-label': `Search ${column.label} values` });
  const selectAll = el('input', { type: 'checkbox' });
  const selectAllLabel = el('label', { class: 'column-value-select-all' }, selectAll, el('span', {}, 'Select all visible values'));
  const list = el('div', { class: 'column-value-list' });

  function matchingValues() {
    const term = normalize(search.value);
    return term ? values.filter((item) => normalize(item.label).includes(term)) : values;
  }
  function renderValues() {
    const visible = matchingValues();
    selectAll.checked = visible.length > 0 && visible.every((item) => working.has(item.key));
    selectAll.indeterminate = visible.some((item) => working.has(item.key)) && !selectAll.checked;
    list.replaceChildren(...visible.map((item) => {
      const checkbox = el('input', { type: 'checkbox' });
      checkbox.checked = working.has(item.key);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) working.add(item.key); else working.delete(item.key);
        renderValues();
      });
      return el('label', { class: 'column-value-option' }, checkbox, el('span', { title: item.label }, item.label));
    }));
    if (!visible.length) list.append(el('div', { class: 'column-value-empty' }, 'No values match the search.'));
  }
  search.addEventListener('input', renderValues);
  selectAll.addEventListener('change', () => {
    for (const item of matchingValues()) {
      if (selectAll.checked) working.add(item.key); else working.delete(item.key);
    }
    renderValues();
  });
  const clear = el('button', { class: 'button button-quiet', type: 'button' }, 'Clear filter');
  const cancel = el('button', { class: 'button button-secondary', type: 'button' }, 'Cancel');
  const apply = el('button', { class: 'button button-primary', type: 'button' }, 'Apply');
  clear.addEventListener('click', () => { closeColumnValueFilter(); onApply(null); });
  cancel.addEventListener('click', closeColumnValueFilter);
  apply.addEventListener('click', () => {
    const selection = working.size === allKeys.size && [...allKeys].every((key) => working.has(key)) ? null : new Set(working);
    closeColumnValueFilter();
    onApply(selection);
  });
  panel.append(el('strong', {}, column.label), search, selectAllLabel, list, el('div', { class: 'column-value-actions' }, clear, cancel, apply));
  renderValues();
  document.body.append(panel);
  activeColumnFilterPanel = panel;
  const rect = anchor.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  panel.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - panelRect.width - 8))}px`;
  panel.style.top = `${Math.max(8, Math.min(rect.bottom + 5, innerHeight - panelRect.height - 8))}px`;
  search.focus();
  const outsideHandler = (event) => {
    if (!panel.contains(event.target) && event.target !== anchor) closeColumnValueFilter();
  };
  activeColumnFilterOutsideHandler = outsideHandler;
  setTimeout(() => {
    if (activeColumnFilterPanel === panel) addEventListener('pointerdown', outsideHandler);
  }, 0);
}

function closeColumnValueFilter() {
  if (activeColumnFilterOutsideHandler) removeEventListener('pointerdown', activeColumnFilterOutsideHandler);
  activeColumnFilterOutsideHandler = null;
  activeColumnFilterPanel?.remove();
  activeColumnFilterPanel = null;
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

function scrollPageTo(top) {
  scrollTo({ top, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

function updatePageProgress() {
  const maximum = Math.max(1, document.documentElement.scrollHeight - innerHeight);
  const percent = Math.min(100, Math.max(0, Math.round(scrollY / maximum * 100)));
  refs['page-progress-ring'].style.setProperty('--page-progress', `${percent * 3.6}deg`);
  refs['page-progress-ring'].setAttribute('aria-valuenow', String(percent));
  refs['page-progress-value'].textContent = `${percent}%`;
}

function toast(message) {
  refs.toast.textContent = message;
  refs.toast.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { refs.toast.hidden = true; }, 5000);
}

function configFormSection(title, note, ...content) {
  return el('section', { class: 'config-form-section' }, el('h3', {}, title), el('p', { class: 'config-form-note' }, note), ...content);
}

function configCheckRow(name, checked, found) {
  const input = el('input', { type: 'checkbox', value: name, checked });
  const row = el('label', { class: `config-check-row${found ? '' : ' is-warning'}`, 'data-label': name }, input, el('span', {}, name));
  if (!found) row.append(el('small', {}, 'Not found in current ESATS MO data; retained and ignored until available.'));
  return row;
}

function scopedApplicationRuleRow(organization, application, organizationNames, applicationsByOrganization) {
  const select = el('select', { class: 'config-select-input', 'data-config-field': 'organization', 'aria-label': 'Scoped maintaining organization' },
    el('option', { value: '' }, 'Select MO'),
    ...organizationNames.map((name) => el('option', { value: name, selected: normalize(name) === normalize(organization) }, name)),
  );
  const allApplications = [...new Set([...applicationsByOrganization.values()].flatMap((values) => [...values]))].sort(localeSort);
  const pickerId = `esats-config-app-${++configPickerSequence}`;
  const input = el('input', { class: 'config-text-input', type: 'text', value: application, list: pickerId, placeholder: 'Application name', 'data-config-field': 'application', 'aria-label': 'Scoped application' });
  const datalist = el('datalist', { id: pickerId }, ...allApplications.map((name) => el('option', { value: name })));
  const status = el('small', { class: 'config-match-status' });
  const update = () => {
    const available = applicationsByOrganization.get(normalize(select.value)) ?? new Set();
    const found = [...available].some((name) => normalize(name) === normalize(input.value));
    status.textContent = !input.value.trim() || found ? '' : 'Not found in the current ESATS inventory; this rule will be retained and ignored until it matches.';
    status.classList.toggle('is-warning', Boolean(status.textContent));
  };
  select.addEventListener('change', update);
  input.addEventListener('input', update);
  const row = el('div', { class: 'config-rule-row' }, select, el('div', { class: 'config-input-stack' }, input, datalist, status), configRemoveButton());
  update();
  return row;
}

function configValueRuleRow(value, options, matchType, placeholder) {
  const text = String(value ?? '').trim();
  const pickerId = `esats-config-value-${++configPickerSequence}`;
  const input = el('input', { class: 'config-text-input', type: 'text', value: text, list: pickerId, placeholder, 'data-config-value': 'true', 'aria-label': placeholder });
  const datalist = el('datalist', { id: pickerId }, ...options.map((name) => el('option', { value: name })));
  const status = el('small', { class: 'config-match-status' });
  const update = () => {
    const found = options.some((option) => configValuesMatch(input.value, option, matchType));
    status.textContent = !input.value.trim() || found ? '' : 'Not found in the current ESATS inventory; this exception will be retained and ignored until it matches.';
    status.classList.toggle('is-warning', Boolean(status.textContent));
  };
  input.addEventListener('input', update);
  const row = el('div', { class: 'config-rule-row app-only' }, el('div', { class: 'config-input-stack' }, input, datalist, status), configRemoveButton());
  update();
  return row;
}

function configRemoveButton() {
  const button = el('button', { class: 'config-remove-button', type: 'button', 'aria-label': 'Remove rule', title: 'Remove rule' }, '×');
  button.addEventListener('click', () => button.closest('.config-rule-row')?.remove());
  return button;
}

function configRuleValues(container) {
  return [...container.querySelectorAll('[data-config-value]')].map((input) => input.value.trim()).filter(Boolean);
}

function configValuesMatch(left, right, type) {
  if (type === 'manager' || type === 'person') {
    const a = personIdentity(left);
    const b = personIdentity(right);
    return Boolean((a.bemsId && b.bemsId && a.bemsId === b.bemsId) || (a.nameKey && a.nameKey === b.nameKey));
  }
  return normalize(left) === normalize(right);
}

function uniquePeopleOptions(applications, namesKey, idsKey) {
  const values = new Map();
  for (const application of applications) {
    const names = application[namesKey] ?? [];
    const ids = application[idsKey] ?? [];
    names.forEach((name, index) => {
      const value = `${name}${ids[index] ? ` (${ids[index]})` : ''}`.trim();
      const key = personIdentity(value);
      const identity = key.bemsId || key.nameKey;
      if (identity && !values.has(identity)) values.set(identity, value);
    });
  }
  return [...values.values()].sort(localeSort);
}

async function mapWithLimit(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function run() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

function localeSort(left, right) { return String(left).localeCompare(String(right), 'en', { sensitivity: 'base', numeric: true }); }
function column(key, label, value = null, options = {}) { return { key, label, ...options, ...(value ? { value: (row) => value(row[key], row) } : {}) }; }
function dateColumn(key, label) { return column(key, label, formatDate); }
function yesNo(value) { return value ? 'Yes' : 'No'; }
function retirementStatus(_, row) { return row.isRetired && row.isMarkedForDeletion ? 'Retired and marked for deletion' : row.isRetired ? 'Retired' : 'Marked for deletion'; }
function formatDate(value) {
  if (!value || Number.isNaN(Date.parse(value))) return '';
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value));
}
function formatDateTime(value) {
  if (!value || Number.isNaN(Date.parse(value))) return 'Not available';
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
