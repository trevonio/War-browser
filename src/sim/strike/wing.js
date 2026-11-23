import { Vector3 } from 'three';
import { Hull } from '../dogfight.js';
import { Flight, neutralControls } from '../flight.js';
import { WeaponRack } from '../combat/weapons.js';
import { ThreatReceiver } from '../combat/warnings.js';
import { resolveLoadout } from '../loadouts.js';
import { applyGroundImpact, RangeOrdnance } from '../range-ordnance.js';
import { TargetingPod } from './pod.js';

export class StrikeWing {
  constructor(spec, world, battle, effects) {
    this.world = world;
    this.battle = battle;
    this.flight = new Flight(spec, world);
    this.hull = new Hull(this.flight);
    this.warning = new ThreatReceiver(this.flight);
    this.faction = 'friendly';
    this.rack = new WeaponRack(this.flight, { track: null }, world);
    this.pod = new TargetingPod(world);
    this.approach = new Vector3();
    this.aim = new Vector3();
    this.command = { ...neutralControls, aimDirection: this.aim };
    this.stores = new RangeOrdnance(world, (kind, point, collider, profile) => {
      effects.impact(point);
      applyGroundImpact(kind, point, collider, profile, battle.targets, 'support-aircraft');
    }, (kind, point) => effects.launch(point));
  }

  reset() {
    const { mission } = this.battle;
    const start = mission.start;
    this.flight.reset({ ...start, x: start.x + 122, z: start.z - 145, y: start.y + 130 });
    this.hull.reset(true);
    this.rack.reset(resolveLoadout(this.flight.spec, { center: 'pod', 'inboard-left': 'optical' }), 'optical');
    this.warning.reset();
    this.pod.reset();
    this.stores.clear();
    const { x, z } = mission.objective;
    this.approach.set(x, this.world.heightAt(x, z) + 1, z);
    this.next = this.nextChaff = 0;
    this.departing = false;
  }

  step(dt, defenses) {
    const { flight, battle, stores, pod, rack } = this;
    if (stores.active) stores.step(dt, rack, battle.queryPlayer);
    if (flight.failure) return;
    const time = flight.elapsed;
    const station = rack.station('pod');
    if (time >= this.next) {
      this.next = time + .18;
      this.warning.update(time, defenses.emitters, defenses.combat.missiles.pool);
      if (this.warning.state === 'ACTIVE SEEKER' && time >= this.nextChaff) {
        this.nextChaff = time + 5;
        defenses.combat.decoys.release(flight, 'chaff');
        this.departing = true;
      }
      const distance = flight.position.distanceTo(this.approach);
      this.departing ||= distance < 520 || stores.precisionReleased > 0;
      if (this.departing) this.aim.set(.46, .17, .88);
      else {
        this.aim.subVectors(this.approach, flight.position);
        this.aim.y *= .34;
        this.aim.normalize();
        pod.sync(flight, station);
        if (pod.mounted) {
          pod.direction.subVectors(this.approach, pod.origin).normalize();
          const target = pod.observe(battle.targets);
          if (target?.faction === 'opposing') {
            pod.track = target;
            pod.area.copy(target.position).y += target.spec.dimensions[1] * .72;
            pod.hasArea = true;
            pod.state = 'POINT TRACK';
            if (stores.releaseGuided(rack, 'optical', pod) === 'PRECISION STORE AWAY') {
              battle.director.radio(battle.time, 'Wing', 'Support aircraft launched on a visually confirmed contact.');
            }
          }
        }
      }
    }
    flight.step(this.command);
    this.hull.update();
  }
}
