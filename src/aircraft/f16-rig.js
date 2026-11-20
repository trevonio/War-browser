import * as T from 'three';

// Translate the supplied viewer's separate hinge meshes to the simulator's
// airframe. Local +X is port, +Y is up and +Z is forward on both models.
export function buildF16Rig(airframe, mesh, horizontal, vertical, materials) {
  const { wing, trim, dark, metal } = materials;
  const wings = group('Wings', airframe);
  const tail = group('Tail', airframe);
  const brakes = group('Airbrakes', airframe);
  const gear = group('Landing gear', airframe);
  const plate = (parent, name, points, thickness, material, y, a, b, direction = 1) => {
    for (const side of [1, -1]) {
      const pivot = group(`${side > 0 ? 'Left' : 'Right'}${name}`, parent);
      pivot.position.set(a[0] * side, y, a[1]);
      const shape = horizontal(points.map(([x, z]) => [x * side, z]), thickness)
        .translate(-pivot.position.x, 0, -pivot.position.z);
      pivot.userData.hinge = new T.Vector3((b[0] - a[0]) * side, 0, b[1] - a[1])
        .normalize().multiplyScalar(side * direction).toArray();
      pivot.add(mesh(shape, material));
    }
  };

  const fixed = [[0.55, 0.55], [5.25, -3.15], [5.25, -4.1], [4.8, -4.09], [4.8, -3.35], [0.55, -3.2]];
  for (const side of [1, -1]) {
    const section = group(side > 0 ? 'LeftWing' : 'RightWing', wings);
    section.add(mesh(horizontal(fixed.map(([x, z]) => [x * side, z]), 0.12), wing, 0, -0.22, 0));
    wings.add(mesh(horizontal([[0.4 * side, 5], [1.9 * side, 0.5], [0.5 * side, -0.6]], 0.1), wing, 0, -0.02, 0));
  }
  plate(wings, 'LEF', [[0.55, 1], [5.25, -2.7], [5.25, -3.15], [0.55, 0.55]], 0.12, trim,
    -0.22, [0.55, 0.55], [5.25, -3.15]);
  plate(wings, 'Flaperon', [[0.55, -3.2], [4.8, -3.35], [4.8, -4.09], [0.55, -4]], 0.12, trim,
    -0.22, [0.55, -3.2], [4.8, -3.35], -1);
  plate(tail, 'Stabilator', [[0.9, -4.7], [3, -6.1], [3, -7.3], [0.9, -7.1]], 0.09, wing,
    -0.12, [1.2, -5.9], [2.2, -5.9]);
  tail.add(mesh(vertical([[-3.6, 0.7], [-6.4, 3.5], [-6.75, 3.5], [-6.45, 0.7]], 0.1), wing));
  const rudder = group('Rudder', tail);
  rudder.position.set(0, 0.7, -6.45);
  rudder.userData.hinge = new T.Vector3(0, 2.8, -0.3).normalize().toArray();
  rudder.add(mesh(vertical([[-6.45, 0.7], [-6.75, 3.5], [-7.4, 3.5], [-7.4, 0.7]], 0.1)
    .translate(0, -0.7, 6.45), trim));
  for (const side of [1, -1]) {
    const pivot = group(side > 0 ? 'LeftAirbrake' : 'RightAirbrake', brakes);
    pivot.position.set(side * 0.83, 0, -6);
    pivot.userData.hinge = [0, -side, 0];
    pivot.add(mesh(vertical([[-6, 0.45], [-7.3, 0.4], [-7.3, -0.4], [-6, -0.45]], 0.05)
      .translate(0, 0, 6), trim));
  }

  const tire = new T.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 });
  const chrome = new T.MeshStandardMaterial({ color: 0xcfd3d6, metalness: 1, roughness: 0.15 });
  const leg = (name, x, y, z, length, pistonLength, radius, width, wheelOffsets) => {
    const strut = group(name, gear);
    strut.position.set(x, y, z);
    const piston = group(`${name}Piston`, strut);
    piston.position.y = -length;
    const wheels = group(`${name}Wheel`, piston);
    wheels.position.y = -pistonLength;
    strut.add(mesh(new T.CylinderGeometry(0.06, 0.07, length, 12), metal, 0, -length / 2, 0));
    piston.add(mesh(new T.CylinderGeometry(0.04, 0.04, pistonLength, 10), chrome, 0, -pistonLength / 2, 0),
      mesh(new T.BoxGeometry(0.03, 0.14, 0.05), metal, 0, -pistonLength * 0.4, 0.07));
    const cylinder = (scale, extra, segments) => new T.CylinderGeometry(radius * scale, radius * scale,
      width + extra, segments).rotateZ(Math.PI / 2);
    const tireShape = cylinder(1, 0, 28);
    const rim = cylinder(0.58, 0.012, 20);
    const hub = cylinder(0.4, 0.03, 16);
    for (const offset of wheelOffsets) {
      wheels.add(mesh(tireShape, tire, offset), mesh(rim, metal, offset), mesh(hub, dark, offset));
    }
  };
  leg('NoseGear', 0, -0.5, 4.5, 0.5, 0.25, 0.2, 0.12, [0.11, -0.11]);
  leg('LeftMainGear', 1.1, -0.45, -1.2, 0.45, 0.22, 0.33, 0.2, [0]);
  leg('RightMainGear', -1.1, -0.45, -1.2, 0.45, 0.22, 0.33, 0.2, [0]);
  plate(gear, 'MainGearDoor', [[0.45, -0.3], [0.95, -0.3], [0.95, -2.1], [0.45, -2.1]], 0.04, trim,
    -0.78, [0.95, -0.3], [0.95, -2.1], -1);
  plate(gear, 'NoseGearDoor', [[0.02, 4.15], [0.28, 4.15], [0.28, 4.95], [0.02, 4.95]], 0.03, trim,
    -0.57, [0.28, 4.15], [0.28, 4.95]);
  return gear;
}

