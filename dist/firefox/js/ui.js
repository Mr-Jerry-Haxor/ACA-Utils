import { fetchAllComplianceData, fetchApplicationInventory } from './api.js';
import { cloneDefaultConfig } from './default-config.js';
import { loadConfig, saveConfig } from './config-store.js';
import { evaluateDashboard, normalizeText, organizationKey, organizationLabel } from './logic.js';
import { copyRows, displayValue, exportExcel, exportJson } from './export.js';

const state = { config: null, raw: null, dashboard: null, controller: null };
const refs = Object.fromEntries(['status-line','summary-strip','metric-grid','dr-alerts','modal-backdrop','modal','modal-kicker','modal-title','modal-subtitle','modal-toolbar','modal-content','modal-footer','toast'].map((id) => [id, document.getElementById(id)]));

const COMMON_COLUMNS = [
  { key: 'Application', label: 'Application', value: applicationName },
  { key: 'Application_Id', label: 'Application ID', value: applicationId },
  { key: 'Maintaining_Organization', label: 'Maintenance Organization', value: (row) => row.Maintaining_Organization ?? row._support?.Maintaining_Organization },
  { key: 'Application_Manager', label: 'Application Manager', value: (row) => row.Application_Manager ?? row._support?.Application_Manager },
  { key: 'Application_Security_Administrator', label: 'ASA', value: (row) => row.Application_Security_Administrator ?? row._support?.Application_Security_Administrator },
];

const METRIC_COLUMNS = {
  system: [...COMMON_COLUMNS, { key: '_status', label: 'Status' }, { key: 'System_Criticality_Due_Date', label: 'Due Date' }, { key: 'Recovery_Level', label: 'Recovery Level' }, { key: 'AEC_Rating', label: 'AEC Rating' }],
  nist: [...COMMON_COLUMNS, { key: '_status', label: 'Status' }, { key: 'Has_CUI', label: 'Has CUI' }, { key: 'Overall_NIST_Compliance', label: 'Source Compliance' }, { key: 'Nist_Assessment_Completion_Date', label: 'Completed Date' }, { key: 'NIST_Next_Due_Date', label: 'Calculated Next Due' }, { key: 'Open_Findings', label: 'Open Findings' }, reasonColumn()],
  recovery: [...COMMON_COLUMNS, { key: '_status', label: 'Calculated Status' }, { key: 'Recovery_Level', label: 'Recovery Level' }, { key: 'Plans_Complete', label: 'Plan Complete' }, { key: 'Plans_Current', label: 'Plan Current' }, { key: 'Plans_Tested_And_Validated', label: 'Tested and Validated' }, { key: 'Overall_DueDate', label: 'Overall Due Date' }, { key: 'Orientation_Date', label: 'Orientation' }, { key: 'Table_Top_Date', label: 'Tabletop' }, { key: 'Drill_Date', label: 'Drill' }, { key: 'Functional_Date', label: 'Functional Exercise' }, reasonColumn()],
  risk: [...COMMON_COLUMNS, { key: '_status', label: 'Status' }, { key: 'Risk_Prolifer_Current', label: 'Source Status' }, { key: 'Risk_Prolifer_Due_Date', label: 'Due Date' }, { key: 'AEC_rating', label: 'AEC Rating' }],
  access: [...COMMON_COLUMNS, { key: '_status', label: 'Status' }, { key: 'ACP_Reviewed', label: 'ACP Reviewed' }, { key: 'ACP_Review_Due_Date', label: 'Review Due Date' }, { key: 'Recovery_Level', label: 'Recovery Level' }],
};

