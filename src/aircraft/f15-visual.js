import * as T from 'three';
import { cannonMount } from '../sim/cannon.js';
import { f15 } from './f15.js';
import { missileVisuals } from './missile-visual.js';

const { degToRad, lerp } = T.MathUtils;
const axisX = new T.Vector3(1, 0, 0);

function mesh(parent, name, shape, material, x, y, z) {
  const part = new T.Mesh(shape, material);
  part.name = name;
  part.position.set(x, y, z);
  parent.add(part);
  return part;
}

function group(parent, name, x = 0, y = 0, z = 0) {
  const part = new T.Group();
  part.name = name;
  part.position.set(x, y, z);
  parent.add(part);
  return part;
}

function plate(vertices, thickness) {
  const shape = new T.Shape();
  for (const [index, [x, z]] of vertices.entries()) {
    if (index === 0) shape.moveTo(x, z);
    else shape.lineTo(x, z);
  }
  shape.closePath();
  return new T.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false }).rotateX(Math.PI / 2);
}

export function createF15Visual() {
  const root = new T.Group();
  const airframe = group(root, 'Eagle airframe');
  const metal = (color, roughness = 0.59) => new T.MeshStandardMaterial({ color, roughness, metalness: 0.34 });
  const hull = metal(0x8d9ca9);
  const wing = metal(0xa9b1b6);
  const panel = metal(0x687d8a);
  const dark = metal(0x232d34);
  const titanium = metal(0x797573, 0.37);
  const canopy = new T.MeshStandardMaterial({ color: 0x49616a, roughness: 0.17, metalness: 0.56 });
  const exhaustMaterial = new T.MeshBasicMaterial({
    color: 0xffa35d, transparent: true, opacity: 0.72, depthWrite: false, blending: T.AdditiveBlending,
  });
  const coreMaterial = exhaustMaterial.clone();
  coreMaterial.color.setHex(0xaadaff);
  const outline = [[0, 8.51], [0.42, 7.5], [0.74, 6.17], [1.02, 4.8], [1.08, 1.5],
    [1.04, -3.2], [0.94, -6.2], [0.48, -8.16], [0, -8.32]];
  const body = mesh(airframe, 'Fuselage', new T.LatheGeometry(outline.reverse().map(([x, z]) => new T.Vector2(x, z)), 20)
    .rotateX(Math.PI / 2), hull, 0, 0, 0);
  body.scale.y = 0.73;
  const cockpit = mesh(airframe, 'Canopy', new T.SphereGeometry(1, 16, 9), canopy, 0, 0.77, 4.51);
  cockpit.scale.set(0.69, 0.64, 2.03);
  const canopyFrame = mesh(airframe, 'Canopy rail', new T.SphereGeometry(1, 14, 8), panel, 0, 0.63, 4.49);
  canopyFrame.scale.set(0.75, 0.27, 2.00);
  const ordnance = missileVisuals();
  const arm = group(airframe, 'External stores');
  const shape = (points, sign, depth = 0.13) => plate(points.map(([x, z]) => [x * sign, z]), depth);
  const rudderShape = plate([[0.01, 0.06], [2.45, 0.1], [2.45, -0.51], [0.0, -0.51]], 0.1).rotateZ(Math.PI / 2);
  const finShape = plate([[0, 0.8], [0, -1.36], [2.58, -1.16], [2.58, -0.34]], 0.15).rotateZ(Math.PI / 2);
  const wheel = new T.CylinderGeometry(0.33, 0.33, 0.22, 12).rotateZ(Math.PI / 2);
  const strut = new T.CylinderGeometry(0.072, 0.095, 1.12, 8);
  for (const [name, sign] of [['Left', 1], ['Right', -1]]) {
    const x = 1.13 * sign;
    const cheek = mesh(airframe, `${name} nacelle`, new T.CylinderGeometry(0.76, 0.89, 7.0, 15).rotateX(Math.PI / 2), hull, x, -0.14, -3.60);
    cheek.scale.y = 0.92;
    mesh(airframe, `${name} intake`, new T.BoxGeometry(1.43, 0.98, 4.62), panel, x * 1.22, 0.12, 0.77);
    mesh(airframe, `${name} intake opening`, new T.BoxGeometry(1.21, 0.72, 0.06), dark, x * 1.22, 0.055, 3.096);
    mesh(airframe, `${name} exhaust socket`, new T.CylinderGeometry(0.71, 0.63, 0.94, 16, 1, true).rotateX(Math.PI / 2), titanium, x, -0.16, -7.46);
    mesh(airframe, `${name} exhaust throat`, new T.CircleGeometry(0.57, 16).rotateY(Math.PI), dark, x, -0.16, -7.53);
    mesh(airframe, `${name} nozzle`, new T.TorusGeometry(0.68, 0.055, 6, 16), titanium, x, -0.16, -7.94);
    const plume = group(airframe, `${name} burner`, x, -0.16, -8.2);
    plume.visible = false;
    mesh(plume, '', new T.ConeGeometry(0.56, 3.1, 12, 1, true).rotateX(-Math.PI / 2), exhaustMaterial, 0, 0, -1.37);
    mesh(plume, '', new T.ConeGeometry(0.32, 1.75, 12, 1, true).rotateX(-Math.PI / 2), coreMaterial, 0, 0, -0.68);
    const wingGroup = group(airframe, `${name} wing`);
    mesh(wingGroup, '', shape([[1.56, 1.89], [6.51, -1.47], [6.32, -2.73], [2.85, -3.36], [1.72, -3.42]], sign, 0.18), wing, 0, 0.02, 0);
    mesh(wingGroup, `${name} aileron`, shape([[0, 0], [1.99, 0.24], [2.03, -0.25], [0.02, -0.53]], sign), panel, sign * 4.24, 0.007, -2.61);
    mesh(wingGroup, `${name} flap`, shape([[0, 0], [2.04, 0.31], [2.06, -0.22], [0, -0.62]], sign), wing, sign * 2.17, 0.001, -2.95);
    mesh(airframe, `${name} stabilator`, shape([[0, 0.89], [2.22, -0.43], [2.16, -0.86], [0, -1.43]], sign, 0.15), wing, sign * 1.41, -0.08, -6.67);
    const tail = group(airframe, `${name} fin`, sign * 1.65, 0.31, -6.48);
    mesh(tail, '', finShape, wing, 0, 0, 0);
    mesh(tail, `${name} rudder`, rudderShape, panel, 0, 0.16, -1.32);
    const gear = group(airframe, `${name} main gear`, sign * 1.72, -0.36, -1.42);
    gear.visible = false;
    mesh(gear, '', strut, titanium, 0, -0.51, 0);
    mesh(gear, 'Wheel', wheel, dark, 0, -1.08, 0.06);
    mesh(wingGroup, '', new T.SphereGeometry(0.075, 8, 5), new T.MeshBasicMaterial({ color: sign > 0 ? 0xff3e30 : 0x50ff83 }),
      sign * 6.43, 0.01, -1.7);
  }
  const brakes = mesh(airframe, 'Speed brake', shape([[0, 0], [0, -2.42], [0.77, -2.29], [0.85, -0.14]], 1, 0.07), panel, 0, 0.74, 2.11);
  mesh(brakes, '', shape([[0, 0], [0, -2.42], [0.77, -2.29], [0.85, -0.14]], -1, 0.07), panel, 0, 0, 0);
  const nose = group(airframe, 'Nose gear', 0, -0.38, 4.22);
  nose.visible = false;
  mesh(nose, '', strut, titanium, 0, -0.51, 0);
  mesh(nose, 'Wheel', wheel, dark, 0, -1.08, -0.12);
  mesh(airframe, 'Tail strobe', new T.SphereGeometry(0.08, 7, 5), new T.MeshBasicMaterial({ color: 0xffffff }), 0, 0.1, -8.48);
  for (const { type, name, offset } of f15.hardpoints) {
    const store = ordnance[type].clone();
    store.name = name;
    store.position.fromArray(offset);
    arm.add(store);
  }
  root.add(cannonMount(f15.cannon));
  return bind(root, [hull, wing, panel]);
}

