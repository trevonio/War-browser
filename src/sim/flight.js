import { MathUtils, Quaternion, Vector3 } from 'three';
import { FlightInstructor } from './instructor.js';

const { clamp, lerp, smoothstep } = MathUtils;
export const STEP = 1 / 120;
const GRAVITY = 9.80665;
const FORWARD = new Vector3(0, 0, 1);
const UP = new Vector3(0, 1, 0);
const MPS_TO_KNOTS = 1.943844;
const METERS_TO_FEET = 3.28084;

export const neutralControls = {
  pitch: 0, roll: 0, yaw: 0, throttle: 0, aimDirection: null, aimHint: null, aimResponsiveness: 1,
  assisted: true, brakes: false,
};

export class Flight {
  constructor(spec, world) {
    this.spec = spec;
    this.world = world;
    this.position = new Vector3();
    this.orientation = new Quaternion();
    this.velocity = new Vector3();
    this.rates = new Vector3();
    this.previousPosition = new Vector3();
    this.previousOrientation = new Quaternion();
    this.localVelocity = new Vector3();
    this.forward = new Vector3();
    this.up = new Vector3();
    this.airDirection = new Vector3();
    this.liftDirection = new Vector3();
    this.force = new Vector3();
    this.angularStep = new Vector3();
    this.rotationStep = new Quaternion();
    this.inverse = new Quaternion();
    this.instructor = new FlightInstructor();
  }

  reset(scenario) {
    const { x, y, z, speed, pitch, throttle, runway } = scenario;
    this.position.set(x, y, z);
    this.orientation.setFromAxisAngle(this.angularStep.set(1, 0, 0), -pitch);
    this.velocity.set(0, 0, speed);
    this.rates.set(0, 0, 0);
    this.instructor.reset();
    this.previousPosition.copy(this.position);
    this.previousOrientation.copy(this.orientation);
    this.grounded = runway;
    this.gearDown = runway;
    this.gear = Number(runway);
    this.brake = 0;
    this.stores = true;
    this.fuel = this.spec.fuelCapacity * 0.73;
    this.throttle = throttle;
    this.spool = throttle;
    this.burnerArmed = false;
    this.afterburner = false;
    this.thrust = 0;
    this.g = 1;
    this.gWarning = '';
    this.alpha = pitch;
    this.stalled = false;
    this.blackout = 0;
    this.redout = 0;
    this.stress = 0;
    this.failure = '';
    this.elapsed = 0;
    this.updateInstruments();
  }

  toggleAfterburner() {
    this.burnerArmed = !this.burnerArmed && this.fuel > 0;
    if (this.burnerArmed) this.throttle = 1;
  }

