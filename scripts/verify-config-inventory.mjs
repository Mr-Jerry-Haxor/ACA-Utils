import fs from 'node:fs';
import { DEFAULT_CONFIG } from '../src/js/default-config.js';
import { normalizeText, organizationKey, personKey } from '../src/js/logic.js';

const harPath = 'research data/scorecard-ui.tas-ewd.apps.boeing.com.har';
if (!fs.existsSync(harPath)) {
  console.log('HAR fixture is absent; configuration inventory verification skipped.');
  process.exit(0);
}
const har = JSON.parse(fs.readFileSync(harPath, 'utf8'));
const entry = (har.log?.entries ?? []).find((candidate) => {
  try { return candidate.request.method === 'GET' && candidate.response.status === 200 && new URL(candidate.request.url).pathname === '/Metric/GetMetricsDataDetails' && candidate.response?.content?.text; }
  catch { return false; }
});
const inventory = JSON.parse(entry.response.content.text);
const applications = new Set(inventory.map((row) => normalizeText(row.Application)).filter(Boolean));
const managersByOrganization = new Map();
const asasByOrganization = new Map();
for (const row of inventory) {
  const organization = organizationKey(row.Maintaining_Organization);
  if (!managersByOrganization.has(organization)) managersByOrganization.set(organization, new Set());
  if (!asasByOrganization.has(organization)) asasByOrganization.set(organization, new Set());
  if (row.Application_Manager) managersByOrganization.get(organization).add(personKey(row.Application_Manager));
  if (row.Application_Security_Administrator) asasByOrganization.get(organization).add(personKey(row.Application_Security_Administrator));
}
const missingApplications = DEFAULT_CONFIG.applicationExceptions.filter((name) => !applications.has(normalizeText(name)));
const missingManagers = DEFAULT_CONFIG.managerExceptions.filter((rule) => !managersByOrganization.get(organizationKey(rule.organization))?.has(personKey(rule.manager)));
const missingAsas = DEFAULT_CONFIG.asaExceptions.filter((rule) => !asasByOrganization.get(organizationKey(rule.organization))?.has(personKey(rule.asa)));
console.log(JSON.stringify({
  applicationExceptions: DEFAULT_CONFIG.applicationExceptions.length,
  matchedApplicationExceptions: DEFAULT_CONFIG.applicationExceptions.length - missingApplications.length,
  missingApplications,
  managerExceptions: DEFAULT_CONFIG.managerExceptions.length,
  matchedManagerExceptions: DEFAULT_CONFIG.managerExceptions.length - missingManagers.length,
  missingManagers,
  asaExceptions: DEFAULT_CONFIG.asaExceptions.length,
  matchedAsaExceptions: DEFAULT_CONFIG.asaExceptions.length - missingAsas.length,
  missingAsas,
}, null, 2));
