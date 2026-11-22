import { Vector3 } from 'three';

const GRAVITY = 9.80665;

export function sweepSphere(start, end, collider, startFraction = 0, endFraction = 1) {
  const { position, previous, radius } = collider;
  const vx = position.x - previous.x;
  const vy = position.y - previous.y;
  const vz = position.z - previous.z;
  const ax = start.x - previous.x - vx * startFraction;
  const ay = start.y - previous.y - vy * startFraction;
  const az = start.z - previous.z - vz * startFraction;
  const c = ax * ax + ay * ay + az * az - radius * radius;
  if (c <= 0) return 0;
  const dx = end.x - previous.x - vx * endFraction - ax;
  const dy = end.y - previous.y - vy * endFraction - ay;
  const dz = end.z - previous.z - vz * endFraction - az;
  const a = dx * dx + dy * dy + dz * dz;
  const b = ax * dx + ay * dy + az * dz;
  const discriminant = b * b - a * c;
  if (a === 0 || b >= 0 || discriminant < 0) return Infinity;
  const hit = (-b - Math.sqrt(discriminant)) / a;
  return hit <= 1 ? hit : Infinity;
}

export function sweepBox(start, end, { min, max }) {
  let near = 0;
  let far = 1;
  for (let axis = 0; axis < 3; axis++) {
    const from = start.getComponent(axis);
    const delta = end.getComponent(axis) - from;
    if (Math.abs(delta) < 1e-8) {
      if (from < min[axis] || from > max[axis]) return Infinity;
      continue;
    }
    const t0 = (min[axis] - from) / delta;
    const t1 = (max[axis] - from) / delta;
    near = Math.max(near, Math.min(t0, t1));
    far = Math.min(far, Math.max(t0, t1));
    if (near > far) return Infinity;
  }
  return near;
}

export function sweepSurface(start, end, impactY, surfaceAt) {
  if (Math.min(start.y, end.y) > impactY) return Infinity;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dz = end.z - start.z;
  const startClearance = start.y - Math.max(0, surfaceAt(start.x, start.z));
  if (startClearance <= 0) return 0;
  const endClearance = end.y - Math.max(0, surfaceAt(end.x, end.z));
  let far = 1;
  if (endClearance > 0) {
    // One midpoint catches crests on the short segments near the surface.
    if (Math.min(startClearance, endClearance) > 3) return Infinity;
    const middle = surfaceAt(start.x + dx * 0.5, start.z + dz * 0.5);
    if (start.y + dy * 0.5 > Math.max(0, middle)) return Infinity;
    far = 0.5;
  }
  let near = 0;
  for (let i = 0; i < 6; i++) {
    const mid = (near + far) * 0.5;
    const height = surfaceAt(start.x + dx * mid, start.z + dz * mid);
    if (start.y + dy * mid > Math.max(0, height)) near = mid;
    else far = mid;
  }
  return far;
}

export function sweepColliders(world, start, end, colliders, output, startFraction = 0, endFraction = 1) {
  let fraction = sweepSurface(start, end, world.maxTerrainHeight, world.surfaceAt);
  let struck = null;
  for (const collider of colliders) {
    if (collider.active === false) continue;
    const hit = collider.shape === 'sphere'
      ? sweepSphere(start, end, collider, startFraction, endFraction)
      : sweepBox(start, end, collider);
    if (hit < fraction) {
      fraction = hit;
      struck = collider;
    }
  }
  output.fraction = fraction;
  output.collider = struck;
  return output;
}

export function staticImpact(world, start, end, colliders = world.structures) {
  let first = sweepSurface(start, end, world.maxTerrainHeight, world.surfaceAt);
  for (const collider of colliders) {
    if (collider.active !== false && collider.shape === 'box') first = Math.min(first, sweepBox(start, end, collider));
  }
  return first;
}

export function advanceRound(round, dt, config) {
  const step = Math.min(dt, config.lifetime - round.age);
  const speed = round.velocity.length();
  const distance = Math.min(speed * step, config.maxDistance - round.travel);
  const travelTime = speed > 0 ? Math.min(step, distance / speed) : step;
  round.previous.copy(round.position);
  round.position.addScaledVector(round.velocity, travelTime);
  round.position.y -= 0.5 * GRAVITY * travelTime * travelTime;
  round.velocity.multiplyScalar(1 / (1 + config.drag * speed * travelTime));
  round.velocity.y -= GRAVITY * travelTime;
  round.age += travelTime;
  round.travel += distance;
  return travelTime;
}

export function flightExpired(round, config) {
  return round.age >= config.lifetime - 1e-10 || round.travel >= config.maxDistance;
}

export class Ballistics {
  constructor(config, world, onImpact) {
    this.config = config;
    this.world = world;
    this.onImpact = onImpact;
    this.impact = new Vector3();
    this.collision = {};
    this.rounds = Array.from({ length: Math.min(config.capacity, Math.ceil(config.rpm * (config.lifetime + 1 / 60) / 60) + 1) }, () => ({
      position: new Vector3(), previous: new Vector3(), velocity: new Vector3(),
      age: 0, travel: 0, delay: 0, tracer: false,
    }));
    this.clear();
  }

  clear() {
    this.count = 0;
  }

  spawn(origin, velocity, tracer, delay) {
    const round = this.rounds[this.count++];
    round.position.copy(origin);
    round.previous.copy(origin);
    round.velocity.copy(velocity);
    round.tracer = tracer;
    round.delay = delay;
    round.age = 0;
    round.travel = 0;
  }

  // A battlefield can provide nearby colliders for each swept segment.
  step(dt, colliders) {
    const config = this.config;
    const query = typeof colliders === 'function' ? colliders : null;
    for (let i = 0; i < this.count;) {
      const round = this.rounds[i];
      const startFraction = round.delay / dt;
      const travelTime = advanceRound(round, dt - round.delay, config);
      round.delay = 0;

      const { previous, position } = round;
      const { fraction: firstHit, collider: struck } = sweepColliders(this.world, previous, position,
        query ? query(previous, position) : colliders, this.collision, startFraction, startFraction + travelTime / dt);

      if (firstHit < Infinity) {
        this.impact.copy(previous).lerp(position, firstHit);
        const kind = struck?.surface ?? (this.world.surfaceAt(this.impact.x, this.impact.z) > 0 ? 'ground' : 'water');
        this.onImpact(kind, this.impact, struck, round.velocity.length());
      }
      if (firstHit < Infinity || flightExpired(round, config)) {
        this.rounds[i] = this.rounds[--this.count];
        this.rounds[this.count] = round;
      } else {
        i++;
      }
    }
  }
}
