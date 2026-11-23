import { MathUtils, Vector3 } from 'three';

const { clamp, lerp, smoothstep } = MathUtils;
const UP = new Vector3(0, 1, 0);
const BODY_RIGHT = new Vector3(-1, 0, 0);

export const horizontalSteering = {
  fineAngle: .10, fullBankAngle: .61, maxBank: 1.47, rudderGain: 3.6,
  rollGain: 3.1, damping: .78, response: 9.5, hysteresis: .016, slipLimit: .085,
  highSpeedRudder: .52,
};

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
    this.horizontal = new Vector3();
    this.reset();
  }

  reset() {
    this.turnSide.set(0, 0, 0);
    this.levelRight.set(0, 0, 0);
    this.lastRollSign = 1;
    this.holdingOpposite = false;
    this.pitchDominant = false;
    this.bankBlend = 0;
    this.committedTurn = 0;
  }

  update(flight, controls, speed, authority, liftScale, gravity, dt, sideslip) {
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
    let localUp = this.liftDemand.dot(this.lift);
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

    const config = spec.horizontalSteering ?? horizontalSteering;
    let rollBlend = 1;
    if (controls.pitchPriority && aimDirection) {
      const horizon = Math.hypot(forward.x, forward.z) * Math.hypot(this.target.x, this.target.z);
      this.horizontal.crossVectors(forward, UP).normalize();
      const headingError = Math.atan2(this.target.dot(this.horizontal) * Math.hypot(forward.x, forward.z),
        forward.x * this.target.x + forward.z * this.target.z);
      const horizontalWeight = smoothstep(horizon, .08, .55);
      const entered = Math.max(smoothstep(angle, .58, .95), (1 - horizontalWeight) * smoothstep(angle, .20, .50));
      const holding = smoothstep(angle, .025, .065);
      this.committedTurn = Math.max(entered, this.committedTurn * (holding < 1 ? 1 - dt * (1 - holding) * 3 : 1));
      const fineAuthority = 1 - this.committedTurn;
      const yawCapacity = clamp(spec.yawRate / .44 * flight.damage.yawAuthority * authority, 0, 1);
      const usableRudder = lerp(.58, 1, yawCapacity) * lerp(1, config.highSpeedRudder, smoothstep(speed, 190, 370));
      const hysteresis = config.hysteresis * (1 - this.bankBlend * 2);
      const fineAngle = config.fineAngle * usableRudder + hysteresis;
      const desiredBlend = smoothstep(Math.abs(headingError), fineAngle, config.fullBankAngle * lerp(.76, 1, usableRudder));
      this.bankBlend = lerp(this.bankBlend, desiredBlend, 1 - Math.exp(-dt * (config.response + desiredBlend * 8)));
      const fineRudder = clamp(headingError * config.rudderGain, -.46, .46);
      const slipMargin = 1 - smoothstep(Math.abs(sideslip), config.slipLimit * .55, config.slipLimit);
      const rudderAuthority = usableRudder * slipMargin * horizontalWeight;
      this.rudder = fineRudder * (1 - this.bankBlend) * rudderAuthority * fineAuthority;

      // Limit only the horizontal component. Preserve the vertical lift demand
      // and the original turn plane for large commands and near the poles.
      if (horizontalWeight > 0 && this.gravity.lengthSq() > .12 ** 2) {
        this.horizontal.crossVectors(this.course, UP).normalize();
        const side = this.liftDemand.dot(this.horizontal);
        const fineLoad = clamp(side, -.16, .16);
        const allowedBank = lerp(.19, config.maxBank, smoothstep(Math.abs(headingError), .11, .88));
        const bankLimit = Math.max(0.08, this.liftDemand.dot(this.gravity) / this.gravity.length()) * Math.tan(allowedBank);
        const bankedLoad = clamp(side, -bankLimit, bankLimit);
        const scheduled = lerp(fineLoad, bankedLoad, this.bankBlend);
        const verticalCommand = 1 - smoothstep(Math.abs(this.tangent.dot(this.horizontal)), .27, .65);
        const fullTurn = Math.max(verticalCommand, smoothstep(angle, .72, 1.18));
        this.liftDemand.addScaledVector(this.horizontal, (scheduled - side) * horizontalWeight * (1 - fullTurn) * fineAuthority);
        localUp = this.liftDemand.dot(this.lift);
      }
      rollBlend = Math.max(this.bankBlend, 1 - horizontalWeight, this.committedTurn);
    }
    const demand = this.liftDemand.length();
    let localRight = this.liftDemand.dot(this.right);

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
    this.roll = clamp(rollError * lerp(config.rollGain, tuning.rollGain, rollBlend)
      - flight.rates.z * lerp(config.damping, tuning.rollDamping, rollBlend), -spec.rollRate, spec.rollRate);

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
