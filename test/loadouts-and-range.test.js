import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import { f16 } from '../src/aircraft/f16.js';
import { f15 } from '../src/aircraft/f15.js';
import { WeaponRack } from '../src/sim/combat/weapons.js';
import { Flight, STEP, neutralControls } from '../src/sim/flight.js';
import { GroundRange } from '../src/sim/ground-range.js';
import { availablePresets, configurableStations, LoadoutBook, missionLoadout, resolveLoadout } from '../src/sim/loadouts.js';
import { RangeOrdnance, applyGroundImpact } from '../src/sim/range-ordnance.js';
import { range, scenarios } from '../src/sim/range.js';

const flat = { structures: [], heightAt: () => 0, surfaceAt: () => 0, isRunway: () => false, maxTerrainHeight: 0 };

function aircraft(assignment, spec = f16, start = scenarios.air, world = range) {
  const flight = new Flight(spec, world);
  flight.reset(start);
  const rack = new WeaponRack(flight, {}, world);
  rack.reset(resolveLoadout(spec, assignment));
  return { flight, rack };
}

test('presets fit each aircraft, with station, mass, clearance and mission restrictions', () => {
  for (const spec of [f16, f15]) {
    for (const assignment of Object.values(availablePresets(spec))) assert.deepEqual(resolveLoadout(spec, assignment).errors, []);
  }
  assert.equal(configurableStations(f16).length, 7);
  assert.equal(configurableStations(f15).length, 11);
  assert.match(resolveLoadout(f15, { 'shoulder-a-left': 'bomb' }).errors[0], /cannot mount/);
  assert.match(resolveLoadout(f16, { nowhere: 'bomb' }).errors[0], /Unknown station/);
  assert.match(resolveLoadout(f16, { 'wingtip-left': ['infrared', 'infrared'] }).errors[0], /Unknown store/);
  assert.match(resolveLoadout(f16, { 'inboard-left': 'tank', 'inboard-right': 'tank', center: 'tank' }).errors[0], /conflicts/);
  const reduced = { ...f16, storeStations: { ...f16.storeStations, overrides: { 'wingtip-left': { limit: 50 } } } };
  assert.match(resolveLoadout(reduced, { 'wingtip-left': 'infrared' }).errors[0], /50 kg/);
  assert.equal(missionLoadout(f16, { 'outer-left': 'bomb' }, 'intercept').stations.length, 0);
  assert.equal(missionLoadout(f16, {}, 'outnumbered'), null);
});

test('persistent loads restore valid choices and filter outdated records', () => {
  const storage = new Map();
  storage.getItem = storage.get.bind(storage);
  storage.setItem = storage.set.bind(storage);
  const book = new LoadoutBook(storage);
  const entry = book.entry(f16);
  entry.active = { 'outer-right': 'bomb' };
  entry.saved.push({ name: 'Practice', assignment: entry.active }, { name: 'Old', assignment: { obsolete: 'tank' } });
  assert.ok(book.persist());
  const fromDisk = new LoadoutBook(storage).entry(f16);
  assert.deepEqual(fromDisk.active, entry.active);
  assert.deepEqual(fromDisk.saved.map(({ name }) => name), ['Practice']);
  assert.ok(fromDisk.invalid);
});

test('real mass and drag slow a loaded aircraft and the external tank feeds and jettisons', () => {
  const { flight: clean } = aircraft({});
  const { flight: loaded, rack } = aircraft({ center: 'tank', 'outer-left': 'bomb' });
  assert.equal(loaded.mass - clean.mass, 943);
  assert.equal(loaded.externalFuel, 620);
  assert.ok(loaded.payloadDrag > clean.payloadDrag);
  const inside = loaded.fuel;
  for (let step = 0; step < 180; step++) {
    clean.step(neutralControls);
    loaded.step(neutralControls);
  }
  assert.ok(loaded.velocity.length() < clean.velocity.length());
  assert.ok(loaded.externalFuel < 620);
  assert.equal(loaded.fuel, inside);
  const mass = loaded.mass;
  const remaining = loaded.externalFuel;
  const drop = new RangeOrdnance(range, () => {});
  assert.equal(drop.jettison(rack), true);
  assert.equal(loaded.externalCapacity, 0);
  assert.equal(loaded.externalFuel, 0);
  assert.ok(Math.abs(mass - loaded.mass - (108 + remaining)) < 1e-8);
  assert.equal(loaded.payloadDrag, 0.0021);
  assert.equal(drop.rounds[0].kind, 'tank');
});

for (const [kind, stationName, pitch] of [['bomb', 'outer-left', 0], ['rocket', 'inboard-left', -0.36]]) {
  test(`${kind} preview and simulated impact agree and damage a static target`, () => {
    const targetRange = new GroundRange(flat);
    targetRange.reset(true);
    const target = targetRange.targets[0];
    const impacts = [];
    const { flight, rack } = aircraft({ [stationName]: kind }, f16,
      { ...scenarios.air, x: target.position.x, y: 135, z: -2600, speed: 122, pitch }, flat);
    const station = rack.station(kind);
    flight.position.x -= station.offset[0];
    const pool = new RangeOrdnance(flat, (type, point, collider, profile) => {
      impacts.push(point.clone());
      applyGroundImpact(type, point, collider, profile, targetRange.targets);
    });
    const prediction = new Vector3();
    assert.ok(pool.predict(kind, flight, station, [], prediction));
    flight.position.z += target.position.z - prediction.z;
    assert.ok(pool.predict(kind, flight, station, targetRange.targets, prediction));
    const prior = flight.mass;
    assert.equal(pool.release(rack, kind, 'single'), 1);
    const round = pool.rounds[0];
    const expectedOrigin = new Vector3().fromArray(station.offset).add(new Vector3().fromArray(station.release))
      .applyQuaternion(flight.orientation).add(flight.position);
    assert.ok(round.position.distanceTo(expectedOrigin) < 1e-9);
    if (kind === 'bomb') assert.ok(round.velocity.equals(flight.velocity));
    if (kind === 'rocket') assert.ok(round.velocity.length() > flight.velocity.length());
    assert.ok(flight.mass < prior);
    for (let step = 0; step < 19 / STEP && pool.active; step++) pool.step(STEP, rack, targetRange.targets);
    assert.equal(impacts.length, 1);
    assert.ok(prediction.distanceTo(impacts[0]) < 1e-7);
    assert.equal(target.active, false);
    assert.equal(targetRange.hitCount, 1);
    assert.equal(targetRange.destroyed, 1);
  });
}

test('pairs and bursts consume available stores in the shared inventory', () => {
  const { flight, rack } = aircraft({ 'outer-left': 'bomb', 'outer-right': 'bomb', 'inboard-left': 'rocket' }, f16,
    { ...scenarios.air, y: 1500 }, flat);
  const pool = new RangeOrdnance(flat, () => {});
  assert.equal(pool.release(rack, 'bomb', 'pair'), 2);
  assert.equal(pool.bombs, 2);
  assert.equal(rack.count('bomb'), 0);
  assert.equal(pool.release(rack, 'rocket', 'burst'), 1);
  const before = flight.payloadDrag;
  for (let step = 0; step < 120; step++) {
    flight.elapsed += STEP;
    pool.step(STEP, rack, []);
  }
  assert.equal(pool.rockets, 5);
  assert.equal(rack.count('rocket'), 2);
  for (let step = 0; step < 2; step++) pool.release(rack, 'rocket', 'single');
  assert.equal(rack.count('rocket'), 0);
  assert.equal(flight.payloadDrag, before);
  assert.equal(rack.stations.find(({ type }) => type === 'rocket').used, false);
});
