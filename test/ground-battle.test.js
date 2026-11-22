import assert from 'node:assert/strict';
import test from 'node:test';
import { PerspectiveCamera, Vector3 } from 'three';
import { f16 } from '../src/aircraft/f16.js';
import { Ballistics } from '../src/sim/ballistics.js';
import { Flight, STEP } from '../src/sim/flight.js';
import { GroundBattle } from '../src/sim/ground/battlefield.js';
import { GroundEngagement, groundDifficulty, groundLineOfSight } from '../src/sim/ground/engagement.js';
import { GroundObserver } from '../src/sim/ground/ground-observer.js';
import { RoadNetwork, traversable } from '../src/sim/ground/navigation.js';
import { GroundVehicle, groundVehicles } from '../src/sim/ground/vehicles.js';
import { applyGroundImpact, RangeOrdnance } from '../src/sim/range-ordnance.js';
import { range, scenarios } from '../src/sim/range.js';

const flat = { structures: [], surfaceAt: () => 10, heightAt: () => 10, maxTerrainHeight: 10 };
const distant = new Vector3(12000, 6000, -10000);
const centerStation = { offset: [0, 0, 0], release: [0, 0, 0], rotation: [0, 0, 0] };
const unitAt = (id, x, z, faction = 'friendly', type = 'tank') =>
  new GroundVehicle(flat, { id, type, faction, x, z, yaw: 0, route: [], objective: 'capture' }, groundVehicles[type], () => {});

function run(battle, seconds, each = () => {}, observer = distant) {
  for (let i = 0; i < Math.ceil(seconds / STEP) && !battle.outcome; i++) {
    battle.step(STEP, observer);
    each();
  }
}

function aircraftStore(battle) {
  const flight = new Flight(f16, range);
  flight.reset(scenarios.battlefield);
  const impacts = [];
  const ordnance = new RangeOrdnance(range, (kind, point, collider, profile) => {
    impacts.push({ kind, vehicle: collider?.vehicle });
    applyGroundImpact(kind, point, collider, profile, battle.targets);
  });
  return {
    ordnance, flight, impacts,
    drop(kind, vehicle, x = 0, height = 14) {
      flight.position.copy(vehicle.position).add(new Vector3(x, height, 0));
      flight.orientation.identity();
      flight.velocity.set(vehicle.drive.x, -27, vehicle.drive.z);
      assert.ok(ordnance.spawn(kind, flight, centerStation));
    },
    step() { ordnance.step(STEP, { flight }, battle.queryPlayer); },
  };
}

test('distant ground combat progresses with real gunfire, casualties and a mission outcome', () => {
  let muzzleEvents = 0;
  const battle = new GroundBattle(range, {
    shot(point, unit) {
      assert.ok(point.distanceTo(unit.muzzle) < .001);
      assert.ok(point.distanceTo(unit.position) > 1);
      muzzleEvents++;
    },
  });
  battle.reset('battlefield', 'regular', undefined, 87351);
  const start = battle.targets.map((unit) => unit.position.clone());
  run(battle, 145.1);
  assert.match(battle.outcome, /^(win|loss|draw)$/);
  assert.ok(battle.losses.friendly && battle.losses.opposing);
  assert.ok(muzzleEvents > 60);
  assert.ok(battle.targets.every((unit, index) => unit.position.distanceTo(start[index]) > 50));
  assert.ok(battle.targets.some((unit) => unit.turret.ammo < unit.spec.weapon?.ammo));
  assert.ok(battle.targets.every((unit) => unit.turret.ammo >= 0));
  assert.ok(battle.controls.friendly + battle.controls.opposing > 0);
});

