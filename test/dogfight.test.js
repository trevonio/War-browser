import assert from 'node:assert/strict';
import test from 'node:test';
import { f16 } from '../src/aircraft/f16.js';
import { Ballistics } from '../src/sim/ballistics.js';
import { Cannon, cannonMount } from '../src/sim/cannon.js';
import { Dogfight } from '../src/sim/dogfight.js';
import { Flight, neutralControls, STEP } from '../src/sim/flight.js';
import { range, scenarios } from '../src/sim/range.js';

const start = scenarios.dogfight;

function exercise(mode) {
  const player = new Flight(f16, range);
  const effects = { shot() {}, impact() {} };
  const fight = new Dogfight(player, f16, range, effects);
  const rounds = new Ballistics(f16.cannon, range, (_kind, _position, collider, impactSpeed) => {
    if (collider?.hull) fight.hit(collider, f16.cannon.damage, impactSpeed / f16.cannon.projectileSpeed);
  });
  const cannon = new Cannon(f16.cannon, cannonMount(f16.cannon), rounds, effects.shot);
  player.reset(start);
  fight.reset(mode, start);
  return {
    player, fight, cannon,
    step(shoot = false) {
      player.step(neutralControls);
      fight.update();
      cannon.step(STEP, shoot, player);
      fight.fire();
      rounds.step(STEP, fight.playerTargets);
      return fight.finish();
    },
  };
}

test('passive AI changes heading gently, holds altitude, and never shoots', () => {
  const { fight, step } = exercise('passive');
  const opponent = fight.opponent;
  for (let tick = 0; tick < 30 / STEP; tick++) {
    assert.equal(step(), '');
    assert.ok(opponent.position.distanceTo(opponent.previousPosition) < 3);
  }
  assert.equal(fight.pilot.status, 'PATROL');
  assert.ok(opponent.heading > 20 && opponent.heading < 45);
  assert.ok(Math.abs(opponent.position.y - (start.y + 12.5)) < 35);
  assert.equal(fight.cannon.fired, 0);
});

test('defensive AI responds to a pursuing player without firing', () => {
  const { fight, step } = exercise('defensive');
  step();
  assert.equal(fight.pilot.status, 'EVADING');
  const spawn = fight.opponent.position.clone();
  for (let tick = 0; tick < 5 / STEP; tick++) step();
  assert.ok(fight.opponent.heading > 30 && fight.opponent.heading < 110);
  assert.ok(fight.opponent.position.y > spawn.y + 50);
  assert.equal(fight.cannon.fired, 0);
  assert.equal(fight.playerHull.percentage, 100);
});

test('player cannon rounds can defeat a moving opponent and the exercise resets', () => {
  const { player, fight, cannon, step } = exercise('passive');
  for (let tick = 0; tick < 3 / STEP && !fight.result; tick++) step(player.elapsed >= 0.65);
  assert.equal(fight.result, 'win');
  assert.equal(fight.opponentHull.percentage, 0);
  assert.equal(fight.playerHull.percentage, 100);
  assert.ok(cannon.ammo < f16.cannon.capacity);
  assert.ok(fight.opponentHull.colliders.every((collider) => !collider.active));

  player.reset(start);
  fight.reset('defensive', start);
  assert.equal(fight.result, '');
  assert.equal(fight.notice, '');
  assert.equal(fight.opponentHull.percentage, 100);
  assert.equal(fight.cannon.ammo, f16.cannon.capacity);
  assert.ok(fight.opponentHull.colliders.every((collider) => collider.active && collider.previous.equals(collider.position)));
});

test('aggressive AI intercepts, pursues, and can win with ballistic hits', () => {
  const { fight, step } = exercise('aggressive');
  const states = new Set();
  for (let tick = 0; tick < 85 / STEP && !fight.result; tick++) {
    step();
    states.add(fight.pilot.status);
  }
  assert.ok(states.has('INTERCEPT'));
  assert.ok(states.has('PURSUIT'));
  assert.ok(states.has('FIRING'));
  assert.ok(fight.cannon.fired > 0 && fight.cannon.fired < f16.cannon.capacity);
  assert.equal(fight.result, 'loss');
  assert.equal(fight.playerHull.percentage, 0);
  assert.equal(fight.opponentHull.percentage, 100);
  assert.match(fight.player.failure, /^(Pilot incapacitated|Airframe failure)$/);
});
