import assert from 'node:assert/strict';
import test from 'node:test';
import { PerspectiveCamera, Scene, Vector3 } from 'three';
import { f16 } from '../src/aircraft/f16.js';
import { attenuation } from '../src/audio/flight-sound.js';
import { CombatExercise, combatExercises } from '../src/sim/combat/exercise.js';
import { Dogfight } from '../src/sim/dogfight.js';
import { Flight } from '../src/sim/flight.js';
import { range, scenarios } from '../src/sim/range.js';
import { CombatCamera } from '../src/view/combat-camera.js';
import { KnownContacts } from '../src/view/contacts.js';
import { FlightTrails } from '../src/view/trails.js';

const camera = () => {
  const view = new PerspectiveCamera(51, 16 / 9, 0.4, 10000);
  view.position.set(0, 1000, 0);
  view.updateMatrixWorld();
  return view;
};

test('visual tracks hold a terrain-obscured last observation briefly and expire', () => {
  let terrain = 0;
  const contacts = new KnownContacts({ heightAt: () => terrain });
  const own = { elapsed: 0, position: new Vector3(0, 1000, 0) };
  const enemy = { position: new Vector3(0, 1000, -700) };
  const view = camera();
  assert.equal(contacts.update(own, view, [enemy], null).label, 'VISUAL');
  terrain = 1200;
  own.elapsed = 0.7;
  enemy.position.z = -930;
  let contact = contacts.update(own, view, [enemy], null);
  assert.equal(contact.label, 'LAST SEEN');
  assert.equal(contact.position.z, -700);
  assert.ok(contact.freshness < 0.5);
  own.elapsed = 1.3;
  assert.equal(contacts.update(own, view, [enemy], null), null);
  const radar = { mode: 'SEARCH', selected: enemy, contacts: new Map([
    [enemy, { position: new Vector3(52, 1000, -1000), time: 1.1, range: 1000 }],
  ]) };
  contact = contacts.update(own, view, [enemy], radar);
  assert.equal(contact.position.x, 52);
  assert.equal(contact.label, 'SEARCH');
  own.elapsed = 2.3;
  assert.equal(contacts.update(own, view, [enemy], radar), null);
});

test('a missile camera switches only between its owner’s missiles and returns on slot reuse', () => {
  const base = camera();
  const view = new CombatCamera({ heightAt: () => 0 });
  const owner = {};
  const enemy = {};
  const make = (serial, craft = owner) => ({
    serial, owner: craft, active: true, age: 0.2, trackUntil: 0.5, position: new Vector3(serial, 900, -400),
    previous: new Vector3(4, 900, -380), direction: new Vector3(0, 0, -1), estimate: new Vector3(100, 900, -800),
  });
  const first = make(1);
  const second = make(2);
  const pool = [first, second, make(3, enemy)];
  const own = { position: new Vector3(0, 1000, 0) };
  const original = base.position.clone();
  const originalDirection = second.direction.clone();
  view.cycle(owner, pool);
  assert.equal(view.serial, 2);
  assert.equal(view.mode, 'missile-chase');
  assert.notEqual(view.update(base, own, null, 0.5, 0.1), base);
  view.cycle(owner, pool);
  assert.equal(view.mode, 'missile-track');
  view.next(owner, pool);
  assert.equal(view.serial, 1);
  first.serial = 4;
  assert.notEqual(view.update(base, own, null, 0.5, 0.1), base);
  assert.equal(view.mode, 'aircraft');
  for (let i = 0; i < 10; i++) view.update(base, own, null, 1, 0.1);
  assert.equal(view.update(base, own, null, 1, 0.1), base);
  assert.ok(base.position.equals(original));
  assert.ok(second.direction.equals(originalDirection));
  view.toggleTarget({ target: enemy, position: new Vector3(100, 900, -800) });
  assert.equal(view.target, enemy);
  view.update(base, own, null, 1, 0.1);
  assert.equal(view.mode, 'aircraft');
});

test('Outnumbered shares the player hull but counts both independent opponents', () => {
  const own = new Flight(f16, range);
  const effects = { shot: () => {}, impact: () => {}, burst: () => {} };
  const first = new Dogfight(own, f16, range, effects);
  const second = new Dogfight(own, f16, range, effects, first.playerHull);
  const combat = new CombatExercise(first, range, effects, undefined, second);
  const setup = combatExercises.outnumbered;
  own.reset(scenarios.outnumbered);
  first.reset('aggressive', scenarios.outnumbered, setup.opponent);
  second.reset('aggressive', scenarios.outnumbered, setup.wingman);
  combat.reset('outnumbered');
  assert.deepEqual(combat.player.candidates, [first.opponent, second.opponent]);
  assert.equal(combat.player.rack.count('radar'), 1);
  assert.equal(combat.player.rack.count('infrared'), 1);
  assert.equal(combat.player.rack.chaff, 4);
  assert.equal(second.playerHull, first.playerHull);
  assert.ok(combat.shotTargets.includes(second.opponentHull.colliders[0]));
  first.opponent.failure = 'Pilot incapacitated';
  assert.equal(combat.enemiesDown, 1);
  assert.equal(combat.finish(), '');
  second.opponent.failure = 'Airframe failure';
  assert.equal(combat.enemiesDown, 2);
  assert.equal(combat.finish(), 'win');
  own.failure = 'Ground impact';
  assert.equal(combat.finish(), 'draw');
  combat.reset('short');
  assert.equal(combat.enemies.length, 1);
  assert.equal(combat.player.rack.count('infrared'), 2);
});

test('ribbons connect position samples, never bridge reused slots, and age out', () => {
  const missile = { active: true, age: 0.1, config: { burn: 1 }, serial: 1, position: new Vector3(5, 900, -30) };
  const trails = new FlightTrails(new Scene(), [missile], []);
  const view = camera();
  trails.step(0, []);
  missile.position.set(6, 901, -50);
  trails.step(0.08, []);
  trails.render(0.08, view);
  assert.equal(trails.geometry.drawRange.count, 6);
  missile.serial = 2;
  missile.position.set(0, 901, -500);
  trails.step(0.16, []);
  trails.render(0.16, view);
  assert.equal(trails.geometry.drawRange.count, 6);
  missile.age = 1.2;
  trails.step(0.28, []);
  trails.render(6, view);
  assert.equal(trails.mesh.visible, false);
  assert.ok(attenuation(20, 100) > attenuation(800, 100));
});
