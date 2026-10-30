import { fetchAllComplianceData, fetchApplicationInventory } from './api.js';
import { cloneDefaultConfig, DEFAULT_CONFIG_DATE_LABEL } from './default-config.js';
import { loadConfig, saveConfig } from './config-store.js';
import { collectNonCompliantRecords, evaluateDashboard, getBlankAsaApplications, normalizeText, organizationKey, organizationLabel, parseDate, personKey } from './logic.js';
import { displayValue, exportExcel, exportJson } from './export.js';
import { applyTableState, nextSort, uniqueColumnValues } from './table-state.js';
import { findInventoryMatch, searchInventoryValues, uniqueInventoryValues } from './inventory-options.js';
import { annualCompletionFromDue, annualDueFromCompletion, calculateArchivePoint, calculateForecastMetric, deriveArchiveStatus, mondayCheckpoints, recoveryOrientationDue } from './forecast-archive.js';

const state = { config: null, raw: null, dashboard: null, controller: null, analyticsRefreshedAt: null, analyticsRefreshPromise: null };
let columnFilterOutsideHandler = null;
let inventoryPickerSequence = 0;
const refs = Object.fromEntries(['status-line','summary-strip','metric-grid','forecast-cadence','forecast-period','forecast-target','forecast-summary','forecast-details-button','forecast-refresh-button','forecast-live-status','archive-chart','archive-refresh-button','archive-live-status','modal-backdrop','modal','modal-kicker','modal-title','modal-subtitle','modal-toolbar','modal-content','modal-footer','toast'].map((id) => [id, document.getElementById(id)]));

const COMMON_COLUMNS = [
  { key: 'Application', label: 'Application', value: applicationName },
  { key: 'Application_Id', label: 'Application ID', value: applicationId },
  { key: 'Maintaining_Organization', label: 'Maintenance Organization', value: (row) => row.Maintaining_Organization ?? row._support?.Maintaining_Organization },
  { key: 'Application_Manager', label: 'Application Manager', value: (row) => row.Application_Manager ?? row._support?.Application_Manager },
  { key: 'Application_Security_Administrator', label: 'ASA', value: (row) => row.Application_Security_Administrator ?? row._support?.Application_Security_Administrator },
];

const METRIC_COLUMNS = {
  system: [...COMMON_COLUMNS, { key: '_status', label: 'Status' }, { key: 'System_Criticality_Due_Date', label: 'Due Date' }, { key: 'Recovery_Level', label: 'Recovery Level' }, { key: 'AEC_Rating', label: 'AEC Rating' }],
  nist: [...COMMON_COLUMNS, { key: '_nistPopulationStatus', label: 'NIST Population' }, { key: 'Overall_NIST_Compliance', label: 'Existing Status' }, { key: '_sowStatus', label: 'Compliant as per SOW' }, { key: 'Has_CUI', label: 'Has CUI' }, { key: 'Nist_Assessment_Completion_Date', label: 'Completed Date' }, { key: 'NIST_Next_Due_Date', label: 'Calculated Next Due' }, { key: 'Open_Findings', label: 'Number of Findings' }, { key: '_sowBasis', label: 'SOW Basis' }, reasonColumn()],
  recovery: [COMMON_COLUMNS[0], { key: 'Plan_Name', label: 'Plan Name' }, ...COMMON_COLUMNS.slice(1), { key: '_status', label: 'Calculated Status' }, { key: 'Recovery_Level', label: 'Recovery Level' }, { key: 'Plans_Complete', label: 'Plan Complete' }, { key: 'Plans_Current', label: 'Plan Current' }, { key: 'Plans_Tested_And_Validated', label: 'Tested and Validated' }, { key: 'Overall_DueDate', label: 'Overall Due Date' }, { key: 'Orientation_Date', label: 'Orientation' }, { key: 'Table_Top_Date', label: 'Tabletop' }, { key: 'Drill_Date', label: 'Drill' }, { key: 'Functional_Date', label: 'Functional Exercise Date' }, { key: '_functionalTest', label: 'Functional Test' }, { key: '_recoveryAttention', label: 'Recovery Attention' }, reasonColumn()],
  risk: [...COMMON_COLUMNS, { key: '_status', label: 'Status' }, { key: 'Risk_Prolifer_Current', label: 'Source Status' }, { key: 'Risk_Prolifer_Due_Date', label: 'Due Date' }, { key: 'AEC_rating', label: 'AEC Rating' }],
  access: [...COMMON_COLUMNS, { key: '_status', label: 'Status' }, { key: 'ACP_Reviewed', label: 'ACP Reviewed' }, { key: 'ACP_Review_Due_Date', label: 'Review Due Date' }, { key: 'Recovery_Level', label: 'Recovery Level' }],
};

const OVERALL_NONCOMPLIANT_COLUMNS = [
  { key: '_deliverable', label: 'Deliverable' },
  ...COMMON_COLUMNS,
  { key: 'Plan_Name', label: 'Plan Name' },
  { key: 'Plan_Author', label: 'Plan Author' },
  { key: 'Application_Type', label: 'Application Type', value: (row) => row.Application_Type ?? row._support?.Application_Type },
  { key: 'Application_Manager_BEMSID', label: 'Application Manager BEMSID', value: (row) => row.Application_Manager_BEMSID ?? row._support?.Application_Manager_BEMSID },
  { key: 'DirectReport', label: 'Direct Report' },
  { key: '_status', label: 'Dashboard Status' },
  { key: '_sourceStatus', label: 'Existing/Source Status', value: sourceStatus },
  { key: '_metricDueDate', label: 'Due Date', value: metricDueDate },
  { key: 'Recovery_Level', label: 'Recovery Level' },
  { key: '_aecRating', label: 'AEC Rating', value: (row) => row.AEC_Rating ?? row.AEC_rating ?? row._support?.AEC_Rating },
  { key: 'Has_CUI', label: 'Has CUI' },
  { key: 'Open_Findings', label: 'Number of Findings' },
  { key: 'Nist_Assessment_Completion_Date', label: 'NIST Completed Date' },
  { key: 'NIST_Next_Due_Date', label: 'NIST Calculated Next Due' },
  { key: '_sowStatus', label: 'Compliant as per SOW' },
  { key: '_sowBasis', label: 'SOW Basis' },
  { key: 'Assessment_View_URL', label: 'Assessment URL' },
  { key: 'Asset_Phase', label: 'Asset Phase' },
  { key: 'Asset_Type', label: 'Asset Type' },
  { key: 'Responsible_Person', label: 'Responsible Person' },
  { key: 'Responsible_Person_BemsID', label: 'Responsible Person BEMSID' },
  { key: 'Primary_Contact', label: 'Primary Contact' },
  { key: 'Primary_Contact_BemsID', label: 'Primary Contact BEMSID' },
  { key: 'Plans_Compliant_Overall', label: 'Plan Overall Status' },
  { key: 'Plans_Complete', label: 'Plan Complete' },
  { key: 'Plans_Current', label: 'Plan Current' },
  { key: 'Plans_Tested_And_Validated', label: 'Plan Tested and Validated' },
  { key: 'Maintenance_Approval_Date', label: 'Maintenance Approval Date' },
  { key: 'Maintenance_Due_Date', label: 'Maintenance Due Date' },
  { key: 'Orientation_Date', label: 'Orientation Date' },
  { key: 'Table_Top_Date', label: 'Tabletop Date' },
  { key: 'Drill_Date', label: 'Drill Date' },
  { key: 'Functional_Date', label: 'Functional Exercise Date' },
  reasonColumn(),
];

