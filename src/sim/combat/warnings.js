import { Vector3 } from 'three';

const priority = { SEARCH: 1, TRACK: 2, 'ACTIVE SEEKER': 3 };

export class ThreatReceiver {
  constructor(flight) {
    this.flight = flight;
    this.line = new Vector3();
    this.right = new Vector3();
    this.forward = new Vector3();
    this.reset();
  }

  reset() {
    this.state = '';
    this.bearing = 0;
    this.time = -Infinity;
  }

  update(time, emitters, missiles) {
    let state = '';
    let object = null;
    for (const radar of emitters) {
      if (!radar.power || radar.own.failure) continue;
      const emission = radar.emissions.get(this.flight);
      if (emission && (!state || priority[emission] > priority[state])) {
        state = emission;
        object = radar.own;
      }
    }
    for (const missile of missiles) {
      if (missile.active && missile.emitting && missile.target === this.flight) {
        state = 'ACTIVE SEEKER';
        object = missile;
        break;
      }
    }
    if (!object) {
      if (time - this.time > (this.flight.spec?.rwr?.hold ?? 0.36)) this.state = '';
      return;
    }
    const { orientation, position } = this.flight;
    this.line.subVectors(object.position, position);
    this.right.set(-1, 0, 0).applyQuaternion(orientation);
    this.forward.set(0, 0, 1).applyQuaternion(orientation);
    this.bearing = Math.atan2(this.line.dot(this.right), this.line.dot(this.forward));
    this.state = state;
    this.time = time;
  }
}
