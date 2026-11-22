import { MathUtils, Quaternion, Vector3 } from 'three';
import { ComponentHealth } from '../component-health.js';

const { clamp, euclideanModulo } = MathUtils;
export const turnError = (target, current) => euclideanModulo(target - current + Math.PI, 2 * Math.PI) - Math.PI;

// Fictional balance values for the coastal missions.
const gun = (damage, range, speed, reload, ammo, traverse, arc = Math.PI) => ({
  damage, range, speed, reload, ammo, traverse, arc, elevation: 0.37, drag: 0.00005, lifetime: 4,
  get maxDistance() { return this.range * 1.18; },
});
const vehicle = (name, dimensions, mass, speed, acceleration, turn, armor, capacity, weapon, detection, tactics) => ({
  name, dimensions, model: tactics, mass, speed, acceleration, turn, armor, capacity, weapon, detection, tactics,
  braking: acceleration * 1.75, slope: tactics === 'truck' ? 0.22 : 0.30,
});
export const groundVehicles = {
  tank: vehicle('Tank', [4.0, 2.8, 7.0], 42, 16, 4, 0.61, [9, 4, 2, 1], 66, gun(24, 670, 265, 2.2, 20, 0.72), 820, 'tank'),
  ifv: vehicle('Infantry fighting vehicle', [3.6, 2.8, 6.2], 28, 22, 5.5, 0.84, [4, 2, 1, 0.7], 48, gun(12, 580, 290, 0.8, 34, 1.23), 745, 'ifv'),
  apc: vehicle('Armored personnel carrier', [3.3, 2.6, 5.8], 18, 24, 6, 0.78, [2, 1, 0.7, 0.5], 38, gun(7, 390, 242, 0.64, 30, 1.42, 2.4), 580, 'apc'),
  truck: vehicle('Transport truck', [3.0, 2.9, 6.1], 12, 25, 6.5, 0.58, [0.25, 0.15, 0.1, 0.1], 26, null, 340, 'truck'),
};

const componentWeights = { hull: 1, engine: 0.43, runningGear: 0.43, turret: 0.37, weapon: 0.33, ammo: 0.42, crew: 0.60 };
const axisX = new Vector3(1, 0, 0);
const axisY = new Vector3(0, 1, 0);
const axisZ = new Vector3(0, 0, 1);

export class GroundVehicle {
  constructor(world, definition, spec, onDamage) {
    const { id, type, faction, x, z, yaw, route, objective } = definition;
    this.id = id;
    this.type = type;
    this.classification = spec.name;
    this.name = spec.name;
    this.faction = faction;
    this.spec = spec;
    this.world = world;
    this.route = route;
    this.objective = objective;
    this.formation = definition.formation ?? null;
    this.position = new Vector3(x, world.heightAt(x, z), z);
    this.previous = this.position.clone();
    this.orientation = new Quaternion();
    this.yaw = yaw;
    this.pitch = this.roll = 0;
    this.speed = this.travel = 0;
    this.phase = 'MOVING';
    this.active = true;
    this.radius = Math.hypot(spec.dimensions[0], spec.dimensions[2]) * 0.5;
    this.onDamage = onDamage;
    this.health = new ComponentHealth(Object.fromEntries(Object.entries(componentWeights)
      .map(([part, weight]) => [part, { capacity: spec.capacity * weight }])));
    this.damageTarget = { hit: (part, amount, context) => this.hit(part, amount, context) };
    this.probe = new Vector3();
    this.inverse = new Quaternion();
    this.rotation = new Quaternion();
    this.muzzle = new Vector3();
    this.direction = new Vector3();
    this.turret = { yaw: 0, pitch: 0, ammo: spec.weapon?.ammo ?? 0, nextShot: 0 };
    this.drive = { x: 0, z: 0, dy: 0, planAt: 0, stuck: 0, progressAt: 0, waypoint: 0, result: null };
    this.track = null;
    this.observed = new Vector3();
    this.observedMotion = new Vector3();
    this.nextDecision = this.nextSense = 0;
    this.observedAt = -Infinity;
    const [width, height, length] = spec.dimensions;
    this.colliders = [
      ['hull', 0, height * 0.43, length * 0.19, width * 0.55],
      ['engine', 0, height * 0.37, -length * 0.30, width * 0.41],
      ['runningGear', width * 0.40, height * 0.18, 0, width * 0.33],
      ['runningGear', -width * 0.40, height * 0.18, 0, width * 0.33],
      [spec.weapon ? 'turret' : 'crew', 0, height * 0.83, 0, width * 0.35],
    ].map(([component, x, y, z, radius]) => ({
      shape: 'sphere', surface: 'metal', active: true, component, radius, vehicle: this,
      offset: new Vector3(x, y, z), position: new Vector3(), previous: new Vector3(),
      damageTarget: this.damageTarget,
    }));
    this.syncPose();
    for (const part of this.colliders) part.previous.copy(part.position);
  }