const FORECAST_COLUMNS = [
  { key: '_deliverable', label: 'Deliverable' },
  ...COMMON_COLUMNS,
  { key: '_forecastDueDate', label: 'Due Date' },
  { key: '_forecastAction', label: 'Suggested Action' },
  { key: '_forecastNeeded', label: 'Needed for Target' },
  { key: '_status', label: 'Current Status' },
  { key: '_sourceStatus', label: 'Existing/Source Status', value: sourceStatus },
  { key: 'Recovery_Level', label: 'Recovery Level' },
  reasonColumn(),
];

document.getElementById('close-button').addEventListener('click', () => parent.postMessage({ source: 'aca-dashboard', type: 'close' }, '*'));
document.getElementById('refresh-button').addEventListener('click', refreshData);
document.getElementById('new-applications-button').addEventListener('click', openNewApplications);
document.getElementById('supported-apps-button').addEventListener('click', openSupportedApplications);
document.getElementById('config-button').addEventListener('click', openConfiguration);
refs['forecast-cadence'].addEventListener('change', renderForecast);
refs['forecast-period'].addEventListener('change', renderForecast);
refs['forecast-target'].addEventListener('input', renderForecast);
refs['forecast-details-button'].addEventListener('click', openForecastDetails);
refs['forecast-refresh-button'].addEventListener('click', refreshAnalyticsData);
refs['archive-refresh-button'].addEventListener('click', refreshAnalyticsData);
document.getElementById('modal-close').addEventListener('click', closeModal);
refs['modal-backdrop'].addEventListener('click', (event) => { if (event.target === refs['modal-backdrop']) closeModal(); });
refs['modal-content'].addEventListener('scroll', () => {
  for (const suggestions of document.querySelectorAll('.inventory-suggestions')) suggestions.hidden = true;
  for (const input of document.querySelectorAll('.inventory-picker-input')) input.setAttribute('aria-expanded', 'false');
}, { passive: true });
addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (document.getElementById('column-value-filter-panel')) closeColumnValueFilter();
  else if (!refs['modal-backdrop'].hidden) closeModal();
});

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
    state.analyticsRefreshedAt = new Date();
    renderDashboard();
    setAnalyticsStatus('ready');
    setLoading(false, `${formatNumber(state.dashboard.supportedApps.length)} supported applications after configuration filters.`);
  } catch (error) {
    if (error.name === 'AbortError') return;
    setLoading(false, `Unable to load compliance data: ${error.message}`);
    setAnalyticsStatus('error', error.message);
    refs['metric-grid'].replaceChildren(emptyState('Data could not be loaded. Confirm corporate-network access and sign-in, then refresh.'));
  }
}

async function refreshAnalyticsData() {
  if (state.analyticsRefreshPromise) return state.analyticsRefreshPromise;
  setAnalyticsStatus('loading');
  state.analyticsRefreshPromise = (async () => {
    try {
      const raw = await fetchAllComplianceData(state.config.bemsId);
      state.raw = raw;
      state.dashboard = evaluateDashboard(raw, state.config);
      state.analyticsRefreshedAt = new Date();
      renderDashboard();
      setAnalyticsStatus('ready');
      refs['status-line'].textContent = `${formatNumber(state.dashboard.supportedApps.length)} supported applications. Forecast and archive refreshed from live website data.`;
      return true;
    } catch (error) {
      setAnalyticsStatus('error', error.message);
      toast(`Live compliance refresh failed: ${error.message}`);
      return false;
    } finally {
      state.analyticsRefreshPromise = null;
    }
  })();
  return state.analyticsRefreshPromise;
}

function setAnalyticsStatus(status, detail = '') {
  const controls = [refs['forecast-refresh-button'], refs['archive-refresh-button']];
  for (const button of controls) if (button) button.disabled = status === 'loading';
  const label = status === 'loading'
    ? 'Refreshing live data…'
    : status === 'error'
      ? `Live refresh failed${detail ? `: ${detail}` : ''}`
      : state.analyticsRefreshedAt
        ? `Live data refreshed ${formatLiveRefreshTime(state.analyticsRefreshedAt)}`
        : 'Waiting for live data';
  for (const id of ['forecast-live-status', 'archive-live-status']) {
    const node = refs[id];
    if (!node) continue;
    node.textContent = label;
    node.classList.toggle('is-loading', status === 'loading');
    node.classList.toggle('is-error', status === 'error');
  }
}

function renderDashboard() {
  renderSummary();
  refs['metric-grid'].replaceChildren(...state.dashboard.metrics.map(metricCard));
  renderForecast();
  renderArchive();
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
    summaryCard('Supported applications', state.dashboard.supportedApps.length, 'Based on MO, scoped app, manager, ASA, and application exception rules'),
    summaryCard('Non-compliant records', nonCompliant, 'Combined results from all five deliverables', { label: 'Expand details', onClick: openOverallNonCompliant }),
    summaryCard('Deliverables', metrics.length, 'SCMP, Recovery Plan, Risk Profiler, ACP, and NIST'),
  );
}

function openOverallNonCompliant() {
  const rows = collectNonCompliantRecords(state.dashboard.metrics);
  openTableModal({
    kicker: 'All deliverables',
    title: 'Overall non-compliant records',
    subtitle: `${formatNumber(rows.length)} non-compliant records collected across the five dashboard deliverables.`,
    rows,
    columns: OVERALL_NONCOMPLIANT_COLUMNS,
    filename: 'all-non-compliant-records',
  });
}

function metricCard(metric) {
  const card = el('article', { class: `metric-card${metric.id === 'recovery' && metric.rows.some((row) => row._validationIncomplete || row._functionalPending) ? ' has-alert' : ''}` });
  const donut = el('div', { class: 'donut', style: `--value:${metric.compliantPercent.toFixed(2)}`, role: 'img', 'aria-label': `${metric.title}: ${metric.compliantPercent.toFixed(1)} percent compliant` },
    el('strong', {}, `${metric.compliantPercent.toFixed(1)}%`),
  );
  const compliant = countButton('Compliant', metric.compliant, metric.compliantPercent, 'compliant', () => openMetric(metric, metric.compliantRows, 'Compliant applications'));
  const nonCompliant = countButton('Non-compliant', metric.nonCompliant, metric.nonCompliantPercent, 'noncompliant', () => openMetric(metric, metric.nonCompliantRows, 'Non-compliant applications'));
  const total = el('button', { class: 'metric-total', type: 'button', 'aria-label': `${metric.title}: ${metric.total} applications considered` },
    el('span', {}, 'Applications considered'), el('strong', {}, formatNumber(metric.total)),
  );
  total.addEventListener('click', () => openMetric(metric, metric.rows, 'All evaluated applications'));
  const content = el('div', { class: 'metric-content' },
    el('h3', {}, metric.title),
    el('span', { class: 'freshness', title: metric.extract.raw ? `Source value: ${metric.extract.raw}` : '' }, `Last extracted: ${metric.extract.formatted}`),
    total,
    el('div', { class: 'count-grid' }, compliant, nonCompliant),
  );
  const expand = el('button', { class: 'link-button', type: 'button' }, 'Expand details');
  expand.addEventListener('click', () => openMetric(metric, metric.rows, 'All evaluated applications'));
  card.append(donut, content, el('div', { class: 'metric-actions' }, el('p', { class: 'metric-note' }, metric.note), expand));
  return card;
}

