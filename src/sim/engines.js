import { MathUtils } from 'three';

export const centerEngine = [{ component: 'engine', lateral: 0, share: 1 }];

export class Engines {
  constructor(spec, damage) {
    this.spec = spec;
    this.damage = damage;
    this.states = (spec.engines ?? centerEngine).map((config) => ({ config }));
  }

  reset(throttle) {
    for (const engine of this.states) Object.assign(engine, { spool: throttle, afterburner: false, thrust: 0, power: 1 });
    this.spool = throttle;
    this.thrust = this.burn = this.yawMoment = 0;
    this.afterburner = false;
  }

  get canBurn() {
    return this.spec.afterburnerThrust > 0
      && this.states.some(({ config }) => this.damage.enginePowerFor(config.component) > 0.32);
  }

  step(throttle, fuel, armed, density, mach, dt) {
    const spec = this.spec;
    const altitude = (density / 1.225) ** (spec.thrustLapse ?? 0.62);
    const ram = 1 + 0.17 * Math.min(mach, 1.6);
    this.spool = this.thrust = this.burn = this.yawMoment = 0;
    this.afterburner = false;
    for (const engine of this.states) {
      const { component, share, lateral } = engine.config;
      const power = engine.power = this.damage.enginePowerFor(component);
      engine.spool += ((fuel && power > 0 ? throttle : 0) - engine.spool) * (1 - Math.exp(-spec.spoolResponse * dt));
      engine.afterburner = armed && engine.spool > 0.89 && (this.states.length === 1 || power > 0.32);
      const dry = spec.militaryThrust * (0.05 + 0.95 * engine.spool ** 1.3);
      engine.thrust = fuel ? (engine.afterburner ? spec.afterburnerThrust : dry) * altitude * ram * power * share : 0;
      const consumption = MathUtils.lerp(spec.idleFuelFlow, spec.militaryFuelFlow, engine.spool ** 1.15);
      this.burn += power > 0 ? (engine.afterburner ? spec.afterburnerFuelFlow : consumption) * altitude * share : 0;
      this.spool += engine.spool * share;
      this.afterburner ||= engine.afterburner;
      this.thrust += engine.thrust;
      this.yawMoment -= lateral * engine.thrust;
    }
  }
}