  step(controls, dt = STEP) {
    if (this.failure) return;
    const spec = this.spec;
    this.elapsed += dt;
    this.previousPosition.copy(this.position);
    this.previousOrientation.copy(this.orientation);

    this.throttle = clamp(this.throttle + controls.throttle * 0.36 * dt, 0, 1);
    if (this.throttle < 0.97 || !this.fuel) this.burnerArmed = false;
    this.spool += ((this.fuel ? this.throttle : 0) - this.spool) * (1 - Math.exp(-spec.spoolResponse * dt));
    this.afterburner = this.burnerArmed && this.spool > 0.89;
    const gearMovement = dt / spec.gearTime;
    if (!this.grounded) this.gear = clamp(this.gear + (this.gearDown ? gearMovement : -gearMovement), 0, 1);
    this.brake = clamp(this.brake + (controls.brakes ? dt * 3 : -dt * 3), 0, 1);

    const speed = this.velocity.length();
    const altitude = Math.max(0, this.position.y);
    const temperature = Math.max(216.65, 288.15 - 0.0065 * altitude);
    const density = 1.225 * Math.pow(temperature / 288.15, 4.256) * Math.exp(-Math.max(0, altitude - 11000) / 6330);
    const mach = speed / Math.sqrt(1.4 * 287.05 * temperature);
    const dynamicPressure = 0.5 * density * speed * speed;
    const mass = spec.emptyMass + this.fuel + (this.stores ? spec.storesMass : 0);

    this.forward.copy(FORWARD).applyQuaternion(this.orientation);
    this.up.copy(UP).applyQuaternion(this.orientation);
    this.inverse.copy(this.orientation).invert();
    this.localVelocity.copy(this.velocity).applyQuaternion(this.inverse);
    const alpha = Math.atan2(-this.localVelocity.y, Math.max(1, this.localVelocity.z));
    const sideslip = Math.atan2(this.localVelocity.x, Math.max(1, this.localVelocity.z));
    this.alpha = alpha;
    this.stalled = speed > 30 && Math.abs(alpha) > spec.stallAngle;

    const airAuthority = clamp(Math.sqrt(dynamicPressure / (0.5 * 1.225 * spec.controlSpeed ** 2)), 0, 1);
    const highSpeedControl = 1 - 0.41 * smoothstep(mach, 0.83, 1.26);
    const stallControl = 1 - 0.64 * smoothstep(Math.abs(alpha), spec.stallAngle, 0.67);
    const authority = airAuthority * highSpeedControl * stallControl;
    const bank = Math.atan2(this.up.dot(this.angularStep.set(-this.forward.z, 0, this.forward.x).normalize()), this.up.y);
    const liftScale = mass * GRAVITY / Math.max(1, dynamicPressure * spec.wingArea);
    const liftLimit = 0.95 * (spec.maxG * liftScale - spec.baseLift) / spec.liftSlope;
    const downLimit = 0.95 * (spec.minG * liftScale - spec.baseLift) / spec.liftSlope;
    const instructor = this.instructor;
    if (controls.assisted) instructor.update(this, controls, speed, authority, liftScale, GRAVITY);

    const trimG = 1 / Math.max(0.36, Math.cos(bank));
    const levelAlpha = (trimG * liftScale - spec.baseLift) / spec.liftSlope;
    const trim = this.grounded ? 0 : clamp(levelAlpha, -0.03, 0.17);
    const assistedPitch = controls.assisted && Math.abs(controls.pitch) <= 0.01;
    const alphaDemand = assistedPitch ? instructor.alpha : trim + controls.pitch * 0.32;
    const desiredAlpha = clamp(alphaDemand, Math.max(-0.23, downLimit), Math.min(0.34, liftLimit));
    const pitchCommand = assistedPitch ? instructor.pitchRate(alpha, desiredAlpha) : (alpha - desiredAlpha) * 5.6;
    const pitchRate = clamp(pitchCommand, -spec.pitchRate, spec.pitchRate) * authority;

    const rollCommand = controls.roll ? controls.roll * spec.rollRate : controls.assisted ? instructor.roll : 0;
    const rollRate = this.grounded ? 0 : rollCommand * authority;
    const groundSteering = this.grounded ? clamp(speed / 25, 0, 0.35) : 0;
    const rudder = controls.yaw || (controls.assisted ? instructor.rudder : 0);
    const coordinatedYaw = controls.assisted ? instructor.yawLead : 0;
    const yawRate = (-rudder * spec.yawRate + clamp(sideslip * 1.8 + coordinatedYaw, -0.28, 0.28))
      * (authority + groundSteering);
    const response = 1 - Math.exp(-5.8 * dt);
    this.rates.x = lerp(this.rates.x, pitchRate, response);
    this.rates.y = lerp(this.rates.y, yawRate, response);
    this.rates.z = lerp(this.rates.z, rollRate, response);
    this.angularStep.copy(this.rates).multiplyScalar(dt);
    const rotation = this.angularStep.length();
    if (rotation > 0) {
      this.rotationStep.setFromAxisAngle(this.angularStep.multiplyScalar(1 / rotation), rotation);
      this.orientation.multiply(this.rotationStep).normalize();
    }

    // Standard force magnitudes use qS. Lift remains perpendicular to the flight
    // path. Beyond critical alpha the lift curve falls away and separation adds drag.
    const attachedAlpha = clamp(alpha, -spec.stallAngle, spec.stallAngle);
    const separation = smoothstep(Math.abs(alpha), spec.stallAngle, 0.66);
    const liftCoefficient = (spec.baseLift + spec.liftSlope * attachedAlpha) * (1 - 0.79 * separation)
      * (1 - 0.10 * smoothstep(mach, 0.91, 1.27));
    const waveDrag = spec.waveDrag * smoothstep(mach, 0.76, 1.07) * (1 - 0.37 * smoothstep(mach, 1.10, 1.70));
    const dragCoefficient = spec.baseDrag + spec.inducedDrag * liftCoefficient ** 2 + waveDrag
      + separation * 0.48 + 0.035 * this.gear + 0.088 * this.brake + (this.stores ? 0.006 : 0)
      + 0.28 * sideslip ** 2;
    const altitudeThrust = Math.pow(density / 1.225, 0.62);
    const ramEffect = 1 + 0.17 * Math.min(mach, 1.6);
    const thrustAtPower = spec.militaryThrust * (0.05 + 0.95 * this.spool ** 1.3);
    this.thrust = this.fuel ? (this.afterburner ? spec.afterburnerThrust : thrustAtPower) * altitudeThrust * ramEffect : 0;
    const fuelFlow = lerp(spec.idleFuelFlow, spec.militaryFuelFlow, this.spool ** 1.15);
    this.fuel = Math.max(0, this.fuel - (this.afterburner ? spec.afterburnerFuelFlow : fuelFlow) * altitudeThrust * dt);

    this.airDirection.copy(this.velocity).normalize();
    this.liftDirection.copy(this.up).addScaledVector(this.airDirection, -this.up.dot(this.airDirection)).normalize();
    const qArea = dynamicPressure * spec.wingArea;
    this.force.copy(this.forward).multiplyScalar(this.thrust)
      .addScaledVector(this.liftDirection, qArea * liftCoefficient)
      .addScaledVector(this.airDirection, -qArea * dragCoefficient);
    this.angularStep.set(1, 0, 0).applyQuaternion(this.orientation);
    this.force.addScaledVector(this.angularStep, -qArea * sideslip * 0.58);
    this.g = this.grounded ? 1 : this.force.dot(this.up) / (mass * GRAVITY);
    this.force.y -= mass * GRAVITY;

    if (this.grounded) {
      const rollingResistance = mass * GRAVITY * (controls.brakes ? 0.36 : 0.018);
      this.force.addScaledVector(this.airDirection, -Math.min(rollingResistance, speed * mass / dt));
      if (this.force.y > 0 && speed > 45) this.grounded = false;
    }
    this.velocity.addScaledVector(this.force, dt / mass);
    this.position.addScaledVector(this.velocity, dt);
    this.checkGround();
    this.updatePilot(dt);
    this.updateInstruments();
  }

