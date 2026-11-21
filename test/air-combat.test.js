import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Vector3 } from 'three';
import { f16 } from '../src/aircraft/f16.js';
import { Countermeasures } from '../src/sim/combat/countermeasures.js';
import { CombatExercise, combatExercises } from '../src/sim/combat/exercise.js';
import { Radar } from '../src/sim/combat/radar.js';
import { ThreatReceiver } from '../src/sim/combat/warnings.js';
import { Dogfight } from '../src/sim/dogfight.js';
import { Flight, STEP, neutralControls } from '../src/sim/flight.js';
import { range, scenarios } from '../src/sim/range.js';

function arena(mode = 'intercept', difficulty = 'regular') {
  const player = new Flight(f16, range);
  const dogfight = new Dogfight(player, f16, range, { shot() {}, impact() {} });
  const events = [];
  const combat = new CombatExercise(dogfight, range, {
    launch(own) { events.push({ time: player.elapsed, own, type: 'launch' }); },
    burst(_point, hit, own) { events.push({ time: player.elapsed, hit, own, type: 'burst' }); },
  });
  const reset = () => {
    player.reset(scenarios[mode]);
    dogfight.reset('aggressive', scenarios[mode], combatExercises[mode].opponent);
    combat.reset(mode, difficulty);
  };
  reset();
  function ticks(seconds, update = () => {}) {
    for (let tick = 0; tick < seconds / STEP && !dogfight.result; tick++) {
      player.step(neutralControls);
      dogfight.update(combat.adjust);
      combat.step(STEP);
      update();
      dogfight.fire(combat.enemyCannon);
      dogfight.finish();
    }
  }
  return { player, target: dogfight.opponent, dogfight, combat, events, ticks, reset };
}

function lock(radar, target, time = 0) {
  radar.togglePower();
  radar.update(time, [target]);
  radar.selectNext();
  assert.ok(radar.toggleLock());
}

test('radar scans a bounded sector, caches returns, and tracks one selected contact', () => {
  const { player, target } = arena();
  const radar = new Radar(range, player);
  const side = new Flight(f16, range);
  side.reset({ ...scenarios.intercept, x: player.position.x - 1400, z: player.position.z + 2900 });
  const behind = new Flight(f16, range);
  behind.reset({ ...scenarios.intercept, z: player.position.z - 1000 });
  radar.togglePower();
  radar.update(0, [target, side, behind]);
  assert.equal(radar.mode, 'SEARCH');
  assert.deepEqual([...radar.contacts.keys()], [target, side]);
  const seen = radar.contacts.get(side).position.clone();
  side.position.z += 100;
  radar.update(0.2, [target, side, behind]);
  assert.ok(radar.contacts.get(side).position.equals(seen));
  radar.cycleMode();
  radar.update(0.3, [target, side, behind]);
  assert.equal(radar.mode, 'TWS');
  assert.ok(!radar.contacts.get(side).position.equals(seen));
  radar.selectNext();
  radar.selectNext();
  assert.equal(radar.selected, side);
  assert.equal(radar.toggleLock(), true);
  assert.equal(radar.mode, 'STT');
  radar.update(0.4, [target, side, behind]);
  assert.deepEqual([...radar.emissions.keys()], [side]);
  assert.equal(radar.track.target, side);
  assert.equal(radar.emissions.get(side), 'TRACK');
  side.position.copy(behind.position);
  radar.update(1.0, [target, side, behind]);
  assert.equal(radar.track, undefined);
  assert.equal(radar.mode, 'TWS');
  radar.cycleRange();
  radar.update(1.1, [target, side, behind]);
  assert.equal(radar.contacts.size, 0);
});

test('low background returns and chaff can reduce contact quality', () => {
  const own = new Flight(f16, range);
  own.reset({ ...scenarios.intercept, y: 2550 });
  const target = new Flight(f16, range);
  target.reset({ ...scenarios.intercept, y: 2200, z: own.position.z + 7700 });
  const radar = new Radar(range, own);
  const decoys = new Countermeasures();
  radar.togglePower();
  radar.update(0, [target], decoys);
  assert.equal(radar.emissions.get(target), 'SEARCH');
  assert.equal(radar.contacts.size, 0);
  target.velocity.z *= -1;
  radar.update(0.6, [target], decoys);
  assert.equal(radar.contacts.size, 1);
  assert.ok(decoys.release(target, 'chaff'));
  assert.ok(decoys.interference(target) > 0.3);
  radar.update(1.4, [target], decoys);
  radar.update(2.1, [target], decoys);
  assert.equal(radar.contacts.size, 0);
});

test('RWR reports sampled radar sources and expires after power down', () => {
  const { player, combat } = arena();
  const receiver = new ThreatReceiver(player);
  combat.enemy.radar.update(0, [player]);
  receiver.update(0, [combat.enemy.radar], []);
  assert.equal(receiver.state, 'SEARCH');
  combat.enemy.radar.selectNext();
  combat.enemy.radar.toggleLock();
  combat.enemy.radar.update(0.2, [player]);
  receiver.update(0.2, [combat.enemy.radar], []);
  assert.equal(receiver.state, 'TRACK');
  combat.enemy.radar.togglePower();
  receiver.update(0.75, [combat.enemy.radar], []);
  assert.equal(receiver.state, '');
});

