import { Vector3 } from 'three';
import { scenarios } from './range.js';

const { x, y, z } = scenarios.air;
const layouts = [
  { name: 'Sighting drone', position: [x + 1, y + 20, z + 535], radius: 10, durability: 7, crossing: 0, phase: 0 },
  { name: 'Crossing drone', position: [x - 88, y + 40, z + 820], radius: 8, durability: 8, crossing: 165, phase: 0.8 },
  { name: 'High drone', position: [x + 150, y + 104, z + 1090], radius: 9, durability: 9, crossing: 210, phase: 2.6 },
];

export class PracticeRange {
  constructor() {
    this.targets = layouts.map((layout) => ({
      name: layout.name, home: layout.position, crossing: layout.crossing, phase: layout.phase,
      shape: 'sphere', surface: 'metal', radius: layout.radius, durability: layout.durability,
      position: new Vector3(), previous: new Vector3(),
    }));
    this.reset(false);
  }

  reset(enabled) {
    this.enabled = enabled;
    this.remaining = enabled ? this.targets.length : 0;
    this.notice = '';
    this.noticeUntil = 0;
    for (const target of this.targets) {
      target.active = enabled;
      target.health = target.durability;
      target.hitAt = -Infinity;
    }
    this.step(0);
    for (const target of this.targets) target.previous.copy(target.position);
  }

  step(time) {
    if (!this.enabled) return;
    for (const target of this.targets) {
      if (!target.active) continue;
      target.previous.copy(target.position);
      const phase = time * 0.24 + target.phase;
      target.position.set(
        target.home[0] + Math.sin(phase) * target.crossing,
        target.home[1] + Math.sin(phase * 0.83) * target.crossing * 0.08,
        target.home[2] + Math.cos(phase) * target.crossing * 0.14,
      );
    }
  }

  hit(target, damage, time) {
    if (!target.active) return false;
    target.health = Math.max(0, target.health - damage);
    target.hitAt = time;
    const destroyed = target.health === 0;
    if (destroyed) {
      target.active = false;
      this.remaining--;
    }
    this.notice = destroyed ? (this.remaining ? 'DRONE DOWN' : 'RANGE CLEAR') : 'TARGET HIT';
    this.noticeUntil = time + (destroyed ? 2.2 : 0.5);
    return destroyed;
  }
}
