import * as T from 'three';
import { missileVisuals } from '../aircraft/missile-visual.js';
import { disposeObjects } from './resources.js';

const axis = new T.Vector3(0, 0, 1);

export class StoreModels {
  constructor() {
    this.templates = null;
  }

  create(id) {
    if (!this.templates) this.templates = makeModels();
    return this.templates[id].clone();
  }

  dispose() {
    if (this.templates) disposeObjects(...Object.values(this.templates));
  }
}

function makeModels() {
  const paint = new T.MeshStandardMaterial({ color: 0x555941, roughness: 0.76 });
  const metal = new T.MeshStandardMaterial({ color: 0xadb7ba, metalness: 0.44, roughness: 0.42 });
  const dark = new T.MeshStandardMaterial({ color: 0x293138, roughness: 0.81 });
  const band = new T.MeshStandardMaterial({ color: 0xd9a458, roughness: 0.62 });
  const part = (parent, geometry, material, x = 0, y = 0, z = 0) => {
    const object = new T.Mesh(geometry, material);
    object.position.set(x, y, z);
    parent.add(object);
    return object;
  };
  const shell = (parent, profile, material) => part(parent,
    new T.LatheGeometry(profile.map(([radius, aft]) => new T.Vector2(radius, aft)), 12).rotateX(Math.PI / 2), material);
  const bomb = new T.Group();
  shell(bomb, [[0, -1.04], [0.11, -0.98], [0.16, -0.53], [0.205, 0.18], [0.171, 0.67], [0.08, 0.98], [0, 1.09]], paint);
  part(bomb, new T.TorusGeometry(0.159, 0.017, 5, 12), band, 0, 0, 0.71);
  const fin = new T.BoxGeometry(0.052, 0.31, 0.37);
  for (let index = 0; index < 4; index++) {
    const pivot = new T.Group();
    pivot.rotation.z = index * Math.PI / 2 + Math.PI / 4;
    part(pivot, fin, paint, 0, 0.16, -0.78);
    bomb.add(pivot);
  }
  const tank = new T.Group();
  shell(tank, [[0, -2.08], [0.19, -1.74], [0.32, -0.83], [0.37, 0], [0.31, 1.07], [0.16, 1.77], [0.04, 2.00], [0, 2.07]], metal);
  part(tank, new T.BoxGeometry(0.68, 0.10, 0.52), dark, 0, 0, -1.41);
  const rocket = new T.Group();
  shell(rocket, [[0.19, -1.25], [0.24, -0.93], [0.26, -0.60], [0.26, 0.94], [0.235, 1.13]], metal);
  part(rocket, new T.CircleGeometry(0.232, 12), dark, 0, 0, 1.133);
  const hole = new T.CircleGeometry(0.049, 9);
  for (let i = 0; i < 7; i++) {
    const angle = i * Math.PI / 3;
    part(rocket, hole, paint, i === 6 ? 0 : Math.cos(angle) * 0.125, i === 6 ? 0 : Math.sin(angle) * 0.125, 1.14);
  }
  const bolt = new T.Group();
  shell(bolt, [[0.044, -0.64], [0.056, -0.42], [0.056, 0.50], [0, 0.67]], metal);
  const motor = part(bolt, new T.ConeGeometry(0.076, 0.42, 8).rotateX(-Math.PI / 2),
    new T.MeshBasicMaterial({ color: 0xffad58, toneMapped: false }), 0, 0, -0.82);
  motor.name = 'boost';
  return { ...missileVisuals(), bomb, rocket, tank, bolt };
}

export class AttachedStores {
  constructor(visual, models) {
    this.visual = visual;
    this.models = models;
    this.root = new T.Group();
    visual.root.add(this.root);
    this.mounts = [];
  }

  reset(stations) {
    this.root.clear();
    this.mounts = [];
    for (const station of stations ?? []) {
      const mesh = this.models.create(station.id);
      mesh.position.fromArray(station.offset);
      mesh.rotation.fromArray(station.rotation);
      this.root.add(mesh);
      this.mounts.push({ mesh, station });
    }
  }