document.getElementById('close-button').addEventListener('click', () => parent.postMessage({ source: 'aca-dashboard', type: 'close' }, '*'));
document.getElementById('refresh-button').addEventListener('click', refreshData);
document.getElementById('supported-apps-button').addEventListener('click', openSupportedApplications);
document.getElementById('config-button').addEventListener('click', openConfiguration);
document.getElementById('modal-close').addEventListener('click', closeModal);
refs['modal-backdrop'].addEventListener('click', (event) => { if (event.target === refs['modal-backdrop']) closeModal(); });
addEventListener('keydown', (event) => { if (event.key === 'Escape' && !refs['modal-backdrop'].hidden) closeModal(); });

initialize().catch(showFatal);

async function initialize() {
  state.config = await loadConfig();
  await refreshData();
}

async function refreshData() {
  state.controller?.abort();
  state.controller = new AbortController();
  setLoading(true, 'Loading five compliance datasets and rollups…');
  try {
    state.raw = await fetchAllComplianceData(state.config.bemsId, { signal: state.controller.signal });
    state.dashboard = evaluateDashboard(state.raw, state.config);
    renderDashboard();
    setLoading(false, `${formatNumber(state.dashboard.supportedApps.length)} supported applications after configuration filters.`);
  } catch (error) {
    if (error.name === 'AbortError') return;
    setLoading(false, `Unable to load compliance data: ${error.message}`);
    refs['metric-grid'].replaceChildren(emptyState('Data could not be loaded. Confirm corporate-network access and sign-in, then refresh.'));
  }
}

function renderDashboard() {
  renderSummary();
  refs['metric-grid'].replaceChildren(...state.dashboard.metrics.map(metricCard));
  renderRecoveryAlerts();
}

function renderSummary() {
  const metrics = state.dashboard.metrics;
  const total = metrics.reduce((sum, metric) => sum + metric.total, 0);
  const compliant = metrics.reduce((sum, metric) => sum + metric.compliant, 0);
  const nonCompliant = total - compliant;
  const percent = total ? compliant / total * 100 : 0;
  const overall = el('article', { class: 'summary-card' },
    el('span', {}, 'Compliance across dashboard records'),
    el('strong', {}, `${percent.toFixed(1)}%`),
    el('small', {}, `${formatNumber(compliant)} compliant of ${formatNumber(total)} evaluated records`),
    el('div', { class: 'overall-bar', role: 'img', 'aria-label': `${percent.toFixed(1)} percent compliant` },
      el('span', { class: 'bar-compliant', style: `width:${percent}%` }),
      el('span', { class: 'bar-noncompliant', style: `width:${100 - percent}%` }),
    ),
  );
  refs['summary-strip'].replaceChildren(
    overall,
    summaryCard('Supported applications', state.dashboard.supportedApps.length, 'Based on MO, scoped app, manager, and app exception rules'),
    summaryCard('Non-compliant records', nonCompliant, 'Open any metric card for the application list'),
    summaryCard('Deliverables', metrics.length, 'System Criticality, NIST, DR, Risk Profiler, and ACP'),
  );
}

function metricCard(metric) {
  const card = el('article', { class: `metric-card${metric.id === 'recovery' && metric.rows.some((row) => row._validationIncomplete || row._functionalPending) ? ' has-alert' : ''}` });
  const donut = el('div', { class: 'donut', style: `--value:${metric.compliantPercent.toFixed(2)}`, role: 'img', 'aria-label': `${metric.title}: ${metric.compliantPercent.toFixed(1)} percent compliant` },
    el('strong', {}, `${metric.compliantPercent.toFixed(1)}%`),
  );
  const compliant = countButton('Compliant', metric.compliant, metric.compliantPercent, 'compliant', () => openMetric(metric, metric.compliantRows, 'Compliant applications'));
  const nonCompliant = countButton('Non-compliant', metric.nonCompliant, metric.nonCompliantPercent, 'noncompliant', () => openMetric(metric, metric.nonCompliantRows, 'Non-compliant applications'));
  const content = el('div', { class: 'metric-content' },
    el('h3', {}, metric.title),
    el('span', { class: 'freshness', title: metric.extract.raw ? `Source value: ${metric.extract.raw}` : '' }, `Last extracted: ${metric.extract.formatted}`),
    el('div', { class: 'count-grid' }, compliant, nonCompliant),
  );
  const expand = el('button', { class: 'link-button', type: 'button' }, 'Expand details');
  expand.addEventListener('click', () => openMetric(metric, metric.rows, 'All evaluated applications'));
  card.append(donut, content, el('div', { class: 'metric-actions' }, el('p', { class: 'metric-note' }, metric.note), expand));
  return card;
}

