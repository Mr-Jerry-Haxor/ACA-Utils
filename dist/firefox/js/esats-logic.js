import { normalizeText, organizationKey } from './logic.js';

export const ESATS_INTERVALS = Object.freeze([7, 15, 30, 60, 90]);

export function matchSupportedOrganizations(organizations, config) {
  const byName = new Map((organizations ?? []).map((organization) => [organizationKey(organization.name), organization]));
  const matched = [];
  const missing = [];
  for (const configuredName of config.includedOrganizations ?? []) {
    const organization = byName.get(organizationKey(configuredName));
    if (organization) matched.push(organization);
    else missing.push(configuredName);
  }
  return { matched, missing };
}

export function filterOrganizationApplications(applications, organization, config) {
  const restricted = new Map(Object.entries(config.restrictedOrganizations ?? {}).map(([name, values]) => [
    organizationKey(name), new Set(values.map(normalizeText)),
  ]));
  const allowed = restricted.get(organizationKey(organization.name));
  const exceptions = new Set((config.applicationExceptions ?? []).map(normalizeText));
  return (applications ?? []).filter((application) => {
    const name = normalizeText(application.name);
    return name && !exceptions.has(name) && (!allowed || allowed.has(name));
  });
}

export function normalizeEsatsRecord({ application, organization, lifecycle, contacts, markedApplication, softDeleteHistory = [], hardDeleteHistory = [], syncedAt }) {
  const esatsId = Number(application.businessApplicationEsatsId ?? application.esatsId);
  const lifecyclePhase = phaseName(application.deploymentLifecyclePhaseType)
    || phaseName(lifecycle?.deploymentLifecyclePhaseType)
    || lifecycle?.deploymentPhaseTypeName
    || lifecycle?.deploymentPhaseTypeDisplayName
    || '';
  const contactGroups = contactsByRole(contacts);
  const managers = contactGroups.get('applicationmanager') ?? [];
  const securityAdministrators = contactGroups.get('applicationsecurityadministrator') ?? [];
  const softDeleted = truthyFlag(application.isSoftDeleted) || Boolean(markedApplication);
  const isMarkedForDeletion = softDeleted && ['planning', 'development', 'production'].includes(normalizeText(lifecyclePhase));
  const retiredDate = firstValidDate(lifecycle?.retiredStartDate, lifecycle?.retiredStartDateString);
  const markedDate = latestEnabledHistoryDate(softDeleteHistory) ?? firstValidDate(markedApplication?.softDeletedOn);
  const hardDeleteDate = latestEnabledHistoryDate(hardDeleteHistory) ?? firstValidDate(markedApplication?.hardDeletedOn);
  const lifecycleChangeDate = latestLifecycleDate(lifecycle);
  return {
    esatsId,
    applicationName: String(application.name ?? markedApplication?.name ?? '').trim(),
    extendedName: String(markedApplication?.extendedName ?? '').trim(),
    mvoId: Number(application.maintainingOrganization?.id ?? organization.id),
    mvoName: String(application.maintainingOrganization?.name ?? organization.name ?? '').trim(),
    maintainingGroup: organizationName(application.maintainingGroup),
    maintainingUnit: organizationName(application.maintainingUnit),
    lifecyclePhase,
    isSoftDeleted: softDeleted,
    isMarkedForDeletion,
    isRetired: normalizeText(lifecyclePhase) === 'retired',
    retirementDate: isoOrEmpty(retiredDate),
    retirementTimestamp: retiredDate?.getTime() ?? null,
    markedForDeletionDate: isoOrEmpty(markedDate),
    markedForDeletionTimestamp: markedDate?.getTime() ?? null,
    hardDeletionDate: isoOrEmpty(hardDeleteDate),
    hardDeletionTimestamp: hardDeleteDate?.getTime() ?? null,
    lifecycleChangeDate: isoOrEmpty(lifecycleChangeDate),
    lifecycleChangeTimestamp: lifecycleChangeDate?.getTime() ?? null,
    targetProductionDate: isoOrEmpty(firstValidDate(lifecycle?.targetProductionDate, lifecycle?.targetProductionDateString)),
    targetRetirementDate: isoOrEmpty(firstValidDate(lifecycle?.targetRetirementDate, lifecycle?.targetRetirementDateString)),
    planningStartDate: isoOrEmpty(firstValidDate(lifecycle?.planningStartDate, lifecycle?.planningStartDateString)),
    developmentStartDate: isoOrEmpty(firstValidDate(lifecycle?.developmentStartDate, lifecycle?.developmentStartDateString)),
    productionStartDate: isoOrEmpty(firstValidDate(lifecycle?.productionStartDate, lifecycle?.productionStartDateString)),
    retiredStartDate: isoOrEmpty(retiredDate),
    applicationManagers: names(managers),
    applicationManagerBemsIds: bemsIds(managers),
    securityAdministrators: names(securityAdministrators),
    securityAdministratorBemsIds: bemsIds(securityAdministrators),
    applicationArchitects: names(contactGroups.get('applicationarchitect') ?? []),
    businessSystemManagers: names(contactGroups.get('businesssystemmanager') ?? []),
    businessSystemOwners: names(contactGroups.get('businesssystemowner') ?? []),
    allContacts: formatAllContacts(contactGroups),
    replacementSystem: displayObject(lifecycle?.replacementSystem),
    onHold: Boolean(lifecycle?.isOnHoldBool),
    onHoldJustification: String(lifecycle?.onHoldJustification ?? '').trim(),
    lifecycleComment: String(lifecycle?.comment ?? '').trim(),
    lifecycle: lifecycle ?? null,
    contacts: contacts ?? [],
    softDeleteHistory,
    hardDeleteHistory,
    sourceApplication: application,
    syncedAt,
  };
}

