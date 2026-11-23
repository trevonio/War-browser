import assert from 'node:assert/strict';
import test from 'node:test';
import { Quaternion, Vector3 } from 'three';
import { f15 } from '../src/aircraft/f15.js';
import { f16 } from '../src/aircraft/f16.js';
import { CasDirector } from '../src/sim/cas/director.js';
import { createCasScenario } from '../src/sim/cas/scenarios.js';
import { CombatExercise } from '../src/sim/combat/exercise.js';
import { WeaponRack } from '../src/sim/combat/weapons.js';
import { Dogfight } from '../src/sim/dogfight.js';
import { Flight, STEP, neutralControls } from '../src/sim/flight.js';
import { GroundBattle } from '../src/sim/ground/battlefield.js';
import { GroundVehicle, groundVehicles } from '../src/sim/ground/vehicles.js';
import { availablePresets, resolveLoadout } from '../src/sim/loadouts.js';
import { applyGroundImpact, RangeOrdnance } from '../src/sim/range-ordnance.js';
import { range, scenarios } from '../src/sim/range.js';
import { AirDefenses, airDefenseOperational } from '../src/sim/strike/defenses.js';
import { TargetingPod } from '../src/sim/strike/pod.js';
import { StrikeWing } from '../src/sim/strike/wing.js';
import { groundHeat } from '../src/view/battlefield-view.js';

const flat = { structures: [], heightAt: () => 3, surfaceAt: () => 3, maxTerrainHeight: 700 };
const mounted = resolveLoadout(f16, availablePresets(f16)['Precision Strike']);
const station = mounted.stations.find((item) => item.type === 'pod');
const makeTarget = (world, type = 'truck', z = 1100, x = 0) =>
  new GroundVehicle(world, { id: type, type, faction: 'opposing', x, z, yaw: 0, route: [] }, groundVehicles[type], () => {});
const detachedWorld = { ...range, ...flat };
function plane(world = detachedWorld) {
  const flight = new Flight(f16, world);
  flight.reset({ ...scenarios.air, x: 0, z: 0, y: 450, speed: 162, pitch: 0 });
  return flight;
}

test('precision presets use physical stores and remain exclusive to compatible hardpoints', () => {
  for (const key of ['Precision Strike', 'Armored Target Attack', 'Mixed CAS', 'Multirole Support']) {
    assert.equal(resolveLoadout(f16, availablePresets(f16)[key]).errors.length, 0);
  }
  assert.deepEqual(mounted.stations.map(({ type }) => type), ['laser', 'gps', 'optical', 'rocket', 'pod']);
  assert.ok(mounted.mass > 0 && mounted.drag > 0);
  assert.ok(resolveLoadout(f16, { 'outer-left': 'pod' }).errors.length);
  assert.ok(resolveLoadout(f16, { 'wingtip-left': 'optical' }).errors.length);
  assert.ok(resolveLoadout(f15, { center: 'pod' }).errors.length);
});

test('the pod stabilizes on ground, reacquires with a valid sighting, and stops tracking behind a ridge', () => {
  let ridge = false;
  const world = { ...detachedWorld, heightAt: (x, z) => ridge && z > 470 && z < 570 ? 610 : 3 };
  const flight = plane(world);
  const unit = makeTarget(world);
  const pod = new TargetingPod(world);
  assert.equal(pod.toggle(), false);
  pod.update(flight, station, [unit], 0);
  assert.equal(pod.toggle(), true);
  pod.slew(40, 20);
  assert.ok(pod.direction.x < 0 && pod.direction.y < -.28);
  pod.setArea(new Vector3(0, 5, 1100));
  pod.present(.8);
  assert.ok(pod.select([unit]));
  assert.equal(pod.state, 'POINT TRACK');
  assert.ok(pod.designate());
  assert.ok(pod.laser());
  const xBefore = pod.designation.position.x;
  unit.position.x += 55;
  flight.position.z += 90;
  flight.orientation.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), .48));
  pod.update(flight, station, [unit], .2);
  pod.present(.6);
  assert.ok(pod.lasing);
  assert.equal(pod.designation.position.x, xBefore + 55);
  assert.equal(pod.coordinates.x, xBefore);
  const direction = pod.area.clone().sub(pod.origin).normalize();
  assert.ok(pod.direction.angleTo(direction) < .02);
  ridge = true;
  unit.position.x += 20;
  pod.update(flight, station, [unit], .4);
  assert.equal(pod.state, 'TRACK LOST');
  assert.equal(pod.lasing, false);
  assert.equal(pod.designation.valid, false);
  assert.equal(pod.designation.position.x, xBefore + 55);
  pod.update(flight, null, [unit], .5);
  assert.equal(pod.active, false);
  assert.equal(pod.hasCoordinates, false);
});

