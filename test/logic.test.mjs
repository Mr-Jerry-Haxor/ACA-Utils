import test from 'node:test';
import assert from 'node:assert/strict';
import { collectNonCompliantRecords, evaluateDashboard, filterSupportedApplications, formatPacificExtract, getBlankAsaApplications, personKey } from '../src/js/logic.js';

const config = {
  schemaVersion: 1,
  bemsId: '1600103',
  includedOrganizations: ['Alpha', 'Boeing Enterprise Security'],
  restrictedOrganizations: { 'Boeing Enterprise Security': ['Allowed Security App', 'Allowed Security ASA App', 'Allowed Security Manager App'] },
  managerExceptions: ['Manager, Excluded Q'],
  asaExceptions: ['Excluded ASA'],
  excludeBlankAsaFromScmp: true,
  applicationExceptions: ['Always Excluded'],
};

test('supported filtering applies MO, restricted app, manager, ASA, and global app rules', () => {
  const rows = [
    app('Included', 'Alpha', 'Good Manager'),
    app('Manager Excluded', 'Alpha', 'Excluded Manager'),
    app('Allowed Security Manager App', 'Boeing Enterprise Security', 'Excluded Manager'),
    app('ASA Excluded', 'Alpha', 'Good Manager', 'Excluded ASA'),
    app('Allowed Security ASA App', 'Boeing Enterprise Security', 'Good Manager', 'Excluded ASA'),
    app('Blank ASA Excluded', 'Alpha', 'Good Manager', ''),
    app('Always Excluded', 'Alpha', 'Good Manager'),
    app('Allowed Security App', 'Boeing Enterprise Security', 'Good Manager'),
    app('Other Security App', 'Boeing Enterprise Security', 'Good Manager'),
    app('Wrong MO', 'Beta', 'Good Manager'),
  ];
  assert.deepEqual(filterSupportedApplications(rows, config).map((row) => row.Application), ['Included', 'Blank ASA Excluded', 'Allowed Security App']);
});

test('blank ASA setting affects only SCMP population and New Applications finds the same rows', () => {
  const primary = [app('Blank ASA', 'Alpha', 'Good Manager', ''), app('Assigned ASA', 'Alpha', 'Good Manager', 'Assigned ASA')];
  const localConfig = { ...config, managerExceptions: [], asaExceptions: [], applicationExceptions: [], restrictedOrganizations: {}, includedOrganizations: ['Alpha'], excludeBlankAsaFromScmp: true };
  const dashboard = evaluateDashboard(dataset(primary), localConfig, new Date('2026-10-29T12:00:00'));
  const system = dashboard.metrics.find((metric) => metric.id === 'system');
  assert.equal(dashboard.supportedApps.length, 2);
  assert.equal(system.total, 1);
  assert.deepEqual(getBlankAsaApplications(dashboard.supportedApps).map((row) => row.Application), ['Blank ASA']);
});

test('person names normalize comma order and middle initials', () => {
  assert.equal(personKey('Atkinson, Martin T'), personKey('Martin Atkinson'));
});

test('Pacific rollup time converts to IST using DST on the extract date', () => {
  const result = formatPacificExtract('10/27 07:00 PT', new Date('2026-10-29T00:00:00Z'));
  assert.equal(result.iso, '2026-10-27T14:00:00.000Z');
  assert.match(result.formatted, /27 Oct 2026/);
  assert.match(result.formatted, /07:30 pm|7:30 pm/i);
});

test('NIST denominator includes all supported applications while CUI drives non-compliance', () => {
  const primary = [app('A', 'Alpha', 'Good Manager'), app('B', 'Alpha', 'Good Manager')];
  const dashboard = evaluateDashboard(dataset(primary, {
    nistDetails: [
      { Asset_Name: 'A', Has_CUI: 'True', Overall_NIST_Compliance: 'Compliant', Nist_Assessment_Completion_Date: '01/02/2026' },
      { Asset_Name: 'B', Has_CUI: 'False', Overall_NIST_Compliance: 'Compliant', Nist_Assessment_Completion_Date: '01/02/2026' },
    ],
  }), config, new Date('2026-12-01T12:00:00'));
  const nist = dashboard.metrics.find((metric) => metric.id === 'nist');
  assert.equal(nist.total, 2);
  assert.equal(nist.compliant, 2);
  assert.equal(nist.nonCompliant, 0);
  assert.match(nist.rows[0].NIST_Next_Due_Date, /2027/);
  assert.equal(nist.rows[1]._nistPopulationStatus, 'Supported non-CUI application');
});

