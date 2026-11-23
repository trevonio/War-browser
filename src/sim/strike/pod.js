import { MathUtils, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { staticImpact } from '../ballistics.js';
import { groundLineOfSight } from '../ground/engagement.js';

const { clamp, lerp } = MathUtils;
const zooms = [41, 21, 9];
const zoomLabels = ['WIDE', 'MEDIUM', 'NARROW'];
const maxRange = 4200;
const downForward = new Vector3(0, -.28, 1).normalize();
const modeNames = ['Day', 'White Hot', 'Black Hot'];

export class TargetingPod {
  constructor(world) {
    this.world = world;
    this.camera = new PerspectiveCamera(zooms[0], 1, .5, 68000);
    this.origin = new Vector3();
    this.direction = new Vector3();
    this.area = new Vector3();
    this.coordinates = new Vector3();
    this.illumination = new Vector3();
    this.point = new Vector3();
    this.test = new Vector3();
    this.previous = new Vector3();
    this.delta = new Vector3();
    this.inverse = new Quaternion();
    this.designation = { position: new Vector3(), target: null, time: 0, confidence: 'none', valid: false };
    this.reset();
  }

  reset() {
    this.active = this.mounted = this.laserArmed = this.lasing = this.hasCoordinates = this.hasArea = false;
    this.track = this.observed = this.station = null;
    this.mode = this.zoom = 0;
    this.nextScan = -Infinity;
    this.state = 'FREE SLEW';
    Object.assign(this.designation, { target: null, time: 0, confidence: 'none', valid: false });
    this.camera.fov = zooms[0];
    this.camera.updateProjectionMatrix();
  }

  sync(flight, station) {
    if (Boolean(station) !== this.mounted) {
      this.reset();
      this.mounted = Boolean(station);
    }
    this.station = station ?? null;
    this.flight = flight;
    if (!station) return;
    this.origin.fromArray(station.offset).applyQuaternion(flight.orientation).add(flight.position);
    this.inverse.copy(flight.orientation).invert();
  }

  toggle() {
    if (!this.mounted) return false;
    this.active = !this.active;
    if (this.active && !this.hasArea) this.recenter();
    return this.active;
  }

  recenter() {
    this.direction.copy(downForward).applyQuaternion(this.flight.orientation);
    this.yaw = Math.atan2(this.direction.x, this.direction.z);
    this.pitch = Math.asin(this.direction.y);
    this.clearTrack();
  }

  clearTrack() {
    this.track = this.observed = null;
    if (this.designation.target) this.designation.valid = false;
    this.state = 'FREE SLEW';
    this.hasArea = this.laserArmed = this.lasing = false;
    this.nextScan = -Infinity;
  }

  clearDesignation() {
    this.clearTrack();
    this.hasCoordinates = this.designation.valid = false;
    this.designation.target = null;
  }

  slew(dx, dy) {
    if (!dx && !dy) return;
    this.clearTrack();
    const gain = .00155 * zooms[this.zoom] / zooms[0];
    this.yaw -= dx * gain;
    this.pitch = clamp(this.pitch - dy * gain, -1.51, .3);
    const flat = Math.cos(this.pitch);
    this.direction.set(Math.sin(this.yaw) * flat, Math.sin(this.pitch), Math.cos(this.yaw) * flat);
  }

  changeZoom(wheel) {
    this.stepZoom(Math.sign(-wheel));
  }

  stepZoom(step) {
    this.zoom = clamp(this.zoom + step, 0, zooms.length - 1);
  }

  get zoomLabel() { return zoomLabels[this.zoom]; }
  get canZoomIn() { return this.zoom < zooms.length - 1; }
  get canZoomOut() { return this.zoom > 0; }

  cycleMode() { this.mode = (this.mode + 1) % modeNames.length; }

  get modeName() { return modeNames[this.mode]; }
  get laserPoint() { return this.lasing ? this.illumination : null; }

  inside(point, visible = true) {
    this.delta.subVectors(point, this.origin);
    if (this.delta.lengthSq() > maxRange ** 2 || this.delta.lengthSq() < 16) return false;
    this.test.copy(this.delta).normalize().applyQuaternion(this.inverse);
    return this.test.dot(downForward) > -.13 && this.test.y < .54
      && (!visible || groundLineOfSight(this.world, this.origin, point));
  }

  observe(units, visible = null) {
    let best = Infinity;
    let candidate = null;
    const cone = Math.cos(MathUtils.degToRad(zooms[this.zoom] * (visible ? .45 : .14)));
    for (const unit of units) {
      if (!unit.active || unit.arrived) continue;
      this.point.copy(unit.position).y += unit.spec.dimensions[1] * .72;
      this.delta.subVectors(this.point, this.origin);
      const distance = this.delta.length();
      if (distance > maxRange || distance < 4) continue;
      const alignment = this.delta.dot(this.direction) / distance;
      const angularError = 1 - alignment;
      if (alignment < cone || !this.inside(this.point)) continue;
      visible?.push(unit);
      if (angularError >= best) continue;
      candidate = unit;
      best = angularError;
    }
    this.observed = candidate;
    return candidate;
  }

  terrainPoint() {
    if (this.direction.y > -.018) return null;
    this.previous.copy(this.origin);
    for (let distance = 42; distance <= maxRange; distance += 42) {
      this.point.copy(this.origin).addScaledVector(this.direction, distance);
      const collision = staticImpact(this.world, this.previous, this.point);
      if (collision !== Infinity) {
        this.point.lerp(this.previous, 1 - collision);
        this.point.y += .8;
        return this.world.surfaceAt(this.point.x, this.point.z) > 0 && this.inside(this.point, false) ? this.point : null;
      }
      this.previous.copy(this.point);
    }
    return null;
  }

  select(units) {
    if (!this.mounted) return false;
    if (this.state === 'POINT TRACK' || this.state === 'TRACK LOST') {
      this.clearTrack();
      return true;
    }
    const unit = this.observe(units);
    if (unit) this.setTrack(unit);
    else if (this.state === 'AREA TRACK') return false;
    else {
      const terrain = this.terrainPoint();
      if (!terrain) return false;
      this.setArea(terrain);
    }
    this.nextScan = -Infinity;
    return true;
  }

  setTrack(unit) {
    this.clearTrack();
    this.track = unit;
    this.area.copy(unit.position).y += unit.spec.dimensions[1] * .72;
    this.hasArea = true;
    this.state = 'POINT TRACK';
  }

  cycleTrack(units) {
    const candidates = [];
    const nearest = this.observe(units, candidates);
    if (!nearest) return false;
    const index = candidates.indexOf(this.track);
    const unit = index < 0 ? nearest : candidates[(index + 1) % candidates.length];
    if (unit !== this.track) this.setTrack(unit);
    return true;
  }

  setArea(position) {
    if (!this.mounted || !this.inside(position, false)) return false;
    this.clearTrack();
    this.hasArea = true;
    this.area.copy(position);
    this.state = 'AREA TRACK';
    return true;
  }

  designate() {
    if (!this.mounted || !this.hasArea || this.state === 'TRACK LOST' || !this.inside(this.area)) return false;
    this.coordinates.copy(this.area);
    this.designation.position.copy(this.area);
    Object.assign(this.designation, { target: this.track?.id ?? null, time: this.flight.elapsed,
      confidence: this.track ? 'point track' : 'area fix', valid: true });
    this.hasCoordinates = true;
    return true;
  }

  laser() {
    if (this.laserArmed) {
      this.laserArmed = this.lasing = false;
      return true;
    }
    if (!this.designate()) return false;
    this.laserArmed = true;
    this.nextScan = -Infinity;
    return true;
  }

  update(flight, station, units, time) {
    this.sync(flight, station);
    if (!station) return;
    if (time >= this.nextScan && (this.active || this.track || this.laserArmed)) {
      this.nextScan = time + .13;
      let valid = false;
      if (this.track) {
        const unit = this.track;
        this.point.copy(unit.position).y += unit.spec.dimensions[1] * .72;
        valid = unit.active && !unit.arrived && this.inside(this.point);
        if (valid) this.area.copy(this.point);
        else {
          if (this.designation.target === unit.id) this.designation.valid = false;
          this.track = null;
          this.state = 'TRACK LOST';
        }
      } else if (this.state === 'AREA TRACK') valid = this.inside(this.area);
      if (valid && this.track && this.designation.target === this.track.id) {
        this.designation.position.copy(this.area);
        this.designation.time = time;
        this.designation.valid = true;
      }
      this.lasing = this.laserArmed && valid;
      if (this.lasing) this.illumination.copy(this.area);
      if (this.active && !this.track) this.observe(units);
    }
  }

  present(dt) {
    if (!this.active) return;
    if (this.hasArea && this.inside(this.area, false)) {
      this.delta.subVectors(this.area, this.origin).normalize();
      this.direction.lerp(this.delta, 1 - Math.exp(-dt * 21)).normalize();
    } else if (!this.inside(this.point.copy(this.origin).addScaledVector(this.direction, 1000), false)) {
      this.point.copy(downForward).applyQuaternion(this.flight.orientation);
      this.direction.lerp(this.point, 1 - Math.exp(-dt * 14)).normalize();
    }
    this.yaw = Math.atan2(this.direction.x, this.direction.z);
    this.pitch = Math.asin(clamp(this.direction.y, -1, 1));
    this.camera.position.copy(this.origin);
    this.camera.lookAt(this.point.copy(this.origin).add(this.direction));
    const field = lerp(this.camera.fov, zooms[this.zoom], 1 - Math.exp(-dt * 15));
    if (Math.abs(field - this.camera.fov) > .01) {
      this.camera.fov = field;
      this.camera.updateProjectionMatrix();
    }
    this.camera.updateMatrixWorld();
  }
}
