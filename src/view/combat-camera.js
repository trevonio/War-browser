import { MathUtils, PerspectiveCamera, Vector3 } from 'three';

const UP = new Vector3(0, 1, 0);

export class CombatCamera {
  constructor(world) {
    this.world = world;
    this.camera = new PerspectiveCamera(51, 1, 0.45, 125000);
    this.destination = this.camera.clone();
    this.point = new Vector3();
    this.look = new Vector3();
    this.right = new Vector3();
    this.anchor = new Vector3();
    this.reset();
  }

  reset() {
    this.mode = 'aircraft';
    this.missile = null;
    this.serial = 0;
    this.target = null;
    this.blend = 0;
    this.anchored = 0;
  }

  get observing() {
    return this.mode !== 'aircraft';
  }

  returnToAircraft() {
    this.mode = 'aircraft';
    this.missile = null;
    this.serial = 0;
    this.target = null;
  }

  cycle(owner, pool) {
    if (this.mode === 'missile-chase') {
      this.mode = 'missile-track';
      return;
    }
    if (this.mode === 'missile-track') {
      this.returnToAircraft();
      return;
    }
    let latest;
    for (const missile of pool) {
      if (missile.active && missile.owner === owner && (!latest || missile.serial > latest.serial)) latest = missile;
    }
    if (latest) this.follow(latest, 'missile-chase');
  }

  next(owner, pool) {
    if (!this.missile) return this.cycle(owner, pool);
    let next;
    let first;
    for (const missile of pool) {
      if (!missile.active || missile.owner !== owner) continue;
      if (!first || missile.serial < first.serial) first = missile;
      if (missile.serial > this.serial && (!next || missile.serial < next.serial)) next = missile;
    }
    if (next || first) this.follow(next ?? first, this.mode);
  }

  follow(missile, mode) {
    this.target = null;
    this.missile = missile;
    this.serial = missile.serial;
    this.mode = mode;
  }

  toggleTarget(contact) {
    if (this.mode === 'target') this.returnToAircraft();
    else if (contact) {
      this.returnToAircraft();
      this.mode = 'target';
      this.target = contact.target;
    }
  }

  update(base, aircraft, contact, interpolation, dt) {
    if (this.missile && (!this.missile.active || this.missile.serial !== this.serial)
      || this.mode === 'target' && !contact) this.returnToAircraft();
    if (!this.observing && this.blend < 0.01) return base;
    const camera = this.camera;
    if (this.blend === 0) {
      camera.position.copy(base.position);
      camera.quaternion.copy(base.quaternion);
      camera.fov = base.fov;
    }
    const destination = this.destination;
    destination.up.copy(UP);
    if (this.missile) {
      const missile = this.missile;
      this.point.copy(missile.previous).lerp(missile.position, interpolation);
      if (this.anchored === this.serial) camera.position.sub(this.anchor).add(this.point);
      this.anchor.copy(this.point);
      this.anchored = this.serial;
      this.right.crossVectors(missile.direction, UP).normalize();
      destination.position.copy(this.point).addScaledVector(missile.direction, -16)
        .addScaledVector(this.right, 3.2).addScaledVector(UP, 4.5);
      this.look.copy(this.point).addScaledVector(missile.direction, 20);
      if (this.mode === 'missile-track' && missile.age < missile.trackUntil) {
        this.right.copy(missile.estimate).sub(this.point);
        if (this.right.lengthSq() > 1) this.look.addScaledVector(this.right.normalize(), 22);
      }
      destination.fov = 62;
    } else if (this.mode === 'target') {
      this.anchored = 0;
      destination.position.copy(base.position);
      this.look.copy(contact.position).lerp(aircraft.position, 0.025);
      destination.fov = base.fov;
    } else {
      this.anchored = 0;
      destination.position.copy(base.position);
      destination.quaternion.copy(base.quaternion);
      destination.fov = base.fov;
    }
    if (this.observing) destination.lookAt(this.look);
    const blend = 1 - Math.exp(-9 * dt);
    this.blend = this.observing ? 1 : this.blend * (1 - blend);
    camera.position.lerp(destination.position, blend);
    camera.position.y = Math.max(this.world.heightAt(camera.position.x, camera.position.z) + 1.5, camera.position.y);
    camera.quaternion.slerp(destination.quaternion, blend);
    const fov = MathUtils.lerp(camera.fov, destination.fov, blend);
    if (camera.aspect !== base.aspect || camera.fov !== fov) {
      camera.aspect = base.aspect;
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();
    if (!this.observing && this.blend < 0.01) {
      this.blend = 0;
      return base;
    }
    return camera;
  }
}
