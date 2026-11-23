import * as T from 'three';
import { f16 } from '../src/aircraft/f16.js';
import { createF16Visual, createOpponentVisual } from '../src/aircraft/f16-visual.js';
import { Ballistics } from '../src/sim/ballistics.js';
import { Cannon, worldMuzzle } from '../src/sim/cannon.js';
import { CombatExercise } from '../src/sim/combat/exercise.js';
import { Dogfight } from '../src/sim/dogfight.js';
import { Flight, neutralControls, STEP } from '../src/sim/flight.js';
import { GunComputer } from '../src/sim/gun-computer.js';
import { PracticeRange } from '../src/sim/practice.js';
import { range, scenarios } from '../src/sim/range.js';
import { FlightCamera } from '../src/view/camera.js';
import { CombatCamera } from '../src/view/combat-camera.js';
import { FlightTrails } from '../src/view/trails.js';
import { CannonEffects } from '../src/view/cannon-effects.js';
import { CombatEffects, drawRadar } from '../src/view/combat-view.js';
import { WorldView } from '../src/view/world.js';
import { measureBattle } from './battle-fixture.js';
import { measureFleet } from './aircraft-fixture.js';
import { measureGroundStores } from './ground-fixture.js';

const renderer = new T.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.toneMapping = T.ACESFilmicToneMapping;
renderer.setSize(800, 450);
document.body.append(renderer.domElement);
const scene = new T.Scene();
const world = new WorldView(scene, renderer);
const camera = new FlightCamera(range);
camera.camera.aspect = 800 / 450;
camera.camera.updateProjectionMatrix();
const player = new Flight(f16, range);
const model = createF16Visual();
model.root.renderMovement = new T.Vector3();
const playerRounds = new Ballistics(f16.cannon, range, () => {});
const opponents = Array.from({ length: 3 }, (_, index) => {
  const visual = createOpponentVisual(model);
  const fight = new Dogfight(player, f16, range, {
    shot: (position, direction, time, count) => effects.shot(index + 1, position, direction, time, count),
    impact: (kind, point, time, destroyed) => effects.impact(kind, point, time, destroyed),
  });
  return { visual, fight };
});
const effects = new CannonEffects(scene, [
  { muzzle: model.muzzle, ballistics: playerRounds },
  ...opponents.map(({ visual, fight }) => ({ muzzle: visual.muzzle, ballistics: fight.ballistics })),
], new PracticeRange());
effects.resize(renderer, camera.camera);
const cannon = new Cannon(f16.cannon, model.muzzle, playerRounds,
  (position, direction, time, count) => effects.shot(0, position, direction, time, count));
scene.add(model.root, ...opponents.map(({ visual }) => visual.root));

function step(flight, command, ticks) {
  for (let i = 0; i < ticks; i++) flight.step(command);
}

function angle(visual, name) {
  const node = visual.root.getObjectByName(name);
  const axis = new T.Vector3().fromArray(node.userData.hinge);
  const rotation = node.quaternion;
  return T.MathUtils.radToDeg(2 * Math.atan2(axis.x * rotation.x + axis.y * rotation.y + axis.z * rotation.z, rotation.w));
}

function checkRig() {
  player.reset(scenarios.runway);
  model.update(player, 0);
  const gearDeployed = model.root.getObjectByName('NoseGear').visible;
  const groundedFlap = angle(model, 'LeftFlaperon');
  player.reset(scenarios.dogfight);
  const command = { ...neutralControls, pitch: 1, roll: 1, brakes: true };
  step(player, command, 20);
  player.afterburner = true;
  model.update(player, 0.2);
  const pitch = angle(model, 'LeftStabilator') + angle(model, 'RightStabilator');
  const differential = angle(model, 'LeftFlaperon') - angle(model, 'RightFlaperon');
  const flaperon = angle(model, 'LeftFlaperon');
  const burner = model.ab.visible;
  const brake = angle(model, 'LeftAirbrake');
  const gearFolded = !model.root.getObjectByName('NoseGear').visible;
  player.damage.hit('leftFlaperon', 8);
  step(player, { ...command, roll: -1 }, 22);
  model.update(player, 0.4);
  const jammedFlap = angle(model, 'LeftFlaperon');
  player.damage.hit('leftWing', 22);
  player.stores = false;
  model.update(player, 0.4);
  const separated = !model.root.getObjectByName('LeftWing').visible && model.root.getObjectByName('RightWing').visible;
  const storesOff = !model.arm.visible;

  player.reset(scenarios.dogfight);
  const { visual, fight } = opponents[0];
  fight.reset('defensive', scenarios.dogfight);
  let ai = 0;
  for (let i = 0; i < 118; i++) {
    player.step(neutralControls);
    fight.update();
    if (i % 12 === 11) {
      visual.update(fight.opponent, fight.opponent.elapsed);
      ai = Math.max(ai, Math.abs(angle(visual, 'LeftFlaperon') - angle(visual, 'RightFlaperon')));
    }
  }
  const meshName = 'LeftFlaperon';
  const sharedGeometry = visual.root.getObjectByName(meshName).children[0].geometry
    === model.root.getObjectByName(meshName).children[0].geometry;
  return { groundedFlap, gearDeployed, gearFolded, pitch, differential, brake, burner, flaperon, jammedFlap,
    separated, storesOff, ai, sharedGeometry, muzzle: model.muzzle.position.toArray() };
}

