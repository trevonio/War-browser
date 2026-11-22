import { availablePresets, missionLoadout } from '../loadouts.js';
import { Vector3 } from 'three';
import { Countermeasures } from './countermeasures.js';
import { MissilePool } from './missiles.js';
import { hasLineOfSight, Radar } from './radar.js';
import { ThreatReceiver } from './warnings.js';
import { WeaponRack, weapons } from './weapons.js';

export const combatExercises = {
  short: {
    label: 'Missile dogfight',
    initialWeapon: 'infrared', opponent: { x: 108, y: 15, z: 2110, speed: 186, heading: Math.PI - 0.051 },
  },
  outnumbered: {
    label: 'Outnumbered',
    initialWeapon: 'radar', cannonLimit: 260,
    opponent: { x: -480, y: -100, z: 5490, speed: 209, heading: Math.PI + 0.087 },
    wingman: { x: 1620, y: 285, z: 7940, speed: 206, heading: Math.PI - 0.202 },
  },
  intercept: {
    label: 'BVR intercept',
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
  constructor(dogfight, world, effects, loadouts = null, wingman = null) {
    this.dogfight = dogfight;
    this.effects = effects;
    this.loadouts = loadouts;
    const { playerHull, opponentHull } = dogfight;
    this.player = combatant(world, playerHull, opponentHull);
    const alliesOfOpponent = Array.isArray(wingman) ? wingman : wingman ? [wingman] : [];
    this.allEnemies = [dogfight, ...alliesOfOpponent].map((fight) => {
      const side = combatant(world, fight.opponentHull, playerHull);
      return Object.assign(side, {
        fight, escape: new Vector3(), approach: new Vector3(), override: {},
        adjust: (command) => this.adjustOpponent(command, side),
      });
    });
    [this.enemy] = this.allEnemies;
    this.structures = world.structures;
    this.decoys = new Countermeasures();
    this.missiles = new MissilePool(world, this.decoys, (missile, point, hull, part) => this.burst(missile, point, hull, part));
    this.line = new Vector3();
    this.forward = new Vector3();
    this.components = new Map();
    this.adjust = this.enemy.adjust;
    this.reset(null);
  }

  reset(exercise, difficulty = 'regular', opponentCount) {
    this.enabled = Boolean(exercise);
    const setup = combatExercises[exercise];
    this.enemies = this.allEnemies.slice(0, opponentCount ?? (setup?.wingman ? 2 : 1));
    this.sides = [this.player, ...this.enemies];
    this.player.candidates = this.enemies.map((side) => side.flight);
    this.player.emitters = this.enemies.map((side) => side.radar);
    this.shotTargets = [...this.structures, ...this.enemies.flatMap((side) => side.hull.colliders)];
    this.player.rack.reset((this.loadouts ?? this.player.flight.spec.loadouts)?.[exercise], setup?.initialWeapon);
    const bvr = exercise === 'intercept' || exercise === 'outnumbered';
    this.player.radar.reset(false, bvr ? 2 : 0);
    this.player.warning.reset();
    this.profile = profiles[difficulty] ?? profiles.regular;
    for (const [index, side] of this.allEnemies.entries()) {
      const spec = side.flight.spec;
      const preset = (index === 0 ? setup?.opponent : setup?.wingman)?.loadoutPreset;
      const assignment = preset && availablePresets(spec)[preset];
      const loadout = assignment && missionLoadout(spec, assignment, exercise);
      side.rack.reset(loadout || (this.loadouts ?? spec.loadouts)?.[exercise], setup?.initialWeapon);
      side.radar.reset(bvr && this.enemies.includes(side), 2);
      side.warning.reset();
      side.emitters = [this.player.radar];
      side.nextDecision = index * 0.11;
      side.recovering = false;
      side.evadeUntil = 0;
      side.nextEvade = 0;
      side.threatSince = -Infinity;
      side.nextLaunch = this.profile.opening + index * 2.5;
    }
    this.decoys.clear();
    this.missiles.clear();
    this.nextWarning = 0;
    this.cannonHits = 0;
    this.missilesLaunched = 0;
    this.missileHits = 0;
  }

  get nextLaunch() { return this.enemy.nextLaunch; }
  set nextLaunch(value) { this.enemy.nextLaunch = value; }

  get enemyCannon() { return this.canFireCannon(this.enemy); }

  canFireCannon(side) {
    return side.rack.selected === 'cannon' && side.flight.elapsed >= side.evadeUntil;
  }

  get enemiesDown() {
    return this.enemies.reduce((count, side) => count + Number(side.hull.incapacitated), 0);
  }

  finish() {
    const won = this.enemiesDown === this.enemies.length;
    const lost = this.player.hull.incapacitated;
    return won && lost ? 'draw' : won ? 'win' : lost ? 'loss' : '';
  }

  hit(collider, damage, scale) {
    const side = this.enemies.find((enemy) => enemy.hull === collider.hull);
    return (side?.fight ?? this.dogfight).hit(collider, damage, scale);
  }

  launch(side, opponent, type = side.rack.selected) {
    if (side === this.player && type !== 'cannon') {
      opponent = this.enemies.find((enemy) => enemy.flight === side.rack.seeker[type]?.target);
    }
    const launched = side.rack.fire(type, side.flight.elapsed, this.missiles, opponent?.hull);
    if (launched) {
      const own = side === this.player;
      if (own) this.missilesLaunched++;
      this.effects.launch?.(own, weapons[type].launchCue, side.flight.position);
    }
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
      for (const side of this.sides) side.warning.update(time, side.emitters, this.missiles.pool);
    }
    for (const side of this.enemies) {
      if (time < side.nextDecision || side.flight.failure || this.player.flight.failure) continue;
      side.nextDecision = time + this.profile.think;
      this.decide(time, side);
    }
  }

  adjustOpponent(command, side) {
    const { radar, flight, fight, override, escape, approach } = side;
    if (fight.pilot.status === 'GLIDING' || fight.pilot.status === 'DISENGAGING') return command;
    if (flight.elapsed < side.evadeUntil) {
      return Object.assign(override, command, { aimDirection: escape, aimResponsiveness: 1 });
    }
    const contact = radar.track ?? radar.contacts.get(this.player.flight);
    if (side.recovering) {
      approach.set(flight.velocity.x, flight.velocity.y, flight.velocity.z).normalize();
      approach.y = Math.min(approach.y, -0.13);
      return Object.assign(override, command, { aimDirection: approach.normalize(), aimResponsiveness: 0.7, throttle: 1, brakes: false });
    }
    if (!contact || contact.range < 3100) return command;
    approach.subVectors(contact.position, flight.position);
    // Level out the climb between long-range observations to retain speed.
    approach.y = Math.min(approach.y, contact.range * (flight.spool > 0.88 ? 0.25 : 0.11));
    approach.normalize();
    return Object.assign(override, command, { aimDirection: approach });
  }

  decide(time, side) {
    const { radar, rack, flight, warning, fight } = side;
    const retreat = fight.pilot.status === 'GLIDING' || fight.pilot.status === 'DISENGAGING';
    const speed = flight.velocity.length();
    const { x, y, z } = flight.position;
    const groundClearance = y - this.dogfight.player.world.heightAt(x + flight.velocity.x * 2, z + flight.velocity.z * 2);
    side.recovering = !flight.grounded && groundClearance > 580 && speed < flight.spec.controlSpeed * (side.recovering ? 1.47 : 1.22);
    const threat = warning.state === 'ACTIVE SEEKER' ? 'chaff' : this.visibleMissile(flight) ? 'flare' : '';
    if (!threat) side.threatSince = -Infinity;
    else {
      if (side.threatSince === -Infinity) side.threatSince = time;
      if (time > side.threatSince + this.profile.react && time >= side.nextEvade) {
        side.evadeUntil = time + 1.8;
        side.nextEvade = time + 2.4;
        const turn = rack.flare % 2 ? 1 : -1;
        side.escape.set(turn * 0.72, 0.18, 0.86).applyQuaternion(flight.orientation).normalize();
        rack.deploy(threat, time, this.decoys);
      }
    }
    if (retreat || side.recovering || time < side.evadeUntil) {
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
    const pulse = rack.count('radar') && radar.track?.quality >= 0.47 && rack.seeker.radar.ready;
    const weapon = infrared ? 'infrared' : pulse ? 'radar' : 'cannon';
    rack.select(weapon);
    const inFlight = this.missiles.pool.some((missile) => missile.active && missile.owner === flight);
    if (time >= side.nextLaunch && !inFlight && weapon !== 'cannon' && this.launch(side, this.player)) {
      side.nextLaunch = time + this.profile.followUp;
    }
  }

  visibleMissile(flight) {
    this.forward.set(0, 0, 1).applyQuaternion(flight.orientation);
    for (const missile of this.missiles.pool) {
      if (!missile.active || missile.target !== flight || missile.type !== 'infrared') continue;
      this.line.subVectors(missile.position, flight.position);
      if (this.line.lengthSq() < 890 ** 2 && this.line.normalize().dot(this.forward) > 0.32
        && hasLineOfSight(flight.world, flight.position, missile.position)) return true;
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
    if (direct) this.hit(direct, config.power * 0.91);
    for (const { part, distance } of this.components.values()) {
      if (hull.incapacitated) break;
      const falloff = (1 - distance / config.blast) ** 2;
      const weight = part.component === 'pilot' ? 0.09 : part.component === 'fuselage' ? 0.52 : 0.33;
      this.hit(part, config.power * falloff * weight);
    }
    if (missile.owner === this.player.flight) this.missileHits++;
    this.effects.burst(point, true, hull === this.player.hull);
  }
}
