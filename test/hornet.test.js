import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Group, Mesh, Object3D, PerspectiveCamera } from 'three';
import { runwayPilot } from '../browser-tests/a10-pilot.js';
import { aircraftRegistry } from '../src/aircraft/registry.js';
import { hornet, hornetModel } from '../src/aircraft/hornet.js';
import { createHornetVisual, validateHornetModel } from '../src/aircraft/hornet-visual.js';
import { MouseAim } from '../src/aim.js';
import { CombatExercise, combatExercises } from '../src/sim/combat/exercise.js';
import { Radar } from '../src/sim/combat/radar.js';
import { WeaponRack } from '../src/sim/combat/weapons.js';
import { Dogfight } from '../src/sim/dogfight.js';
import { Flight, neutralControls, STEP } from '../src/sim/flight.js';
import { GroundBattle } from '../src/sim/ground/battlefield.js';
import { qualificationAirStatus, qualificationAssignment } from '../src/sim/hornet-qualification.js';
import { configurableStations, missionLoadout, resolveLoadout } from '../src/sim/loadouts.js';
import { range, scenarios } from '../src/sim/range.js';

test('Hornet is the fourth aircraft and its nine stations and presets are compatible', () => {
  assert.deepEqual(Object.keys(aircraftRegistry), ['f16c', 'f15c', 'a10c', 'fa18c']);
  assert.deepEqual(hornet.weaponDomains, ['air', 'ground']);
  assert.equal(configurableStations(hornet).length, 9);
  const presets = hornet.loadoutPresets;
  for (const [name, assignment] of Object.entries(presets)) {
    assert.deepEqual(resolveLoadout(hornet, assignment).errors, [], name);
  }
  assert.equal(resolveLoadout(hornet, presets.Clean).mass, 0);
  assert.ok(resolveLoadout(hornet, presets.Dogfight).drag < resolveLoadout(hornet, presets['Air Superiority']).drag);
  assert.ok(resolveLoadout(hornet, { HP_01: 'laser' }).errors.length);
  assert.ok(resolveLoadout(hornet, { HP_03: 'tank', HP_05: 'tank', HP_07: 'tank' }).errors.length);
  assert.equal(hornet.cannon.name, 'M61A2');
  assert.equal(hornet.loadouts.outnumbered.stations.length, 2);
  const saved = { HP_01: 'infrared', HP_02: 'bomb', HP_08: 'bomb' };
  assert.equal(qualificationAssignment(hornet, saved), saved);
  assert.equal(qualificationAssignment(hornet, presets.Clean), presets.Multirole);
});

test('Hornet takes off, retracts gear, deploys landing flaps, lands and brakes on the runway', () => {
  const flight = new Flight(hornet, range);
  flight.reset(scenarios.runway);
  const state = { phase: 'roll', retracted: false };
  for (let tick = 0; tick < 54 / STEP && !flight.failure; tick++) {
    flight.step(runwayPilot(flight, state, neutralControls));
    if (state.phase === 'stop' && flight.airspeed < 1) break;
  }
  assert.equal(flight.failure, '');
  assert.equal(state.phase, 'stop');
  assert.equal(state.retracted, true);
  assert.equal(flight.gear, 1);
  assert.equal(flight.flapIndex, 2);
  assert.ok(flight.surfaces.angles.Flap > 27);
  assert.ok(flight.grounded && flight.airspeed < 1);
  assert.ok(range.isRunway(flight.position.x, flight.position.z));
});

test('independent Hornet engines burn, lose thrust separately and permit a powerless glide', () => {
  const flight = new Flight(hornet, range);
  const command = { ...neutralControls, assisted: false };
  flight.reset({ ...scenarios.air, y: 2300, speed: 135, throttle: 1 });
  flight.toggleAfterburner();
  flight.step(command);
  assert.equal(flight.engines.states.every((engine) => engine.afterburner), true);
  const healthy = flight.thrust;
  const fuel = flight.fuel;
  flight.damage.hit('leftEngine', hornet.damageComponents.leftEngine.capacity);
  for (let tick = 0; tick < 90; tick++) flight.step(command);
  const [left, right] = flight.engines.states;
  assert.equal(left.afterburner, false);
  assert.equal(left.thrust, 0);
  assert.ok(right.afterburner && right.thrust > 0 && flight.thrust < healthy * .6);
  assert.ok(flight.engines.yawMoment > 0 && flight.fuel < fuel && !flight.failure);
  flight.damage.hit('rightEngine', hornet.damageComponents.rightEngine.capacity);
  for (let tick = 0; tick < 125; tick++) flight.step(command);
  assert.equal(flight.thrust, 0);
  assert.equal(flight.afterburner, false);
  assert.equal(flight.failure, '');
  assert.ok(flight.velocity.length() > 72);
});