test('NIST SOW status overrides source non-compliance for findings when next due is tomorrow or later', () => {
  const primary = [app('A', 'Alpha', 'Good Manager'), app('B', 'Alpha', 'Good Manager'), app('C', 'Alpha', 'Good Manager')];
  const dashboard = evaluateDashboard(dataset(primary, {
    nistDetails: [
      { Asset_Name: 'A', Has_CUI: 'True', Overall_NIST_Compliance: 'Non-Compliant', Open_Findings: 3, Nist_Assessment_Completion_Date: '10/30/2025' },
      { Asset_Name: 'B', Has_CUI: 'True', Overall_NIST_Compliance: 'Non-Compliant', Open_Findings: 0, Nist_Assessment_Completion_Date: '10/30/2025' },
      { Asset_Name: 'C', Has_CUI: 'True', Overall_NIST_Compliance: 'Non-Compliant', Open_Findings: 2, Nist_Assessment_Completion_Date: '10/29/2025' },
    ],
  }), config, new Date('2026-10-29T12:00:00'));
  const nist = dashboard.metrics.find((metric) => metric.id === 'nist');
  assert.equal(nist.rows[0].Overall_NIST_Compliance, 'Non-Compliant');
  assert.equal(nist.rows[0]._sowStatus, 'Compliant');
  assert.equal(nist.rows[0]._sowOverride, true);
  assert.equal(nist.rows[1]._sowStatus, 'Non-Compliant');
  assert.equal(nist.rows[2]._sowStatus, 'Non-Compliant');
  assert.equal(nist.compliant, 1);
});

test('recovery highlights approved plans with incomplete validation and RL4 functional gaps', () => {
  const primary = [app('A', 'Alpha', 'Good Manager'), app('B', 'Alpha', 'Good Manager')];
  const dashboard = evaluateDashboard(dataset(primary, {
    recoveryDetails: [
      { Application_Name: 'A', Recovery_Level: 'RL 2 - Intermediate Recovery', Plans_Complete: 'Compliant', Plans_Current: 'Non-Compliant', Plans_Tested_And_Validated: 'Non-Compliant' },
      { Application_Name: 'B', Recovery_Level: 'RL 4 - Immediate Recovery - Manual', Plans_Complete: 'Compliant', Plans_Current: 'Compliant', Plans_Tested_And_Validated: 'Compliant', Orientation_Date: '10/01/2026', Functional_Date: 'never done' },
    ],
  }), config, new Date('2026-10-29T12:00:00'));
  const recovery = dashboard.metrics.find((metric) => metric.id === 'recovery');
  assert.equal(recovery.rows[0]._validationIncomplete, true);
  assert.equal(recovery.rows[1]._functionalPending, true);
  assert.equal(recovery.rows[1]._compliant, true);
  assert.deepEqual(recovery.rows[1]._reasons, []);
  assert.ok(recovery.rows[1]._recoveryAttention.length > 0);
  assert.equal(recovery.nonCompliant, 1);
  assert.equal(recovery.compliant, 1);
});

test('overall non-compliant collection preserves a record for each deliverable result', () => {
  const records = collectNonCompliantRecords([
    { id: 'system', title: 'System Criticality', nonCompliantRows: [{ Application: 'A' }] },
    { id: 'access', title: 'Access Control Policy', nonCompliantRows: [{ Application: 'A' }, { Application: 'B' }] },
  ]);
  assert.equal(records.length, 3);
  assert.deepEqual(records.map((row) => row._deliverable), ['System Criticality', 'Access Control Policy', 'Access Control Policy']);
  assert.deepEqual(records.map((row) => row._deliverableId), ['system', 'access', 'access']);
});

function app(name, organization, manager, asa = 'Good ASA') {
  return { Application: name, Maintaining_Organization: organization, Application_Manager: manager, Application_Security_Administrator: asa, System_Criticality_Assessment_Current: 'Compliant' };
}

function dataset(systemDetails, overrides = {}) {
  return {
    systemDetails,
    systemRollups: [{ EXTRACTDATE: '10/27 07:00 PT' }],
    recoveryDetails: [], recoveryRollups: [{ EXTRACTDATE: '10/27 00:00 PT' }],
    riskDetails: [], riskRollups: [{ EXTRACTDATE: '10/27 04:30 PT' }],
    accessDetails: [], accessRollups: [{ EXTRACTDATE: '10/27 04:30 PT' }],
    nistDetails: [], nistRollups: [{ EXTRACTDATE: '10/27 04:30 PT' }],
    ...overrides,
  };
}