function countButton(label, count, percent, className, onClick) {
  const button = el('button', { class: `count-button ${className}`, type: 'button', 'aria-label': `${label}: ${count}, ${percent.toFixed(1)} percent` },
    el('span', {}, label), el('strong', {}, formatNumber(count)), el('small', {}, `${percent.toFixed(1)}%`),
  );
  button.addEventListener('click', onClick);
  return button;
}

function renderRecoveryAlerts() {
  const recovery = state.dashboard.metrics.find((metric) => metric.id === 'recovery');
  const validationIncomplete = recovery.rows.filter((row) => row._validationIncomplete);
  const functionalPending = recovery.rows.filter((row) => row._functionalPending);
  refs['dr-alerts'].hidden = validationIncomplete.length === 0 && functionalPending.length === 0;
  if (refs['dr-alerts'].hidden) return;
  const heading = el('div', {}, el('p', { class: 'eyebrow' }, 'Recovery Plan attention'), el('h2', {}, 'Approved plans with validation gaps'));
  const grid = el('div', { class: 'alert-grid' });
  grid.append(
    alertItem('Plan validations incomplete', validationIncomplete.length, 'Plan Complete is compliant while Plan Current is non-compliant.', () => openMetric(recovery, validationIncomplete, 'Plan validations incomplete')),
    alertItem('RL4/RL5 functional exercise pending', functionalPending.length, 'The required annual functional exercise is missing or outside the annual window.', () => openMetric(recovery, functionalPending, 'Functional exercise pending')),
  );
  refs['dr-alerts'].replaceChildren(heading, grid);
}

function alertItem(title, count, description, onClick) {
  const button = el('button', { class: 'link-button', type: 'button' }, 'View applications');
  button.addEventListener('click', onClick);
  return el('article', { class: 'alert-item' }, el('h3', {}, title), el('strong', {}, formatNumber(count)), el('p', {}, description), button);
}

function openMetric(metric, rows, subtitle) {
  openTableModal({
    kicker: metric.title,
    title: subtitle,
    subtitle: `${formatNumber(rows.length)} records. Last extracted ${metric.extract.formatted}.`,
    rows,
    columns: METRIC_COLUMNS[metric.id],
    filename: `${metric.id}-${subtitle}`,
  });
}

function openSupportedApplications() {
  if (!state.dashboard) return;
  openTableModal({
    kicker: 'Configuration result', title: 'Supported Applications',
    subtitle: `${formatNumber(state.dashboard.supportedApps.length)} applications match the current conditional configuration.`,
    rows: state.dashboard.supportedApps,
    columns: [...COMMON_COLUMNS, { key: 'Application_Type', label: 'Application Type' }, { key: 'Recovery_Level', label: 'Recovery Level' }, { key: 'AEC_Rating', label: 'AEC Rating' }, { key: 'System_Criticality_Due_Date', label: 'System Criticality Due' }],
    filename: 'supported-applications',
  });
}

