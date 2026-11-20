import * as T from 'three';
import { f16 } from '../src/aircraft/f16.js';
import { createF16Visual, createOpponentVisual } from '../src/aircraft/f16-visual.js';
import { Ballistics } from '../src/sim/ballistics.js';
import { Cannon, worldMuzzle } from '../src/sim/cannon.js';
import { Dogfight } from '../src/sim/dogfight.js';
import { Flight, neutralControls, STEP } from '../src/sim/flight.js';
import { GunComputer } from '../src/sim/gun-computer.js';
import { PracticeRange } from '../src/sim/practice.js';
import { range, scenarios } from '../src/sim/range.js';
import { FlightCamera } from '../src/view/camera.js';
import { CannonEffects } from '../src/view/cannon-effects.js';
import { WorldView } from '../src/view/world.js';

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
  for (let i = 0; i < 118; i++) {
    player.step(neutralControls);
    fight.update();
  }
  visual.update(fight.opponent, 1);
  const ai = angle(visual, 'LeftFlaperon') - angle(visual, 'RightFlaperon');
  const meshName = 'LeftFlaperon';
  const sharedGeometry = visual.root.getObjectByName(meshName).children[0].geometry
    === model.root.getObjectByName(meshName).children[0].geometry;
  return { groundedFlap, gearDeployed, gearFolded, pitch, differential, brake, burner, flaperon, jammedFlap,
    separated, storesOff, ai, sharedGeometry, muzzle: model.muzzle.position.toArray() };
}

function pose(visual, flight, time) {
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
  return {
    fps: Number((frames * 1000 / (now - started)).toFixed(1)),
    drawCalls: renderer.info.render.calls,
    particles: effects.particleCount,
    rounds: cannon.fired,
  };
}

window.flightSystemsTest = { checkRig, checkImpact, measure };
