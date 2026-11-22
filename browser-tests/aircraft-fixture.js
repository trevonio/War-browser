import * as T from 'three';
import { aircraftRegistry } from '../src/aircraft/registry.js';
import { PracticeRange } from '../src/sim/practice.js';
import { range, scenarios } from '../src/sim/range.js';
import { createSortie } from '../src/sim/sortie.js';
import { STEP, neutralControls } from '../src/sim/flight.js';
import { AircraftHangar } from '../src/view/aircraft-hangar.js';
import { FlightCamera } from '../src/view/camera.js';
import { CombatEffects } from '../src/view/combat-view.js';
import { WorldView } from '../src/view/world.js';

const silent = { playerShot() {}, playerHit() {}, enemyImpact() {}, launch() {}, burst() {}, blast() {} };

export async function measureFleet(renderer) {
  const scene = new T.Scene();
  const world = new WorldView(scene, renderer);
  const hangar = new AircraftHangar();
  const practice = new PracticeRange();
  const camera = new FlightCamera(range);
  const start = { ...scenarios.intercept, y: 4500 };
  const report = {};
  const assets = {};
  const load = {};
  for (const id of Object.keys(aircraftRegistry)) {
    const started = performance.now();
    assets[id] = await hangar.load(id);
    load[id] = Math.round((performance.now() - started) * 10) / 10;
  }
  const instantiate = (id, hostile) => ({ spec: aircraftRegistry[id].spec, visual: hangar.instantiate(assets[id], hostile) });
  const fleet = (id, foes) => createSortie(scene, range, practice, instantiate(id), foes.map((foe) => instantiate(foe, true)), silent);
  renderer.setSize(1920, 1080);
  camera.camera.aspect = 1920 / 1080;
  camera.camera.updateProjectionMatrix();

  function pose(entry, flight) {
    const model = entry.visual;
    model.root.position.copy(flight.position);
    model.root.quaternion.copy(flight.orientation);
    if (model.setDistant) model.setDistant(flight.position.distanceToSquared(camera.camera.position) > 1150 ** 2);
    model.update(flight, flight.elapsed);
  }

  for (const [name, pilot, foes] of [
    ['falcon', 'f16c', []], ['eagle', 'f15c', []], ['mixed', 'f16c', ['f15c']],
    ['four', 'f15c', ['f16c', 'f15c', 'f16c', 'f15c']],
    ['missiles', 'f15c', ['f16c', 'f15c']],
  ]) {
    const sortie = fleet(pilot, foes.length ? foes : ['f16c']);
    const { flight, combat, weaponEffects, trails } = sortie;
    flight.reset(start);
    const missileMode = name === 'missiles';
    let launches = 0;
    let mostActive = 0;
    const ordnance = missileMode ? new CombatEffects(scene, sortie.visual, sortie.enemies[0].visual, combat,
      weaponEffects, sortie.enemies.slice(1).map((entry) => entry.visual)) : null;
    for (const [index, { fight, visual }] of sortie.enemies.entries()) {
      const x = [-420, 660, -920, 1200][index];
      const z = (missileMode ? 4250 : 960) + index * 180;
      fight.reset(foes.length ? 'aggressive' : null, start, { x, y: index * 26, z, speed: 195, heading: Math.PI - Math.atan2(x, z) });
      visual.root.visible = Boolean(foes.length);
    }
    combat.reset(missileMode ? 'outnumbered' : null, 'veteran', foes.length || 1);
    ordnance?.reset();
    if (missileMode) combat.player.radar.togglePower();

    const step = () => {
      flight.step(neutralControls);
      if (!foes.length) return;
      for (const side of combat.enemies) side.fight.update(missileMode ? side.adjust : null);
      if (!missileMode) return;
      combat.step(STEP);
      const { radar } = combat.player;
      if (!radar.locked && radar.contacts.size) {
        radar.selectNext();
        radar.toggleLock();
      }
      if (combat.player.rack.seeker.radar.ready && launches < 1 && combat.launch(combat.player, null, 'radar')) launches++;
      mostActive = Math.max(mostActive, combat.missiles.pool.filter((item) => item.active).length);
      trails.step(flight.elapsed, [true, true]);
      ordnance.step(flight.elapsed);
    };
    for (let i = 0; i < (missileMode ? 280 : 24); i++) step();

    const render = (dt) => {
      pose(sortie, flight);
      camera.update(sortie.visual.root, flight.velocity, dt, 'flying', false, 1);
      world.update(flight.position, camera.camera);
      for (const { fight, visual } of sortie.enemies) if (visual.root.visible) pose({ visual }, fight.opponent);
      ordnance?.render(1);
      trails.render(flight.elapsed, camera.camera);
      weaponEffects.render(flight.elapsed, dt, 1, true);
      renderer.render(scene, camera.camera);
    };
    camera.snap = true;
    render(1 / 60);
    const frames = [];
    let previous = await new Promise(requestAnimationFrame);
    const begin = previous;
    do {
      const now = await new Promise(requestAnimationFrame);
      const dt = (now - previous) / 1000;
      previous = now;
      for (let tick = 0; tick < Math.min(32, Math.round(dt / STEP)); tick++) step();
      render(dt);
      frames.push(dt * 1000);
    } while (previous - begin < 1450);
    frames.sort((a, b) => a - b);
    report[name] = {
      fps: Number((frames.length * 1000 / (previous - begin)).toFixed(1)),
      p95ms: Number(frames[Math.floor((frames.length - 1) * 0.95)].toFixed(1)),
      draws: renderer.info.render.calls,
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
      launches, mostActive,
    };
    ordnance?.dispose();
    sortie.dispose();
  }
  const switches = [];
  for (let index = 0; index < 12; index++) {
    const sortie = fleet(index % 2 ? 'f15c' : 'f16c', ['f16c']);
    sortie.flight.reset(start);
    pose(sortie, sortie.flight);
    renderer.render(scene, camera.camera);
    sortie.dispose();
    switches.push([renderer.info.memory.geometries, renderer.info.memory.textures]);
  }
  await hangar.dispose();
  renderer.setSize(800, 450);
  return { resolution: '1920×1080', loadMs: load, scenarios: report, resourcesAfterSwitch: switches,
    heapMiB: performance.memory ? Number((performance.memory.usedJSHeapSize / 1048576).toFixed(1)) : null };
}
