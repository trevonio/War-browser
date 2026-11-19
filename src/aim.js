import { MathUtils, Quaternion, Vector3 } from 'three';

const UP = new Vector3(0, 1, 0);
const X = new Vector3(1, 0, 0);
const AIM_RADIANS_PER_PIXEL = 0.00125;

export class MouseAim {
  constructor() {
    this.orientation = new Quaternion();
    this.direction = new Vector3(0, 0, 1);
    this.turnHint = new Vector3(-1, 0, 0);
    this.rotation = new Quaternion();
    this.axis = new Vector3();
    this.up = new Vector3();
    this.horizon = new Vector3();
    this.cross = new Vector3();
  }

  align(heading, pitch) {
    this.orientation.setFromAxisAngle(UP, -heading)
      .multiply(this.rotation.setFromAxisAngle(X, -pitch));
    this.direction.set(0, 0, 1).applyQuaternion(this.orientation);
    this.turnHint.set(-1, 0, 0).applyQuaternion(this.orientation);
  }

  move(dx, dy, sensitivity, invert) {
    const travel = Math.hypot(dx, dy);
    if (travel === 0) return;
    const vertical = invert ? -dy : dy;
    this.axis.set(vertical / travel, -dx / travel, 0);
    // At an exact reversal this tangent tells the instructor which arc the
    // player approached the opposite direction from.
    this.orientation.multiply(this.rotation.setFromAxisAngle(this.axis, travel * sensitivity * AIM_RADIANS_PER_PIXEL)).normalize();
    this.direction.set(0, 0, 1).applyQuaternion(this.orientation);
    this.turnHint.set(dx / travel, vertical / travel, 0).applyQuaternion(this.orientation);

    // Remove incidental roll from diagonal input, keeping the transported up
    // vector through a pole and allowing an intentionally inverted view.
    this.up.set(0, 1, 0).applyQuaternion(this.orientation);
    this.horizon.copy(UP).addScaledVector(this.direction, -this.direction.y);
    const horizonLength = this.horizon.length();
    if (horizonLength < 0.12) return;
    this.horizon.multiplyScalar(Math.sign(this.horizon.dot(this.up) || 1) / horizonLength);
    this.cross.crossVectors(this.up, this.horizon);
    const drift = Math.atan2(this.direction.dot(this.cross), this.up.dot(this.horizon));
    const correction = MathUtils.smoothstep(horizonLength, 0.12, 0.55)
      * (1 - Math.exp(-travel * 0.007));
    this.orientation.multiply(this.rotation.setFromAxisAngle(this.axis.set(0, 0, 1), drift * correction)).normalize();
  }
}
