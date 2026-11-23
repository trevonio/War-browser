import test from 'node:test';
import { readFileSync } from 'node:fs';
import { Group, Object3D, PerspectiveCamera, Vector3 } from 'three';
import { lineUpGunPass, runwayPilot } from '../browser-tests/a10-pilot.js';
import { createVisual, validateA10Rig } from '../src/aircraft/a10-visual.js';
import { MouseAim } from '../src/aim.js';
import { Ballistics } from '../src/sim/ballistics.js';
import { Cannon, cannonMount } from '../src/sim/cannon.js';
import { Radar } from '../src/sim/combat/radar.js';
import { WeaponRack } from '../src/sim/combat/weapons.js';
import assert from 'node:assert/strict';
import { a10 } from '../src/aircraft/a10.js';
import { aircraftRegistry } from '../src/aircraft/registry.js';
import { Flight, neutralControls, STEP } from '../src/sim/flight.js';
import { range, scenarios } from '../src/sim/range.js';
import { availablePresets, configurableStations, missionLoadout, resolveLoadout } from '../src/sim/loadouts.js';
import { GroundBattle } from '../src/sim/ground/battlefield.js';

test('A-10C is registered as a third playable aircraft with an unguided CAS configuration', () => {
  assert.equal(Object.keys(aircraftRegistry)[2], 'a10c');
  assert.equal(a10.engines.length,2);
  assert.equal(a10.afterburnerThrust,0);
  assert.deepEqual(a10.weaponDomains,['air','ground']);
  assert.equal(configurableStations(a10).length,11);
  assert.equal(a10.cannon.name,'GAU-8/A');
  assert.equal(a10.cannon.capacity,1174);
  assert.ok(a10.cannon.rpm < aircraftRegistry.f16c.spec.cannon.rpm);
});

test('A-10C four CAS presets are physically valid', () => {
  const presets=availablePresets(a10);
  for(const name of ['Gun Run','Mixed CAS','Precision Support','Clean']) {
    assert.ok(presets[name],name);
    assert.deepEqual(resolveLoadout(a10,presets[name]).errors,[],name);
  }
  assert.equal(resolveLoadout(a10,presets.Clean).stations.length,0);
  assert.ok(resolveLoadout(a10,presets['Mixed CAS']).mass > 0);
  assert.ok(presets['Precision Support'].HP_06==='pod');
  assert.ok(resolveLoadout(a10,{HP_01:'bomb'}).errors.length>0);
});

test('A-10C shares flight mechanics but cannot arm afterburner', () => {
  const flight=new Flight(a10,range);
  flight.reset(scenarios.runway);
  assert.equal(flight.grounded,true);
  assert.ok(Math.abs(flight.position.y-range.heightAt(flight.position.x,flight.position.z)-a10.gearClearance)<.01);
  flight.toggleAfterburner();
  assert.equal(flight.burnerArmed,false);
  assert.equal(flight.engines.states.length,2);
  for(let i=0;i<90;i++)flight.step(neutralControls,STEP);
  assert.equal(flight.afterburner,false);
});

test('A-10C engine damage reduces thrust asymmetrically without instantly losing aircraft', () => {
  for(const [engineIndex,component] of ['leftEngine','rightEngine'].entries()) {
    const flight=new Flight(a10,range);
    flight.reset({...scenarios.air,y:2100,speed:135,throttle:1});
    flight.damage.hit(component,a10.damageComponents[component].capacity);
    for(let i=0;i<150;i++)flight.step({...neutralControls,assisted:false},STEP);
    assert.equal(flight.engines.states[engineIndex].thrust,0);
    assert.ok(flight.engines.states[1-engineIndex].thrust>1000);
    assert.notEqual(flight.engines.yawMoment,0);
    assert.equal(flight.failure,'');
  }
});

