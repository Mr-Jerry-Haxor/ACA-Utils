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
});

test('ASA exception rules are normalized and retained', () => {
  const config = validateConfig({ ...base, asaExceptions: [{ organization: ' Alpha  ', asa: ' Example   ASA ' }] });
  assert.deepEqual(config.asaExceptions, [{ organization: 'Alpha', asa: 'Example ASA' }]);
});
