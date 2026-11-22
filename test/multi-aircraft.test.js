import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import { createF15Visual } from '../src/aircraft/f15-visual.js';
import { aircraftRegistry } from '../src/aircraft/registry.js';
import { CombatExercise, combatExercises } from '../src/sim/combat/exercise.js';
import { Radar } from '../src/sim/combat/radar.js';
import { Dogfight } from '../src/sim/dogfight.js';
import { Flight, STEP, neutralControls } from '../src/sim/flight.js';
import { range, scenarios } from '../src/sim/range.js';

const { spec: falcon } = aircraftRegistry.f16c;
const { spec: eagle } = aircraftRegistry.f15c;
const start = { ...scenarios.intercept, y: 6500 };
const noEffects = { shot: () => {}, impact: () => {}, burst: () => {} };
const manual = { ...neutralControls, assisted: false };
const simulate = (flight, count, controls = manual) => {
  for (let index = 0; index < count; index++) flight.step(controls);
};
const spawn = (spec) => {
  const flight = new Flight(spec, range);
  flight.reset(start);
  return flight;
};

test('aircraft profiles yield distinct acceleration, burn and roll response with the same controls', () => {
  const own16 = spawn(falcon);
  const own15 = spawn(eagle);
  assert.equal(own16.engines.states.length, 1);
  assert.equal(own15.engines.states.length, 2);
  own16.toggleAfterburner();
  own15.toggleAfterburner();
  simulate(own16, 600);
  simulate(own15, 600);
  assert.ok(own15.engines.states.every((engine) => engine.afterburner));
  assert.ok(own15.velocity.length() > own16.velocity.length() + 2);
  assert.ok(own15.thrust > own16.thrust * 1.5);
  assert.ok(eagle.fuelCapacity * 0.73 - own15.fuel > falcon.fuelCapacity * 0.73 - own16.fuel);
  simulate(own16, 30, { ...manual, roll: 1 });
  simulate(own15, 30, { ...manual, roll: 1 });
  assert.ok(own16.rates.z > own15.rates.z + 0.25);
});

test('either Eagle engine can fail independently and pulls the nose in opposite directions', () => {
  for (const [index, component] of ['leftEngine', 'rightEngine'].entries()) {
    const flight = spawn(eagle);
    const health = eagle.damageComponents[component].capacity;
    assert.equal(flight.damage.hit(component, health), false);
    flight.toggleAfterburner();
    simulate(flight, 180);
    assert.equal(flight.engines.states[index].thrust, 0);
    assert.ok(flight.engines.states[1 - index].thrust > 25000);
    assert.equal(flight.damage.condition(['rightEngine', 'leftEngine'][index]), 1);
    assert.ok((index === 0 ? flight.rates.y : -flight.rates.y) > 0.02);
    const other = eagle.engines[1 - index].component;
    flight.damage.hit(other, eagle.damageComponents[other].capacity);
    simulate(flight, 2);
    assert.equal(flight.thrust, 0);
    assert.equal(flight.afterburner, false);
    assert.equal(flight.failure, '');
  }
});

test('Eagle component volumes and independent controls affect the shared flight state', () => {
  const flight = spawn(eagle);
  assert.ok(flight.damage.health.leftFin === 1 && flight.damage.health.rightFin === 1);
  flight.damage.hit('leftFin', eagle.damageComponents.leftFin.capacity);
  flight.damage.hit('leftWing', eagle.damageComponents.leftWing.capacity * 0.6);
  flight.damage.hit('rightStabilator', eagle.damageComponents.rightStabilator.capacity);
  assert.ok(flight.damage.yawAuthority < 1);
  assert.ok(flight.damage.wingLeft < flight.damage.wingRight);
  assert.equal(flight.damage.surfaceAuthority.RightStabilator, 0);
  const runaway = spawn(eagle);
  runaway.reset(scenarios.runway);
  assert.equal(runaway.position.y, range.heightAt(runaway.position.x, runaway.position.z) + eagle.gearClearance);
  assert.equal(runaway.surfaces.angles.Flap, 35);
  simulate(runaway, 24, { ...manual, brakes: true });
  assert.ok(runaway.surfaces.angles.SpeedBrake > 10);
});

test('Eagle radar has a larger finite sector and mixed sides get their actual weapon racks', () => {
  const player = spawn(eagle);
  const dogfight = new Dogfight(player, falcon, range, noEffects);
  dogfight.reset('aggressive', start, combatExercises.intercept.opponent);
  const combat = new CombatExercise(dogfight, range, noEffects);
  combat.reset('intercept');
  assert.equal(combat.player.radar.range, 16000);
  assert.equal(combat.enemy.radar.range, 13600);
  assert.equal(combat.player.rack.count('radar'), 4);
  assert.equal(combat.enemy.rack.count('radar'), 2);
  assert.equal(dogfight.cannon.config.capacity, 510);
  const far = spawn(falcon);
  far.position.set(player.position.x, player.position.y, player.position.z + 14800);
  for (const spec of [falcon, eagle]) {
    const radar = new Radar(range, spawn(spec));
    radar.reset(true);
    radar.update(0, [far]);
    assert.equal(radar.contacts.has(far), spec === eagle);
  }
  combat.player.radar.togglePower();
  combat.step(STEP);
  combat.player.radar.selectNext();
  assert.ok(combat.player.radar.toggleLock());
  for (let i = 0; i < 64; i++) {
    player.step(neutralControls);
    dogfight.update(combat.adjust);
    combat.step(STEP);
  }
  const station = combat.player.rack.station('radar');
  assert.ok(combat.launch(combat.player, combat.enemy, 'radar'));
  const missile = combat.missiles.pool.find((item) => item.active);
  const point = new Vector3().fromArray(station.offset).applyQuaternion(player.orientation).add(player.position);
  assert.ok(missile.position.distanceTo(point) < 1e-9);
  assert.equal(missile.station, station.name);
  assert.equal(combat.player.rack.count('radar'), 3);
});

test('Eagle rig follows simulated commands and its visual racks match the specification', () => {
  const flight = spawn(eagle);
  const visual = createF15Visual();
  const node = (name) => visual.root.getObjectByName(name);
  assert.deepEqual(visual.muzzle.position.toArray(), eagle.cannon.muzzle);
  for (const { name, offset } of eagle.hardpoints) assert.deepEqual(node(name).position.toArray(), offset);
  flight.reset(scenarios.runway);
  simulate(flight, 65, { ...manual, brakes: true, yaw: 0.8 });
  visual.update(flight, 0);
  assert.ok(node('Left flap').rotation.x > 0.4);
  assert.ok(node('Speed brake').rotation.x > 0.3);
  assert.ok(node('Left main gear').visible && node('Right main gear').visible);
  flight.reset(start);
  flight.toggleAfterburner();
  flight.damage.hit('rightEngine', eagle.damageComponents.rightEngine.capacity);
  simulate(flight, 235, { ...manual, roll: 1 });
  visual.update(flight, 0);
  assert.ok(node('Left burner').visible && !node('Right burner').visible);
  assert.ok(!node('Nose gear').visible);
  assert.ok(node('Left aileron').rotation.x * node('Right aileron').rotation.x < 0);
});
