import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MathUtils, Quaternion, Vector3 } from 'three';
import { FlightCamera } from '../src/view/camera.js';

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
