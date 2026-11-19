import { Vector3 } from 'three';
import { AIPilot } from './ai-pilot.js';
import { Ballistics } from './ballistics.js';
import { Cannon, cannonMount } from './cannon.js';
import { Flight, STEP } from './flight.js';

const integrity = 36;
const spawns = {
  passive: { x: 0, y: 12.5, z: 360, speed: 186, heading: 0 },
  defensive: { x: -18, y: 4, z: 485, speed: 189, heading: 0 },
  aggressive: { x: 95, y: 10, z: 2140, speed: 200, heading: Math.PI - 0.055 },
};

class Hull {
  constructor(flight) {
    this.flight = flight;
    this.colliders = flight.spec.hitVolumes.map(([x, y, z, radius]) => ({
      shape: 'sphere', surface: 'metal', radius, active: false, hull: this,
      offset: new Vector3(x, y, z), previous: new Vector3(), position: new Vector3(),
    }));
  }

  reset(active) {
    this.integrity = integrity;
    this.activate(active);
    if (active) this.update();
  }

  activate(value) {
    for (const collider of this.colliders) collider.active = value;
  }

  update() {
    const { previousPosition, previousOrientation, position, orientation } = this.flight;
    for (const collider of this.colliders) {
      collider.previous.copy(collider.offset).applyQuaternion(previousOrientation).add(previousPosition);
      collider.position.copy(collider.offset).applyQuaternion(orientation).add(position);
    }
  }

  hit(damage) {
    this.integrity = Math.max(0, this.integrity - damage);
    if (this.integrity > 0) return false;
    this.activate(false);
    return true;
  }

  get percentage() {
    return Math.ceil(this.integrity / integrity * 100);
  }

  get incapacitated() {
    return this.integrity === 0 || Boolean(this.flight.failure);
  }
}

export class Dogfight {
  constructor(player, spec, world, effects) {
    this.player = player;
    this.opponent = new Flight(spec, world);
    this.pilot = new AIPilot(world, spec);
    this.playerHull = new Hull(player);
    this.opponentHull = new Hull(this.opponent);
    this.playerTargets = [...world.structures, ...this.opponentHull.colliders];
    this.opponentTargets = [...world.structures, ...this.playerHull.colliders];
    this.ballistics = new Ballistics(spec.cannon, world, (kind, position, collider) => {
      const destroyed = collider?.hull ? this.hit(collider, spec.cannon.damage) : false;
      effects.impact(kind, position, player.elapsed, destroyed);
    });
    this.cannon = new Cannon(spec.cannon, cannonMount(spec.cannon), this.ballistics, effects.shot);
  }

  reset(mode, start) {
    this.enabled = Boolean(mode);
    this.notice = '';
    this.noticeUntil = 0;
    this.result = '';
    this.cannon.reset();
    this.ballistics.clear();
    this.playerHull.reset(this.enabled);
    this.opponentHull.reset(false);
    if (!this.enabled) return;
    const { x, y, z, speed, heading } = spawns[mode];
    const scenario = {
      ...start, x: start.x + x, y: start.y + y, z: start.z + z,
      heading, speed: speed * this.pilot.speedScale,
    };
    this.opponent.reset(scenario);
    this.opponentHull.reset(true);
    this.pilot.reset(mode, scenario);
  }

  update() {
    const command = this.pilot.update(this.opponent, this.player);
    if (this.pilot.burner !== this.opponent.burnerArmed) this.opponent.toggleAfterburner();
    this.opponent.step(command);
    this.playerHull.update();
    this.opponentHull.update();
    if (this.player.failure) this.playerHull.activate(false);
    if (this.opponent.failure) this.opponentHull.activate(false);
  }

  fire() {
    if (!this.opponentHull.incapacitated) this.cannon.step(STEP, this.pilot.fire, this.opponent);
    if (this.ballistics.count) this.ballistics.step(STEP, this.opponentTargets);
  }

  hit(collider, damage) {
    const own = collider.hull === this.playerHull;
    if (!own) this.pilot.alert(this.opponent.elapsed);
    if (own || this.player.elapsed >= this.noticeUntil || this.notice !== 'AIRFRAME HIT') {
      this.notice = own ? 'AIRFRAME HIT' : 'OPPONENT HIT';
      this.noticeUntil = this.player.elapsed + 0.9;
    }
    return collider.hull.hit(damage);
  }

  finish() {
    const lost = this.playerHull.incapacitated;
    const won = this.opponentHull.incapacitated;
    this.result = lost && won ? 'draw' : lost ? 'loss' : won ? 'win' : '';
    return this.result;
  }
}
