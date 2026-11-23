import * as T from 'three';
import { aircraftRegistry, defaultAircraft } from './aircraft/registry.js';
import { CannonAudio } from './audio/cannon-audio.js';
import { attenuation, FlightSound } from './audio/flight-sound.js';
import { canBind, Controls, keyDefaults, keyLabels, keyName, loadSettings, saveSettings } from './controls.js';
import { FlightPointerLock } from './pointer-lock.js';
import { opponentModes } from './sim/ai-pilot.js';
import { cannonRoundMass } from './sim/cannon.js';
import { CasDirector } from './sim/cas/director.js';
import { casMissions, createCasScenario } from './sim/cas/scenarios.js';
import { StrikeWing } from './sim/strike/wing.js';
import { TargetingPod } from './sim/strike/pod.js';
import { guidedWeapon } from './sim/strike/guided.js';
import { AirDefenses } from './sim/strike/defenses.js';
import { GroundBattle, groundMissions } from './sim/ground/battlefield.js';
import { GroundObserver } from './sim/ground/ground-observer.js';
import { GroundRange } from './sim/ground-range.js';
import { availablePresets, LoadoutBook, missionLoadout } from './sim/loadouts.js';
import { applyGroundImpact, RangeOrdnance } from './sim/range-ordnance.js';
import { createSortie } from './sim/sortie.js';
import { combatExercises } from './sim/combat/exercise.js';
import { weapons } from './sim/combat/weapons.js';
import { STEP } from './sim/flight.js';
import { sightInterval, VisualTrack } from './sim/gun-computer.js';
import { PracticeRange } from './sim/practice.js';
import { range, scenarios } from './sim/range.js';
import { CannonTrigger } from './trigger.js';
import { CasInterface } from './view/cas-interface.js';
import { BattlefieldView } from './view/battlefield-view.js';
import { AircraftHangar } from './view/aircraft-hangar.js';
import { AircraftPreview, describeAircraft } from './view/aircraft-picker.js';
import { LoadoutEditor } from './view/loadout-editor.js';
import { AttachedStores, GroundRangeView, ReleasedStores, StoreModels } from './view/loadout-visual.js';
import { FlightCamera } from './view/camera.js';
import { CombatEffects, drawRadar } from './view/combat-view.js';
import { CombatCamera } from './view/combat-camera.js';
import { ContactMarker, KnownContacts } from './view/contacts.js';
import { presets, WorldView } from './view/world.js';
import './style.css';

const ui = Object.fromEntries([...document.querySelectorAll('[id]')].map((element) => [element.id, element]));
const text = (id, value) => {
  const output = ui[id];
  const next = String(value);
  if (output.textContent !== next) output.textContent = next;
};
const pressed = (id, value) => {
  const button = ui[id];
  if (button.getAttribute('aria-pressed') !== String(value)) button.setAttribute('aria-pressed', value);
};
const debug = import.meta.env.DEV && new URLSearchParams(location.search).has('debug');
const flightLabels = {
  air: 'FREE FLIGHT', runway: 'FREE FLIGHT', practice: 'CANNON RANGE', dogfight: 'DOGFIGHT',
  cas: 'CLOSE AIR SUPPORT', battlefield: 'BATTLEFIELD SUPPORT', convoy: 'CONVOY INTERDICTION',
  groundRange: 'GROUND ATTACK RANGE', short: 'MISSILE DOGFIGHT', intercept: 'BVR INTERCEPT', outnumbered: 'OUTNUMBERED',
};
const combatShortcuts = ['cycleWeapon', 'fireSelected', 'radarPower', 'radarTarget', 'radarLock',
  'radarMode', 'radarRange', 'radarScope', 'flares', 'chaff'];

requestAnimationFrame(async () => {
  try {
    await boot();
  } catch (error) {
    console.error(error);
    unavailable('A WebGL 2 browser with hardware acceleration is needed to render the flight deck.');
  }
});

function unavailable(message) {
  document.body.dataset.screen = 'unavailable';
  text('loading-title', 'Flight deck unavailable');
  text('loading-detail', message);
  text('phase', 'UNAVAILABLE');
  ui['open-settings'].disabled = true;
}

