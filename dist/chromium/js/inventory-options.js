import { normalizeText } from './logic.js';

export function uniqueInventoryValues(values, keyFunction = normalizeText) {
  const unique = new Map();
  for (const value of values) {
    const label = String(value ?? '').trim();
    const key = keyFunction(label);
    if (key && !unique.has(key)) unique.set(key, label);
  }
  return [...unique.values()].sort((left, right) => left.localeCompare(right, 'en', { sensitivity: 'base', numeric: true }));
}

export function findInventoryMatch(value, options, keyFunction = normalizeText) {
  const key = keyFunction(value);
  return key ? options.find((option) => keyFunction(option) === key) ?? null : null;
}

export function searchInventoryValues(query, options, limit = 12) {
  const tokens = normalizeText(query).replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean);
  return options.filter((option) => {
    const candidate = normalizeText(option).replace(/[^a-z0-9]+/g, ' ');
    return tokens.every((token) => candidate.includes(token));
  }).slice(0, limit);
}
