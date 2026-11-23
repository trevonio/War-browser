import { MathUtils, Vector3 } from 'three';
import { groundLineOfSight } from '../ground/engagement.js';

// Balance for fictional coastal-range stores. Dimensions and timings are game values.
export const precision = {
  laser: { label: 'LASER PRACTICE BOMB', damageKind: 'bomb', drag: .00023, lifetime: 22, maxDistance: 5200,
    radius: 31, damage: 74, reach: 2050, steer: 4.6, speed: 138, minimum: 145 },
  gps: { label: 'COORDINATE GLIDE BOMB', damageKind: 'bomb', drag: .00025, lifetime: 25, maxDistance: 5900,
    radius: 35, damage: 83, reach: 2750, steer: 3.2, speed: 130, minimum: 170 },
  optical: { label: 'OPTICAL STRIKE MISSILE', damageKind: 'rocket', drag: .00012, lifetime: 14, maxDistance: 5200,
    radius: 19, damage: 96, reach: 3350, steer: 6.8, speed: 300, minimum: 240, exit: 74, boost: 3.2, acceleration: 52 },
};
export const guidedWeapon = (type) => Object.hasOwn(precision, type);

export class StrikeGuidance {
  constructor(world) {
    this.world = world;
    this.line = new Vector3();
    this.aim = new Vector3();
    this.forward = new Vector3();
  }

  status(type, rack, pod) {
    const release = rack.releaseState(type);
    if (release !== 'READY') return release;
    if (type === 'laser' && !pod.lasing) return 'LASER REQUIRED';
    if (type === 'gps' && !pod.hasCoordinates) return 'DESIGNATE AREA';
    if (type === 'optical' && (!pod.track?.active || !pod.inside(pod.area))) return 'POINT TRACK REQUIRED';
    const point = type === 'gps' ? pod.coordinates : type === 'laser' ? pod.laserPoint : pod.area;
    this.line.subVectors(point, rack.flight.position);
    const distance = this.line.length();
    const config = precision[type];
    this.forward.set(0, 0, 1).applyQuaternion(rack.flight.orientation);
    const reach = Math.min(config.reach, type === 'optical' ? config.reach : rack.flight.velocity.length()
      * (1.8 + Math.sqrt(Math.max(0, -this.line.y) * .18) * .9));
    if (distance < config.minimum || distance > reach || this.line.y > -25
      || this.line.dot(this.forward) / distance < .57) return 'OUTSIDE RELEASE ZONE';
    return 'CLEARED';
  }

  bind(round, type, pod) {
    round.target = type === 'optical' ? pod.track : null;
    round.pod = type === 'laser' ? pod : null;
    round.designation.copy(type === 'gps' ? pod.coordinates : pod.area);
    round.nextGuide = 0;
    round.seenUntil = .18;
    round.validGuide = true;
  }

  step(round, dt) {
    const config = precision[round.kind];
    if (round.age >= round.nextGuide) {
      round.nextGuide = round.age + .11;
      if (round.pod) {
        const point = round.pod.laserPoint;
        round.validGuide = Boolean(point && point.distanceToSquared(round.designation) < 280 ** 2
          && groundLineOfSight(this.world, round.position, point));
        if (round.validGuide) round.designation.copy(point);
      } else if (round.target) {
        const unit = round.target;
        this.aim.copy(unit.position).y += unit.spec.dimensions[1] * .65;
        this.line.subVectors(this.aim, round.position).normalize();
        if (unit.active && !unit.arrived && this.line.dot(round.velocity) > round.velocity.length() * .48
          && groundLineOfSight(this.world, round.position, this.aim)) {
          round.designation.copy(this.aim);
          round.seenUntil = round.age + .33;
        }
        round.validGuide = round.age <= round.seenUntil;
      }
    }
    if (!round.validGuide || round.age < .19) return;
    this.line.subVectors(round.designation, round.position);
    const speed = round.kind === 'optical' ? Math.min(config.speed, round.velocity.length())
      : Math.max(config.speed, round.velocity.length() * .94);
    this.line.normalize().multiplyScalar(speed);
    round.velocity.lerp(this.line, Math.min(.35, config.steer * dt));
    // The shared ballistic integrator remains responsible for gravity and drag.
    if (round.kind !== 'optical') round.velocity.y = MathUtils.clamp(round.velocity.y, -135, -12);
  }
}
