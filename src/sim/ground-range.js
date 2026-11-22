import { Quaternion, Vector3 } from 'three';
import { ComponentHealth } from './component-health.js';

const layouts = [
  { name: 'Range truck', type: 'truck', x: -910, z: -2160, radius: 6, capacity: 14 },
  { name: 'Armored target', type: 'armor', x: -891, z: -2095, radius: 6, capacity: 27 },
  { name: 'Supply shelter', type: 'structure', x: -928, z: -2040, radius: 9, capacity: 36 },
  { name: 'Range transport', type: 'truck', x: -895, z: -2000, radius: 6, capacity: 14 },
  { name: 'Armored vehicle', type: 'armor', x: -914, z: -1952, radius: 6, capacity: 27 },
];

export class GroundRange {
  constructor(world, onDestroyed = () => {}) {
    this.onDestroyed = onDestroyed;
    this.time = 0;
    this.targets = layouts.map(({ name, type, x, z, radius, capacity }, index) => {
      const floor = world.heightAt(x, z);
      const position = new Vector3(x, floor + 1.7, z);
      const target = {
        id: `range-${index + 1}`, name, type, floor, position, previous: position.clone(),
        orientation: new Quaternion(), faction: 'opposing', classification: type,
        shape: 'sphere', surface: 'metal', radius, component: 'body',
        health: new ComponentHealth({ body: { capacity } }),
      };
      target.damageTarget = { hit: (part, amount) => this.hit(target, part, amount) };
      return target;
    });
    this.reset(false);
  }

  reset(enabled) {
    this.enabled = enabled;
    this.time = 0;
    this.remaining = enabled ? this.targets.length : 0;
    this.hitCount = 0;
    this.destroyed = 0;
    this.notice = '';
    this.noticeUntil = 0;
    for (const target of this.targets) {
      target.active = enabled;
      target.observedHit = false;
      target.health.reset();
    }
  }

  hit(target, part, amount) {
    if (!this.enabled || !target.active || amount <= 0) return false;
    target.health.wear(part, amount);
    if (!target.observedHit) {
      target.observedHit = true;
      this.hitCount++;
    }
    const destroyed = target.health.condition(part) === 0;
    if (destroyed) {
      target.active = false;
      this.remaining--;
      this.destroyed++;
      this.onDestroyed(target);
    }
    this.notice = destroyed ? (this.remaining ? `${target.name.toUpperCase()} DOWN` : 'RANGE COMPLETE') : 'GROUND TARGET HIT';
    this.noticeUntil = this.time + 1.6;
    return destroyed;
  }

  get complete() { return this.enabled && this.remaining === 0; }
}
