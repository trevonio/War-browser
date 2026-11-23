import { MathUtils, Quaternion, Vector3 } from 'three';
import { AircraftDamage } from './aircraft-damage.js';
import { ControlSurfaces } from './control-surfaces.js';
import { Engines } from './engines.js';
import { FlightInstructor } from './instructor.js';

const { clamp, lerp, smoothstep } = MathUtils;
export const STEP = 1 / 120;
const GRAVITY = 9.80665;
const FORWARD = new Vector3(0, 0, 1);
const UP = new Vector3(0, 1, 0);
const noTanks = [];
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
    this.previousVelocity = new Vector3();
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
    this.surfaces = new ControlSurfaces(spec.surfaces);
    this.damage = new AircraftDamage(spec.damageComponents, spec.engines);
    this.engines = new Engines(spec, this.damage);
  }

  reset(scenario) {
    const { x, y, z, speed, pitch, throttle, runway, heading = 0 } = scenario;
    this.position.set(x, runway ? this.world.heightAt(x, z) + this.spec.gearClearance : y, z);
    this.rotationStep.setFromAxisAngle(this.angularStep.set(1, 0, 0), -pitch);
    this.orientation.setFromAxisAngle(UP, -heading).multiply(this.rotationStep);
    this.velocity.set(-Math.sin(heading) * speed, 0, Math.cos(heading) * speed);
    this.rates.set(0, 0, 0);
    this.instructor.reset();
    this.damage.reset();
    this.previousPosition.copy(this.position);
    this.previousVelocity.copy(this.velocity);
    this.previousOrientation.copy(this.orientation);
    this.grounded = runway;
    this.gearDown = runway;
    this.previousGear = this.gear = Number(runway);
    this.flapIndex = runway && this.spec.flaps ? 1 : 0;
    this.surfaces.reset(this.gear, speed, this.spec.flaps?.angles[this.flapIndex]);
    this.wheelSpin = 0;
    this.brake = 0;
    this.stores = true;
    this.setPayload(0, 0);
    this.customStores = false;
    this.ammunitionMass = 0;
    this.setExternalTanks(noTanks);
    this.fuel = this.spec.fuelCapacity * 0.73;
    this.throttle = throttle;
    this.spool = throttle;
    this.engines.reset(throttle);
    this.burnerArmed = false;
    this.afterburner = false;
    this.thrust = 0;
    this.g = 1;
    this.gWarning = '';
    this.alpha = pitch;
    this.stalled = false;
    this.flapLift = 0;
    this.blackout = 0;
    this.redout = 0;
    this.stress = 0;
    this.failure = '';
    this.elapsed = 0;
    this.turnRate = 0;
    this.protectedAirframe = false;
    this.updateInstruments();
  }

  toggleAfterburner() {
    this.burnerArmed = !this.burnerArmed && this.totalFuel > 0 && this.engines.canBurn;
    if (this.burnerArmed) this.throttle = 1;
  }

  cycleFlaps() {
    if (this.spec.flaps) this.flapIndex = (this.flapIndex + 1) % this.spec.flaps.angles.length;
  }

  step(controls, dt = STEP) {
    if (this.failure) return;
    const { spec, damage } = this;
    this.elapsed += dt;
    this.previousPosition.copy(this.position);
    this.previousVelocity.copy(this.velocity);
    this.previousOrientation.copy(this.orientation);

    this.throttle = clamp(this.throttle + controls.throttle * 0.36 * dt, 0, 1);
    if (this.throttle < 0.97 || !this.totalFuel || !this.engines.canBurn) this.burnerArmed = false;
    this.previousGear = this.gear;
    const gearMovement = dt / spec.gearTime;
    if (!this.grounded) this.gear = clamp(this.gear + (this.gearDown ? gearMovement : -gearMovement), 0, 1);
    this.brake = clamp(this.brake + (controls.brakes ? dt * 3 : -dt * 3), 0, 1);

    const speed = this.velocity.length();
    const altitude = Math.max(0, this.position.y);
    const temperature = Math.max(216.65, 288.15 - 0.0065 * altitude);
    const density = 1.225 * Math.pow(temperature / 288.15, 4.256) * Math.exp(-Math.max(0, altitude - 11000) / 6330);
    const mach = speed / Math.sqrt(1.4 * 287.05 * temperature);
    const dynamicPressure = 0.5 * density * speed * speed;
    const mass = this.mass;
    this.engines.step(this.throttle, this.totalFuel, this.burnerArmed, density, mach, dt);
    const { thrust, spool, afterburner, yawMoment, burn } = this.engines;
    this.thrust = thrust;
    this.spool = spool;
    this.afterburner = afterburner;

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
    const highAlpha = spec.highAlpha;
    const stallControl = 1 - (highAlpha?.controlLoss ?? 0.64)
      * smoothstep(Math.abs(alpha), spec.stallAngle, highAlpha?.separationEnd ?? 0.67);
    const authority = airAuthority * highSpeedControl * stallControl;
    const bank = Math.atan2(this.up.dot(this.angularStep.set(-this.forward.z, 0, this.forward.x).normalize()), this.up.y);
    const liftScale = mass * GRAVITY / Math.max(1, dynamicPressure * spec.wingArea * damage.lift);
    const flapFraction = spec.flaps ? this.surfaces.angles.Flap / spec.flaps.angles.at(-1) : 0;
    const flapLift = this.flapLift = flapFraction * (spec.flaps?.lift ?? 0);
    const liftLimit = 0.95 * (spec.maxG * liftScale - spec.baseLift - flapLift) / spec.liftSlope;
    const downLimit = 0.95 * (spec.minG * liftScale - spec.baseLift - flapLift) / spec.liftSlope;
    const instructor = this.instructor;
    if (controls.assisted) instructor.update(this, controls, speed, authority, liftScale, GRAVITY, dt, sideslip);

    const trimG = 1 / Math.max(0.36, Math.cos(bank));
    const levelAlpha = (trimG * liftScale - spec.baseLift - flapLift) / spec.liftSlope;
    const trim = this.grounded ? 0 : clamp(levelAlpha, -0.03, 0.17);
    const assistedPitch = controls.assisted && Math.abs(controls.pitch) <= 0.01;
    const alphaDemand = assistedPitch ? instructor.alpha : trim + controls.pitch * (highAlpha?.manual ?? 0.32);
    const desiredAlpha = clamp(alphaDemand, Math.max(-0.23, downLimit), Math.min(highAlpha?.commanded ?? 0.34, liftLimit));
    const pitchCommand = assistedPitch ? instructor.pitchRate(alpha, desiredAlpha) : (alpha - desiredAlpha) * 5.6;
    let pitchRate = clamp(pitchCommand, -spec.pitchRate, spec.pitchRate) * authority;

    const rollCommand = controls.roll ? controls.roll * spec.rollRate : controls.assisted ? instructor.roll : 0;
    let rollRate = this.grounded ? 0 : rollCommand * authority;
    const groundSteering = this.grounded ? clamp(speed / 25, 0, 0.35) : 0;
    const rudder = controls.yaw || (controls.assisted ? instructor.rudder : 0);
    const coordinatedYaw = controls.assisted ? instructor.yawLead : 0;
    const yawRate = (-rudder * spec.yawRate * damage.yawAuthority + clamp(sideslip * 1.8 + coordinatedYaw, -0.28, 0.28))
      * (authority + groundSteering) + yawMoment / (mass * (spec.yawInertia ?? 28));
    this.surfaces.step(dt, -pitchRate / spec.pitchRate, rollRate / spec.rollRate,
      rudder * authority * (spec.surfaces?.rudderDamage ? damage.yawAuthority : 1), this.gear, speed, alpha, damage.surfaceAuthority, this.brake,
      spec.flaps?.angles[this.flapIndex]);
    if (damage.active) {
      const angles = this.surfaces.angles;
      const effective = damage.surfaceAuthority;
      // A jammed surface keeps the moment of its last deflection until lost.
      const stuckLeftTail = effective.LeftStabilator === 0 && damage.health.leftStabilator > 0 ? angles.LeftStabilator : 0;
      const stuckRightTail = effective.RightStabilator === 0 && damage.health.rightStabilator > 0 ? angles.RightStabilator : 0;
      pitchRate = pitchRate * damage.pitchAuthority - (stuckLeftTail + stuckRightTail) * authority * 0.008;
      if (!this.grounded) {
        const stuckLeft = effective.LeftFlaperon === 0 && damage.health.leftFlaperon > 0 && damage.health.leftWing > 0
          ? angles.LeftFlaperon : 0;
        const stuckRight = effective.RightFlaperon === 0 && damage.health.rightFlaperon > 0 && damage.health.rightWing > 0
          ? angles.RightFlaperon : 0;
        const wingMoment = (damage.wingLeft - damage.wingRight) * clamp(this.g, -2.2, 4.4) * 0.22;
        rollRate = rollRate * damage.rollAuthority
          + authority * (wingMoment + (stuckLeft - stuckRight) * 0.018 + (stuckLeftTail - stuckRightTail) * 0.006);
      }
    }
    if (!this.grounded && spec.payloadHandling) {
      let lateralMoment = this.payloadMoment;
      for (const tank of this.externalTanks) lateralMoment += tank.fuel * (tank.offset?.[0] ?? 0);
      rollRate -= authority * lateralMoment / mass * spec.payloadHandling.rollBias;
    }
    const loaded = spec.payloadHandling ? 1 + this.payloadMass / spec.payloadHandling.responseMass : 1;
    const response = 1 - Math.exp(-5.8 * dt / loaded);
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
    const separation = smoothstep(Math.abs(alpha), spec.stallAngle, highAlpha?.separationEnd ?? 0.66);
    const liftCoefficient = damage.lift * (spec.baseLift + flapLift + spec.liftSlope * attachedAlpha) * (1 - 0.79 * separation)
      * (1 - 0.10 * smoothstep(mach, 0.91, 1.27));
    const speedLimitDrag = spec.maxMach ? 0.24 * smoothstep(mach, spec.maxMach * 0.94, spec.maxMach * 1.08) : 0;
    const waveDrag = spec.waveDrag * smoothstep(mach, 0.76, 1.07) * (1 - 0.37 * smoothstep(mach, 1.10, 1.70));
    const maneuverDrag = highAlpha ? highAlpha.maneuverDrag * smoothstep(Math.abs(alpha), .16, .50) : 0;
    const dragCoefficient = spec.baseDrag + spec.inducedDrag * liftCoefficient ** 2 + waveDrag + maneuverDrag
      + speedLimitDrag + separation * 0.48 + 0.035 * this.gear + 0.088 * this.brake + (this.stores && !this.customStores ? 0.006 : 0)
      + 0.28 * sideslip ** 2 + damage.drag + this.payloadDrag + flapFraction * (spec.flaps?.drag ?? 0);
    this.consumeFuel(burn, damage.leak, dt);

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
      this.wheelSpin = (this.wheelSpin + speed * dt / 0.27) % (2 * Math.PI);
      const rollingResistance = mass * GRAVITY * (controls.brakes ? 0.36 : 0.018);
      this.force.addScaledVector(this.airDirection, -Math.min(rollingResistance, speed * mass / dt));
      if (this.force.y > 0 && speed > 45) this.grounded = false;
    }
    this.velocity.addScaledVector(this.force, dt / mass);
    this.position.addScaledVector(this.velocity, dt);
    this.checkGround();
    this.updatePilot(dt);
    const priorHeading = this.heading;
    this.updateInstruments();
    const headingChange = ((this.heading - priorHeading + 540) % 360) - 180;
    this.turnRate = lerp(this.turnRate, headingChange / dt, 1 - Math.exp(-6 * dt));
  }

  checkGround() {
    const floor = this.world.heightAt(this.position.x, this.position.z);
    const contact = floor + lerp(0.70, this.spec.gearClearance, this.gear);
    if (this.position.y > contact) return;
    const pitch = Math.asin(clamp(this.forward.y, -1, 1));
    if (!this.grounded && (this.gear < 0.95 || this.gearDamaged || this.velocity.y < -8.5 || this.up.y < 0.88 ||
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
    if (this.protectedAirframe) return;
    const { damage } = this;
    const excess = Math.max(0, this.g - this.spec.maxG * damage.loadLimit, this.spec.minG * damage.loadLimit - this.g);
    this.stress = clamp(this.stress + (excess * 0.27 - 0.10) * dt, 0, 1);
    if (this.stress >= 1) this.failure = 'Structural failure';
    damage.progress(dt, this.totalFuel, excess);
    this.failure ||= damage.failure;
  }

  setPayload(mass, drag, lateralMoment = 0) {
    this.payloadMass = mass;
    this.payloadMoment = lateralMoment;
    this.payloadDrag = drag;
  }

  setExternalTanks(tanks) {
    this.externalTanks = tanks;
    this.externalFuel = 0;
    this.externalCapacity = 0;
    for (const tank of tanks) {
      this.externalFuel += tank.fuel;
      this.externalCapacity += tank.fuelCapacity;
    }
  }

  consumeFuel(burn, leak, dt) {
    if (!this.externalFuel) {
      this.fuel = Math.max(0, this.fuel - (burn + leak) * dt);
      return;
    }
    let remaining = burn * dt;
    for (const tank of this.externalTanks) {
      const used = Math.min(remaining, tank.fuel);
      tank.fuel -= used;
      this.externalFuel -= used;
      remaining -= used;
    }
    this.externalFuel = Math.max(0, this.externalFuel);
    this.fuel = Math.max(0, this.fuel - remaining - leak * dt);
  }

  get gearDamaged() { return Boolean(this.spec.gearComponents?.some((part) => this.damage.condition(part) <= .2)); }

  get totalFuel() { return this.fuel + this.externalFuel; }

  get mass() {
    return this.spec.emptyMass + this.totalFuel + (this.stores && !this.customStores ? this.spec.storesMass : 0)
      + this.payloadMass + this.ammunitionMass;
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
