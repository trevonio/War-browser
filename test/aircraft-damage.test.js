import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import { f16 } from '../src/aircraft/f16.js';
import { Ballistics } from '../src/sim/ballistics.js';
import { Dogfight } from '../src/sim/dogfight.js';
import { Flight, STEP, neutralControls } from '../src/sim/flight.js';
import { range, scenarios } from '../src/sim/range.js';

const airborne = { ...scenarios.dogfight, y: 1900, throttle: 0.85 };
const direct = { ...neutralControls, assisted: false };
function airframe(scenario = airborne) {
  const flight = new Flight(f16, range);
  flight.reset(scenario);
  return flight;
}
function advance(flight, seconds, controls = direct) {
  for (let tick = 0; tick < seconds / STEP; tick++) flight.step(controls);
}

test('surface commands follow instructor and direct controls, stay within limits and retract with speed', () => {
  const aircraft = airframe();
  const { angles } = aircraft.surfaces;
  advance(aircraft, 0.18, { ...direct, pitch: 1 });
  assert.ok(angles.LeftStabilator > 2 && angles.LeftStabilator <= 21);
  assert.equal(angles.LeftStabilator, angles.RightStabilator);
  advance(aircraft, 0.22, { ...direct, roll: 1 });
  assert.ok(angles.LeftFlaperon > 4 && angles.RightFlaperon < -4);
  assert.ok(angles.LeftStabilator > angles.RightStabilator);
  const assisted = airframe();
  advance(assisted, 0.2, { ...neutralControls, aimDirection: new Vector3(-0.65, 0.31, 0.82).normalize() });
  assert.ok(assisted.surfaces.angles.LeftFlaperon > assisted.surfaces.angles.RightFlaperon);
  const runway = airframe(scenarios.runway);
  assert.equal(runway.surfaces.angles.LeftFlaperon, runway.surfaces.angles.RightFlaperon);
  assert.ok(runway.surfaces.angles.LeftFlaperon > 15);
  assert.equal(airframe({ ...airborne, runway: true, speed: 180 }).surfaces.angles.LeftFlaperon, 0);
});

test('engine hits reduce thrust, ignite persistent fire and eventually stop the engine', () => {
  const healthy = airframe();
  const damaged = airframe();
  damaged.damage.hit('engine', 14);
  advance(healthy, 0.3);
  advance(damaged, 0.3);
  assert.ok(damaged.thrust < healthy.thrust * 0.4);
  assert.equal(damaged.damage.fire, true);
  const present = damaged.damage.condition('engine');
  advance(damaged, 0.8);
  assert.ok(damaged.damage.condition('engine') < present);
  damaged.damage.hit('engine', 10);
  advance(damaged, 0.1);
  assert.equal(damaged.thrust, 0);
  assert.equal(damaged.failure, '');
});

test('a wing hit rolls toward the damaged side and weakens structural load limits', () => {
  const aircraft = airframe();
  aircraft.damage.hit('leftWing', 17);
  const prior = aircraft.damage.condition('leftWing');
  advance(aircraft, 0.33);
  assert.ok(aircraft.rates.z < -0.045);
  assert.ok(aircraft.damage.lift < 0.75);
  assert.ok(aircraft.damage.loadLimit < 0.70);
  aircraft.g = 8;
  for (let tick = 0; tick < 60; tick++) aircraft.updatePilot(STEP);
  assert.ok(aircraft.damage.condition('leftWing') < prior);
  assert.ok(aircraft.stress > 0.23);
});

test('jammed stabilators and flaperons retain their deflection and reduce control response', () => {
  const aircraft = airframe();
  const command = { ...direct, pitch: 1, roll: 1 };
  advance(aircraft, 0.12, command);
  const tail = aircraft.surfaces.angles.LeftStabilator;
  const flap = aircraft.surfaces.angles.LeftFlaperon;
  aircraft.damage.hit('leftStabilator', 10);
  aircraft.damage.hit('leftFlaperon', 8);
  advance(aircraft, 0.18, { ...direct, pitch: -1, roll: -1 });
  assert.equal(aircraft.surfaces.angles.LeftStabilator, tail);
  assert.equal(aircraft.surfaces.angles.LeftFlaperon, flap);
  assert.notEqual(aircraft.surfaces.angles.RightFlaperon, flap);
  assert.equal(aircraft.damage.pitchAuthority, 0.50);
  assert.equal(aircraft.damage.rollAuthority, 0.50);
  const healthy = airframe();
  advance(healthy, 0.18, { ...direct, pitch: -1, roll: -1 });
  assert.ok(aircraft.rates.z > healthy.rates.z);
});

test('moving part volumes apply the hit to the specific component and a damaged AI attempts to glide', () => {
  const player = airframe();
  const exercise = new Dogfight(player, f16, range, { shot() {}, impact() {} });
  exercise.reset('passive', airborne);
  const target = exercise.opponent;
  const wing = exercise.opponentHull.colliders.find((part) => part.component === 'leftWing');
  const rounds = new Ballistics(f16.cannon, range, (_surface, _point, collider) => exercise.hit(collider, 5));
  rounds.spawn(wing.position.clone().add(new Vector3(0, 3, 0)), new Vector3(0, -790, 0), false, 0);
  rounds.step(STEP, exercise.playerTargets);
  assert.ok(target.damage.condition('leftWing') < 1);
  assert.equal(target.damage.condition('rightWing'), 1);
  assert.equal(player.damage.active, false);
  target.damage.hit('engine', 24);
  exercise.update();
  assert.equal(exercise.pilot.status, 'GLIDING');
  assert.equal(exercise.pilot.fire, false);
  assert.equal(target.thrust, 0);
  target.damage.hit('pilot', 9);
  target.step(neutralControls);
  assert.equal(exercise.finish(), 'win');
  exercise.reset('passive', airborne);
  assert.equal(target.damage.active, false);
});

test('damage to the fuel system consumes fuel beyond normal engine flow', () => {
  const damaged = airframe();
  const healthy = airframe();
  damaged.damage.hit('fuel', 10);
  assert.equal(damaged.damage.report, 'FUEL LEAK');
  assert.ok(damaged.damage.leak > 10);
  advance(damaged, 2);
  advance(healthy, 2);
  assert.ok(damaged.fuel < healthy.fuel - 20);
});
