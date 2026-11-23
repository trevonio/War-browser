import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countermeasureProgram, FlightInput, secondaryAction } from '../src/combat-input.js';
import { keyDefaults, loadSettings, resetBindings } from '../src/controls.js';

test('legacy defaults migrate without dropping customized bindings or creating duplicates', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => JSON.stringify({ keys: { sight: 'KeyC', yawLeft: 'KeyQ', rollLeft: 'BracketLeft', radarRange: 'KeyM' } }) },
  });
  try {
    const { keys } = loadSettings();
    assert.equal(keys.podView, 'KeyC');
    assert.equal(keys.yawLeft, 'KeyZ');
    assert.equal(keys.cycleWeapon, 'KeyQ');
    assert.equal(keys.rollLeft, 'BracketLeft');
    assert.equal(keys.radarRange, 'KeyM');
    assert.notEqual(keys.tacticalMap, 'KeyM');
    assert.equal(new Set(Object.values(keys)).size, Object.keys(keyDefaults).length);
    const reset = resetBindings(keys, false);
    assert.equal(reset.tacticalMap, 'KeyM');
    assert.equal(reset.rollLeft, 'KeyA');
    assert.notEqual(reset.radarRange, 'KeyM');
    assert.equal(new Set(Object.values(reset)).size, Object.keys(keyDefaults).length);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  }
});

test('one keypress dispatches one secondary action and focused buttons keep their keyboard activation', () => {
  let actions = 0;
  const held = new Set();
  const router = new FlightInput({ keys: keyDefaults }, { held, clear: () => held.clear() },
    { flying: () => true, available: () => true }, { fireSelected: () => actions++ }, () => {});
  const event = (repeat = false, button = false) => ({
    code: 'Space', repeat, target: { closest: (selector) => button && selector === 'button' },
    preventDefault() { this.prevented = true; },
  });
  const initial = event();
  router.keydown(initial);
  router.keydown(event());
  router.keydown(event(true));
  assert.equal(initial.prevented, true);
  assert.equal(actions, 1);
  router.keyup(initial);
  const focused = event(false, true);
  router.keydown(focused);
  assert.equal(focused.prevented, undefined);
  assert.equal(actions, 1);
  router.keydown(event());
  assert.equal(actions, 2);
});

test('weapon prompts and defensive programs use real readiness and warning state', () => {
  assert.equal(secondaryAction('infrared', 'SEEKER STANDBY'), 'ACQUIRE TARGET');
  assert.equal(secondaryAction('infrared', 'ACQUIRING'), 'ACQUIRING');
  assert.equal(secondaryAction('optical', 'CLEARED'), 'FIRE MISSILE');
  assert.equal(secondaryAction('laser', 'OUTSIDE RELEASE ZONE'), 'OUTSIDE RELEASE ZONE');
  assert.equal(countermeasureProgram('auto', 'mixed', 'TRACK'), 'chaff');
  assert.equal(countermeasureProgram('auto', 'mixed', ''), 'mixed');
  assert.equal(countermeasureProgram('flare', 'mixed', 'TRACK'), 'flare');
});

test('release classifies a long target hold correctly even if the main thread delays its timer', () => {
  const actions = [];
  const router = new FlightInput({ keys: keyDefaults }, { held: new Set(), clear() {} },
    { flying: () => true, available: () => true },
    { targetAction: () => actions.push('select'), clearTarget: () => actions.push('clear') }, () => {});
  const event = (timeStamp) => ({ code: 'KeyR', timeStamp, target: {}, preventDefault() {} });
  router.keydown(event(0));
  router.keyup(event(500));
  router.keydown(event(600));
  router.keyup(event(700));
  router.keydown(event(800));
  router.clear();
  router.keyup(event(900));
  assert.deepEqual(actions, ['clear', 'select']);
});
