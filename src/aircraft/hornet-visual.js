import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { cannonMount } from '../sim/cannon.js';
import { bindImportedHinge, importedGearAngle, setImportedHinge } from './imported-rig.js';
import { hornet, hornetModel } from './hornet.js';

const { clamp, lerp } = T.MathUtils;
const urls = [
  new URL('../../tools/aircraft-viewer/public/fa-18-hornet/lod0.glb', import.meta.url).href,
  new URL('../../tools/aircraft-viewer/public/fa-18-hornet/lod1.glb', import.meta.url).href,
  new URL('../../tools/aircraft-viewer/public/fa-18-hornet/lod2.glb', import.meta.url).href,
];
const sides = ['Left', 'Right'];
const parts = Object.fromEntries(sides.flatMap((side) => [
  ['Rudder_' + side, [side.toLowerCase() + 'Rudder', side.toLowerCase() + 'Fin']],
  ['Aileron_' + side, [side.toLowerCase() + 'Flaperon', side.toLowerCase() + 'Wing']],
]));
const surfaceBindings = Object.fromEntries(sides.flatMap((side) => [
  ['Aileron_' + side, [side + 'Flaperon', 1]],
  ['Elevator_' + side, [side + 'Stabilator', 1]],
  ['Rudder_' + side, [side + 'Rudder', 1]],
  ['LeadingEdge_' + side, [side + 'LEF', 1]],
  ['Flap_' + side, ['Flap', -1]],
]));
let loading;

export async function loadHornetVisual() {
  loading ??= loadTemplates().catch((error) => { loading = null; throw error; });
  const assets = await loading;
  return { hasLOD: true, create: () => createHornetVisual(assets), clone: () => createHornetVisual(assets) };
}

async function loadTemplates() {
  const loader = new GLTFLoader();
  const templates = await Promise.all(urls.map(async (url, index) => {
    const { scene } = await loader.loadAsync(url);
    validateHornetModel(scene, index);
    scene.traverse((node) => {
      if (node.isMesh) {
        for (const material of [node.material].flat()) if (material.transparent) material.forceSinglePass = true;
      }
    });
    return scene;
  }));
  return { templates, exhaust: exhaustTemplate() };
}