function renderForecast() {
  if (!state.dashboard) return;
  const cadence = refs['forecast-cadence'].value;
  refs['forecast-period'].options[0].textContent = cadence === 'monthly' ? 'Current month' : 'Current week';
  refs['forecast-period'].options[1].textContent = cadence === 'monthly' ? 'Next month' : 'Next week';
  const now = new Date();
  const window = forecastWindow(cadence, refs['forecast-period'].value, now);
  const target = Math.min(100, Math.max(0, Number(refs['forecast-target'].value) || 95.1));
  refs['forecast-target'].value = target;
  const forecastRows = [];
  const totals = { due: 0, atRisk: 0, nonCompliant: 0, actions: 0, shortfall: 0 };
  const cards = state.dashboard.metrics.map((metric) => {
    const result = calculateForecastMetric(metric, (row) => metricDueDateValue({ ...row, _deliverableId: metric.id }, now), window, target);
    totals.due += result.dueRows.length;
    totals.atRisk += result.atRisk;
    totals.nonCompliant += result.dueNonCompliant;
    totals.actions += result.actionsRequired;
    totals.shortfall += result.outsidePeriodShortfall;
    result.dueRows.forEach(({ row, due }, index) => forecastRows.push({
      ...row, _deliverable: metric.title, _deliverableId: metric.id,
      _forecastDueDate: formatFullDate(due),
      _forecastAction: row._compliant ? 'Renew or complete before due date' : 'Close current non-compliance',
      _forecastNeeded: index < result.actionsFromPeriod ? 'Yes' : 'No',
    }));
    const detailButton = el('button', { class: 'link-button forecast-card-details', type: 'button' }, `View due records (${formatNumber(result.dueRows.length)})`);
    detailButton.addEventListener('click', () => openForecastDetails(metric.id));
    return el('article', { class: `forecast-card${result.outsidePeriodShortfall ? ' has-shortfall' : ''}` },
      el('div', { class: 'forecast-card-header' }, el('h3', {}, metric.title), el('span', { class: 'forecast-current' }, `Current ${metric.compliantPercent.toFixed(1)}%`)),
      forecastBullet(result),
      el('div', { class: 'forecast-metric' },
        forecastValue('Due workload', result.dueRows.length),
        forecastValue('At risk', result.atRisk),
        forecastValue('Due non-compliant', result.dueNonCompliant),
        forecastValue('Actions required', result.actionsRequired),
        forecastValue('Next +1%', result.nextPointActions),
        forecastValue('Target', `${target.toFixed(1)}%`),
      ),
      result.outsidePeriodShortfall
        ? el('p', { class: 'forecast-shortfall' }, `${formatNumber(result.outsidePeriodShortfall)} additional closure${result.outsidePeriodShortfall === 1 ? '' : 's'} needed outside this period.`)
        : el('p', { class: 'forecast-note' }, `All selected-period actions can support the ${target.toFixed(1)}% target.`),
      detailButton,
    );
  });
  state.forecastRows = forecastRows;
  state.forecastWindow = window;
  const overview = el('div', { class: 'forecast-overview' },
    el('strong', {}, window.label),
    forecastValue('Total due', totals.due), forecastValue('At risk', totals.atRisk),
    forecastValue('Due non-compliant', totals.nonCompliant), forecastValue('Required actions', totals.actions),
    forecastValue('Outside-period shortfall', totals.shortfall),
  );
  refs['forecast-summary'].replaceChildren(overview, ...cards);
  refs['forecast-details-button'].textContent = `Expand due details (${formatNumber(forecastRows.length)})`;
  refs['forecast-details-button'].disabled = forecastRows.length === 0;
  refs['forecast-details-button'].title = `${window.label}; ${formatNumber(forecastRows.length)} records due`;
}

function forecastBullet(result) {
  const target = Math.min(100, Math.max(0, result.targetPercent));
  return el('div', { class: 'forecast-bullet', role: 'img', 'aria-label': `No action ${result.noActionPercent.toFixed(1)} percent, all due work closed ${result.allDueClosedPercent.toFixed(1)} percent, target ${target.toFixed(1)} percent` },
    el('div', { class: 'forecast-track' },
      el('span', { class: 'forecast-no-action', style: `width:${result.noActionPercent}%` }),
      el('span', { class: 'forecast-all-closed', style: `left:${result.noActionPercent}%;width:${Math.max(0, result.allDueClosedPercent - result.noActionPercent)}%` }),
      el('span', { class: 'forecast-target-marker', style: `left:${target}%` }),
    ),
    el('div', { class: 'forecast-bullet-labels' }, el('span', {}, `No action ${result.noActionPercent.toFixed(1)}%`), el('span', {}, `All due closed ${result.allDueClosedPercent.toFixed(1)}%`), el('span', {}, `Target ${target.toFixed(1)}%`)),
  );
}

function forecastValue(label, value) {
  return el('div', {}, el('span', {}, label), el('strong', {}, typeof value === 'number' ? formatNumber(value) : value));
}

function openForecastDetails(metricId = null) {
  const rows = (state.forecastRows ?? []).filter((row) => !metricId || row._deliverableId === metricId);
  openTableModal({
    kicker: 'Forecast',
    title: 'Records due in selected period',
    subtitle: `${formatNumber(rows.length)} records are due in ${state.forecastWindow?.label ?? 'the selected forecast window'}. “Needed for target” prioritizes the earliest due records.`,
    rows,
    columns: FORECAST_COLUMNS,
    filename: 'forecast-due-records',
  });
}

function forecastWindow(cadence, period, now) {
  const start = startOfDay(new Date(now));
  if (cadence === 'monthly') {
    start.setDate(1);
    if (period === 'next') start.setMonth(start.getMonth() + 1);
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);
    end.setDate(0);
    return { start, end: endOfDay(end), label: `${period === 'next' ? 'Next' : 'Current'} month (${formatDateLabel(start)} to ${formatDateLabel(end)})` };
  }
  const day = start.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  start.setDate(start.getDate() + mondayOffset + (period === 'next' ? 7 : 0));
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return { start, end: endOfDay(end), label: `${period === 'next' ? 'Next' : 'Current'} week (${formatDateLabel(start)} to ${formatDateLabel(end)})` };
}

