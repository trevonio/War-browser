import assert from 'node:assert/strict';
import test from 'node:test';
import { MathUtils, Vector3 } from 'three';
import { f15 } from '../src/aircraft/f15.js';
import { f16 } from '../src/aircraft/f16.js';
import { CasDirector } from '../src/sim/cas/director.js';
import { casMissions, createCasScenario } from '../src/sim/cas/scenarios.js';
import { Flight, neutralControls, STEP } from '../src/sim/flight.js';
import { GroundBattle } from '../src/sim/ground/battlefield.js';
import { applyGroundImpact, RangeOrdnance } from '../src/sim/range-ordnance.js';
import { range, scenarios } from '../src/sim/range.js';

const difficulties = ['rookie', 'regular', 'veteran'];
const distant = new Vector3(12000, 4300, -12500);

function prepare(key, seed = 1345737, difficulty = 'regular') {
  const battle = new GroundBattle(range);
  const director = new CasDirector(createCasScenario(key, seed, difficulty, battle.roads));
  battle.reset('cas', difficulty, undefined, seed, director);
  return { battle, director };
}

function run(battle, seconds, sample = () => {}) {
  for (let tick = 0; tick < Math.ceil(seconds / STEP) && !battle.outcome; tick++) {
    battle.step(STEP, distant);
    sample();
  }
}

test('all four seeded CAS missions vary their playable layouts and validate routes over 240 scenarios', () => {
  const { roads } = new GroundBattle(range);
  for (const key of Object.keys(casMissions)) {
    const layouts = new Set();
    for (const difficulty of difficulties) for (let i = 1; i <= 20; i++) {
      const seed = i * 1345737;
      const plan = createCasScenario(key, seed, difficulty, roads);
      assert.deepEqual(plan, createCasScenario(key, seed, difficulty, roads));
      assert.equal(plan.seed, seed);
      assert.ok(plan.definitions.length + plan.relief.length <= plan.activeLimit);
      layouts.add(JSON.stringify([plan.road, plan.objective.x, plan.objective.z, plan.reliefAt]));
      for (const unit of [...plan.definitions, ...plan.relief]) {
        assert.ok(unit.route.length, `${key} ${seed} ${unit.id} has no route`);
        let previous = [unit.x, unit.z];
        for (const point of unit.route) {
          assert.ok(roads.canJoin(range, previous, point), `${key} ${seed} ${unit.id} has an invalid route segment`);
          previous = point;
        }
      }
    }
    assert.ok(layouts.size > 10);
  }
});

test('ground reports create real support requests, can be accepted, and update only from observations', () => {
  const { battle, director } = prepare('emergency', 123457);
  assert.equal(director.contacts.size, 0);
  run(battle, 4);
  const request = director.requests.find(({ state }) => state === 'active');
  assert.ok(request);
  assert.equal(request.urgency, 'Urgent');
  const target = battle.targets.find(({ id }) => id === request.target);
  assert.equal(target.faction, 'opposing');
  assert.equal(director.accept(request.id, battle.time), request);
  const mark = director.designation(battle);
  assert.ok(mark.approximate);
  assert.equal(mark.position, request.position);
  const known = director.contacts.get(target.id);
  assert.equal(known.source, 'Ground report');
  assert.equal(Math.abs(known.position.x % director.plan.rules.grid), 0);
  const former = known.position.clone();
  target.position.x += 45;
  assert.deepEqual(known.position, former);
  assert.deepEqual(director.designation(battle).position, request.position);
  target.hit('hull', 500, { source: 'player', kind: 'bomb', point: target.position });
  assert.equal(request.state, 'completed');
  assert.ok(director.history.some(({ message }) => message === 'Reported threat stopped.'));
  assert.ok(!director.contacts.has('fictional-opponent'));
});

test('limited reinforcements enter by route, fire and leave a clean state on replay', () => {
  const { battle, director } = prepare('breakthrough');
  const oldLength = battle.targets.length;
  run(battle, director.plan.reliefAt + 21);
  assert.equal(director.reinforcement, 'arrived');
  assert.equal(battle.targets.length, oldLength + director.plan.relief.length);
  assert.ok(battle.targets.some((unit) => unit.id.startsWith('relief-') && unit.travel > 50));
  assert.ok(battle.weapons.shots > 0);
  const replay = new CasDirector(director.plan);
  battle.reset('cas', 'regular', undefined, director.plan.seed, replay);
  assert.equal(battle.targets.length, oldLength);
  assert.equal(replay.requests.length, 0);
  assert.equal(replay.contacts.size, 0);
  assert.equal(battle.losses.friendly, 0);
  assert.equal(battle.time, 0);
});

