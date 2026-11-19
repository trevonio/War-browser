import { Quaternion, Vector3 } from 'three';

export class Cannon {
  constructor(config, mount, ballistics, onShot) {
    this.config = config;
    this.mount = mount;
    this.ballistics = ballistics;
    this.onShot = onShot;
    this.period = 60 / config.rpm;
    this.rotation = new Quaternion();
    this.position = new Vector3();
    this.direction = new Vector3();
    this.velocity = new Vector3();
    this.reset();
  }

  reset() {
    this.ammo = this.config.capacity;
    this.cooldown = 0;
    this.fired = 0;
  }

  step(dt, held, flight) {
    if (!held || this.ammo === 0) {
      this.cooldown = Math.max(0, this.cooldown - dt);
      return;
    }

    while (this.cooldown < dt - 1e-10 && this.ammo > 0) {
      const at = this.cooldown / dt;
      this.rotation.copy(flight.previousOrientation).slerp(flight.orientation, at);
      this.position.copy(this.mount.position).applyQuaternion(this.rotation)
        .addScaledVector(flight.previousPosition, 1 - at).addScaledVector(flight.position, at);
      this.direction.set(0, 0, 1).applyQuaternion(this.mount.quaternion).applyQuaternion(this.rotation);
      this.velocity.copy(this.direction).multiplyScalar(this.config.projectileSpeed)
        .addScaledVector(flight.previousVelocity, 1 - at).addScaledVector(flight.velocity, at);
      this.ammo--;
      const tracer = this.fired++ % this.config.tracerEvery === 0;
      this.ballistics.spawn(this.position, this.velocity, tracer, this.cooldown);
      this.onShot(this.position, this.direction, flight.elapsed - dt + this.cooldown, this.fired);
      this.cooldown += this.period;
    }
    this.cooldown = Math.max(0, this.cooldown - dt);
  }
}
