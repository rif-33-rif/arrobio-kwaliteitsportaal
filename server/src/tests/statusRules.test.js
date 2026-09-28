import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertValidTransition, canTransition, InvalidTransitionError } from '../lib/statusRules.js';

test('NIEUW mag naar GEPLAND', () => {
  assert.doesNotThrow(() => assertValidTransition('NIEUW', 'GEPLAND'));
});

test('NIEUW mag niet direct naar VRIJGEGEVEN (statusmodel mag niet worden overgeslagen)', () => {
  assert.throws(() => assertValidTransition('NIEUW', 'VRIJGEGEVEN'), InvalidTransitionError);
});

test('MANAGERCONTROLE mag naar VRIJGEGEVEN of terug naar HERSTEL_NODIG', () => {
  assert.equal(canTransition('MANAGERCONTROLE', 'VRIJGEGEVEN'), true);
  assert.equal(canTransition('MANAGERCONTROLE', 'HERSTEL_NODIG'), true);
  assert.equal(canTransition('MANAGERCONTROLE', 'IN_UITVOERING'), false);
});

test('VRIJGEGEVEN kan alleen formeel HEROPEND worden, niet stil gewijzigd', () => {
  assert.equal(canTransition('VRIJGEGEVEN', 'HEROPEND'), true);
  assert.equal(canTransition('VRIJGEGEVEN', 'GEREED_VOOR_CONTROLE'), false);
});

test('GEANNULEERD is een eindstatus zonder vervolgstappen', () => {
  assert.equal(canTransition('GEANNULEERD', 'NIEUW'), false);
});