function launch(type, move, cutLaser) {
  const flight = plane();
  const target = makeTarget(detachedWorld);
  const pod = new TargetingPod(detachedWorld);
  const rack = new WeaponRack(flight, { track: null }, detachedWorld);
  rack.reset(mounted, type);
  pod.update(flight, rack.station('pod'), [target], 0);
  pod.toggle();
  pod.setArea(new Vector3(0, 5, 1100));
  pod.present(1);
  if (type !== 'gps') assert.ok(pod.select([target]));
  assert.ok(pod.designate());
  if (type === 'laser') {
    assert.ok(pod.laser());
    pod.update(flight, rack.station('pod'), [target], 0);
  }
  const impacts = [];
  const ordnance = new RangeOrdnance(detachedWorld, (kind, point, part, profile) => {
    impacts.push(point.clone());
    applyGroundImpact(kind, point, part, profile, [target]);
  });
  assert.equal(ordnance.releaseGuided(rack, type, pod), 'PRECISION STORE AWAY');
  assert.equal(rack.count(type), 0);
  const round = ordnance.rounds.find(({ active }) => active);
  assert.ok(round.position.distanceTo(flight.position) < 10);
  assert.equal(impacts.length, 0);
  let lost = false;
  for (let tick = 1; tick < 24 / STEP && ordnance.active; tick++) {
    flight.elapsed = tick * STEP;
    if (cutLaser && tick === 21) pod.clearTrack();
    target.position.x += move * STEP;
    target.syncPose();
    pod.update(flight, rack.station('pod'), [target], flight.elapsed);
    ordnance.step(STEP, rack, target.colliders);
    lost ||= !round.validGuide;
  }
  assert.equal(impacts.length, 1);
  return { target, impact: impacts[0], lost, fix: round.designation.clone() };
}

test('guided stores travel, consume one round, distinguish live tracking from a fixed coordinate, and can miss', () => {
  const radarFree = launch('gps', 14, false);
  assert.ok(radarFree.target.active);
  assert.equal(radarFree.fix.x, 0);
  const guided = launch('laser', 7, false);
  assert.equal(guided.target.active, false);
  assert.ok(guided.impact.x > 15);
  assert.equal(guided.lost, false);
  const faded = launch('laser', 12, true);
  assert.ok(faded.target.active && faded.lost);
  const seeker = launch('optical', 11, false);
  assert.equal(seeker.target.active, false);
  assert.ok(seeker.impact.x > 10);
});

function defenseSetup(kind, distance) {
  const world = detachedWorld;
  const flight = plane(world);
  flight.position.set(0, 440, distance);
  flight.previousPosition.copy(flight.position);
  flight.velocity.set(0, 0, 0);
  const fight = new Dogfight(flight, f16, world, { impact() {}, shot() {} });
  const combat = new CombatExercise(fight, world, { burst() {} });
  const unit = makeTarget(world, kind, 0);
  const defenses = new AirDefenses(world, { shot() {}, impact() {} });
  const battle = { time: 0, random: () => .5 };
  defenses.reset(combat, [unit], 'regular');
  const step = () => { flight.elapsed += STEP; battle.time += STEP; defenses.step(STEP, battle); };
  return { flight, defenses, combat, unit, step };
}

