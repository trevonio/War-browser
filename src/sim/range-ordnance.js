import { Euler, Quaternion, Vector3 } from 'three';
import { advanceRound, flightExpired, sweepColliders } from './ballistics.js';

const dt = 1 / 120;
// Simulation tuning for the practice range. These are not weapon data.
const profiles = {
  bomb: { drag: 0.00028, lifetime: 19, maxDistance: 6000, radius: 34, damage: 64 },
  rocket: { drag: 0.00062, lifetime: 8, maxDistance: 3900, radius: 13, damage: 25, boost: 0.8, acceleration: 104, exit: 94 },
  tank: { drag: 0.00054, lifetime: 16, maxDistance: 4600 },
};

const makeRound = () => ({
  position: new Vector3(), previous: new Vector3(), velocity: new Vector3(), direction: new Vector3(),
  age: 0, travel: 0, active: false, kind: '',
});

export class RangeOrdnance {
  constructor(world, impact, launch = () => {}) {
    this.world = world;
    this.onImpact = impact;
    this.onLaunch = launch;
    this.rounds = Array.from({ length: 48 }, makeRound);
    this.prediction = makeRound();
    this.point = new Vector3();
    this.rotation = new Quaternion();
    this.euler = new Euler();
    this.hit = {};
    this.clear();
  }

  clear() {
    this.pending = 0;
    this.next = 0;
    this.bombs = this.rockets = this.tanks = 0;
    for (const item of this.rounds) item.active = false;
  }

  initialize(round, kind, flight, station) {
    round.kind = kind;
    round.age = round.travel = 0;
    const profile = profiles[kind];
    this.rotation.setFromEuler(this.euler.fromArray(station.rotation)).premultiply(flight.orientation);
    round.direction.set(0, 0, 1).applyQuaternion(this.rotation);
    round.position.fromArray(station.offset).applyQuaternion(flight.orientation).add(flight.position);
    round.position.add(this.point.fromArray(station.release).applyQuaternion(flight.orientation));
    round.previous.copy(round.position);
    round.velocity.copy(flight.velocity).addScaledVector(round.direction, profile.exit ?? 0);
  }

  spawn(kind, flight, station) {
    const round = this.rounds.find((item) => !item.active);
    if (!round) return false;
    this.initialize(round, kind, flight, station);
    round.active = true;
    this.onLaunch(kind, round.position, round.direction);
    return true;
  }

  release(rack, kind, mode) {
    if (this.pending || rack.releaseState(kind) !== 'READY') return 0;
    const station = rack.station(kind);
    if (!this.releaseFrom(rack, kind, station)) return 0;
    let released = 1;
    if (mode === 'pair' && kind === 'bomb') {
      const partner = rack.stations.find((item) => item !== station && item.type === kind && item.symmetry === station.symmetry
        && item.remaining && !item.used && rack.flight.damage.condition(item.wing) > 0);
      if (partner && this.releaseFrom(rack, kind, partner)) released++;
    }
    if (mode === 'burst') {
      this.pending = Math.min(kind === 'bomb' ? 3 : 4, rack.count(kind));
      this.pendingKind = kind;
      this.next = rack.flight.elapsed + (kind === 'bomb' ? 0.20 : 0.11);
    }
    return released;
  }

  releaseFrom(rack, kind, station) {
    if (!this.spawn(kind, rack.flight, station)) return false;
    rack.consume(station);
    if (kind === 'bomb') this.bombs++;
    if (kind === 'rocket') this.rockets++;
    return true;
  }

  jettison(rack) {
    const { flight } = rack;
    const station = rack.station('tank');
    if (!station || flight.failure || flight.grounded || !this.spawn('tank', flight, station)) return false;
    rack.consume(station);
    this.tanks++;
    return true;
  }

  advance(round, seconds) {
    const profile = profiles[round.kind];
    if (profile.boost && round.age < profile.boost) {
      round.velocity.addScaledVector(round.direction, profile.acceleration * Math.min(seconds, profile.boost - round.age));
    }
    advanceRound(round, seconds, profile);
  }

  step(seconds, rack, colliders) {
    if (this.pending && rack.flight.elapsed >= this.next) {
      const kind = this.pendingKind;
      if (rack.releaseState(kind) === 'READY' && this.releaseFrom(rack, kind, rack.station(kind))) {
        this.pending--;
        this.next = rack.flight.elapsed + (kind === 'bomb' ? 0.20 : 0.11);
      } else this.pending = 0;
    }
    for (const round of this.rounds) {
      if (!round.active) continue;
      this.advance(round, seconds);
      const nearby = typeof colliders === 'function' ? colliders(round.previous, round.position) : colliders;
      const hit = sweepColliders(this.world, round.previous, round.position, nearby, this.hit);
      if (hit.fraction < Infinity) {
        round.active = false;
        this.point.copy(round.previous).lerp(round.position, hit.fraction);
        this.onImpact(round.kind, this.point, hit.collider, profiles[round.kind]);
      } else if (flightExpired(round, profiles[round.kind])) round.active = false;
    }
  }

  predict(kind, flight, station, colliders, output) {
    if (!station || flight.failure || flight.grounded) return false;
    const round = this.prediction;
    const profile = profiles[kind];
    this.initialize(round, kind, flight, station);
    while (!flightExpired(round, profile)) {
      this.advance(round, dt);
      const hit = sweepColliders(this.world, round.previous, round.position, colliders, this.hit);
      if (hit.fraction < Infinity) {
        output.copy(round.previous).lerp(round.position, hit.fraction);
        return true;
      }
    }
    return false;
  }

  get active() { return this.pending || this.rounds.some((round) => round.active); }
}

export function applyGroundImpact(kind, point, collider, profile, targets) {
  if (!profile.radius) return;
  for (const target of targets) {
    if (!target.active || target.arrived) continue;
    const direct = target === collider || target === collider?.vehicle;
    const distance = Math.max(0, target.position.distanceTo(point) - target.radius);
    if (!direct && distance >= profile.radius) continue;
    const amount = profile.damage * (direct ? 1.25 : (1 - distance / profile.radius));
    const part = direct ? collider.component : (target.component ?? 'hull');
    target.damageTarget.hit(part, amount, { source: 'player', kind, point, direct });
  }
}
