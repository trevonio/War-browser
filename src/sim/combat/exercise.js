import { Vector3 } from 'three';
import { f16CombatLoadouts } from '../../aircraft/f16-ordnance.js';
import { Countermeasures } from './countermeasures.js';
import { MissilePool } from './missiles.js';
import { Radar } from './radar.js';
import { ThreatReceiver } from './warnings.js';
import { WeaponRack } from './weapons.js';

export const combatExercises = {
  short: {
    label: 'Missile dogfight', description: 'Close-range infrared exercise',
    initialWeapon: 'infrared', opponent: { x: 108, y: 15, z: 2110, speed: 186, heading: Math.PI - 0.051 },
  },
  intercept: {
    label: 'BVR intercept', description: 'Power up the radar and track the inbound contact',
    initialWeapon: 'radar', opponent: { x: 630, y: 70, z: 9660, speed: 204, heading: Math.PI - 0.065 },
  },
};

const profiles = {
  rookie: { opening: 4.2, think: 0.43, react: 0.66, followUp: 3.8 },
  regular: { opening: 2.35, think: 0.29, react: 0.40, followUp: 2.6 },
  veteran: { opening: 1.55, think: 0.18, react: 0.22, followUp: 1.85 },
};

function combatant(world, hull, other) {
  const radar = new Radar(world, hull.flight);
  return {
    flight: hull.flight, hull, candidates: [other.flight], radar, rack: new WeaponRack(hull.flight, radar, world),
    warning: new ThreatReceiver(hull.flight),
  };
}

export class CombatExercise {
  constructor(dogfight, world, effects, loadouts = f16CombatLoadouts) {
    this.dogfight = dogfight;
    this.effects = effects;
    this.loadouts = loadouts;
    const { playerHull, opponentHull } = dogfight;
    this.player = combatant(world, playerHull, opponentHull);
    this.enemy = combatant(world, opponentHull, playerHull);
    this.sides = [this.player, this.enemy];
    this.decoys = new Countermeasures();
    this.missiles = new MissilePool(world, this.decoys, (missile, point, hull, part) => this.burst(missile, point, hull, part));
    this.escape = new Vector3();
    this.approach = new Vector3();
    this.line = new Vector3();
    this.forward = new Vector3();
    this.components = new Map();
    this.override = {};
    this.adjust = (command) => this.adjustOpponent(command);
    this.reset(null);
  }

  reset(exercise, difficulty = 'regular') {
    this.enabled = Boolean(exercise);
    const setup = combatExercises[exercise];
    this.player.rack.reset(this.loadouts[exercise], setup?.initialWeapon);
    this.enemy.rack.reset(this.loadouts[exercise], setup?.initialWeapon);
    const bvr = exercise === 'intercept';
    this.player.radar.reset(false, bvr ? 2 : 0);
    this.enemy.radar.reset(bvr, 2);
    this.player.warning.reset();
    this.enemy.warning.reset();
    this.player.emitters = [this.enemy.radar];
    this.enemy.emitters = [this.player.radar];
    this.decoys.clear();
    this.missiles.clear();
    this.profile = profiles[difficulty] ?? profiles.regular;
    this.opening = this.profile.opening;
    this.nextDecision = 0;
    this.nextWarning = 0;
    this.evadeUntil = 0;
    this.nextEvade = 0;
    this.threatSince = -Infinity;
    this.nextLaunch = this.opening;
  }

  get enemyCannon() {
    return this.enemy.rack.selected === 'cannon' && this.enemy.flight.elapsed >= this.evadeUntil;
  }

  launch(side, opponent, type = side.rack.selected) {
    const launched = side.rack.fire(type, side.flight.elapsed, this.missiles, opponent.hull);
    if (launched) this.effects.launch?.(side === this.player);
    return launched;
  }

