import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const parentFrame = new T.Quaternion();
const clamp = T.MathUtils.clamp;
const radians = T.MathUtils.degToRad;

export const controlLabels = {
  roll: 'Ailerons',
  pitch: 'Stabilators',
  yaw: 'Rudders',
  flaps: 'Flaps',
  leadingEdge: 'Leading edge',
};

function gearAngle(animation, retraction) {
  // Gear clears the still-open doors before they close. Deployment reverses
  // the same sequence, including when a user interrupts the movement.
  const { rest, end, clearanceOpen = 0 } = animation;
  const smooth = T.MathUtils.smoothstep;
  return animation.control === 'gear'
    ? T.MathUtils.lerp(rest, end, smooth(retraction, .12, .78))
    : rest + clearanceOpen * smooth(retraction, 0, .12) +
      (end - rest - clearanceOpen) * smooth(retraction, .78, 1);
}

export async function loadAircraftModel(manifest, sourceUrl) {
  if (manifest.schema !== 1 || typeof manifest.root !== 'string' ||
      manifest.levels?.length !== 3 || !Array.isArray(manifest.attachments) ||
      manifest.levels.some((level, index) => typeof level.file !== 'string' ||
        !Number.isFinite(level.distance) || (index === 0 ? level.distance !== 0 : level.distance <= manifest.levels[index - 1].distance))) {
    throw new Error('Expected a version 1 aircraft manifest with three increasing detail distances.');
  }
  const loader = new GLTFLoader();
  const loaded = await Promise.allSettled(manifest.levels.map((level) => loader.loadAsync(sourceUrl(level.file))));
  if (loaded.some((result) => result.status === 'rejected')) {
    for (const result of loaded) if (result.status === 'fulfilled') disposeScene(result.value.scene);
    throw new Error('Could not load all three GLBs. Check that each file belongs to this manifest.');
  }
  const lod = new T.LOD();
  lod.autoUpdate = false;
  const rigs = [];
  const materials = new Set();
  try {
    for (const [index, result] of loaded.entries()) {
      const { scene } = result.value;
      const root = scene.getObjectByName(manifest.root);
      if (root?.userData.aircraftImportVersion !== 1) throw new Error('Missing the expected aircraft root.');
      let triangles = 0;
      const hinges = [];
      root.traverse((node) => {
        if (node.isMesh) {
          const { geometry, material } = node;
          triangles += (geometry.index?.count ?? geometry.attributes.position.count) / 3;
          for (const item of [material].flat()) {
            if (item.transparent) item.forceSinglePass = true;
            materials.add(item);
          }
        }
        if (node.userData.aircraftAnimation) {
          const animation = JSON.parse(node.userData.aircraftAnimation);
          let meshCount = 0;
          node.traverse((child) => { if (child.isMesh) meshCount++; });
          if (!meshCount) throw new Error(`${node.name} has a hinge but is missing its geometry.`);
          const axis = new T.Vector3().fromArray(animation.axis).normalize();
          hinges.push({ node, animation, axis, base: node.quaternion.clone() });
        }
      });
      if (triangles < 1 || (Number.isInteger(manifest.levels[index].triangles) && triangles !== manifest.levels[index].triangles)) {
        throw new Error(`LOD ${index} triangle count does not match the manifest.`);
      }
      const layout = hinges.map(({ node }) => node.name).sort().join(' ');
      if (index > 0 && layout !== rigs[0].layout) throw new Error('The LODs have different rig nodes.');
      for (const attachment of manifest.attachments) {
        if (!root.getObjectByName(attachment.name)) throw new Error(`Missing attachment point ${attachment.name}.`);
      }
      lod.addLevel(scene, manifest.levels[index].distance, .1);
      scene.visible = index === 0;
      rigs.push({ hinges, layout });
    }
  } catch (error) {
    for (const { value } of loaded) disposeScene(value.scene);
    throw error;
  }

  // The socket transforms have been validated across all levels, so one
  // overlay can remain in world space through a detail change.
  const overlays = new T.Group();
  overlays.visible = false;
  const root = lod.levels[0].object;
  root.updateMatrixWorld(true);
  for (const attachment of manifest.attachments) {
    const anchor = root.getObjectByName(attachment.name);
    const size = attachment.kind === 'store' ? .28 : .42;
    const mark = new T.AxesHelper(size);
    const center = new T.Vector3();
    const direction = new T.Vector3(0, 0, 1).transformDirection(anchor.matrixWorld);
    const color = attachment.kind === 'store' ? 0x84ddc5 : attachment.kind === 'muzzle' ? 0xf8d291 : 0x9abffb;
    anchor.getWorldPosition(center);
    mark.position.copy(center);
    mark.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), direction);
    // Keep the mark visible over the airframe itself.
    mark.material.depthTest = false;
    overlays.add(mark, new T.ArrowHelper(direction, center, size * 2, color, size * .72, size * .48));
  }

  return {
    lod, overlays, manifest,
    controls: new Set(rigs[0].hinges.map(({ animation }) => animation.control)),
    bounds: new T.Box3().setFromObject(root, true),
    select(camera, mode) {
      if (mode === 'auto') {
        lod.update(camera);
        return lod.getCurrentLevel();
      }
      for (const [index, { object }] of lod.levels.entries()) object.visible = index === mode;
      return mode;
    },
    pose(controls, retraction) {
      for (const { hinges } of rigs) {
        for (const { node, animation: a, axis, base } of hinges) {
          const input = controls[a.control] ?? 0;
          let angle;
          if (a.control === 'gear' || a.control === 'gearDoor') {
            angle = gearAngle(a, retraction);
          } else {
            const normalized = clamp(input * (a.sense ?? 1), -1, 1);
            angle = normalized * (normalized < 0 ? Math.abs(a.min) : Math.abs(a.max));
            angle = clamp(angle, a.min, a.max);
          }
          node.quaternion.copy(base).multiply(parentFrame.setFromAxisAngle(axis, radians(angle)));
        }
      }
    },
    wireframe(enabled) {
      for (const material of materials) material.wireframe = enabled;
    },
    dispose() {
      disposeScene(lod);
      disposeScene(overlays);
      lod.removeFromParent();
      overlays.removeFromParent();
    },
  };
}

function disposeScene(root) {
  const surfaces = new Set();
  const textures = new Set();
  const images = new Set();
  root.traverse((node) => {
    node.geometry?.dispose();
    if (node.material) for (const m of [node.material].flat()) surfaces.add(m);
  });
  for (const material of surfaces) {
    for (const item of Object.values(material)) if (item?.isTexture) textures.add(item);
    material.dispose();
  }
  for (const texture of textures) {
    if (texture.image) images.add(texture.image);
    texture.dispose();
  }
  for (const image of images) image.close?.();
}