test('A-10C qualification has static/moving targets and protected identification friendlies', () => {
  const battle=new GroundBattle(range);
  battle.reset('qualification','regular');
  assert.equal(battle.targets.filter(v=>v.objective==='qualify').length,4);
  assert.equal(battle.targets.filter(v=>v.faction==='friendly').length,2);
  assert.equal(battle.targets.filter(v=>v.objective==='qualify'&&v.route.length===0).length,2);
  assert.equal(battle.targets.filter(v=>v.objective==='qualify'&&v.route.length>0).length,2);
  for(let i=0;i<120;i++)battle.step(STEP);
  assert.ok(battle.targets.filter(v=>v.faction==='friendly').every(v=>v.active));
  for(const target of battle.targets.filter(v=>v.objective==='qualify')) {
    target.hit('hull',999,{source:'player',kind:'rocket'});
  }
  battle.step(STEP);
  assert.equal(battle.outcome,'win');
  assert.equal(battle.losses.friendly,0);
});

test('a clean A-10C lifts off, cycles its gear and flaps, lands and brakes on the actual runway', () => {
  const flight = new Flight(a10, range);
  flight.reset(scenarios.runway);
  const state = { phase: 'roll', retracted: false };
  for (let tick = 0; tick < 55 / STEP && !flight.failure; tick++) {
    flight.step(runwayPilot(flight, state, neutralControls));
    if (state.phase === 'stop' && flight.airspeed < 1) break;
  }
  assert.equal(flight.failure, '');
  assert.equal(state.phase, 'stop');
  assert.equal(state.retracted, true);
  assert.equal(flight.gear, 1);
  assert.equal(flight.flapIndex, 2);
  assert.ok(flight.surfaces.angles.Flap > 39);
  assert.equal(flight.grounded, true);
  assert.ok(flight.airspeed < 1);
  assert.ok(range.isRunway(flight.position.x, flight.position.z));
});

test('mounted stores add drag and mass and a single-side release changes the signed roll bias', () => {
  const initial = { ...scenarios.air, y: 1500, speed: 140, pitch: .055, throttle: .55 };
  const flight = new Flight(a10, range);
  flight.reset(initial);
  const rack = new WeaponRack(flight, new Radar(range, flight), range);
  rack.reset(missionLoadout(a10, availablePresets(a10)['Mixed CAS'], 'cas'), 'bomb');
  const mass = flight.payloadMass;
  const drag = flight.payloadDrag;
  assert.ok(mass > 700 && drag > 0);
  assert.equal(flight.payloadMoment, 0);
  const left = rack.station('bomb');
  assert.equal(left.name, 'HP_03');
  rack.consume(left);
  assert.ok(flight.payloadMass < mass && flight.payloadDrag < drag);
  assert.ok(flight.payloadMoment < 0);
  for (let tick = 0; tick < 100; tick++) flight.step({ ...neutralControls, assisted: false });
  assert.ok(flight.rates.z > .012 && flight.rates.z < .15);
  assert.equal(rack.station('bomb').name, 'HP_09');
  rack.consume(rack.station('bomb'));
  assert.ok(Math.abs(flight.payloadMoment) < 1e-9);
  assert.equal(rack.station('bomb'), undefined);
});

test('independent gear, control damage and both-engine loss affect the shared flight mechanics', () => {
  const approach = { x: 0, y: 26.22, z: -2000, speed: 65, pitch: .09, throttle: 0, runway: false };
  const flight = new Flight(a10, range);
  flight.reset(approach);
  flight.gearDown = true;
  flight.gear = 1;
  flight.velocity.y = -3;
  flight.damage.hit('noseGear', 12);
  for (let tick = 0; tick < 30 && !flight.failure; tick++) flight.step(neutralControls);
  assert.equal(flight.failure, 'Ground impact');

  flight.reset({ ...scenarios.air, y: 1400, speed: 122, throttle: .8 });
  const rollAuthority = flight.damage.rollAuthority;
  flight.damage.hit('leftFlaperon', 13);
  assert.ok(flight.damage.rollAuthority < rollAuthority);
  flight.damage.hit('rightFin', 14);
  assert.ok(flight.damage.yawAuthority < .75);
  flight.damage.hit('leftEngine', 28);
  flight.damage.hit('rightEngine', 28);
  for (let tick = 0; tick < 120; tick++) flight.step({ ...neutralControls, assisted: false });
  assert.equal(flight.thrust, 0);
  assert.equal(flight.failure, '');
  assert.ok(flight.velocity.length() > 90);
});

