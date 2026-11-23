import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { cannonMount } from '../sim/cannon.js';
import { configurableStations } from '../sim/loadouts.js';
import { a10 } from './a10.js';

const { clamp, degToRad, lerp } = T.MathUtils;
const sides = ['Left', 'Right'];
const paired = ['Aileron', 'Elevator', 'Rudder', 'Flap', 'EngineFan', 'LandingGear', 'Wheel', 'Wing', 'VerticalTail', 'HorizontalTail'];
const rigNames = [...sides.flatMap((side) => [
  ...paired.map((part) => part + '_' + side),
  'Deceleron_' + side + '_Upper', 'Deceleron_' + side + '_Lower',
  'GearDoor_Main_' + side, 'GearDoor_Nose_' + side,
]), 'A10C_ROOT', 'Canopy', 'LandingGear_Nose', 'Wheel_Nose', 'GAU8_Barrels'];
const levels = [
  ['A10C.glb', 0], ['A10C_LOD1.glb', 350], ['A10C_LOD2.glb', 1150],
];
const mounts = [...configurableStations(a10).map(({ name, offset }) => [name, offset]), ['HP_GAU8_Muzzle', a10.cannon.muzzle]];
const correction = new T.Matrix4().makeRotationY(Math.PI);
const fullTurn = Math.PI * 2;
let loading;

export async function loadA10Visual() {
  loading ??= loadTemplates().catch((error) => { loading = null; throw error; });
  const templates = await loading;
  return { hasLOD: true, create: () => createVisual(templates), clone: (_source, hostile) => createVisual(templates, hostile) };
}

async function loadTemplates() {
  const loader = new GLTFLoader();
  return Promise.all(levels.map(async ([file, distance]) => {
    const { scene } = await loader.loadAsync(import.meta.env.BASE_URL + 'assets/' + file);
    validateA10Rig(scene);
    return { scene, distance };
  }));
}

export function validateA10Rig(scene) {
  scene.updateMatrixWorld(true);
  for (const name of rigNames) {
    if (!scene.getObjectByName(name)) throw new Error('A-10C rig missing ' + name);
  }
  const actual = new T.Vector3();
  const expected = new T.Vector3();
  const forward = new T.Vector3();
  for (const [name, offset] of mounts) {
    const anchor = scene.getObjectByName(name);
    if (!anchor) throw new Error('A-10C mount missing ' + name);
    anchor.getWorldPosition(actual).applyMatrix4(correction);
    forward.set(0, 0, -1).transformDirection(anchor.matrixWorld).transformDirection(correction);
    if (actual.distanceTo(expected.fromArray(offset)) > .002 || forward.z < .999) {
      throw new Error('A-10C mount is misaligned at ' + name);
    }
  }
}

