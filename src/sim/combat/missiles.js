import { MathUtils, Vector3 } from 'three';
import { staticImpact, sweepSphere } from '../ballistics.js';
import { hasLineOfSight } from './radar.js';
import { simulatedHeat, weapons } from './weapons.js';

const { clamp } = MathUtils;
const seekerInterval = 0.11;

function createMissile() {
  return {
    active: false, position: new Vector3(), previous: new Vector3(), direction: new Vector3(),
    estimate: new Vector3(), motion: new Vector3(),
  };
}

export class MissilePool {
  constructor(world, countermeasures, onBurst = () => {}) {
    this.world = world;
    this.countermeasures = countermeasures;
    this.onBurst = onBurst;
    this.pool = Array.from({ length: 12 }, createMissile);
    this.course = new Vector3();
    this.turnAxis = new Vector3();
    this.bearing = new Vector3();
    this.point = new Vector3();
    this.fuse = { previous: null, position: null, radius: 0 };
    this.serial = 0;
  }

  clear() {
    for (const missile of this.pool) missile.active = false;
  }

  launch(rack, station, target, hull) {
    const missile = this.pool.find((item) => !item.active);
    if (!missile || !hull || hull.flight !== target) return null;
    const { flight, radar } = rack;
    const config = weapons[station.type];
    missile.active = true;
    missile.serial = ++this.serial;
    missile.type = station.type;
    missile.config = config;
    missile.target = target;
    missile.hull = hull;
    missile.owner = flight;
    missile.radar = radar;
    missile.station = station.name;
    missile.position.fromArray(station.offset).applyQuaternion(flight.orientation).add(flight.position);
    missile.previous.copy(missile.position);
    missile.direction.set(0, 0, 1).applyQuaternion(flight.orientation);
    missile.phase = station.type === 'radar' ? 'MIDCOURSE' : 'INFRARED';
    missile.speed = Math.min(config.speedCap, flight.velocity.length() + 38);
    missile.age = 0;
    missile.nextSample = 0;
    missile.trackUntil = 0.38;
    missile.seeking = false;
    missile.decoyed = false;
    missile.emitting = false;
    const track = station.type === 'radar' ? radar.track : target;
    missile.estimate.copy(track.position);
    missile.motion.copy(track.velocity);
    return missile;
  }

  step(dt) {
    for (const missile of this.pool) {
      if (!missile.active) continue;
      this.advance(missile, dt);
    }
  }

  advance(missile, dt) {
    const { config, target } = missile;
    missile.age += dt;
    if (missile.age > config.life || missile.speed < 52) {
      missile.active = false;
      return;
    }
    if (missile.age >= missile.nextSample) {
      missile.nextSample = missile.age + seekerInterval;
      this.sample(missile);
    }
    if (missile.age < missile.trackUntil && missile.age >= 0.16) {
      this.course.copy(missile.estimate).addScaledVector(missile.motion, 0.16).sub(missile.position).normalize();
      this.turnAxis.crossVectors(missile.direction, this.course);
      if (this.turnAxis.lengthSq() > 1e-9) {
        const angle = Math.acos(clamp(missile.direction.dot(this.course), -1, 1));
        const authority = clamp(missile.speed / 290, 0.25, 1);
        missile.direction.applyAxisAngle(this.turnAxis.normalize(), Math.min(angle, config.turnRate * authority * dt));
      }
    } else {
      missile.direction.y -= 0.020 * dt;
      missile.direction.normalize();
    }
    missile.speed = clamp(missile.speed + ((missile.age < config.burn ? config.thrust / config.mass : 0)
      - missile.speed * config.damping) * dt, 0, config.speedCap);
    missile.previous.copy(missile.position);
    missile.position.addScaledVector(missile.direction, missile.speed * dt);
    missile.estimate.addScaledVector(missile.motion, dt);

    const terrain = staticImpact(this.world, missile.previous, missile.position);
    let hit = terrain;
    let component = null;
    let airburst = false;
    if (missile.age > 0.24 && !target.failure) {
      for (const collider of missile.hull.colliders) {
        if (!collider.active) continue;
        const at = sweepSphere(missile.previous, missile.position, collider);
        if (at < hit) {
          hit = at;
          component = collider;
          airburst = true;
        }
      }
      this.fuse.position = target.position;
      this.fuse.previous = target.previousPosition;
      this.fuse.radius = config.fuse;
      const at = sweepSphere(missile.previous, missile.position, this.fuse);
      if (!airburst && at < hit) {
        hit = at;
        airburst = true;
      }
    }
    if (hit === Infinity) return;
    this.point.copy(missile.previous).lerp(missile.position, hit);
    missile.active = false;
    this.onBurst(missile, this.point, airburst ? missile.hull : null, component);
  }

  sample(missile) {
    const { config, target, position, direction } = missile;
    if (missile.phase === 'MIDCOURSE') {
      const track = missile.radar.track;
      if (!missile.owner.failure && track?.target === target
        && missile.owner.elapsed - track.time < 0.42) {
        missile.estimate.copy(track.position);
        missile.motion.copy(track.velocity);
        missile.trackUntil = missile.age + 0.45;
      }
      if (missile.estimate.distanceTo(position) > config.terminalRange || missile.age < 0.70) return;
      missile.phase = 'ACTIVE';
    }
    const radar = missile.phase === 'ACTIVE';
    const maxRange = radar ? config.terminalRange * 1.24 : config.maxRange * 1.22;
    const score = this.signal(missile, target.position, maxRange);
    missile.emitting = radar && score > 0 && !target.failure;
    let best = target.failure ? 0 : score * (radar ? 0.88 : simulatedHeat(target));
    let choice = best > 0.04 ? target : null;
    for (const decoy of this.countermeasures.pool) {
      if (!decoy.active || decoy.owner !== target || decoy.type !== (radar ? 'chaff' : 'flare')) continue;
      const decoyScore = this.signal(missile, decoy.position, maxRange) * decoy.signature * config.decoyBias;
      if (decoyScore > best + 0.12) {
        choice = decoy;
        best = decoyScore;
      }
    }
    missile.seeking = Boolean(choice);
    missile.decoyed = Boolean(choice && choice !== target);
    if (choice) {
      missile.estimate.copy(choice.position);
      missile.motion.copy(choice.velocity);
      missile.trackUntil = missile.age + 0.26;
    }
  }

  signal(missile, point, maxRange) {
    this.bearing.subVectors(point, missile.position);
    const distance = this.bearing.length();
    if (distance < 0.01 || distance > maxRange) return 0;
    const aim = this.bearing.dot(missile.direction) / distance;
    if (aim < missile.config.keeperArc || !hasLineOfSight(this.world, missile.position, point)) return 0;
    return aim / (0.7 + distance / maxRange);
  }
}