function pose(visual, flight, time) {
  visual.root.renderMovement?.subVectors(flight.position, visual.root.position);
  visual.root.position.copy(flight.position);
  visual.root.quaternion.copy(flight.orientation);
  visual.update(flight, time);
}

function checkImpact() {
  player.reset({ ...scenarios.dogfight, y: 395, pitch: -0.65 });
  player.orientation.multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1), 0.78));
  const computer = new GunComputer(f16.cannon, model.muzzle, range);
  if (!computer.impact(player)) return Infinity;
  const origin = new T.Vector3();
  const bore = new T.Vector3();
  worldMuzzle(model.muzzle, player.orientation, player.position, origin, bore);
  let distance = Infinity;
  const rounds = new Ballistics(f16.cannon, range, (_surface, point) => {
    distance = point.distanceTo(computer.point);
  });
  rounds.spawn(origin, bore.multiplyScalar(f16.cannon.projectileSpeed).add(player.velocity), false, 0);
  while (rounds.count) rounds.step(STEP, range.structures);
  return distance;
}

async function measure(mode) {
  const start = scenarios.dogfight;
  player.reset(start);
  playerRounds.clear();
  cannon.reset();
  effects.clear();
  camera.snap = true;
  const active = mode === 'multi' ? opponents : mode === 'combat' || mode === 'damaged' ? opponents.slice(0, 1) : [];
  for (const [index, entry] of opponents.entries()) {
    entry.visual.root.visible = active.includes(entry);
    if (!entry.visual.root.visible) {
      entry.fight.reset(null, start);
      continue;
    }
    entry.fight.reset('defensive', start);
    const spawn = { ...start, x: start.x + (index - 1) * 28, y: start.y + 8, z: start.z + 190 + index * 24, heading: 0 };
    entry.fight.opponent.reset(spawn);
    if (mode === 'damaged') {
      entry.fight.opponent.damage.hit('engine', 15);
      entry.fight.opponent.damage.hit('fuel', 8);
    }
  }
  const firing = mode !== 'idle';
  let last = performance.now();
  let accumulator = 0;
  let nextTrail = 0;
  const render = (now) => {
    const dt = Math.min(0.3, (now - last) / 1000);
    last = now;
    accumulator += dt;
    while (accumulator >= STEP) {
      accumulator -= STEP;
      player.step(neutralControls);
      for (const { fight } of active) {
        fight.update();
        fight.fire();
      }
      cannon.step(STEP, firing, player);
      playerRounds.step(STEP, range.structures);
      if (mode === 'damaged' && player.elapsed >= nextTrail) {
        nextTrail = player.elapsed + 0.075;
        effects.damageTrail(active[0].fight.opponent);
      }
    }
    pose(model, player, now / 1000);
    for (const { visual, fight } of active) pose(visual, fight.opponent, now / 1000);
    camera.update(model.root, player.velocity, dt, 'flying', false, 1);
    world.update(player.position, camera.camera);
    effects.render(player.elapsed, dt, 1, true);
    renderer.render(scene, camera.camera);
  };
  render(last);
  const fps = await sampleFrames(render);
  return { fps, drawCalls: renderer.info.render.calls, particles: effects.particleCount, rounds: cannon.fired };
}

async function sampleFrames(render) {
  const warmup = performance.now();
  let now = warmup;
  while (now - warmup < 450) {
    now = await new Promise(requestAnimationFrame);
    render(now);
  }
  const started = now;
  let frames = 0;
  while (now - started < 1450) {
    now = await new Promise(requestAnimationFrame);
    render(now);
    frames++;
  }
  return Number((frames * 1000 / (now - started)).toFixed(1));
}

let combat;
let ordnance;
let trails;
const combatCamera = new CombatCamera(range);
const scope = document.createElement('canvas');
scope.width = 184;
scope.height = 108;
const peak = {};

