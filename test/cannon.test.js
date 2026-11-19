import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Euler, Quaternion, Vector3 } from 'three';
import { f16 } from '../src/aircraft/f16.js';
import { Ballistics } from '../src/sim/ballistics.js';
import { Cannon } from '../src/sim/cannon.js';
import { Flight, STEP, neutralControls } from '../src/sim/flight.js';
import { PracticeRange } from '../src/sim/practice.js';
import { range, scenarios } from '../src/sim/range.js';

const config = f16.cannon;
const mount = { position: new Vector3(...config.muzzle), quaternion: new Quaternion() };
const ocean = { surfaceAt: () => -10, maxTerrainHeight: 0 };

function createCannon(world = ocean, onImpact = () => {}, onShot = () => {}) {
  const ballistics = new Ballistics(config, world, onImpact);
  const cannon = new Cannon(config, mount, ballistics, onShot);
  const flight = new Flight(f16, range);
  flight.reset(scenarios.air);
  return { cannon, flight, ballistics };
}

test('fixed steps deliver 100 rounds per second at 30, 60 and 144 display FPS', () => {
  for (const fps of [30, 60, 144]) {
    const { cannon, flight, ballistics } = createCannon();
    let accumulator = 0;
    for (let frame = 0; frame < fps; frame++) {
      accumulator += 1 / fps;
      while (accumulator + 1e-10 >= STEP) {
        flight.step(neutralControls);
        cannon.step(STEP, true, flight);
        ballistics.step(STEP, []);
        accumulator -= STEP;
      }
    }
    assert.equal(cannon.fired, 100);
    assert.equal(cannon.ammo, 410);
    assert.equal(ballistics.rounds.slice(0, ballistics.count).filter((round) => round.tracer).length, 20);
  }
});

test('release stops the cannon, quick bursts keep the cadence, and rearming requires reset', () => {
  const rounds = [];
  const { cannon, flight, ballistics } = createCannon(ocean, undefined,
    (_position, _direction, time) => rounds.push(time));
  function step(held) {
    flight.elapsed += STEP;
    cannon.step(STEP, held, flight);
    ballistics.step(STEP, []);
  }
  for (let i = 0; i < 30; i++) step(i % 2 === 0);
  assert.equal(cannon.fired, 15);
  for (let i = 1; i < rounds.length; i++) assert.ok(rounds[i] - rounds[i - 1] >= 0.01 - 1e-9);
  for (let i = 0; i < 120; i++) step(false);
  assert.equal(cannon.fired, 15);
  for (let i = 0; i < 900; i++) step(true);
  assert.equal(cannon.fired, 510);
  assert.equal(cannon.ammo, 0);
  cannon.reset();
  assert.equal(cannon.ammo, 510);
});

test('port muzzle and velocity transform with bank, inverted flight, climb and descent', () => {
  for (const [pitch, bank] of [[0, 1.3], [0, Math.PI], [-0.95, 0.2], [0.85, -0.2]]) {
    const { cannon, flight, ballistics } = createCannon();
    flight.orientation.setFromEuler(new Euler(pitch, -0.5, bank, 'YXZ'));
    flight.previousOrientation.copy(flight.orientation);
    flight.previousVelocity.set(23, -40, 190);
    flight.velocity.copy(flight.previousVelocity);
    flight.position.set(300, 2100, -770);
    flight.previousPosition.copy(flight.position);
    cannon.step(STEP, true, flight);
    const round = ballistics.rounds[0];
    const expectedPosition = mount.position.clone().applyQuaternion(flight.orientation).add(flight.position);
    const expectedVelocity = new Vector3(0, 0, config.projectileSpeed).applyQuaternion(flight.orientation).add(flight.velocity);
    assert.ok(mount.position.x > 0 && mount.position.z > 0);
    assert.ok(round.position.distanceTo(expectedPosition) < 1e-9);
    assert.ok(round.velocity.distanceTo(expectedVelocity) < 1e-9);
  }
});