function renderArchive() {
  if (!state.dashboard) return;
  const weeks = mondayCheckpoints(new Date(), 4);
  const series = state.dashboard.metrics.map((metric) => ({
    metric,
    points: weeks.map((week) => ({ week, ...calculateArchivePoint(metric, week, (row, checkpoint) => archiveCompliantAt(metric.id, row, checkpoint)) })),
  }));
  const allPercents = series.flatMap((item) => item.points.map((point) => point.percent));
  const axisMin = Math.max(0, Math.floor((Math.min(...allPercents, 100) - 3) / 5) * 5);
  const legend = el('div', { class: 'archive-legend' }, ...weeks.map((week, index) => el('span', {}, el('i', { class: `archive-legend-swatch archive-week-${index}`, 'aria-hidden': 'true' }), formatDateLabel(week))));
  const overview = el('div', { class: 'archive-overview' }, ...series.map(({ metric, points }) => {
    const delta = points.at(-1).percent - points[0].percent;
    return el('div', { class: 'archive-overview-card' }, el('span', {}, metric.title), el('strong', {}, `${points.at(-1).percent.toFixed(1)}%`), el('small', { class: delta >= 0 ? 'trend-up' : 'trend-down' }, `${delta >= 0 ? '+' : ''}${delta.toFixed(1)} pts / 4 weeks`));
  }));
  const plot = el('div', { class: 'archive-grouped-plot', role: 'img', 'aria-label': `Four-week grouped compliance chart; vertical scale ${axisMin} to 100 percent` }, ...series.map(({ metric, points }) => {
    const bars = points.map((point, index) => {
      const height = Math.max(6, (point.percent - axisMin) / Math.max(1, 100 - axisMin) * 165);
      const button = el('button', { class: `archive-group-bar archive-week-${index}`, type: 'button', style: `height:${height}px`, 'aria-label': `${metric.title}, ${formatDateLabel(point.week)}, ${point.percent.toFixed(1)} percent, ${point.compliant} compliant and ${point.nonCompliant} non-compliant` });
      button.addEventListener('click', () => openArchiveDetails(metric.id, point.week));
      return el('div', { class: 'archive-group-bar-wrap' }, el('span', { class: 'archive-bar-value' }, `${point.percent.toFixed(1)}%`), button);
    });
    return el('div', { class: 'archive-deliverable-group' }, el('div', { class: 'archive-deliverable-bars' }, bars), el('strong', { class: 'archive-deliverable-label' }, metric.title));
  }));
  refs['archive-chart'].replaceChildren(overview, legend, el('div', { class: 'archive-axis-note' }, `Chart scale: ${axisMin}%–100%. Click any bar for compliant/non-compliant details.`), plot);
}

function archiveCompliantAt(metricId, row, monday) {
  return archiveAssessment(metricId, row, monday).compliant;
}

function openArchiveDetails(metricId, monday) {
  const metric = state.dashboard.metrics.find((item) => item.id === metricId);
  if (!metric) return;
  const point = calculateArchivePoint(metric, monday, (row, checkpoint) => archiveCompliantAt(metric.id, row, checkpoint));
  const rows = metric.rows.map((row) => ({
    ...row,
    _archiveStatus: archiveCompliantAt(metric.id, row, monday) ? 'Compliant at checkpoint' : 'Non-Compliant at checkpoint',
    _archiveWeek: formatDateLabel(monday),
    _archiveBasis: formatArchiveBasis(archiveAssessment(metric.id, row, monday)),
  }));
  openTableModal({
    kicker: 'Archive checkpoint',
    title: `${metric.title} — ${formatDateLabel(monday)}`,
    subtitle: `${point.compliant} compliant and ${point.nonCompliant} non-compliant (${point.percent.toFixed(1)}%). Calculated from freshly loaded status, completion-date, and due-date fields.`,
    rows,
    columns: [...METRIC_COLUMNS[metric.id], { key: '_archiveWeek', label: 'Checkpoint' }, { key: '_archiveStatus', label: 'Archive Status' }, { key: '_archiveBasis', label: 'Archive Basis' }],
    filename: `archive-${metric.id}-${formatDateLabel(monday)}`,
  });
}

function archiveAssessment(metricId, row, checkpoint) {
  const scoped = { ...row, _deliverableId: metricId };
  const due = metricDueDateValue(scoped, new Date());
  const completion = metricCompletionDateValue(scoped);
  return { ...deriveArchiveStatus({ currentCompliant: row._compliant, dueDate: due, completionDate: completion }, checkpoint), due, completion };
}

function formatArchiveBasis(assessment) {
  const dates = [assessment.completion ? `Completion ${formatFullDate(assessment.completion)}` : '', assessment.due ? `Due ${formatFullDate(assessment.due)}` : ''].filter(Boolean);
  return `${assessment.reason}${dates.length ? ` — ${dates.join('; ')}` : ''}`;
}

function countButton(label, count, percent, className, onClick) {
  const button = el('button', { class: `count-button ${className}`, type: 'button', 'aria-label': `${label}: ${count}, ${percent.toFixed(1)} percent` },
    el('span', {}, label), el('strong', {}, formatNumber(count)), el('small', {}, `${percent.toFixed(1)}%`),
  );
  button.addEventListener('click', onClick);
  return button;
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

function openNewApplications() {
  if (!state.dashboard) return;
  const rows = getBlankAsaApplications(state.dashboard.supportedApps);
  openTableModal({
    kicker: 'Supported applications',
    title: 'New Applications',
    subtitle: `${formatNumber(rows.length)} supported applications currently have a blank ASA.`,
    rows,
    columns: [...COMMON_COLUMNS, { key: 'Application_Type', label: 'Application Type' }, { key: 'System_Criticality_Assessment_Current', label: 'System Criticality Status' }, { key: 'System_Criticality_Due_Date', label: 'System Criticality Due' }, { key: 'Recovery_Level', label: 'Recovery Level' }, { key: 'AEC_Rating', label: 'AEC Rating' }],
    filename: 'new-applications-blank-asa',
  });
}

function openTableModal({ kicker, title, subtitle, rows, columns, filename }) {
  openModal(kicker, title, subtitle);
  refs['modal-content'].classList.add('is-table-view');
  const pageSize = 25;
  let page = 1;
  let search = '';
  const columnSearches = {};
  const columnSelections = {};
  let sort = null;
  const input = el('input', { class: 'search-input', type: 'search', placeholder: 'Search all columns', 'aria-label': 'Search table' });
  const exportButton = el('button', { class: 'button button-primary', type: 'button' }, 'Export to Excel');
  refs['modal-toolbar'].append(el('div', { class: 'toolbar-group' }, input), el('div', { class: 'toolbar-group' }, exportButton));

  const processedRows = () => applyTableState(rows, columns, { globalSearch: search, columnSearches, columnSelections, sort });
  const render = (focusColumnIndex = null, caretPosition = null) => {
    closeColumnValueFilter();
    const filtered = processedRows();
    const maxPage = Math.max(1, Math.ceil(filtered.length / pageSize));
    page = Math.min(page, maxPage);
    const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);
    refs['modal-content'].replaceChildren(renderTable(pageRows, columns, { sort, columnSearches, columnSelections }, {
      onSort(columnIndex) {
        sort = nextSort(sort, columnIndex);
        page = 1;
        render();
      },
      onColumnSearch(columnIndex, value, caret) {
        columnSearches[columnIndex] = value;
        page = 1;
        render(columnIndex, caret);
      },
      onOpenColumnFilter(columnIndex, anchor) {
        openColumnValueFilter({
          rows,
          column: columns[columnIndex],
          columnIndex,
          anchor,
          currentSelection: Object.hasOwn(columnSelections, columnIndex) ? columnSelections[columnIndex] : null,
          onApply(selection) {
            if (selection === null) delete columnSelections[columnIndex];
            else columnSelections[columnIndex] = selection;
            page = 1;
            render();
          },
        });
      },
    }));
    const previous = el('button', { class: 'button button-secondary', type: 'button', disabled: page <= 1 }, 'Previous');
    const next = el('button', { class: 'button button-secondary', type: 'button', disabled: page >= maxPage }, 'Next');
    previous.addEventListener('click', () => { page -= 1; render(); });
    next.addEventListener('click', () => { page += 1; render(); });
    refs['modal-footer'].replaceChildren(el('span', {}, `${formatNumber(filtered.length)} records · Page ${page} of ${maxPage}`), el('div', { class: 'toolbar-group' }, previous, next));
    if (focusColumnIndex !== null) queueMicrotask(() => {
      const field = refs['modal-content'].querySelector(`[data-column-search="${focusColumnIndex}"]`);
      field?.focus();
      if (typeof field?.setSelectionRange === 'function') field.setSelectionRange(caretPosition, caretPosition);
    });
  };
  input.addEventListener('input', () => { search = normalizeText(input.value); page = 1; render(); });
  exportButton.addEventListener('click', () => exportExcel(processedRows(), columns, filename));
  render();
}