test('optical gunfire travels into aircraft colliders and only radar threats feed the RWR', () => {
  const optical = defenseSetup('aaa', 850);
  for (let tick = 0; tick < 6 / STEP; tick++) optical.step();
  assert.ok(optical.defenses.gunShots > 0);
  assert.ok(Object.values(optical.flight.damage.health).some((value) => value < 1));
  assert.equal(optical.combat.player.warning.state, '');
  const before = optical.defenses.gunShots;
  optical.unit.hit('weapon', 140, { kind: 'rocket' });
  assert.equal(airDefenseOperational(optical.unit), false);
  for (let tick = 0; tick < 2 / STEP; tick++) optical.step();
  assert.equal(optical.defenses.gunShots, before);

  const radar = defenseSetup('sam', 1900);
  const warnings = new Set();
  let missilePosition;
  for (let tick = 0; tick < 4 / STEP; tick++) {
    radar.step();
    warnings.add(radar.combat.player.warning.state);
    const missile = radar.combat.missiles.pool.find((item) => item.active);
    if (missile) missilePosition = missile.position.clone();
  }
  assert.ok(warnings.has('SEARCH') && warnings.has('TRACK') && warnings.has('ACTIVE SEEKER'));
  assert.ok(missilePosition.y > 30);
  const missile = radar.combat.missiles.pool.find((item) => item.active);
  radar.combat.decoys.release(radar.flight, 'flare');
  radar.combat.missiles.sample(missile);
  assert.equal(missile.decoyed, false);
  assert.ok(radar.combat.decoys.release(radar.flight, 'chaff'));
  radar.combat.missiles.sample(missile);
  assert.equal(missile.decoyed, true);
  radar.unit.hit('hull', 500, { kind: 'bomb' });
  const launches = radar.defenses.launches;
  radar.combat.missiles.clear();
  for (let tick = 0; tick < 1 / STEP; tick++) radar.step();
  assert.equal(radar.defenses.launches, launches);
  assert.equal(radar.combat.player.warning.state, '');
});

test('strike and suppression missions evaluate actual damage and seeded battles can include mobile AAA', () => {
  for (const key of ['precision', 'corridor']) {
    const battle = new GroundBattle(range);
    for (const seed of [0, 582, 1472, 210189]) {
      const { start } = createCasScenario(key, seed, 'regular', battle.roads);
      const aircraft = new Flight(f16, range);
      aircraft.reset(start);
      for (let tick = 0; tick < 4 / STEP; tick++) aircraft.step(neutralControls);
      assert.equal(aircraft.failure, '', `${key} approach for seed ${seed}`);
    }
    const plan = createCasScenario(key, 582, 'regular', battle.roads);
    const director = new CasDirector(plan);
    battle.reset('cas', 'regular', undefined, plan.seed, director);
    battle.step(STEP);
    assert.equal(battle.outcome, '');
    for (const unit of battle.targets.filter((item) => plan.targets.includes(item.id))) {
      unit.hit('hull', 500, { kind: 'bomb', source: 'player' });
    }
    for (let tick = 0; tick < 50; tick++) battle.step(STEP);
    assert.equal(battle.outcome, 'win');
    assert.equal(director.primary.state, 'completed');
  }
  const battle = new GroundBattle(range);
  const plan = createCasScenario('breakthrough', 413, 'regular', battle.roads);
  assert.ok(plan.strikeWing);
  assert.ok(plan.definitions.some((unit) => unit.type === 'aaa' && unit.route.length));
  const director = new CasDirector(plan);
  battle.reset('cas', 'regular', undefined, plan.seed, director);
  const flight = plane(range);
  const fight = new Dogfight(flight, f16, range, { impact() {}, shot() {} });
  const combat = new CombatExercise(fight, range, { burst() {} });
  const wing = new StrikeWing(f16, range, battle, { launch() {}, impact() {} });
  wing.reset();
  const defenses = new AirDefenses(range, { shot() {}, impact() {} });
  defenses.reset(combat, battle.targets, 'regular', wing);
  const spawn = wing.flight.position.clone();
  for (let tick = 0; tick < 14 / STEP; tick++) {
    flight.step(neutralControls);
    battle.step(STEP, flight.position);
    wing.step(STEP, defenses);
    defenses.step(STEP, battle);
  }
  assert.ok(wing.flight.position.distanceTo(spawn) > 1200);
  assert.ok(wing.stores.precisionReleased > 0);
  assert.equal(battle.friendlyFire, 0);
});

test('thermal signatures respond to engine condition, motion and cooling wrecks', () => {
  const target = makeTarget(detachedWorld);
  const parked = groundHeat(target, 1);
  target.speed = 20;
  assert.ok(groundHeat(target, 1) > parked);
  target.active = false;
  target.visibleUntil = 48;
  assert.ok(groundHeat(target, 6) > groundHeat(target, 40));
});
