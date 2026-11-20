import assert from 'node:assert/strict';
import test from 'node:test';
import { Euler, Quaternion, Vector3 } from 'three';
import { f16 } from '../src/aircraft/f16.js';
import { Ballistics } from '../src/sim/ballistics.js';
import { cannonMount, worldMuzzle } from '../src/sim/cannon.js';
import { STEP } from '../src/sim/flight.js';
import { GunComputer, VisualTrack } from '../src/sim/gun-computer.js';

const flatRange = { structures: [], maxTerrainHeight: 24, surfaceAt: () => 24 };
const mount = cannonMount(f16.cannon);
const muzzle = f16.cannon;
const computer = new GunComputer(muzzle, mount, flatRange);

function launchState(pitch, bank = 0, speed = 190) {
  return {
    position: new Vector3(0, 310, 0),
    velocity: new Vector3(0, -65, speed),
    orientation: new Quaternion().setFromEuler(new Euler(pitch, 0.16, bank, 'YXZ')),
  };
}

test('CCIP and actual projectiles hit the same surface during banked, inverted and steep dives', () => {
  for (const [pitch, bank] of [[0.33, 0], [0.65, 0.8], [0.35, Math.PI], [1.12, -0.8]]) {
    const flight = launchState(pitch, bank);
    const origin = new Vector3();
    const bore = new Vector3();
    worldMuzzle(mount, flight.orientation, flight.position, origin, bore);
    let impact;
    const pool = new Ballistics(muzzle, flatRange, (_type, point) => { impact = point.clone(); });
    pool.spawn(origin, bore.multiplyScalar(muzzle.projectileSpeed).add(flight.velocity), false, 0);
    while (pool.count) pool.step(STEP, flatRange.structures);
    assert.ok(computer.impact(flight));
    assert.ok(computer.point.distanceTo(impact) < 1e-7);
    assert.ok(computer.time > 0 && computer.range > 200);
  }
});

test('CCIP shifts with inherited speed and projectile drop and clears in an upward pass', () => {
  const flight = launchState(0.32);
  assert.ok(computer.impact(flight));
  const { z } = computer.point;
  flight.velocity.z += 125;
  assert.ok(computer.impact(flight));
  assert.ok(computer.point.z > z + 50);
  assert.ok(computer.point.y <= 24);

  const origin = new Vector3();
  const line = new Vector3();
  worldMuzzle(mount, flight.orientation, flight.position, origin, line);
  line.multiplyScalar(muzzle.projectileSpeed).add(flight.velocity);
  const geometricImpact = origin.z + line.z * (origin.y - 24) / -line.y;
  assert.ok(computer.point.z < geometricImpact - 3);

  flight.orientation.setFromEuler(new Euler(-0.45, 0, 0));
  flight.velocity.y = 90;
  assert.equal(computer.impact(flight), false);
  assert.equal(computer.valid, false);
});

test('lead finds a moving training target with the actual swept projectiles', () => {
  const flight = launchState(0, 0);
  flight.position.y = 1500;
  flight.velocity.set(2, 0, 190);
  flight.orientation.identity();
  const center = new Vector3(6, 1500, 620);
  const track = { position: center, velocity: new Vector3(115, 15, 80) };
  assert.ok(computer.lead(flight, track));
  assert.ok(computer.point.x > center.x + 65);
  const target = { shape: 'sphere', surface: 'metal', previous: center.clone(), position: center.clone(), radius: 2.2 };
  let struck;
  const pool = new Ballistics(muzzle, flatRange, (_kind, _point, collider) => { struck = collider; });
  const initial = computer.point.clone().sub(computer.origin).normalize().multiplyScalar(muzzle.projectileSpeed).add(flight.velocity);
  pool.spawn(computer.origin, initial, false, 0);
  while (pool.count) {
    target.previous.copy(target.position);
    target.position.addScaledVector(track.velocity, STEP);
    pool.step(STEP, [target]);
  }
  assert.equal(struck, target);
  assert.equal(computer.lead(flight, null), false);
  assert.equal(computer.lead(flight, { position: new Vector3(0, 1500, -500), velocity: track.velocity }), false);
});

test('visual lead estimates motion from repeated angular measurements and expires on loss', () => {
  const track = new VisualTrack();
  const bearing = new Vector3(0, 0, 1);
  const own = new Vector3();
  const span = 10;
  assert.equal(track.observe(0, own, bearing, span / 1400, span), null);
  assert.equal(track.observe(0.2, own, bearing, span / 1440, span), null);
  assert.equal(track.observe(0.4, own, bearing, span / 1480, span), track);
  assert.ok(Math.abs(track.velocity.z - 100) < 1e-8);
  assert.equal(track.observe(1, own, bearing, span / 1440, span), null);
});