function openColumnValueFilter({ rows, column, columnIndex, anchor, currentSelection, onApply }) {
  closeColumnValueFilter();
  const values = uniqueColumnValues(rows, column);
  const allKeys = new Set(values.map((entry) => entry.key));
  const selected = currentSelection ? new Set(currentSelection) : new Set(allKeys);
  let search = '';
  const searchInput = el('input', { class: 'value-filter-search', type: 'search', placeholder: 'Search values', 'aria-label': `Search values in ${column.label}` });
  const list = el('div', { class: 'value-filter-list' });
  const summary = el('span', { class: 'value-filter-summary' });
  const limitNote = el('p', { class: 'value-filter-note' });
  const panel = el('section', { id: 'column-value-filter-panel', class: 'column-value-filter-panel', role: 'dialog', 'aria-label': `Filter ${column.label}` },
    el('header', { class: 'value-filter-header' }, el('strong', {}, `Filter ${column.label}`), el('button', { class: 'value-filter-close', type: 'button', 'aria-label': 'Close filter' }, '×')),
    searchInput,
    el('div', { class: 'value-filter-selection-actions' }),
    summary,
    list,
    limitNote,
    el('footer', { class: 'value-filter-footer' }),
  );
  const closeButton = panel.querySelector('.value-filter-close');
  const selectionActions = panel.querySelector('.value-filter-selection-actions');
  const footer = panel.querySelector('.value-filter-footer');
  const matchingValues = () => values.filter((entry) => !search || normalizeText(entry.label).includes(search));
  const renderValues = () => {
    const matching = matchingValues();
    const visibleValues = matching.slice(0, 250);
    list.replaceChildren(...visibleValues.map((entry) => {
      const checkbox = el('input', { type: 'checkbox', checked: selected.has(entry.key), value: entry.key });
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) selected.add(entry.key);
        else selected.delete(entry.key);
        summary.textContent = `${formatNumber(selected.size)} of ${formatNumber(values.length)} values selected`;
      });
      const label = el('label', { class: 'value-filter-option' }, checkbox, el('span', {}, entry.label));
      const only = el('button', { class: 'value-filter-only', type: 'button', title: `Show only ${entry.label}` }, 'Only');
      only.addEventListener('click', () => { selected.clear(); selected.add(entry.key); renderValues(); });
      return el('div', { class: 'value-filter-option-row' }, label, only);
    }));
    summary.textContent = `${formatNumber(selected.size)} of ${formatNumber(values.length)} values selected`;
    limitNote.textContent = matching.length > visibleValues.length ? `Showing the first ${formatNumber(visibleValues.length)} matches. Refine the value search to see more.` : '';
  };
  const selectAll = el('button', { class: 'link-button', type: 'button' }, 'Select all');
  const clearAll = el('button', { class: 'link-button', type: 'button' }, 'Clear all');
  selectAll.addEventListener('click', () => { for (const entry of matchingValues()) selected.add(entry.key); renderValues(); });
  clearAll.addEventListener('click', () => { for (const entry of matchingValues()) selected.delete(entry.key); renderValues(); });
  selectionActions.append(selectAll, clearAll);
  const clearFilter = el('button', { class: 'button button-quiet', type: 'button' }, 'Clear filter');
  const cancel = el('button', { class: 'button button-secondary', type: 'button' }, 'Cancel');
  const apply = el('button', { class: 'button button-primary', type: 'button' }, 'Apply');
  clearFilter.addEventListener('click', () => { closeColumnValueFilter(); onApply(null); });
  cancel.addEventListener('click', closeColumnValueFilter);
  apply.addEventListener('click', () => {
    const selection = selected.size === allKeys.size ? null : new Set(selected);
    closeColumnValueFilter();
    onApply(selection);
  });
  footer.append(clearFilter, cancel, apply);
  closeButton.addEventListener('click', closeColumnValueFilter);
  searchInput.addEventListener('input', () => { search = normalizeText(searchInput.value); renderValues(); });
  document.body.append(panel);
  const viewport = visualViewport;
  const viewportLeft = viewport?.offsetLeft ?? 0;
  const viewportTop = viewport?.offsetTop ?? 0;
  const viewportWidth = viewport?.width ?? innerWidth;
  const viewportHeight = viewport?.height ?? innerHeight;
  panel.style.maxHeight = `${Math.max(80, Math.round(viewportHeight - 16))}px`;
  const anchorRect = anchor.getBoundingClientRect();
  const left = Math.max(viewportLeft + 8, Math.min(anchorRect.left, viewportLeft + viewportWidth - panel.offsetWidth - 8));
  const belowSpace = viewportTop + viewportHeight - anchorRect.bottom - 8;
  const aboveSpace = anchorRect.top - viewportTop - 8;
  const useAbove = belowSpace < Math.min(220, panel.offsetHeight) && aboveSpace > belowSpace;
  const top = useAbove
    ? Math.max(viewportTop + 8, anchorRect.top - panel.offsetHeight - 4)
    : Math.min(anchorRect.bottom + 4, viewportTop + viewportHeight - panel.offsetHeight - 8);
  panel.style.left = `${Math.round(left)}px`;
  panel.style.top = `${Math.round(top)}px`;
  const outsideHandler = (event) => {
    if (!panel.contains(event.target) && event.target !== anchor) closeColumnValueFilter();
  };
  columnFilterOutsideHandler = outsideHandler;
  setTimeout(() => {
    if (columnFilterOutsideHandler === outsideHandler) document.addEventListener('pointerdown', outsideHandler, true);
  }, 0);
  renderValues();
  searchInput.focus();
}