export function filterConfiguredEsatsApplications(applications, config) {
  const organizations = new Set((config.includedOrganizations ?? []).map(organizationKey));
  const restricted = new Map(Object.entries(config.restrictedOrganizations ?? {}).map(([name, values]) => [organizationKey(name), new Set(values.map(normalizeText))]));
  const applicationExceptions = new Set((config.applicationExceptions ?? []).map(normalizeText));
  return applications.filter((application) => {
    const organization = organizationKey(application.mvoName);
    const name = normalizeText(application.applicationName);
    if (!organizations.has(organization) || !name || applicationExceptions.has(name)) return false;
    const allowed = restricted.get(organization);
    if (allowed && !allowed.has(name)) return false;
    if (matchesAnyPerson(config.managerExceptions, application.applicationManagers, application.applicationManagerBemsIds)) return false;
    if (matchesAnyPerson(config.asaExceptions, application.securityAdministrators, application.securityAdministratorBemsIds)) return false;
    return true;
  });
}

export function summarizeEsatsApplications(applications, now = new Date()) {
  const supportedRows = applications.filter((application) => !application.isRetired && !application.isMarkedForDeletion);
  const newRows = supportedRows.filter(isNewEsatsApplication);
  const retiredRows = applications.filter((application) => application.isRetired || application.isMarkedForDeletion);
  const lifecycleRows = applications.filter((application) => application.lifecycleChangeTimestamp != null);
  const intervals = ESATS_INTERVALS.map((days) => ({
    days,
    retired: applications.filter((application) => application.isRetired && withinLastDays(application.retirementTimestamp, days, now)).length,
    markedForDeletion: applications.filter((application) => application.isMarkedForDeletion && withinLastDays(application.markedForDeletionTimestamp, days, now)).length,
    lifecycleChanges: lifecycleRows.filter((application) => withinLastDays(application.lifecycleChangeTimestamp, days, now)).length,
  }));
  const olderThan90 = {
    days: 90,
    retired: applications.filter((application) => application.isRetired && olderThanDays(application.retirementTimestamp, 90, now)).length,
    markedForDeletion: applications.filter((application) => application.isMarkedForDeletion && olderThanDays(application.markedForDeletionTimestamp, 90, now)).length,
  };
  return {
    supported: supportedRows.length,
    supportedRows,
    excludedFromSupported: applications.length - supportedRows.length,
    newApplications: newRows.length,
    newRows,
    retiredTotal: applications.filter((application) => application.isRetired).length,
    markedForDeletionTotal: applications.filter((application) => application.isMarkedForDeletion).length,
    markedForDeletionUndated: applications.filter((application) => application.isMarkedForDeletion && application.markedForDeletionTimestamp == null).length,
    retiredRows,
    lifecycleRows,
    intervals,
    olderThan90,
  };
}

export function isNewEsatsApplication(application) {
  const administrators = application?.securityAdministrators;
  if (Array.isArray(administrators)) return !administrators.some((value) => normalizeText(value));
  return !normalizeText(administrators);
}

export function rowsForInterval(rows, timestampKey, days, now = new Date()) {
  if (!days) return rows;
  return rows.filter((row) => withinLastDays(row[timestampKey], days, now));
}

export function retirementRowsForInterval(rows, days, eventType = 'all', now = new Date(), olderThan = false) {
  if (!days) return rows;
  return rows.filter((row) => {
    const dateMatch = olderThan ? olderThanDays : withinLastDays;
    const retired = row.isRetired && dateMatch(row.retirementTimestamp, days, now);
    const marked = row.isMarkedForDeletion && dateMatch(row.markedForDeletionTimestamp, days, now);
    return eventType === 'retired' ? retired : eventType === 'marked' ? marked : retired || marked;
  });
}