test('turning Hornet responds to instructor scale and sheds energy at extreme alpha', () => {
  function correct(x, y) {
    const flight = new Flight(hornet, range);
    const aim = new MouseAim();
    const start = { ...scenarios.air, y: 2300, speed: 175, pitch: .03 };
    flight.reset(start);
    aim.align(0, start.pitch);
    aim.direction.set(x, y, 1).normalize();
    for (let tick = 0; tick < 120; tick++) flight.step({
      ...neutralControls, pitchPriority: true, aimDirection: aim.direction, aimHint: aim.turnHint,
    });
    return flight;
  }
  const fine = correct(.035, 0);
  const hard = correct(.88, 0);
  const dive = correct(0, -.19);
  assert.ok(fine.up.y > .98);
  assert.ok(hard.up.y < fine.up.y - .04);
  assert.ok(dive.up.y > .98 && dive.forward.y < 0);

  const fast = new Flight(hornet, range);
  const stalled = new Flight(hornet, range);
  for (const [pitch, flight] of [[.07, fast], [.48, stalled]]) {
    flight.reset({ ...scenarios.air, y: 2300, speed: 123, pitch, throttle: .38 });
    flight.step({ ...neutralControls, assisted: false });
  }
  assert.equal(stalled.stalled, true);
  assert.ok(stalled.velocity.length() < fast.velocity.length());
});

test('mounted Hornet stores feed the shared rack, with less mass and asymmetric moment after release', () => {
  const flight = new Flight(hornet, range);
  flight.reset(scenarios.air);
  const rack = new WeaponRack(flight, new Radar(range, flight), range);
  const assignment = { HP_03: 'bomb', HP_07: 'bomb', HP_04: 'pod', HP_05: 'tank' };
  rack.reset(missionLoadout(hornet, assignment, 'cas'), 'bomb');
  const mass = flight.payloadMass;
  const drag = flight.payloadDrag;
  const moment = flight.payloadMoment;
  assert.equal(rack.station('pod').name, 'HP_04');
  assert.ok(flight.externalCapacity > 600);
  const left = rack.station('bomb');
  assert.equal(left.name, 'HP_03');
  rack.consume(left);
  assert.equal(rack.count('bomb'), 1);
  assert.equal(rack.station('bomb').name, 'HP_07');
  assert.ok(flight.payloadMass < mass && flight.payloadDrag < drag && flight.payloadMoment < moment);
});

function assetScene(file) {
  const data = readFileSync(new URL('../tools/aircraft-viewer/public/fa-18-hornet/' + file, import.meta.url));
  const glb = JSON.parse(data.toString('utf8', 20, 20 + data.readUInt32LE(12)));
  const nodes = glb.nodes.map(({ name, translation, rotation, extras, mesh }) => {
    const node = new Object3D();
    node.name = name;
    node.userData = extras ?? {};
    if (translation) node.position.fromArray(translation);
    if (rotation) node.quaternion.fromArray(rotation);
    if (mesh !== undefined) {
      for (const primitive of glb.meshes[mesh].primitives) {
        const draw = new Mesh();
        draw.geometry.index = { count: glb.accessors[primitive.indices].count };
        node.add(draw);
      }
    }
    return node;
  });
  for (const [index, { children }] of glb.nodes.entries()) if (children) nodes[index].add(...children.map((id) => nodes[id]));
  return new Group().add(...glb.scenes[glb.scene].nodes.map((id) => nodes[id]));
}

