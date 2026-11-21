import { MathUtils, Vector3 } from 'three';
import { AIPilot } from './ai-pilot.js';
import { Ballistics } from './ballistics.js';
import { Cannon, cannonMount } from './cannon.js';
import { Flight, STEP } from './flight.js';

const spawns = {
  passive: { x: 0, y: 12.5, z: 360, speed: 186, heading: 0 },
  defensive: { x: -18, y: 4, z: 485, speed: 189, heading: 0 },
  aggressive: { x: 95, y: 10, z: 2140, speed: 200, heading: Math.PI - 0.055 },
};

class Hull {
  constructor(flight) {
    this.flight = flight;
    this.colliders = Object.entries(flight.damage.components).flatMap(([component, { volumes }]) =>
      volumes.map(([x, y, z, radius]) => ({
        shape: 'sphere', surface: 'metal', radius, active: false, hull: this, component,
        offset: new Vector3(x, y, z), previous: new Vector3(), position: new Vector3(),
      })));
  }

  reset(active) {
    this.activate(active);
    if (active) this.update();
  }

  activate(value) {
    for (const collider of this.colliders) collider.active = value;
  }

  update() {
    const { previousPosition, previousOrientation, position, orientation, damage } = this.flight;
    for (const collider of this.colliders) {
      if (!collider.active) continue;
      const part = collider.component;
      if ((part === 'leftWing' || part === 'leftFlaperon') && damage.health.leftWing === 0
        || (part === 'rightWing' || part === 'rightFlaperon') && damage.health.rightWing === 0
        || (part.endsWith('Flaperon') || part.endsWith('Stabilator')) && damage.condition(part) === 0) {
        collider.active = false;
        continue;
      }
      collider.previous.copy(collider.offset).applyQuaternion(previousOrientation).add(previousPosition);
      collider.position.copy(collider.offset).applyQuaternion(orientation).add(position);
    }
  }

  hit(component, amount) {
    const destroyed = this.flight.damage.hit(component, amount);
    if (destroyed) {
      this.flight.failure ||= this.flight.damage.failure;
      this.activate(false);
    }
    return destroyed;
  }

  get percentage() {
    return this.incapacitated ? 0 : Math.ceil(this.flight.damage.condition('fuselage') * 100);
  }

  get incapacitated() {
    return Boolean(this.flight.failure);
  }
}

export class Dogfight {
  constructor(player, spec, world, effects, sharedPlayerHull = null) {
    this.player = player;
    this.opponent = new Flight(spec, world);
    this.pilot = new AIPilot(world, spec);
    this.playerHull = sharedPlayerHull ?? new Hull(player);
    this.managesPlayerHull = !sharedPlayerHull;
    this.opponentHull = new Hull(this.opponent);
    this.playerTargets = [...world.structures, ...this.opponentHull.colliders];
    this.opponentTargets = [...world.structures, ...this.playerHull.colliders];
    this.ballistics = new Ballistics(spec.cannon, world, (kind, position, collider, impactSpeed) => {
      const destroyed = collider?.hull ? this.hit(collider, spec.cannon.damage, impactSpeed / spec.cannon.projectileSpeed) : false;
      effects.impact(kind, position, player.elapsed, destroyed, Boolean(collider?.hull));
    });
    this.cannon = new Cannon(spec.cannon, cannonMount(spec.cannon), this.ballistics, effects.shot);
  }

  reset(mode, start, opponentStart) {
    this.enabled = Boolean(mode);
    this.notice = '';
    this.noticeUntil = 0;
    this.ownNotice = false;
    this.result = '';
    this.cannon.reset();
    this.ballistics.clear();
    if (this.managesPlayerHull) this.playerHull.reset(this.enabled);
    this.opponentHull.reset(false);
    if (!this.enabled) return;
    const { x, y, z, speed, heading } = opponentStart ?? spawns[mode];
    const scenario = {
      ...start, x: start.x + x, y: start.y + y, z: start.z + z,
      heading, speed: speed * this.pilot.speedScale,
    };
    this.opponent.reset(scenario);
    this.opponentHull.reset(true);
    this.pilot.reset(mode, scenario);
  }

  update(adjust) {
    if (this.opponentHull.incapacitated) {
      if (this.managesPlayerHull) this.playerHull.update();
      if (this.player.failure) this.playerHull.activate(false);
      return;
    }
    const command = this.pilot.update(this.opponent, this.player, this.cannon.ammo > 0);
    if (this.pilot.burner !== this.opponent.burnerArmed) this.opponent.toggleAfterburner();
    this.opponent.step(adjust ? adjust(command) : command);
    if (this.managesPlayerHull) this.playerHull.update();
    this.opponentHull.update();
    if (this.player.failure) this.playerHull.activate(false);
    if (this.opponent.failure) this.opponentHull.activate(false);
  }

  fire(allowCannon = true) {
    if (!this.opponentHull.incapacitated) this.cannon.step(STEP, allowCannon && this.pilot.fire, this.opponent);
    if (this.ballistics.count) this.ballistics.step(STEP, this.opponentTargets);
  }

  hit(collider, damage, speedScale = 1) {
    const own = collider.hull === this.playerHull;
    const destroyed = collider.hull.hit(collider.component, damage * MathUtils.clamp(speedScale, 0.48, 1.25));
    if (!own) this.pilot.alert(this.opponent.elapsed);
    if (own || this.player.elapsed >= this.noticeUntil || !this.ownNotice) {
      const report = collider.hull.flight.damage.report;
      this.notice = own ? report : `OPPONENT · ${report}`;
      this.noticeUntil = this.player.elapsed + 0.9;
      this.ownNotice = own;
    }
    return destroyed;
  }

  finish() {
    const lost = this.playerHull.incapacitated;
    const won = this.opponentHull.incapacitated;
    this.result = lost && won ? 'draw' : lost ? 'loss' : won ? 'win' : '';
    return this.result;
  }
}