function closeColumnValueFilter() {
  document.getElementById('column-value-filter-panel')?.remove();
  if (columnFilterOutsideHandler) document.removeEventListener('pointerdown', columnFilterOutsideHandler, true);
  columnFilterOutsideHandler = null;
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
  refs['modal-subtitle'].textContent = 'Search the current application inventory and select suggested values. Only conditional rules are stored in IndexedDB.';
  refs['modal-toolbar'].replaceChildren(
    el('div', { class: 'config-update-time' }, `Last configuration update: ${formatConfigurationUpdatedAt(state.config.updatedAt)}`),
    el('div', { class: 'default-config-baseline' }, 'Reset baseline: ', el('span', { class: 'default-date-badge' }, DEFAULT_CONFIG_DATE_LABEL)),
  );
  refs['modal-footer'].replaceChildren();
  const organizations = [...new Set(inventory.map((row) => organizationLabel(row.Maintaining_Organization)).filter(Boolean))].sort(localeSort);
  const besApps = inventory.filter((row) => organizationKey(row.Maintaining_Organization) === organizationKey('Boeing Enterprise Security')).map((row) => String(row.Application ?? '').trim()).filter(Boolean).sort(localeSort);
  const applicationNames = uniqueInventoryValues(inventory.map((row) => row.Application), normalizeText);
  const allManagers = uniqueInventoryValues(inventory.map((row) => row.Application_Manager), personKey);
  const allAsas = uniqueInventoryValues(inventory.map((row) => row.Application_Security_Administrator), personKey);
  const selectedOrganizations = new Set(state.config.includedOrganizations.map(organizationKey));
  const selectedBesApps = new Set((state.config.restrictedOrganizations['Boeing Enterprise Security'] ?? []).map(normalizeText));

  const orgList = el('div', { class: 'check-list' });
  for (const organization of organizations) orgList.append(checkRow(organization, selectedOrganizations.has(organizationKey(organization)), 'organization'));
  const orgSearch = checkListSearch(orgList, 'Search maintenance organizations');
  const appList = el('div', { class: 'check-list' });
  for (const app of besApps) appList.append(checkRow(app, selectedBesApps.has(normalizeText(app)), 'bes-app'));
  const besAppSearch = checkListSearch(appList, 'Search Boeing Enterprise Security applications');
  const managerList = el('div', { class: 'rule-list', id: 'manager-rules' });
  for (const manager of state.config.managerExceptions) managerList.append(managerRuleRow(manager, allManagers));
  const asaList = el('div', { class: 'rule-list', id: 'asa-rules' });
  for (const asa of state.config.asaExceptions ?? []) asaList.append(asaRuleRow(asa, allAsas));
  const excludeBlankAsaFromScmp = el('input', { type: 'checkbox', checked: Boolean(state.config.excludeBlankAsaFromScmp) });
  const blankAsaOption = el('label', { class: 'check-row blank-asa-option' }, excludeBlankAsaFromScmp, el('span', {}, 'Exclude blank ASA applications from the SCMP compliance percentage'));
  const appExceptionList = el('div', { class: 'rule-list', id: 'application-rules' });
  for (const name of state.config.applicationExceptions) appExceptionList.append(appExceptionRow(name, applicationNames));

  const addManager = el('button', { class: 'button button-secondary', type: 'button' }, 'Add manager exception');
  addManager.addEventListener('click', () => managerList.append(managerRuleRow('', allManagers)));
  const addAsa = el('button', { class: 'button button-secondary', type: 'button' }, 'Add ASA exception');
  addAsa.addEventListener('click', () => asaList.append(asaRuleRow('', allAsas)));
  const addApp = el('button', { class: 'button button-secondary', type: 'button' }, 'Add application exception');
  addApp.addEventListener('click', () => appExceptionList.append(appExceptionRow('', applicationNames)));

  const layout = el('div', { class: 'config-layout' },
    el('div', {},
      el('section', { class: 'config-section' }, el('h3', {}, 'Included maintenance organizations'), el('p', { class: 'config-note' }, 'Applications are included when their exact normalized maintenance organization is selected.'), orgSearch, orgList),
      el('section', { class: 'config-section' }, el('h3', {}, 'Boeing Enterprise Security applications'), el('p', { class: 'config-note' }, 'This MO is restricted to the selected applications.'), besAppSearch, appList),
    ),
    el('div', {},
      el('section', { class: 'config-section' }, el('h3', {}, 'Application manager exceptions'), el('p', { class: 'config-note' }, 'Select a manager to exclude all of that manager’s applications, regardless of maintenance organization.'), managerList, addManager),
      el('section', { class: 'config-section' }, el('h3', {}, 'ASA exceptions'), el('p', { class: 'config-note' }, 'Select an ASA to exclude all of that ASA’s applications, regardless of maintenance organization.'), blankAsaOption, asaList, addAsa),
      el('section', { class: 'config-section' }, el('h3', {}, 'Application exceptions'), el('p', { class: 'config-note' }, 'Exclude these application names regardless of MO.'), appExceptionList, addApp),
    ),
  );
  refs['modal-content'].replaceChildren(layout);

  const importInput = el('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  const importButton = el('button', { class: 'button button-secondary', type: 'button' }, 'Import JSON');
  const exportButton = el('button', { class: 'button button-secondary', type: 'button' }, 'Export JSON');
  const resetButton = el('button', { class: 'button button-danger', type: 'button' }, 'Reset to defaults ', el('span', { class: 'default-date-badge' }, DEFAULT_CONFIG_DATE_LABEL));
  const saveButton = el('button', { class: 'button button-primary', type: 'button' }, 'Save configuration');
  importButton.addEventListener('click', () => importInput.click());
  exportButton.addEventListener('click', () => exportJson(state.config, 'supported-mo-configuration'));
  resetButton.addEventListener('click', async () => { state.config = await saveConfig(cloneDefaultConfig()); renderConfiguration(inventory); toast(`${DEFAULT_CONFIG_DATE_LABEL} defaults restored.`); await applyConfig(); });
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
      const managerExceptions = [...managerList.querySelectorAll('.rule-row')].flatMap((row) => {
        const input = row.querySelector('[data-inventory-picker="manager"]');
        if (!input.value.trim()) return [];
        const manager = input.getInventoryValue();
        return [manager ?? input.value.trim()];
      });
      const asaExceptions = [...asaList.querySelectorAll('.rule-row')].flatMap((row) => {
        const input = row.querySelector('[data-inventory-picker="asa"]');
        if (!input.value.trim()) return [];
        const asa = input.getInventoryValue();
        return [asa ?? input.value.trim()];
      });
      const applicationExceptions = [...appExceptionList.querySelectorAll('[data-inventory-picker="application"]')].flatMap((input) => {
        if (!input.value.trim()) return [];
        const application = input.getInventoryValue();
        return [application ?? input.value.trim()];
      });
      state.config = await saveConfig({ schemaVersion: 1, bemsId: '1600103', includedOrganizations, restrictedOrganizations, managerExceptions, asaExceptions, excludeBlankAsaFromScmp: excludeBlankAsaFromScmp.checked, applicationExceptions });
      await applyConfig();
      closeModal();
      toast('Supported application configuration saved.');
    } catch (error) { toast(`Configuration was not saved: ${error.message}`); }
  });
  refs['modal-footer'].append(el('div', { class: 'toolbar-group' }, importInput, importButton, exportButton, resetButton), saveButton);
}

