import { fetchApplicationContacts, fetchApplicationLifecycle, fetchApplicationsForOrganization, fetchMaintainingOrganizations, fetchMarkedForDeletionApplications } from './esats-api.js';
import { filterConfiguredEsatsApplications, filterOrganizationApplications, matchSupportedOrganizations, normalizeEsatsRecord } from './esats-logic.js';
import { saveEsatsSnapshot } from './esats-store.js';

export async function synchronizeEsats(config, { signal, onProgress = () => {} } = {}) {
  const startedAt = new Date();
  onProgress(1);
  const organizations = await fetchMaintainingOrganizations({ signal });
  if (!Array.isArray(organizations)) throw new Error('The maintaining-organization response was not a list.');
  const { matched, missing } = matchSupportedOrganizations(organizations, config);
  if (!matched.length) throw new Error('None of the configured maintaining organizations were found in ESATS.');
  onProgress(5);

  let completedOrganizationRequests = 0;
  const organizationResults = await mapLimit(matched, 5, async (organization) => {
    const rows = await fetchApplicationsForOrganization(organization.id, { signal });
    completedOrganizationRequests += 1;
    onProgress(5 + Math.round(completedOrganizationRequests / matched.length * 14));
    if (!Array.isArray(rows)) throw new Error(`Applications for ${organization.name} were not returned as a list.`);
    return filterOrganizationApplications(rows, organization, config).map((application) => ({ application, organization }));
  });

  const markedApplications = await fetchMarkedForDeletionApplications({ signal });
  const markedById = new Map((Array.isArray(markedApplications) ? markedApplications : []).map((application) => [Number(application.esatsId), application]));
  onProgress(20);

  const candidatesById = new Map();
  for (const candidate of organizationResults.flat()) {
    const esatsId = Number(candidate.application.businessApplicationEsatsId ?? candidate.application.esatsId);
    if (Number.isFinite(esatsId) && !candidatesById.has(esatsId)) candidatesById.set(esatsId, candidate);
  }
  const candidates = [...candidatesById.values()];
  const totalDetailRequests = Math.max(1, candidates.length * 2);
  let completedDetailRequests = 0;
  let detailErrors = 0;
  const syncedAt = new Date().toISOString();

  const records = await mapLimit(candidates, 8, async ({ application, organization }) => {
    const esatsId = Number(application.businessApplicationEsatsId ?? application.esatsId);
    const tracked = async (operation) => {
      try { return await operation(); }
      catch (error) {
        if (error.name === 'AbortError') throw error;
        detailErrors += 1;
        return { __syncError: error.message };
      }
      finally {
        completedDetailRequests += 1;
        onProgress(20 + Math.round(completedDetailRequests / totalDetailRequests * 79));
      }
    };
    const [lifecycleResult, contactsResult] = await Promise.all([
      tracked(() => fetchApplicationLifecycle(esatsId, { signal })),
      tracked(() => fetchApplicationContacts(esatsId, { signal })),
    ]);
    const lifecycle = lifecycleResult?.__syncError ? null : lifecycleResult;
    const contacts = contactsResult?.__syncError ? [] : contactsResult;
    const record = normalizeEsatsRecord({
      application,
      organization,
      lifecycle,
      contacts: Array.isArray(contacts) ? contacts : [],
      markedApplication: markedById.get(esatsId),
      syncedAt,
    });
    record.syncErrors = [lifecycleResult?.__syncError, contactsResult?.__syncError].filter(Boolean);
    return record;
  });

  const applications = filterConfiguredEsatsApplications(records, config);
  const applicationCountByMvo = new Map();
  for (const application of applications) applicationCountByMvo.set(application.mvoId, (applicationCountByMvo.get(application.mvoId) ?? 0) + 1);
  const mvos = matched.map((organization) => ({
    id: Number(organization.id),
    name: String(organization.name ?? '').trim(),
    applicationCount: applicationCountByMvo.get(Number(organization.id)) ?? 0,
    syncedAt,
  }));
  const metadata = {
    dateKey: istDateKey(startedAt),
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    configUpdatedAt: config.updatedAt ?? null,
    configuredMvoCount: config.includedOrganizations.length,
    matchedMvoCount: matched.length,
    missingMvos: missing,
    applicationCount: applications.length,
    detailErrors,
    status: detailErrors ? 'completed-with-errors' : 'completed',
  };
  await saveEsatsSnapshot({ applications, mvos, metadata });
  onProgress(100);
  return { applications, mvos, metadata };
}

export function istDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function shouldRefreshEsats(metadata, now = new Date()) {
  return metadata?.dateKey !== istDateKey(now);
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function run() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}