test('a runway-scale obstacle changes the planned road and the convoy follows safe terrain', () => {
  const warehouse = { min: [-5, 0, 18], max: [5, 32, 47] };
  const terrain = { ...flat, structures: [warehouse] };
  const graph = new RoadNetwork(terrain, { a: [0, 0], b: [0, 65], c: [-28, 26] }, [['a', 'b'], ['a', 'c'], ['c', 'b']]);
  assert.deepEqual(graph.route('a', 'b'), ['a', 'c', 'b']);
  assert.equal(traversable(terrain, -2, 17, -2, 18, 2, .22), false);

  const battle = new GroundBattle(range);
  battle.reset('convoy');
  const lead = battle.targets[0];
  run(battle, 11);
  lead.hit('hull', 250, { kind: 'bomb', source: 'player', point: lead.position });
  assert.equal(lead.active, false);
  assert.ok(lead.wreckUntil > battle.time);
  assert.ok(lead.visibleUntil > lead.wreckUntil);
  let clearance = Infinity;
  let pathRecovered = false;
  run(battle, 155, () => {
    const column = battle.targets.filter((unit) => unit.active && !unit.arrived);
    for (const [i, unit] of column.entries()) {
      assert.ok(Math.abs(unit.position.y - range.heightAt(unit.position.x, unit.position.z)) < .3);
      assert.ok(Math.abs(unit.roll) < .35 && Math.abs(unit.pitch) < .35);
      pathRecovered ||= Boolean(unit.drive.detour);
      for (const other of column.slice(i + 1)) clearance = Math.min(clearance, unit.position.distanceTo(other.position));
    }
  });
  assert.ok(pathRecovered);
  assert.ok(clearance > 8);
  assert.equal(lead.colliders[0].active, false);
  assert.equal(battle.outcome, 'loss');
  assert.match(battle.reason, /reached the exit/);
});

test('ground sensors reject allies and neutrals and age out terrain-obscured contact memory', () => {
  let hill = false;
  const terrain = { ...flat, heightAt: (x, z) => hill && z > 130 && z < 170 ? 31 : 10 };
  const friendly = unitAt('one', 0, 0);
  const ally = unitAt('ally', 0, 65);
  const neutral = unitAt('observer', 3, 110, 'neutral');
  const hostile = unitAt('target', 40, 285, 'opposing');
  const ai = new GroundEngagement(terrain, [friendly, ally, neutral, hostile], { fire: () => false }, () => .5);
  ai.scan(friendly, 0, groundDifficulty.regular);
  assert.equal(friendly.track, hostile);
  ai.choose(friendly, 0);
  const heading = friendly.yaw;
  ai.aimWeapon(friendly, 0, 1 / 90, groundDifficulty.regular);
  assert.equal(friendly.yaw, heading);
  assert.ok(friendly.turret.yaw > 0 && friendly.turret.yaw < .015);
  assert.ok(friendly.readyAt > 0);
  const lastSeen = friendly.observed.clone();
  hill = true;
  hostile.position.x += 30;
  ai.scan(friendly, 1, groundDifficulty.regular);
  assert.equal(friendly.lineOfSight, false);
  assert.deepEqual(friendly.observed, lastSeen);
  assert.equal(groundLineOfSight(terrain, friendly.position, hostile.position), false);
  ai.scan(friendly, 4, groundDifficulty.regular);
  assert.equal(friendly.track, null);
});

test('armor faces and separate mobility and weapon components produce different outcomes', () => {
  const nose = unitAt('nose', 0, 0);
  const rear = unitAt('rear', 0, 0);
  nose.hit('hull', 11, { kind: 'vehicle', point: new Vector3(0, 11, 3) });
  rear.hit('hull', 11, { kind: 'vehicle', point: new Vector3(0, 11, -3) });
  assert.ok(nose.health.condition('hull') > rear.health.condition('hull'));
  const truck = unitAt('truck', 0, 0, 'friendly', 'truck');
  assert.equal(truck.canFight, false);
  assert.ok(truck.spec.speed > nose.spec.speed);
  rear.hit('runningGear', 44, { kind: 'rocket', point: new Vector3(2, 11, 0) });
  assert.ok(rear.disabled);
  assert.ok(rear.active && rear.canFight);
  rear.hit('turret', 44, { kind: 'rocket', point: new Vector3(2, 11, 0) });
  assert.equal(rear.canFight, false);
});