async function measureAirCombat(mode) {
  const start = mode === 'trails' ? { ...scenarios.intercept, y: 5100 } : scenarios.intercept;
  const exercise = opponents[0].fight;
  if (!combat) {
    combat = new CombatExercise(exercise, range, {
      launch() { peak.launches++; },
      burst(point) {
        effects.emit('explosion', point, 18);
        effects.emit('debris', point, 10);
        peak.bursts++;
      },
    });
    ordnance = new CombatEffects(scene, model, opponents[0].visual, combat, effects);
    trails = new FlightTrails(scene, combat.missiles.pool, [player, ...opponents.map(({ fight }) => fight.opponent)]);
  }
  const active = ['contacts', 'trails'].includes(mode) ? opponents : opponents.slice(0, 1);
  const distance = mode === 'launch' ? 1720 : mode === 'burst' ? 1270 : 4490;
  player.reset(start);
  effects.clear();
  camera.snap = true;
  combatCamera.reset();
  trails.clear();
  const activeAircraft = opponents.map((entry) => active.includes(entry));
  Object.assign(peak, { contacts: 0, missiles: 0, decoys: 0, launches: 0, bursts: 0, particles: 0, ribbons: 0, missileCamera: false });
  for (const [index, { fight, visual }] of opponents.entries()) {
    visual.root.visible = active.includes(opponents[index]);
    if (!visual.root.visible) continue;
    const x = (index === 0 ? 65 : (index - 1.5) * 1900);
    const z = distance + index * 410;
    fight.reset('aggressive', start, {
      x, y: index * 30, z, speed: 190, heading: Math.PI - Math.atan2(x, z),
    });
  }
  combat.reset('intercept', 'veteran');
  combat.player.candidates = active.map(({ fight }) => fight.opponent);
  if (mode !== 'ai') {
    combat.enemy.radar.togglePower();
    combat.nextLaunch = Infinity;
  }
  combat.player.radar.togglePower();
  if (mode === 'contacts') combat.player.radar.cycleMode();
  ordnance.reset();
  const { radar, rack } = combat.player;
  let lastLaunch = -Infinity;
  let nextDecoy = 0;
  let revision = -1;
  let burst = false;

  const advance = () => {
    player.step(neutralControls);
    for (const { fight } of active) fight.update(fight === exercise ? combat.adjust : null);
    combat.step(STEP);
    const time = player.elapsed;
    if (!radar.locked && radar.contacts.size && ['salvo', 'ai', 'trails', 'camera'].includes(mode)) {
      radar.selectNext();
      radar.toggleLock();
    }
    if (['launch', 'salvo', 'ai', 'trails', 'camera'].includes(mode)) {
      const type = mode === 'launch' ? 'infrared' : 'radar';
      const desired = ['salvo', 'trails'].includes(mode) ? 2 : 1;
      if (rack.count(type) > 2 - desired && time - lastLaunch > 0.65 && rack.seeker[type].ready) {
        if (combat.launch(combat.player, combat.enemy, type)) lastLaunch = time;
      }
    }
    if (mode === 'decoys' && time >= nextDecoy) {
      for (const side of combat.sides) {
        side.rack.deploy('flare', time, combat.decoys);
        side.rack.deploy('chaff', time, combat.decoys);
      }
      nextDecoy = time + 0.46;
    }
    if (!burst && mode === 'burst' && time > 0.72) {
      burst = true;
      const point = player.position.clone().add(new T.Vector3(8, 4, 60));
      combat.effects.burst(point, true);
    }
    ordnance.step(time);
    trails.step(time, activeAircraft);
    peak.contacts = Math.max(peak.contacts, radar.contacts.size);
    peak.missiles = Math.max(peak.missiles, combat.missiles.pool.filter((item) => item.active).length);
    peak.decoys = Math.max(peak.decoys, combat.decoys.pool.filter((item) => item.active).length);
    peak.particles = Math.max(peak.particles, effects.particleCount);
  };
  // Warm up the engagement so the measurement includes a real AI launch.
  if (['ai', 'camera', 'trails'].includes(mode)) for (let tick = 0; tick < 240; tick++) advance();
  let last = performance.now();
  let accumulator = 0;
  const render = (now) => {
    const dt = Math.min(0.3, (now - last) / 1000);
    last = now;
    accumulator += dt;
    while (accumulator >= STEP) {
      accumulator -= STEP;
      advance();
    }
    pose(model, player, now / 1000);
    for (const { visual, fight } of active) pose(visual, fight.opponent, now / 1000);
    camera.update(model.root, player.velocity, dt, 'flying', false, 1);
    if (mode === 'camera' && !combatCamera.observing) combatCamera.cycle(player, combat.missiles.pool);
    const view = combatCamera.update(camera.camera, model.root, null, 1, dt);
    peak.missileCamera ||= combatCamera.observing;
    world.update(combatCamera.missile ? view.position : player.position, view);
    trails.render(player.elapsed, view);
    if (trails.mesh.visible) peak.ribbons = Math.max(peak.ribbons, trails.geometry.drawRange.count / 6);
    ordnance.render(1);
    effects.render(player.elapsed, dt, 1, true);
    if (revision !== radar.revision) {
      revision = radar.revision;
      drawRadar(scope, radar);
    }
    renderer.render(scene, view);
  };
  render(last);
  return { fps: await sampleFrames(render), ...peak, drawCalls: renderer.info.render.calls };
}

window.flightSystemsTest = { checkRig, checkImpact, measure, measureAirCombat, measureFleet: () => measureFleet(renderer), measureGroundStores: () => measureGroundStores(renderer), measureBattle: () => measureBattle(renderer), measureCasBattle: () => measureBattle(renderer, true), measureStrikeBattle: () => measureBattle(renderer, true, true) };
