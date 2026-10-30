import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterConfiguredEsatsApplications, filterOrganizationApplications, matchSupportedOrganizations,
  normalizeEsatsRecord, personIdentity, retirementRowsForInterval, summarizeEsatsApplications,
} from '../src/js/esats-logic.js';

const baseConfig = {
  includedOrganizations: ['Engineering Systems', 'Boeing Enterprise Security'],
  restrictedOrganizations: { 'Boeing Enterprise Security': ['Allowed Security App'] },
  applicationExceptions: ['Excluded App'],
  managerExceptions: ['Manager, Excluded'],
  asaExceptions: ['Croghan, Adam (1670236)'],
};

test('configured MO matching is normalized and reports missing organizations', () => {
  const result = matchSupportedOrganizations([
    { id: 669, name: 'Engineering Systems' },
    { id: 660, name: 'Boeing Enterprise Security' },
  ], { includedOrganizations: [' engineering systems ', 'Missing MO'] });
  assert.deepEqual(result.matched.map((item) => item.id), [669]);
  assert.deepEqual(result.missing, ['Missing MO']);
});

test('organization application filtering applies restricted and global application rules', () => {
  const rows = [
    { name: 'Allowed Security App' },
    { name: 'Another Security App' },
    { name: 'Excluded App' },
  ];
  const filtered = filterOrganizationApplications(rows, { name: 'Boeing Enterprise Security' }, baseConfig);
  assert.deepEqual(filtered.map((item) => item.name), ['Allowed Security App']);
});

test('ESATS records normalize lifecycle and contact details', () => {
  const record = normalizeEsatsRecord({
    application: {
      name: 'App A', businessApplicationEsatsId: 11622, isSoftDeleted: 'Y',
      deploymentLifecyclePhaseType: { name: 'Production' },
      maintainingOrganization: { id: 669, name: 'Engineering Systems' },
    },
    organization: { id: 669, name: 'Engineering Systems' },
    lifecycle: { productionStartDate: '2026-10-20T00:00:00Z', targetRetirementDate: '2027-10-20T00:00:00Z' },
    contacts: [
      { roleType: { name: 'ApplicationManager' }, users: [{ name: 'Manager, Example', bemsId: '1234567' }] },
      { roleType: { name: 'ApplicationSecurityAdministrator' }, users: [{ name: 'Adam Croghan', bemsId: '1670236' }] },
    ],
    markedApplication: { esatsId: 11622, softDeletedOn: '2026-10-25T00:00:00Z' },
    syncedAt: '2026-10-30T00:00:00Z',
  });
  assert.equal(record.esatsId, 11622);
  assert.equal(record.lifecyclePhase, 'Production');
  assert.equal(record.isMarkedForDeletion, true);
  assert.deepEqual(record.applicationManagers, ['Manager, Example']);
  assert.deepEqual(record.securityAdministratorBemsIds, ['1670236']);
  assert.equal(record.lifecycleChangeDate, '2026-10-20T00:00:00.000Z');
});

test('person matching is insensitive to reversed name order and prefers BEMS ID', () => {
  assert.deepEqual(personIdentity('Croghan, Adam (1670236)'), personIdentity('Adam Croghan 1670236'));
  const applications = [{
    applicationName: 'App A', mvoName: 'Engineering Systems', applicationManagers: ['Good Manager'], applicationManagerBemsIds: ['7654321'],
    securityAdministrators: ['Adam Croghan'], securityAdministratorBemsIds: ['1670236'],
  }];
  assert.equal(filterConfiguredEsatsApplications(applications, baseConfig).length, 0);
});

test('retirement, deletion, and lifecycle interval counts use their source dates', () => {
  const now = new Date('2026-10-30T12:00:00Z');
  const applications = [
    { applicationName: 'Retired', isRetired: true, isMarkedForDeletion: false, retirementTimestamp: Date.parse('2026-10-27T00:00:00Z'), markedForDeletionTimestamp: null, lifecycleChangeTimestamp: Date.parse('2026-10-27T00:00:00Z') },
    { applicationName: 'Marked', isRetired: false, isMarkedForDeletion: true, retirementTimestamp: null, markedForDeletionTimestamp: Date.parse('2026-10-20T00:00:00Z'), lifecycleChangeTimestamp: Date.parse('2026-10-20T00:00:00Z') },
    { applicationName: 'Undated Marked', isRetired: false, isMarkedForDeletion: true, retirementTimestamp: null, markedForDeletionTimestamp: null, lifecycleChangeTimestamp: null },
  ];
  const summary = summarizeEsatsApplications(applications, now);
  assert.equal(summary.intervals.find((item) => item.days === 7).retired, 1);
  assert.equal(summary.intervals.find((item) => item.days === 7).markedForDeletion, 0);
  assert.equal(summary.intervals.find((item) => item.days === 15).markedForDeletion, 1);
  assert.equal(summary.markedForDeletionUndated, 1);
  assert.deepEqual(retirementRowsForInterval(summary.retiredRows, 7, 'retired', now).map((item) => item.applicationName), ['Retired']);
});
