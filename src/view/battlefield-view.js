import * as T from 'three';
import { disposeObjects } from './resources.js';

const xAxis = new T.Vector3(1, 0, 0);
const yAxis = new T.Vector3(0, 1, 0);
const colors = {
  friendly: [new T.Color(0x697d77), new T.Color(0x45686b)],
  opposing: [new T.Color(0x93785f), new T.Color(0x75533f)],
  neutral: [new T.Color(0x8f9293), new T.Color(0x676c6b)],
};
const charcoal = new T.Color(0x333431);
const inactive = new T.Color(0x2b2522);
const paint = new T.Color();
const vehicleMaterial = () => new T.MeshStandardMaterial({ color: 0xe2dfcb, roughness: .92 });
const capacity = 64;

export function groundHeat(unit, time) {
  if (!unit.active) return .23 + .64 * Math.exp(-Math.max(0, time - (unit.visibleUntil - 47)) / 19);
  return .31 + .35 * unit.health.condition('engine') + Math.min(.22, unit.speed * .007);
}

export class BattlefieldView {
  constructor(scene, battle, world) {
    this.battle = battle;
    this.world = world;
    this.root = new T.Group();
    this.root.name = 'Coastal battlefield';
    scene.add(this.root);
    this.hull = this.batch(new T.BoxGeometry(1, 1, 1), capacity * 3, vehicleMaterial());
    this.turret = this.batch(new T.CylinderGeometry(.5, .59, 1, 7), capacity, vehicleMaterial());
    this.barrel = this.batch(new T.BoxGeometry(1, 1, 1), capacity, vehicleMaterial());
    this.wheel = this.batch(new T.CylinderGeometry(.5, .5, 1, 8).rotateZ(Math.PI / 2), capacity * 8, vehicleMaterial());
    this.markers = this.batch(new T.RingGeometry(.83, 1, 4), capacity, new T.MeshBasicMaterial({
      color: 0xffffff, depthWrite: false, side: T.DoubleSide, toneMapped: false,
    }));
    this.markerColors = { friendly: new T.Color(0x8eead7), opposing: new T.Color(0xffcb91), neutral: new T.Color(0xf3efd1) };
    this.transform = new T.Object3D();
    this.projection = new T.Matrix4();
    this.frustum = new T.Frustum();
    this.bounds = new T.Sphere(new T.Vector3(), 16);
    this.batches = [this.hull, this.turret, this.barrel, this.wheel, this.markers];
    this.thermalMaterials = [this.hull, this.turret, this.barrel, this.wheel].map((mesh) => [mesh, mesh.material]);
    this.thermalVehicle = new T.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.thermalPaint = new T.Color();
    this.thermal = 0;
    this.position = new T.Vector3();
    this.offset = new T.Vector3();
    this.rotation = new T.Quaternion();
    this.secondary = new T.Quaternion();
    this.road = new T.Mesh(roadGeometry(battle.roads, world), new T.MeshStandardMaterial({
      color: 0x8c826b, roughness: 1, side: T.DoubleSide,
    }));
    this.root.add(this.road);
    this.zone = new T.Mesh(new T.RingGeometry(.977, 1, 40).rotateX(-Math.PI / 2), new T.MeshBasicMaterial({
      color: 0xedd799, transparent: true, opacity: .64, depthWrite: false, side: T.DoubleSide, toneMapped: false,
    }));
    this.root.add(this.zone);
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.BufferAttribute(new Float32Array((battle.weapons.pool.length + 96) * 6), 3)
      .setUsage(T.DynamicDrawUsage));
    this.tracers = new T.LineSegments(geometry, new T.LineBasicMaterial({
      color: 0xffc979, opacity: .82, transparent: true, depthWrite: false, toneMapped: false,
    }));
    this.tracers.frustumCulled = false;
    this.root.add(this.tracers);
  }

  batch(geometry, maximum, material) {
    const mesh = new T.InstancedMesh(geometry, material, maximum);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    this.root.add(mesh);
    return mesh;
  }

  update(camera, blend, observer, assisted, thermal = 0, battery = null) {
    const { battle, hull, turret, barrel, wheel, markers } = this;
    this.root.visible = battle.enabled;
    if (!battle.enabled) return;
    if (thermal !== this.thermal) {
      this.thermal = thermal;
      for (const [mesh, material] of this.thermalMaterials) mesh.material = thermal ? this.thermalVehicle : material;
    }
    this.zone.visible = !thermal;
    this.road.visible = !thermal;
    hull.count = turret.count = barrel.count = wheel.count = markers.count = 0;
    this.frustum.setFromProjectionMatrix(this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const zone = battle.mission.objective;
    this.zone.position.set(zone.x, this.world.heightAt(zone.x, zone.z) + .25, zone.z);
    this.zone.scale.setScalar(zone.radius);
    for (const unit of battle.targets) {
      const wreck = !unit.active;
      if (unit.arrived || wreck && battle.time >= unit.visibleUntil) continue;
      const distance = unit.position.distanceToSquared(camera.position);
      if (distance > 4700 ** 2) continue;
      this.bounds.center.copy(unit.position);
      if (!this.frustum.intersectsSphere(this.bounds)) continue;
      const near = distance < 1100 ** 2 && !wreck;
      const middle = distance < 2050 ** 2 && !wreck;
      this.position.copy(unit.previous).lerp(unit.position, blend);
      const { dimensions: [width, height, length], model } = unit.spec;
      const [outer, factionTrim] = colors[unit.faction];
      let trim = factionTrim;
      let metal = charcoal;
      if (thermal) {
        const heat = groundHeat(unit, battle.time);
        const tone = thermal === 1 ? heat : 1 - heat;
        this.thermalPaint.setRGB(tone, tone, tone, T.SRGBColorSpace);
        trim = metal = this.thermalPaint;
      }
      paint.copy(wreck ? inactive : outer);
      if (!wreck) paint.multiplyScalar(.54 + unit.health.condition('hull') * .46);
      if (thermal) paint.copy(this.thermalPaint);
      this.put(hull, unit.orientation, paint, 0, height * .35, 0, width, height * (middle ? .57 : .72), length);
      if (middle && (unit.spec.weapon || model === 'aaa' || model === 'sam')) {
        this.rotation.copy(unit.orientation).multiply(this.secondary.setFromAxisAngle(yAxis, unit.turret.yaw));
        this.put(turret, this.rotation, trim, 0, height * .69, 0, width * .69, height * .31, length * .44, unit.orientation);
        this.rotation.multiply(this.secondary.setFromAxisAngle(xAxis, -unit.turret.pitch));
        const arm = model === 'tank' ? 3.0 : 1.9;
        this.offset.set(0, 0, arm * .55).applyQuaternion(this.rotation);
        this.put(barrel, this.rotation, metal, 0, height * .82, .2, model === 'sam' ? .68 : .16,
          model === 'sam' ? .44 : .17, arm * .90, unit.orientation, this.offset);
      } else if (middle && model === 'truck') {
        this.put(hull, unit.orientation, trim, 0, height * .70, length * .30, width * .89, height * .45, length * .30);
      }
      if (near) {
        const tracked = model === 'tank' || model === 'ifv';
        for (const side of [-1, 1]) {
          if (tracked) this.put(hull, unit.orientation, metal, side * width * .42, height * .16, 0,
            width * .21, height * .23, length * .95);
          for (const axle of [-.31, 0, .31]) {
            this.rotation.copy(unit.orientation);
            if (!tracked && axle > 0) this.rotation.multiply(this.secondary.setFromAxisAngle(yAxis, (unit.steering ?? 0) * .4));
            this.rotation.multiply(this.secondary.setFromAxisAngle(xAxis, unit.travel * 1.9));
            this.put(wheel, this.rotation, metal, side * width * .45, height * .16, axle * length,
              width * .22, height * .29, height * .29, unit.orientation);
          }
        }
      }
      const contact = assisted && observer.contacts.get(unit.id);
      if (contact && battle.time - contact.time <= .3) {
        const size = T.MathUtils.clamp(Math.sqrt(distance) * .008, 2.4, 14);
        this.position.copy(contact.position);
        this.put(markers, camera.quaternion, this.markerColors[unit.faction], 0, 5, 0, size, size, size,
          unit.orientation);
      }
    }
    for (const batch of this.batches) {
      batch.visible = batch.count > 0;
      if (batch.visible) {
        batch.instanceMatrix.needsUpdate = true;
        batch.instanceColor.needsUpdate = true;
      }
    }
    this.updateProjectiles(camera, battery);
  }

  put(mesh, rotation, color, x, y, z, sx, sy, sz, locationRotation = rotation, extra) {
    this.transform.position.set(x, y, z).applyQuaternion(locationRotation).add(this.position);
    if (extra) this.transform.position.add(extra);
    this.transform.quaternion.copy(rotation);
    this.transform.scale.set(sx, sy, sz);
    this.transform.updateMatrix();
    mesh.setMatrixAt(mesh.count, this.transform.matrix);
    mesh.setColorAt(mesh.count++, color);
  }

  updateProjectiles(camera, battery) {
    const positions = this.tracers.geometry.attributes.position;
    let vertices = 0;
    for (const round of this.battle.weapons.pool) {
      if (!round.active || round.position.distanceToSquared(camera.position) > 2800 ** 2) continue;
      const { x, y, z } = round.position;
      positions.setXYZ(vertices++, x - round.velocity.x * .029, y - round.velocity.y * .029, z - round.velocity.z * .029);
      positions.setXYZ(vertices++, x, y, z);
    }
    for (let index = 0; index < (battery?.count ?? 0); index++) {
      const { position, velocity } = battery.rounds[index];
      if (position.distanceToSquared(camera.position) > 2900 ** 2) continue;
      positions.setXYZ(vertices++, position.x - velocity.x * .045, position.y - velocity.y * .045, position.z - velocity.z * .045);
      positions.setXYZ(vertices++, position.x, position.y, position.z);
    }
    this.tracers.visible = Boolean(vertices);
    this.tracers.geometry.setDrawRange(0, vertices);
    if (vertices) positions.needsUpdate = true;
  }

  dispose() {
    for (const [mesh, material] of this.thermalMaterials) mesh.material = material;
    this.thermalVehicle.dispose();
    disposeObjects(this.root);
  }
}

function roadGeometry(network, world) {
  const vertices = [];
  const strip = (point, dx, dz) => [point[0] + dx,
    world.heightAt(point[0] + dx, point[1] + dz) + .14, point[1] + dz];
  for (const [from, to] of network.edges) {
    const a = network.points[from];
    const b = network.points[to];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const dx = (b[1] - a[1]) / length * 5.4;
    const dz = (a[0] - b[0]) / length * 5.4;
    const count = Math.ceil(length / 22);
    for (let i = 0; i < count; i++) {
      const first = [T.MathUtils.lerp(a[0], b[0], i / count), T.MathUtils.lerp(a[1], b[1], i / count)];
      const second = [T.MathUtils.lerp(a[0], b[0], (i + 1) / count), T.MathUtils.lerp(a[1], b[1], (i + 1) / count)];
      const left = strip(first, -dx, -dz);
      const right = strip(first, dx, dz);
      const nextLeft = strip(second, -dx, -dz);
      const nextRight = strip(second, dx, dz);
      vertices.push(...left, ...right, ...nextLeft, ...right, ...nextRight, ...nextLeft);
    }
  }
  const shape = new T.BufferGeometry();
  shape.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
  shape.computeVertexNormals();
  return shape;
}