export function olderThanDays(timestamp, days, now = new Date()) {
  if (!Number.isFinite(timestamp)) return false;
  return timestamp < now.getTime() - Number(days) * 86_400_000;
}

export function withinLastDays(timestamp, days, now = new Date()) {
  if (!Number.isFinite(timestamp)) return false;
  const end = now.getTime();
  const start = end - Number(days) * 86_400_000;
  return timestamp >= start && timestamp <= end;
}

export function personIdentity(value) {
  const text = String(value ?? '').normalize('NFKC').toLocaleLowerCase('en-US');
  const bemsId = text.match(/\b\d{4,12}\b/)?.[0] ?? '';
  const name = text.replace(/\b\d{4,12}\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
  const tokens = name.split(/\s+/).filter((token) => token.length > 1).sort();
  return { bemsId, nameKey: tokens.join(' ') };
}

function matchesAnyPerson(exceptions, namesList, idsList) {
  const people = namesList.map((name, index) => personIdentity(`${name} ${idsList[index] ?? ''}`));
  return (exceptions ?? []).some((exception) => {
    const target = personIdentity(typeof exception === 'string' ? exception : exception?.manager ?? exception?.asa ?? '');
    return people.some((person) => (target.bemsId && person.bemsId === target.bemsId) || (target.nameKey && person.nameKey === target.nameKey));
  });
}

function contactsByRole(contacts) {
  const result = new Map();
  for (const contact of contacts ?? []) {
    const role = normalizeText(contact.roleType?.name ?? contact.roleType?.displayName).replace(/\s+/g, '');
    if (!role) continue;
    const people = Array.isArray(contact.users) ? contact.users : contact.user ? [contact.user] : [];
    result.set(role, [...(result.get(role) ?? []), ...people.filter(Boolean)]);
  }
  return result;
}

function latestLifecycleDate(lifecycle) {
  const dates = [
    lifecycle?.planningStartDate, lifecycle?.planningStartDateString,
    lifecycle?.developmentStartDate, lifecycle?.developmentStartDateString,
    lifecycle?.productionStartDate, lifecycle?.productionStartDateString,
    lifecycle?.retiredStartDate, lifecycle?.retiredStartDateString,
  ].map(parseEsatsDate).filter(Boolean);
  for (const transition of lifecycle?.lifecycleTransitions ?? []) collectTransitionDates(transition, dates);
  return dates.sort((left, right) => right - left)[0] ?? null;
}

function collectTransitionDates(value, dates, key = '') {
  if (value == null) return;
  if (Array.isArray(value)) {
    for (const item of value) collectTransitionDates(item, dates, key);
    return;
  }
  if (typeof value === 'object') {
    for (const [childKey, childValue] of Object.entries(value)) collectTransitionDates(childValue, dates, childKey);
    return;
  }
  if (!/(date|time|modified|created)/i.test(key)) return;
  const date = parseEsatsDate(value);
  if (date) dates.push(date);
}

function parseEsatsDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function firstValidDate(...values) {
  for (const value of values) {
    const date = parseEsatsDate(value);
    if (date) return date;
  }
  return null;
}

function latestEnabledHistoryDate(history) {
  return (history ?? [])
    .filter((entry) => normalizeText(entry?.changedValue) === 'y')
    .map((entry) => parseEsatsDate(entry?.changedTime))
    .filter(Boolean)
    .sort((left, right) => right - left)[0] ?? null;
}

function phaseName(value) {
  return String(value?.displayName ?? value?.name ?? value ?? '').trim();
}

function organizationName(value) {
  return String(value?.name ?? value?.displayName ?? value ?? '').trim();
}

function truthyFlag(value) {
  return value === true || ['y', 'yes', 'true', '1'].includes(normalizeText(value));
}

function names(people) {
  return people.map((person) => String(person.name ?? '').trim()).filter(Boolean);
}

function bemsIds(people) {
  return people.map((person) => String(person.bemsId ?? '').trim());
}

function formatAllContacts(groups) {
  return [...groups.entries()].flatMap(([role, people]) => people.map((person) => `${readableRole(role)}: ${person.name ?? ''}${person.bemsId ? ` (${person.bemsId})` : ''}`));
}

function readableRole(value) {
  return value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/application/gi, 'Application ').replace(/\s+/g, ' ').trim();
}

function displayObject(value) {
  return String(value?.name ?? value?.displayName ?? value ?? '').trim();
}

function isoOrEmpty(date) {
  return date ? date.toISOString() : '';
}
