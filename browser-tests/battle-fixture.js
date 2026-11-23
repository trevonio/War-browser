import * as T from 'three';
import { createF16Visual, createOpponentVisual } from '../src/aircraft/f16-visual.js';
import { f16 } from '../src/aircraft/f16.js';
import { CasDirector } from '../src/sim/cas/director.js';
import { createCasScenario } from '../src/sim/cas/scenarios.js';
import { GroundBattle } from '../src/sim/ground/battlefield.js';
import { Flight, STEP, neutralControls } from '../src/sim/flight.js';
import { PracticeRange } from '../src/sim/practice.js';
import { RangeOrdnance, applyGroundImpact } from '../src/sim/range-ordnance.js';
import { range, scenarios } from '../src/sim/range.js';
import { BattlefieldView } from '../src/view/battlefield-view.js';
import { CannonEffects } from '../src/view/cannon-effects.js';
import { ReleasedStores, StoreModels } from '../src/view/loadout-visual.js';
import { disposeObjects } from '../src/view/resources.js';
import { WorldView } from '../src/view/world.js';

const modes = [
  ['empty', 0, 2, 1], ['five', 5, 2, 1], ['ten', 10, 2, 1], ['twenty', 20, 2, 1],
  ['firing', 20, 28, 1], ['explosions', 20, 28, 1], ['airSupport', 20, 28, 1], ['mixedAircraft', 20, 28, 4],
];
const casModes = [
  ['normal', 12, 3, 1], ['ten', 10, 15, 1], ['twenty', 20, 16, 1], ['firing', 20, 26, 1],
  ['airSupport', 18, 23, 1], ['reinforcements', 14, 0, 1], ['completion', 12, 0, 1],
];
const stations = { offset: [0, 0, 0], release: [0, 0, 0], rotation: [0, 0, 0] };

