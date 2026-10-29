import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTableState, filterValueKey, nextSort, uniqueColumnValues } from '../src/js/table-state.js';

const columns = [
  { key: 'name', label: 'Application' },
  { key: 'manager', label: 'Manager' },
  { key: 'count', label: 'Count' },
  { key: 'due', label: 'Due Date' },
];
const rows = [
  { name: 'Zulu', manager: 'Lee', count: 12, due: '12/15/2026' },
  { name: 'Alpha', manager: 'Kim', count: 3, due: '01/02/2026' },
  { name: 'Bravo', manager: 'Kim', count: '', due: '' },
];

test('global and per-column searches combine without changing the source rows', () => {
  const result = applyTableState(rows, columns, {
    globalSearch: 'a',
    columnSearches: { 1: 'kim', 0: 'alpha' },
  });
  assert.deepEqual(result.map((row) => row.name), ['Alpha']);
  assert.equal(rows.length, 3);
});

test('column sorting handles numbers and keeps blank values last', () => {
  assert.deepEqual(
    applyTableState(rows, columns, { sort: { columnIndex: 2, direction: 'asc' } }).map((row) => row.name),
    ['Alpha', 'Zulu', 'Bravo'],
  );
  assert.deepEqual(
    applyTableState(rows, columns, { sort: { columnIndex: 2, direction: 'desc' } }).map((row) => row.name),
    ['Zulu', 'Alpha', 'Bravo'],
  );
});

test('Excel-style value selections filter categories and blank values', () => {
  assert.deepEqual(applyTableState(rows, columns, { columnSelections: { 1: new Set([filterValueKey('Kim')]) } }).map((row) => row.name), ['Alpha', 'Bravo']);
  assert.deepEqual(applyTableState(rows, columns, { columnSelections: { 2: new Set([filterValueKey('')]) } }).map((row) => row.name), ['Bravo']);
  assert.deepEqual(uniqueColumnValues(rows, columns[1]).map((entry) => entry.label), ['Kim', 'Lee']);
});

test('date sorting uses chronological order', () => {
  assert.deepEqual(
    applyTableState(rows, columns, { sort: { columnIndex: 3, direction: 'asc' } }).map((row) => row.name),
    ['Alpha', 'Zulu', 'Bravo'],
  );
});

test('sort control cycles ascending, descending, then unsorted', () => {
  const ascending = nextSort(null, 1);
  const descending = nextSort(ascending, 1);
  assert.deepEqual(ascending, { columnIndex: 1, direction: 'asc' });
  assert.deepEqual(descending, { columnIndex: 1, direction: 'desc' });
  assert.equal(nextSort(descending, 1), null);
});
