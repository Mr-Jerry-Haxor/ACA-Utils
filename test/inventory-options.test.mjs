import test from 'node:test';
import assert from 'node:assert/strict';
import { findInventoryMatch, searchInventoryValues, uniqueInventoryValues } from '../src/js/inventory-options.js';
import { personKey } from '../src/js/logic.js';

test('inventory options deduplicate and search as the user types', () => {
  const options = uniqueInventoryValues(['Enterprise Portal', 'enterprise portal', 'Finance App']);
  assert.deepEqual(options, ['Enterprise Portal', 'Finance App']);
  assert.deepEqual(searchInventoryValues('enter port', options), ['Enterprise Portal']);
});

test('manager matching accepts display-order differences and unmatched values resolve to null', () => {
  const managers = ['Martin T Atkinson', 'Jamey D Etchen'];
  assert.equal(findInventoryMatch('Atkinson, Martin T', managers, personKey), 'Martin T Atkinson');
  assert.equal(findInventoryMatch('Unknown Manager', managers, personKey), null);
});
