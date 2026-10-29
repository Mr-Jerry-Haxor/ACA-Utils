import fs from 'node:fs';

const har = JSON.parse(fs.readFileSync('research data/scorecard-ui.tas-ewd.apps.boeing.com.har', 'utf8'));
const entries = har?.log?.entries ?? [];
const wanted = /GetMetricsDataDetails|GetMetricsDataRollUps|GetAppRecoveryPlan|GetRiskProfiler|GetAccessControl|GetNistType/i;
const report = [];

for (const entry of entries) {
  const url = new URL(entry.request.url);
  if (entry.request.method !== 'GET' || entry.response.status !== 200 || !wanted.test(url.pathname)) continue;
  let data;
  try { data = JSON.parse(entry.response?.content?.text ?? ''); } catch { continue; }
  const headers = Object.fromEntries((entry.request.headers ?? []).map(({ name, value }) => [name.toLowerCase(), value]));
  const safeHeaders = {};
  for (const name of Object.keys(headers).sort()) {
    safeHeaders[name] = /authorization|cookie|token/i.test(name) ? '[redacted]' : headers[name];
  }
  const rows = findRows(data);
  const dates = {};
  for (const key of rows.length ? Object.keys(rows[0]) : []) {
    if (/date/i.test(key)) dates[key] = [...new Set(rows.map((row) => row?.[key]).filter(Boolean))].slice(0, 5);
  }
  report.push({
    endpoint: url.pathname,
    query: Object.fromEntries(url.searchParams),
    requestHeaders: safeHeaders,
    root: Array.isArray(data) ? 'array' : Object.keys(data ?? {}),
    records: rows.length,
    dateExamples: dates,
  });
}

function findRows(value) {
  if (Array.isArray(value) && value.some((item) => item && typeof item === 'object')) return value;
  if (!value || typeof value !== 'object') return [];
  return Object.values(value).map(findRows).sort((a, b) => b.length - a.length)[0] ?? [];
}

const colorCounts = new Map();
for (const entry of entries) {
  const url = new URL(entry.request.url);
  if (!/\.css$/i.test(url.pathname)) continue;
  const text = entry.response?.content?.text ?? '';
  for (const match of text.matchAll(/#[0-9a-f]{3,8}\b/gi)) {
    const color = match[0].toLowerCase();
    colorCounts.set(color, (colorCounts.get(color) ?? 0) + 1);
  }
}

console.log(JSON.stringify({
  contracts: report,
  palette: [...colorCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30),
}, null, 2));
