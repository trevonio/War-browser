import { Ballistics } from './ballistics.js';
import { Cannon } from './cannon.js';
import { CombatExercise } from './combat/exercise.js';
import { Dogfight } from './dogfight.js';
import { Flight } from './flight.js';
import { GunComputer } from './gun-computer.js';
import { AirframeEffects } from '../view/airframe-effects.js';
import { CannonEffects } from '../view/cannon-effects.js';
import { FlightTrails } from '../view/trails.js';

export function createSortie(scene, world, practice, player, opponents, events) {
  const { spec, visual } = player;
  const flight = new Flight(spec, world);
  visual.root.renderMovement = flight.position.clone();
  scene.add(visual.root);
  let playerHull;
  const enemies = opponents.map((entry, index) => {
    const fight = new Dogfight(flight, entry.spec, world, {
      shot: (position, direction, time, count) => weaponEffects.shot(index + 1, position, direction, time, count),
      impact(surface, point, time, destroyed, ownHit) {
        weaponEffects.impact(surface, point, time, destroyed);
        events.enemyImpact(surface, point, ownHit);
      },
    }, playerHull);
    playerHull = fight.playerHull;
    entry.visual.root.visible = false;
    scene.add(entry.visual.root);
    return { ...entry, fight };
  });
  const [primary, ...others] = enemies.map(({ fight }) => fight);
  const ballistics = new Ballistics(spec.cannon, world, (surface, point, collider, impactSpeed) => {
    let destroyed = false;
    if (collider?.hull) {
      combat.cannonHits++;
      events.playerHit(flight.elapsed);
      const scale = impactSpeed / spec.cannon.projectileSpeed;
      destroyed = combat.enabled ? combat.hit(collider, spec.cannon.damage, scale) : primary.hit(collider, spec.cannon.damage, scale);
    } else if (collider?.damageTarget) {
      destroyed = collider.damageTarget.hit(collider.component, spec.cannon.damage, { source: 'player', kind: 'cannon', point });
    } else if (collider && practice.targets.includes(collider)) {
      destroyed = practice.hit(collider, spec.cannon.damage, flight.elapsed);
    }
    weaponEffects.impact(surface, point, flight.elapsed, destroyed);
  });
  const weaponEffects = new CannonEffects(scene, [
    { muzzle: visual.muzzle, ballistics },
    ...enemies.map(({ visual, fight }) => ({ muzzle: visual.muzzle, ballistics: fight.ballistics })),
  ], practice);
  const cannon = new Cannon(spec.cannon, visual.muzzle, ballistics, (position, direction, time, count) => {
    events.playerShot();
    weaponEffects.shot(0, position, direction, time, count);
  });
  const combat = new CombatExercise(primary, world, {
    launch: events.launch,
    burst(point, hit, own) {
      weaponEffects.emit('explosion', point, weaponEffects.budget > 100 ? 18 : 10);
      weaponEffects.emit('debris', point, hit ? 10 : 4);
      events.burst(point, own);
    },
  }, null, others);
  const trails = new FlightTrails(scene, combat.missiles.pool, [flight, ...enemies.map(({ fight }) => fight.opponent)]);
  const playerAirframe = new AirframeEffects(flight, visual, world, weaponEffects, events.blast);
  for (const entry of enemies) {
    entry.airframe = new AirframeEffects(entry.fight.opponent, entry.visual, world, weaponEffects, events.blast);
  }
  const gunComputer = new GunComputer(spec.cannon, visual.muzzle, world);
  return {
    flight, visual, enemies, ballistics, weaponEffects, cannon, combat, trails, playerAirframe, gunComputer,
    dispose() {
      weaponEffects.dispose();
      trails.dispose();
      visual.root.removeFromParent();
      for (const enemy of enemies) enemy.visual.root.removeFromParent();
    },
  };
}