test('IR launch clears only after acquisition, spends its actual hardpoint, then can miss', () => {
  const { combat, player, target, events, ticks } = arena('short', 'rookie');
  const rack = combat.player.rack;
  assert.equal(combat.launch(combat.player, combat.enemy), false);
  assert.equal(rack.count('infrared'), 2);
  ticks(0.60);
  assert.equal(rack.launchState('infrared', player.elapsed), 'CLEARED');
  const slot = rack.station('infrared');
  const origin = new Vector3().fromArray(slot.offset).applyQuaternion(player.orientation).add(player.position);
  assert.ok(combat.launch(combat.player, combat.enemy));
  const m = combat.missiles.pool.find((item) => item.active);
  assert.equal(m.station, slot.name);
  assert.ok(m.position.equals(origin));
  assert.equal(slot.used, true);
  assert.equal(rack.count('infrared'), 1);
  const startingSpeed = m.speed;
  combat.missiles.step(0.05);
  assert.ok(m.speed > startingSpeed);
  assert.ok(m.position.distanceTo(origin) > 1);
  target.position.x += 5500;
  target.previousPosition.copy(target.position);
  for (let tick = 0; tick < 11 / STEP; tick++) combat.missiles.step(STEP);
  assert.equal(m.active, false);
  assert.equal(combat.player.warning.state, '');
  assert.equal(target.damage.active, false);
  assert.equal(events.filter((event) => event.type === 'burst' && event.hit).length, 0);
});

test('only matching countermeasures can distract a seeker and they expire', () => {
  const { combat, target, ticks } = arena('short', 'rookie');
  ticks(0.6);
  assert.ok(combat.launch(combat.player, combat.enemy));
  const missile = combat.missiles.pool.find((item) => item.active);
  const originalFlares = combat.enemy.rack.flare;
  assert.ok(combat.enemy.rack.deploy('chaff', target.elapsed, combat.decoys));
  combat.missiles.sample(missile);
  assert.equal(missile.decoyed, false);
  assert.ok(combat.enemy.rack.deploy('flare', target.elapsed, combat.decoys));
  assert.equal(combat.enemy.rack.flare, originalFlares - 1);
  assert.equal(combat.enemy.rack.deploy('flare', target.elapsed, combat.decoys), false);
  combat.missiles.sample(missile);
  assert.equal(missile.decoyed, true);
  target.afterburner = true;
  combat.missiles.sample(missile);
  assert.equal(missile.decoyed, false);
  for (let tick = 0; tick < 5.3 / STEP; tick++) combat.decoys.step(STEP, range);
  assert.equal(combat.decoys.pool.some((item) => item.active), false);
});

test('radar missile coasts on its last observation after support drops', () => {
  const { combat, player, target, ticks } = arena();
  lock(combat.player.radar, target);
  ticks(0.6);
  assert.ok(combat.launch(combat.player, combat.enemy));
  const missile = combat.missiles.pool.find((item) => item.active);
  assert.equal(missile.phase, 'MIDCOURSE');
  assert.equal(missile.emitting, false);
  const originalEstimate = missile.estimate.x;
  combat.player.radar.togglePower();
  target.position.x += 1200;
  for (let tick = 0; tick < 0.8 / STEP; tick++) combat.missiles.step(STEP);
  assert.ok(Math.abs(missile.estimate.x - originalEstimate) < 100);
  assert.ok(missile.age > missile.trackUntil);
  assert.equal(missile.phase, 'MIDCOURSE');
  assert.equal(combat.launch(combat.player, combat.enemy), false);
});

test('active radar seeker can be distracted by nearby chaff and ignores flares', () => {
  const { combat, target, ticks } = arena();
  lock(combat.player.radar, target);
  ticks(0.6);
  assert.ok(combat.launch(combat.player, combat.enemy));
  const missile = combat.missiles.pool.find((item) => item.active);
  missile.phase = 'ACTIVE';
  missile.position.copy(target.position).addScaledVector(missile.direction, -960);
  assert.ok(combat.enemy.rack.deploy('flare', target.elapsed, combat.decoys));
  combat.missiles.sample(missile);
  assert.equal(missile.emitting, true);
  assert.equal(missile.decoyed, false);
  assert.ok(combat.enemy.rack.deploy('chaff', target.elapsed, combat.decoys));
  combat.missiles.sample(missile);
  assert.equal(missile.decoyed, true);
});

test('BVR exercise reaches terminal guidance, warns, damages components, and uses finite AI stores', () => {
  const { combat, player, target, events, ticks, reset } = arena();
  lock(combat.player.radar, target);
  let fired = false;
  let terminal = false;
  let sensed = false;
  let decoyed = false;
  ticks(15, () => {
    if (!fired && combat.player.rack.seeker.radar.ready) fired = combat.launch(combat.player, combat.enemy);
    terminal ||= combat.missiles.pool.some((missile) => missile.active && missile.owner === player && missile.phase === 'ACTIVE');
    sensed ||= combat.player.warning.state === 'ACTIVE SEEKER';
    decoyed ||= combat.enemy.rack.chaff < 8;
  });
  assert.ok(fired && terminal && sensed && decoyed);
  assert.ok(events.some((event) => event.type === 'launch' && event.own === false));
  assert.ok(events.some((event) => event.type === 'burst' && event.hit));
  assert.ok(Object.values(player.damage.health).some((health) => health < 1));
  assert.ok(Object.values(target.damage.health).some((health) => health < 1));
  assert.ok(combat.enemy.rack.count('radar') < 2);
  assert.equal(combat.enemy.rack.selected, 'cannon');
  reset();
  assert.equal(combat.player.rack.count('radar'), 2);
  assert.equal(combat.player.warning.state, '');
  assert.equal(combat.missiles.pool.some((missile) => missile.active), false);
});