function bind(root, paint) {
  const node = (name) => root.getObjectByName(name);
  const muzzle = node('Port cannon emitter');
  const airframe = node('Eagle airframe');
  const arm = node('External stores');
  const brake = node('Speed brake');
  const strobe = node('Tail strobe');
  const gear = ['Left main gear', 'Right main gear', 'Nose gear'].map((name) => node(name));
  const sides = ['Left', 'Right'].map((name) => ({
    name, key: name.toLowerCase(), wing: node(`${name} wing`), flap: node(`${name} flap`),
    aileron: node(`${name} aileron`), tail: node(`${name} stabilator`), rudder: node(`${name} rudder`),
    fin: node(`${name} fin`), plume: node(`${name} burner`), nozzle: node(`${name} nozzle`),
  }));
  const stationMeshes = f15.hardpoints.map((point) => [node(point.name), point.wing]);
  return {
    root, muzzle, airframe, arm, paint,
    update(state, time, blend = 1) {
      const angle = (key) => degToRad(lerp(state.surfaces.previous[key], state.surfaces.angles[key], blend));
      for (const [index, side] of sides.entries()) {
        const { name, key, wing, aileron, flap, tail, rudder, fin, plume, nozzle } = side;
        wing.visible = state.damage.condition(`${key}Wing`) > 0;
        tail.visible = state.damage.condition(`${key}Stabilator`) > 0;
        fin.visible = state.damage.condition(`${key}Fin`) > 0;
        aileron.visible = state.damage.condition(`${key}Flaperon`) > 0;
        aileron.rotation.x = angle(`${name}Flaperon`);
        tail.rotation.x = angle(`${name}Stabilator`);
        flap.rotation.x = angle('Flap');
        rudder.rotation.y = angle('Rudder');
        const engine = state.engines.states[index];
        nozzle.scale.setScalar(0.90 + engine.spool * 0.10);
        plume.visible = engine.afterburner && !state.failure;
        if (plume.visible) plume.scale.z = 0.91 + 0.09 * Math.sin(time * 58 + index * 2);
      }
      brake.setRotationFromAxisAngle(axisX, angle('SpeedBrake'));
      for (const unit of gear) {
        unit.visible = state.gear > 0.03;
        unit.rotation.x = (1 - state.gear) * 1.38;
        unit.children[1].rotation.x = state.wheelSpin;
      }
      strobe.visible = time % 1.4 < 0.12;
      arm.visible = state.stores;
      for (const [store, wing] of stationMeshes) store.scale.setScalar(state.damage.condition(wing) > 0 ? 1 : 0);
    },
  };
}

export function cloneF15Visual(source, hostile = false) {
  const root = source.root.clone();
  if (!hostile) return bind(root, source.paint);
  const palette = new Map(source.paint.map((material, index) => {
    const tint = material.clone();
    tint.color.setHex([0x947b6e, 0xb09a80, 0x6f5653][index]);
    return [material, tint];
  }));
  root.traverse((object) => {
    if (palette.has(object.material)) object.material = palette.get(object.material);
  });
  return bind(root, [...palette.values()]);
}
