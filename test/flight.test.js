import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MathUtils, Vector3 } from 'three';
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
  run(turning, 30, () => ({ aimHeading: Math.PI / 2 }));
  assert.ok(turning.heading > 50 && turning.heading < 92);
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
    aimPitch: plane.grounded ? 0 : 0.17,
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
    run(flight, 4, () => ({ aimPitch: -0.09 }));
    assert.equal(flight.grounded, true);
    assert.equal(flight.failure, gearDown ? '' : 'Ground impact');
  }
});

test('the same sequence of control inputs produces the same fixed-step state after restart', () => {
  const flight = start(scenarios.air);
  const manoeuvre = (_flight, time) => ({ aimHeading: Math.sin(time) * 0.6, aimPitch: Math.cos(time) * 0.10 });
  run(flight, 12, manoeuvre);
  const first = [flight.position.toArray(), flight.velocity.toArray(), flight.orientation.toArray(), flight.fuel];
  flight.reset(scenarios.air);
  run(flight, 12, manoeuvre);
  assert.deepEqual([flight.position.toArray(), flight.velocity.toArray(), flight.orientation.toArray(), flight.fuel], first);
});

test('the instructor captures a heading and rolls level at low and transonic speeds', () => {
  for (const [speed, heading, responsiveness] of [[103, 0.9, 0.65], [335, -1.0, 2.2]]) {
    const flight = start({ ...scenarios.air, y: 6500, speed, throttle: 0.8 });
    const bodyUp = new Vector3();
    let peakBank = 0;
    run(flight, 52, (plane) => {
      bodyUp.set(0, 1, 0).applyQuaternion(plane.orientation);
      peakBank = Math.max(peakBank, Math.acos(MathUtils.clamp(bodyUp.y, -1, 1)));
      return { aimHeading: heading, aimResponsiveness: responsiveness };
    });
    const course = Math.atan2(-flight.velocity.x, flight.velocity.z);
    assert.equal(flight.failure, '');
    assert.ok(peakBank > 0.3);
    assert.ok(Math.abs(course - heading) < 0.055, 'settles on the commanded course');
    assert.ok(bodyUp.y > 0.995, 'rolls out smoothly to level flight');
  }
});

test('the instructor takes the shorter direction across the heading wrap', () => {
  const flight = start({ ...scenarios.air, y: 6500, throttle: 0.7 });
  flight.orientation.setFromAxisAngle(new Vector3(0, 1, 0), MathUtils.degToRad(-174));
  flight.velocity.set(0, 0, scenarios.air.speed).applyQuaternion(flight.orientation);
  run(flight, 0.6, () => ({ aimHeading: MathUtils.degToRad(-174) }));
  const heading = flight.heading;
  assert.ok(heading > 174 && heading < 193, 'turns toward the nearby course across the wrap');
  assert.ok(flight.rates.z > 0, 'banks toward the clockwise target');
});

test('G warnings reflect measured simulated load and clear after recovery', () => {
  for (const [pitch, warning, threshold] of [[1, 'HIGH G', 5.8], [-1, 'NEGATIVE G', -1.5]]) {
    const flight = start({ ...scenarios.air, y: 6500, speed: 275 });
    let reached;
    run(flight, 1.5, (plane) => {
      if (plane.gWarning === warning) reached = plane.g;
      return { pitch };
    });
    assert.ok(pitch > 0 ? reached >= threshold : reached <= threshold);
    run(flight, 5);
    assert.equal(flight.gWarning, '');
  }
});
