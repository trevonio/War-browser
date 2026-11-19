import * as T from 'three';
import { hangars, landMinimumX, runway, shoreAt, terrainHeight } from '../sim/range.js';

export const presets = {
  low: { pixels: 0.8, terrain: 24, cloudCount: 20, waterDetail: 0, effectParticles: 56 },
  medium: { pixels: 1.0, terrain: 36, cloudCount: 48, waterDetail: 1, effectParticles: 112 },
  high: { pixels: 1.45, terrain: 48, cloudCount: 76, waterDetail: 1, effectParticles: 192 },
};

const tileSize = 4000;
const tileRadius = 3;
const sunDirection = new T.Vector3(-0.67, 0.42, 0.58).normalize();
const haze = new T.Color(0xa8bac4);
const oceanColor = new T.Color(0x246877);

function makeSky() {
  return new T.Mesh(new T.SphereGeometry(1, 24, 16), new T.ShaderMaterial({
    side: T.BackSide, depthWrite: false, fog: false,
    uniforms: {
      sunDirection: { value: sunDirection },
      zenith: { value: new T.Color(0x4077ad) },
      horizon: { value: new T.Color(0xc1d6df) },
      warmth: { value: new T.Color(0xf0c895) },
    },
    vertexShader: `
      varying vec3 direction;
      void main() {
        direction = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 sunDirection, zenith, horizon, warmth;
      varying vec3 direction;
      void main() {
        vec3 ray = normalize(direction);
        float horizonBelt = exp(-abs(ray.y) * 6.0);
        float sunAngle = max(dot(ray, sunDirection), 0.0);
        vec3 color = mix(horizon, zenith, smoothstep(-0.035, 0.49, ray.y));
        color = mix(color, warmth, 0.48 * pow(sunAngle, 4.0) * horizonBelt);
        color += warmth * (0.26 * pow(sunAngle, 24.0) + 2.3 * smoothstep(0.99965, 0.99985, sunAngle));
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  }));
}

function makeTerrainGeometry(tx, tz, steps) {
  const geometry = new T.PlaneGeometry(tileSize, tileSize, steps, steps);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.attributes.position;
  const colors = new Float32Array(positions.count * 3);
  const sand = new T.Color(0xafad87);
  const grass = new T.Color(0x64775a);
  const forest = new T.Color(0x3f594c);
  const rock = new T.Color(0x87877b);
  const color = new T.Color();
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i) + tx * tileSize;
    const z = positions.getZ(i) + tz * tileSize;
    const y = terrainHeight(x, z);
    const coast = x - shoreAt(z);
    const variation = 0.5 + 0.23 * Math.sin(x / 590 + Math.sin(z / 270)) + 0.2 * Math.cos(z / 520 - x / 310);
    color.copy(grass).lerp(forest, variation * 0.77).lerp(rock, T.MathUtils.smoothstep(y, 490, 1250));
    color.lerp(sand, 1 - T.MathUtils.smoothstep(coast, 25, 350));
    color.multiplyScalar(0.87 + variation * 0.25);
    colors.set([color.r, color.g, color.b], i * 3);
    positions.setY(i, y);
  }
  geometry.setAttribute('color', new T.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function makeOcean() {
  const material = new T.ShaderMaterial({
    uniforms: {
      tint: { value: oceanColor }, haze: { value: haze }, sunDirection: { value: sunDirection },
      waterDetail: { value: 1 },
    },
    vertexShader: `
      varying vec3 world;
      void main() {
        vec4 p = modelMatrix * vec4(position, 1.0);
        world = p.xyz;
        gl_Position = projectionMatrix * viewMatrix * p;
      }
    `,
    fragmentShader: `
      varying vec3 world;
      uniform vec3 tint, haze, sunDirection;
      uniform float waterDetail;
      void main() {
        vec3 sight = world - cameraPosition;
        float distanceToCamera = length(sight);
        vec3 ray = normalize(sight);
        float waves = 0.0;
        if (waterDetail > 0.5 && distanceToCamera < 8500.0) {
          waves = sin(world.x * .082 + world.z * .036) * cos(world.z * .073 - world.x * .014);
          waves += sin(world.x * .021 - world.z * .045) * .60;
          waves *= 1.0 - smoothstep(900.0, 8500.0, distanceToCamera);
        }
        float swells = cos(world.x * .0055 + world.z * .008) * sin(world.z * .004 - world.x * .003);
        vec3 color = tint * (0.81 + 0.10 * swells + 0.03 * waves);
        float sun = max(0.0, dot(reflect(ray, vec3(0.0, 1.0, 0.0)), sunDirection));
        color += vec3(1.0, 0.66, 0.31) * pow(sun, 34.0) * (0.11 + 0.045 * waves);
        float fog = 1.0 - exp(-distanceToCamera * 0.000050);
        color = mix(color, haze, max(fog, pow(1.0 - abs(ray.y), 9.0) * .52));
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const ocean = new T.Mesh(new T.PlaneGeometry(190000, 190000).rotateX(-Math.PI / 2), material);
  ocean.position.y = -0.05;
  return ocean;
}

function makeRunway(scene) {
  const pavement = new T.MeshStandardMaterial({
    color: 0x454a50, roughness: 0.97, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -24,
  });
  const markings = new T.MeshBasicMaterial({
    color: 0xc3c3ad, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -36,
  });
  const roof = new T.MeshStandardMaterial({ color: 0x687881, roughness: 0.83 });
  const wall = new T.MeshStandardMaterial({ color: 0x9a9a83, roughness: 0.91 });
  const concrete = new T.MeshStandardMaterial({
    color: 0x77776a, roughness: 0.96, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -12,
  });
  const ground = (width, length, x, y, z, material) => {
    const plane = new T.Mesh(new T.PlaneGeometry(width, length).rotateX(-Math.PI / 2), material);
    plane.position.set(x, y, z);
    scene.add(plane);
  };
  const center = (runway.start + runway.end) / 2;
  ground(104, runway.end - runway.start + 106, 0, runway.elevation + 0.08, center, concrete);
  ground(runway.halfWidth * 2, runway.end - runway.start, 0, runway.elevation + 0.16, center, pavement);
  ground(24, 1880, 143, runway.elevation + 0.11, -1530, pavement);
  ground(450, 25, 168, runway.elevation + 0.10, -2220, pavement);
  ground(265, 300, 278, runway.elevation + 0.11, -2080, concrete);
  const marks = [];
  for (let z = runway.start + 133; z < runway.end - 90; z += 66) marks.push([0, z, 0.9, 30]);
  for (const side of [-1, 1]) {
    marks.push([side * 30, center, 0.5, 3500]);
    for (const end of [runway.start + 41, runway.end - 41]) {
      for (let i = 1; i <= 5; i++) marks.push([i * 4.1 * side, end, 2.3, 29]);
    }
    marks.push([side * 12, runway.start + 320, 4.7, 29], [side * 12, runway.end - 320, 4.7, 29]);
  }
  const stripes = new T.InstancedMesh(new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), markings, marks.length);
  const matrix = new T.Matrix4();
  marks.forEach(([x, z, w, l], i) => {
    matrix.makeScale(w, 1, l).setPosition(x, runway.elevation + 0.21, z);
    stripes.setMatrixAt(i, matrix);
  });
  scene.add(stripes);
  for (const { x, z } of hangars) {
    const hangar = new T.Mesh(new T.BoxGeometry(48, 9, 42), wall);
    hangar.position.set(x, runway.elevation + 4.5, z);
    const top = new T.Mesh(new T.CylinderGeometry(26, 26, 43, 6, 1, false, 0, Math.PI),
      roof);
    top.rotation.x = Math.PI / 2;
    top.scale.z = 0.27;
    top.position.set(x, runway.elevation + 9, z);
    scene.add(hangar, top);
  }
}

function makeClouds(scene) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const puffs = [
    [44, 72, 37, 20], [75, 64, 46, 29], [112, 50, 39, 35], [149, 58, 48, 35],
    [182, 70, 48, 25], [215, 72, 32, 16], [127, 78, 83, 26],
  ];
  for (const [x, y, w, h] of puffs) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(w, h);
    const puff = ctx.createRadialGradient(-0.05, -0.30, 0, 0, 0, 1);
    puff.addColorStop(0, 'rgba(254, 250, 234, .83)');
    puff.addColorStop(0.40, 'rgba(235, 237, 231, .64)');
    puff.addColorStop(0.66, 'rgba(205, 215, 220, .3)');
    puff.addColorStop(1, 'rgba(192, 206, 217, 0)');
    ctx.fillStyle = puff;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
  }
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  const material = new T.SpriteMaterial({ map: texture, opacity: 0.78, transparent: true, depthWrite: false, fog: false });
  const sprites = [];
  let seed = 36671;
  function random() {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 4294967296;
  }
  for (let i = 0; i < presets.high.cloudCount; i++) {
    const cloud = new T.Sprite(material);
    const x = (random() - 0.47) * 45000;
    const z = (random() - 0.37) * 48000;
    const spread = 1300 + random() * 2800;
    cloud.scale.set(spread, spread * (0.20 + random() * 0.13), 1);
    cloud.position.set(x, 1400 + random() * 1700, z);
    sprites.push(cloud);
    scene.add(cloud);
  }
  return sprites;
}

export class WorldView {
  constructor(scene, renderer) {
    this.scene = scene;
    this.tiles = new Map();
    this.anchorX = Infinity;
    this.anchorZ = Infinity;
    this.terrainMaterial = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.97 });
    this.sky = makeSky();
    this.sky.scale.setScalar(65000);
    this.sky.renderOrder = -10;
    this.ocean = makeOcean();
    scene.add(this.sky, this.ocean);
    const reflectionScene = new T.Scene();
    const reflectionSky = this.sky.clone();
    reflectionSky.scale.setScalar(40);
    reflectionScene.add(reflectionSky);
    const reflection = new T.PMREMGenerator(renderer);
    scene.environment = reflection.fromScene(reflectionScene).texture;
    reflection.dispose();
    scene.environmentIntensity = 0.52;
    scene.fog = new T.FogExp2(haze, 0.000095);
    const sun = new T.DirectionalLight(0xffebc9, 2.15);
    sun.position.copy(sunDirection).multiplyScalar(3000);
    scene.add(sun, new T.HemisphereLight(0xc0d9eb, 0x6d705f, 1.45));
    this.clouds = makeClouds(scene);
    makeRunway(scene);
    this.setPreset(presets.medium);
  }

  setPreset(preset) {
    this.steps = preset.terrain;
    this.ocean.material.uniforms.waterDetail.value = preset.waterDetail;
    this.clouds.forEach((cloud, index) => { cloud.visible = index < preset.cloudCount; });
    for (const tile of this.tiles.values()) {
      this.scene.remove(tile);
      tile.geometry.dispose();
    }
    this.tiles.clear();
    this.anchorX = Infinity;
    this.anchorZ = Infinity;
  }

  update(position, camera) {
    this.sky.position.copy(camera.position);
    this.ocean.position.x = camera.position.x;
    this.ocean.position.z = camera.position.z;
    const tx = Math.round(position.x / tileSize);
    const tz = Math.round(position.z / tileSize);
    if (tx === this.anchorX && tz === this.anchorZ) return;
    this.anchorX = tx;
    this.anchorZ = tz;
    for (const [key, tile] of this.tiles) {
      if (Math.abs(tile.position.x / tileSize - tx) > tileRadius || Math.abs(tile.position.z / tileSize - tz) > tileRadius) {
        this.scene.remove(tile);
        tile.geometry.dispose();
        this.tiles.delete(key);
      }
    }
    for (let x = tx - tileRadius; x <= tx + tileRadius; x++) {
      if ((x + 0.5) * tileSize < landMinimumX) continue;
      for (let z = tz - tileRadius; z <= tz + tileRadius; z++) {
        const key = `${x},${z}`;
        if (this.tiles.has(key)) continue;
        const tile = new T.Mesh(makeTerrainGeometry(x, z, this.steps), this.terrainMaterial);
        tile.position.set(x * tileSize, 0, z * tileSize);
        this.tiles.set(key, tile);
        this.scene.add(tile);
      }
    }
  }
}