test('swept cannon and powered rockets hit moving vehicles and bomb splash includes allies', () => {
  const battle = new GroundBattle(range);
  battle.reset('battlefield');
  run(battle, 7);
  const target = battle.targets.find((unit) => unit.faction === 'opposing' && unit.type === 'truck');
  const before = target.position.clone();
  const stores = aircraftStore(battle);
  const cannon = new Ballistics(f16.cannon, range, (surface, point, collider) => {
    collider?.damageTarget?.hit(collider.component, f16.cannon.damage, { kind: 'cannon', source: 'player', point });
  });
  const impactPosition = target.colliders[1].position.clone();
  cannon.spawn(impactPosition.add(new Vector3(0, 14, 0)), new Vector3(target.drive.x, -990, target.drive.z), false, 0);
  run(battle, .07, () => cannon.step(STEP, battle.queryPlayer));
  assert.ok(target.position.distanceTo(before) > .3);
  assert.ok(target.health.condition('engine') < 1);

  const powered = battle.targets.find((unit) => unit.faction === 'opposing' && unit.type === 'apc');
  stores.flight.position.copy(powered.position).add(new Vector3(0, 4, -19));
  stores.flight.orientation.identity();
  stores.flight.velocity.set(0, -9, 0);
  assert.ok(stores.ordnance.spawn('rocket', stores.flight, centerStation));
  run(battle, .4, stores.step);
  assert.ok(stores.impacts.some((item) => item.kind === 'rocket' && item.vehicle === powered));
  assert.ok(powered.health.condition('hull') < 1);

  const allied = battle.targets[0];
  stores.drop('bomb', allied, 7);
  run(battle, .85, stores.step);
  assert.ok(battle.friendlyFire > 0);
  assert.ok(allied.health.condition('runningGear') < 1);
});

test('air support changes the same battle and convoy victory counts transports rather than escorts', () => {
  const battle = new GroundBattle(range);
  battle.reset('battlefield', 'regular', undefined, 87351);
  run(battle, 160);
  assert.equal(battle.outcome, 'loss');
  battle.reset('battlefield', 'regular', undefined, 87351);
  const stores = aircraftStore(battle);
  run(battle, 8);
  for (const unit of battle.targets.filter((unit) => unit.faction === 'opposing')) {
    stores.drop('bomb', unit);
    stores.drop('bomb', unit);
  }
  run(battle, 130, stores.step);
  assert.equal(battle.outcome, 'win');
  assert.ok(battle.playerDisabled.size >= 4);
  assert.match(battle.reason, /Friendly units secured/);

  battle.reset('convoy');
  const convoyStores = aircraftStore(battle);
  run(battle, 6);
  for (const transport of battle.transports) convoyStores.drop('bomb', transport);
  run(battle, 3, convoyStores.step);
  assert.equal(battle.outcome, 'win');
  assert.equal(battle.convoyStopped, 3);
  assert.ok(battle.targets.some((unit) => unit.objective === 'escort' && unit.active));
});

test('visual ground identification tracks only screened and unobstructed vehicles', () => {
  let hill = false;
  const terrain = { ...flat, heightAt: (x, z) => hill && z > 120 && z < 165 ? 60 : 10 };
  const observer = new GroundObserver(terrain);
  const camera = new PerspectiveCamera(50, 16 / 9, .1, 5000);
  camera.position.set(0, 50, 0);
  camera.lookAt(0, 10, 300);
  camera.updateMatrixWorld();
  const hostile = unitAt('seen', -12, 300, 'opposing');
  const allied = unitAt('friend', 12, 300);
  const behind = unitAt('hidden', 0, -300, 'opposing');
  observer.scan(0, camera.position, camera, [hostile, allied, behind]);
  assert.equal(observer.contacts.size, 2);
  assert.ok(!observer.contacts.has(behind.id));
  const first = observer.track;
  observer.cycle();
  assert.notEqual(observer.track, first);
  hill = true;
  const previous = observer.track.position.clone();
  hostile.position.x += 8;
  allied.position.x += 8;
  observer.scan(.3, camera.position, camera, [hostile, allied, behind]);
  assert.deepEqual(observer.track.position, previous);
  observer.scan(1, camera.position, camera, [hostile, allied, behind]);
  assert.equal(observer.track, undefined);
});
