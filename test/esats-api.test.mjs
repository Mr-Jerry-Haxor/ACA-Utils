import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchApplicationContacts, fetchApplicationLifecycle, fetchApplicationsForOrganization,
  fetchMaintainingOrganizations, fetchMarkedForDeletionApplications,
} from '../src/js/esats-api.js';

test('every ESATS gateway request sends the local-session token as Bearer authorization', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const options = { token: 'test-token' };
    await fetchMaintainingOrganizations(options);
    await fetchApplicationsForOrganization(669, options);
    await fetchMarkedForDeletionApplications(options);
    await fetchApplicationLifecycle(11622, options);
    await fetchApplicationContacts(11622, options);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(calls.length, 5);
  assert.ok(calls.every((call) => call.options.headers.Authorization === 'Bearer test-token'));
  assert.equal(calls.find((call) => call.options.method === 'POST').options.headers['Content-Type'], 'application/json');
});

test('ESATS gateway requests are rejected when no token is available', async () => {
  await assert.rejects(() => fetchMaintainingOrganizations(), /Waiting for ESATS sign-in\/token/);
});
