import { MathUtils, Quaternion, Vector3 } from 'three';

const rotation = new Quaternion();

export function bindImportedHinge(node) {
  const animation = JSON.parse(node.userData.aircraftAnimation);
  return {
    node, animation,
    base: node.quaternion.clone(),
    axis: new Vector3().fromArray(animation.axis).normalize(),
  };
}

export function setImportedHinge({ node, animation, base, axis }, angle) {
  const { min, max } = animation;
  const degrees = min === undefined ? angle : MathUtils.clamp(angle, min, max);
  node.quaternion.copy(base).multiply(rotation.setFromAxisAngle(axis, MathUtils.degToRad(degrees)));
}

export function importedGearAngle(animation, retraction) {
  const { rest, end, clearanceOpen = 0 } = animation;
  const smooth = MathUtils.smoothstep;
  return animation.control === 'gear'
    ? MathUtils.lerp(rest, end, smooth(retraction, .12, .78))
    : rest + clearanceOpen * smooth(retraction, 0, .12) +
      (end - rest - clearanceOpen) * smooth(retraction, .78, 1);
}