test('a projectile travels over time, loses speed, falls, and expires from its pool', () => {
  const impacts = [];
  const pool = new Ballistics(config, ocean, (kind) => impacts.push(kind));
  pool.spawn(new Vector3(0, 600, 0), new Vector3(0, 0, 900), false, 0);
  for (let i = 0; i < 120; i++) pool.step(STEP, []);
  const { position, velocity, travel } = pool.rounds[0];
  assert.ok(position.z > 750 && position.z < 900 && position.y < 596);
  assert.ok(velocity.z < 900 && velocity.y < -8);
  assert.ok(travel > 750 && travel < 900);
  for (let i = 0; i < 300; i++) pool.step(STEP, []);
  assert.equal(pool.count, 0);
  assert.deepEqual(impacts, []);
});

test('sweeps find moving targets between ticks and choose the earliest collision', () => {
  const impacts = [];
  const pool = new Ballistics(config, ocean, (kind, at, collider) => impacts.push([kind, at.z, collider]));
  const moving = {
    shape: 'sphere', surface: 'metal', radius: 0.3,
    previous: new Vector3(-2, 100, 5), position: new Vector3(2, 100, 5),
  };
  const box = { shape: 'box', surface: 'ground', min: [-2, 98, 8], max: [2, 102, 12] };
  pool.spawn(new Vector3(0, 100, 0), new Vector3(0, 0, 1200), false, 0);
  pool.step(STEP, [box, moving]);
  assert.equal(pool.count, 0);
  assert.equal(impacts[0][2], moving);
  assert.ok(impacts[0][1] > 4 && impacts[0][1] < 5);
});

test('terrain, water and hangars stop projectiles with the appropriate impact type', () => {
  const impacts = [];
  const world = { surfaceAt: (x) => x > 0 ? 15 : -5, maxTerrainHeight: 15 };
  const pool = new Ballistics(config, world, (kind, position) => impacts.push([kind, position.y]));
  pool.spawn(new Vector3(-10, 5, 0), new Vector3(0, -850, 0), false, 0);
  pool.spawn(new Vector3(10, 20, 0), new Vector3(0, -850, 0), false, 0);
  pool.step(STEP, []);
  assert.equal(impacts[0][0], 'water');
  assert.ok(Math.abs(impacts[0][1]) < 0.15);
  assert.equal(impacts[1][0], 'ground');
  assert.ok(Math.abs(impacts[1][1] - 15) < 0.15);

  const hangar = range.structures[0];
  const solid = { ...world, surfaceAt: () => -5 };
  const hangarPool = new Ballistics(config, solid, (_kind, position, collider) => {
    assert.equal(collider, hangar);
    assert.ok(Math.abs(position.z - hangar.min[2]) < 1e-9);
  });
  hangarPool.spawn(new Vector3(351, 28, hangar.min[2] - 5), new Vector3(0, 0, 1000), false, 0);
  hangarPool.step(STEP, [hangar]);
  assert.equal(hangarPool.count, 0);
});

test('stationary practice drone is hittable from the air start and reset restores the range', () => {
  const practice = new PracticeRange();
  practice.reset(true);
  let impacts = 0;
  const { cannon, flight, ballistics } = createCannon(range, (_kind, _at, target) => {
    if (!target) return;
    impacts++;
    practice.hit(target, 1, flight.elapsed);
  });
  const crossingStart = practice.targets[1].position.clone();
  for (let i = 0; i < 230; i++) {
    flight.step(neutralControls);
    practice.step(flight.elapsed);
    cannon.step(STEP, i < 150, flight);
    ballistics.step(STEP, practice.targets);
  }
  assert.ok(impacts >= 7);
  assert.equal(practice.targets[0].active, false);
  assert.ok(practice.remaining < 3);
  assert.ok(practice.targets[1].position.distanceTo(crossingStart) > 10);
  practice.reset(true);
  assert.equal(practice.remaining, 3);
  assert.ok(practice.targets.every((target) => target.active && target.health === target.durability));
});

test('a press and release between renders fires only within that input window', () => {
  const timestamps = [];
  const { cannon, flight } = createCannon(ocean, undefined, (_point, _dir, time) => timestamps.push(time));
  flight.elapsed = STEP;
  cannon.step(STEP, [0.004, 0.007], flight);
  assert.deepEqual(timestamps, [0.004]);
  assert.equal(cannon.ammo, 509);
  flight.elapsed += STEP;
  cannon.step(STEP, [], flight);
  assert.equal(cannon.ammo, 509);
});
