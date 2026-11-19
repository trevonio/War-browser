import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MathUtils, Quaternion, Vector3 } from 'three';
import { FlightCamera } from '../src/view/camera.js';
import { MouseAim } from '../src/aim.js';

const world = { heightAt: () => 0 };

function aircraftAtAltitude() {
  return {
    position: new Vector3(0, 800, 0),
    quaternion: new Quaternion(),
    renderMovement: new Vector3(),
  };
}

test('the chase camera keeps the horizon steady through a steep roll', () => {
  const aircraft = aircraftAtAltitude();
  const velocity = new Vector3(0, 0, 220);
  const chase = new FlightCamera(world);
  chase.update(aircraft, velocity, 1 / 60, 'flying', false, 1);
  aircraft.quaternion.setFromAxisAngle(new Vector3(0, 0, 1), MathUtils.degToRad(80));
  for (let i = 0; i < 60; i++) chase.update(aircraft, velocity, 1 / 60, 'flying', false, 1);
  assert.ok(chase.camera.up.y > 0.99);
  assert.ok(Math.abs(chase.camera.up.x) > 0.05, 'retains a small bank cue');
  assert.ok(chase.camera.position.distanceTo(aircraft.position) > 30);
  const projected = aircraft.position.clone().project(chase.camera);
  assert.ok(Math.abs(projected.x) < 0.2 && Math.abs(projected.y) < 0.8);
});

test('the smoothing option scales chase inertia without delaying forward translation', () => {
  const aircraft = aircraftAtAltitude();
  const velocity = new Vector3(0, 0, 220);
  const fast = new FlightCamera(world);
  const smooth = new FlightCamera(world);
  fast.update(aircraft, velocity, 1 / 60, 'flying', false, 0.4);
  smooth.update(aircraft, velocity, 1 / 60, 'flying', false, 2.2);
  const before = fast.camera.position.clone();
  aircraft.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), -0.6);
  aircraft.renderMovement.set(0, 0, 3.7);
  aircraft.position.add(aircraft.renderMovement);
  before.add(aircraft.renderMovement);
  fast.update(aircraft, velocity, 1 / 60, 'flying', false, 0.4);
  smooth.update(aircraft, velocity, 1 / 60, 'flying', false, 2.2);
  assert.ok(fast.camera.position.distanceTo(before) > smooth.camera.position.distanceTo(before) * 2);
  assert.ok(smooth.camera.position.z > -29, 'tracks forward movement every frame');
});

test('the aim-led chase camera turns before the jet and keeps it framed through reversals', () => {
  const aircraft = aircraftAtAltitude();
  const velocity = new Vector3(0, 0, 220);
  const chase = new FlightCamera(world);
  const aim = new MouseAim();
  const direction = new Vector3();
  const projected = new Vector3();
  chase.update(aircraft, velocity, 1 / 60, 'flying', false, 1, aim, 1);
  aim.move(1250, 0, 1, false);
  for (let i = 0; i < 18; i++) chase.update(aircraft, velocity, 1 / 60, 'flying', false, 1, aim, 1);
  assert.ok(chase.camera.getWorldDirection(direction).x < -0.90, 'view rotates while the aircraft stays facing north');
  assert.ok(Math.abs(aircraft.quaternion.w - 1) < 1e-9);
  aim.move(1200, 0, 1, false);
  for (let i = 0; i < 45; i++) {
    chase.update(aircraft, velocity, 1 / 60, 'flying', false, 1, aim, 1);
    projected.copy(aircraft.position).project(chase.camera);
    assert.ok(Math.abs(projected.x) < 0.4 && Math.abs(projected.y) < 0.5);
    assert.ok(chase.camera.position.distanceTo(aircraft.position) >= 31);
  }
});

test('mouse aim accepts continuous revolutions and remains steerable across the vertical', () => {
  const aim = new MouseAim();
  const previous = new Vector3();
  let traveled = 0;
  for (let i = 0; i < 400; i++) {
    previous.copy(aim.direction);
    aim.move(30, 0, 1, false);
    traveled += previous.angleTo(aim.direction);
  }
  assert.ok(traveled > Math.PI * 4);
  aim.align(0, Math.PI / 2);
  aim.move(110, 0, 1, false);
  assert.ok(aim.direction.x < -0.12, 'horizontal input still moves a vertically aimed view');
  aim.align(0, 0);
  aim.move(0, 1700, 1, false);
  assert.ok(aim.direction.y < -0.8 && aim.direction.z < -0.4, 'pitch input can pass through straight down');
});

test('small mouse input remains precise and responds to the sensitivity setting', () => {
  const slow = new MouseAim();
  const fast = new MouseAim();
  const forward = new Vector3(0, 0, 1);
  slow.move(40, 0, 0.4, false);
  fast.move(40, 0, 2.2, false);
  assert.ok(slow.direction.angleTo(forward) < MathUtils.degToRad(1.3));
  assert.ok(fast.direction.angleTo(forward) > slow.direction.angleTo(forward) * 5);
});