function openTableModal({ kicker, title, subtitle, rows, columns, filename }) {
  openModal(kicker, title, subtitle);
  const pageSize = 25;
  let page = 1;
  let search = '';
  const input = el('input', { class: 'search-input', type: 'search', placeholder: 'Search all columns', 'aria-label': 'Search table' });
  const copy = el('button', { class: 'button button-secondary', type: 'button' }, 'Copy data');
  const exportButton = el('button', { class: 'button button-primary', type: 'button' }, 'Export to Excel');
  refs['modal-toolbar'].append(el('div', { class: 'toolbar-group' }, input), el('div', { class: 'toolbar-group' }, copy, exportButton));

  const filteredRows = () => !search ? rows : rows.filter((row) => columns.some((column) => normalizeText(displayValue(row, column)).includes(search)));
  const render = () => {
    const filtered = filteredRows();
    const maxPage = Math.max(1, Math.ceil(filtered.length / pageSize));
    page = Math.min(page, maxPage);
    const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);
    refs['modal-content'].replaceChildren(renderTable(pageRows, columns));
    const previous = el('button', { class: 'button button-secondary', type: 'button', disabled: page <= 1 }, 'Previous');
    const next = el('button', { class: 'button button-secondary', type: 'button', disabled: page >= maxPage }, 'Next');
    previous.addEventListener('click', () => { page -= 1; render(); });
    next.addEventListener('click', () => { page += 1; render(); });
    refs['modal-footer'].replaceChildren(el('span', {}, `${formatNumber(filtered.length)} records · Page ${page} of ${maxPage}`), el('div', { class: 'toolbar-group' }, previous, next));
  };
  input.addEventListener('input', () => { search = normalizeText(input.value); page = 1; render(); });
  copy.addEventListener('click', async () => {
    try { await copyRows(filteredRows(), columns); toast(`Copied ${formatNumber(filteredRows().length)} records.`); } catch { toast('Clipboard access was unavailable.'); }
  });
  exportButton.addEventListener('click', () => exportExcel(filteredRows(), columns, filename));
  render();
}

async function openConfiguration() {
  openModal('Conditional rules', 'Supported MO Configuration', 'Loading the application inventory from /Metric/GetMetricsDataDetails?bemsid=1600103…');
  refs['modal-content'].replaceChildren(emptyState('Loading current application inventory…'));
  try {
    const inventory = await fetchApplicationInventory('1600103');
    renderConfiguration(inventory);
  } catch (error) {
    refs['modal-content'].replaceChildren(emptyState(`Unable to load configuration inventory: ${error.message}`));
  }
}

