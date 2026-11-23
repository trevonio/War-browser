import { ComponentHealth } from './component-health.js';

const jamAt = 0.23;
const controlAuthority = (condition) => condition > jamAt ? 0.25 + 0.75 * condition : 0;

export class AircraftDamage extends ComponentHealth {
  constructor(components = {}, engines = [{ component: 'engine', share: 1 }]) {
    super(components);
    this.engines = engines;
    this.engineFires = new Set();
    this.surfaceAuthority = {};
    this.reset();
  }

  reset() {
    super.reset();
    this.active = false;
    this.engineFires.clear();
    this.fire = false;
    this.overload = 0;
    this.failure = '';
    this.report = '';
    this.recalculate();
  }

  hit(key, amount) {
    if (!this.components[key] || this.failure) return false;
    const excess = this.wear(key, amount);
    if (key !== 'fuselage') this.wear('fuselage', amount * 0.28 + excess * 0.85);
    this.active = true;
    for (const { component } of this.engines) {
      if (this.condition(component) <= 0.48) this.engineFires.add(component);
    }
    this.fire = this.engineFires.size > 0;
    this.recalculate();
    const status = this.condition(key) <= 0 ? 'FAILED' : this.condition(key) <= jamAt ? 'CRITICAL' : 'HIT';
    this.report = key === 'fuel' && this.leak ? 'FUEL LEAK' : `${this.components[key].label.toUpperCase()} ${status}`;
    return Boolean(this.failure);
  }

  enginePowerFor(component) { return this.condition(component) ** 1.45; }

  recalculate() {
    const left = this.condition('leftWing');
    const right = this.condition('rightWing');
    this.wingLeft = 0.13 + 0.87 * left;
    this.wingRight = 0.13 + 0.87 * right;
    this.lift = (this.wingLeft + this.wingRight) * 0.5;
    this.drag = (2 - left - right) * 0.021
      + (2 - this.condition('leftFlaperon') - this.condition('rightFlaperon')) * 0.009;
    this.loadLimit = 0.47 + 0.53 * Math.min(left, right, this.condition('fuselage'));
    this.enginePower = this.engines.reduce((power, engine) => power + this.enginePowerFor(engine.component) * engine.share, 0);
    const leftRudder = controlAuthority(Math.min(this.condition('leftFin'), this.condition('leftRudder')));
    const rightRudder = controlAuthority(Math.min(this.condition('rightFin'), this.condition('rightRudder')));
    this.yawAuthority = (leftRudder + rightRudder) * 0.5;
    this.leak = Math.max(0, 0.84 - this.condition('fuel')) ** 1.4 * 46;
    const surfaces = this.surfaceAuthority;
    surfaces.LeftRudder = leftRudder;
    surfaces.RightRudder = rightRudder;
    surfaces.LeftLEF = controlAuthority(left);
    surfaces.RightLEF = controlAuthority(right);
    surfaces.LeftFlaperon = left > 0 ? controlAuthority(this.condition('leftFlaperon')) : 0;
    surfaces.RightFlaperon = right > 0 ? controlAuthority(this.condition('rightFlaperon')) : 0;
    surfaces.LeftStabilator = controlAuthority(this.condition('leftStabilator'));
    surfaces.RightStabilator = controlAuthority(this.condition('rightStabilator'));
    this.pitchAuthority = (surfaces.LeftStabilator + surfaces.RightStabilator) * 0.5;
    this.rollAuthority = (surfaces.LeftFlaperon + surfaces.RightFlaperon) * 0.39 + this.pitchAuthority * 0.22;
    if (this.condition('pilot') === 0) this.failure = 'Pilot incapacitated';
    else if (this.condition('fuselage') === 0 || left + right === 0) this.failure = 'Airframe failure';
  }

  progress(dt, fuel, excess) {
    if (!this.active) return;
    if (fuel <= 0) this.engineFires.clear();
    this.fire = this.engineFires.size > 0;
    for (const engine of this.engineFires) {
      if (this.condition(engine) > 0) this.wear(engine, dt * 1.1);
      else this.wear('fuselage', dt * 0.42);
    }
    if (excess > 0) {
      const side = this.condition('leftWing') <= this.condition('rightWing') ? 'leftWing' : 'rightWing';
      const health = this.condition(side);
      if (health > 0 && health < 1) this.wear(side, excess * dt * 0.62);
    }
    if (this.fire || excess > 0) this.recalculate();
  }

  get warning() {
    if (this.fire) return 'ENGINE FIRE';
    if (this.enginePower === 0) return 'ENGINE FAILED';
    if (this.pitchAuthority < 0.57 || this.rollAuthority < 0.52) return 'FLIGHT CONTROL DAMAGE';
    if (this.leak > 0) return 'FUEL LEAK';
    if (this.loadLimit < 0.80) return 'AIRFRAME WEAKENED';
    if (this.enginePower < 0.93) return 'ENGINE DAMAGED';
    return this.active ? 'AIRFRAME DAMAGED' : '';
  }
}