function applyConfig() {
  if (state.raw) {
    state.dashboard = evaluateDashboard(state.raw, state.config);
    renderDashboard();
    refs['status-line'].textContent = `${formatNumber(state.dashboard.supportedApps.length)} supported applications after configuration filters.`;
  }
}

function managerRuleRow(manager, allManagers) {
  const picker = inventoryPicker({
    value: typeof manager === 'string' ? manager : manager?.manager,
    placeholder: 'Type to search managers',
    ariaLabel: 'Application manager',
    pickerType: 'manager',
    getOptions: () => allManagers,
    matchKey: personKey,
  });
  return removableRuleRow([picker.element], 'app-only');
}

function asaRuleRow(asa, allAsas) {
  const picker = inventoryPicker({
    value: typeof asa === 'string' ? asa : asa?.asa,
    placeholder: 'Type to search ASAs',
    ariaLabel: 'Application Security Administrator',
    pickerType: 'asa',
    getOptions: () => allAsas,
    matchKey: personKey,
  });
  return removableRuleRow([picker.element], 'app-only');
}

function appExceptionRow(name, applicationNames) {
  const picker = inventoryPicker({
    value: name,
    placeholder: 'Type to search applications',
    ariaLabel: 'Excluded application name',
    pickerType: 'application',
    getOptions: () => applicationNames,
    matchKey: normalizeText,
  });
  return removableRuleRow([picker.element], 'app-only');
}

function checkListSearch(list, placeholder) {
  const input = el('input', { class: 'config-search-input', type: 'search', placeholder, 'aria-label': placeholder });
  input.addEventListener('input', () => {
    const query = normalizeText(input.value);
    for (const row of list.querySelectorAll('.check-row')) row.hidden = Boolean(query) && !normalizeText(row.textContent).includes(query);
  });
  return input;
}