  get mobility() { return Math.min(this.health.condition('engine'), this.health.condition('runningGear')); }
  get canFight() {
    return this.active && this.turret.ammo > 0 && this.health.condition('weapon') > 0.12 && this.health.condition('turret') > 0.10;
  }
  get disabled() { return !this.active || this.mobility <= 0.02; }

  syncPose() {
    this.orientation.setFromAxisAngle(axisY, this.yaw)
      .multiply(this.rotation.setFromAxisAngle(axisX, this.pitch))
      .multiply(this.rotation.setFromAxisAngle(axisZ, this.roll));
    for (const part of this.colliders) {
      part.previous.copy(part.position);
      part.position.copy(part.offset).applyQuaternion(this.orientation).add(this.position);
    }
  }

  weaponPose() {
    const height = this.spec.dimensions[1];
    const angle = this.yaw + this.turret.yaw;
    const rise = this.turret.pitch - this.pitch;
    this.direction.set(Math.sin(angle) * Math.cos(rise), Math.sin(rise), Math.cos(angle) * Math.cos(rise));
    this.muzzle.set(0, height * 0.82, 0.20).applyQuaternion(this.orientation).add(this.position)
      .addScaledVector(this.direction, this.type === 'tank' ? 3.0 : 1.9);
  }

  hit(part, amount, context = {}) {
    if (!this.active || amount <= 0) return false;
    const { point, kind = 'vehicle', direct = true } = context;
    let zone = 1;
    if (point) {
      this.probe.copy(point).sub(this.position).applyQuaternion(this.inverse.copy(this.orientation).invert());
      if (this.probe.y > this.spec.dimensions[1] * 0.88) zone = 3;
      else if (Math.abs(this.probe.z) > Math.abs(this.probe.x) * 1.18) zone = this.probe.z > 0 ? 0 : 2;
    }
    const scale = kind === 'cannon' ? 0.35 : kind === 'bomb' ? 0.44 : kind === 'rocket' ? 0.81 : 1;
    const effective = Math.max(0, amount - this.spec.armor[zone] * scale);
    if (!effective) {
      this.onDamage(this, { ...context, kind, zone, part, amount: 0 }, false);
      return false;
    }

    if (!direct && point) {
      part = kind === 'bomb' ? (zone === 3 ? 'turret' : 'runningGear') : 'hull';
    }
    const spill = this.health.wear(part, effective * (kind === 'cannon' ? 0.82 : 0.7));
    if (part !== 'hull') this.health.wear('hull', effective * 0.48 + spill * 0.62);
    if (part === 'hull' && zone === 3 && kind !== 'cannon') this.health.wear('ammo', effective * 0.26);
    if (part === 'turret') this.health.wear('weapon', effective * 0.26);
    if (part === 'engine' && kind !== 'cannon') this.health.wear('ammo', effective * 0.11);

    const destroyed = this.health.condition('hull') === 0 || this.health.condition('crew') === 0
      || this.health.condition('ammo') === 0;
    if (destroyed) {
      this.active = false;
      this.phase = 'DESTROYED';
      this.speed = 0;
      for (const shape of this.colliders) shape.active = false;
    } else if (this.mobility <= 0.02 && !this.canFight) {
      this.phase = 'DISABLED';
    }
    this.onDamage(this, { ...context, kind, zone, part, amount: effective }, destroyed);
    return destroyed;
  }

  steer(yaw, seconds) {
    this.yaw = euclideanModulo(this.yaw + clamp(turnError(yaw, this.yaw),
      -this.spec.turn * seconds, this.spec.turn * seconds) + Math.PI, 2 * Math.PI) - Math.PI;
  }
}
