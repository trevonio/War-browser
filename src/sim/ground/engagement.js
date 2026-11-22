import { MathUtils, Vector3 } from 'three';
import { advanceRound, flightExpired, sweepBox, sweepColliders } from '../ballistics.js';
import { turnError } from './vehicles.js';

const { clamp } = MathUtils;
export const groundDifficulty = {
  rookie: { reaction: .95, scan: .62, error: .014, preference: .69, reach: .88 },
  regular: { reaction: .57, scan: .43, error: .009, preference: 1, reach: 1 },
  veteran: { reaction: .32, scan: .32, error: .0055, preference: 1.22, reach: 1.08 },
};

export function opposing(first, second) {
  return first !== second && first !== 'neutral' && second !== 'neutral';
}

export function groundLineOfSight(world, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dz = end.z - start.z;
  const steps = clamp(Math.ceil(Math.hypot(dx, dz) / 32), 3, 34);
  for (const structure of world.structures) {
    if (structure.active !== false && sweepBox(start, end, structure) < Infinity) return false;
  }
  for (let index = 1; index < steps; index++) {
    const fraction = index / steps;
    const x = start.x + dx * fraction;
    const y = start.y + dy * fraction;
    const z = start.z + dz * fraction;
    if (y <= world.heightAt(x, z) + 0.28) return false;
  }
  return true;
}

export class GroundEngagement {
  constructor(world, units, weapons, random) {
    this.world = world;
    this.units = units;
    this.weapons = weapons;
    this.random = random;
    this.eye = new Vector3();
    this.sight = new Vector3();
    this.aim = new Vector3();
    this.lastAim = new Vector3();
  }

  step(unit, time, dt, profile, detail) {
    if (!unit.active || unit.arrived) return;
    if (time >= unit.nextSense) {
      unit.nextSense = time + profile.scan * (detail === 2 ? 1 : detail === 1 ? 1.32 : 1.8);
      this.scan(unit, time, profile);
    }
    if (time >= unit.nextDecision) {
      unit.nextDecision = time + 0.32 + this.random() * 0.14;
      this.choose(unit, time);
    }
    if (unit.spec.weapon) this.aimWeapon(unit, time, dt, profile);
  }

  scan(unit, time, profile) {
    const { position, spec, track } = unit;
    let closest = null;
    let score = Infinity;
    const radius = spec.detection * profile.reach;
    this.eye.copy(position).y += spec.dimensions[1] * .86;
    for (const target of this.units) {
      if (!target.active || target.arrived || !opposing(unit.faction, target.faction)) continue;
      const dx = target.position.x - position.x;
      const dz = target.position.z - position.z;
      const distance = Math.hypot(dx, dz);
      if (distance >= radius) continue;
      const yaw = Math.atan2(dx, dz);
      const arc = target === track ? 2.7 : 2.18;
      if (distance > 50 && Math.abs(turnError(yaw, unit.yaw)) > arc) continue;
      this.sight.copy(target.position).y += target.spec.dimensions[1] * .69;
      if (!groundLineOfSight(this.world, this.eye, this.sight)) continue;
      const preference = (unit.type === 'tank' ? (target.type === 'tank' ? .68 : 1.18)
        : unit.type === 'ifv' && target.type === 'tank' ? 1.7 : 1) ** profile.preference;
      const priority = distance * preference * (target === track ? .58 : 1);
      if (priority >= score) continue;
      closest = target;
      score = priority;
    }
    unit.lineOfSight = Boolean(closest);
    if (!closest) {
      if (time - unit.observedAt >= 3.6 || !unit.track?.active) unit.track = null;
      return;
    }
    if (closest !== track) unit.readyAt = time + profile.reaction * (0.84 + this.random() * .34);
    unit.track = closest;
    unit.observed.copy(closest.position).y += closest.spec.dimensions[1] * .63;
    unit.observedMotion.set(closest.drive.x, closest.drive.dy, closest.drive.z);
    unit.observedAt = time;
  }

  choose(unit, time) {
    const { phase, mobility, canFight, spec, track, objective, position, drive } = unit;
    if (mobility <= 0.02) {
      unit.phase = canFight && track ? 'ENGAGING' : 'DISABLED';
      return;
    }
    if (unit.retreatTo && time < unit.retreatUntil) {
      unit.phase = 'RETREATING';
      return;
    }
    unit.retreatTo = null;
    const distance = track ? unit.observed.distanceTo(position) : Infinity;
    const deteriorating = unit.health.condition('hull') < .35 || unit.health.condition('engine') < .32;
    const pressured = unit.type !== 'tank' && unit.type !== 'truck' && track?.type === 'tank' && distance < 230;
    if (track && (deteriorating || pressured) && objective !== 'deliver' && time >= (unit.recoverAt ?? 0)) {
      const bearing = Math.atan2(position.x - unit.observed.x, position.z - unit.observed.z);
      unit.retreatTo = [position.x + Math.sin(bearing) * 48, position.z + Math.cos(bearing) * 48];
      unit.retreatUntil = time + 4;
      unit.recoverAt = time + 13;
      unit.phase = 'RETREATING';
      return;
    }
    if (canFight && track && unit.lineOfSight && distance < spec.weapon.range * (phase === 'ENGAGING' ? 1 : .91)) {
      unit.phase = 'ENGAGING';
    } else if (drive.detour || (track && !unit.lineOfSight && drive.waypoint < unit.route.length)) {
      unit.phase = 'REPOSITIONING';
    } else if (drive.waypoint < unit.route.length) unit.phase = 'MOVING';
    else unit.phase = track ? 'SEARCHING' : 'IDLE';
  }

