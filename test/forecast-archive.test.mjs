import test from 'node:test';
import assert from 'node:assert/strict';
import { annualCompletionFromDue, annualDueFromCompletion, calculateArchivePoint, calculateForecastMetric, deriveArchiveStatus, mondayCheckpoints, recoveryOrientationDue } from '../src/js/forecast-archive.js';

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

test('current forecast includes only non-compliant backlog from before the selected period', () => {
  const rows = [
    { id: 'old-noncompliant', _compliant: false, due: '2026-09-10' },
    { id: 'old-compliant', _compliant: true, due: '2026-09-11' },
    { id: 'earlier-this-month', _compliant: false, due: '2026-10-05' },
    { id: 'upcoming', _compliant: true, due: '2026-10-31' },
    { id: 'later', _compliant: false, due: '2026-11-01' },
  ];
  const metric = { total: 5, compliant: 2, compliantPercent: 40, rows };
  const result = calculateForecastMetric(metric, (row) => new Date(`${row.due}T00:00:00`), {
    start: new Date('2026-10-01T00:00:00'), end: new Date('2026-10-31T23:59:59'),
    asOf: new Date('2026-10-30T00:00:00'), includeOverdueNonCompliant: true,
  }, 95.1);
  assert.deepEqual(result.dueRows.map(({ row }) => row.id), ['old-noncompliant', 'earlier-this-month', 'upcoming']);
  assert.equal(result.overdueNonCompliant, 2);
});

test('next forecast does not include overdue backlog', () => {
  const rows = [
    { id: 'overdue', _compliant: false, due: '2026-10-01' },
    { id: 'next', _compliant: false, due: '2026-11-03' },
  ];
  const metric = { total: 2, compliant: 0, compliantPercent: 0, rows };
  const result = calculateForecastMetric(metric, (row) => new Date(`${row.due}T00:00:00`), {
    start: new Date('2026-11-01T00:00:00'), end: new Date('2026-11-30T23:59:59'),
    asOf: new Date('2026-10-30T00:00:00'), includeOverdueNonCompliant: false,
  }, 95.1);
  assert.deepEqual(result.dueRows.map(({ row }) => row.id), ['next']);
  assert.equal(result.overdueNonCompliant, 0);
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

test('archive derives checkpoint compliance from completion and due dates', () => {
  const checkpoint = new Date('2026-10-26T00:00:00');
  assert.equal(deriveArchiveStatus({ currentCompliant: false, dueDate: new Date('2026-11-01') }, checkpoint).compliant, true);
  assert.equal(deriveArchiveStatus({ currentCompliant: true, dueDate: new Date('2026-10-20') }, checkpoint).compliant, false);
  assert.equal(deriveArchiveStatus({ currentCompliant: true, completionDate: new Date('2026-10-27') }, checkpoint).compliant, false);
  assert.equal(deriveArchiveStatus({ currentCompliant: false }, checkpoint).compliant, false);
});

test('annual and recovery dates are derived from the required source fields', () => {
  const key = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  assert.equal(key(annualCompletionFromDue(new Date(2027, 2, 15))), '2026-03-15');
  assert.equal(key(annualDueFromCompletion(new Date(2026, 2, 15))), '2027-03-15');
  assert.equal(key(recoveryOrientationDue(new Date(2026, 0, 1), 'RL 2 - Intermediate Recovery')), '2027-01-01');
  assert.equal(key(recoveryOrientationDue(new Date(2026, 0, 1), 'RL 4 - Immediate Recovery')), '2026-06-30');
});
