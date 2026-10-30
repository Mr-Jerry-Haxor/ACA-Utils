import fs from 'node:fs';

const har = JSON.parse(fs.readFileSync('research data/esats.web.boeing.com.har', 'utf8'));
const config = JSON.parse(fs.readFileSync('research data/supported-mo-configuration.json', 'utf8'));
const entries = har.log?.entries ?? [];
const contracts = [
  { path: '/gateway/taxonomy/Search/SearchMaintainingOrganization', method: 'GET', type: 'array', fields: ['id', 'name'] },
  { path: '/gateway/taxonomy/OrganizationConnection/GetRelatedBusinessApplicationsByOrgId', method: 'GET', type: 'array', fields: ['name', 'businessApplicationEsatsId', 'deploymentLifecyclePhaseType', 'isSoftDeleted'] },
  { path: '/gateway/asset/search/SearchBusinessApplicationWithFilter', method: 'POST', type: 'array', fields: ['esatsId', 'name', 'deploymentLifecyclePhaseType'] },
  { path: '/gateway/asset/BusinessApplicationLifecycle/GetDeploymentLifecycle', method: 'GET', type: 'object', fields: ['retiredStartDate', 'deploymentPhaseTypeName'] },
  { path: '/gateway/asset/BusinessApplicationSummary/GetContactDetailsSummary', method: 'GET', type: 'array', fields: ['roleType', 'users'] },
];

let organizations = [];
for (const contract of contracts) {
  const entry = entries.find((candidate) => {
    try { return candidate.request.method === contract.method && candidate.response.status === 200 && new URL(candidate.request.url).pathname === contract.path && candidate.response.content.text; }
    catch { return false; }
  });
  if (!entry) throw new Error(`Missing successful ${contract.method} contract for ${contract.path}.`);
  const body = JSON.parse(entry.response.content.text);
  if (contract.type === 'array' && !Array.isArray(body)) throw new Error(`${contract.path} did not return an array.`);
  if (contract.type === 'object' && (!body || typeof body !== 'object' || Array.isArray(body))) throw new Error(`${contract.path} did not return an object.`);
  const sample = Array.isArray(body) ? body[0] : body;
  for (const field of contract.fields) if (!Object.hasOwn(sample, field)) throw new Error(`${contract.path} is missing ${field}.`);
  if (contract.path.endsWith('/SearchMaintainingOrganization')) organizations = body;
}

const organizationNames = new Set(organizations.map((organization) => normalize(organization.name)));
const missing = config.includedOrganizations.filter((name) => !organizationNames.has(normalize(name)));
if (missing.length) throw new Error(`Configured MOs missing from ESATS contract: ${missing.join(', ')}.`);
console.log(`Verified ${contracts.length} ESATS endpoint contracts and ${config.includedOrganizations.length} configured MO mappings.`);

function normalize(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}