function group(name, parent) {
  const node = new T.Group();
  node.name = name;
  parent.add(node);
  return node;
}

export function bindF16Rig(root) {
  const hinges = [];
  const detachable = [];
  const dependencies = {
    LeftWing: ['leftWing'], RightWing: ['rightWing'],
    LeftLEF: ['leftWing'], RightLEF: ['rightWing'],
    LeftFlaperon: ['leftWing', 'leftFlaperon'], RightFlaperon: ['rightWing', 'rightFlaperon'],
    LeftStabilator: ['leftStabilator'], RightStabilator: ['rightStabilator'],
  };
  root.traverse((node) => {
    if (node.userData.hinge) hinges.push({ node, axis: new T.Vector3().fromArray(node.userData.hinge) });
    const parts = dependencies[node.name] ?? (node.userData.wing ? [node.userData.wing] : null);
    if (parts) detachable.push({ node, parts });
  });
  const legs = ['NoseGear', 'LeftMainGear', 'RightMainGear'].map((name) => ({
    strut: root.getObjectByName(name),
    piston: root.getObjectByName(`${name}Piston`),
    wheel: root.getObjectByName(`${name}Wheel`),
  }));
  return (state, blend) => {
    const { gear, brake, surfaces, damage } = state;
    for (const { node, parts } of detachable) {
      node.visible = parts.every((part) => damage.condition(part) > 0);
    }
    const doors = Math.min(1, 5 * Math.min(gear, 1 - gear));
    const extension = T.MathUtils.smoothstep(gear, 0.2, 0.8);
    for (const { node, axis } of hinges) {
      const name = node.name;
      const angle = name in surfaces.angles ? T.MathUtils.lerp(surfaces.previous[name], surfaces.angles[name], blend)
        : name.endsWith('Airbrake') ? brake * 60 : name.endsWith('MainGearDoor') ? doors * 75 : doors * 70;
      node.quaternion.setFromAxisAngle(axis, T.MathUtils.degToRad(angle));
    }
    for (const { strut, piston, wheel } of legs) {
      const side = Math.sign(strut.position.x);
      strut.visible = gear > 0.10;
      if (side) strut.rotation.z = -side * (1 - extension) * 1.4;
      else strut.rotation.x = (1 - extension) * 1.57;
      piston.position.y = (side ? -0.45 : -0.5) + (state.grounded ? 0.07 : 0);
      wheel.rotation.x = state.wheelSpin;
    }
  };
}
