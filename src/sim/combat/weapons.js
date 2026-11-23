import { stores } from '../loadouts.js';
import { Vector3 } from 'three';
import { guidedWeapon, precision } from '../strike/guided.js';
import { hasLineOfSight } from './radar.js';

// Deliberately game-tuned archetypes for the coastal range. These values
// describe the fictional simulation and are shared by player and AI.
export const weapons = {
  cannon: { label: 'M61A1 · 20 MM' },
  bomb: { label: 'RANGE BOMB' },
  rocket: { label: 'RANGE ROCKET' },
  ...precision,
  infrared: {
    label: 'SIDEWINDER · IR', minRange: 150, maxRange: 2400, acquireArc: 0.955, keeperArc: 0.62,
    dwell: 0.32, model: 'wingtip', launchCue: 'launch', mass: 1, burn: 2.25, thrust: 155, speedCap: 580, damping: 0.058,
    turnRate: 0.92, life: 10.5, fuse: 9, blast: 28, power: 17, decoyBias: 1.0,
  },
  radar: {
    label: 'AMRAAM · ACTIVE', minRange: 480, maxRange: 11900, acquireArc: 0.80, keeperArc: 0.69,
    dwell: 0.24, model: 'outer', launchCue: 'radarLaunch', mass: 1.25, burn: 6.4, thrust: 207.5, speedCap: 890, damping: 0.026,
    turnRate: 0.63, life: 24, fuse: 12, blast: 33, power: 21, decoyBias: 1.04, terminalRange: 2150,
  },
};

export function simulatedHeat(flight) {
  return 0.38 + (flight.thrust > 0 ? flight.spool * 0.48 : 0) + (flight.afterburner ? 0.54 : 0)
    + (flight.damage.fire ? 0.17 : 0);
}

const airOnly = ['air'];
const secondaryOrder = ['infrared', 'radar', 'bomb', 'rocket', 'laser', 'gps', 'optical'];
const attached = (station, damage) => !station.used && damage.condition(station.wing) > 0;

export class WeaponRack {
  constructor(flight, radar, world) {
    this.flight = flight;
    this.radar = radar;
    this.world = world;
    this.line = new Vector3();
    this.forward = new Vector3();
    this.reset(null);
  }

  reset(loadout, selected = 'cannon') {
    const domains = this.flight.spec.weaponDomains ?? airOnly;
    this.stations = (loadout?.stations ?? [])
      .filter((station) => domains.includes(station.domain ?? 'air'))
      .map((station) => ({ ...station, remaining: station.quantity ?? 1, fuelCapacity: station.fuel ?? 0, used: false }));
    this.flight.customStores = Boolean(loadout?.physical);
    this.payloadStations = this.stations.filter(({ payload }) => payload);
    this.syncPayload();
    this.flare = loadout?.flare ?? 0;
    this.chaff = loadout?.chaff ?? 0;
    this.seeker = { infrared: this.blankSeeker(), radar: this.blankSeeker() };
    this.infraredContacts = [];
    this.infraredPreference = null;
    this.infraredRequested = false;
    this.selected = 'cannon';
    this.select(selected);
    this.nextDecoy = { flare: 0, chaff: 0 };
    this.releaseSide = 1;
    this.nextAcquire = 0;
    this.nextLaunch = 0;
    this.notice = '';
    this.noticeUntil = 0;
  }

  syncPayload() {
    let mass = 0;
    let drag = 0;
    const tanks = [];
    for (const station of this.payloadStations) {
      station.attached = attached(station, this.flight.damage);
      if (!station.attached) continue;
      mass += station.payload.mass + (station.roundMass ?? 0) * station.remaining;
      if (station.fuelCapacity) tanks.push(station);
      drag += station.payload.drag;
    }
    this.flight.setPayload(mass, drag);
    this.flight.setExternalTanks(tanks);
  }

  blankSeeker() {
    return { target: null, since: 0, ready: false, range: 0 };
  }

  station(type) {
    const wing = this.releaseOrder === 'left' ? 'leftWing' : this.releaseOrder === 'right' ? 'rightWing' : null;
    let next;
    for (const station of this.stations) {
      if (station.type !== type || station.remaining <= 0 || !attached(station, this.flight.damage)) continue;
      if (!wing || station.wing === wing) return station;
      next ??= station;
    }
    return next;
  }

  count(type) {
    let available = 0;
    for (const entry of this.stations) {
      if (entry.type === type && entry.remaining > 0 && attached(entry, this.flight.damage)) available += entry.remaining;
    }
    return available;
  }

  select(type) {
    if (type === 'cannon' || Object.hasOwn(weapons, type) && this.stations.some((entry) => entry.type === type)) {
      this.selected = type;
    }
  }

  cycle() {
    const options = Object.keys(weapons).filter((type) => type === 'cannon'
      || this.stations.some((entry) => entry.type === type));
    this.select(options[(options.indexOf(this.selected) + 1) % options.length]);
  }

  cycleSecondary() {
    const current = secondaryOrder.indexOf(this.selected);
    for (let step = 1; step <= secondaryOrder.length; step++) {
      const type = secondaryOrder[(current + step) % secondaryOrder.length];
      if (!this.station(type)) continue;
      this.select(type);
      break;
    }
  }