  update(flight) {
    this.visual.arm.visible = flight.stores && !flight.customStores;
    this.root.visible = flight.stores;
    for (const { mesh, station } of this.mounts) {
      mesh.visible = !station.used && flight.damage.condition(station.wing) > 0;
      if (station.type === 'rocket') {
        for (let index = 2; index < mesh.children.length; index++) mesh.children[index].visible = index - 2 < (station.remaining ?? station.quantity);
      }
    }
  }

  dispose() { this.root.removeFromParent(); }
}

export class ReleasedStores {
  constructor(scene, models, ordnance) {
    this.scene = scene;
    this.models = models;
    this.entries = ordnance.rounds.map((round) => ({ round, mounts: {}, current: null }));
    this.direction = new T.Vector3();
  }

  update(blend) {
    for (const entry of this.entries) {
      const { round, mounts } = entry;
      if (entry.current) entry.current.visible = false;
      if (!round.active) continue;
      const kind = round.kind === 'rocket' ? 'bolt' : round.kind;
      if (!mounts[kind]) {
        mounts[kind] = this.models.create(kind);
        this.scene.add(mounts[kind]);
      }
      const mesh = entry.current = mounts[kind];
      mesh.visible = true;
      mesh.position.copy(round.previous).lerp(round.position, blend);
      this.direction.copy(round.velocity).normalize();
      mesh.quaternion.setFromUnitVectors(axis, this.direction);
      if (kind === 'bolt') mesh.getObjectByName('boost').visible = round.age < 0.8;
    }
  }

  dispose() {
    for (const { mounts } of this.entries) for (const mesh of Object.values(mounts)) mesh.removeFromParent();
  }
}

export class GroundRangeView {
  constructor(scene, targets) {
    const body = new T.BoxGeometry(1, 1, 1);
    const mark = new T.RingGeometry(5.8, 7, 4);
    const blue = new T.MeshStandardMaterial({ color: 0x60757b, roughness: 0.83 });
    const olive = new T.MeshStandardMaterial({ color: 0x607054, roughness: 0.84 });
    const gray = new T.MeshStandardMaterial({ color: 0x858477, roughness: 0.8 });
    const dark = new T.MeshStandardMaterial({ color: 0x292e32 });
    const amber = new T.MeshBasicMaterial({ color: 0xf5cf7f, side: T.DoubleSide, toneMapped: false });
    this.entries = targets.map((target) => {
      const root = new T.Group();
      root.position.copy(target.position);
      root.position.y = target.floor;
      const box = (material, size, x, y, z) => {
        const block = new T.Mesh(body, material);
        block.scale.fromArray(size);
        block.position.set(x, y, z);
        root.add(block);
      };
      if (target.type === 'truck') {
        box(blue, [3.2, 1.4, 5.8], 0, 1.1, 0);
        box(gray, [2.9, 1.4, 2.2], 0, 2.5, 1.7);
        box(dark, [3.8, 0.55, 4.8], 0, 0.43, 0);
      } else if (target.type === 'armor') {
        box(olive, [4.2, 1.2, 6.3], 0, 1.1, 0);
        box(olive, [2.8, 0.86, 2.8], 0, 2.0, 0.1);
        box(dark, [4.65, 0.64, 5.9], 0, 0.50, 0);
      } else {
        box(gray, [7.8, 3.5, 7.2], 0, 1.8, 0);
        box(dark, [8.4, 0.45, 7.8], 0, 3.65, 0);
      }
      const marker = new T.Mesh(mark, amber);
      marker.position.y = 11.5;
      root.add(marker);
      root.visible = false;
      scene.add(root);
      return { target, root, marker };
    });
  }

  update(camera) {
    for (const { target, root, marker } of this.entries) {
      const distance = camera.position.distanceToSquared(root.position);
      root.visible = target.active && distance < 5600 ** 2;
      if (!root.visible) continue;
      marker.quaternion.copy(camera.quaternion);
      marker.visible = distance > 55 ** 2;
      for (let index = 0; index < root.children.length - 1; index++) root.children[index].visible = distance < 2400 ** 2;
    }
  }

  dispose() { disposeObjects(...this.entries.map(({ root }) => root)); }
}
