const API_ORIGIN = 'https://scorecard-api.tas-ewd.apps.boeing.com';

export const ENDPOINTS = Object.freeze({
  systemDetails: '/Metric/GetMetricsDataDetails',
  systemRollups: '/Metric/GetMetricsDataRollUps',
  recoveryDetails: '/Metric/GetAppRecoveryPlanDetails',
  recoveryRollups: '/Metric/GetAppRecoveryPlanRollUps',
  riskDetails: '/Metric/GetRiskProfilerDetails',
  riskRollups: '/Metric/GetRiskProfilerRollUps',
  accessDetails: '/Metric/GetAccessControlDetails',
  accessRollups: '/Metric/GetAccessControlRollUps',
  nistDetails: '/Metric/GetNistTypeDetails',
  nistRollups: '/Metric/GetNistTypeRollUps',
});

export async function fetchAllComplianceData(bemsId, { signal } = {}) {
  const common = { bemsid: bemsId };
  const nist = { ...common, Type: 'Application (ESATS)' };
  const requests = Object.entries(ENDPOINTS).map(async ([key, endpoint]) => {
    const params = key.startsWith('nist') ? nist : common;
    return [key, await fetchJson(endpoint, params, { signal })];
  });
  return Object.fromEntries(await Promise.all(requests));
}

export async function fetchApplicationInventory(bemsId, { signal } = {}) {
  return fetchJson(ENDPOINTS.systemDetails, { bemsid: bemsId }, { signal });
}

async function fetchJson(path, params, { signal } = {}) {
  const url = new URL(path, API_ORIGIN);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const timeout = AbortSignal.timeout ? AbortSignal.timeout(45_000) : null;
  const combined = signal && timeout && AbortSignal.any ? AbortSignal.any([signal, timeout]) : (signal ?? timeout);
  const response = await fetch(url, {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
    headers: { Accept: 'application/json, text/plain, */*' },
    signal: combined,
  });
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}.`);
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`${path} returned invalid JSON.`); }
  if (!Array.isArray(data)) throw new Error(`${path} returned an unexpected response shape.`);
  return data;
}