  requestInfrared(cycle = false) {
    const current = this.infraredPreference ?? this.seeker.infrared.target;
    const index = this.infraredContacts.indexOf(current);
    if (cycle || !this.infraredRequested) {
      this.infraredPreference = cycle && this.infraredContacts.length
        ? this.infraredContacts[(index + 1) % this.infraredContacts.length] : current;
      this.seeker.infrared = this.blankSeeker();
      this.nextAcquire = 0;
    }
    this.infraredRequested = true;
  }

  clearInfrared() {
    this.infraredRequested = false;
    this.infraredPreference = null;
  }

  update(time, contacts) {
    if (time < this.nextAcquire || this.flight.failure) return;
    this.nextAcquire = time + 0.10;
    if (this.payloadStations.some((station) => station.attached !== attached(station, this.flight.damage))) this.syncPayload();
    const own = this.flight;
    this.forward.set(0, 0, 1).applyQuaternion(own.orientation);
    this.acquire('infrared', this.station('infrared') ? contacts : [], time);
    const track = this.radar.track;
    this.acquire('radar', this.station('radar') && track && time - track.time < 0.43 ? [track] : [], time);
  }

  acquire(type, contacts, time) {
    const config = weapons[type];
    const seeker = this.seeker[type];
    let selected = null;
    let selectedRange = 0;
    let strongest = 0.16;
    const infrared = type === 'infrared';
    if (infrared) this.infraredContacts.length = 0;
    const preference = infrared ? this.infraredPreference : null;
    for (const contact of contacts) {
      const target = type === 'infrared' ? contact : contact.target;
      if (target.failure) continue;
      const estimate = type === 'infrared' ? target.position : contact.position;
      this.line.subVectors(estimate, this.flight.position);
      const range = this.line.length();
      if (range < 1 || range > config.maxRange * 1.16) continue;
      this.line.multiplyScalar(1 / range);
      const alignment = this.forward.dot(this.line);
      const cone = target === seeker.target ? config.acquireArc - 0.026 : config.acquireArc;
      if (alignment < cone) continue;
      const heat = type === 'infrared' ? simulatedHeat(target) : contact.quality;
      const score = heat * alignment / (0.70 + range / config.maxRange);
      if (score < 0.16 || (infrared && !hasLineOfSight(this.world, this.flight.position, estimate))) continue;
      if (infrared) this.infraredContacts.push(target);
      if (target !== preference && score < strongest) continue;
      selected = target;
      selectedRange = range;
      strongest = target === preference ? Infinity : score;
    }
    if (seeker.target !== selected) seeker.since = time;
    seeker.target = selected;
    seeker.range = selectedRange;
    seeker.ready = selected !== null && time - seeker.since >= config.dwell
      && selectedRange >= config.minRange && selectedRange <= config.maxRange;
  }

  fire(type, time, missiles, hull) {
    if (!Object.hasOwn(this.seeker, type)) return false;
    if (this.launchState(type, time) !== 'CLEARED') {
      this.message('LAUNCH INHIBITED', time);
      return false;
    }
    const station = this.station(type);
    const missile = missiles.launch(this, station, this.seeker[type].target, hull);
    if (!missile) return false;
    this.consume(station);
    this.nextLaunch = time + 0.60;
    this.message('MISSILE AWAY', time);
    return true;
  }

  consume(station) {
    station.remaining--;
    if (!station.remaining && station.type !== 'rocket') station.used = true;
    if (station.payload) this.syncPayload();
  }

  releaseState(type) {
    if (!this.station(type)) return 'AMMO EMPTY';
    const { flight } = this;
    const limits = stores[type];
    if (flight.failure || flight.grounded) return 'INHIBITED';
    if (flight.mach > (limits.releaseMach ?? 1.05) || Math.abs(flight.g) > (limits.releaseG ?? 5)) return 'OUTSIDE ENVELOPE';
    return 'READY';
  }

  launchState(type, time) {
    if (type === 'bomb' || type === 'rocket' || guidedWeapon(type)) return this.releaseState(type);
    if (!Object.hasOwn(this.seeker, type)) return 'INHIBITED';
    if (!this.station(type)) return 'AMMO EMPTY';
    if (this.flight.failure || this.flight.grounded) return 'INHIBITED';
    if (time < this.nextLaunch) return 'CYCLING';
    const seeker = this.seeker[type];
    if (type === 'radar') {
      const track = this.radar.track;
      if (!track || time - track.time > 0.42) return 'STT REQUIRED';
      if (track.target !== seeker.target) return 'ACQUIRING';
    }
    if (!seeker.target || seeker.target.failure) return 'SEARCHING';
    if (seeker.range < weapons[type].minRange || seeker.range > weapons[type].maxRange) return 'OUT OF RANGE';
    return seeker.ready ? 'CLEARED' : 'ACQUIRING';
  }

  deploy(type, time, decoys) {
    if (this.flight.failure || this[type] <= 0 || time < this.nextDecoy[type]) return false;
    if (!decoys.release(this.flight, type, this.releaseSide)) return false;
    this[type]--;
    this.releaseSide *= -1;
    this.nextDecoy[type] = time + 0.42;
    this.message(type === 'flare' ? 'FLARE RELEASED' : 'CHAFF RELEASED', time);
    return true;
  }

  message(notice, time) {
    this.notice = notice;
    this.noticeUntil = time + 1.3;
  }
}
