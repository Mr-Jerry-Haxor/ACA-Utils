const API_ORIGIN = 'https://service-gateway.tas-phx.apps.boeing.com';

export const ESATS_ENDPOINTS = Object.freeze({
  maintainingOrganizations: '/gateway/taxonomy/Search/SearchMaintainingOrganization',
  applicationsByOrganization: '/gateway/taxonomy/OrganizationConnection/GetRelatedBusinessApplicationsByOrgId',
  searchApplications: '/gateway/asset/search/SearchBusinessApplicationWithFilter',
  lifecycle: '/gateway/asset/BusinessApplicationLifecycle/GetDeploymentLifecycle',
  contacts: '/gateway/asset/BusinessApplicationSummary/GetContactDetailsSummary',
});

export function fetchMaintainingOrganizations(options) {
  return fetchJson(ESATS_ENDPOINTS.maintainingOrganizations, { searchText: '-all' }, options);
}

export function fetchApplicationsForOrganization(id, options) {
  return fetchJson(ESATS_ENDPOINTS.applicationsByOrganization, { id, recordType: 'All' }, options);
}

export function fetchMarkedForDeletionApplications(options) {
  return fetchJson(ESATS_ENDPOINTS.searchApplications, null, {
    ...options,
    method: 'POST',
    body: { esatsId: null, name: '', extendedName: '', deploymentLifecyclePhaseId: null, markedForDeletionOnly: true },
  });
}

export function fetchApplicationLifecycle(esatsId, options) {
  return fetchJson(ESATS_ENDPOINTS.lifecycle, { esatsId }, options);
}

export function fetchApplicationContacts(esatsId, options) {
  return fetchJson(ESATS_ENDPOINTS.contacts, { esatsId }, options);
}

async function fetchJson(path, params, { signal, method = 'GET', body = null, token: tokenValue = '' } = {}) {
  const token = String(tokenValue).trim().replace(/^Bearer\s+/i, '');
  if (!token) throw new Error('Waiting for ESATS sign-in/token.');
  const url = new URL(path, API_ORIGIN);
  for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, value);
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const timeout = AbortSignal.timeout ? AbortSignal.timeout(60_000) : null;
      const combined = signal && timeout && AbortSignal.any ? AbortSignal.any([signal, timeout]) : (signal ?? timeout);
      const response = await fetch(url, {
        method,
        credentials: 'include',
        cache: 'no-store',
        headers: { Accept: 'application/json, text/plain, */*', Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : null,
        signal: combined,
      });
      if (!response.ok) {
        const error = new Error(`${path} returned HTTP ${response.status}.`);
        error.status = response.status;
        if (attempt === 0 && (response.status === 429 || response.status >= 500)) {
          await delay(500, signal);
          lastError = error;
          continue;
        }
        throw error;
      }
      const text = await response.text();
      try { return JSON.parse(text); } catch { throw new Error(`${path} returned invalid JSON.`); }
    } catch (error) {
      if (error.name === 'AbortError' || error.name === 'TimeoutError') throw error;
      lastError = error;
      if (attempt === 0 && !error.status) {
        await delay(500, signal);
        continue;
      }
      throw error;
    }
  }
  throw lastError ?? new Error(`${path} could not be loaded.`);
}

function delay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}