test('aircraft bombs change the same seeded interdiction outcome by stopping real transports', () => {
  const baseline = prepare('interdiction', 123457);
  run(baseline.battle, 240);
  assert.equal(baseline.battle.outcome, 'loss');
  assert.ok(baseline.battle.targets.filter((unit) => unit.arrived && unit.objective === 'deliver').length >= 2);

  const { battle, director } = prepare('interdiction', 123457);
  const aircraft = new Flight(f16, range);
  aircraft.reset(director.plan.start);
  const stores = new RangeOrdnance(range, (kind, point, collider, profile) => applyGroundImpact(kind, point, collider, profile, battle.targets));
  const station = { offset: [0, 0, 0], release: [0, 0, 0], rotation: [0, 0, 0], remaining: 3 };
  const rack = { flight: aircraft, consume({ remaining }) { station.remaining = remaining - 1; } };
  run(battle, 10);
  for (const target of battle.transports) {
    aircraft.position.copy(target.position);
    aircraft.position.y += 16;
    aircraft.velocity.set(target.drive.x, -24, target.drive.z);
    aircraft.orientation.identity();
    assert.ok(stores.releaseFrom(rack, 'bomb', station));
  }
  run(battle, 25, () => stores.step(STEP, rack, battle.queryPlayer));
  assert.equal(battle.outcome, 'win');
  assert.equal(director.primary.state, 'completed');
  assert.equal(director.secondary.state, 'completed');
  assert.equal(stores.bombs, 3);
  assert.equal(battle.transports.filter((unit) => unit.disabled).length, 3);
});

test('the other CAS objectives resolve from crossing control, real arrivals and relief of the friendly group', () => {
  for (const key of ['breakthrough', 'protection', 'emergency']) {
    const { battle, director } = prepare(key, 123457);
    while (!battle.outcome) {
      for (const unit of battle.targets) {
        if (unit.active && unit.faction === 'opposing') unit.hit('hull', 400, { source: 'player', kind: 'bomb', point: unit.position });
      }
      battle.step(STEP, distant);
    }
    assert.equal(battle.outcome, 'win');
    assert.equal(director.primary.state, 'completed');
    assert.equal(director.secondary.state, 'completed');
    if (key === 'protection') assert.ok(battle.transports.every((unit) => unit.arrived && unit.travel > 1500));
  }
});

test('destroyed friendly transports cause an actual CAS defeat and damage issues a warning', () => {
  const { battle, director } = prepare('protection');
  assert.equal(battle.outcome, '');
  for (const unit of battle.transports.slice(0, 2)) {
    unit.hit('hull', 500, { source: 'player', kind: 'bomb', point: unit.position });
    assert.equal(unit.active, false);
  }
  run(battle, .5);
  assert.equal(battle.outcome, 'loss');
  assert.equal(battle.losses.friendly, 2);
  assert.equal(director.incidents.size, 2);
  assert.equal(director.primary.state, 'failed');
  assert.ok(director.history.some(({ message }) => message.includes('lost to friendly fire')));
});

test('fine, medium and aggressive steering scale across aircraft and available airspeed', () => {
  function turn(profile, speed, targetDegrees, seconds, alternating = false) {
    const flight = new Flight(profile, range);
    flight.reset({ ...scenarios.air, y: 4200, pitch: .04, speed, throttle: .7 });
    let bank = 0, rudder = 0, slip = 0;
    const aim = new Vector3();
    for (let tick = 0; tick < seconds / STEP; tick++) {
      const angle = MathUtils.degToRad(targetDegrees) * (alternating && Math.floor(tick / 15) % 2 ? -1 : 1);
      aim.set(-Math.sin(angle), .04, Math.cos(angle)).normalize();
      flight.step({ ...neutralControls, assisted: true, pitchPriority: true, aimDirection: aim });
      const { forward, up, localVelocity } = flight;
      bank = Math.max(bank, Math.abs(Math.atan2((-forward.z * up.x + forward.x * up.z) / Math.hypot(forward.x, forward.z), up.y)));
      slip = Math.max(slip, Math.abs(Math.atan2(localVelocity.x, localVelocity.z)));
      rudder = Math.max(rudder, Math.abs(flight.instructor.rudder));
    }
    return { bank: MathUtils.radToDeg(bank), slip: MathUtils.radToDeg(slip), rudder, heading: flight.heading };
  }
  for (const aircraft of [f16, f15]) {
    for (const speed of [120, 192, 360]) {
      const fine = turn(aircraft, speed, 4, 4);
      const medium = turn(aircraft, speed, 20, 4);
      const full = turn(aircraft, speed, 90, 10);
      const oscillating = turn(aircraft, speed, 3.5, 5, true);
      assert.ok(fine.bank <= 13 && fine.rudder > .07 && fine.slip < 5 && fine.heading > 1.5);
      assert.ok(medium.bank >= 12 && medium.bank > fine.bank && medium.bank < 55, `${aircraft.id} ${speed}: medium bank ${medium.bank}`);
      assert.ok(full.bank >= 65 && Math.abs(full.heading - 90) < 11);
      assert.ok(oscillating.bank < 10 && oscillating.slip < 4);
    }
    assert.ok(turn(aircraft, 360, 4, 4).rudder < turn(aircraft, 192, 4, 4).rudder);
  }
});
