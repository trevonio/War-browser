import { Vector3 } from 'three';
import { groundLineOfSight } from './engagement.js';

export class GroundObserver {
  constructor(world) {
    this.world = world;
    this.contacts = new Map();
    this.projected = new Vector3();
    this.point = new Vector3();
    this.reset();
  }

  reset() {
    this.contacts.clear();
    this.selected = null;
    this.nextScan = 0;
  }

  scan(time, origin, camera, units) {
    if (time < this.nextScan) return;
    this.nextScan = time + .24;
    let best = null;
    let screenDistance = Infinity;
    for (const unit of units) {
      if (!unit.active || unit.arrived) continue;
      this.point.copy(unit.position).y += unit.spec.dimensions[1] * .87;
      if (origin.distanceToSquared(this.point) > 3200 ** 2) continue;
      this.projected.copy(this.point).project(camera);
      const { x, y, z } = this.projected;
      if (z < -1 || z >= 1 || Math.abs(x) > 0.96 || Math.abs(y) > .9
        || !groundLineOfSight(this.world, origin, this.point)) continue;
      if (!this.contacts.has(unit.id)) this.contacts.set(unit.id, { unit, position: new Vector3() });
      const contact = this.contacts.get(unit.id);
      contact.position.copy(this.point);
      contact.distance = Math.round(origin.distanceTo(this.point));
      contact.time = time;
      const center = x * x + y * y;
      if (center < screenDistance) {
        screenDistance = center;
        best = unit.id;
      }
    }
    for (const [id, contact] of this.contacts) {
      if (!contact.unit.active || time - contact.time > 0.65) this.contacts.delete(id);
    }
    if (!this.contacts.has(this.selected)) this.selected = best;
  }

  cycle() {
    const ids = [...this.contacts.keys()];
    if (ids.length) this.selected = ids[(ids.indexOf(this.selected) + 1) % ids.length];
  }

  get track() { return this.contacts.get(this.selected); }
}
