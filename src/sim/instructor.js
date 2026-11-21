import { MathUtils, Vector3 } from 'three';

const { clamp, lerp, smoothstep } = MathUtils;
const UP = new Vector3(0, 1, 0);
const BODY_RIGHT = new Vector3(-1, 0, 0);

const tuning = {
  courseGain: 0.82,
  rolloutLead: 0.34,
  rollGain: 4.2,
  rollDamping: 0.58,
  pitchGain: 7.4,
  pitchFeedforward: 0.72,
  yawFeedforward: 0.7,
  pitchEnterLateral: 0.05,
  pitchExitLateral: 0.09,
  levelGain: 1.6,
  levelRate: 0.72,
};

export class FlightInstructor {
  constructor() {
    this.course = new Vector3();
    this.lift = new Vector3();
    this.right = new Vector3();
    this.gravity = new Vector3();
    this.target = new Vector3();
    this.tangent = new Vector3();
    this.liftDemand = new Vector3();
    this.turnSide = new Vector3();
    this.levelRight = new Vector3();
    this.reset();
  }

  reset() {
    this.turnSide.set(0, 0, 0);
    this.levelRight.set(0, 0, 0);
    this.lastRollSign = 1;
    this.holdingOpposite = false;
    this.pitchDominant = false;
  }

