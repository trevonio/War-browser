import { MathUtils } from 'three';

const { clamp, smoothstep } = MathUtils;

export const surfaceLimits = {
  LeftLEF: [0, 25], RightLEF: [0, 25],
  LeftFlaperon: [-23, 25], RightFlaperon: [-23, 25],
  LeftStabilator: [-25, 21], RightStabilator: [-25, 21],
  Rudder: [-30, 30],
};


export class ControlSurfaces {
  constructor(config = {}) {
    this.config = config;
    this.limits = { ...surfaceLimits, ...config.limits };
    this.names = Object.keys(this.limits);
    this.angles = Object.fromEntries(this.names.map((name) => [name, 0]));
    this.previous = { ...this.angles };
    this.demand = { ...this.angles };
  }

  reset(gear, speed, flap) {
    this.command(0, 0, 0, gear, speed, 0, 0, flap);
    for (const name of this.names) this.previous[name] = this.angles[name] = this.demand[name];
  }

  command(pitch, roll, yaw, gear, speed, alpha, brake = 0, flap) {
    const approach = gear * (1 - smoothstep(speed, 100, 158));
    const leading = 25 * clamp(approach * 0.70 + Math.max(0, alpha) * 1.7, 0, 1);
    const trailing = this.config.separateFlaps ? 0 : 18 * approach;
    const elevator = pitch * 21;
    const aileron = roll * 20;
    this.demand.LeftLEF = this.demand.RightLEF = leading;
    this.demand.LeftFlaperon = trailing + aileron;
    this.demand.RightFlaperon = trailing - aileron;
    this.demand.LeftStabilator = elevator + roll * (this.config.stabilatorRollMix ?? 5);
    this.demand.RightStabilator = elevator - roll * (this.config.stabilatorRollMix ?? 5);
    this.demand.Rudder = -yaw * 30;
    if (this.config.separateFlaps) this.demand.Flap = flap ?? 35 * approach;
    if (this.config.speedBrake) this.demand.SpeedBrake = (this.limits.SpeedBrake?.[1] ?? 48) * brake;
  }

  step(dt, pitch, roll, yaw, gear, speed, alpha, authority, brake, flap) {
    this.command(pitch, roll, yaw, gear, speed, alpha, brake, flap);
    const response = 1 - Math.exp(-12 * dt);
    for (const name of this.names) {
      const [min, max] = this.limits[name];
      const angle = this.previous[name] = this.angles[name];
      const effectiveness = authority[name] ?? 1;
      const target = clamp(this.demand[name] * effectiveness, min, max);
      const rate = 100 * dt * effectiveness;
      this.angles[name] += clamp((target - angle) * response, -rate, rate);
    }
  }
}
