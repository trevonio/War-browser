import { MathUtils } from 'three';

const { clamp, smoothstep } = MathUtils;

export const surfaceLimits = {
  LeftLEF: [0, 25], RightLEF: [0, 25],
  LeftFlaperon: [-23, 25], RightFlaperon: [-23, 25],
  LeftStabilator: [-25, 21], RightStabilator: [-25, 21],
  Rudder: [-30, 30],
};
const names = Object.keys(surfaceLimits);

export class ControlSurfaces {
  constructor() {
    this.angles = Object.fromEntries(names.map((name) => [name, 0]));
    this.previous = { ...this.angles };
    this.demand = { ...this.angles };
  }

  reset(gear, speed) {
    this.command(0, 0, 0, gear, speed, 0);
    for (const name of names) this.previous[name] = this.angles[name] = this.demand[name];
  }

  command(pitch, roll, yaw, gear, speed, alpha) {
    const approach = gear * (1 - smoothstep(speed, 100, 158));
    const leading = 25 * clamp(approach * 0.70 + Math.max(0, alpha) * 1.7, 0, 1);
    const trailing = 18 * approach;
    const elevator = pitch * 21;
    const aileron = roll * 20;
    this.demand.LeftLEF = this.demand.RightLEF = leading;
    this.demand.LeftFlaperon = trailing + aileron;
    this.demand.RightFlaperon = trailing - aileron;
    this.demand.LeftStabilator = elevator + roll * 5;
    this.demand.RightStabilator = elevator - roll * 5;
    this.demand.Rudder = -yaw * 30;
  }

  step(dt, pitch, roll, yaw, gear, speed, alpha, authority) {
    this.command(pitch, roll, yaw, gear, speed, alpha);
    const response = 1 - Math.exp(-12 * dt);
    for (const name of names) {
      const [min, max] = surfaceLimits[name];
      const angle = this.previous[name] = this.angles[name];
      const effectiveness = authority[name] ?? 1;
      const target = clamp(this.demand[name] * effectiveness, min, max);
      const rate = 100 * dt * effectiveness;
      this.angles[name] += clamp((target - angle) * response, -rate, rate);
    }
  }
}
