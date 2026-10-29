export function normalizeText(value) {
  return String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

export function organizationKey(value) {
  return normalizeText(String(value ?? '').split('::')[0]);
}

export function organizationLabel(value) {
  return String(value ?? '').split('::')[0].trim().replace(/\s+/g, ' ');
}

export function personKey(value) {
  let text = normalizeText(value).replace(/[^a-z0-9, -]/g, ' ');
  if (text.includes(',')) {
    const [last, ...rest] = text.split(',');
    text = `${rest.join(' ')} ${last}`;
  }
  return text.split(/[\s-]+/).filter((token) => token.length > 1).join(' ');
}

export function filterSupportedApplications(applications, config) {
  const included = new Set(config.includedOrganizations.map(organizationKey));
  const restricted = new Map(Object.entries(config.restrictedOrganizations ?? {}).map(([organization, names]) => [
    organizationKey(organization), new Set(names.map(normalizeText)),
  ]));
  const appExceptions = new Set(config.applicationExceptions.map(normalizeText));
  const managerExceptions = new Map();
  for (const rule of config.managerExceptions) {
    const organization = organizationKey(rule.organization);
    if (!managerExceptions.has(organization)) managerExceptions.set(organization, new Set());
    managerExceptions.get(organization).add(personKey(rule.manager));
  }

  return applications.filter((app) => {
    const organization = organizationKey(app.Maintaining_Organization);
    const name = normalizeText(app.Application ?? app.Application_Name ?? app.Asset_Name);
    if (!included.has(organization) || !name || appExceptions.has(name)) return false;
    const allowedNames = restricted.get(organization);
    if (allowedNames && !allowedNames.has(name)) return false;
    const excludedManagers = managerExceptions.get(organization);
    if (excludedManagers?.has(personKey(app.Application_Manager))) return false;
    return true;
  });
}

export function evaluateDashboard(data, config, now = new Date()) {
  const supportedApps = filterSupportedApplications(data.systemDetails ?? [], config);
  const supportedByName = new Map(supportedApps.map((app) => [normalizeText(app.Application), app]));
  const joinSupported = (rows, nameField) => rows.flatMap((row) => {
    const source = supportedByName.get(normalizeText(row[nameField]));
    return source ? [{ ...source, ...row, _support: source }] : [];
  });

  const systemRows = supportedApps.map((row) => standardize(row, isCompliant(row.System_Criticality_Assessment_Current), []));
  const riskRows = joinSupported(data.riskDetails ?? [], 'Application').map((row) => standardize(row, isCompliant(row.Risk_Prolifer_Current), []));
  const accessRows = joinSupported(data.accessDetails ?? [], 'Application').map((row) => standardize(row, isCompliant(row.ACP_Reviewed), []));
  const nistRows = joinSupported(data.nistDetails ?? [], 'Asset_Name')
    .filter((row) => normalizeText(row.Has_CUI) === 'true')
    .map((row) => {
      const completed = parseDate(row.Nist_Assessment_Completion_Date);
      const nextDue = completed ? addCalendarYear(completed) : null;
      const current = Boolean(nextDue && endOfDay(nextDue) >= now);
      const compliant = current && isCompliant(row.Overall_NIST_Compliance);
      const reasons = [];
      if (!completed) reasons.push('Assessment completion date missing');
      else if (!current) reasons.push('Annual assessment expired');
      if (!isCompliant(row.Overall_NIST_Compliance)) reasons.push('NIST assessment or POA&M is non-compliant');
      return standardize({ ...row, NIST_Next_Due_Date: nextDue ? formatDate(nextDue) : '' }, compliant, reasons);
    });
  const recoveryRows = joinSupported(data.recoveryDetails ?? [], 'Application_Name').map((row) => evaluateRecovery(row, now));

  const metricSpecs = [
    ['system', 'System Criticality', systemRows, data.systemRollups, 'Current annual assessment'],
    ['nist', 'NIST 800-171 CUI', nistRows, data.nistRollups, 'CUI applications only; due one year after completion'],
    ['recovery', 'Recovery Plan', recoveryRows, data.recoveryRollups, 'Plan approval, currency, and required validation dates'],
    ['risk', 'Risk Profiler', riskRows, data.riskRollups, 'Current annual Risk Profiler assessment'],
    ['access', 'Access Control Policy', accessRows, data.accessRollups, 'Current application ACP review'],
  ];
  const metrics = metricSpecs.map(([id, title, rows, rollups, note]) => summarizeMetric(id, title, rows, rollups, note, now));
  return { supportedApps, metrics };
}

function evaluateRecovery(row, now) {
  const level = Number(String(row.Recovery_Level ?? '').match(/RL\s*(\d)/i)?.[1] ?? 0);
  const complete = isCompliant(row.Plans_Complete);
  const current = isCompliant(row.Plans_Current);
  const apiValidated = isCompliant(row.Plans_Tested_And_Validated);
  const requirements = level === 1 ? [['Orientation_Date', 365], ['Table_Top_Date', 365]]
    : level === 2 ? [['Orientation_Date', 365], ['Table_Top_Date', 365], ['Drill_Date', 365]]
    : level === 3 ? [['Orientation_Date', 180], ['Table_Top_Date', 365], ['Drill_Date', 365]]
    : level === 4 || level === 5 ? [['Orientation_Date', 180], ['Functional_Date', 365]]
    : [];
  const stale = requirements.filter(([field, days]) => !dateWithin(row[field], days, now)).map(([field]) => readableField(field));
  const reasons = [];
  if (!complete) reasons.push('Recovery plan is incomplete');
  if (complete && !current) reasons.push('Approved plan has incomplete validations');
  if (!apiValidated) reasons.push('Plan is not tested and validated');
  if (stale.length) reasons.push(`Required validation overdue: ${stale.join(', ')}`);
  const functionalPending = (level === 4 || level === 5) && complete && current && !dateWithin(row.Functional_Date, 365, now);
  const compliant = complete && current && apiValidated && stale.length === 0;
  return standardize({
    ...row,
    _planComplete: complete,
    _planCurrent: current,
    _validationIncomplete: complete && !current,
    _functionalPending: functionalPending,
    _recoveryLevelNumber: level,
  }, compliant, reasons);
}

function standardize(row, compliant, reasons) {
  return { ...row, _compliant: Boolean(compliant), _status: compliant ? 'Compliant' : 'Non-Compliant', _reasons: reasons };
}

function summarizeMetric(id, title, rows, rollups, note, now) {
  const compliantRows = rows.filter((row) => row._compliant);
  const nonCompliantRows = rows.filter((row) => !row._compliant);
  const total = rows.length;
  const compliantPercent = total ? compliantRows.length / total * 100 : 0;
  const extractRaw = rollups?.find((row) => row.EXTRACTDATE)?.EXTRACTDATE ?? '';
  return {
    id, title, note, rows, compliantRows, nonCompliantRows, total,
    compliant: compliantRows.length,
    nonCompliant: nonCompliantRows.length,
    compliantPercent,
    nonCompliantPercent: total ? 100 - compliantPercent : 0,
    extract: formatPacificExtract(extractRaw, now),
  };
}

export function isCompliant(value) {
  return normalizeText(value) === 'compliant';
}

export function parseDate(value) {
  const text = String(value ?? '').trim();
  if (!text || /not required|never done|due now/i.test(text) || /1900/.test(text)) return null;
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    const date = new Date(Number(match[3]), Number(match[1]) - 1, Number(match[2]));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addCalendarYear(date) {
  const result = new Date(date);
  result.setFullYear(result.getFullYear() + 1);
  return result;
}

function dateWithin(value, days, now) {
  const date = parseDate(value);
  if (!date) return false;
  const age = now.getTime() - endOfDay(date).getTime();
  return age <= days * 86_400_000;
}

function endOfDay(date) {
  const result = new Date(date);
  result.setHours(23, 59, 59, 999);
  return result;
}

export function formatDate(date) {
  return new Intl.DateTimeFormat('en-IN', { year: 'numeric', month: 'short', day: '2-digit' }).format(date);
}

function readableField(field) {
  return field.replace(/_Date$/, '').replaceAll('_', ' ').toLowerCase();
}

export function formatPacificExtract(raw, now = new Date()) {
  const text = String(raw ?? '').trim();
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})\s+PT$/i);
  if (!match) return { raw: text, formatted: text || 'Not available', iso: '' };
  const month = Number(match[1]);
  const day = Number(match[2]);
  const hour = Number(match[3]);
  const minute = Number(match[4]);
  let year = now.getFullYear();
  if (month > now.getMonth() + 2) year -= 1;
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute);
  const pacificParts = partsInZone(new Date(utcGuess), 'America/Los_Angeles');
  const pacificAsUtc = Date.UTC(pacificParts.year, pacificParts.month - 1, pacificParts.day, pacificParts.hour, pacificParts.minute);
  const date = new Date(utcGuess - (pacificAsUtc - utcGuess));
  return {
    raw: text,
    iso: date.toISOString(),
    formatted: new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata', year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true,
    }).format(date) + ' IST',
  };
}

function partsInZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
}
