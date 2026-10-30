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
  const managerExceptions = new Set();
  for (const rule of config.managerExceptions) {
    const manager = typeof rule === 'string' ? rule : rule?.manager;
    if (manager) managerExceptions.add(personKey(manager));
  }
  const asaExceptions = new Set();
  for (const rule of config.asaExceptions ?? []) {
    const asa = typeof rule === 'string' ? rule : rule?.asa;
    if (asa) asaExceptions.add(personKey(asa));
  }

  return applications.filter((app) => {
    const organization = organizationKey(app.Maintaining_Organization);
    const name = normalizeText(app.Application ?? app.Application_Name ?? app.Asset_Name);
    if (!included.has(organization) || !name || appExceptions.has(name)) return false;
    const allowedNames = restricted.get(organization);
    if (allowedNames && !allowedNames.has(name)) return false;
    if (managerExceptions.has(personKey(app.Application_Manager))) return false;
    const asa = app.Application_Security_Administrator;
    if (asaExceptions.has(personKey(asa))) return false;
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

  const systemPopulation = config.excludeBlankAsaFromScmp
    ? supportedApps.filter((row) => normalizeText(row.Application_Security_Administrator))
    : supportedApps;
  const systemRows = systemPopulation.map((row) => standardize(row, isCompliant(row.System_Criticality_Assessment_Current), []));
  const riskRows = joinSupported(data.riskDetails ?? [], 'Application').map((row) => standardize(row, isCompliant(row.Risk_Prolifer_Current), []));
  const accessRows = joinSupported(data.accessDetails ?? [], 'Application').map((row) => standardize(row, isCompliant(row.ACP_Reviewed), []));
  const nistByName = new Map((data.nistDetails ?? []).map((row) => [normalizeText(row.Asset_Name), row]));
  const nistRows = riskRows.map((riskRow) => {
    const application = riskRow._support ?? riskRow;
    const detail = nistByName.get(normalizeText(application.Application));
    const row = detail ? { ...application, ...detail, _support: application } : { ...application, Asset_Name: application.Application, _support: application };
    if (normalizeText(row.Has_CUI) !== 'true') {
      return standardize({
        ...row,
        _nistPopulationStatus: detail ? 'Risk Profiler non-CUI application' : 'Risk Profiler application without NIST detail',
        _sowStatus: 'Compliant',
        _sowOverride: false,
        _sowBasis: 'Included in the Risk Profiler application denominator; not added to the CUI non-compliant population',
        NIST_Next_Due_Date: '',
      }, true, []);
    }
      const completed = parseDate(row.Nist_Assessment_Completion_Date);
      const nextDue = completed ? addCalendarYear(completed) : null;
      const current = Boolean(nextDue && endOfDay(nextDue) >= now);
      const sourceCompliant = isCompliant(row.Overall_NIST_Compliance);
      const findings = Number(row.Open_Findings ?? 0);
      const sowOverride = !sourceCompliant && findings > 0 && Boolean(nextDue && startOfDay(nextDue) >= startOfTomorrow(now));
      const compliant = current && (sourceCompliant || sowOverride);
      const reasons = [];
      if (!completed) reasons.push('Assessment completion date missing');
      else if (!current) reasons.push('Annual assessment expired');
      if (!sourceCompliant && !sowOverride) reasons.push('NIST assessment or POA&M is non-compliant');
      return standardize({
        ...row,
        _nistPopulationStatus: 'CUI application',
        NIST_Next_Due_Date: nextDue ? formatDate(nextDue) : '',
        _sowStatus: compliant ? 'Compliant' : 'Non-Compliant',
        _sowOverride: sowOverride,
        _sowBasis: sowOverride ? `${findings} finding${findings === 1 ? '' : 's'} with assessment due tomorrow or later` : sourceCompliant ? 'Source status is compliant and assessment is current' : '',
      }, compliant, reasons);
  });
  const recoveryRows = joinSupported(data.recoveryDetails ?? [], 'Application_Name').map((row) => evaluateRecovery(row, now));

  const metricSpecs = [
    ['system', 'System Criticality', systemRows, data.systemRollups, config.excludeBlankAsaFromScmp ? 'Current annual assessment; blank ASA applications excluded from SCMP percentage' : 'Current annual assessment'],
    ['recovery', 'Recovery Plan', recoveryRows, data.recoveryRollups, 'Compliance percentage uses Plan Current status'],
    ['risk', 'Risk Profiler', riskRows, data.riskRollups, 'Current annual Risk Profiler assessment'],
    ['access', 'Access Control Policy', accessRows, data.accessRollups, 'Current application ACP review'],
    ['nist', 'NIST 800-171 CUI', nistRows, data.nistRollups, 'Risk Profiler application population; non-compliance remains based on CUI assessments'],
  ];
  const metrics = metricSpecs.map(([id, title, rows, rollups, note]) => summarizeMetric(id, title, rows, rollups, note, now));
  return { supportedApps, metrics };
}

export function collectNonCompliantRecords(metrics) {
  return metrics.flatMap((metric) => metric.nonCompliantRows.map((row) => ({
    ...row,
    _deliverable: metric.title,
    _deliverableId: metric.id,
  })));
}

export function getBlankAsaApplications(applications) {
  return applications.filter((row) => !normalizeText(row.Application_Security_Administrator));
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
  const attention = [];
  if (!complete) attention.push('Recovery plan is incomplete');
  if (complete && !current) attention.push('Approved plan has incomplete validations');
  if (!apiValidated) attention.push('Plan is not tested and validated');
  if (stale.length) attention.push(`Required validation overdue: ${stale.join(', ')}`);
  const reasons = current ? [] : attention;
  const functionalPending = (level === 4 || level === 5) && complete && current && !dateWithin(row.Functional_Date, 365, now);
  const compliant = current;
  return standardize({
    ...row,
    _planComplete: complete,
    _planCurrent: current,
    _validationIncomplete: complete && !current,
    _functionalPending: functionalPending,
    _functionalTest: functionalTestStatus(level, row.Functional_Date, now),
    _recoveryLevelNumber: level,
    _recoveryAttention: attention,
  }, compliant, reasons);
}

function functionalTestStatus(level, value, now) {
  if (level < 4) return 'N/A';
  const normalized = normalizeText(value);
  if (normalized === 'not required') return 'N/A';
  if (normalized === 'never done') return 'No';
  const date = parseDate(value);
  if (!date) return 'No';
  const cutoff = startOfDay(now);
  cutoff.setDate(cutoff.getDate() - 365);
  return date > cutoff ? 'Yes' : 'No';
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

function startOfDay(date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function startOfTomorrow(date) {
  const result = startOfDay(date);
  result.setDate(result.getDate() + 1);
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
