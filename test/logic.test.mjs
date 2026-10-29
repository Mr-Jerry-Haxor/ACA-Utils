import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDashboard, filterSupportedApplications, formatPacificExtract, personKey } from '../src/js/logic.js';

const config = {
  schemaVersion: 1,
  bemsId: '1600103',
  includedOrganizations: ['Alpha', 'Boeing Enterprise Security'],
  restrictedOrganizations: { 'Boeing Enterprise Security': ['Allowed Security App'] },
  managerExceptions: [{ organization: 'Alpha', manager: 'Manager, Excluded Q' }],
  applicationExceptions: ['Always Excluded'],
};

test('supported filtering applies MO, restricted app, manager, and global app rules', () => {
  const rows = [
    app('Included', 'Alpha', 'Good Manager'),
    app('Manager Excluded', 'Alpha', 'Excluded Manager'),
    app('Always Excluded', 'Alpha', 'Good Manager'),
    app('Allowed Security App', 'Boeing Enterprise Security', 'Good Manager'),
    app('Other Security App', 'Boeing Enterprise Security', 'Good Manager'),
    app('Wrong MO', 'Beta', 'Good Manager'),
  ];
  assert.deepEqual(filterSupportedApplications(rows, config).map((row) => row.Application), ['Included', 'Allowed Security App']);
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

test('NIST uses CUI only and calculates annual due status', () => {
  const primary = [app('A', 'Alpha', 'Good Manager'), app('B', 'Alpha', 'Good Manager')];
  const dashboard = evaluateDashboard(dataset(primary, {
    nistDetails: [
      { Asset_Name: 'A', Has_CUI: 'True', Overall_NIST_Compliance: 'Compliant', Nist_Assessment_Completion_Date: '01/02/2026' },
      { Asset_Name: 'B', Has_CUI: 'False', Overall_NIST_Compliance: 'Compliant', Nist_Assessment_Completion_Date: '01/02/2026' },
    ],
  }), config, new Date('2026-12-01T12:00:00'));
  const nist = dashboard.metrics.find((metric) => metric.id === 'nist');
  assert.equal(nist.total, 1);
  assert.equal(nist.compliant, 1);
  assert.match(nist.rows[0].NIST_Next_Due_Date, /2027/);
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
  assert.equal(recovery.nonCompliant, 2);
});

function app(name, organization, manager) {
  return { Application: name, Maintaining_Organization: organization, Application_Manager: manager, System_Criticality_Assessment_Current: 'Compliant' };
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