function readRig(file) {
  const data = readFileSync(new URL('../public/assets/' + file, import.meta.url));
  const glb = JSON.parse(data.toString('utf8', 20, 20 + data.readUInt32LE(12)));
  const nodes = glb.nodes.map(({ name, translation, rotation, scale, extras }) => {
    const node = new Object3D();
    node.name = name;
    if (translation) node.position.fromArray(translation);
    if (rotation) node.quaternion.fromArray(rotation);
    if (scale) node.scale.fromArray(scale);
    node.userData = extras ?? {};
    return node;
  });
  for (const [i, node] of glb.nodes.entries()) for (const child of node.children ?? []) nodes[i].add(nodes[child]);
  return new Group().add(...glb.scenes[glb.scene].nodes.map((i) => nodes[i]));
}

test('the supplied model and both LODs align all hardpoints and keep the same pose after switching', () => {
  const templates = ['A10C.glb', 'A10C_LOD1.glb', 'A10C_LOD2.glb'].map((file, index) => ({
    scene: readRig(file), distance: [0, 350, 1150][index],
  }));
  for (const { scene } of templates) validateA10Rig(scene);
  const visual = createVisual(templates);
  const flight = new Flight(a10, range);
  flight.reset(scenarios.air);
  const controls = { ...neutralControls, assisted: false, roll: .5, pitch: .3, yaw: .25, brakes: true };
  const camera = new PerspectiveCamera();
  for (let tick = 0; tick < 100; tick++) {
    flight.step(controls);
    visual.update(flight, flight.elapsed, 1, { fired: tick >= 90 ? 14 : 0 });
  }
  const detailed = visual.airframe.levels[0].object;
  const pivot = detailed.getObjectByName('Aileron_Left_Pivot');
  const original = templates[0].scene.getObjectByName(pivot.name);
  assert.ok(pivot.quaternion.angleTo(original.quaternion) < 1e-7);
  assert.ok(detailed.getObjectByName('Aileron_Left').rotation.x > 0);
  assert.ok(detailed.getObjectByName('Aileron_Right').rotation.x < 0);
  assert.ok(detailed.getObjectByName('Elevator_Left').rotation.x < 0);
  assert.ok(detailed.getObjectByName('Rudder_Left').rotation.y > 0);
  assert.ok(detailed.getObjectByName('Deceleron_Left_Upper').rotation.x < 0);
  assert.ok(detailed.getObjectByName('GAU8_Barrels').rotation.z > 0);
  const before = detailed.getObjectByName('Aileron_Left').rotation.x;
  camera.position.z = 1600;
  camera.updateMatrixWorld(true);
  visual.root.updateMatrixWorld(true);
  visual.airframe.update(camera);
  assert.equal(visual.airframe.getCurrentLevel(), 2);
  assert.equal(visual.airframe.levels[2].object.getObjectByName('Aileron_Left').rotation.x, before);
  assert.equal(visual.muzzle.position.z, a10.cannon.muzzle[2]);
  const clone = createVisual(templates, true);
  assert.ok(Math.abs(clone.airframe.levels[0].object.getObjectByName('Aileron_Left').rotation.x) < 1e-7);
});