  step(dt) {
    const time = this.player.flight.elapsed;
    this.decoys.step(dt, this.dogfight.player.world);
    for (const side of this.sides) {
      side.radar.update(time, side.candidates, this.decoys);
      side.rack.update(time, side.candidates);
    }
    this.missiles.step(dt);
    if (time >= this.nextWarning) {
      this.nextWarning = time + 0.085;
      this.player.warning.update(time, this.player.emitters, this.missiles.pool);
      this.enemy.warning.update(time, this.enemy.emitters, this.missiles.pool);
    }
    if (time >= this.nextDecision && !this.enemy.flight.failure && !this.player.flight.failure) {
      this.nextDecision = time + this.profile.think;
      this.decide(time);
    }
  }

  adjustOpponent(command) {
    const { radar, flight } = this.enemy;
    if (this.dogfight.pilot.status === 'GLIDING' || this.dogfight.pilot.status === 'DISENGAGING') return command;
    if (flight.elapsed < this.evadeUntil) {
      return Object.assign(this.override, command, { aimDirection: this.escape, aimResponsiveness: 1 });
    }
    const contact = radar.track ?? radar.contacts.get(this.player.flight);
    if (!contact || contact.range < 3100) return command;
    this.approach.subVectors(contact.position, flight.position).normalize();
    return Object.assign(this.override, command, { aimDirection: this.approach });
  }

  decide(time) {
    const { radar, rack, flight, warning } = this.enemy;
    const retreat = this.dogfight.pilot.status === 'GLIDING' || this.dogfight.pilot.status === 'DISENGAGING';
    const threat = warning.state === 'ACTIVE SEEKER' ? 'chaff' : this.visibleMissile() ? 'flare' : '';
    if (!threat) this.threatSince = -Infinity;
    else {
      if (this.threatSince === -Infinity) this.threatSince = time;
      if (time > this.threatSince + this.profile.react && time >= this.nextEvade) {
        this.evadeUntil = time + 1.8;
        this.nextEvade = time + 2.4;
        const turn = rack.flare % 2 ? 1 : -1;
        this.escape.set(turn * 0.72, 0.18, 0.86).applyQuaternion(flight.orientation).normalize();
        rack.deploy(threat, time, this.decoys);
      }
    }
    if (retreat || time < this.evadeUntil) {
      rack.select('cannon');
      return;
    }

    const target = this.player.flight;
    const contact = radar.contacts.get(target);
    if (!radar.locked && contact && contact.range > 1000 && rack.count('radar')) {
      radar.selectNext();
      radar.toggleLock();
    }
    const infrared = rack.count('infrared') && rack.seeker.infrared.ready;
    const pulse = rack.count('radar') && rack.seeker.radar.ready;
    const weapon = infrared ? 'infrared' : pulse ? 'radar' : 'cannon';
    rack.select(weapon);
    if (time >= this.nextLaunch && weapon !== 'cannon' && this.launch(this.enemy, this.player)) {
      this.nextLaunch = time + this.profile.followUp;
    }
  }

  visibleMissile() {
    const { flight } = this.enemy;
    this.forward.set(0, 0, 1).applyQuaternion(flight.orientation);
    for (const missile of this.missiles.pool) {
      if (!missile.active || missile.target !== flight || missile.type !== 'infrared') continue;
      this.line.subVectors(missile.position, flight.position);
      if (this.line.lengthSq() < 890 ** 2 && this.line.normalize().dot(this.forward) > 0.32) return true;
    }
    return false;
  }

  burst(missile, point, hull, direct) {
    if (!hull) return this.effects.burst(point, false);
    const { config } = missile;
    this.components.clear();
    for (const part of hull.colliders) {
      if (!part.active) continue;
      const distance = Math.max(0, part.position.distanceTo(point) - part.radius);
      if (distance < (this.components.get(part.component)?.distance ?? config.blast)) {
        this.components.set(part.component, { part, distance });
      }
    }
    if (direct) this.dogfight.hit(direct, config.power * 0.91);
    for (const { part, distance } of this.components.values()) {
      if (hull.incapacitated) break;
      const falloff = (1 - distance / config.blast) ** 2;
      const weight = part.component === 'pilot' ? 0.09 : part.component === 'fuselage' ? 0.52 : 0.33;
      this.dogfight.hit(part, config.power * falloff * weight);
    }
    this.effects.burst(point, true, hull === this.player.hull);
  }
}
