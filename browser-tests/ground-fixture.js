import * as T from 'three';
import { createF16Visual } from '../src/aircraft/f16-visual.js';
import { f16 } from '../src/aircraft/f16.js';
import { WeaponRack } from '../src/sim/combat/weapons.js';
import { Flight, STEP, neutralControls } from '../src/sim/flight.js';
import { GroundRange } from '../src/sim/ground-range.js';
import { availablePresets, resolveLoadout } from '../src/sim/loadouts.js';
import { PracticeRange } from '../src/sim/practice.js';
import { applyGroundImpact, RangeOrdnance } from '../src/sim/range-ordnance.js';
import { range, scenarios } from '../src/sim/range.js';
import { FlightCamera } from '../src/view/camera.js';
import { CannonEffects } from '../src/view/cannon-effects.js';
import { AttachedStores, GroundRangeView, ReleasedStores, StoreModels } from '../src/view/loadout-visual.js';
import { disposeObjects } from '../src/view/resources.js';
import { WorldView } from '../src/view/world.js';

export async function measureGroundStores(renderer) {
  const scene = new T.Scene();
  const world = new WorldView(scene, renderer);
  const visual = createF16Visual();
  const flight = new Flight(f16, range);
  const aircraft = visual.root;
  scene.add(aircraft);
  const camera = new FlightCamera(range);
  camera.camera.aspect = 800 / 450;
  camera.camera.updateProjectionMatrix();
  const effects = new CannonEffects(scene, [], new PracticeRange());
  effects.resize(renderer, camera.camera);
  const models = new StoreModels();
  const mounted = new AttachedStores(visual, models);
  const ground = new GroundRange(range);
  const groundView = new GroundRangeView(scene, ground.targets);
  const targets = [...range.structures, ...ground.targets];
  const presets = availablePresets(f16);
  const rack = new WeaponRack(flight, {}, range);
  const point = new T.Vector3();
  let peak = {};
  const ordnance = new RangeOrdnance(range, (kind, point, collider, profile) => {
    peak.impacts++;
    effects.emit('explosion', point, 16);
    effects.emit('debris', point, 9);
    applyGroundImpact(kind, point, collider, profile, ground.targets);
  }, (kind, point) => {
    if (kind === 'rocket') effects.emit('rocketFlash', point, 3);
  });
  const released = new ReleasedStores(scene, models, ordnance);
  const command = { ...neutralControls, aimDirection: new T.Vector3(0, 0, 1) };
  const report = {};

  function mount(assignment) {
    rack.reset(resolveLoadout(f16, assignment));
    mounted.reset(rack.stations);
  }

  function draw(seconds) {
    aircraft.position.copy(flight.position);
    aircraft.quaternion.copy(flight.orientation);
    visual.update(flight, flight.elapsed);
    mounted.update(flight);
    camera.update(aircraft, flight.velocity, seconds, 'flying', false, 1);
    world.update(flight.position, camera.camera);
    groundView.update(camera.camera);
    released.update(1);
    effects.render(flight.elapsed, seconds, 1, true);
    renderer.render(scene, camera.camera);
  }

  for (const mode of ['clean', 'loaded', 'bombRelease', 'rocketSalvo', 'explosions', 'groundRange']) {
    flight.reset({ ...scenarios.groundRange, y: 570, pitch: mode === 'rocketSalvo' ? -0.16 : 0.04 });
    ground.reset(mode !== 'clean' && mode !== 'loaded');
    effects.clear();
    ordnance.clear();
    peak = { impacts: 0, active: 0, particles: 0, draws: 0 };
    mount(mode === 'clean' ? {} : mode === 'loaded' ? presets['Mixed Multirole'] : presets['Ground Attack']);
    camera.snap = true;
    draw(0);
    let last = await new Promise(requestAnimationFrame);
    const warm = last;
    while (last - warm < 320) {
      last = await new Promise(requestAnimationFrame);
      draw(0);
    }
    if (mode === 'bombRelease') ordnance.release(rack, 'bomb', 'pair');
    if (mode === 'rocketSalvo') ordnance.release(rack, 'rocket', 'burst');
    if (mode === 'explosions') {
      const station = rack.station('bomb');
      const { position, velocity } = flight;
      const start = position.clone();
      const motion = velocity.clone();
      for (const target of ground.targets.slice(0, 3)) {
        position.copy(target.position).add(new T.Vector3(-station.offset[0], 15, -station.offset[2]));
        velocity.set(0, -17, 0);
        ordnance.spawn('bomb', flight, station);
      }
      position.copy(start);
      velocity.copy(motion);
    }
    let remaining = 0;
    let nextSight = 0;
    const started = last;
    const duration = [];
    do {
      const now = await new Promise(requestAnimationFrame);
      const dt = Math.min((now - last) / 1000, 0.35);
      duration.push(now - last);
      last = now;
      remaining += dt;
      while (remaining >= STEP) {
        flight.step(command);
        ground.time = flight.elapsed;
        if (ordnance.active) ordnance.step(STEP, rack, targets);
        remaining -= STEP;
      }
      if (mode === 'groundRange' && flight.elapsed >= nextSight) {
        ordnance.predict('bomb', flight, rack.station('bomb'), targets, point);
        nextSight = flight.elapsed + 0.15;
      }
      if (mode === 'rocketSalvo') for (const rocket of ordnance.rounds) {
        if (rocket.active && rocket.kind === 'rocket' && rocket.age < 1) effects.emit('rocketSmoke', rocket.position, 2);
      }
      draw(dt);
      peak.draws = Math.max(peak.draws, renderer.info.render.calls);
      peak.active = Math.max(peak.active, ordnance.rounds.filter((item) => item.active).length);
      peak.particles = Math.max(peak.particles, effects.particleCount);
    } while (last - started < 1700);
    duration.sort((a, b) => a - b);
    report[mode] = {
      fps: Number((duration.length * 1000 / (last - started)).toFixed(1)),
      p95ms: Number(duration[Math.floor((duration.length - 1) * .95)].toFixed(1)),
      ...peak,
    };
  }

  const changes = [];
  for (const preset of ['Mixed Multirole', 'Ground Attack']) {
    mount(presets[preset]);
    draw(0);
  }
  const started = performance.now();
  for (let flip = 0; flip < 12; flip++) {
    mount(presets[flip % 2 ? 'Ground Attack' : 'Mixed Multirole']);
    draw(0);
    changes.push([renderer.info.memory.geometries, renderer.info.memory.textures]);
  }
  const changeMs = Math.round(performance.now() - started);
  mounted.dispose();
  released.dispose();
  groundView.dispose();
  effects.dispose();
  models.dispose();
  disposeObjects(aircraft);
  return { report, changes, changeMs };
}