test('friendly-fire penalty invalidates qualification and its timer can expire', () => {
  const battle = new GroundBattle(range);
  battle.reset('qualification', 'regular');
  battle.targets.find((unit) => unit.faction === 'friendly').hit('hull', 20, { kind: 'rocket', source: 'player' });
  for (const target of battle.qualificationTargets) target.hit('hull', 999, { kind: 'rocket', source: 'player' });
  battle.step(STEP);
  assert.equal(battle.playerDisabled.size, 4);
  assert.equal(battle.qualificationDamaged, 4);
  assert.equal(battle.outcome, 'loss');
  assert.match(battle.reason, /friendly-fire penalty/i);
  battle.reset('qualification', 'regular');
  battle.time = battle.mission.timeLimit;
  battle.step(STEP);
  assert.equal(battle.outcome, 'loss');
  assert.match(battle.reason, /expired/i);
});

test('mouse aim drives fine rudder corrections, deliberate banking and upright downward pitch', () => {
  function measure(dx, dy) {
    const flight = new Flight(a10, range);
    flight.reset({ ...scenarios.air, y: 2100, speed: 148, pitch: .05, throttle: .74 });
    const aim = new MouseAim();
    aim.move(dx, dy, 1, false);
    const control = { ...neutralControls, pitchPriority: true, aimDirection: aim.direction, aimHint: aim.turnHint };
    let bank = 0;
    let rudder = 0;
    for (let tick = 0; tick < 4 / STEP; tick++) {
      flight.step(control);
      const level = flight.up.y / Math.sqrt(1 - flight.forward.y ** 2);
      bank = Math.max(bank, Math.acos(Math.max(-1, Math.min(1, level))));
      rudder = Math.max(rudder, Math.abs(flight.surfaces.angles.Rudder));
    }
    assert.equal(flight.failure, '');
    return { flight, bank, rudder };
  }
  const fine = measure(45, 0);
  assert.ok(fine.rudder > 2 && fine.bank < .22);
  assert.ok(fine.flight.heading > 1 && fine.flight.heading < 6);
  const medium = measure(420, 0);
  const hard = measure(1250, 0);
  assert.ok(medium.bank > fine.bank && medium.bank < 1.25);
  assert.ok(hard.bank > medium.bank && hard.flight.heading > 60);
  const down = measure(14, 220);
  assert.ok(down.bank < .18 && down.flight.velocity.y < -15);
});

test('GAU-8 rounds use the mounted muzzle, damage real qualification components and score a clean result', () => {
  const flight = new Flight(a10, range);
  flight.reset(scenarios.air);
  const battle = new GroundBattle(range);
  battle.reset('qualification', 'regular');
  const forward = new Vector3(0, 0, 1);
  const aim = new Vector3();
  const path = new Vector3();
  const rounds = new Ballistics(a10.cannon, range, (_surface, point, hit) => {
    hit?.damageTarget?.hit(hit.component, a10.cannon.damage, { source: 'player', kind: 'cannon', point });
  });
  const cannon = new Cannon(a10.cannon, cannonMount(a10.cannon), rounds, () => {});
  for (let tick = 0; tick < 20 / STEP; tick++) battle.step(STEP);
  const moving = battle.qualificationTargets.find(({ route }) => route.length);
  assert.notEqual(moving.position.z, -2650);
  for (const target of battle.qualificationTargets) {
    for (let tick = 0; tick < 2 / STEP && !target.disabled; tick++) {
      lineUpGunPass(flight, target, forward, aim, path);
      flight.step(neutralControls);
      battle.step(STEP, flight.position);
      cannon.step(STEP, true, flight);
      rounds.step(STEP, battle.queryPlayer);
    }
    assert.equal(target.disabled, true, target.id);
    assert.ok(target.health.condition('engine') < .1);
  }
  battle.step(STEP);
  assert.equal(battle.outcome, 'win');
  assert.equal(battle.friendlyFire, 0);
  assert.equal(battle.qualificationDamaged, 4);
  assert.ok(cannon.fired > 50 && battle.cannonHits > 0 && battle.cannonHits <= cannon.fired);
  assert.equal(cannon.ammo, a10.cannon.capacity - cannon.fired);
});