test('Hornet rig shares the modeled sockets, flight poses, damage and aligned LOD transitions', () => {
  const templates = hornetModel.levels.map(({ file }) => assetScene(file));
  for (const [index, template] of templates.entries()) validateHornetModel(template, index);
  const exhaust = new Group();
  for (const name of ['dry-glow', 'burner-plume']) {
    const node = new Group();
    node.name = name;
    exhaust.add(node);
  }
  const visual = createHornetVisual({ templates, exhaust });
  const opponent = createHornetVisual({ templates, exhaust });
  assert.deepEqual(visual.muzzle.position.toArray(), hornet.cannon.muzzle);
  const flight = new Flight(hornet, range);
  flight.reset({ ...scenarios.air, y: 1300, throttle: 1 });
  flight.toggleAfterburner();
  flight.step({ ...neutralControls, assisted: false });
  Object.assign(flight.surfaces.angles, {
    LeftFlaperon: 12, RightFlaperon: -10, LeftStabilator: 5, RightStabilator: -3,
    LeftRudder: 8, RightRudder: 9, LeftLEF: 5, RightLEF: 6, Flap: 17,
  });
  visual.update(flight, 0);
  const near = visual.airframe.levels[0].object;
  for (const part of ['Aileron_Left', 'Aileron_Right', 'Elevator_Left', 'Elevator_Right', 'Rudder_Left', 'Rudder_Right',
    'LeadingEdge_Left', 'LeadingEdge_Right', 'Flap_Left', 'Flap_Right', 'LandingGear_Nose']) {
    assert.notDeepEqual(near.getObjectByName(part).quaternion.toArray(), templates[0].getObjectByName(part).quaternion.toArray(), part);
  }
  assert.ok(visual.root.getObjectByName('leftEngine exhaust effects').getObjectByName('burner-plume').visible);
  const camera = new PerspectiveCamera();
  camera.position.z = 250;
  camera.updateMatrixWorld();
  visual.airframe.update(camera);
  const middle = visual.airframe.levels[1].object;
  assert.equal(visual.airframe.getCurrentLevel(), 1);
  assert.ok(middle.getObjectByName('Aileron_Left').quaternion.angleTo(near.getObjectByName('Aileron_Left').quaternion) < 1e-6);
  assert.notEqual(opponent.airframe.levels[1].object.getObjectByName('Wing_Left'), middle.getObjectByName('Wing_Left'));
  flight.damage.hit('leftEngine', hornet.damageComponents.leftEngine.capacity);
  flight.step({ ...neutralControls, assisted: false });
  flight.damage.hit('leftRudder', hornet.damageComponents.leftRudder.capacity);
  assert.equal(flight.damage.yawAuthority, .5);
  visual.update(flight, 0);
  assert.equal(middle.getObjectByName('Rudder_Left').visible, false);
  assert.equal(middle.getObjectByName('Rudder_Right').visible, true);
  assert.equal(visual.root.getObjectByName('leftEngine exhaust effects').visible, false);
  assert.equal(visual.root.getObjectByName('rightEngine exhaust effects').visible, true);
});

test('the Hornet qualification starts airborne opposition safely and requires credited air and ground hits', () => {
  const flight = new Flight(hornet, range);
  flight.reset(scenarios.hornetQualification);
  const enemy = new Dogfight(flight, aircraftRegistry.f16c.spec, range, { shot() {}, impact() {} });
  const setup = combatExercises.hornetQualification;
  enemy.reset(setup.opponentMode, scenarios.hornetQualification, setup.opponent);
  const combat = new CombatExercise(enemy, range);
  combat.reset('hornetQualification');
  assert.equal(flight.grounded, true);
  assert.equal(enemy.opponent.grounded, false);
  assert.ok(enemy.opponent.position.y > 900);
  assert.equal(qualificationAirStatus(combat), null);
  enemy.opponentHull.hit('fuselage', 200);
  assert.match(qualificationAirStatus(combat).reason, /before you scored a hit/);
  combat.cannonHits = 1;
  assert.deepEqual(qualificationAirStatus(combat), { cleared: true });
  for (const friendlyHit of [false, true]) {
    const battle = new GroundBattle(range);
    battle.reset('hornetQualification');
    if (friendlyHit) battle.targets.find(({ faction }) => faction === 'friendly').hit('hull', 4, { source: 'player' });
    for (const target of battle.qualificationTargets) target.hit('hull', 500, { source: 'player', kind: 'bomb' });
    battle.step(STEP);
    assert.equal(battle.outcome, friendlyHit ? 'loss' : 'win');
  }
});