  checkGround() {
    const floor = this.world.heightAt(this.position.x, this.position.z);
    const contact = floor + lerp(0.70, this.spec.gearClearance, this.gear);
    if (this.position.y > contact) return;
    const pitch = Math.asin(clamp(this.forward.y, -1, 1));
    if (!this.grounded && (this.gear < 0.95 || this.velocity.y < -8.5 || this.up.y < 0.88 ||
      pitch < -0.13 || pitch > 0.30 || !this.world.isRunway(this.position.x, this.position.z))) {
      this.failure = floor <= 0 ? 'Water impact' : 'Ground impact';
    }
    this.grounded = true;
    this.position.y = contact;
    this.velocity.y = Math.max(0, this.velocity.y);
    if (!this.world.isRunway(this.position.x, this.position.z)) this.failure ||= 'Runway excursion';
  }

  updatePilot(dt) {
    if (this.g >= 5.8) this.gWarning = 'HIGH G';
    else if (this.g <= -1.5) this.gWarning = 'NEGATIVE G';
    else if ((this.gWarning === 'HIGH G' && this.g < 5.3) ||
      (this.gWarning === 'NEGATIVE G' && this.g > -1.2)) this.gWarning = '';
    const overload = smoothstep(this.g, 5.6, 9.5);
    const negative = smoothstep(-this.g, 0.8, 3.5);
    this.blackout = clamp(this.blackout + (overload * 0.5 - (1 - overload) * 0.25) * dt, 0, 0.93);
    this.redout = clamp(this.redout + (negative * 0.55 - (1 - negative) * 0.34) * dt, 0, 0.85);
    const excess = Math.max(0, this.g - this.spec.maxG, this.spec.minG - this.g);
    this.stress = clamp(this.stress + (excess * 0.27 - 0.10) * dt, 0, 1);
    if (this.stress >= 1) this.failure = 'Structural failure';
  }

  updateInstruments() {
    this.forward.copy(FORWARD).applyQuaternion(this.orientation);
    const densityRatio = Math.pow(Math.max(216.65, 288.15 - 0.0065 * Math.max(0, this.position.y)) / 288.15, 4.256)
      * Math.exp(-Math.max(0, this.position.y - 11000) / 6330);
    const speed = this.velocity.length();
    this.airspeed = speed * Math.sqrt(densityRatio) * MPS_TO_KNOTS;
    this.altitude = Math.max(0, this.position.y) * METERS_TO_FEET;
    this.verticalSpeed = this.velocity.y * METERS_TO_FEET * 60;
    this.mach = speed / Math.sqrt(1.4 * 287.05 * Math.max(216.65, 288.15 - 0.0065 * this.position.y));
    this.heading = (MathUtils.radToDeg(Math.atan2(-this.forward.x, this.forward.z)) + 360) % 360;
  }
}
