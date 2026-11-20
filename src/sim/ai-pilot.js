import { MathUtils, Vector3 } from 'three';
import { cannonMount } from './cannon.js';
import { neutralControls } from './flight.js';
import { GunComputer } from './gun-computer.js';

const { clamp, lerp } = MathUtils;
const detectionRange = 3400;
const decisionInterval = 0.10;
const patrolTurnRate = 0.030;
const patrolTurnDuration = Math.PI / patrolTurnRate;
const patrolLeg = 8;

export const opponentModes = {
  passive: { start: 'PATROL', briefing: 'Flies a steady patrol. Holds fire.' },
  defensive: { start: 'PATROL', briefing: 'Breaks away when pursued. Holds fire.' },
  aggressive: { start: 'SEARCH', briefing: 'Closes on your aircraft and fires its cannon.' },
};

export class AIPilot {
  constructor(world, spec) {
    this.world = world;
    this.cannon = spec.cannon;
    this.speedScale = spec.controlSpeed / 120;
    this.aim = new Vector3();
    this.toPlayer = new Vector3();
    this.playerForward = new Vector3();
    this.forward = new Vector3();
    this.relativeVelocity = new Vector3();
    this.prefire = new Vector3();
    this.computer = new GunComputer(this.cannon, cannonMount(this.cannon), world);
    this.controls = { ...neutralControls, aimDirection: this.aim, aimHint: new Vector3() };
  }

  reset(mode, spawn) {
    this.mode = mode;
    this.status = opponentModes[mode].start;
    this.altitude = spawn.y;
    this.course = spawn.heading;
    this.patrolSince = 0;
    this.nextDecision = 0;
    this.maneuverUntil = 0;
    this.burstUntil = 0;
    this.nextBurst = 2;
    this.breakIndex = 0;
    this.alertUntil = 0;
    this.turnDirection = 1;
    this.fire = false;
    this.burner = false;
    this.controls.aimHint.set(-1, 0, 0);
    this.controls.brakes = false;
    this.controls.throttle = 0;
    this.setCourse(spawn.heading, 0);
  }

  setCourse(heading, climb) {
    this.aim.set(-Math.sin(heading), climb, Math.cos(heading)).normalize();
  }

  alert(time) {
    this.alertUntil = time + 5;
  }

  update(flight, player, armed = true) {
    const time = flight.elapsed;
    if (time < this.nextDecision) return this.controls;
    this.nextDecision = time + decisionInterval;

    this.toPlayer.subVectors(player.position, flight.position);
    const distance = this.toPlayer.length();
    this.toPlayer.multiplyScalar(1 / Math.max(1, distance));
    this.playerForward.set(0, 0, 1).applyQuaternion(player.orientation);
    this.forward.set(0, 0, 1).applyQuaternion(flight.orientation);
    const speed = flight.velocity.length();
    const patrolSpeed = 195 * this.speedScale;
    const ownHeading = Math.atan2(-flight.velocity.x, flight.velocity.z);
    const playerBehind = this.forward.dot(this.toPlayer) < 0.1;
    const threat = time < this.alertUntil || (distance < 1350 && playerBehind
      && this.playerForward.dot(this.toPlayer) < -0.58);
    let targetSpeed = patrolSpeed;
    this.burner = false;
    this.fire = false;

    const { damage } = flight;
    const glide = damage.enginePower < 0.27 || flight.fuel < flight.spec.fuelCapacity * 0.035;
    const retreat = damage.fire || damage.pitchAuthority < 0.57 || damage.rollAuthority < 0.55
      || damage.lift < 0.72 || damage.leak > 8;
    if (glide || retreat) {
      if (this.status !== 'GLIDING' && this.status !== 'DISENGAGING') {
        this.course = ownHeading + (glide ? 0 : this.turnDirection * 0.64);
      }
      this.status = glide ? 'GLIDING' : 'DISENGAGING';
      this.setCourse(this.course, glide ? -0.065 : 0.025);
      targetSpeed = glide ? 154 * this.speedScale : 216 * this.speedScale;
    } else if (this.mode === 'aggressive' && distance < detectionRange) {
      targetSpeed = this.engage(flight, player, distance, speed, armed);
    } else if (this.mode === 'defensive' && (threat || time < this.maneuverUntil)) {
      if (time >= this.maneuverUntil) {
        const variant = this.breakIndex++ % 3;
        const across = this.toPlayer.x * -Math.cos(ownHeading) - this.toPlayer.z * Math.sin(ownHeading);
        if (Math.abs(across) > 0.1) this.turnDirection = -Math.sign(across);
        else if (variant === 1) this.turnDirection *= -1;
        this.maneuverUntil = time + (variant === 2 ? 4.6 : 5.1) + clamp(distance / 2200, 0, 0.6);
        this.course = ownHeading + this.turnDirection * (variant === 2 ? 0.52 : 1.22);
        this.altitude = clamp(flight.position.y + (variant === 0 ? 250 : variant === 1 ? -320 : 130), 580, 2400);
        this.status = variant === 2 ? 'EXTENDING' : 'EVADING';
      }
      this.setCourse(this.course, clamp((this.altitude - flight.position.y) / 900, -0.30, 0.33));
      targetSpeed = (this.status === 'EXTENDING' ? 265 : 225) * this.speedScale;
      this.burner = this.status === 'EXTENDING' && speed < targetSpeed - 10;
    } else {
      if (this.status !== opponentModes[this.mode].start) {
        this.course = ownHeading;
        this.patrolSince = time;
        this.altitude = clamp(flight.position.y, 950, 1900);
      }
      this.status = opponentModes[this.mode].start;
      const phase = (time - this.patrolSince) % ((patrolTurnDuration + patrolLeg) * 2);
      const returning = phase >= patrolTurnDuration + patrolLeg;
      const turnTime = phase % (patrolTurnDuration + patrolLeg) - patrolLeg;
      const route = (returning ? Math.PI : 0) + clamp(turnTime, 0, patrolTurnDuration) * patrolTurnRate;
      this.setCourse(this.course + route, clamp((this.altitude - flight.position.y) / 900, -0.18, 0.20));
    }

    // Route over nearby terrain using the same pitch and lift authority as a player.
    const { x, y, z } = flight.position;
    const short = this.world.heightAt(x + flight.velocity.x * 2.3, z + flight.velocity.z * 2.3);
    const long = this.world.heightAt(x + this.aim.x * 1300, z + this.aim.z * 1300);
    const escapeClimb = (Math.max(short, long) + 270 - y - Math.min(0, 1.5 * flight.velocity.y)) / 620;
    if (this.aim.y < escapeClimb) {
      this.aim.y = clamp(escapeClimb, 0.10, 0.65);
      this.aim.normalize();
      this.fire = false;
      targetSpeed = Math.max(targetSpeed, 205 * this.speedScale);
    }
    const throttle = this.burner ? 1 : clamp(0.45 + (targetSpeed - speed) / 32, 0.08, 1);
    this.controls.throttle = clamp((throttle - flight.throttle) * 4, -1, 1);
    this.controls.brakes = !this.burner && speed > targetSpeed + 26;
    this.controls.aimResponsiveness = speed < 145 * this.speedScale ? 0.55 : 0.85;
    return this.controls;
  }

