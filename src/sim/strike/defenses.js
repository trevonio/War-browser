import { MathUtils, Vector3 } from 'three';
import { Ballistics } from '../ballistics.js';
import { groundLineOfSight } from '../ground/engagement.js';
import { turnError } from '../ground/vehicles.js';

const { clamp } = MathUtils;
// Fictional game balance for the coastal defense exercise.
const shells = { capacity: 96, rpm: 1400, lifetime: 3.1, drag: .00009, maxDistance: 2300 };
export const defenseProfiles = {
  aaa: { search: 1910, fire: 1510, ammo: 62, reaction: .49, interval: .15 },
  sam: { search: 5300, fire: 3800, ammo: 2, reaction: 1.75, interval: 7.4 },
};
export function airDefenseOperational(unit) {
  return unit.active && unit.health.condition('weapon') > .12 && unit.health.condition('turret') > .10;
}
export class AirDefenses {
  constructor(world, effects) {
    this.world = world;
    this.effects = effects;
    this.aim = new Vector3();
    this.origin = new Vector3();
    this.velocity = new Vector3();
    this.battery = new Ballistics(shells, world, (surface, point, collider) => {
      if (collider?.hull) this.combat.hit(collider, 9);
      this.effects.impact(surface, point);
    });
    this.sites = [];
    this.emitters = [];
  }

  reset(combat, units, difficulty, support = null) {
    this.combat = combat;
    this.aircraft = [{ flight: combat.player.flight, hull: combat.player.hull, faction: 'friendly' }];
    if (support) this.aircraft.push(support);
    this.sites = units.filter(({ type }) => Object.hasOwn(defenseProfiles, type))
      .map((unit) => ({
        unit, own: unit, power: unit.type === 'sam', emissions: new Map(), ammo: defenseProfiles[unit.type].ammo,
        readyAt: Infinity, nextShot: 0, nextScan: 0, contact: false, locked: false,
      }));
    this.emitters = this.sites.filter(({ power }) => power);
    this.launches = this.gunShots = 0;
    this.nextWarning = 0;
    this.gunActiveUntil = 0;
    this.difficulty = difficulty === 'rookie' ? 1.42 : difficulty === 'veteran' ? .76 : 1;
    this.battery.clear();
    this.enabled = this.sites.length > 0;
    if (!this.enabled) return;
    const hull = combat.player.hull;
    hull.reset(true);
    this.colliders = [...this.world.structures, ...this.aircraft.flatMap((side) => side.hull.colliders)];
  }

  step(dt, battle) {
    if (!this.enabled) return;
    const { player, decoys, missiles } = this.combat;
    const { flight, hull } = player;
    hull.update();
    decoys.step(dt, this.world);
    for (const site of this.sites) {
      const { unit } = site;
      if (!airDefenseOperational(unit) || this.aircraft.every((aircraft) => aircraft.flight.failure)) {
        site.emissions.clear();
        site.contact = site.locked = false;
        continue;
      }
      this.updateSite(site, battle, dt);
    }
    missiles.step(dt);
    this.battery.step(dt, this.colliders);
    if (flight.elapsed >= this.nextWarning) {
      this.nextWarning = flight.elapsed + .09;
      player.warning.update(flight.elapsed, this.emitters, missiles.pool);
    }
  }

  updateSite(site, battle, dt) {
    const { unit } = site;
    const time = this.combat.player.flight.elapsed;
    const config = defenseProfiles[unit.type];
    const radar = site.power;
    this.origin.copy(unit.position).y += unit.spec.dimensions[1] * .88;
    let distance = site.target ? site.target.flight.position.distanceTo(this.origin) : Infinity;
    if (time >= site.nextScan) {
      site.nextScan = time + (distance > 2200 ? .25 : .15);
      let selected = null;
      let nearest = config.search * (.52 + .48 * unit.health.condition('turret'));
      for (const side of this.aircraft) {
        const { flight } = side;
        if (side.faction === unit.faction || flight.failure || flight.grounded) continue;
        const separation = flight.position.distanceTo(this.origin);
        if (separation < nearest && groundLineOfSight(this.world, this.origin, flight.position)) {
          nearest = separation;
          selected = side;
        }
      }
      if (selected && selected !== site.target) site.readyAt = time + config.reaction * this.difficulty;
      site.target = selected;
      distance = nearest;
      site.contact = Boolean(selected);
      site.locked = site.contact && distance <= config.fire && time >= site.readyAt && site.ammo > 0;
      if (radar) {
        site.emissions.clear();
        if (selected) site.emissions.set(selected.flight, site.locked ? 'TRACK' : 'SEARCH');
      }
    }
    if (!site.contact || site.target.flight.failure) return;
    const { flight, hull } = site.target;
    this.aim.copy(flight.position);
    if (!radar) this.aim.addScaledVector(flight.velocity, Math.min(1.8, distance / 425)).y += distance * distance * .000026;
    const line = this.aim.sub(this.origin);
    const targetYaw = Math.atan2(line.x, line.z) - unit.yaw;
    const targetPitch = clamp(Math.atan2(line.y, Math.hypot(line.x, line.z)), 0, 1.45);
    unit.turret.yaw += clamp(turnError(targetYaw, unit.turret.yaw), -dt * 1.85, dt * 1.85);
    unit.turret.pitch += clamp(targetPitch - unit.turret.pitch, -dt * 1.55, dt * 1.55);
    if (!site.locked || time < site.nextShot || radar && time < site.readyAt + .55 || Math.abs(turnError(targetYaw, unit.turret.yaw)) > .13 ||
      !groundLineOfSight(this.world, this.origin, flight.position)) return;
    if (radar) {
      if (this.combat.missiles.pool.some((missile) => missile.active && missile.owner === unit)) return;
      const missile = this.combat.missiles.launchSurface(unit, this.origin, flight, hull);
      if (!missile) return;
      this.launches++;
      battle.director?.radio(battle.time, 'Control', 'Surface launch detected.');
    } else {
      if (this.battery.count >= this.battery.rounds.length || Math.abs(targetPitch - unit.turret.pitch) > .09) return;
      const scatter = .036 * this.difficulty;
      this.velocity.copy(line).normalize();
      this.velocity.x += (battle.random() * 2 - 1) * scatter;
      this.velocity.y += (battle.random() * 2 - 1) * scatter;
      this.battery.spawn(this.origin, this.velocity.normalize().multiplyScalar(425), true, 0);
      this.gunShots++;
      this.gunActiveUntil = time + .9;
    }
    site.ammo--;
    site.nextShot = time + config.interval * this.difficulty;
    this.effects.shot(radar, this.origin);
  }
}