function renderConfiguration(inventory) {
  refs['modal-subtitle'].textContent = 'Only conditional MO, scoped-application, manager-exception, and application-exception rules are stored in IndexedDB.';
  refs['modal-toolbar'].replaceChildren();
  refs['modal-footer'].replaceChildren();
  const organizations = [...new Set(inventory.map((row) => organizationLabel(row.Maintaining_Organization)).filter(Boolean))].sort(localeSort);
  const besApps = inventory.filter((row) => organizationKey(row.Maintaining_Organization) === organizationKey('Boeing Enterprise Security')).map((row) => String(row.Application ?? '').trim()).filter(Boolean).sort(localeSort);
  const selectedOrganizations = new Set(state.config.includedOrganizations.map(organizationKey));
  const selectedBesApps = new Set((state.config.restrictedOrganizations['Boeing Enterprise Security'] ?? []).map(normalizeText));

  const orgList = el('div', { class: 'check-list' });
  for (const organization of organizations) orgList.append(checkRow(organization, selectedOrganizations.has(organizationKey(organization)), 'organization'));
  const appList = el('div', { class: 'check-list' });
  for (const app of besApps) appList.append(checkRow(app, selectedBesApps.has(normalizeText(app)), 'bes-app'));
  const managerList = el('div', { class: 'rule-list', id: 'manager-rules' });
  for (const rule of state.config.managerExceptions) managerList.append(managerRuleRow(rule, organizations));
  const appExceptionList = el('div', { class: 'rule-list', id: 'application-rules' });
  for (const name of state.config.applicationExceptions) appExceptionList.append(appExceptionRow(name));

  const addManager = el('button', { class: 'button button-secondary', type: 'button' }, 'Add manager exception');
  addManager.addEventListener('click', () => managerList.append(managerRuleRow({ organization: organizations[0], manager: '' }, organizations)));
  const addApp = el('button', { class: 'button button-secondary', type: 'button' }, 'Add application exception');
  addApp.addEventListener('click', () => appExceptionList.append(appExceptionRow('')));

  const layout = el('div', { class: 'config-layout' },
    el('div', {},
      el('section', { class: 'config-section' }, el('h3', {}, 'Included maintenance organizations'), el('p', { class: 'config-note' }, 'Applications are included when their exact normalized maintenance organization is selected.'), orgList),
      el('section', { class: 'config-section' }, el('h3', {}, 'Boeing Enterprise Security applications'), el('p', { class: 'config-note' }, 'This MO is restricted to the selected applications.'), appList),
    ),
    el('div', {},
      el('section', { class: 'config-section' }, el('h3', {}, 'Application manager exceptions'), el('p', { class: 'config-note' }, 'Exclude applications only when both the MO and normalized manager name match.'), managerList, addManager),
      el('section', { class: 'config-section' }, el('h3', {}, 'Application exceptions'), el('p', { class: 'config-note' }, 'Exclude these application names regardless of MO.'), appExceptionList, addApp),
    ),
  );
  refs['modal-content'].replaceChildren(layout);

  const importInput = el('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  const importButton = el('button', { class: 'button button-secondary', type: 'button' }, 'Import JSON');
  const exportButton = el('button', { class: 'button button-secondary', type: 'button' }, 'Export JSON');
  const resetButton = el('button', { class: 'button button-danger', type: 'button' }, 'Reset to workbook defaults');
  const saveButton = el('button', { class: 'button button-primary', type: 'button' }, 'Save configuration');
  importButton.addEventListener('click', () => importInput.click());
  exportButton.addEventListener('click', () => exportJson(state.config, 'supported-mo-configuration'));
  resetButton.addEventListener('click', async () => { state.config = await saveConfig(cloneDefaultConfig()); renderConfiguration(inventory); toast('Workbook defaults restored.'); await applyConfig(); });
  importInput.addEventListener('change', async () => {
    const file = importInput.files?.[0];
    if (!file) return;
    try { state.config = await saveConfig(JSON.parse(await file.text())); renderConfiguration(inventory); toast('Configuration imported.'); await applyConfig(); }
    catch (error) { toast(`Import failed: ${error.message}`); }
  });
  saveButton.addEventListener('click', async () => {
    try {
      const includedOrganizations = [...orgList.querySelectorAll('input:checked')].map((input) => input.value);
      const restrictedOrganizations = { 'Boeing Enterprise Security': [...appList.querySelectorAll('input:checked')].map((input) => input.value) };
      const managerExceptions = [...managerList.querySelectorAll('.rule-row')].map((row) => ({ organization: row.querySelector('select').value, manager: row.querySelector('input').value })).filter((rule) => rule.manager.trim());
      const applicationExceptions = [...appExceptionList.querySelectorAll('input')].map((input) => input.value).filter((value) => value.trim());
      state.config = await saveConfig({ schemaVersion: 1, bemsId: '1600103', includedOrganizations, restrictedOrganizations, managerExceptions, applicationExceptions });
      await applyConfig();
      closeModal();
      toast('Supported application configuration saved.');
    } catch (error) { toast(`Configuration was not saved: ${error.message}`); }
  });
  refs['modal-footer'].append(el('div', { class: 'toolbar-group' }, importInput, importButton, exportButton, resetButton), saveButton);
}

async function applyConfig() {
  if (state.raw) {
    state.dashboard = evaluateDashboard(state.raw, state.config);
    renderDashboard();
    refs['status-line'].textContent = `${formatNumber(state.dashboard.supportedApps.length)} supported applications after configuration filters.`;
  }
}

function managerRuleRow(rule, organizations) {
  const select = el('select', { class: 'select-input', 'aria-label': 'Maintenance organization' });
  for (const organization of organizations) select.append(el('option', { value: organization, selected: organizationKey(organization) === organizationKey(rule.organization) }, organization));
  const input = el('input', { class: 'text-input', type: 'text', value: rule.manager, placeholder: 'Manager name', 'aria-label': 'Application manager' });
  return removableRuleRow([select, input]);
}

function appExceptionRow(name) {
  const input = el('input', { class: 'text-input', type: 'text', value: name, placeholder: 'Application name', 'aria-label': 'Excluded application name' });
  return removableRuleRow([input], 'app-only');
}

function removableRuleRow(items, extraClass = '') {
  const remove = el('button', { class: 'icon-button', type: 'button', 'aria-label': 'Remove rule' }, '×');
  const row = el('div', { class: `rule-row ${extraClass}`.trim() }, ...items, remove);
  remove.addEventListener('click', () => row.remove());
  return row;
}

function checkRow(value, checked, name) {
  const input = el('input', { type: 'checkbox', name, value, checked });
  return el('label', { class: 'check-row' }, input, el('span', {}, value));
}

function renderTable(rows, columns) {
  if (!rows.length) return emptyState('No matching records.');
  const head = el('thead', {}, el('tr', {}, ...columns.map((column) => el('th', { scope: 'col' }, column.label))));
  const body = el('tbody');
  for (const row of rows) {
    const cells = columns.map((column) => {
      const value = displayValue(row, column);
      if (column.key === '_status') return el('td', {}, el('span', { class: `status-pill ${row._compliant ? 'status-compliant' : 'status-noncompliant'}` }, value));
      return el('td', {}, value);
    });
    body.append(el('tr', {}, ...cells));
  }
  return el('div', { class: 'table-wrap' }, el('table', {}, head, body));
}

function openModal(kicker, title, subtitle) {
  refs['modal-kicker'].textContent = kicker;
  refs['modal-title'].textContent = title;
  refs['modal-subtitle'].textContent = subtitle;
  refs['modal-toolbar'].replaceChildren();
  refs['modal-content'].replaceChildren();
  refs['modal-footer'].replaceChildren();
  refs['modal-backdrop'].hidden = false;
  document.getElementById('modal-close').focus();
}

function closeModal() {
  refs['modal-backdrop'].hidden = true;
}

function setLoading(loading, text) {
  refs['status-line'].textContent = text;
  document.getElementById('refresh-button').disabled = loading;
}

function showFatal(error) {
  refs['status-line'].textContent = `Dashboard initialization failed: ${error.message}`;
}

function toast(message) {
  refs.toast.textContent = message;
  refs.toast.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { refs.toast.hidden = true; }, 4000);
}

function summaryCard(label, value, note) {
  return el('article', { class: 'summary-card' }, el('span', {}, label), el('strong', {}, formatNumber(value)), el('small', {}, note));
}

function emptyState(message) { return el('div', { class: 'empty-state' }, message); }
function reasonColumn() { return { key: '_reasons', label: 'Non-compliance Reason', value: (row) => row._reasons }; }
function applicationName(row) { return row.Application ?? row.Application_Name ?? row.Asset_Name ?? row._support?.Application ?? ''; }
function applicationId(row) { return row.Application_Id ?? row.Identifier ?? row.Asset_ID ?? row._support?.Application_Id ?? ''; }
function formatNumber(value) { return new Intl.NumberFormat('en-IN').format(value); }
function localeSort(a, b) { return a.localeCompare(b, 'en', { sensitivity: 'base' }); }

function el(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === false || value == null) continue;
    if (key === 'class') node.className = value;
    else if (key === 'style') node.setAttribute('style', value);
    else if (key === 'checked' || key === 'selected' || key === 'disabled' || key === 'hidden') node[key] = Boolean(value);
    else if (key in node && !key.startsWith('aria-')) node[key] = value;
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) node.append(child instanceof Node ? child : document.createTextNode(String(child ?? '')));
  return node;
}
