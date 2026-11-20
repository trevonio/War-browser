import { Object3D, Quaternion, Vector3 } from 'three';

export function cannonMount(config) {
  const mount = new Object3D();
  mount.name = 'Port cannon emitter';
  mount.position.fromArray(config.muzzle);
  mount.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), new Vector3().fromArray(config.bore).normalize());
  return mount;
}

export function worldMuzzle(mount, orientation, position, origin, bore) {
  origin.copy(mount.position).applyQuaternion(orientation).add(position);
  bore.set(0, 0, 1).applyQuaternion(mount.quaternion).applyQuaternion(orientation);
}

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

  step(dt, trigger, flight) {
    if (trigger === true) this.fireWindow(0, dt, dt, flight);
    else if (trigger) {
      for (let i = 0; i < trigger.length; i += 2) this.fireWindow(trigger[i], trigger[i + 1], dt, flight);
    }
    this.cooldown = Math.max(0, this.cooldown - dt);
  }

  fireWindow(start, end, dt, flight) {
    this.cooldown = Math.max(this.cooldown, start);
    while (this.cooldown < end - 1e-10 && this.ammo > 0) {
      const at = this.cooldown / dt;
      this.rotation.copy(flight.previousOrientation).slerp(flight.orientation, at);
      this.velocity.copy(flight.previousPosition).lerp(flight.position, at);
      worldMuzzle(this.mount, this.rotation, this.velocity, this.position, this.direction);
      this.velocity.copy(this.direction).multiplyScalar(this.config.projectileSpeed)
        .addScaledVector(flight.previousVelocity, 1 - at).addScaledVector(flight.velocity, at);
      this.ammo--;
      const tracer = this.fired++ % this.config.tracerEvery === 0;
      this.ballistics.spawn(this.position, this.velocity, tracer, this.cooldown);
      this.onShot(this.position, this.direction, flight.elapsed - dt + this.cooldown, this.fired);
      this.cooldown += this.period;
    }
  }
}
