import { MathUtils, PerspectiveCamera, Quaternion, Vector3 } from 'three';

const vertical = new Vector3(0, 1, 0);

export class FlightCamera {
  constructor(world) {
    this.world = world;
    this.camera = new PerspectiveCamera(51, 1, 1.5, 125000);
    this.mode = 'chase';
    this.distance = 31;
    this.azimuth = 0;
    this.elevation = 0;
    this.forward = new Vector3();
    this.right = new Vector3();
    this.level = new Vector3(0, 0, 1);
    this.path = new Vector3();
    this.track = new Vector3();
    this.bodyUp = new Vector3();
    this.upTarget = new Vector3();
    this.offset = new Vector3();
    this.target = new Vector3();
    this.look = new Vector3();
    this.destination = new Vector3();
    this.aimView = new Quaternion();
    this.chasingAim = false;
    this.sideOffset = 0;
    this.chaseDistance = this.distance;
    this.snap = true;
  }

  orbit(dx, dy, sensitivity) {
    this.azimuth = MathUtils.euclideanModulo(this.azimuth - dx * 0.005 * sensitivity + Math.PI, 2 * Math.PI) - Math.PI;
    this.elevation = MathUtils.clamp(this.elevation - dy * 0.004 * sensitivity, -0.48, 1.18);
  }

  zoom(delta) {
    this.distance = MathUtils.clamp(this.distance * Math.exp(delta * 0.0009), 18, 65);
  }

  cycle() {
    this.mode = this.mode === 'chase' ? 'hud' : 'chase';
    this.snap = true;
  }

  update(aircraft, velocity, dt, screen, looking, smoothing, aim = null, turnResponse = 1) {
    const camera = this.camera;
    const position = aircraft.position;
    const briefing = screen === 'ready';
    if (!looking) {
      this.azimuth *= Math.exp(-9 * dt);
      this.elevation *= Math.exp(-9 * dt);
    }
    if (aim && this.mode === 'chase' && !briefing) {
      this.updateAimChase(aircraft, dt, aim, smoothing, turnResponse);
      return;
    }
    this.chasingAim = false;
    this.forward.set(0, 0, 1).applyQuaternion(aircraft.quaternion);
    if (Math.hypot(this.forward.x, this.forward.z) > 0.12) {
      this.level.set(this.forward.x, 0, this.forward.z).normalize();
    }
    this.path.copy(velocity).normalize();
    const pathBlend = MathUtils.smoothstep(this.path.dot(this.forward), 0.56, 0.96) * 0.25;
    this.track.copy(this.forward).lerp(this.path, pathBlend).normalize();
    this.right.crossVectors(this.level, vertical);
    const bodyUp = this.bodyUp.set(0, 1, 0).applyQuaternion(aircraft.quaternion);
    const noseView = this.mode === 'hud' && !briefing;
    this.upTarget.copy(vertical).lerp(bodyUp, noseView ? 1 : 0.10).normalize();
    if (briefing) {
      const portrait = this.camera.aspect < 0.9;
      this.destination.copy(position).addScaledVector(this.level, portrait ? -44 : -24)
        .addScaledVector(this.right, portrait ? 25 : 27).addScaledVector(vertical, portrait ? 13 : 8);
      this.target.copy(position).addScaledVector(this.right, portrait ? -1 : -22)
        .addScaledVector(this.level, portrait ? 7 : 1).addScaledVector(vertical, portrait ? -13 : 0.4);
    } else if (noseView) {
      this.destination.copy(position).addScaledVector(this.forward, 8.5).addScaledVector(bodyUp, 0.95);
      this.offset.copy(this.forward).applyAxisAngle(vertical, this.azimuth);
      this.offset.applyAxisAngle(this.right, this.elevation);
      this.target.copy(this.destination).addScaledVector(this.offset, 100);
    } else {
      this.offset.copy(this.track).lerp(this.level, 0.31).normalize().applyAxisAngle(vertical, this.azimuth);
      this.destination.copy(position).addScaledVector(this.offset, -this.distance * Math.cos(this.elevation));
      this.destination.addScaledVector(this.right, -bodyUp.dot(this.right) * 2.9);
      this.destination.y += this.distance * (0.22 + Math.sin(this.elevation));
      this.offset.copy(this.track).lerp(this.level, 0.42).normalize();
      this.target.copy(position).addScaledVector(this.offset, 37).addScaledVector(vertical, 1.35);
      this.target.lerp(position, Math.min(1, (Math.abs(this.azimuth) + Math.abs(this.elevation)) * 3));
    }
    const ground = this.world.heightAt(this.destination.x, this.destination.z);
    this.destination.y = Math.max(ground + 1.5, this.destination.y);
    if (this.snap || noseView) {
      camera.position.copy(this.destination);
      camera.up.copy(this.upTarget);
      this.look.copy(this.target);
      this.snap = false;
    } else {
      // Track each frame's aircraft movement before damping the camera offset.
      // This keeps the jet framed during straight high-speed flight.
      const follow = 1 - Math.exp(-9.5 * dt / smoothing);
      const look = 1 - Math.exp(-15 * dt / smoothing);
      camera.position.add(aircraft.renderMovement).lerp(this.destination, follow);
      camera.position.y = Math.max(camera.position.y, this.world.heightAt(camera.position.x, camera.position.z) + 1.5);
      camera.up.lerp(this.upTarget, follow).normalize();
      this.look.add(aircraft.renderMovement).lerp(this.target, look);
    }
    camera.lookAt(this.look);
    camera.updateMatrixWorld();
  }

