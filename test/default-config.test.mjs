import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DEFAULT_CONFIG, DEFAULT_CONFIG_DATE_LABEL, DEFAULT_CONFIG_EFFECTIVE_DATE } from '../src/js/default-config.js';
import { validateConfig } from '../src/js/config-store.js';

test('built-in defaults match the attached supported MO configuration', () => {
  const attached = JSON.parse(fs.readFileSync('research data/supported-mo-configuration.json', 'utf8'));
  const expected = validateConfig(attached);
  const actual = validateConfig(DEFAULT_CONFIG);
  delete expected.updatedAt;
  assert.deepEqual(actual, expected);
});

test('reset baseline is labeled 1 OCT 26', () => {
  assert.equal(DEFAULT_CONFIG_EFFECTIVE_DATE, '2026-10-01');
  assert.equal(DEFAULT_CONFIG_DATE_LABEL, '1 OCT 26');
});