  update(flight, controls, speed, authority, liftScale, gravity) {
    const { forward, up, velocity, orientation, spec } = flight;
    const { aimDirection, aimHint, aimResponsiveness } = controls;
    this.rudder = 0;
    this.roll = 0;
    this.pitchLead = 0;
    this.yawLead = 0;

    if (flight.grounded) {
      this.target.copy(aimDirection ?? forward);
      this.right.copy(BODY_RIGHT).applyQuaternion(orientation);
      this.rudder = clamp(Math.atan2(this.target.dot(this.right), this.target.dot(forward)) * 1.9, -1, 1);
      this.alpha = clamp(Math.asin(clamp(this.target.y, -1, 1)) * 0.55 * aimResponsiveness, -0.20, 0.23);
      return;
    }

    this.course.copy(forward);
    if (speed > 20 && velocity.dot(forward) > speed * 0.45) this.course.copy(velocity).multiplyScalar(1 / speed);
    this.lift.copy(up).addScaledVector(this.course, -up.dot(this.course)).normalize();
    this.right.crossVectors(this.course, this.lift);
    this.gravity.copy(UP).addScaledVector(this.course, -this.course.y);

    // The target's projection onto the normal plane gives the direction in
    // which the flight path must curve, at any heading, pitch, or bank.
    this.target.copy(aimDirection ?? this.course);
    if (!aimDirection && Math.hypot(this.target.x, this.target.z) > 0.12) {
      this.target.setY(0).normalize();
    }
    const alignment = clamp(this.target.dot(this.course), -1, 1);
    this.tangent.copy(this.target).addScaledVector(this.course, -alignment);
    const tangentLength = this.tangent.length();
    const angle = Math.atan2(tangentLength, alignment);
    if (alignment < -0.997) {
      this.tangent.copy(!this.holdingOpposite && aimHint ? aimHint : this.turnSide);
      if (this.tangent.lengthSq() === 0) this.tangent.copy(this.right);
      this.tangent.addScaledVector(this.course, -this.tangent.dot(this.course));
      if (this.tangent.lengthSq() < 0.001) this.tangent.copy(this.right);
      this.tangent.normalize();
      this.turnSide.copy(this.tangent);
    } else if (tangentLength > 0.00001) {
      this.tangent.multiplyScalar(1 / tangentLength);
      this.turnSide.copy(this.tangent);
    }

    this.holdingOpposite = alignment < -0.997;
    const loadLimit = spec.maxG * 0.91;
    const turnLoad = Math.min(loadLimit, angle * tuning.courseGain * aimResponsiveness * speed / gravity);
    const lead = tuning.rolloutLead * (1 - smoothstep(angle, 0.1, 0.65));
    this.liftDemand.copy(this.gravity).multiplyScalar(1 + lead)
      .addScaledVector(this.tangent, turnLoad).addScaledVector(this.lift, -flight.g * lead);
    const demand = this.liftDemand.length();
    let localUp = this.liftDemand.dot(this.lift);
    let localRight = this.liftDemand.dot(this.right);
    const maxAlpha = lerp(spec.stallAngle - 0.035, spec.stallAngle + 0.01, authority);
    const attainableLoad = (spec.baseLift + maxAlpha * spec.liftSlope) / liftScale;
    const turnSpeed = Math.max(60, speed);
    this.pitchLead = -(flight.g - this.lift.y) * gravity / turnSpeed * tuning.pitchFeedforward;
    this.yawLead = this.right.y * gravity / turnSpeed * tuning.yawFeedforward;

    if (controls.pitchPriority && this.usePitch(angle)) {
      const horizon = this.gravity.length();
      const levelUp = this.gravity.dot(this.lift);
      const levelSide = Math.sign(levelUp) || 1;
      const levelRoll = Math.atan2(levelSide * this.gravity.dot(this.right), Math.abs(levelUp));
      const sidewaysLoad = this.tangent.dot(this.levelRight) * turnLoad;
      const trimBank = clamp(sidewaysLoad * levelSide * localUp / (1 + localUp ** 2), -0.24, 0.24);
      // Select the nearer level attitude. Fade across knife edge and near the
      // vertical so a manual roll or a pitch through the pole stays continuous.
      const levelWeight = smoothstep(horizon, 0.12, 0.35)
        * smoothstep(Math.abs(levelUp) / Math.max(horizon, 0.001), 0.07, 0.40);
      this.roll = clamp((levelRoll + trimBank) * levelWeight * tuning.levelGain - flight.rates.z * tuning.rollDamping,
        -tuning.levelRate, tuning.levelRate);
      const load = clamp(localUp, spec.minG * 0.95, Math.min(loadLimit, attainableLoad));
      this.alpha = (load * liftScale - spec.baseLift) / spec.liftSlope;
      return;
    }

    // For gentle pushovers use signed lift from an upright attitude. Larger
    // turns bank the lift vector toward the target and pull positively.
    const gentlePush = angle < 0.24 && localUp < 0 && Math.abs(localRight) < demand * 0.45
      && this.gravity.dot(this.lift) > 0.72;
    if (gentlePush) {
      localUp *= -1;
      localRight *= -1;
    }
    let rollError = demand > 0.09 ? Math.atan2(localRight, localUp) : 0;
    if (Math.abs(rollError) > Math.PI - 0.07) {
      rollError = Math.abs(rollError) * this.lastRollSign;
    } else if (Math.abs(rollError) > 0.12) {
      this.lastRollSign = Math.sign(rollError);
    }
    this.roll = clamp(rollError * tuning.rollGain - flight.rates.z * tuning.rollDamping,
      -spec.rollRate, spec.rollRate);

    const load = gentlePush
      ? -Math.min(demand, 1.35)
      : Math.min(loadLimit, attainableLoad, Math.max(0.06, localUp));
    this.alpha = (load * liftScale - spec.baseLift) / spec.liftSlope;
  }

  usePitch(angle) {
    // Measure sideways steering relative to the horizon, independent of bank.
    // Keep the last reliable plane when the course is close to vertical.
    if (this.gravity.lengthSq() > 0.12 ** 2) this.levelRight.crossVectors(this.course, UP).normalize();
    else if (this.levelRight.lengthSq() === 0) this.levelRight.copy(this.right);
    const lateral = angle * Math.min(1, Math.abs(this.tangent.dot(this.levelRight)));
    const vertical = Math.sqrt(Math.max(0, angle ** 2 - lateral ** 2));
    const threshold = this.pitchDominant ? tuning.pitchExitLateral : tuning.pitchEnterLateral;
    this.pitchDominant = lateral < threshold && (this.pitchDominant || lateral < 0.008 || vertical >= lateral * 1.3);
    return this.pitchDominant;
  }

  pitchRate(alpha, targetAlpha) {
    return (alpha - targetAlpha) * tuning.pitchGain + this.pitchLead;
  }
}
