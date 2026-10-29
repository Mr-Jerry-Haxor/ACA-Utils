import { displayValue } from './export.js';
import { normalizeText } from './logic.js';

const EMPTY_VALUE_KEY = '__aca_empty_value__';

export function applyTableState(rows, columns, { globalSearch = '', columnSearches = {}, columnSelections = {}, sort = null } = {}) {
  const globalTerm = normalizeText(globalSearch);
  const filtered = rows.filter((row) => {
    if (globalTerm && !columns.some((column) => normalizeText(displayValue(row, column)).includes(globalTerm))) return false;
    return columns.every((column, index) => {
      const term = normalizeText(columnSearches[index]);
      const value = normalizeText(displayValue(row, column));
      if (term && !value.includes(term)) return false;
      if (!Object.hasOwn(columnSelections, index)) return true;
      const selection = columnSelections[index] instanceof Set ? columnSelections[index] : new Set(columnSelections[index]);
      return selection.has(filterValueKey(displayValue(row, column)));
    });
  });
  if (!sort || !['asc', 'desc'].includes(sort.direction) || !columns[sort.columnIndex]) return filtered;
  const column = columns[sort.columnIndex];
  return filtered.map((row, index) => ({ row, index })).sort((left, right) => {
    const comparison = compareValues(displayValue(left.row, column), displayValue(right.row, column), sort.direction);
    return comparison || left.index - right.index;
  }).map(({ row }) => row);
}

export function uniqueColumnValues(rows, column) {
  const values = new Map();
  for (const row of rows) {
    const raw = displayValue(row, column);
    const key = filterValueKey(raw);
    if (!values.has(key)) values.set(key, { key, label: String(raw ?? '').trim() || '(Blanks)' });
  }
  return [...values.values()].sort((left, right) => {
    if (left.key === EMPTY_VALUE_KEY) return 1;
    if (right.key === EMPTY_VALUE_KEY) return -1;
    return left.label.localeCompare(right.label, 'en', { sensitivity: 'base', numeric: true });
  });
}

export function filterValueKey(value) {
  return normalizeText(value) || EMPTY_VALUE_KEY;
}

export function nextSort(current, columnIndex) {
  if (!current || current.columnIndex !== columnIndex) return { columnIndex, direction: 'asc' };
  if (current.direction === 'asc') return { columnIndex, direction: 'desc' };
  return null;
}

function compareValues(leftValue, rightValue, direction) {
  const left = String(leftValue ?? '').trim();
  const right = String(rightValue ?? '').trim();
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  const leftNumber = strictNumber(left);
  const rightNumber = strictNumber(right);
  let result;
  if (leftNumber !== null && rightNumber !== null) result = leftNumber - rightNumber;
  else {
    const leftDate = sortableDate(left);
    const rightDate = sortableDate(right);
    result = leftDate !== null && rightDate !== null
      ? leftDate - rightDate
      : left.localeCompare(right, 'en', { sensitivity: 'base', numeric: true });
  }
  return direction === 'desc' ? -result : result;
}

function strictNumber(value) {
  if (!/^-?\d+(?:\.\d+)?%?$/.test(value.replaceAll(',', ''))) return null;
  return Number(value.replaceAll(',', '').replace('%', ''));
}

function sortableDate(value) {
  if (!/^(?:\d{1,2}\/\d{1,2}\/\d{4}|\d{1,2}\s+[A-Za-z]{3}\s+\d{4}|[A-Za-z]{3}\s+\d{1,2},\s+\d{4})$/.test(value)) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}
