import { Vector3 } from 'three';

const tumble = new Vector3(0.58, 0.23, 0.78).normalize();

export class AirframeEffects {
  constructor(flight, visual, world, effects, sound) {
    this.flight = flight;
    this.visual = visual;
    this.world = world;
    this.effects = effects;
    this.sound = sound;
    this.motion = new Vector3();
    this.point = new Vector3();
  }

  reset() {
    this.failed = false;
    this.falling = false;
    this.finished = false;
    this.grounded = this.flight.grounded;
    this.vertical = this.flight.velocity.y;
    this.age = 0;
  }

  step() {
    const { flight, visual, effects } = this;
    if (flight.failure) {
      if (this.failed) return;
      this.failed = true;
      this.falling = !flight.grounded;
      this.motion.copy(flight.velocity);
      visual.root.position.copy(flight.position);
      visual.root.quaternion.copy(flight.orientation);
      if (flight.failure === 'Structural failure' || flight.damage.condition('fuselage') === 0) {
        effects.emit('debris', flight.position, effects.budget > 100 ? 18 : 8);
        if (flight.damage.condition('fuel') < 0.45 && flight.damage.fire) {
          effects.emit('explosion', flight.position, 10);
          this.sound(flight.position);
        }
      }
      if (flight.grounded) this.crash(flight.position, flight.failure === 'Water impact',
        flight.failure === 'Runway excursion' ? 0.35 : 1);
    } else if (flight.grounded && !this.grounded && this.vertical < -4.5) {
      effects.emit('ground', flight.position, effects.budget > 100 ? 10 : 5);
    }
    this.grounded = flight.grounded;
    this.vertical = flight.velocity.y;
  }

  render(dt) {
    if (!this.failed) return false;
    const { root } = this.visual;
    root.visible = !this.finished;
    if (!this.falling) return true;
    this.age += dt;
    root.rotateOnAxis(tumble, dt * (0.33 + this.age * 0.19));
    this.motion.multiplyScalar(Math.exp(-0.16 * dt));
    this.motion.y -= dt * 13;
    root.position.addScaledVector(this.motion, dt);
    const { x, y, z } = root.position;
    const floor = this.world.heightAt(x, z);
    if (y <= floor + 0.8) this.crash(root.position, floor <= 0, 1);
    if (this.age > 28) {
      this.falling = false;
      this.finished = true;
    }
    return true;
  }

  crash(position, water, strength) {
    this.falling = false;
    this.finished = true;
    this.point.copy(position);
    const count = this.effects.budget > 100 ? 20 : 10;
    this.effects.emit(water ? 'water' : 'ground', this.point, Math.ceil(count * strength));
    if (strength >= 1) {
      this.effects.emit('debris', this.point, count);
      if (!water) this.effects.emit('explosion', this.point, count);
      this.sound(this.point);
    }
  }
}