  engage(flight, player, distance, speed, armed) {
    const time = flight.elapsed;
    const facing = this.forward.dot(this.toPlayer);
    const playerFacing = this.playerForward.dot(this.toPlayer);
    const closing = this.relativeVelocity.subVectors(flight.velocity, player.velocity).dot(this.toPlayer);
    const trailing = playerFacing > 0.48 && facing > 0.35;
    const firingPass = distance < 870 && facing > 0.86;
    const overrun = trailing && distance < 175 && closing > 15;

    this.status = trailing ? 'PURSUIT' : 'INTERCEPT';
    this.aim.copy(player.position).addScaledVector(player.velocity, clamp(distance / 460, 0.25, 2));
    if (!firingPass) this.aim.addScaledVector(this.playerForward, trailing ? -125 : -240);
    if (overrun) {
      this.status = 'REPOSITIONING';
      this.aim.y += 160;
    }
    this.aim.sub(flight.position);
    this.aim.y = clamp(this.aim.y, -distance * 0.55, distance * 0.68);
    this.aim.normalize();

    if (armed && firingPass && !overrun && this.computer.lead(flight, player)) {
      this.prefire.subVectors(this.computer.point, this.computer.origin).normalize();
      // The instructor steers the flight path. Allow for the nose sitting
      // above it and add a small tracking error for a beatable opponent.
      const trackingError = Math.sin(time * 3.8) * 0.0025;
      this.aim.copy(this.prefire).addScaledVector(flight.up, trackingError - clamp(flight.alpha, -0.10, 0.12)).normalize();
      const aligned = this.computer.bore.dot(this.prefire) > (time < this.burstUntil ? 0.99994 : 0.999985);
      if (aligned && time >= this.nextBurst && distance > 85) {
        this.burstUntil = time + 0.30;
        this.nextBurst = time + 1.35;
      }
      this.fire = aligned && time < this.burstUntil;
      if (this.fire) this.status = 'FIRING';
    }

    const playerSpeed = player.velocity.length();
    const wanted = trailing ? playerSpeed + clamp((distance - 360) / 17, -40, 55)
      : lerp(172, 245, clamp((distance - 300) / 1250, 0, 1)) * this.speedScale;
    this.burner = distance > 1150 && facing > 0.36 && speed < wanted - 22;
    return clamp(wanted, 150 * this.speedScale, 285 * this.speedScale);
  }
}
