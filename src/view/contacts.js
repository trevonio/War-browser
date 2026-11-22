import { MathUtils, Vector3 } from 'three';
import { hasLineOfSight } from '../sim/combat/radar.js';

export class KnownContacts {
  constructor(world) {
    this.world = world;
    this.visual = new Map();
    this.projected = new Vector3();
    this.contact = { position: new Vector3() };
    this.observed = { position: new Vector3() };
    this.reset();
  }

  reset() {
    this.visual.clear();
    this.nextVisual = 0;
    this.current = null;
  }

  update(flight, camera, candidates, radar) {
    const time = flight.elapsed;
    if (time >= this.nextVisual) {
      this.nextVisual = time + 0.085;
      for (const target of candidates) {
        const distance = flight.position.distanceTo(target.position);
        if (target.failure || distance > 2800) continue;
        this.projected.copy(target.position).project(camera);
        if (Math.abs(this.projected.x) > 0.98 || Math.abs(this.projected.y) > 0.94
          || Math.abs(this.projected.z) >= 1 || !hasLineOfSight(this.world, flight.position, target.position)) continue;
        let sighting = this.visual.get(target);
        if (!sighting) {
          sighting = { target, position: new Vector3(), label: 'VISUAL' };
          this.visual.set(target, sighting);
        }
        sighting.position.copy(target.position);
        sighting.time = time;
        sighting.range = Math.round(distance / 100) * 100;
      }
      for (const [target, sighting] of this.visual) {
        if (target.failure || time - sighting.time > 1.2 || !candidates.includes(target)) this.visual.delete(target);
      }
    }
    let visual;
    for (const sighting of this.visual.values()) {
      if (!sighting.target.failure && (!visual || sighting.time > visual.time
        || sighting.time === visual.time && sighting.range < visual.range)) visual = sighting;
    }
    return this.current = this.forTarget(flight, radar, radar?.selected, this.contact)
      ?? this.forTarget(flight, null, visual?.target, this.contact);
  }

  forTarget(flight, radar, target, output = this.observed) {
    if (!target || target.failure) return null;
    const time = flight.elapsed;
    const track = radar?.contacts.get(target);
    const locked = radar?.locked === target;
    const lifetime = locked ? 0.43 : 1.05;
    if (track && time - track.time <= lifetime) {
      output.target = target;
      output.position.copy(track.position);
      output.range = track.range;
      output.label = locked ? 'STT' : radar.mode === 'STT' ? 'RADAR' : radar.mode;
      output.freshness = 1 - (time - track.time) / lifetime;
      return output;
    }
    const sighting = this.visual.get(target);
    if (!sighting || time - sighting.time >= 1.2) return null;
    sighting.label = time - sighting.time < 0.20 ? 'VISUAL' : 'LAST SEEN';
    sighting.freshness = 1 - (time - sighting.time) / 1.2;
    return sighting;
  }

}

export class ContactMarker {
  constructor() {
    this.local = new Vector3();
    this.projected = new Vector3();
  }

  update(marker, point, camera, width, height) {
    this.local.copy(point).applyMatrix4(camera.matrixWorldInverse);
    this.projected.copy(point).project(camera);
    const visible = this.local.z < 0 && Math.abs(this.projected.z) < 1
      && Math.abs(this.projected.x) < 0.89 && Math.abs(this.projected.y) < 0.72;
    let x;
    let y;
    if (visible) {
      x = (this.projected.x + 1) * width / 2;
      y = (1 - this.projected.y) * height / 2;
    } else {
      const horizontal = this.local.x * camera.projectionMatrix.elements[0];
      const vertical = -this.local.y * camera.projectionMatrix.elements[5];
      const centered = Math.hypot(horizontal, vertical) < 1e-6;
      const direction = centered && this.local.z >= 0 ? Math.PI : Math.atan2(horizontal, -vertical);
      const dx = Math.sin(direction);
      const dy = -Math.cos(direction);
      const halfWidth = Math.max(8, width * 0.5 - 52);
      const halfHeight = Math.max(8, height * 0.5 - 102);
      const edge = 1 / Math.max(Math.abs(dx) / halfWidth, Math.abs(dy) / halfHeight);
      x = width / 2 + dx * edge;
      y = height / 2 + dy * edge;
      marker.style.setProperty('--contact-angle', `${MathUtils.radToDeg(direction)}deg`);
    }
    this.x = x;
    this.y = y;
    marker.dataset.edge = String(!visible);
    marker.style.transform = `translate(${x}px,${y}px) translate(-50%,-50%)`;
    marker.hidden = false;
  }
}
