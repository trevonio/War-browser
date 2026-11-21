import { Vector3 } from 'three';

const types = {
  flare: { duration: 3.6, fall: 19, drag: 1.26, influence: 1.25 },
  chaff: { duration: 5.2, fall: 5, drag: 1.90, influence: 1.10 },
};

export class Countermeasures {
  constructor() {
    this.pool = Array.from({ length: 48 }, () => ({
      active: false, position: new Vector3(), previous: new Vector3(), velocity: new Vector3(),
    }));
    this.position = new Vector3();
    this.velocity = new Vector3();
  }

  clear() {
    for (const decoy of this.pool) decoy.active = false;
  }

  release(flight, type, lane = 1) {
    const decoy = this.pool.find((item) => !item.active);
    const config = types[type];
    if (!decoy || !config) return null;
    decoy.active = true;
    decoy.owner = flight;
    decoy.type = type;
    decoy.config = config;
    decoy.age = 0;
    decoy.signature = config.influence;
    decoy.position.copy(this.position.set(lane * 1.3, -0.68, -3.7).applyQuaternion(flight.orientation).add(flight.position));
    decoy.previous.copy(decoy.position);
    decoy.velocity.copy(this.velocity.set(lane * 22, -18, -23).applyQuaternion(flight.orientation)).add(flight.velocity);
    return decoy;
  }

  step(dt, world) {
    for (const decoy of this.pool) {
      if (!decoy.active) continue;
      decoy.age += dt;
      if (decoy.age >= decoy.config.duration || decoy.position.y < world.heightAt(decoy.position.x, decoy.position.z)) {
        decoy.active = false;
        continue;
      }
      decoy.previous.copy(decoy.position);
      decoy.position.addScaledVector(decoy.velocity, dt);
      decoy.velocity.multiplyScalar(1 / (1 + dt * decoy.config.drag));
      decoy.velocity.y -= decoy.config.fall * dt;
      decoy.signature = decoy.config.influence * (1 - decoy.age / decoy.config.duration);
    }
  }

  interference(target) {
    let strength = 0;
    for (const decoy of this.pool) {
      if (!decoy.active || decoy.type !== 'chaff' || decoy.owner !== target) continue;
      const distance = decoy.position.distanceTo(target.position);
      strength = Math.max(strength, decoy.signature * Math.max(0, 1 - distance / 225) * 0.42);
    }
    return strength;
  }
}
