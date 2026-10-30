import test from 'node:test';
import assert from 'node:assert/strict';
import { istDateKey, shouldRefreshEsats } from '../src/js/esats-sync.js';

test('ESATS daily refresh key follows the IST calendar date', () => {
  assert.equal(istDateKey(new Date('2026-10-29T20:00:00.000Z')), '2026-10-30');
  assert.equal(istDateKey(new Date('2026-10-29T17:00:00.000Z')), '2026-10-29');
});

test('ESATS data refreshes automatically only once per IST day', () => {
  const now = new Date('2026-10-29T20:00:00.000Z');
  assert.equal(shouldRefreshEsats({ dateKey: '2026-10-30' }, now), false);
  assert.equal(shouldRefreshEsats({ dateKey: '2026-10-29' }, now), true);
  assert.equal(shouldRefreshEsats(null, now), true);
});