export function createVisual(templates, hostile = false) {
  const root = new T.Group();
  root.name = hostile ? 'A-10C opponent' : 'A-10C visual';
  const airframe = new T.LOD();
  const rigs = templates.map(({ scene, distance }) => {
    const mesh = scene.clone(true);
    mesh.rotation.y += Math.PI;
    mesh.visible = distance === 0;
    airframe.addLevel(mesh, distance, .12);
    return Object.fromEntries(rigNames.map((name) => [name, mesh.getObjectByName(name)]));
  });
  root.add(airframe);
  const arm = new T.Group();
  arm.name = 'External stores';
  const muzzle = cannonMount(a10.cannon);
  root.add(arm, muzzle);

  let state, blend, previousTime, previousShots = 0, barrelTarget = 0, barrels = 0, canopy = 0;
  const fans = [0, 0];
  const wheels = [0, 0];
  const surface = (name) => lerp(state.surfaces.previous[name], state.surfaces.angles[name], blend);
  const angle = (node, degrees) => {
    const { axis, min, max } = node.userData.anim;
    node.rotation[axis] = degToRad(clamp(degrees, min, max));
  };
  function pose(rig) {
    const retraction = 1 - lerp(state.previousGear, state.gear, blend);
    const door = clamp((1 - retraction) * 1.6, 0, 1);
    const brake = surface('SpeedBrake');
    for (const [index, side] of sides.entries()) {
      const prefix = side.toLowerCase();
      const wing = state.damage.condition(prefix + 'Wing') > 0;
      const tail = state.damage.condition(prefix + 'Stabilator') > 0;
      const fin = state.damage.condition(prefix + 'Fin') > 0;
      const gear = rig['LandingGear_' + side];
      rig['Wing_' + side].visible = rig['Flap_' + side].visible = wing;
      rig['Aileron_' + side].visible = wing && state.damage.condition(prefix + 'Flaperon') > 0;
      rig['HorizontalTail_' + side].visible = rig['Elevator_' + side].visible = tail;
      rig['VerticalTail_' + side].visible = rig['Rudder_' + side].visible = fin;
      gear.visible = state.damage.condition(prefix + 'Gear') > 0;
      angle(rig['Aileron_' + side], surface(side + 'Flaperon'));
      angle(rig['Elevator_' + side], -surface(side + 'Stabilator'));
      angle(rig['Rudder_' + side], -surface('Rudder'));
      angle(rig['Flap_' + side], surface('Flap'));
      angle(rig['Deceleron_' + side + '_Upper'], -brake);
      angle(rig['Deceleron_' + side + '_Lower'], brake);
      angle(gear, 86 * retraction);
      const doorAngle = (side === 'Left' ? -80 : 80) * door;
      angle(rig['GearDoor_Main_' + side], doorAngle);
      angle(rig['GearDoor_Nose_' + side], doorAngle);
      rig['EngineFan_' + side].rotation.z = fans[index];
      rig['Wheel_' + side].rotation.x = wheels[0];
    }
    rig.LandingGear_Nose.visible = state.damage.condition('noseGear') > 0;
    angle(rig.LandingGear_Nose, -90 * retraction);
    rig.Wheel_Nose.rotation.x = wheels[1];
    rig.GAU8_Barrels.rotation.z = barrels;
    angle(rig.Canopy, canopy);
  }
  const selectLevel = airframe.update.bind(airframe);
  airframe.update = (camera) => {
    const previous = airframe.getCurrentLevel();
    selectLevel(camera);
    const active = airframe.getCurrentLevel();
    if (state && previous !== active) pose(rigs[active]);
  };
  return { root, airframe, arm, muzzle, paint: [],
    update(flight, _time, interpolation = 1, cannon) {
      state = flight;
      blend = interpolation;
      const dt = clamp(flight.elapsed - (previousTime ?? flight.elapsed), 0, .12);
      const shots = cannon?.fired ?? 0;
      if (flight.elapsed < previousTime || shots < previousShots) {
        fans.fill(0);
        wheels.fill(0);
        barrelTarget = barrels = previousShots = 0;
      }
      previousTime = flight.elapsed;
      for (const [index, engine] of flight.engines.states.entries()) fans[index] = (fans[index] + engine.spool * dt * 85) % fullTurn;
      if (flight.grounded) {
        const travel = Math.hypot(flight.velocity.x, flight.velocity.z) * dt;
        wheels[0] = (wheels[0] - travel / .45) % fullTurn;
        wheels[1] = (wheels[1] - travel / .30) % fullTurn;
      }
      barrelTarget += (shots - previousShots) * (fullTurn / 7);
      previousShots = shots;
      barrels = lerp(barrels, barrelTarget, dt ? 1 - Math.exp(-32 * dt) : 0);
      const parked = flight.grounded && flight.airspeed < 3 && flight.throttle < .17;
      canopy = lerp(canopy, parked ? 28 : 0, 1 - Math.exp(-3 * dt));
      pose(rigs[airframe.getCurrentLevel()]);
      arm.visible = flight.stores;
    },
  };
}