export function validateHornetModel(scene, level) {
  const root = scene.getObjectByName(hornetModel.root);
  if (root?.userData.aircraftImportVersion !== 1) throw new Error('Hornet import root is missing');
  root.updateWorldMatrix(true, true);
  const actual = new T.Vector3();
  const expected = new T.Vector3();
  for (const { name, position, direction } of hornetModel.attachments) {
    const socket = root.getObjectByName(name);
    if (!socket || socket.getWorldPosition(actual).distanceTo(expected.fromArray(position)) > .002
        || actual.set(0, 0, 1).transformDirection(socket.matrixWorld).distanceTo(expected.fromArray(direction)) > .002) {
      throw new Error('Hornet socket is missing or misaligned at ' + name);
    }
  }
  for (const name of [...Object.keys(surfaceBindings), 'LandingGear_Left', 'LandingGear_Right', 'LandingGear_Nose',
    'GearDoor_Main_Left', 'GearDoor_Main_Right', 'GearDoor_Nose_Left', 'GearDoor_Nose_Right', 'GearDoor_Nose_Aft', 'GearBrace_Nose']) {
    const pivot = root.getObjectByName(name);
    if (!pivot?.userData.aircraftAnimation || !pivot.children.length) throw new Error('Hornet rig is missing ' + name);
  }
  let triangles = 0;
  root.traverse((node) => {
    if (node.isMesh) triangles += (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3;
  });
  if (triangles !== hornetModel.levels[level].triangles) throw new Error('Wrong Hornet LOD geometry');
}

function exhaustTemplate() {
  const root = new T.Group();
  const glow = new T.Mesh(new T.CircleGeometry(.34, 12), new T.MeshBasicMaterial({
    color: 0xf7925e, transparent: true, opacity: .32, depthWrite: false, side: T.DoubleSide, toneMapped: false,
  }));
  glow.name = 'dry-glow';
  glow.position.z = -.035;
  root.add(glow);
  const plume = new T.Group();
  plume.name = 'burner-plume';
  for (const [radius, length, color, opacity] of [[.42, 2.4, 0xff8649, .31], [.24, 1.42, 0x9db5ff, .65]]) {
    const geometry = new T.ConeGeometry(radius, length, 12, 1, true).rotateX(Math.PI / 2);
    const flare = new T.Mesh(geometry, new T.MeshBasicMaterial({
      color, transparent: true, opacity, blending: T.AdditiveBlending, depthWrite: false, toneMapped: false,
    }));
    flare.position.z = length / 2;
    plume.add(flare);
  }
  root.add(plume);
  root.visible = false;
  return root;
}

export function createHornetVisual({ templates, exhaust }) {
  const root = new T.Group();
  root.name = 'F/A-18C airframe';
  root.userData.reflectiveMaterial = true;
  const airframe = new T.LOD();
  const rigs = templates.map((template, index) => {
    const scene = template.clone(true);
    const imported = scene.getObjectByName(hornetModel.root);
    const hinges = imported.children.filter((node) => node.userData.aircraftAnimation).map(bindImportedHinge);
    const damageParts = imported.children.filter((node) => node.userData.damageComponent)
      .map((node) => {
        const [component, support] = parts[node.name] ?? [node.userData.damageComponent];
        return { node, component, support };
      });
    airframe.addLevel(scene, hornetModel.levels[index].distance, .11);
    scene.visible = index === 0;
    return { hinges, damageParts };
  });
  const arm = new T.Group();
  const muzzle = cannonMount(hornet.cannon);
  const engines = hornet.engines.map(({ exhaust: position, component }) => {
    const jet = exhaust.clone(true);
    jet.name = component + ' exhaust effects';
    jet.position.fromArray(position);
    jet.rotateY(Math.PI);
    root.add(jet);
    return { jet, glow: jet.getObjectByName('dry-glow'), plume: jet.getObjectByName('burner-plume') };
  });
  root.add(airframe, arm, muzzle);
  let flight;
  let blend = 1;
  const interpolate = (name) => lerp(flight.surfaces.previous[name], flight.surfaces.angles[name], blend);

  function pose({ hinges, damageParts }) {
    const retraction = clamp(1 - lerp(flight.previousGear, flight.gear, blend), 0, 1);
    for (const { node, component, support } of damageParts) {
      node.visible = flight.damage.condition(component) > 0 && (!support || flight.damage.condition(support) > 0);
    }
    for (const hinge of hinges) {
      const pair = surfaceBindings[hinge.node.name];
      const angle = pair ? interpolate(pair[0]) * pair[1] : importedGearAngle(hinge.animation, retraction);
      setImportedHinge(hinge, angle);
    }
  }

  function effects(level) {
    for (const [index, { jet, glow, plume }] of engines.entries()) {
      const engine = flight.engines.states[index];
      jet.visible = engine.thrust > 0 && !flight.failure && level < 2;
      glow.visible = jet.visible && engine.spool > .29;
      glow.scale.setScalar(.56 + .40 * engine.spool * engine.power);
      plume.visible = jet.visible && engine.afterburner;
      plume.scale.set(.84 + .16 * engine.power, .84 + .16 * engine.power,
        (.65 + engine.power * .35) * (1 + .1 * Math.sin(flight.elapsed * 37 + index)));
    }
  }

  const chooseLevel = airframe.update.bind(airframe);
  airframe.update = (camera) => {
    const prior = airframe.getCurrentLevel();
    chooseLevel(camera);
    const active = airframe.getCurrentLevel();
    if (flight && active !== prior) {
      pose(rigs[active]);
      effects(active);
    }
  };
  return {
    root, airframe, arm, muzzle, paint: [],
    update(state, _time, interpolation = 1) {
      flight = state;
      blend = interpolation;
      const active = airframe.getCurrentLevel();
      pose(rigs[active]);
      effects(active);
      arm.visible = flight.stores;
    },
  };
}
