import fs from 'node:fs';
import path from 'node:path';

const harPath = path.resolve('research data/scorecard-ui.tas-ewd.apps.boeing.com.har');
const har = JSON.parse(fs.readFileSync(harPath, 'utf8'));
const entries = har?.log?.entries ?? [];

const endpointCounts = new Map();
const relevant = [];
for (const entry of entries) {
  let url;
  try {
    url = new URL(entry.request.url);
  } catch {
    continue;
  }
  const key = `${entry.request.method} ${url.pathname}`;
  endpointCounts.set(key, (endpointCounts.get(key) ?? 0) + 1);
  if (/metric|rollup|extract|critical|nist|recovery|risk|access|compliance/i.test(url.pathname + url.search)) {
    let json;
    const text = entry.response?.content?.text;
    if (text) {
      try { json = JSON.parse(text); } catch { /* ignore non-JSON bodies */ }
    }
    const records = findLargestRecordArray(json);
    relevant.push({
      method: entry.request.method,
      origin: url.origin,
      pathname: url.pathname,
      queryKeys: [...url.searchParams.keys()],
      status: entry.response.status,
      mimeType: entry.response?.content?.mimeType,
      bodySize: text?.length ?? 0,
      shape: describe(json),
      records: records ? summarizeRecords(records) : null,
    });
  }
}

function findLargestRecordArray(value) {
  const arrays = [];
  const visit = (node, depth = 0) => {
    if (depth > 6 || node == null) return;
    if (Array.isArray(node)) {
      if (node.some((item) => item && typeof item === 'object' && !Array.isArray(item))) arrays.push(node);
      for (const item of node.slice(0, 3)) visit(item, depth + 1);
      return;
    }
    if (typeof node === 'object') for (const child of Object.values(node)) visit(child, depth + 1);
  };
  visit(value);
  return arrays.sort((a, b) => b.length - a.length)[0] ?? null;
}

function summarizeRecords(records) {
  const keys = [...new Set(records.slice(0, 50).flatMap((item) => Object.keys(item ?? {})))];
  const fields = {};
  for (const key of keys) {
    const values = records.map((item) => item?.[key]).filter((value) => value !== undefined && value !== null && value !== '');
    const types = [...new Set(values.map((value) => Array.isArray(value) ? 'array' : typeof value))];
    const detail = { types, populated: values.length };
    if (/status|compl|current|complete|valid|cui|level|metric|plan|type|flag/i.test(key)) {
      const primitive = values.filter((value) => ['string', 'number', 'boolean'].includes(typeof value));
      const counts = new Map();
      for (const value of primitive) counts.set(String(value), (counts.get(String(value)) ?? 0) + 1);
      detail.values = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
    }
    fields[key] = detail;
  }
  return { count: records.length, fields };
}

function describe(value, depth = 0) {
  if (depth > 4) return typeof value;
  if (Array.isArray(value)) {
    return { type: 'array', length: value.length, item: value.length ? describe(value[0], depth + 1) : null };
  }
  if (value && typeof value === 'object') {
    return {
      type: 'object',
      keys: Object.keys(value).slice(0, 80),
      children: Object.fromEntries(Object.entries(value).slice(0, 20).map(([key, child]) => [key, describe(child, depth + 1)])),
    };
  }
  return { type: value === null ? 'null' : typeof value };
}

const report = {
  entryCount: entries.length,
  topEndpoints: [...endpointCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 80),
  relevant,
};

if (process.argv.includes('--compact')) {
  const seen = new Set();
  report.relevant = relevant.filter((item) => {
    const key = `${item.method} ${item.origin}${item.pathname}?${item.queryKeys.join('&')}`;
    if (item.method !== 'GET' || item.status !== 200 || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(({ shape, ...item }) => item);
  delete report.topEndpoints;
}

const endpointArg = process.argv.find((arg) => arg.startsWith('--endpoint='));
if (endpointArg) {
  const pattern = endpointArg.slice('--endpoint='.length).toLowerCase();
  report.relevant = relevant.filter((item) => item.method === 'GET' && item.status === 200 && item.pathname.toLowerCase().includes(pattern))
    .map(({ shape, ...item }) => item);
  delete report.topEndpoints;
}

console.log(JSON.stringify(report, null, 2));
