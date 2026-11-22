import { MathUtils, Vector3 } from 'three';

const { clamp } = MathUtils;
const rightAxis = new Vector3(-1, 0, 0);
const UP = new Vector3(0, 1, 0);

export const scopeRanges = [3200, 7600, 13600];
export const standardRadar = {
  label: 'APG-68 inspired', ranges: scopeRanges, bearing: 0.86, lockBearing: 1.02,
  elevation: 0.64, searchInterval: 0.58, twsInterval: 0.34, lockInterval: 0.15, capacity: 6,
};

export function hasLineOfSight(world, from, to) {
  if (Math.min(from.y, to.y) > world.maxTerrainHeight) return true;
  for (let i = 1; i < 8; i++) {
    const at = i / 8;
    const x = from.x + (to.x - from.x) * at;
    const y = from.y + (to.y - from.y) * at;
    const z = from.z + (to.z - from.z) * at;
    if (y <= world.heightAt(x, z)) return false;
  }
  return true;
}

// Each contact is an observation from the last game sweep, with its own expiry.
// Aircraft state is kept out of the displayed estimates between sweeps.
export class Radar {
  constructor(world, own) {
    this.world = world;
    this.own = own;
    this.config = own.spec?.radar ?? standardRadar;
    this.contacts = new Map();
    this.emissions = new Map();
    this.line = new Vector3();
    this.forward = new Vector3();
    this.right = new Vector3();
    this.up = new Vector3();
    this.motion = new Vector3();
    this.reset();
  }

  reset(power = false, rangeIndex = 2) {
    this.power = power;
    this.scanMode = 'SEARCH';
    this.rangeIndex = rangeIndex;
    this.revision = 0;
    this.clear();
  }

  clear() {
    this.contacts.clear();
    this.emissions.clear();
    this.selected = null;
    this.locked = null;
    this.nextSweep = 0;
    this.revision++;
  }

  get mode() {
    return !this.power ? 'OFF' : this.locked ? 'STT' : this.scanMode;
  }

  get range() {
    return this.config.ranges[this.rangeIndex];
  }

  get track() {
    return this.locked ? this.contacts.get(this.locked) : undefined;
  }

  togglePower() {
    this.power = !this.power;
    this.clear();
  }

  cycleRange() {
    this.rangeIndex = (this.rangeIndex + 1) % this.config.ranges.length;
    for (const [target, contact] of this.contacts) {
      if (contact.range > this.range) this.drop(target);
    }
    this.nextSweep = 0;
    this.revision++;
  }

  cycleMode() {
    if (!this.power) return;
    this.locked = null;
    this.scanMode = this.scanMode === 'SEARCH' ? 'TWS' : 'SEARCH';
    this.nextSweep = 0;
    this.revision++;
  }

  selectNext() {
    if (!this.power || this.locked) return;
    const contacts = [...this.contacts.keys()];
    if (!contacts.length) return;
    this.selected = contacts[(contacts.indexOf(this.selected) + 1) % contacts.length];
    this.revision++;
  }

  toggleLock() {
    if (!this.power) return false;
    if (this.locked) {
      this.locked = null;
      this.nextSweep = 0;
      this.revision++;
      return false;
    }
    const contact = this.contacts.get(this.selected);
    if (!contact || contact.quality < 0.43) return false;
    this.locked = this.selected;
    this.nextSweep = 0;
    this.revision++;
    return true;
  }

  drop(target) {
    this.contacts.delete(target);
    if (target === this.locked) this.locked = null;
    if (target === this.selected) this.selected = null;
  }

  update(time, candidates, countermeasures) {
    if (!this.power || this.own.failure || time < this.nextSweep) return;
    const config = this.config;
    const interval = this.locked ? config.lockInterval : this.scanMode === 'TWS' ? config.twsInterval : config.searchInterval;
    this.nextSweep = time + interval;
    this.revision++;
    const { position, orientation, velocity } = this.own;
    this.forward.set(0, 0, 1).applyQuaternion(orientation);
    this.right.copy(rightAxis).applyQuaternion(orientation);
    this.up.copy(UP).applyQuaternion(orientation);
    this.emissions.clear();

    for (const target of candidates) {
      if (target.failure || (this.locked && target !== this.locked)) continue;
      this.line.subVectors(target.position, position);
      const range = this.line.length();
      if (range < 1 || range > this.range) continue;
      this.line.multiplyScalar(1 / range);
      const ahead = this.line.dot(this.forward);
      const bearing = Math.atan2(this.line.dot(this.right), ahead);
      const elevation = Math.asin(clamp(this.line.dot(this.up), -1, 1));
      if (Math.abs(bearing) > (this.locked ? config.lockBearing : config.bearing) || Math.abs(elevation) > config.elevation
        || !hasLineOfSight(this.world, position, target.position)) continue;
      this.emissions.set(target, this.locked ? 'TRACK' : 'SEARCH');

      const closure = this.motion.subVectors(velocity, target.velocity).dot(this.line);
      const aspect = Math.abs(target.forward.dot(this.line));
      const down = target.position.y < position.y - 130;
      const clutter = down ? Math.max(0, 1 - Math.abs(closure) / 95) * 0.44 : 0;
      const interference = countermeasures?.interference(target) ?? 0;
      const quality = 1.04 - range / this.range * 0.38 - aspect * 0.12 - clutter - interference;
      if (quality < (this.locked ? 0.38 : 0.43)) continue;
      let contact = this.contacts.get(target);
      if (!contact) {
        if (this.contacts.size >= config.capacity && !this.locked) continue;
        contact = { target, position: new Vector3(), velocity: new Vector3() };
        this.contacts.set(target, contact);
      }
      const grid = this.locked ? 12 : this.scanMode === 'TWS' ? 29 : 58;
      contact.position.copy(target.position).divideScalar(grid).round().multiplyScalar(grid);
      contact.velocity.copy(target.velocity).divideScalar(20).round().multiplyScalar(20);
      contact.range = Math.round(range / grid) * grid;
      contact.closure = Math.round(closure / 20) * 20;
      contact.bearing = bearing;
      contact.elevation = elevation;
      contact.quality = quality;
      contact.time = time;
    }

    for (const [target, contact] of this.contacts) {
      if (target.failure || time - contact.time > (target === this.locked ? 0.40 : interval * 2.1)) this.drop(target);
    }
  }
}
