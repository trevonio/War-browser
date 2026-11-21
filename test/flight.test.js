import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MathUtils, Quaternion, Vector3 } from 'three';
import { MouseAim } from '../src/aim.js';
import { f16 } from '../src/aircraft/f16.js';
import { Flight, neutralControls, STEP } from '../src/sim/flight.js';
import { range, runway, scenarios } from '../src/sim/range.js';

function direction(heading, pitch = 0) {
  return new Vector3(-Math.sin(heading) * Math.cos(pitch), Math.sin(pitch), Math.cos(heading) * Math.cos(pitch));
}

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
  run(turning, 30, () => ({ aimDirection: direction(Math.PI / 2) }));
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
    aimDirection: direction(0, plane.grounded ? 0 : 0.17),
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
    run(flight, 4, () => ({ aimDirection: direction(0, -0.09) }));
    assert.equal(flight.grounded, true);
    assert.equal(flight.failure, gearDown ? '' : 'Ground impact');
  }
});

test('the same sequence of control inputs produces the same fixed-step state after restart', () => {
  const flight = start(scenarios.air);
  const manoeuvre = (_flight, time) => ({ aimDirection: direction(Math.sin(time) * 0.6, Math.cos(time) * 0.10) });
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
      return { aimDirection: direction(heading), aimResponsiveness: responsiveness };
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
  run(flight, 0.6, () => ({ aimDirection: direction(MathUtils.degToRad(-174)) }));
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

function moveMouse(aim, dx, dy = 0) {
  for (let i = 0; i < 20; i++) aim.move(dx / 20, dy / 20, 1, false);
}

function mouseCommand(aim) {
  return { pitchPriority: true, aimDirection: aim.direction, aimHint: aim.turnHint };
}

function bankCosine(flight) {
  const { x, y, z, w } = flight.orientation;
  const forwardY = 2 * (y * z - w * x);
  const upY = 1 - 2 * (x * x + z * z);
  return upY / Math.max(1e-6, Math.sqrt(Math.max(0, 1 - forwardY ** 2)));
}

function measureMouseTurn(flight, aim, seconds, pitchPriority = true) {
  let peakG = 0;
  let minG = Infinity;
  let bank = 0;
  let leastBank = Math.PI;
  run(flight, seconds, (plane) => {
    peakG = Math.max(peakG, plane.g);
    minG = Math.min(minG, plane.g);
    const bankAngle = Math.acos(MathUtils.clamp(bankCosine(plane), -1, 1));
    bank = Math.max(bank, bankAngle);
    leastBank = Math.min(leastBank, bankAngle);
    return { ...mouseCommand(aim), pitchPriority };
  });
  assert.equal(flight.failure, '');
  return { peakG, minG, bank, leastBank, error: flight.velocity.angleTo(aim.direction) };
}

test('mouse alone commands sharp 90-degree turns and a 180-degree reversal', () => {
  for (const angle of [Math.PI / 2, -Math.PI / 2, Math.PI, -Math.PI]) {
    const aim = new MouseAim();
    const flight = start(scenarios.air);
    moveMouse(aim, angle / 0.00125);
    const turn = measureMouseTurn(flight, aim, Math.abs(angle) > 2 ? 20 : 10);
    assert.ok(turn.error < 0.035, 'flight path converges on the mouse target');
    assert.ok(turn.bank > MathUtils.degToRad(65));
    assert.ok(turn.peakG > 5.3 && turn.peakG <= f16.maxG + 0.5);
    assert.ok(turn.minG > -0.5, 'the instructor primarily pulls into large turns');
    assert.ok(Math.sign(flight.position.x - scenarios.air.x) === -Math.sign(angle));
  }
});

test('diagonal mouse targets still reach strong bank and converge in both directions', () => {
  for (const [dx, dy] of [[600, 780], [-600, 780], [600, -820], [-600, -820]]) {
    const scenario = { ...scenarios.air, y: 6500, speed: 240, throttle: 0.75 };
    const flight = start(scenario);
    const aim = new MouseAim();
    moveMouse(aim, dx, dy);
    const turn = measureMouseTurn(flight, aim, 12);
    const original = measureMouseTurn(start(scenario), aim, 12, false);
    assert.ok(turn.error < 0.06);
    assert.ok(turn.peakG > 4);
    assert.ok(turn.minG > -0.65);
    assert.ok(turn.bank >= original.bank - MathUtils.degToRad(1));
    assert.ok(Math.sign(flight.velocity.y) === -Math.sign(dy));
    assert.ok(Math.sign(flight.velocity.x) === -Math.sign(dx));
  }
});

test('straight vertical mouse aim uses signed pitch with minimal bank', () => {
  for (const [dx, dy] of [[0, 780], [0, -820], [28, 780], [-28, 780]]) {
    const flight = start({ ...scenarios.air, y: 6500, speed: 240, throttle: 0.75 });
    const aim = new MouseAim();
    moveMouse(aim, dx, dy);
    const turn = measureMouseTurn(flight, aim, 12);
    assert.ok(turn.error < 0.035);
    assert.ok(turn.bank < MathUtils.degToRad(14));
    assert.ok(dy > 0 ? turn.minG < -1.5 : turn.peakG > 4);
    assert.ok(Math.sign(flight.velocity.y) === -Math.sign(dy));
  }
});

test('alternating vertical mouse corrections stay in the same roll hemisphere', () => {
  const flight = start({ ...scenarios.air, y: 6500, speed: 240, throttle: 0.75 });
  const aim = new MouseAim();
  for (const [dx, dy] of [[15, 560], [-29, -1120], [30, 1120], [-32, -1120]]) {
    const before = flight.velocity.y;
    moveMouse(aim, dx, dy);
    const turn = measureMouseTurn(flight, aim, 2.4);
    assert.ok(turn.bank < MathUtils.degToRad(18));
    assert.ok(Math.sign(flight.velocity.y - before) === -Math.sign(dy));
  }
});

test('keyboard roll can pass through inverted and complete a full turn', () => {
  const flight = start({ ...scenarios.air, y: 6500, speed: 240, throttle: 0.75 });
  const aim = new MouseAim();
  let inverted = false;
  let completed = false;
  const controls = { ...neutralControls, ...mouseCommand(aim), roll: 1 };
  for (let tick = 0; tick < 3.2 / STEP; tick++) {
    flight.step(controls);
    if (bankCosine(flight) < -0.995) inverted = true;
    if (inverted && bankCosine(flight) > 0.995) {
      completed = true;
      break;
    }
  }
  assert.ok(completed);
  assert.equal(flight.failure, '');
});

test('vertical mouse corrections respect a manually inverted attitude', () => {
  for (const dy of [-650, 650]) {
    const flight = start({ ...scenarios.air, y: 6500, speed: 240, throttle: 0.75 });
    const aim = new MouseAim();
    const controls = { ...neutralControls, ...mouseCommand(aim), roll: -1 };
    for (let tick = 0; tick < 2 / STEP && bankCosine(flight) > -0.995; tick++) flight.step(controls);
    assert.ok(bankCosine(flight) <= -0.995);
    moveMouse(aim, 0, dy);
    const turn = measureMouseTurn(flight, aim, 10);
    assert.ok(turn.error < 0.085);
    assert.ok(turn.leastBank > MathUtils.degToRad(160));
    assert.ok(bankCosine(flight) < -0.97);
    assert.ok(Math.sign(flight.velocity.y) === -Math.sign(dy));
  }
});

test('the instructor recovers from vertical and inverted attitudes with mouse input', () => {
  for (const [pitch, bank, dx, dy] of [
    [Math.PI / 2, 0.5, 1000, 0],
    [-Math.PI / 2, 0.5, -800, 650],
    [0, Math.PI, -850, 300],
    [0, Math.PI, 850, -300],
  ]) {
    const flight = start({ ...scenarios.air, y: 6800, speed: 240, pitch, throttle: 0.8 });
    flight.velocity.copy(direction(0, pitch)).multiplyScalar(240);
    flight.orientation.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), bank));
    const aim = new MouseAim();
    aim.align(0, pitch);
    moveMouse(aim, dx, dy);
    const turn = measureMouseTurn(flight, aim, 13);
    assert.ok(turn.error < 0.09, 'aim remains reachable through vertical and inverted flight');
  }
});

test('reversing mouse travel reverses the requested bank and settles on the new course', () => {
  const flight = start({ ...scenarios.air, y: 2800, speed: 220, throttle: 0.75 });
  const aim = new MouseAim();
  moveMouse(aim, 1250);
  measureMouseTurn(flight, aim, 1.4);
  moveMouse(aim, -2500);
  const change = measureMouseTurn(flight, aim, 12);
  assert.ok(flight.heading > 230 && flight.heading < 290);
  assert.ok(change.error < 0.045);
  assert.ok(Math.abs(flight.rates.z) < 0.13);
});