  updateAimChase(aircraft, dt, aim, smoothing, turnResponse) {
    const camera = this.camera;
    const position = aircraft.position;
    if (this.snap || !this.chasingAim) {
      this.aimView.copy(aim.orientation);
      this.chaseDistance = this.distance;
      this.sideOffset = 0;
    } else {
      this.aimView.slerp(aim.orientation, 1 - Math.exp(-8.5 * turnResponse * dt));
      this.chaseDistance = MathUtils.lerp(this.chaseDistance, this.distance, 1 - Math.exp(-7 * dt / smoothing));
    }
    this.chasingAim = true;
    this.snap = false;

    this.forward.set(0, 0, 1).applyQuaternion(this.aimView);
    this.upTarget.set(0, 1, 0).applyQuaternion(this.aimView);
    this.bodyUp.set(0, 1, 0).applyQuaternion(aircraft.quaternion);
    if (this.azimuth || this.elevation) {
      this.forward.applyAxisAngle(this.upTarget, this.azimuth);
      this.right.crossVectors(this.forward, this.upTarget);
      this.forward.applyAxisAngle(this.right, this.elevation);
      this.upTarget.applyAxisAngle(this.right, this.elevation);
    }
    this.right.crossVectors(this.forward, this.upTarget);
    const lean = -this.bodyUp.dot(this.right) * 2.7;
    this.sideOffset = MathUtils.lerp(this.sideOffset, lean, 1 - Math.exp(-7 * dt / smoothing));

    // Position and view use the same rotating boom. It orbits the aircraft
    // during a reversal without interpolating through the middle of the jet.
    const distance = this.chaseDistance;
    camera.position.copy(position).addScaledVector(this.forward, -distance)
      .addScaledVector(this.upTarget, distance * 0.17).addScaledVector(this.right, this.sideOffset);
    camera.position.y = Math.max(camera.position.y, this.world.heightAt(camera.position.x, camera.position.z) + 1.5);
    this.look.copy(position).addScaledVector(this.forward, distance * 0.76).addScaledVector(this.upTarget, distance * 0.06);
    camera.up.copy(this.upTarget);
    camera.lookAt(this.look);
    camera.updateMatrixWorld();
  }

}
