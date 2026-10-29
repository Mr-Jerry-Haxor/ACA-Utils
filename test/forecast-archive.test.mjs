import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateArchivePoint, calculateForecastMetric, mondayCheckpoints } from '../src/js/forecast-archive.js';

test('forecast includes at-risk renewals in target actions', () => {
  const rows = [
    { id: 'risk', _compliant: true, due: '2026-11-05' },
    { id: 'close', _compliant: false, due: '2026-11-06' },
    { id: 'later', _compliant: false, due: '2026-12-01' },
  ];
  const metric = { total: 100, compliant: 95, compliantPercent: 95, rows };
  const result = calculateForecastMetric(metric, (row) => new Date(`${row.due}T00:00:00`), {
    start: new Date('2026-11-01T00:00:00'), end: new Date('2026-11-30T23:59:59'),
  }, 95.1);
  assert.equal(result.atRisk, 1);
  assert.equal(result.dueNonCompliant, 1);
  assert.equal(result.actionsRequired, 2);
  assert.equal(result.outsidePeriodShortfall, 0);
  assert.equal(result.noActionPercent, 94);
  assert.equal(result.allDueClosedPercent, 96);
});

test('forecast reports shortfall when selected-period workload cannot reach target', () => {
  const metric = { total: 100, compliant: 80, compliantPercent: 80, rows: [{ _compliant: false, due: '2026-11-05' }] };
  const result = calculateForecastMetric(metric, (row) => new Date(`${row.due}T00:00:00`), {
    start: new Date('2026-11-01T00:00:00'), end: new Date('2026-11-30T23:59:59'),
  }, 95);
  assert.equal(result.actionsRequired, 15);
  assert.equal(result.actionsFromPeriod, 1);
  assert.equal(result.outsidePeriodShortfall, 14);
});

test('archive checkpoints are four chronological Mondays', () => {
  const weeks = mondayCheckpoints(new Date('2026-10-30T12:00:00'), 4);
  assert.deepEqual(weeks.map((date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`), ['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']);
  assert.ok(weeks.every((date) => date.getDay() === 1));
});

test('archive point reconciles compliant and non-compliant counts', () => {
  const metric = { total: 3, rows: [{ ok: true }, { ok: false }, { ok: true }] };
  const point = calculateArchivePoint(metric, new Date('2026-10-26'), (row) => row.ok);
  assert.deepEqual(point, { compliant: 2, nonCompliant: 1, percent: 2 / 3 * 100 });
});
