import { MathUtils, Vector3 } from 'three';
import { advanceRound, flightExpired, staticImpact } from './ballistics.js';
import { worldMuzzle } from './cannon.js';
import { STEP } from './flight.js';

const { clamp } = MathUtils;
export const sightInterval = 0.085;

export class GunComputer {
  constructor(config, mount, world) {
    this.config = config;
    this.mount = mount;
    this.world = world;
    this.origin = new Vector3();
    this.bore = new Vector3();
    this.aim = new Vector3();
    this.error = new Vector3();
    this.relative = new Vector3();
    this.point = new Vector3();
    this.round = { position: new Vector3(), previous: new Vector3(), velocity: new Vector3(), travel: 0, age: 0 };
  }

  setup(flight) {
    worldMuzzle(this.mount, flight.orientation, flight.position, this.origin, this.bore);
    this.valid = false;
    this.time = 0;
    this.range = 0;
  }

  load(direction, inheritedVelocity) {
    this.round.position.copy(this.origin);
    this.round.velocity.copy(direction).multiplyScalar(this.config.projectileSpeed).add(inheritedVelocity);
    this.round.age = this.round.travel = 0;
  }

  impact(flight) {
    this.setup(flight);
    this.load(this.bore, flight.velocity);
    const round = this.round;
    while (!flightExpired(round, this.config)) {
      const dt = advanceRound(round, STEP, this.config);
      const hit = staticImpact(this.world, round.previous, round.position);
      if (hit === Infinity) continue;
      this.point.copy(round.previous).lerp(round.position, hit);
      this.time = round.age - dt * (1 - hit);
      this.range = this.origin.distanceTo(this.point);
      this.valid = true;
      break;
    }
    return this.valid;
  }

  lead(flight, track) {
    this.setup(flight);
    if (!track) return false;
    const { position, velocity } = track;
    this.relative.subVectors(velocity, flight.velocity);
    this.aim.subVectors(position, this.origin);
    const range = this.aim.length();
    if (range < 25 || range > this.config.maxDistance || this.aim.normalize().dot(this.bore) < 0.90) return false;
    const muzzleSpeed = this.config.projectileSpeed;
    let time = clamp(range / Math.max(100, muzzleSpeed - this.relative.dot(this.aim)), STEP, this.config.lifetime);
    this.aim.addScaledVector(this.relative, time / range).normalize();
    const round = this.round;
    for (let attempt = 0; attempt < 5; attempt++) {
      this.load(this.aim, flight.velocity);
      while (round.age < time - 1e-9 && !flightExpired(round, this.config)) {
        advanceRound(round, Math.min(STEP, time - round.age), this.config);
      }
      this.error.copy(position).addScaledVector(velocity, round.age).sub(round.position);
      if (this.error.lengthSq() < 4 && this.aim.dot(this.bore) > 0.82) {
        this.point.copy(this.origin).addScaledVector(this.aim, range);
        this.range = range;
        this.time = round.age;
        this.valid = true;
        return true;
      }
      const closing = Math.max(100, round.velocity.dot(this.aim) - velocity.dot(this.aim));
      const along = this.error.dot(this.aim);
      time = clamp(time + along / closing, STEP, this.config.lifetime);
      this.aim.addScaledVector(this.error.addScaledVector(this.aim, -along), 1 / Math.max(100, muzzleSpeed * round.age * 0.85))
        .normalize();
    }
    return false;
  }
}

// An optical track samples apparent direction and size. The track estimates
// velocity from successive observations and never receives target telemetry.
export class VisualTrack {
  constructor() {
    this.position = new Vector3();
    this.velocity = new Vector3();
    this.sample = new Vector3();
    this.lastPosition = new Vector3();
    this.measuredVelocity = new Vector3();
    this.reset();
  }

  reset() {
    this.observedAt = -Infinity;
    this.count = 0;
    this.velocity.set(0, 0, 0);
  }

  observe(time, origin, bearing, apparentSize, span) {
    const range = Math.round(span / (Math.max(1e-4, apparentSize) * 4)) * 2;
    const elapsed = time - this.observedAt;
    if (elapsed < 0.16) {
      this.position.copy(this.lastPosition).addScaledVector(this.velocity, elapsed);
      return this.count >= 3 ? this : null;
    }
    if (elapsed > 0.40) this.reset();
    this.sample.copy(origin).addScaledVector(bearing, range);
    if (this.count) {
      this.measuredVelocity.subVectors(this.sample, this.lastPosition).multiplyScalar(1 / elapsed);
      this.velocity.lerp(this.measuredVelocity, this.count === 1 ? 1 : 0.48);
    }
    this.position.copy(this.sample);
    this.lastPosition.copy(this.sample);
    this.observedAt = time;
    this.count++;
    return this.count >= 3 ? this : null;
  }
}
