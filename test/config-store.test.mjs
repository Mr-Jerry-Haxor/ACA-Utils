import test from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig } from '../src/js/config-store.js';

const base = {
  schemaVersion: 1,
  bemsId: '1600103',
  includedOrganizations: ['Alpha'],
  restrictedOrganizations: {},
  managerExceptions: [],
  applicationExceptions: [],
};

test('older configurations migrate with an empty ASA exception list', () => {
  assert.deepEqual(validateConfig(base).asaExceptions, []);
  assert.equal(validateConfig(base).excludeBlankAsaFromScmp, false);
});

test('object-style manager rules migrate to global manager names', () => {
  const config = validateConfig({ ...base, managerExceptions: [{ organization: 'Alpha', manager: ' Example   Manager ' }] });
  assert.deepEqual(config.managerExceptions, ['Example Manager']);
});

test('ASA exception rules are normalized and retained', () => {
  const config = validateConfig({ ...base, asaExceptions: [{ organization: ' Alpha  ', asa: ' Example   ASA ' }] });
  assert.deepEqual(config.asaExceptions, ['Example ASA']);
});

test('global ASA strings are accepted and deduplicated', () => {
  const config = validateConfig({ ...base, asaExceptions: [' Example ASA ', 'Example   ASA'], excludeBlankAsaFromScmp: true });
  assert.deepEqual(config.asaExceptions, ['Example ASA']);
  assert.equal(config.excludeBlankAsaFromScmp, true);
});

test('legacy blank-ASA exclusion setting migrates to the SCMP-only setting', () => {
  assert.equal(validateConfig({ ...base, excludeBlankAsa: true }).excludeBlankAsaFromScmp, true);
});

test('unmatched exception values and the last update timestamp are retained', () => {
  const config = validateConfig({
    ...base,
    managerExceptions: ['Manager not in inventory'],
    asaExceptions: ['ASA not in inventory'],
    applicationExceptions: ['Application not in inventory'],
    updatedAt: '2026-10-30T04:00:00.000Z',
  });
  assert.deepEqual(config.managerExceptions, ['Manager not in inventory']);
  assert.deepEqual(config.asaExceptions, ['ASA not in inventory']);
  assert.deepEqual(config.applicationExceptions, ['Application not in inventory']);
  assert.equal(config.updatedAt, '2026-10-30T04:00:00.000Z');
});