export async function measureBattle(renderer, cas = false) {
  const scene = new T.Scene();
  const world = new WorldView(scene, renderer);
  const camera = new T.PerspectiveCamera(51, 800 / 450, .3, 90000);
  camera.position.set(-57, 330, -2550);
  camera.lookAt(-228, 50, -1600);
  camera.updateMatrixWorld();
  const effects = new CannonEffects(scene, [], new PracticeRange());
  effects.resize(renderer, camera);

  let peak;
  let emit = false;
  const battle = new GroundBattle(range, {
    shot(point, unit) { if (emit) effects.emit('rocketFlash', point, 2, unit.direction); },
    impact(point, collider) { if (emit) effects.emit(collider?.surface ?? 'ground', point, 3); },
    destroyed(unit) {
      if (!emit) return;
      effects.emit('explosion', unit.position, 15);
      effects.emit('debris', unit.position, 8);
    },
  });
  const battlefield = new BattlefieldView(scene, battle, range);
  const aircraft = [];
  for (let i = 0; i < 4; i++) {
    const visual = i ? createOpponentVisual(aircraft[0].visual) : createF16Visual();
    const flight = new Flight(f16, range);
    scene.add(visual.root);
    aircraft.push({ visual, flight });
  }
  const releaseFlight = new Flight(f16, range);
  const rack = { flight: releaseFlight };
  const stores = new StoreModels();
  const ordnance = new RangeOrdnance(range, (kind, point, collider, profile) => {
    peak[kind + 'Impacts']++;
    effects.emit('explosion', point, kind === 'bomb' ? 16 : 8);
    effects.emit('debris', point, 7);
    applyGroundImpact(kind, point, collider, profile, battle.targets);
  }, (kind, point) => {
    if (kind === 'rocket') effects.emit('rocketFlash', point, 3);
  });
  const released = new ReleasedStores(scene, stores, ordnance);

  function step(positions) {
    for (const { flight } of positions) flight.step(neutralControls);
    battle.step(STEP, camera.position);
    if (ordnance.active) ordnance.step(STEP, rack, battle.queryPlayer);
    let airProjectiles = 0;
    for (const round of ordnance.rounds) if (round.active) airProjectiles++;
    peak.projectiles = Math.max(peak.projectiles, battle.weapons.count + airProjectiles);
  }

  function draw(positions, dt) {
    for (const { visual, flight } of positions) {
      visual.root.position.copy(flight.position);
      visual.root.quaternion.copy(flight.orientation);
      visual.update(flight, flight.elapsed);
    }
    world.update(camera.position, camera);
    battlefield.update(camera, 1, null, false);
    released.update(1);
    effects.render(battle.time, dt, 1, true);
    renderer.render(scene, camera);
  }

  function release(kind, target) {
    releaseFlight.reset(scenarios.battlefield);
    releaseFlight.orientation.identity();
    releaseFlight.position.copy(target.position);
    if (kind === 'bomb') {
      releaseFlight.position.y += 18;
      releaseFlight.velocity.set(target.drive.x, -28, target.drive.z);
    } else {
      releaseFlight.position.y += 8;
      releaseFlight.position.z -= 43;
      releaseFlight.velocity.set(0, -17, target.drive.z);
    }
    ordnance.spawn(kind, releaseFlight, stations);
  }

  const report = {};
  for (const [mode, count, warmSeconds, planes] of cas ? casModes : modes) {
    let director = null;
    let warm = warmSeconds;
    if (cas) {
      const plan = createCasScenario('breakthrough', 123457, 'regular', battle.roads);
      const base = plan.definitions;
      if (count !== base.length) {
        const friendly = base.filter((unit) => unit.faction === 'friendly');
        const hostile = base.filter((unit) => unit.faction === 'opposing');
        const groups = [friendly, hostile];
        const targets = Array.from({ length: count }, (_, index) => {
          const group = groups[index % groups.length];
          const entry = Math.floor(index / groups.length);
          const original = group[entry % group.length];
          const step = Math.floor(entry / group.length);
          return { ...original, id: `${original.id}-${index}`, z: original.z + (index % 2 ? 1 : -1) * step * 75 };
        });
        plan.definitions = targets;
      }
      if (mode === 'reinforcements') warm = plan.reliefAt - 1;
      if (mode === 'completion') {
        plan.timeLimit = 24;
        warm = plan.timeLimit - 1;
      }
      director = new CasDirector(plan);
    }
    battle.reset(cas ? 'cas' : 'battlefield', 'regular', cas ? undefined : count, director?.plan.seed ?? 87351, director);
    effects.clear();
    ordnance.clear();
    peak = { ai: 0, projectiles: 0, draws: 0, particles: 0, bombImpacts: 0, rocketImpacts: 0 };
    const positions = aircraft.slice(0, planes);
    for (const [index, { visual, flight }] of aircraft.entries()) {
      visual.root.visible = index < planes;
      flight.reset({ ...scenarios.battlefield, x: -235 + index * 67, y: 140 + index * 14, z: -1950 - index * 45 });
    }
    emit = false;
    while (battle.time < warm && !battle.outcome) battle.step(STEP, camera.position);
    emit = true;
    draw(positions, 0);
    let previous = await new Promise(requestAnimationFrame);
    const warmup = previous;
    while (previous - warmup < 240) {
      previous = await new Promise(requestAnimationFrame);
      draw(positions, 0);
    }

    const targeted = battle.targets.filter(({ active, faction }) => active && faction === 'opposing');
    if (mode === 'explosions') for (const target of targeted.slice(0, 4)) release('bomb', target);
    if (mode === 'airSupport') {
      for (const target of targeted.slice(0, 2)) release('bomb', target);
      for (const target of targeted.slice(2, 7)) release('rocket', target);
    }
    const samples = [];
    const tickTimes = [];
    const started = previous;
    const startShots = battle.weapons.shots;
    let carry = 0;
    do {
      const now = await new Promise(requestAnimationFrame);
      const frame = now - previous;
      const dt = Math.min(frame / 1000, .35);
      previous = now;
      samples.push(frame);
      carry += dt;
      const beforeSim = performance.now();
      while (carry >= STEP) {
        step(positions);
        carry -= STEP;
      }
      tickTimes.push(performance.now() - beforeSim);
      peak.ai = Math.max(peak.ai, battle.targets.filter(({ active }) => active).length);
      draw(positions, dt);
      peak.draws = Math.max(peak.draws, renderer.info.render.calls);
      peak.particles = Math.max(peak.particles, effects.particleCount);
    } while (previous - started < 2200);
    samples.sort((a, b) => a - b);
    tickTimes.sort((a, b) => a - b);
    report[mode] = {
      fps: +(samples.length * 1000 / (previous - started)).toFixed(1),
      p95ms: +samples[Math.floor((samples.length - 1) * .95)].toFixed(1),
      simBatchP95ms: +tickTimes[Math.floor((tickTimes.length - 1) * .95)].toFixed(1),
      ...peak,
      groundShots: battle.weapons.shots - startShots,
      aircraft: planes,
      ...(director ? { calls: director.requests.length, relief: director.reinforcement, outcome: battle.outcome } : {}),
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
      heapMiB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
    };
  }
  released.dispose();
  stores.dispose();
  effects.dispose();
  battlefield.dispose();
  disposeObjects(...aircraft.map(({ visual }) => visual.root), scene);
  return report;
}