function inventoryPicker({ value, placeholder, ariaLabel, pickerType, getOptions, matchKey }) {
  const pickerId = `inventory-picker-${++inventoryPickerSequence}`;
  const originalValue = String(value ?? '').trim();
  const input = el('input', {
    class: 'text-input inventory-picker-input', type: 'text', value: originalValue, placeholder,
    'aria-label': ariaLabel, 'aria-autocomplete': 'list', 'aria-controls': pickerId, 'aria-expanded': 'false',
    autocomplete: 'off', 'data-inventory-picker': pickerType,
  });
  const suggestions = el('div', { id: pickerId, class: 'inventory-suggestions', role: 'listbox', hidden: true });
  const status = el('span', { class: 'inventory-match-status' });
  const element = el('div', { class: 'inventory-picker' }, input, suggestions, status);

  const options = () => getOptions();
  const exactMatch = () => findInventoryMatch(input.value, options(), matchKey);
  const updateStatus = () => {
    const match = exactMatch();
    input.classList.remove('inventory-valid', 'inventory-warning');
    if (!input.value.trim()) {
      status.className = 'inventory-match-status';
      status.textContent = 'Start typing and select a current inventory value.';
      input.setAttribute('aria-invalid', 'false');
    } else if (match) {
      status.className = 'inventory-match-status is-valid';
      status.textContent = 'Matched current inventory.';
      input.classList.add('inventory-valid');
      input.setAttribute('aria-invalid', 'false');
    } else {
      status.className = 'inventory-match-status is-warning';
      status.textContent = 'Not found in the current inventory; this exception will be kept as entered when saved.';
      input.classList.add('inventory-warning');
      input.setAttribute('aria-invalid', 'false');
    }
    return match;
  };
  const matchingOptions = () => searchInventoryValues(input.value, options(), 12);
  const renderSuggestions = () => {
    const matches = matchingOptions();
    suggestions.replaceChildren(...matches.map((option) => {
      const button = el('button', { class: 'inventory-suggestion', type: 'button', role: 'option' }, option);
      button.addEventListener('pointerdown', (event) => event.preventDefault());
      button.addEventListener('click', () => {
        input.value = option;
        suggestions.hidden = true;
        input.setAttribute('aria-expanded', 'false');
        updateStatus();
        input.focus();
      });
      return button;
    }));
    if (!matches.length) suggestions.append(el('span', { class: 'inventory-no-results' }, 'No matching current inventory values.'));
    suggestions.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    const viewport = visualViewport;
    const viewportLeft = viewport?.offsetLeft ?? 0;
    const viewportTop = viewport?.offsetTop ?? 0;
    const viewportWidth = viewport?.width ?? innerWidth;
    const viewportHeight = viewport?.height ?? innerHeight;
    const inputRect = input.getBoundingClientRect();
    const popupWidth = Math.min(inputRect.width, viewportWidth - 16);
    const popupLeft = Math.max(viewportLeft + 8, Math.min(inputRect.left, viewportLeft + viewportWidth - popupWidth - 8));
    const belowSpace = viewportTop + viewportHeight - inputRect.bottom - 8;
    const aboveSpace = inputRect.top - viewportTop - 8;
    const useAbove = belowSpace < 140 && aboveSpace > belowSpace;
    const availableHeight = Math.max(72, (useAbove ? aboveSpace : belowSpace) - 3);
    suggestions.style.left = `${Math.round(popupLeft)}px`;
    suggestions.style.width = `${Math.round(popupWidth)}px`;
    suggestions.style.maxHeight = `${Math.min(235, Math.round(availableHeight))}px`;
    suggestions.style.top = `${Math.round(useAbove ? Math.max(viewportTop + 8, inputRect.top - suggestions.offsetHeight - 3) : inputRect.bottom + 3)}px`;
  };
  const initialMatch = exactMatch();
  if (initialMatch) input.value = initialMatch;
  input.addEventListener('focus', renderSuggestions);
  input.addEventListener('input', () => { updateStatus(); renderSuggestions(); });
  input.addEventListener('blur', () => setTimeout(() => {
    suggestions.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    updateStatus();
  }, 150));
  input.getInventoryValue = () => {
    const match = updateStatus();
    return match;
  };
  input.refreshInventoryPicker = () => { updateStatus(); if (document.activeElement === input) renderSuggestions(); };
  updateStatus();
  return { element, input };
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

function renderTable(rows, columns, tableState, handlers) {
  const headingRow = el('tr', { class: 'column-heading-row' }, ...columns.map((column, columnIndex) => {
    const active = tableState.sort?.columnIndex === columnIndex ? tableState.sort.direction : null;
    const sortButton = el('button', {
      class: `sort-button${active ? ' is-sorted' : ''}`,
      type: 'button',
      title: `Sort by ${column.label}`,
      'aria-label': `Sort by ${column.label}${active ? `, currently ${active === 'asc' ? 'ascending' : 'descending'}` : ''}`,
    }, el('span', {}, column.label), el('span', { class: 'sort-indicator', 'aria-hidden': 'true' }, active === 'asc' ? '▲' : active === 'desc' ? '▼' : '↕'));
    sortButton.addEventListener('click', () => handlers.onSort(columnIndex));
    const filterActive = Object.hasOwn(tableState.columnSelections, columnIndex);
    const filterButton = el('button', {
      class: `value-filter-button${filterActive ? ' is-filtered' : ''}`,
      type: 'button',
      title: `Choose values for ${column.label}`,
      'aria-label': `Filter ${column.label} by selected values${filterActive ? ', filter active' : ''}`,
      'aria-pressed': filterActive,
    }, '▼');
    filterButton.addEventListener('click', (event) => {
      event.stopPropagation();
      handlers.onOpenColumnFilter(columnIndex, filterButton);
    });
    return el('th', { scope: 'col', 'aria-sort': active === 'asc' ? 'ascending' : active === 'desc' ? 'descending' : 'none' }, el('div', { class: 'column-header-control' }, sortButton, filterButton));
  }));
  const searchRow = el('tr', { class: 'column-filter-row' }, ...columns.map((column, columnIndex) => {
    const input = el('input', {
      class: 'column-search-input', type: 'search', value: tableState.columnSearches[columnIndex] ?? '',
      placeholder: `Search ${column.label}`, 'aria-label': `Search ${column.label}`, 'data-column-search': columnIndex,
    });
    input.addEventListener('input', () => handlers.onColumnSearch(columnIndex, input.value, input.selectionStart));
    return el('th', { scope: 'col' }, input);
  }));
  const head = el('thead', {}, headingRow, searchRow);
  const body = el('tbody');
  for (const row of rows) {
    const cells = columns.map((column) => {
      const value = displayValue(row, column);
      if (value && ['_status', '_sourceStatus', '_sowStatus', 'Overall_NIST_Compliance', 'Plans_Compliant_Overall', 'Plans_Complete', 'Plans_Current', 'Plans_Tested_And_Validated'].includes(column.key)) {
        const compliant = normalizeText(value) === 'compliant';
        return el('td', {}, el('span', { class: `status-pill ${compliant ? 'status-compliant' : 'status-noncompliant'}` }, value));
      }
      return el('td', {}, value);
    });
    body.append(el('tr', {}, ...cells));
  }
  const table = el('table', {}, head, body);
  if (!rows.length) body.append(el('tr', {}, el('td', { class: 'table-empty-cell', colspan: columns.length }, 'No matching records.')));
  return el('div', { class: 'table-wrap' }, table);
}

function openModal(kicker, title, subtitle) {
  refs['modal-kicker'].textContent = kicker;
  refs['modal-title'].textContent = title;
  refs['modal-subtitle'].textContent = subtitle;
  refs['modal-toolbar'].replaceChildren();
  refs['modal-content'].classList.remove('is-table-view');
  refs['modal-content'].replaceChildren();
  refs['modal-footer'].replaceChildren();
  refs['modal-backdrop'].hidden = false;
  document.getElementById('modal-close').focus();
}

function closeModal() {
  closeColumnValueFilter();
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

function summaryCard(label, value, note, action = null) {
  const card = el('article', { class: 'summary-card' }, el('span', {}, label), el('strong', {}, formatNumber(value)), el('small', {}, note));
  if (action) {
    const button = el('button', { class: 'summary-card-action', type: 'button' }, action.label);
    button.addEventListener('click', action.onClick);
    card.append(button);
  }
  return card;
}

function emptyState(message) { return el('div', { class: 'empty-state' }, message); }
function reasonColumn() { return { key: '_reasons', label: 'Non-compliance Reason', value: (row) => row._reasons }; }
function applicationName(row) { return row.Application ?? row.Application_Name ?? row.Asset_Name ?? row._support?.Application ?? ''; }
function applicationId(row) { return row.Application_Id ?? row.Identifier ?? row.Asset_ID ?? row._support?.Application_Id ?? ''; }
function sourceStatus(row) {
  if (row._deliverableId === 'system') return row.System_Criticality_Assessment_Current;
  if (row._deliverableId === 'nist') return row.Overall_NIST_Compliance;
  if (row._deliverableId === 'recovery') return row.Plans_Compliant_Overall;
  if (row._deliverableId === 'risk') return row.Risk_Prolifer_Current;
  if (row._deliverableId === 'access') return row.ACP_Reviewed;
  return '';
}
function metricDueDate(row) {
  if (row._deliverableId === 'system') return row.System_Criticality_Due_Date;
  if (row._deliverableId === 'nist') return row.NIST_Next_Due_Date;
  if (row._deliverableId === 'recovery') return row.Overall_DueDate;
  if (row._deliverableId === 'risk') return row.Risk_Prolifer_Due_Date;
  if (row._deliverableId === 'access') return row.ACP_Review_Due_Date;
  return '';
}
function metricDueDateValue(row, now) {
  if (row._deliverableId === 'nist') {
    const completion = parseDate(row.Nist_Assessment_Completion_Date);
    return annualDueFromCompletion(completion) ?? parseDate(row.NIST_Next_Due_Date);
  }
  if (row._deliverableId === 'recovery') {
    const orientation = parseDate(row.Orientation_Date);
    return recoveryOrientationDue(orientation, row.Recovery_Level) ?? parseMetricRawDate(row.Overall_DueDate, now);
  }
  const raw = metricDueDate(row);
  return parseMetricRawDate(raw, now);
}
function metricCompletionDateValue(row) {
  if (row._deliverableId === 'nist') return parseDate(row.Nist_Assessment_Completion_Date);
  if (row._deliverableId === 'recovery') return parseDate(row.Orientation_Date);
  if (['system', 'risk', 'access'].includes(row._deliverableId)) return annualCompletionFromDue(parseDate(metricDueDate(row)));
  return null;
}
function parseMetricRawDate(raw, now) {
  if (/due now/i.test(String(raw ?? ''))) return startOfDay(new Date(now));
  return parseDate(raw);
}
function startOfDay(date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}
function endOfDay(date) {
  const result = new Date(date);
  result.setHours(23, 59, 59, 999);
  return result;
}
function formatDateLabel(date) {
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' }).format(date);
}
function formatFullDate(date) {
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}
function formatLiveRefreshTime(date) {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
  }).format(date) + ' IST';
}
function formatNumber(value) { return new Intl.NumberFormat('en-IN').format(value); }
function formatConfigurationUpdatedAt(value) {
  if (!value || Number.isNaN(Date.parse(value))) return 'Not yet saved';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
  }).format(new Date(value)) + ' IST';
}
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
