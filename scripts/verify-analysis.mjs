import fs from 'node:fs';
import { DEFAULT_CONFIG } from '../src/js/default-config.js';
import { evaluateDashboard } from '../src/js/logic.js';

const har = JSON.parse(fs.readFileSync('research data/scorecard-ui.tas-ewd.apps.boeing.com.har', 'utf8'));
const entries = har?.log?.entries ?? [];
const endpoints = {
  systemDetails: '/Metric/GetMetricsDataDetails', systemRollups: '/Metric/GetMetricsDataRollUps',
  recoveryDetails: '/Metric/GetAppRecoveryPlanDetails', recoveryRollups: '/Metric/GetAppRecoveryPlanRollUps',
  riskDetails: '/Metric/GetRiskProfilerDetails', riskRollups: '/Metric/GetRiskProfilerRollUps',
  accessDetails: '/Metric/GetAccessControlDetails', accessRollups: '/Metric/GetAccessControlRollUps',
  nistDetails: '/Metric/GetNistTypeDetails', nistRollups: '/Metric/GetNistTypeRollUps',
};
const data = {};
for (const [key, endpoint] of Object.entries(endpoints)) {
  const entry = entries.find((candidate) => {
    try { return candidate.request.method === 'GET' && candidate.response.status === 200 && new URL(candidate.request.url).pathname === endpoint && candidate.response?.content?.text; }
    catch { return false; }
  });
  data[key] = JSON.parse(entry.response.content.text);
}
const dashboard = evaluateDashboard(data, structuredClone(DEFAULT_CONFIG), new Date('2026-10-29T12:00:00+05:30'));
if (!dashboard.supportedApps.length) {
  const counts = new Map();
  for (const row of data.systemDetails) counts.set(row.Maintaining_Organization, (counts.get(row.Maintaining_Organization) ?? 0) + 1);
  console.error('Observed maintenance organizations:', [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 50));
  throw new Error('Workbook-derived rules yielded no supported applications.');
}
for (const metric of dashboard.metrics) {
  if (metric.compliant + metric.nonCompliant !== metric.total) throw new Error(`${metric.id} counts do not reconcile.`);
  if (!Number.isFinite(metric.compliantPercent)) throw new Error(`${metric.id} has an invalid percentage.`);
}
console.log(JSON.stringify({
  supportedApplications: dashboard.supportedApps.length,
  metrics: dashboard.metrics.map((metric) => ({ id: metric.id, total: metric.total, compliant: metric.compliant, nonCompliant: metric.nonCompliant, percent: Number(metric.compliantPercent.toFixed(1)), extractIST: metric.extract.formatted })),
  recoveryValidationIncomplete: dashboard.metrics.find((metric) => metric.id === 'recovery').rows.filter((row) => row._validationIncomplete).length,
  recoveryFunctionalPending: dashboard.metrics.find((metric) => metric.id === 'recovery').rows.filter((row) => row._functionalPending).length,
  nistSowOverrides: dashboard.metrics.find((metric) => metric.id === 'nist').rows.filter((row) => row._sowOverride).length,
}, null, 2));