async function boot() {
  const settings = loadSettings();
  const renderer = new T.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  ui.viewport.append(renderer.domElement);
  const scene = new T.Scene();
  const world = new WorldView(scene, renderer);
  const view = new FlightCamera(range);
  const combatCamera = new CombatCamera(range);
  const pod = new TargetingPod(range);
  let renderedPod = false;
  let lastPodObservation = -Infinity;
  let playerModelAssets, strikeWing, strikeVisual, strikeStores;
  const knownContacts = new KnownContacts(range);
  const contactMarker = new ContactMarker();
  const hangar = new AircraftHangar();
  let aircraftId = defaultAircraft;
  try {
    const remembered = localStorage.getItem('war-browser:aircraft');
    if (Object.hasOwn(aircraftRegistry, remembered)) aircraftId = remembered;
  } catch {
    // Storage access does not affect aircraft selection in this session.
  }
  const initialAssets = await hangar.load(aircraftId);
  const preview = new AircraftPreview(renderer);
  let saveStorage;
  try { saveStorage = localStorage; } catch { /* Sessions can edit loadouts without persistent storage. */ }
  const loadoutBook = new LoadoutBook(saveStorage);
  const modelStores = new StoreModels();
  let activeLoadout, attachedStores, enemyStores, groundView, battlefieldView;
  let groundSolution = false;
  const groundPoint = new T.Vector3();
  let sortie;
  let flight, visual, aircraft, opponents, ballistics, weaponEffects, cannon, combat, trails, playerAirframe, gunComputer;
  let dogfight, wingman, opponentVisual, wingmanVisual;
  let activeOpponents, classicCandidates;
  let enemyId = aircraftId;
  let wingmanId = aircraftId;
  const lifecycle = new AbortController();
  const { signal } = lifecycle;
  const capture = new FlightPointerLock(ui.viewport, {
    acquired: () => {
      ui['keyboard-flight'].hidden = true;
      changeScreen('flying');
    },
    lost: () => pauseFlight('Mouse capture released. Resume to capture it again.'),
    failed: (reason) => {
      changeScreen('paused', reason + ' Click Resume flight to retry, or fly with the keyboard.');
      ui['keyboard-flight'].hidden = false;
    },
  }, signal);
  const controls = new Controls(settings, ui.viewport, {
    flying: () => screen === 'flying' && !ui.settings.open,
    locked: () => capture.locked,
    assisted: () => !keyboardFlight && settings.controlMode === 'assist',
    observing: () => combatCamera.observing,
    sensor: () => pod.active ? pod : null,
  }, view, signal);
  const practice = new PracticeRange();
  const colliders = [...range.structures, ...practice.targets];
  const ground = new GroundRange(range, (target) => {
    weaponEffects.emit('explosion', target.position, 16);
    weaponEffects.emit('debris', target.position, 10);
    blast(target.position);
  });
  const battle = new GroundBattle(range, {
    shot(point, unit) {
      if (listener.position.distanceToSquared(point) > 1600 ** 2) return;
      weaponEffects.emit('rocketFlash', point, 2, unit.direction);
      blast(point, true);
    },
    impact(point, collider) {
      if (listener.position.distanceToSquared(point) < 1400 ** 2) weaponEffects.emit(collider?.surface ?? 'ground', point, 2);
    },
    destroyed(unit) {
      if (listener.position.distanceToSquared(unit.position) > 2400 ** 2) return;
      weaponEffects.emit('explosion', unit.position, 14);
      weaponEffects.emit('debris', unit.position, 8);
      blast(unit.position);
    },
  });
  const groundObserver = new GroundObserver(range);
  const defenses = new AirDefenses(range, {
    shot(radar, point) { weaponEffects.emit('rocketFlash', point, radar ? 7 : 2); blast(point, true); },
    impact(surface, point) { weaponEffects.emit(surface, point, 3); },
  });
  const podStation = () => flight.stores ? combat.player.rack.station('pod') : null;
  const noPodTargets = [];
  const podTargets = () => battle.enabled ? battle.targets : noPodTargets;
  const missileCameras = () => battle.enabled && ordnance.rounds.some((round) => round.active && round.owner === flight)
    ? ordnance.rounds : combat.missiles.pool;
  let casUI;
  let mapKeyboard = false;
  let casBackdropDirty = true;
  let restoreMapAim = false;
  const randomSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];
  ui['cas-seed'].value = String(randomSeed());
  for (const [id, mission] of Object.entries(casMissions)) ui['cas-mission'].add(new Option(mission.label, id));
  const groundSortie = () => ground.enabled || battle.enabled;
  const smokePoint = new T.Vector3();
  const groundColliders = [...range.structures, ...ground.targets];
  const ordnance = new RangeOrdnance(range, (kind, point, collider, profile) => {
    if (kind === 'tank') weaponEffects.emit('ground', point, 4);
    else {
      const heavy = kind === 'bomb' || kind === 'laser' || kind === 'gps';
      weaponEffects.emit('explosion', point, heavy ? 16 : 8);
      weaponEffects.emit('debris', point, heavy ? 10 : 4);
      blast(point);
      const hits = applyGroundImpact(kind, point, collider, profile, battle.enabled ? battle.targets : ground.targets);
      if (guidedWeapon(kind)) combat.player.rack.message(hits ? 'TARGET AREA HIT' : 'PRECISION IMPACT', flight.elapsed);
    }
  }, (kind, point, direction) => {
    if (kind === 'rocket' || kind === 'optical') weaponEffects.emit('rocketFlash', point, 4, direction);
    blast(point, true);
  });
  let releasedStores;
  const audio = new CannonAudio(aircraftRegistry[aircraftId].spec.cannon.rpm);
  const sound = new FlightSound(audio);
  let listener = view.camera;
  const blast = (point, launch) => audio.blast(attenuation(listener.position.distanceTo(point), launch ? 225 : 420), launch);

  const sortieEvents = {
    enemyImpact(surface, point, ownHit) {
      if (ownHit) audio.impact();
      else if (surface !== 'metal') audio.impact(attenuation(listener.position.distanceTo(point), 36) * 0.44);
    },
    playerHit(time) {
      hitFeedbackUntil = time + 0.39;
      audio.impact(0.34);
    },
    playerShot() {
      if (trigger.held) audio.setFiring(true);
      else audio.pulse();
    },
    launch(own, cue, point) {
      if (own) audio.cue(cue);
      blast(point, true);
    },
    burst(point, own) {
      blast(point);
      if (own) audio.impact();
    },
    blast,
  };

  function installSortie(playerAssets, enemyAssets, wingmanAssets) {
    playerModelAssets = playerAssets;
    strikeVisual?.root.removeFromParent();
    strikeStores?.dispose();
    strikeWing = strikeVisual = strikeStores = null;
    combatEffects?.dispose();
    combatEffects = null;
    attachedStores?.dispose();
    enemyStores?.forEach((mounts) => mounts.dispose());
    sortie?.dispose();
    const instantiate = (id, assets, hostile = false) => ({ spec: aircraftRegistry[id].spec, visual: hangar.instantiate(assets, hostile) });
    sortie = createSortie(scene, range, practice, instantiate(aircraftId, playerAssets), [
      instantiate(enemyId, enemyAssets, true), instantiate(wingmanId, wingmanAssets, true),
    ], sortieEvents);
    ({ flight, visual, enemies: opponents, ballistics, weaponEffects, cannon, combat, trails, playerAirframe, gunComputer } = sortie);
    aircraft = visual.root;
    attachedStores = new AttachedStores(visual, modelStores);
    enemyStores = opponents.map(({ visual: model }) => new AttachedStores(model, modelStores));
    [{ fight: dogfight, visual: opponentVisual }, { fight: wingman, visual: wingmanVisual }] = opponents;
    activeOpponents = [false, false];
    classicCandidates = [dogfight.opponent];
    audio.setRate(flight.spec.cannon.rpm);
  }
  const weaponsAvailable = () => combat.enabled || Boolean(activeLoadout);
  const selectedWeapon = () => weaponsAvailable() ? combat.player.rack.selected : 'cannon';
  const groundWeapon = (type) => type === 'bomb' || type === 'rocket';
  const canFire = () => screen === 'flying' && !ui.settings.open && (capture.locked || keyboardFlight);
  const visualTrack = new VisualTrack();
  const droneTrack = { position: null, velocity: new T.Vector3() };
  const trigger = new CannonTrigger(ui.viewport, {
    enabled: canFire,
    pressed: () => {
      const weapon = selectedWeapon();
      if (weapon !== 'cannon') queuedLaunch = weapon;
      else if (cannon.ammo) audio.beginTrigger();
      updateWeaponHud();
    },
    released: () => {
      audio.setFiring(false);
      updateWeaponHud();
    },
  }, signal);
  signal.addEventListener('abort', () => {
    audio.dispose();
    combatEffects?.dispose();
    sortie?.dispose();
    releasedStores?.dispose();
    groundView?.dispose();
    battlefieldView?.dispose();
    strikeVisual?.root.removeFromParent();
    strikeStores?.dispose();
    modelStores.dispose();
    hangar.dispose();
  }, { once: true });
  const previousRenderPosition = new T.Vector3();
  const directionMarker = new T.Vector3();
  const flightDirection = new T.Vector3();
  const aimDirection = new T.Vector3();
  const sightProjection = new T.Vector3();
  const sightBearing = new T.Vector3();
  const sightForward = new T.Vector3();
  let sightActive = false;
  let sightMode = 'impact';
  let nextSight = 0;
  let opticalTarget = null;
  let nextDamageTrail = 0;
  let combatEffects;
  let scopeVisible = true;
  let radarRevision = -1;
  let queuedLaunch = null;
  let lastWarning = '';
  let warningCueAt = 0;
  let lastClearance = false;
  let lastEffectsTime = 0;
  let presentationAge = 0;
  let hitFeedbackUntil = 0;
  let screen = 'loading';
  let startingPosition = 'air';
  let brake = false;
  let rebinding;
  let keyboardFlight = false;
  let viewportWidth = 0;
  let viewportHeight = 0;
  let deckHeight = 0;
  let accumulator = 0;
  let previousFrame;
  let lastHudTime = -1;
  let frameCount = 0;
  let frameWindow = 0;
  let stopped = false;
  let switchingAircraft = false;
  installSortie(initialAssets, initialAssets, initialAssets);

  renderer.domElement.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    stopped = true;
    controls.clear();
    lifecycle.abort();
    unavailable('The graphics context was lost. Reload this page to restart the flight deck.');
  }, { signal });

  function alignAim() {
    const velocity = flight.velocity;
    const groundSpeed = Math.hypot(velocity.x, velocity.z);
    const heading = groundSpeed > 12 ? Math.atan2(-velocity.x, velocity.z) : T.MathUtils.degToRad(flight.heading);
    controls.aim.align(heading, Math.atan2(velocity.y, Math.max(1, groundSpeed)));
  }

  function changeScreen(next, pauseMessage = 'Your aircraft is holding position.') {
    if (next !== 'flying') capture.release();
    if (next === 'complete' || next === 'failed') {
      combatCamera.returnToAircraft();
      pod.active = false;
    }
    screen = next;
    casBackdropDirty = true;
    document.body.dataset.screen = next;
    const flightLabel = flightLabels[startingPosition];
    text('phase', {
      ready: 'PREFLIGHT', flying: flightLabel, map: 'TACTICAL MAP', paused: 'PAUSED', failed: 'FLIGHT ENDED', complete: 'MISSION ENDED',
    }[next]);
    text('pause-mode', flightLabel);
    ui['mission-results'].hidden = next !== 'complete';
    trigger.clear();
    queuedLaunch = null;
    audio.setFiring(false);
    controls.clear();
    accumulator = 0;
    if (next === 'paused') {
      text('pause-title', 'Paused');
      text('pause-description', pauseMessage);
    }
    document.body.dataset.direct = String(keyboardFlight || settings.controlMode === 'direct');
    document.body.dataset.captured = String(next === 'flying' && capture.locked);
    if (next === 'flying') {
      if (!restoreMapAim) alignAim();
      restoreMapAim = false;
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    } else {
      ui['keyboard-flight'].hidden = next !== 'paused' || !keyboardFlight;
    }
    updateHud();
    updateWeaponHud();
  }

  function pauseFlight(message) {
    if (screen === 'flying' || capture.pending) changeScreen('paused', message);
  }

  function requestFlight() {
    if (stopped || switchingAircraft || !readyAircraft() || ui['cas-map-dialog'].open || ui.settings.open || ui['aircraft-dialog'].open || ui['loadout-dialog'].open) return;
    keyboardFlight = false;
    audio.unlock();
    capture.request();
  }

  function restartFlight() {
    if (screen === 'flying') {
      reset('flying');
    } else {
      reset('paused');
      requestFlight();
    }
  }

  function readyAircraft() {
    return startingPosition !== 'cas' || flight.spec.weaponDomains.includes('ground');
  }

  function reset(next) {
    restoreMapAim = false;
    const difficulty = ui['combat-difficulty'].value;
    const selectedSeed = ui['cas-seed'];
    if (!selectedSeed.validity.valid) selectedSeed.value = String(randomSeed());
    const seed = startingPosition === 'cas' ? Number(selectedSeed.value) : randomSeed();
    const director = startingPosition === 'cas'
      ? new CasDirector(createCasScenario(ui['cas-mission'].value, seed, difficulty, battle.roads)) : null;
    const start = director?.plan.start ?? scenarios[startingPosition];
    const exercise = combatExercises[startingPosition];
    flight.reset(start);
    const testing = startingPosition === 'air' || startingPosition === 'runway';
    flight.protectedAirframe = testing && ui['test-protect'].checked;
    ui['test-options'].hidden = !testing;
    cannon.reset();
    if (exercise?.cannonLimit) cannon.ammo = exercise.cannonLimit;
    ballistics.clear();
    practice.reset(startingPosition === 'practice');
    dogfight.reset(exercise ? 'aggressive' : startingPosition === 'dogfight' ? ui['opponent-mode'].value : null,
      start, exercise?.opponent);
    wingman.reset(exercise?.wingman ? 'aggressive' : null, start, exercise?.wingman);
    combat.reset(exercise ? startingPosition : null, ui['combat-difficulty'].value);
    ground.reset(startingPosition === 'groundRange');
    battle.reset(startingPosition, difficulty, undefined, seed, director);
    strikeVisual?.root.removeFromParent();
    strikeStores?.dispose();
    strikeWing = strikeVisual = strikeStores = null;
    if (director?.plan.strikeWing && readyAircraft()) {
      strikeWing = new StrikeWing(flight.spec, range, battle, {
        impact(point) { weaponEffects.emit('explosion', point, 7); blast(point); },
        launch(point) { weaponEffects.emit('rocketFlash', point, 4); },
      });
      strikeWing.reset();
      strikeVisual = hangar.instantiate(playerModelAssets);
      scene.add(strikeVisual.root);
      strikeStores = new ReleasedStores(scene, modelStores, strikeWing.stores);
    }
    defenses.reset(combat, battle.targets, difficulty, strikeWing);
    pod.reset();
    lastPodObservation = -Infinity;
    groundObserver.reset();
    if (battle.enabled && !battlefieldView) battlefieldView = new BattlefieldView(scene, battle, range);
    if (ground.enabled && !groundView) groundView = new GroundRangeView(scene, ground.targets);
    ordnance.clear();
    const saved = loadoutBook.entry(flight.spec).active;
    const assignment = saved ?? (groundSortie() && readyAircraft() ? availablePresets(flight.spec)[director?.plan.loadout ?? 'Ground Attack'] : null);
    activeLoadout = assignment && missionLoadout(flight.spec, assignment, startingPosition);
    const rack = combat.player.rack;
    if (activeLoadout) {
      const firstGuided = activeLoadout.stations.find(({ type }) => guidedWeapon(type))?.type;
      const initial = director?.plan.strike && firstGuided ? firstGuided
        : groundSortie() && activeLoadout.stations.some(({ type }) => type === 'bomb') ? 'bomb'
        : groundSortie() && activeLoadout.stations.some(({ type }) => type === 'rocket') ? 'rocket' : exercise?.initialWeapon;
      rack.reset(activeLoadout, initial);
      flight.ammunitionMass = cannon.ammo * cannonRoundMass;
      if (!releasedStores) releasedStores = new ReleasedStores(scene, modelStores, ordnance);
    }
    attachedStores.reset(activeLoadout ? rack.stations : null);
    pod.sync(flight, podStation());
    ui['result-precision-row'].hidden = !activeLoadout?.stations.some(({ type }) => guidedWeapon(type));
    for (const [index, mounts] of enemyStores.entries()) {
      const side = combat.allEnemies[index];
      mounts.reset(side?.flight.customStores ? side.rack.stations : null);
      if (side?.flight.customStores) side.flight.ammunitionMass = side.fight.cannon.ammo * cannonRoundMass;
    }
    for (const id of ['result-bombs-row', 'result-rockets-row', 'result-targets-row']) ui[id].hidden = !groundSortie();
    for (const id of ['result-enemies-row', 'result-missiles-row', 'result-airframe-row']) ui[id].hidden = groundSortie();
    ui['result-ground-forces-row'].hidden = !battle.enabled;
    ui['result-friendly-fire-row'].hidden = !battle.enabled;
    for (const id of ['result-cas-objectives-row', 'result-cas-support-row', 'cas-replay-new']) ui[id].hidden = !director;
    if (director) ui['result-airframe-row'].hidden = false;
    if ((exercise || defenses.enabled) && !combatEffects) combatEffects = new CombatEffects(scene, visual, opponentVisual, combat, weaponEffects, [wingmanVisual]);
    combatEffects?.reset(defenses.enabled);
    activeOpponents[0] = dogfight.enabled;
    activeOpponents[1] = wingman.enabled;
    playerAirframe.reset();
    for (const entry of opponents) entry.airframe.reset();
    trails.clear();
    combatCamera.reset();
    knownContacts.reset();
    scopeVisible = true;
    radarRevision = -1;
    lastWarning = '';
    warningCueAt = 0;
    lastClearance = false;
    weaponEffects.clear();
    lastEffectsTime = 0;
    presentationAge = 0;
    hitFeedbackUntil = 0;
    nextDamageTrail = 0;
    aircraft.position.copy(flight.position);
    aircraft.quaternion.copy(flight.orientation);
    previousRenderPosition.copy(flight.position);
    brake = false;
    view.mode = 'chase';
    view.distance = flight.spec.chaseDistance ?? 31;
    view.azimuth = 0;
    view.elevation = 0;
    view.snap = true;
    invalidateSight();
    changeScreen(next);
  }

  function updateAircraftIdentity() {
    const { spec } = flight;
    const title = spec.name.substring(spec.shortName.length + 1).split(' ');
    ui.briefing.dataset.aircraft = aircraftId;
    text('aircraft-title-first', title[0]);
    text('aircraft-title-second', title.slice(1).join(' '));
    text('briefing-aircraft', spec.shortName);
    text('pause-aircraft', spec.shortName);
    text('aircraft-current', spec.shortName);
    for (const id of ['start-ground-range', 'start-battlefield', 'start-convoy']) {
      ui[id].disabled = !spec.weaponDomains.includes('ground');
      ui[id].title = ui[id].disabled ? 'Requires the F-16C' : '';
    }
    text('aircraft-briefing-description', spec.description);
  }

  function combatBriefing(mission) {
    const spec = flight.spec;
    const loadout = spec.loadouts[mission];
    const name = aircraftRegistry[enemyId].spec.shortName;
    const second = aircraftRegistry[wingmanId].spec.shortName;
    if (mission === 'outnumbered') {
      const incoming = name === second ? `two incoming ${name}s` : `an incoming ${name} and ${second}`;
      return `Defeat ${incoming} · ${combatExercises.outnumbered.cannonLimit} rounds · 1 radar and 1 IR missile · ${loadout.flare} flares and ${loadout.chaff} chaff`;
    }
    const ir = loadout.stations.filter(({ type }) => type === 'infrared').length;
    const radar = loadout.stations.length - ir;
    return mission === 'short' ? `Defeat one ${name} with guns or short-range missiles · ${ir} IR missiles`
      : `Track and intercept one inbound ${name} · ${radar} radar and ${ir} IR missiles`;
  }

  async function selectFleet(next, primary = enemyId, second = wingmanId) {
    if (switchingAircraft || stopped) return false;
    if (next === aircraftId && primary === enemyId && second === wingmanId) return true;
    switchingAircraft = true;
    ui.launch.disabled = true;
    try {
      const assets = await Promise.all([next, primary, second].map((id) => hangar.load(id)));
      if (stopped) return false;
      aircraftId = next;
      enemyId = primary;
      wingmanId = second;
      installSortie(...assets);
      updateAircraftIdentity();
      selectStart(startingPosition !== 'cas' && groundSortie() && !flight.spec.weaponDomains.includes('ground') ? 'air' : startingPosition);
      applyPreset();
      try { localStorage.setItem('war-browser:aircraft', aircraftId); } catch { /* Selection remains active. */ }
      return true;
    } catch (error) {
      console.error(error);
      text('aircraft-status', 'Aircraft could not be loaded. Try again.');
      return false;
    } finally {
      switchingAircraft = false;
      ui.launch.disabled = !readyAircraft();
    }
  }

  function initAircraftSelector() {
    const dialog = ui['aircraft-dialog'];
    const cards = new Map();
    const assetsById = new Map();
    let inspected = aircraftId;
    let angle = 0.71;
    let rotateFrame = 0;
    const draw = () => {
      rotateFrame = 0;
      const assets = assetsById.get(inspected);
      if (!assets || !dialog.open) return;
      const spec = aircraftRegistry[inspected].spec;
      text('preview-name', spec.name);
      ui['hangar-preview'].src = preview.draw(assets, angle, 510, 190);
      ui['hangar-preview'].alt = `Rotatable preview of ${spec.name}`;
    };
    const rotate = (amount) => {
      angle += amount;
      if (!rotateFrame) rotateFrame = requestAnimationFrame(draw);
    };
    for (const [id, { spec }] of Object.entries(aircraftRegistry)) {
      for (const select of [ui['opponent-aircraft'], ui['wingman-aircraft']]) select.add(new Option(spec.name, id));
      const card = ui['aircraft-card-template'].content.firstElementChild.cloneNode(true);
      const inspect = card.querySelector('.card-preview');
      const choose = card.querySelector('.aircraft-select');
      inspect.setAttribute('aria-label', `Preview ${spec.name}`);
      choose.textContent = `Fly ${spec.shortName}`;
      describeAircraft(spec, card);
      cards.set(id, { card, inspect, choose });
      inspect.addEventListener('click', () => {
        inspected = id;
        angle = 0.71;
        draw();
      }, { signal });
      choose.addEventListener('click', async () => {
        if (aircraftId === id || await selectFleet(id)) dialog.close();
      }, { signal });
      ui['aircraft-cards'].append(card);
    }
    const updateEnemy = async () => {
      const first = ui['opponent-aircraft'];
      const second = ui['wingman-aircraft'];
      first.disabled = second.disabled = true;
      if (!await selectFleet(aircraftId, first.value, second.value)) {
        first.value = enemyId;
        second.value = wingmanId;
      }
      first.disabled = second.disabled = false;
    };
    ui['opponent-aircraft'].value = enemyId;
    ui['wingman-aircraft'].value = wingmanId;
    ui['opponent-aircraft'].addEventListener('change', updateEnemy, { signal });
    ui['wingman-aircraft'].addEventListener('change', updateEnemy, { signal });
    ui['open-aircraft'].addEventListener('click', async () => {
      inspected = aircraftId;
      angle = 0.71;
      text('aircraft-status', '');
      for (const [id, { choose }] of cards) choose.setAttribute('aria-pressed', String(id === aircraftId));
      dialog.showModal();
      for (const [id, { inspect }] of cards) {
        if (assetsById.has(id)) continue;
        try {
          const assets = await hangar.load(id);
          assetsById.set(id, assets);
          inspect.querySelector('img').src = preview.draw(assets, 0.71, 240, 118);
          if (id === inspected) draw();
        } catch {
          text('aircraft-status', 'An aircraft preview could not be loaded.');
        }
      }
      draw();
    }, { signal });
    ui['close-aircraft'].addEventListener('click', () => dialog.close(), { signal });
    ui['preview-left'].addEventListener('click', () => rotate(-0.24), { signal });
    ui['preview-right'].addEventListener('click', () => rotate(0.24), { signal });
    const image = ui['hangar-preview'];
    image.addEventListener('pointerdown', (event) => image.setPointerCapture(event.pointerId), { signal });
    image.addEventListener('pointermove', (event) => {
      if (image.hasPointerCapture(event.pointerId)) rotate(event.movementX * 0.012);
    }, { signal });
  }

  function selectStart(next) {
    startingPosition = next;
    const isCas = next === 'cas';
    ui.briefing.dataset.cas = String(isCas);
    ui.briefing.setAttribute('aria-labelledby', isCas ? 'cas-mission-title' : 'aircraft-title');
    text('start-air', isCas ? 'Back to flight modes' : 'Air start');
    ui['cas-preparation'].hidden = !isCas;
    ui['start-detail'].hidden = isCas;
    pressed('start-cas', isCas);
    ui.launch.disabled = switchingAircraft || !readyAircraft();
    ui.launch.firstChild.textContent = isCas ? 'Start mission ' : 'Start flight ';
    ui.restart.firstChild.textContent = isCas ? 'Restart same scenario ' : 'Restart flight ';
    ui.return.textContent = isCas ? 'Back to CAS briefing' : 'Back to briefing';
    pressed('start-air', next === 'air');
    pressed('start-runway', next === 'runway');
    pressed('start-practice', next === 'practice');
    pressed('start-ground-range', next === 'groundRange');
    for (const key of Object.keys(groundMissions)) pressed(`start-${key}`, next === key);
    pressed('start-dogfight', next === 'dogfight');
    pressed('start-short', next === 'short');
    pressed('start-intercept', next === 'intercept');
    pressed('start-outnumbered', next === 'outnumbered');
    ui['opponent-choice'].hidden = next !== 'dogfight';
    ui['opponent-aircraft-choice'].hidden = next !== 'dogfight' && !combatExercises[next];
    ui['wingman-choice'].hidden = next !== 'outnumbered';
    ui['combat-choice'].hidden = !combatExercises[next] && !groundMissions[next] && !isCas;
    ui['combat-choice'].firstChild.textContent = isCas ? 'CAS difficulty ' : 'Opponent difficulty ';
    ui['battle-briefing-options'].hidden = !groundMissions[next] && !isCas;
    text('briefing-mode', flightLabels[next]);
    reset('ready');
    if (isCas) {
      casUI ??= new CasInterface(ui, range, battle.roads, selectCasContact, signal);
      casUI.briefing(battle.mission, readyAircraft(), text);
    }
    const loadoutNote = loadoutBook.entry(flight.spec).active && activeLoadout
      ? ` · CUSTOM LOADOUT${activeLoadout.restricted ? ' · MISSION STORE LIMITS APPLIED' : ''}`
      : next === 'outnumbered' ? ' · MISSION LOADOUT' : '';
    ui['ground-release-options'].hidden = !activeLoadout?.stations.some(({ type }) => groundWeapon(type));
    text('start-detail', (next === 'runway' ? 'GROUND START · GEAR DOWN'
      : next === 'practice' ? `3 AERIAL DRONES · ${flight.spec.cannon.capacity} ROUNDS`
      : next === 'groundRange' ? 'DISABLE FIVE MARKED RANGE TARGETS · REARM AVAILABLE'
      : groundMissions[next] ? groundMissions[next].briefing
      : next === 'dogfight' ? `One ${aircraftRegistry[enemyId].spec.shortName} · Guns only · ${opponentModes[ui['opponent-mode'].value].briefing}`
      : combatExercises[next] ? combatBriefing(next)
      : `2,950 FT MSL · ${Math.round(flight.airspeed)} KTS`) + loadoutNote);
  }

  function resize() {
    casBackdropDirty = true;
    const preset = presets[settings.preset];
    const width = viewportWidth = ui.viewport.clientWidth;
    const height = viewportHeight = ui.viewport.clientHeight;
    const podRatio = { low: .58, medium: .79, high: 1 }[settings.preset];
    renderer.setPixelRatio(Math.min(devicePixelRatio, pod.active && screen === 'flying' ? podRatio : preset.pixels));
    renderer.setSize(width, height, false);
    view.camera.aspect = width / Math.max(1, height);
    view.camera.fov = view.camera.aspect < 0.82 ? 66 : 51;
    view.camera.updateProjectionMatrix();
    pod.camera.aspect = view.camera.aspect;
    pod.camera.updateProjectionMatrix();
    weaponEffects.resize(renderer, view.camera);
    if (screen === 'ready') view.snap = true;
  }

  function updateSettings() {
    saveSettings(settings);
    document.body.dataset.direct = String(keyboardFlight || settings.controlMode === 'direct');
    text('mouse-value', settings.mouseSensitivity.toFixed(1));
    text('camera-value', settings.cameraSensitivity.toFixed(1));
    text('aim-response-value', settings.aimResponsiveness.toFixed(1));
    text('camera-smoothing-value', settings.cameraSmoothing.toFixed(1));
    text('camera-turn-value', settings.cameraTurnResponse.toFixed(1));
    for (const action of ['afterburner', 'gear', 'stores', 'airbrake', 'camera', 'pause', 'sight', 'sightMode']) {
      text(`key-${action}`, keyName(settings.keys[action]));
    }
    for (const action of [...combatShortcuts, 'weaponBomb', 'weaponRocket', 'jettisonTank', 'rearmGround']) {
      text(`key-${action}`, keyName(settings.keys[action]));
    }
    for (const action of ['missileView', 'nextMissile', 'targetView']) text(`key-${action}`, keyName(settings.keys[action]));
    for (const action of ['podView', 'podMode']) text(`key-${action}`, keyName(settings.keys[action]));
    for (const [id, action] of Object.entries({ 'pod-track-key': 'radarLock', 'pod-mark-key': 'nextMissile',
      'pod-laser-key': 'radarPower', 'pod-center-key': 'radarScope', 'strike-chaff-key': 'chaff', 'strike-flare-key': 'flares' })) {
      text(id, keyName(settings.keys[action]));
    }
    text('key-tacticalMap', keyName(settings.keys.tacticalMap));
    text('ground-target-key', keyName(settings.keys.radarTarget));
    text('missile-view-hint', keyName(settings.keys.missileView));
    text('target-view-hint', keyName(settings.keys.targetView));
    text('restart-key', keyName(settings.keys.restart));
    text('help-maneuver', ['pitchUp', 'rollLeft', 'pitchDown', 'rollRight'].map((key) => keyName(settings.keys[key])).join(' '));
    text('help-throttle', [keyName(settings.keys.throttleUp), keyName(settings.keys.throttleDown)].join(' / '));
  }

  function applyPreset() {
    world.setPreset(presets[settings.preset]);
    weaponEffects.setPreset(presets[settings.preset]);
    trails.setPreset(presets[settings.preset]);
    resize();
  }

  function renderBindings() {
    const owner = document.activeElement?.dataset.binding;
    ui.bindings.replaceChildren();
    for (const [action, label] of Object.entries(keyLabels)) {
      const button = document.createElement('button');
      const key = document.createElement('kbd');
      button.type = 'button';
      button.className = 'binding';
      button.dataset.binding = action;
      button.setAttribute('aria-pressed', String(action === rebinding));
      key.textContent = keyName(settings.keys[action]);
      button.append(label, key);
      button.addEventListener('click', () => {
        rebinding = action;
        text('rebind-message', `Press a key for ${label.toLowerCase()}. Press Esc to cancel.`);
        renderBindings();
      });
      ui.bindings.append(button);
      if (action === owner) button.focus();
    }
  }

  function openSettings() {
    pauseFlight('Resume flight to recapture the mouse.');
    ui.settings.showModal();
    ui['close-settings'].focus();
  }

  function changeWeapon(type) {
    if (!weaponsAvailable()) return;
    const rack = combat.player.rack;
    const before = rack.selected;
    if (type) rack.select(type);
    else rack.cycle();
    if (rack.selected === before) return;
    queuedLaunch = null;
    trigger.clear();
    lastClearance = false;
    invalidateSight();
  }

  const actions = {
    afterburner() { flight.toggleAfterburner(); },
    gear() { if (!flight.grounded) flight.gearDown = !flight.gearDown; },
    stores() { flight.stores = !flight.stores; },
    airbrake() { brake = !brake; },
    camera() { if (pod.active) actions.podView(); else if (combatCamera.observing) combatCamera.returnToAircraft(); else view.cycle(); },
    podView() {
      if (!podStation()) return;
      combatCamera.returnToAircraft();
      pod.toggle();
      invalidateSight();
    },
    podMode() { if (pod.active) pod.cycleMode(); },
    missileView() {
      if (pod.active) actions.podView();
      combatCamera.cycle(flight, missileCameras());
    },
    nextMissile() {
      if (pod.active) {
        if (pod.designate()) combat.player.rack.message('COORDINATES SAVED', flight.elapsed);
      } else combatCamera.next(flight, missileCameras());
    },
    targetView() { combatCamera.toggleTarget(knownContacts.current); },
    sight() { sightActive = !sightActive; invalidateSight(); },
    sightMode() { sightMode = sightMode === 'impact' ? 'lead' : 'impact'; invalidateSight(); },
    weaponCannon() { changeWeapon('cannon'); },
    weaponInfrared() { changeWeapon('infrared'); },
    weaponRadar() { changeWeapon('radar'); },
    weaponBomb() { changeWeapon('bomb'); },
    weaponRocket() { changeWeapon('rocket'); },
    jettisonTank() {
      const rack = combat.player.rack;
      if (ordnance.jettison(rack)) rack.message('TANK RELEASED', flight.elapsed);
    },
    rearmGround() {
      if (!ground.enabled) return;
      const rack = combat.player.rack;
      for (const station of rack.stations) {
        if (!groundWeapon(station.type)) continue;
        station.remaining = station.quantity;
        station.used = false;
      }
      rack.syncPayload();
      cannon.ammo = cannon.config.capacity;
      flight.ammunitionMass = cannon.ammo * cannonRoundMass;
      rack.message('RANGE WEAPONS REARMED', flight.elapsed);
      invalidateSight();
    },
    cycleWeapon() { changeWeapon(); },
    radarPower() { if (pod.active) pod.laser(); else if (combat.enabled) combat.player.radar.togglePower(); },
    radarTarget() {
      if (combat.enabled) combat.player.radar.selectNext();
      else if (battle.enabled && groundObserver.contacts.size) {
        groundObserver.cycle();
        battle.director?.select(null);
      } else if (battle.director) {
        const known = [...battle.director.contacts.keys()];
        if (known.length) battle.director.select(known[(known.indexOf(battle.director.selected) + 1) % known.length]);
      }
    },
    tacticalMap() { openCasMap(); },
    radarLock() {
      if (pod.active) {
        if (!pod.select(podTargets())) combat.player.rack.message('NO VISUAL TRACK', flight.elapsed);
        return;
      }
      if (!combat.enabled) return;
      const { radar, rack } = combat.player;
      const wasLocked = radar.locked;
      if (radar.toggleLock() && !wasLocked && radar.locked) audio.cue('locked');
      else if (!wasLocked && !radar.locked) rack.message('SELECT A RADAR CONTACT', flight.elapsed);
      invalidateSight();
    },
    radarMode() { if (combat.enabled) combat.player.radar.cycleMode(); },
    radarRange() { if (combat.enabled) combat.player.radar.cycleRange(); },
    radarScope() { if (pod.active) { pod.recenter(); return; } if (combat.enabled) { scopeVisible = !scopeVisible; radarRevision = -1; } },
    flares() { if (combat.enabled || defenses.enabled) combat.player.rack.deploy('flare', flight.elapsed, combat.decoys); },
    chaff() { if (combat.enabled || defenses.enabled) combat.player.rack.deploy('chaff', flight.elapsed, combat.decoys); },
    pause() { changeScreen('paused'); },
    restart: restartFlight,
  };

  for (const [name, run] of Object.entries(actions)) {
    ui[`toggle-${name === 'afterburner' ? 'burner' : name}`]?.addEventListener('click', () => {
      if (screen === 'flying') {
        run();
        updateHud();
        document.activeElement?.blur();
      }
    });
  }
  function selectCasContact(id, accept = false) {
    if (accept) battle.director.accept(id, battle.time);
    else battle.director.select(id);
    const mark = battle.director.designation(battle);
    if (mark && pod.mounted) pod.setArea(mark.position);
    if (ui['cas-map-dialog'].open) casUI.battle(battle, flight, text, pod);
  }

  function openCasMap() {
    if (!battle.director || screen !== 'flying') return;
    mapKeyboard = keyboardFlight;
    changeScreen('map');
    casUI.battle(battle, flight, text, pod);
    ui['cas-map-dialog'].showModal();
    ui['cas-map-close'].focus();
  }

  function closeCasMap() {
    ui['cas-map-dialog'].close();
    restoreMapAim = true;
    if (mapKeyboard) changeScreen('flying');
    else requestFlight();
  }

  function generateCasScenario() {
    ui['cas-seed'].value = String(randomSeed());
    selectStart('cas');
  }

  ui['cas-map-open'].addEventListener('click', openCasMap, { signal });
  ui['cas-map-close'].addEventListener('click', closeCasMap, { signal });
  ui['cas-map-dialog'].addEventListener('cancel', (event) => {
    event.preventDefault();
    closeCasMap();
  }, { signal });
  ui['start-cas'].addEventListener('click', () => selectStart('cas'), { signal });
  for (const id of ['cas-new-seed', 'cas-replay-new']) ui[id].addEventListener('click', generateCasScenario, { signal });
  for (const id of ['cas-mission', 'cas-seed']) ui[id].addEventListener('change', () => selectStart('cas'), { signal });
  ui['start-air'].addEventListener('click', () => selectStart('air'));
  ui['start-runway'].addEventListener('click', () => selectStart('runway'));
  ui['start-practice'].addEventListener('click', () => selectStart('practice'));
  ui['start-ground-range'].addEventListener('click', () => selectStart('groundRange'));
  for (const key of Object.keys(groundMissions)) ui[`start-${key}`].addEventListener('click', () => selectStart(key));
  const editor = new LoadoutEditor(ui, hangar, preview, modelStores, loadoutBook, () => selectStart(startingPosition), signal);
  ui['open-loadouts'].addEventListener('click', () => editor.open(flight.spec), { signal });
  ui['aircraft-loadouts'].addEventListener('click', () => {
    ui['aircraft-dialog'].close();
    editor.open(flight.spec);
  }, { signal });
  ui['start-dogfight'].addEventListener('click', () => selectStart('dogfight'));
  ui['start-short'].addEventListener('click', () => selectStart('short'));
  ui['start-intercept'].addEventListener('click', () => selectStart('intercept'));
  ui['start-outnumbered'].addEventListener('click', () => selectStart('outnumbered'));
  ui['test-protect'].addEventListener('change', () => {
    if (startingPosition === 'air' || startingPosition === 'runway') flight.protectedAirframe = ui['test-protect'].checked;
  }, { signal });
  ui['combat-difficulty'].addEventListener('change', () => selectStart(startingPosition));
  ui['opponent-mode'].addEventListener('change', () => selectStart('dogfight'));
  ui.launch.addEventListener('click', () => { view.snap = true; requestFlight(); });
  ui.resume.addEventListener('click', requestFlight);
  ui.restart.addEventListener('click', restartFlight);
  ui['keyboard-flight'].addEventListener('click', () => {
    keyboardFlight = true;
    audio.unlock();
    capture.release();
    changeScreen('flying');
  });
  ui.viewport.addEventListener('mousedown', (event) => {
    if (event.button === 0 && (screen === 'ready' || screen === 'paused')) requestFlight();
  }, { signal });
  ui.return.addEventListener('click', () => selectStart(startingPosition));
  ui['open-settings'].addEventListener('click', openSettings);
  ui['close-settings'].addEventListener('click', () => ui.settings.close());
  ui.settings.addEventListener('close', () => {
    rebinding = undefined;
    text('rebind-message', 'Select a binding to change it.');
    renderBindings();
  });

  for (const [id, property] of Object.entries({ preset: 'preset', 'control-mode': 'controlMode', invert: 'invert',
    'mouse-sensitivity': 'mouseSensitivity', 'camera-sensitivity': 'cameraSensitivity',
    'aim-responsiveness': 'aimResponsiveness', 'camera-smoothing': 'cameraSmoothing',
    'camera-turn-response': 'cameraTurnResponse' })) {
    const field = ui[id];
    if (field.type === 'checkbox') field.checked = settings[property];
    else field.value = settings[property];
    field.addEventListener('input', () => {
      settings[property] = field.type === 'range' ? field.valueAsNumber : field.type === 'checkbox' ? field.checked : field.value;
      updateSettings();
      if (property === 'preset') applyPreset();
    });
  }
  ui['reset-keys'].addEventListener('click', () => {
    settings.keys = { ...keyDefaults };
    rebinding = undefined;
    text('rebind-message', 'Default bindings restored.');
    renderBindings();
    updateSettings();
  });

  window.addEventListener('keydown', (event) => {
    const { code } = event;
    if (event.metaKey || event.isComposing || ui['aircraft-dialog'].open || ui['loadout-dialog'].open) return;
    if (ui.settings.open) {
      if (!rebinding) return;
      event.preventDefault();
      if (code !== 'Escape' && !canBind(code)) return;
      if (code !== 'Escape') {
        const conflict = Object.keys(settings.keys).find((action) => settings.keys[action] === code);
        if (conflict) settings.keys[conflict] = settings.keys[rebinding];
        settings.keys[rebinding] = code;
        updateSettings();
      }
      rebinding = undefined;
      text('rebind-message', 'Select a binding to change it.');
      renderBindings();
      return;
    }
    if (ui['cas-map-dialog'].open) return;
    if (code === 'Escape' && (screen === 'flying' || capture.pending)) {
      event.preventDefault();
      pauseFlight('Mouse capture released. Resume to capture it again.');
      return;
    }
    if (code === 'Enter' && !event.target.closest?.('button, select') && (screen === 'ready' || screen === 'paused')) {
      event.preventDefault();
      if (!event.repeat) requestFlight();
      return;
    }
    const key = Object.keys(settings.keys).find((action) => settings.keys[action] === code);
    if (!key || key === 'tacticalMap' && !battle.director) return;
    if (screen === 'paused' || screen === 'failed' || screen === 'complete') {
      if (!event.repeat && key === 'restart') {
        event.preventDefault();
        restartFlight();
      }
      return;
    }
    if (screen !== 'flying') return;
    event.preventDefault();
    if (key === 'fireSelected') {
      if (!event.repeat && canFire()) trigger.setKey(true);
      return;
    }
    controls.held.add(code);
    if (!event.repeat) {
      actions[key]?.();
      updateHud();
    }
  }, { signal });
  window.addEventListener('keyup', (event) => {
    if (event.code === settings.keys.fireSelected) trigger.setKey(false);
  }, { signal });

  const deckSize = new ResizeObserver(([entry]) => {
    deckHeight = entry.borderBoxSize[0].blockSize;
    document.body.style.setProperty('--deck-height', `${deckHeight}px`);
  });
  deckSize.observe(ui['flight-deck']);
  signal.addEventListener('abort', () => deckSize.disconnect(), { once: true });
  window.addEventListener('resize', resize, { signal });
  window.addEventListener('blur', () => pauseFlight('Window lost focus. Resume when you’re ready.'), { signal });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pauseFlight('Flight paused while this tab was hidden.');
  }, { signal });
  window.addEventListener('pagehide', (event) => {
    pauseFlight('Resume flight to recapture the mouse.');
    if (!event.persisted) lifecycle.abort();
  }, { signal });

  function updateHud() {
    const degrees = (value) => String((Math.round(value) + 360) % 360).padStart(3, '0');
    const vertical = Math.round(flight.verticalSpeed);
    const elapsed = Math.floor(flight.elapsed);
    const testOverlay = screen === 'flying' && (startingPosition === 'air' || startingPosition === 'runway') && ui['test-overlay-toggle'].checked;
    ui['test-overlay'].hidden = !testOverlay;
    if (testOverlay) {
      text('test-mass', Math.round(flight.mass).toLocaleString('en-US'));
      text('test-turn', flight.turnRate.toFixed(1));
      text('test-alpha', T.MathUtils.radToDeg(flight.alpha).toFixed(1));
      const { forward, up, localVelocity } = flight;
      const bank = Math.atan2((-forward.z * up.x + forward.x * up.z) / Math.max(.0001, Math.hypot(forward.x, forward.z)), up.y);
      text('test-bank', T.MathUtils.radToDeg(bank).toFixed(1));
      text('test-slip', T.MathUtils.radToDeg(Math.atan2(localVelocity.x, Math.max(1, localVelocity.z))).toFixed(1));
      text('test-fuel', Math.round(flight.totalFuel).toLocaleString('en-US'));
      text('test-thrust', (flight.thrust / 1000).toFixed(1));
      for (const [index, engine] of flight.engines.states.entries()) {
        text('test-engine-' + index, engine.power === 0 ? 'OFF' : `${Math.round(engine.spool * 100)}% · ${(engine.thrust / 1000).toFixed(1)} kN`);
      }
    }
    const gearMoving = flight.gear > 0.01 && flight.gear < 0.99;
    text('heading', degrees(flight.heading));
    text('heading-before', degrees(flight.heading - 15));
    text('heading-after', degrees(flight.heading + 15));
    text('airspeed', Math.round(flight.airspeed));
    text('mach', flight.mach.toFixed(2));
    text('throttle', Math.round(flight.throttle * 100));
    const operating = flight.engines.states.reduce((count, engine) => count + Number(engine.power > 0), 0);
    ui['test-engine-2-row'].hidden = flight.engines.states.length < 2;
    text('engine-count', flight.engines.states.length > 1 ? `${operating} / ${flight.engines.states.length} ENGINES` : '');
    text('engine-state', flight.damage.enginePower === 0 ? 'ENGINE OUT'
      : flight.afterburner ? 'AFTERBURNER' : flight.burnerArmed ? 'ENGINE SPOOLING' : flight.spool > 0.97 ? 'MIL POWER' : 'DRY THRUST');
    text('altitude', Math.round(flight.altitude).toLocaleString('en-US'));
    text('vertical-speed', vertical > 0 ? `+${vertical}` : vertical);
    text('fuel', Math.round(flight.totalFuel / (flight.spec.fuelCapacity + flight.externalCapacity) * 100));
    ui['fuel-external'].hidden = !flight.externalCapacity;
    if (flight.externalCapacity) text('fuel-external', `${Math.floor(flight.externalFuel)} KG EXT`);
    text('g-force', flight.g.toFixed(1));
    text('gear-state', gearMoving ? 'In transit' : flight.gear > 0.98 ? 'Down' : 'Up');
    text('burner-state', flight.afterburner ? 'On' : flight.burnerArmed ? 'Spooling' : 'Off');
    text('stores-state', flight.stores ? 'On' : 'Off');
    text('brake-state', brake ? 'On' : 'Off');
    text('camera-state', view.mode === 'hud' ? 'HUD' : 'Chase');
    const cameraName = {
      'missile-chase': 'Missile chase', 'missile-track': 'Missile tracking', target: 'Target view',
    }[combatCamera.mode] ?? (view.mode === 'hud' ? 'HUD camera' : 'Chase camera');
    text('camera-name', cameraName);
    const cameraStatus = screen === 'flying' && combatCamera.observing;
    ui['camera-status'].hidden = !cameraStatus;
    if (cameraStatus) text('camera-view-label', combatCamera.missile
      ? `${cameraName} · MISSILE ${combatCamera.serial}`
      : `${cameraName} · ${combatCamera.target?.spec.shortName} ${combatCamera.target === wingman.opponent ? '02' : '01'}`);
    text('elapsed', `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`);
    const warning = flight.stalled ? 'STALL' : flight.stress > 0.28 ? 'STRUCTURAL LOAD'
      : flight.gWarning || (flight.totalFuel < 200 ? 'LOW FUEL' : '');
    text('flight-warning', warning);
    text('damage-warning', flight.damage.warning);
    ui['g-force'].parentElement.classList.toggle('g-warning', Boolean(flight.gWarning));
    pressed('toggle-burner', flight.burnerArmed);
    pressed('toggle-gear', flight.gearDown);
    pressed('toggle-stores', flight.stores);
    pressed('toggle-airbrake', brake);
    pressed('toggle-sight', sightActive);
    text('sight-enabled', sightActive ? 'On' : 'Off');
    text('sight-selected', sightMode === 'impact' ? 'CCIP' : 'Lead');
    ui['toggle-gear'].disabled = flight.grounded;
  }

  function updateWeaponHud() {
    const weapon = selectedWeapon();
    const rack = combat.player.rack;
    const firing = screen === 'flying' && trigger.held && cannon.ammo > 0;
    const guns = weapon === 'cannon';
    const ammo = guns ? cannon.ammo : rack.count(weapon);
    const state = guidedWeapon(weapon) ? ordnance.guidance.status(weapon, rack, pod) : guns ? (ammo === 0 ? 'AMMO EMPTY' : firing ? 'FIRING' : 'READY') : rack.launchState(weapon, flight.elapsed);
    text('cannon-label', guns ? `${flight.spec.cannon.name} · ${flight.spec.cannon.caliber} MM` : weapons[weapon].label);
    text('cannon-ammo', ammo);
    text('cannon-unit', guns ? 'RDS' : groundWeapon(weapon) ? (weapon === 'bomb' ? 'BMB' : 'RKT') : guidedWeapon(weapon) && weapon !== 'optical' ? 'BMB' : 'MSL');
    ui['ground-status'].hidden = screen !== 'flying' || (!groundSortie() && (!activeLoadout
      || combat.enabled || !activeLoadout.stations.some(({ type }) => groundWeapon(type) || type === 'tank')));
    ui['ground-rearm-hint'].hidden = !ground.enabled;
    ui['battle-intel'].hidden = !battle.enabled;
    if (!ui['ground-status'].hidden) {
      text('ground-range-caption', battle.enabled ? battle.mission.objective.label.toUpperCase()
        : ground.enabled ? 'GROUND RANGE' : 'EXTERNAL STORES');
      text('ground-remaining', ground.enabled ? `${ground.remaining} / ${ground.targets.length} TARGETS ACTIVE` : '');
      if (battle.enabled) {
        const seconds = Math.max(0, Math.ceil(battle.mission.timeLimit - battle.time));
        const objective = battle.director ? (battle.director.progress ?? battle.mission.primary).toUpperCase()
          : battle.key === 'convoy' ? `${battle.convoyStopped} / ${battle.transports.length} TRANSPORTS STOPPED`
          : `CONTROL · FRIENDLY ${Math.min(100, Math.floor(battle.controls.friendly / .26))}% · HOSTILE ${Math.min(100, Math.floor(battle.controls.opposing / .26))}%`;
        text('battle-objective', `${objective} · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`);
        text('battle-losses', `LOSSES · FRIENDLY ${battle.losses.friendly} · HOSTILE ${battle.losses.opposing}`);
        text('ground-identification', groundObserver.track ? '' : 'NO VISUAL CONTACT');
      }
      const rangeStatus = battle.enabled ? battle : ground;
      const notice = flight.elapsed < rack.noticeUntil ? rack.notice : rangeStatus.time < rangeStatus.noticeUntil ? rangeStatus.notice : '';
      text('ground-feedback', notice);
      text('external-fuel', flight.externalCapacity ? `${Math.floor(flight.externalFuel)} KG EXTERNAL FUEL` : '');
    }
    casUI?.radio(screen === 'flying' ? battle.director : null, text);
    text('cannon-state', state);
    ui['hit-confirmation'].hidden = screen !== 'flying' || flight.elapsed >= hitFeedbackUntil;
    ui['cannon-state'].classList.toggle('weapon-active', state === 'FIRING' || state === 'CLEARED' || ammo === 0);
    ui['range-status'].hidden = !practice.enabled;
    if (practice.enabled) {
      text('targets-remaining', practice.remaining);
      text('target-feedback', flight.elapsed < practice.noticeUntil ? practice.notice : '');
    }
    ui['dogfight-status'].hidden = !dogfight.enabled || combat.enabled;
    if (dogfight.enabled && !combat.enabled) {
      text('opponent-status', dogfight.pilot.status);
      const contact = knownContacts.current;
      text('opponent-distance', contact ? (contact.range / 1000).toFixed(2) : '—');
      text('opponent-integrity', contact?.label === 'VISUAL' ? dogfight.opponentHull.percentage : '—');
      text('player-integrity', dogfight.playerHull.percentage);
      text('combat-feedback', flight.elapsed < dogfight.noticeUntil ? dogfight.notice : '');
    }
    if (combat.enabled && screen === 'flying' && state === 'CLEARED' && !lastClearance) audio.cue('acquire');
    lastClearance = screen === 'flying' && state === 'CLEARED';
  }

  function updatePodHud(inPod) {
    const weapon = selectedWeapon();
    const flying = screen === 'flying';
    ui['strike-stores'].hidden = !flying || !pod.mounted && !defenses.enabled && !guidedWeapon(weapon);
    ui['pod-toggle-hint'].hidden = !pod.mounted;
    ui['surface-fire'].hidden = !defenses.enabled;
    const live = guidedWeapon(weapon) && ordnance.rounds.find((round) => round.active && round.kind === weapon);
    const release = live ? live.validGuide ? 'GUIDING' : 'GUIDANCE LOST · COAST'
      : guidedWeapon(weapon) ? ordnance.guidance.status(weapon, combat.player.rack, pod) : '';
    const aaa = defenses.enabled && flight.elapsed < defenses.gunActiveUntil ? 'AAA FIRE' : '';
    text('strike-readiness', [release, aaa].filter(Boolean).join(' · '));
    ui['pod-view'].hidden = !inPod;
    document.body.dataset.sensor = inPod ? 'pod' : 'flight';
    if (!inPod) return;
    ui['pod-view'].dataset.mode = pod.modeName;
    ui['pod-view'].dataset.track = pod.state;
    text('pod-mode', pod.modeName.toUpperCase());
    text('pod-zoom', ['WIDE', 'MEDIUM', 'NARROW'][pod.zoom]);
    text('pod-track', pod.state);
    const unit = pod.track ?? pod.observed;
    const side = unit?.faction === 'opposing' ? 'HOSTILE' : unit?.faction.toUpperCase();
    text('pod-target', unit ? `${side} ${unit.classification.toUpperCase()} · ${Math.round(pod.origin.distanceTo(unit.position))} M` : '');
    text('pod-designation', pod.lasing ? 'LASER ON' : pod.laserArmed ? 'LASER MASKED' : pod.hasCoordinates
      ? `FIX ${Math.round(pod.coordinates.x)}, ${Math.round(pod.coordinates.z)}` : '');
  }

  function updateCombatHud() {
    const enabled = (combat.enabled || defenses.enabled) && screen === 'flying';
    ui['combat-avionics'].hidden = !enabled;
    ui['combat-shortcuts'].hidden = !combat.enabled || !enabled;
    if (!enabled) return;
    const { radar, warning, rack } = combat.player;
    const time = flight.elapsed;
    ui['radar-panel'].hidden = !combat.enabled || !scopeVisible;
    if (combat.enabled && scopeVisible && radar.revision !== radarRevision) {
      radarRevision = radar.revision;
      drawRadar(ui['radar-scope'], radar);
      text('radar-mode', radar.mode);
      text('radar-range', (radar.range / 1000).toFixed(1));
      text('radar-contacts', `${radar.contacts.size} ${radar.contacts.size === 1 ? 'CONTACT' : 'CONTACTS'}`);
      const contact = radar.contacts.get(radar.selected);
      text('radar-track', contact ? `${radar.locked ? 'LOCK' : 'SEL'} ${(contact.range / 1000).toFixed(1)} KM` : '—');
      text('radar-closure', radar.locked && contact ? `CLOSURE ${contact.closure} M/S` : '');
    }
    text('remaining-flare', rack.flare);
    text('remaining-chaff', rack.chaff);
    text('rwr-contact', warning.state || 'CLEAR');
    ui['rwr-panel'].dataset.threat = warning.state;
    ui['rwr-arrow'].hidden = !warning.state;
    if (warning.state) ui['rwr-arrow'].style.setProperty('--bearing', `${warning.bearing}rad`);
    const degrees = Math.round(T.MathUtils.radToDeg(warning.bearing) / 15) * 15;
    text('rwr-bearing', warning.state ? `${String((degrees + 360) % 360).padStart(3, '0')}° REL` : '');
    if (warning.state === 'SEARCH' && warning.state !== lastWarning) audio.cue('search');
    if ((warning.state !== lastWarning || time >= warningCueAt) && ['TRACK', 'ACTIVE SEEKER'].includes(warning.state)) {
      audio.cue(warning.state === 'TRACK' ? 'track' : 'threat');
      warningCueAt = time + (warning.state === 'TRACK' ? 2.6 : 0.68);
    }
    lastWarning = warning.state;
    const active = combat.missiles.pool.find((missile) => missile.active && missile.owner === flight);
    const phase = active?.phase;
    text('missile-telemetry', phase === 'MIDCOURSE' ? (radar.track ? 'MIDCOURSE · LINK' : 'MIDCOURSE · COAST')
      : phase === 'ACTIVE' ? (active.seeking ? 'SEEKER ACTIVE' : 'SEEKER SEARCHING')
      : phase === 'INFRARED' ? 'IR MISSILE IN FLIGHT' : '');
    const latest = wingman.noticeUntil > dogfight.noticeUntil ? wingman : dogfight;
    const notice = time < rack.noticeUntil ? rack.notice : time < latest.noticeUntil ? latest.notice : '';
    text('launch-feedback', notice);
  }

  function renderFlightMarkers() {
    const width = viewportWidth;
    const height = viewportHeight;
    flightDirection.set(0, 0, 1).applyQuaternion(visual.muzzle.quaternion).applyQuaternion(aircraft.quaternion);
    directionMarker.copy(visual.muzzle.position).applyQuaternion(aircraft.quaternion).add(aircraft.position)
      .addScaledVector(flightDirection, 1800).project(view.camera);
    const x = (directionMarker.x + 1) * width * 0.5;
    const y = (1 - directionMarker.y) * height * 0.5;
    const canSee = !pod.active && Math.abs(directionMarker.z) < 1 && x >= 22 && x <= width - 22 && y >= 80 && y <= height - 72;
    const weapon = selectedWeapon();
    const transform = `translate(${x}px,${y}px) translate(-50%,-50%)`;
    ui.boresight.hidden = !canSee || weapon !== 'cannon' || combatCamera.observing;
    ui.boresight.style.transform = transform;
    const seeker = ui['seeker-marker'];
    seeker.hidden = !canSee || weapon === 'cannon' || groundWeapon(weapon) || combatCamera.observing;
    if (!seeker.hidden) {
      seeker.style.transform = transform;
      seeker.dataset.ready = String(combat.player.rack.launchState(weapon, flight.elapsed) === 'CLEARED');
    }
    if (!keyboardFlight && settings.controlMode === 'assist' && !controls.looking && !combatCamera.observing) renderAimMarker(width, height);
    ui['g-effect'].classList.toggle('red', flight.redout > flight.blackout);
    ui['g-effect'].style.opacity = Math.max(flight.blackout, flight.redout);
    const looking = String(controls.looking || combatCamera.observing);
    if (document.body.dataset.looking !== looking) document.body.dataset.looking = looking;
  }

  function renderOpponents(blend, time, dt) {
    for (const [index, { fight, visual: model, airframe }] of opponents.entries()) {
      if (fight.enabled && airframe.render(dt)) continue;
      const { opponent } = fight;
      const { root } = model;
      root.visible = fight.enabled && !fight.opponentHull.incapacitated;
      if (!root.visible) continue;
      root.position.copy(opponent.previousPosition).lerp(opponent.position, blend);
      root.quaternion.copy(opponent.previousOrientation).slerp(opponent.orientation, blend);
      const distant = root.position.distanceToSquared(listener.position) > 1150 ** 2;
      model.setDistant(distant);
      if (!distant) {
        model.update(opponent, time, blend);
        if (opponent.customStores) enemyStores[index].update(opponent);
      } else enemyStores[index].root.visible = false;
    }
  }

  function renderContact(contact, camera) {
    const marker = ui['opponent-marker'];
    marker.hidden = !contact || screen !== 'flying' || Boolean(combatCamera.missile);
    if (marker.hidden) return;
    marker.dataset.track = contact.label;
    marker.style.opacity = T.MathUtils.lerp(0.24, 1, T.MathUtils.smoothstep(contact.freshness, 0, 0.55));
    const distance = (contact.range / 1000).toFixed(1);
    const id = contact.target === wingman.opponent ? '02' : '01';
    text('contact-label', `${contact.target.spec.shortName} ${id} · ${distance} KM · ${contact.label}`);
    contactMarker.update(marker, contact.position, camera, viewportWidth, viewportHeight);
  }

  function renderGroundContact(camera) {
    const marker = ui['ground-contact-marker'];
    const designation = ui['cas-designation'];
    const director = battle.director;
    const assigned = screen === 'flying' && !pod.active ? director?.designation(battle) : null;
    designation.hidden = !assigned;
    if (assigned) {
      text('cas-designation-label', `${assigned.label.toUpperCase()}${assigned.approximate ? ' · REPORTED AREA' : ''}`);
      contactMarker.update(designation, assigned.position, camera, viewportWidth, viewportHeight);
    }
    const contact = battle.enabled && screen === 'flying' && !pod.active ? groundObserver.track : null;
    marker.hidden = !contact;
    if (!contact) return;
    marker.dataset.faction = contact.unit.faction;
    marker.dataset.contact = contact.unit.id;
    const transport = contact.unit.objective === 'deliver' ? ' · OBJECTIVE' : '';
    const seen = battle.time - contact.time > .30 ? ' · LAST SEEN' : '';
    const identity = contact.unit.faction === 'opposing' ? 'HOSTILE' : contact.unit.faction.toUpperCase();
    text('ground-contact-label', `${identity} ${contact.unit.classification.toUpperCase()} · ${contact.distance} M${transport}${seen}`);
    contactMarker.update(marker, contact.position, camera, viewportWidth, viewportHeight);
    const { x, y } = contactMarker;
    const labelInset = Math.min(232, Math.max(144, viewportWidth * .22)) * .5 + 8;
    const center = T.MathUtils.clamp(x, labelInset, viewportWidth - labelInset);
    marker.style.setProperty('--ground-label-offset', `${center - x}px`);
    marker.dataset.above = String(y + 66 > viewportHeight - deckHeight);
  }

  function updateBattleDebug() {
    ui['battle-debug'].hidden = !debug || !battle.enabled || screen !== 'flying';
    if (ui['battle-debug'].hidden) return;
    const director = battle.director;
    const status = director ? `Seed ${director.plan.seed} · ${director.phase} · ${director.primary.state}/${director.secondary.state} · relief ${director.reinforcement}
${battle.targets.filter((unit) => unit.active && unit.faction === 'friendly').length} friendly · ${battle.targets.filter((unit) => unit.active && unit.faction === 'opposing').length} hostile · ${battle.weapons.count} active rounds · ${director.requests.filter((item) => item.state === 'active').length} calls · ${director.contacts.size} known contacts
` : '';
    text('battle-debug', status + battle.targets.map((unit) => {
      const route = unit.route[unit.drive.waypoint];
      const location = route ? `${unit.drive.waypoint + 1}/${unit.route.length} (${route.join(', ')})` : 'done';
      const health = Object.entries(unit.health.health).map(([part, condition]) => `${part} ${Math.round(condition * 100)}%`).join(' ');
      return `${unit.id} ${unit.type} ${unit.phase} ${unit.objective} ${Math.round(unit.speed * 3.6)} km/h · waypoint ${location}
  ${unit.track?.id ?? 'no contact'} · LOS ${Boolean(unit.lineOfSight)} · sensor ${unit.spec.detection}m · ${health}`;
    }).join('\n'));
  }

  function invalidateSight() {
    opticalTarget = null;
    visualTrack.reset();
    gunComputer.valid = false;
    groundSolution = false;
    nextSight = 0;
  }

  function trackVisible(point) {
    sightProjection.copy(point).project(view.camera);
    return Math.abs(sightProjection.x) <= 0.92 && Math.abs(sightProjection.y) <= 0.80
      && Math.abs(sightProjection.z) < 1;
  }

  function acquireTrack() {
    const radarTrack = combat.enabled && combat.player.radar.track;
    if (radarTrack && flight.elapsed - radarTrack.time < 0.42) return radarTrack;
    const origin = flight.position;
    sightForward.set(0, 0, 1).applyQuaternion(visual.muzzle.quaternion).applyQuaternion(flight.orientation);
    if (practice.enabled) {
      let best = 0.95;
      let nearest = null;
      for (const target of practice.targets) {
        if (!target.active || !trackVisible(target.position)) continue;
        const alignment = sightBearing.subVectors(target.position, origin).normalize().dot(sightForward);
        if (alignment > best) {
          nearest = target;
          best = alignment;
        }
      }
      if (!nearest) return null;
      droneTrack.position = nearest.position;
      droneTrack.velocity.subVectors(nearest.position, nearest.previous).multiplyScalar(1 / STEP);
      return droneTrack;
    }
    const target = knownContacts.current?.label === 'VISUAL' ? knownContacts.current.target : null;
    if (opticalTarget !== target) visualTrack.reset();
    opticalTarget = target;
    if (!target || !trackVisible(target.position)) {
      visualTrack.reset();
      return null;
    }
    const contact = target.position;
    sightBearing.subVectors(contact, origin);
    const distance = sightBearing.length();
    sightBearing.multiplyScalar(1 / Math.max(1, distance));
    if (distance < 25 || distance > 1500 || sightBearing.dot(sightForward) < 0.95) {
      visualTrack.reset();
      return null;
    }
    for (let at = 100; at < distance; at += 100) {
      if (origin.y + sightBearing.y * at > range.heightAt(origin.x + sightBearing.x * at, origin.z + sightBearing.z * at)) continue;
      visualTrack.reset();
      return null;
    }
    const span = target.spec.opticalSpan;
    const aspect = Math.abs(target.forward.dot(sightBearing));
    const apparentSize = span * (0.92 + aspect * 0.08) / (2 * distance);
    return visualTrack.observe(flight.elapsed, origin, sightBearing, apparentSize, span);
  }

  function renderSight() {
    const weapon = selectedWeapon();
    const usingGroundWeapon = groundWeapon(weapon);
    const enabled = !pod.active && sightActive && screen === 'flying' && (weapon === 'cannon' || usingGroundWeapon);
    ui['sight-readout'].hidden = !enabled;
    const marker = ui['sight-marker'];
    if (!enabled) {
      marker.hidden = true;
      return;
    }
    if (flight.elapsed >= nextSight) {
      nextSight = flight.elapsed + (usingGroundWeapon ? 0.15 : sightInterval);
      if (usingGroundWeapon) {
        const station = combat.player.rack.station(weapon);
        groundSolution = ordnance.predict(weapon, flight, station, ground.enabled ? groundColliders : range.structures, groundPoint);
      } else if (sightMode === 'impact') gunComputer.impact(flight);
      else gunComputer.lead(flight, acquireTrack());
    }
    const valid = usingGroundWeapon ? groundSolution : gunComputer.valid;
    const visible = !combatCamera.observing && valid && trackVisible(usingGroundWeapon ? groundPoint : gunComputer.point);
    marker.hidden = !visible;
    if (visible) {
      const x = (sightProjection.x + 1) * viewportWidth * 0.5;
      const y = (1 - sightProjection.y) * viewportHeight * 0.5;
      marker.dataset.mode = usingGroundWeapon ? 'impact' : sightMode;
      marker.style.transform = `translate(${x}px,${y}px) translate(-50%,-50%)`;
    }
    text('sight-mode', usingGroundWeapon ? `${weapon.toUpperCase()} CCIP` : sightMode === 'impact' ? 'CCIP' : practice.enabled ? 'TRAINING LEAD'
      : combat.enabled && combat.player.radar.track ? 'RADAR LEAD' : 'VISUAL LEAD');
    text('sight-state', valid ? `${visible ? 'VALID' : 'OFFSCREEN'} · ${Math.round(usingGroundWeapon ? flight.position.distanceTo(groundPoint) : gunComputer.range)} M`
      : sightMode === 'impact' ? 'NO IMPACT' : 'NO SOLUTION');
  }

  function finishDogfight(result) {
    const won = result === 'win';
    const draw = result === 'draw';
    const label = combat.enabled ? 'Mission' : 'Dogfight';
    text('pause-title', draw ? 'Mutual loss' : won ? `${label} won` : `${label} lost`);
    text('pause-description', draw ? 'Your aircraft and all opponents were lost.'
      : won ? (combat.enabled ? 'All opponents were defeated.' : `Opponent lost · ${dogfight.opponent.failure}`)
      : flight.failure || 'Your airframe took critical damage.');
    const components = Object.values(flight.damage.health);
    const damaged = components.filter((health) => health < 1).length;
    text('result-enemies', `${combat.enabled ? combat.enemiesDown : Number(dogfight.opponentHull.incapacitated)} / ${combat.enemies.length}`);
    text('result-guns', `${cannon.fired} fired · ${combat.cannonHits} hits`);
    text('result-missiles', `${combat.missilesLaunched} launched · ${combat.missileHits} hits`);
    text('result-damage', `${damaged} of ${components.length} components`);
    const elapsed = Math.floor(flight.elapsed);
    text('result-time', `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`);
    changeScreen('complete');
  }

  function finishBattle() {
    const { label } = battle.mission;
    const title = battle.outcome === 'win' ? 'complete' : battle.outcome === 'draw' ? 'drawn' : 'ended';
    showGroundResult(`${label} ${title}`, battle.reason, `${battle.hitCount} hit · ${battle.playerDisabled.size} stopped · ${battle.destroyed} destroyed by you`);
    text('result-ground-forces', `${battle.losses.friendly} friendly · ${battle.losses.opposing} hostile destroyed`);
    const director = battle.director;
    text('result-friendly-fire', director ? `${director.incidents.size} friendly vehicles hit · ${battle.friendlyFire} damaging impacts` : `${battle.friendlyFire} damaging hits`);
    if (director) {
      const objectives = [director.primary, director.secondary].map(({ state }) => state).join(' / ');
      text('result-cas-objectives', `Primary / secondary · ${objectives} · Seed ${director.plan.seed}`);
      const supported = director.requests.filter((item) => item.accepted && item.state === 'completed').length;
      text('result-cas-support', `${supported} accepted and completed · ${director.requests.length} issued`);
      const parts = Object.values(flight.damage.health);
      text('result-damage', `${parts.filter((health) => health < 1).length} of ${parts.length} components damaged`);
    }
  }

  function finishGroundRange(complete) {
    showGroundResult(complete ? 'Ground range complete' : 'Ground range ended',
      complete ? 'All marked ground targets have been disabled.' : flight.failure,
      `${ground.hitCount} hit · ${ground.destroyed} of ${ground.targets.length} disabled`);
  }

  function showGroundResult(title, reason, targets) {
    text('pause-title', title);
    text('pause-description', reason);
    text('result-guns', `${cannon.fired} fired`);
    text('result-precision', `${ordnance.precisionReleased} released · ${ordnance.precisionImpacts} direct hits`);
    text('result-bombs', ordnance.bombs);
    text('result-rockets', ordnance.rockets);
    text('result-targets', targets);
    const elapsed = Math.floor(flight.elapsed);
    text('result-time', `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`);
    changeScreen('complete');
  }

  function renderAimMarker(width, height) {
    aimDirection.copy(controls.aim.direction).transformDirection(view.camera.matrixWorldInverse);
    const projection = view.camera.projectionMatrix.elements;
    const behind = aimDirection.z >= 0;
    const depth = Math.max(0.001, -aimDirection.z);
    let x = aimDirection.x * projection[0] * width * 0.5 / depth;
    const y = -aimDirection.y * projection[5] * height * 0.5 / depth;
    // The marker is presentation only. Compress its displacement into the
    // center of the view without shrinking or clamping the actual aim ray.
    const horizontalLimit = Math.max(20, width * 0.23);
    const verticalLimit = Math.max(20, height * 0.22);
    if (behind && Math.abs(x) + Math.abs(y) < 0.01) x = Math.sign(aimDirection.x || 1);
    const length = Math.hypot(x / horizontalLimit, y / verticalLimit);
    const scale = behind ? 1 / Math.max(length, 0.001) : 1 / Math.hypot(1, length);
    const marker = ui['aim-cursor'];
    const limited = behind || length > 1.8;
    marker.classList.toggle('offscreen', limited);
    marker.style.transform = `translate(${width * 0.5 + x * scale}px,${height * 0.5 + y * scale}px) translate(-50%,-50%)`;
    if (limited) marker.style.setProperty('--aim-bearing', `${Math.atan2(y, x)}rad`);
  }

  function updateMetrics(frameSeconds) {
    frameCount++;
    frameWindow += frameSeconds;
    if (frameWindow < 0.75) return;
    const info = renderer.info.render;
    ui.metrics.hidden = false;
    text('metrics', `${(frameCount / frameWindow).toFixed(1)} FPS · ${(1000 * frameWindow / frameCount).toFixed(1)} ms · ${info.calls} draws · ${info.triangles.toLocaleString()} triangles · AOA ${T.MathUtils.radToDeg(flight.alpha).toFixed(1)}° · ${ballistics.count} rounds`);
    frameWindow = 0;
    frameCount = 0;
  }

  function frame(time) {
    if (stopped) return;
    requestAnimationFrame(frame);
    const realDt = (time - (previousFrame ?? time)) / 1000;
    const dt = Math.min(0.10, realDt);
    previousFrame = time;
    if (screen === 'map' || battle.director && !casBackdropDirty
      && (screen === 'ready' || screen === 'complete' && presentationAge > 1.1)) return;
    if (screen === 'flying') {
      const command = controls.sample(brake, !keyboardFlight && settings.controlMode === 'assist');
      // Allow slow frames to catch up while bounding work after a browser stall.
      accumulator += Math.min(0.50, realDt);
      while (accumulator >= STEP) {
        const tickStart = time / 1000 - accumulator;
        flight.step(command);
        accumulator -= STEP;
        if (ground.enabled) ground.time = flight.elapsed;
        if (battle.enabled) battle.step(STEP, flight.position);
        if (combat.enabled) {
          for (const side of combat.enemies) side.fight.update(side.adjust);
        } else if (dogfight.enabled) dogfight.update();
        else practice.step(flight.elapsed);
        if (flight.failure) {
          playerAirframe.step();
          if (battle.enabled) {
            battle.finish('loss', flight.failure);
            finishBattle();
            break;
          }
          if (ground.enabled) {
            finishGroundRange(false);
            break;
          }
          if (!dogfight.enabled) {
            text('pause-title', flight.failure);
            text('pause-description', 'Flight ended. Restart from the selected starting position.');
            changeScreen('failed');
            break;
          }
        }
        const firing = trigger.sample(tickStart, tickStart + STEP);
        const rack = combat.player.rack;
        if (combat.enabled) combat.step(STEP);
        else if (activeLoadout) rack.update(flight.elapsed, []);
        if (strikeWing) strikeWing.step(STEP, defenses);
        if (defenses.enabled) defenses.step(STEP, battle);
        if (combat.enabled || defenses.enabled) combatEffects.step(flight.elapsed);
        const sensor = podStation();
        if (pod.mounted || sensor) pod.update(flight, sensor, podTargets(), flight.elapsed);
        if (queuedLaunch) {
          if (guidedWeapon(queuedLaunch)) {
            rack.message(ordnance.releaseGuided(rack, queuedLaunch, pod), flight.elapsed);
          } else if (groundWeapon(queuedLaunch)) {
            const count = ordnance.release(rack, queuedLaunch, ui[queuedLaunch === 'bomb' ? 'bomb-mode' : 'rocket-mode'].value);
            const notice = count ? (queuedLaunch === 'bomb' ? 'BOMB AWAY' : 'ROCKET AWAY') : rack.releaseState(queuedLaunch);
            if (notice !== 'READY') rack.message(notice, flight.elapsed);
          } else if (combat.enabled) combat.launch(combat.player, combat.enemy, queuedLaunch);
          queuedLaunch = null;
        }
        if (activeLoadout && ordnance.active) ordnance.step(STEP, rack, battle.enabled ? battle.queryPlayer
          : ground.enabled ? groundColliders : range.structures);
        if (!flight.failure && selectedWeapon() === 'cannon') cannon.step(STEP, firing, flight);
        if (combat.enabled) {
          for (const side of combat.enemies) side.fight.fire(combat.canFireCannon(side));
        } else if (dogfight.enabled) dogfight.fire();
        const targets = battle.enabled ? battle.queryPlayer : ground.enabled ? groundColliders
          : combat.enabled ? combat.shotTargets : dogfight.enabled ? dogfight.playerTargets : colliders;
        if (ballistics.count) ballistics.step(STEP, targets);
        if (flight.elapsed >= nextDamageTrail) {
          nextDamageTrail = flight.elapsed + 0.075;
          weaponEffects.damageTrail(flight);
          if (battle.enabled) {
            let smoke = 0;
            const start = Math.floor(flight.elapsed * 11) % battle.targets.length;
            for (let offset = 0; offset < battle.targets.length && smoke < 3; offset++) {
              const unit = battle.targets[(start + offset) % battle.targets.length];
              const damaged = unit.active ? unit.health.condition('engine') < .62 : battle.time < unit.visibleUntil;
              if (!damaged || unit.arrived || unit.position.distanceToSquared(flight.position) > 1800 ** 2) continue;
              smokePoint.copy(unit.position).y += unit.spec.dimensions[1] * .8;
              weaponEffects.emit('engineSmoke', smokePoint, 2);
              smoke++;
            }
          }
          if (activeLoadout) for (const round of ordnance.rounds) {
            if (round.active && (round.kind === 'rocket' && round.age < 1 || round.kind === 'optical' && round.age < 3.2)) weaponEffects.emit('rocketSmoke', round.position, 2);
          }
          for (const { fight } of opponents) {
            if (fight.enabled && !fight.opponent.failure) weaponEffects.damageTrail(fight.opponent);
          }
        }
        trails.step(flight.elapsed, activeOpponents);
        playerAirframe.step();
        for (const { fight, airframe } of opponents) if (fight.enabled) airframe.step();
        const result = combat.enabled ? combat.finish() : dogfight.enabled && dogfight.finish();
        if (battle.outcome) {
          finishBattle();
          break;
        }
        if (ground.complete) {
          finishGroundRange(true);
          break;
        }
        if (result) {
          finishDogfight(result);
          break;
        }
      }
      if (cannon.ammo === 0) {
        audio.setFiring(false);
        if (ui['test-ammo'].checked && (startingPosition === 'air' || startingPosition === 'runway')) {
          cannon.ammo = cannon.config.capacity;
          if (flight.customStores) flight.ammunitionMass = cannon.ammo * cannonRoundMass;
        }
      }
    }
    const blend = screen === 'flying' ? accumulator / STEP : 1;
    if (!playerAirframe.failed) {
      aircraft.position.copy(flight.previousPosition).lerp(flight.position, blend);
      aircraft.quaternion.copy(flight.previousOrientation).slerp(flight.orientation, blend);
    }
    aircraft.renderMovement.copy(aircraft.position).sub(previousRenderPosition);
    previousRenderPosition.copy(aircraft.position);
    visual.update(flight, time / 1000, blend);
    if (activeLoadout) attachedStores.update(flight);
    aircraft.visible = !pod.active && (view.mode === 'chase' || screen === 'ready' || flight.failure);
    const aim = !keyboardFlight && settings.controlMode === 'assist' ? controls.aim : null;
    view.update(aircraft, flight.velocity, dt, screen, controls.looking, settings.cameraSmoothing, aim, settings.cameraTurnResponse);
    const contact = screen === 'flying' && dogfight.enabled
      ? knownContacts.update(flight, view.camera, combat.enabled ? combat.player.candidates : classicCandidates,
        combat.enabled ? combat.player.radar : null) : null;
    const observed = combatCamera.target ? knownContacts.forTarget(flight,
      combat.enabled ? combat.player.radar : null, combatCamera.target) : contact;
    const inPod = pod.active && screen === 'flying';
    if (renderedPod !== inPod) { renderedPod = inPod; resize(); }
    if (inPod) pod.present(dt);
    const camera = inPod ? pod.camera : combatCamera.update(view.camera, aircraft, observed, blend, dt);
    listener = camera;
    groundView?.update(camera);
    if (battle.enabled && screen === 'flying' && !inPod) {
      const scan = battle.time >= groundObserver.nextScan;
      groundObserver.scan(battle.time, flight.position, camera, battle.targets);
      if (scan && battle.director) for (const { unit, position, time } of groundObserver.contacts.values()) {
        battle.director.remember(unit, position, time, 'Visual');
      }
    }
    if (inPod && battle.director && lastPodObservation !== pod.nextScan) {
      lastPodObservation = pod.nextScan;
      const unit = pod.track ?? pod.observed;
      if (unit) battle.director.remember(unit, pod.track ? pod.area : unit.position, battle.time, 'Visual');
    }
    const thermal = inPod ? pod.mode : 0;
    world.setThermal(thermal);
    battlefieldView?.update(camera, blend, groundObserver, !inPod && ui['ground-assistance'].checked && screen === 'flying',
      thermal, defenses.enabled ? defenses.battery : null);
    renderGroundContact(camera);
    updatePodHud(inPod);
    releasedStores?.update(blend);
    if (strikeWing) {
      const ally = strikeWing.flight;
      strikeVisual.root.visible = !ally.failure && ally.position.distanceToSquared(camera.position) < 4600 ** 2;
      if (strikeVisual.root.visible) {
        strikeVisual.root.position.copy(ally.previousPosition).lerp(ally.position, blend);
        strikeVisual.root.quaternion.copy(ally.previousOrientation).slerp(ally.orientation, blend);
        strikeVisual.update(ally, ally.elapsed, blend);
      }
      strikeStores.update(blend);
    }
    const ended = screen === 'complete' || screen === 'failed';
    const moving = screen === 'flying' || ended;
    playerAirframe.render(moving ? dt : 0);
    renderOpponents(blend, time / 1000, moving ? dt : 0);
    sound.update(flight, camera, combatCamera.observing ? combatCamera.mode : view.mode, combat.missiles.pool, screen === 'flying');
    renderContact(contact, camera);
    combatEffects?.render(blend);
    renderSight();
    world.update(combatCamera.missile ? camera.position : aircraft.position, camera);
    const effectStep = Math.max(0, flight.elapsed - lastEffectsTime);
    lastEffectsTime = flight.elapsed;
    if (ended) presentationAge += dt;
    weaponEffects.render(flight.elapsed, ended ? dt : effectStep, blend, screen === 'flying', thermal);
    trails.render(flight.elapsed + presentationAge, camera);
    if (screen === 'flying') {
      renderFlightMarkers();
      updateWeaponHud();
    } else {
      ui['g-effect'].style.opacity = 0;
    }
    if (time - lastHudTime > 74) {
      updateHud();
      updateCombatHud();
      updateBattleDebug();
      lastHudTime = time;
    }
    renderer.render(scene, camera);
    casBackdropDirty = false;
    if (debug && realDt > 0) updateMetrics(realDt);
  }

  renderBindings();
  updateSettings();
  updateAircraftIdentity();
  initAircraftSelector();
  selectStart('air');
  applyPreset();
  requestAnimationFrame(frame);
}