  aimWeapon(unit, time, dt, profile) {
    const { turret, track, spec, position } = unit;
    const strength = unit.health.condition('turret');
    if (!track || !track.active || strength <= .10) return;
    const { weapon } = spec;
    const distance = unit.observed.distanceTo(position);
    const duration = Math.min(3.2, distance / weapon.speed) + .10;
    this.aim.copy(unit.observed);
    if (unit.lineOfSight) this.aim.addScaledVector(unit.observedMotion, duration * 0.87);
    this.aim.y += 4.8 * duration ** 2;
    this.aim.sub(position);
    this.aim.y -= spec.dimensions[1] * .82;
    const relative = turnError(Math.atan2(this.aim.x, this.aim.z), unit.yaw);
    const desiredYaw = clamp(relative, -weapon.arc, weapon.arc);
    const desiredPitch = clamp(Math.atan2(this.aim.y, Math.hypot(this.aim.x, this.aim.z)) + unit.pitch,
      -weapon.elevation, weapon.elevation);
    const turning = weapon.traverse * (.48 + strength * .52) * dt;
    turret.yaw += clamp(turnError(desiredYaw, turret.yaw), -turning, turning);
    turret.yaw = turnError(turret.yaw, 0);
    turret.pitch += clamp(desiredPitch - turret.pitch, -turning, turning);
    if (!unit.canFight || unit.phase !== 'ENGAGING' || !unit.lineOfSight || time < unit.readyAt || time < turret.nextShot
      || distance > weapon.range || Math.abs(relative) > weapon.arc
      || Math.abs(turnError(relative, turret.yaw)) > .016 || Math.abs(desiredPitch - turret.pitch) > .018) return;
    unit.weaponPose();
    this.lastAim.copy(track.position).y += track.spec.dimensions[1] * .65;
    if (!groundLineOfSight(this.world, unit.muzzle, this.lastAim)) return;
    const dispersion = profile.error * (1 + (1 - unit.health.condition('weapon')) * 2 + unit.speed * .055);
    if (this.weapons.fire(unit, dispersion, this.random)) {
      turret.ammo--;
      turret.nextShot = time + weapon.reload * (1 + (1 - unit.health.condition('weapon')) * .7);
    }
  }
}

export class GroundProjectiles {
  constructor(world, effects) {
    this.world = world;
    this.effects = effects;
    this.pool = Array.from({ length: 80 }, () => ({
      active: false, position: new Vector3(), previous: new Vector3(), velocity: new Vector3(),
    }));
    this.hit = {};
    this.point = new Vector3();
    this.query = null;
    this.count = 0;
    this.shots = 0;
  }

  clear() {
    for (const round of this.pool) round.active = false;
    this.count = this.shots = 0;
  }

  fire(owner, spread, random) {
    const round = this.pool.find((item) => !item.active);
    if (!round) return false;
    round.active = true;
    round.owner = owner;
    round.profile = owner.spec.weapon;
    round.position.copy(owner.muzzle);
    round.previous.copy(owner.muzzle);
    round.velocity.copy(owner.direction);
    round.velocity.x += (random() * 2 - 1) * spread;
    round.velocity.y += (random() * 2 - 1) * spread;
    round.velocity.z += (random() * 2 - 1) * spread;
    round.velocity.normalize().multiplyScalar(round.profile.speed);
    round.age = round.travel = 0;
    this.count++;
    this.shots++;
    this.effects.shot?.(round.position, owner);
    return true;
  }

  step(dt) {
    if (!this.count) return;
    for (const round of this.pool) {
      if (!round.active) continue;
      advanceRound(round, dt, round.profile);
      const { previous, position } = round;
      const hit = sweepColliders(this.world, previous, position, this.query(previous, position, round.owner), this.hit);
      if (hit.fraction < Infinity) {
        this.point.copy(previous).lerp(position, hit.fraction);
        hit.collider?.damageTarget?.hit(hit.collider.component, round.profile.damage,
          { source: round.owner, kind: 'vehicle', point: this.point });
        this.effects.impact?.(this.point, hit.collider);
      } else if (!flightExpired(round, round.profile)) continue;
      round.active = false;
      this.count--;
    }
  }
}
