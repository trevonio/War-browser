import assert from 'node:assert/strict';
import { test } from 'node:test';
import { f16 } from '../src/aircraft/f16.js';
import { Flight, neutralControls, STEP } from '../src/sim/flight.js';
import { range, runway, scenarios } from '../src/sim/range.js';

function start(scenario) {
  const flight = new Flight(f16, range);
  flight.reset(scenario);
  return flight;
}

function run(flight, seconds, input = () => ({})) {
  for (let tick = 0; tick < seconds / STEP && !flight.failure; tick++) {
    flight.step({ ...neutralControls, ...input(flight, tick * STEP) });
  }
}

test('neutral mouse assist holds a stable air start over 30 simulated seconds', () => {
  const flight = start(scenarios.air);
  run(flight, 30);
  assert.equal(flight.failure, '');
  assert.ok(Math.abs(flight.position.y - scenarios.air.y) < 20);
  assert.ok(Math.abs(flight.heading) < 0.01);
  assert.ok(flight.g > 0.9 && flight.g < 1.1);
});

test('banking turns the flight path and spends more energy at the same throttle', () => {
  const straight = start(scenarios.air);
  const turning = start(scenarios.air);
  run(straight, 30);
  run(turning, 30, () => ({ aimX: 0.65 }));
  assert.ok(turning.heading > 45 && turning.heading < 95);
  assert.ok(turning.position.x < scenarios.air.x - 1000);
  const specificEnergy = (flight) => 0.5 * flight.velocity.lengthSq() + 9.80665 * flight.position.y;
  assert.ok(specificEnergy(turning) < specificEnergy(straight) - 500);
});

test('afterburner spools, adds thrust and consumes more fuel before shutting off', () => {
  const military = start(scenarios.air);
  const boosted = start(scenarios.air);
  boosted.toggleAfterburner();
  boosted.step(neutralControls);
  assert.equal(boosted.afterburner, false);
  run(military, 12, () => ({ throttle: 1 }));
  run(boosted, 12);
  assert.equal(boosted.afterburner, true);
  assert.ok(boosted.airspeed > military.airspeed + 40);
  assert.ok(boosted.fuel < military.fuel - 20);
  boosted.toggleAfterburner();
  boosted.step(neutralControls);
  assert.equal(boosted.afterburner, false);
});

test('runway start can take off and retract the gear', () => {
  const flight = start(scenarios.runway);
  assert.equal(flight.gear, 1);
  run(flight, 30, (plane) => ({
    throttle: 1,
    pitch: plane.airspeed > 125 && plane.position.y < 60 ? 0.65 : 0,
    aimY: plane.grounded ? 0 : 0.27,
  }));
  assert.equal(flight.failure, '');
  assert.equal(flight.grounded, false);
  assert.ok(flight.position.y > runway.elevation + 100);
  flight.gearDown = false;
  run(flight, 0.4);
  assert.ok(flight.gear > 0 && flight.gear < 1);
  run(flight, 0.6);
  assert.equal(flight.gear, 0);
});

test('a controlled approach lands with gear down and ends the flight with gear up', () => {
  for (const gearDown of [true, false]) {
    const flight = start({
      ...scenarios.air, x: 0, y: runway.elevation + 4.5, z: -2520, speed: 89, pitch: 0.128, throttle: 0.27,
    });
    flight.gear = Number(gearDown);
    flight.gearDown = gearDown;
    flight.velocity.y = -3;
    run(flight, 4, () => ({ aimY: -0.15 }));
    assert.equal(flight.grounded, true);
    assert.equal(flight.failure, gearDown ? '' : 'Ground impact');
  }
});

test('the same sequence of control inputs produces the same fixed-step state after restart', () => {
  const flight = start(scenarios.air);
  const manoeuvre = (_flight, time) => ({ aimX: Math.sin(time) * 0.6, aimY: Math.cos(time) * 0.15 });
  run(flight, 12, manoeuvre);
  const first = [flight.position.toArray(), flight.velocity.toArray(), flight.orientation.toArray(), flight.fuel];
  flight.reset(scenarios.air);
  run(flight, 12, manoeuvre);
  assert.deepEqual([flight.position.toArray(), flight.velocity.toArray(), flight.orientation.toArray(), flight.fuel], first);
});
