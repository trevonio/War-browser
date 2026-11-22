import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import { f15 } from '../src/aircraft/f15.js';
import { f16 } from '../src/aircraft/f16.js';
import { Ballistics } from '../src/sim/ballistics.js';
import { WeaponRack } from '../src/sim/combat/weapons.js';
import { ComponentHealth } from '../src/sim/component-health.js';
import { Flight, neutralControls, STEP } from '../src/sim/flight.js';
import { range, scenarios } from '../src/sim/range.js';

function aircraft(spec) {
  const flight = new Flight(spec, range);
  flight.reset(scenarios.air);
  return flight;
}

test('ground-domain inventory stays off the F-15C and outside the current firing path', () => {
  const station = { type: 'test-store', domain: 'ground', wing: 'leftWing', payload: { mass: 300, drag: 0.012 } };
  for (const [spec, total] of [[f16, 300], [f15, 0]]) {
    const flight = aircraft(spec);
    const rack = new WeaponRack(flight, {}, range);
    const baseMass = flight.mass;
    rack.reset({ stations: [station] }, station.type);
    assert.equal(flight.mass, baseMass + total);
    assert.equal(flight.payloadDrag, spec === f16 ? 0.012 : 0);
    assert.equal(rack.selected, 'cannon');
    assert.equal(rack.fire(station.type, 0, null, null), false);
    flight.stores = false;
    assert.equal(flight.mass, baseMass - spec.storesMass + total);
    flight.damage.wear('leftWing', spec.damageComponents.leftWing.capacity);
    rack.update(0, []);
    assert.equal(flight.payloadMass, 0);
    assert.equal(flight.payloadDrag, 0);
  }
});

test('the solver applies payload drag and a successful release clears its contribution', () => {
  const clean = aircraft(f16);
  const loaded = aircraft(f16);
  const rack = new WeaponRack(loaded, {}, range);
  const station = { ...f16.hardpoints[0], payload: { mass: 0, drag: 0.03 } };
  rack.reset({ stations: [station] }, station.type);
  clean.step(neutralControls, STEP);
  loaded.step(neutralControls, STEP);
  assert.ok(loaded.velocity.length() < clean.velocity.length());
  Object.assign(rack.seeker[station.type], { target: {}, range: 800, ready: true });
  assert.equal(rack.fire(station.type, STEP, { launch: () => null }, {}), false);
  assert.equal(loaded.payloadDrag, 0.03);
  assert.equal(rack.fire(station.type, STEP, { launch: () => ({}) }, {}), true);
  assert.equal(loaded.payloadDrag, 0);
  assert.equal(rack.count(station.type), 0);
});

test('component health supports independent component wear and reset', () => {
  const health = new ComponentHealth({ motion: { capacity: 16 }, equipment: { capacity: 24 } });
  assert.equal(health.wear('motion', 8), 0);
  assert.equal(health.condition('motion'), 0.5);
  assert.equal(health.wear('motion', 10), 2);
  assert.equal(health.condition('motion'), 0);
  assert.equal(health.condition('equipment'), 1);
  health.reset();
  assert.equal(health.condition('motion'), 1);
});

test('ballistics accepts a swept-region query and preserves the first impact', () => {
  const events = [];
  const near = { shape: 'sphere', position: new Vector3(0, 1000, 4), previous: new Vector3(0, 1000, 4), radius: 1, surface: 'metal' };
  const far = { ...near, position: new Vector3(0, 1000, 6), previous: new Vector3(0, 1000, 6) };
  const world = { maxTerrainHeight: 0, surfaceAt: () => 0 };
  const rounds = new Ballistics(f16.cannon, world, (surface, point, collider) => events.push({ surface, point: point.clone(), collider }));
  rounds.spawn(new Vector3(0, 1000, 0), new Vector3(0, 0, 800), false, 0);
  rounds.step(STEP, (start, end) => {
    assert.equal(start.z, 0);
    assert.ok(end.z > far.position.z);
    return [far, near];
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].surface, 'metal');
  assert.equal(events[0].collider, near);
});
