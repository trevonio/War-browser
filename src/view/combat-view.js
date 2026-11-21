import * as T from 'three';
import { wingStores } from '../aircraft/f16-ordnance.js';

const mountNames = ['wingtip-left', 'wingtip-right', 'outer-left', 'outer-right'];
const axis = new T.Vector3(0, 0, 1);

export class CombatEffects {
  constructor(scene, own, enemy, exercise, effects) {
    this.exercise = exercise;
    this.effects = effects;
    this.mounts = [own, enemy].map((aircraft) => mountNames.map((name) => aircraft.arm.getObjectByName(name)));
    this.active = false;
    const glows = [0xffc874, 0xd2e0ef].map((color) => new T.MeshBasicMaterial({ color, toneMapped: false }));
    const dot = new T.IcosahedronGeometry(1, 0);
    this.models = this.mounts[0].filter((_, index) => index % 2 === 0).map((model) => model.clone());
    this.missiles = exercise.missiles.pool.map(() => {
      const root = new T.Group();
      for (const model of this.models) {
        const copy = model.clone();
        copy.position.set(0, 0, 0);
        copy.scale.setScalar(wingStores.scale);
        root.add(copy);
      }
      const motor = new T.Mesh(dot, glows[0]);
      motor.scale.set(0.19, 0.19, 0.42);
      motor.position.z = -1.55;
      root.add(motor);
      root.visible = false;
      scene.add(root);
      return root;
    });
    this.flares = new T.InstancedMesh(dot, glows[0], exercise.decoys.pool.length);
    this.chaff = new T.InstancedMesh(dot, glows[1], exercise.decoys.pool.length);
    for (const mesh of [this.flares, this.chaff]) {
      mesh.frustumCulled = false;
      mesh.count = 0;
      scene.add(mesh);
    }
    this.projection = new T.Object3D();
    this.nextTrail = 0;
  }

  reset() {
    this.active = this.exercise.enabled;
    this.nextTrail = 0;
    this.updateMounts();
    for (const model of this.missiles) model.visible = false;
    this.flares.count = this.chaff.count = 0;
  }

  updateMounts() {
    for (let index = 0; index < this.mounts.length; index++) {
      const rack = this.exercise.sides[index].rack;
      for (const mount of this.mounts[index]) {
        mount.visible = !this.active || rack.stations.some((item) => item.name === mount.name && !item.used);
      }
    }
  }

  step(time) {
    if (time < this.nextTrail) return;
    this.nextTrail = time + 0.085;
    for (const missile of this.exercise.missiles.pool) {
      if (!missile.active || missile.age > missile.config.burn) continue;
      this.effects.emit('rocketTrail', missile.position, 1);
      if (missile.age < 0.17) this.effects.emit('rocketFlash', missile.position, 2);
    }
  }

  render(blend) {
    if (!this.active) return;
    this.updateMounts();
    for (const [index, missile] of this.exercise.missiles.pool.entries()) {
      const model = this.missiles[index];
      model.visible = missile.active;
      if (!missile.active) continue;
      model.children[0].visible = missile.config.model === 'wingtip';
      model.children[1].visible = missile.config.model === 'outer';
      model.children[2].visible = missile.age < missile.config.burn;
      model.position.copy(missile.previous).lerp(missile.position, blend);
      model.quaternion.setFromUnitVectors(axis, missile.direction);
    }
    this.flares.count = this.chaff.count = 0;
    for (const decoy of this.exercise.decoys.pool) {
      if (!decoy.active) continue;
      const flare = decoy.type === 'flare';
      const batch = flare ? this.flares : this.chaff;
      this.projection.position.copy(decoy.previous).lerp(decoy.position, blend);
      const size = flare ? 0.48 + decoy.signature * 0.75 : 1.2 + decoy.age * 1.1;
      this.projection.scale.setScalar(size);
      this.projection.updateMatrix();
      batch.setMatrixAt(batch.count++, this.projection.matrix);
    }
    if (this.flares.count) this.flares.instanceMatrix.needsUpdate = true;
    if (this.chaff.count) this.chaff.instanceMatrix.needsUpdate = true;
  }
}

export function drawRadar(canvas, radar) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const center = width * 0.5;
  const base = height - 12;
  const extent = height - 24;
  const halfAngle = 1.03;
  ctx.clearRect(0, 0, width, height);
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#497b75';
  ctx.beginPath();
  ctx.moveTo(center, base);
  ctx.lineTo(center - extent * Math.sin(halfAngle), base - extent * Math.cos(halfAngle));
  ctx.arc(center, base, extent, -Math.PI / 2 - halfAngle, -Math.PI / 2 + halfAngle);
  ctx.closePath();
  ctx.stroke();
  for (const fraction of [0.33, 0.66]) {
    ctx.beginPath();
    ctx.arc(center, base, extent * fraction, -Math.PI / 2 - halfAngle, -Math.PI / 2 + halfAngle);
    ctx.stroke();
  }
  ctx.fillStyle = '#92dace';
  ctx.fillRect(center - 2, base - 2, 4, 4);
  for (const contact of radar.contacts.values()) {
    const distance = Math.min(contact.range / radar.range, 1) * extent;
    const x = center + Math.sin(contact.bearing) * distance;
    const y = base - Math.cos(contact.bearing) * distance;
    const locked = radar.locked === contact.target;
    const selected = radar.selected === contact.target;
    ctx.fillStyle = locked ? '#ffd091' : '#a8e8d7';
    ctx.fillRect(x - 2, y - 2, 4, 4);
    if (!selected && !locked) continue;
    ctx.strokeStyle = ctx.fillStyle;
    ctx.strokeRect(x - 6, y - 6, 12, 12);
  }
}
