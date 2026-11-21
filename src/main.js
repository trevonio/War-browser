import * as T from 'three';
import { f16 } from './aircraft/f16.js';
import { createF16Visual, createOpponentVisual } from './aircraft/f16-visual.js';
import { CannonAudio } from './audio/cannon-audio.js';
import { canBind, Controls, keyDefaults, keyLabels, keyName, loadSettings, saveSettings } from './controls.js';
import { FlightPointerLock } from './pointer-lock.js';
import { opponentModes } from './sim/ai-pilot.js';
import { Ballistics } from './sim/ballistics.js';
import { Cannon } from './sim/cannon.js';
import { CombatExercise, combatExercises } from './sim/combat/exercise.js';
import { hasLineOfSight } from './sim/combat/radar.js';
import { weapons } from './sim/combat/weapons.js';
import { Dogfight } from './sim/dogfight.js';
import { Flight, STEP } from './sim/flight.js';
import { GunComputer, sightInterval, VisualTrack } from './sim/gun-computer.js';
import { PracticeRange } from './sim/practice.js';
import { range, scenarios } from './sim/range.js';
import { CannonTrigger } from './trigger.js';
import { CannonEffects } from './view/cannon-effects.js';
import { FlightCamera } from './view/camera.js';
import { CombatEffects, drawRadar } from './view/combat-view.js';
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
  short: 'MISSILE DOGFIGHT', intercept: 'BVR INTERCEPT',
};
const combatShortcuts = ['cycleWeapon', 'fireSelected', 'radarPower', 'radarTarget', 'radarLock',
  'radarMode', 'radarRange', 'radarScope', 'flares', 'chaff'];

requestAnimationFrame(() => {
  try {
    boot();
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

function boot() {
  const settings = loadSettings();
  const renderer = new T.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  ui.viewport.append(renderer.domElement);
  const scene = new T.Scene();
  const world = new WorldView(scene, renderer);
  const view = new FlightCamera(range);
  const flight = new Flight(f16, range);
  const visual = createF16Visual();
  const aircraft = visual.root;
  aircraft.renderMovement = new T.Vector3();
  scene.add(aircraft);
  const opponentVisual = createOpponentVisual(visual);
  const opponentAircraft = opponentVisual.root;
  opponentAircraft.visible = false;
  scene.add(opponentAircraft);
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
  }, view, signal);
  const practice = new PracticeRange();
  const colliders = [...range.structures, ...practice.targets];
  const audio = new CannonAudio(f16.cannon.rpm);
  const dogfight = new Dogfight(flight, f16, range, {
    shot: (position, direction, time, count) => weaponEffects.shot(1, position, direction, time, count),
    impact: (surface, point, time, destroyed, ownHit) => {
      weaponEffects.impact(surface, point, time, destroyed);
      if (ownHit) audio.impact();
    },
  });
  const ballistics = new Ballistics(f16.cannon, range, (surface, point, collider, impactSpeed) => {
    const destroyed = collider?.hull ? dogfight.hit(collider, f16.cannon.damage, impactSpeed / f16.cannon.projectileSpeed)
      : collider?.shape === 'sphere' && practice.hit(collider, f16.cannon.damage, flight.elapsed);
    weaponEffects.impact(surface, point, flight.elapsed, destroyed);
  });
  const weaponEffects = new CannonEffects(scene, [
    { muzzle: visual.muzzle, ballistics },
    { muzzle: opponentVisual.muzzle, ballistics: dogfight.ballistics },
  ], practice);
  const cannon = new Cannon(f16.cannon, visual.muzzle, ballistics, (position, direction, time, count) => {
    if (trigger.held) audio.setFiring(true);
    else audio.pulse();
    weaponEffects.shot(0, position, direction, time, count);
  });
  const combat = new CombatExercise(dogfight, range, {
    launch(own) { if (own) audio.cue('launch'); },
    burst(point, hit, own) {
      weaponEffects.emit('explosion', point, weaponEffects.budget > 100 ? 18 : 10);
      weaponEffects.emit('debris', point, hit ? 10 : 4);
      if (own) audio.impact();
    },
  });
  const selectedWeapon = () => combat.enabled ? combat.player.rack.selected : 'cannon';
  const canFire = () => screen === 'flying' && !ui.settings.open && (capture.locked || keyboardFlight);
  const gunComputer = new GunComputer(f16.cannon, visual.muzzle, range);
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
  signal.addEventListener('abort', () => audio.dispose(), { once: true });
  const previousRenderPosition = new T.Vector3();
  const directionMarker = new T.Vector3();
  const flightDirection = new T.Vector3();
  const aimDirection = new T.Vector3();
  const opponentMarker = new T.Vector3();
  const sightProjection = new T.Vector3();
  const sightBearing = new T.Vector3();
  const sightForward = new T.Vector3();
  let sightActive = false;
  let sightMode = 'impact';
  let nextSight = 0;
  let nextDamageTrail = 0;
  let combatEffects;
  let scopeVisible = true;
  let radarRevision = -1;
  let queuedLaunch = null;
  let lastWarning = '';
  let warningCueAt = 0;
  let lastClearance = false;
  let lastEffectsTime = 0;
  let screen = 'loading';
  let startingPosition = 'air';
  let brake = false;
  let rebinding;
  let keyboardFlight = false;
  let viewportWidth = 0;
  let viewportHeight = 0;
  let accumulator = 0;
  let previousFrame;
  let lastHudTime = -1;
  let frameCount = 0;
  let frameWindow = 0;
  let stopped = false;

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
    screen = next;
    document.body.dataset.screen = next;
    const flightLabel = flightLabels[startingPosition];
    text('phase', {
      ready: 'PREFLIGHT', flying: flightLabel, paused: 'PAUSED', failed: 'FLIGHT ENDED', complete: 'DOGFIGHT ENDED',
    }[next]);
    text('pause-mode', flightLabel);
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
      alignAim();
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
    if (stopped || ui.settings.open) return;
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

  function reset(next) {
    const start = scenarios[startingPosition];
    const exercise = combatExercises[startingPosition];
    flight.reset(start);
    cannon.reset();
    ballistics.clear();
    practice.reset(startingPosition === 'practice');
    dogfight.reset(exercise ? 'aggressive' : startingPosition === 'dogfight' ? ui['opponent-mode'].value : null,
      start, exercise?.opponent);
    combat.reset(exercise ? startingPosition : null, ui['combat-difficulty'].value);
    if (exercise && !combatEffects) combatEffects = new CombatEffects(scene, visual, opponentVisual, combat, weaponEffects);
    combatEffects?.reset();
    scopeVisible = true;
    radarRevision = -1;
    lastWarning = '';
    warningCueAt = 0;
    lastClearance = false;
    weaponEffects.clear();
    lastEffectsTime = 0;
    nextDamageTrail = 0;
    aircraft.position.copy(flight.position);
    aircraft.quaternion.copy(flight.orientation);
    previousRenderPosition.copy(flight.position);
    brake = false;
    view.mode = 'chase';
    view.azimuth = 0;
    view.elevation = 0;
    view.snap = true;
    invalidateSight();
    changeScreen(next);
  }

  function selectStart(next) {
    startingPosition = next;
    pressed('start-air', next === 'air');
    pressed('start-runway', next === 'runway');
    pressed('start-practice', next === 'practice');
    pressed('start-dogfight', next === 'dogfight');
    pressed('start-short', next === 'short');
    pressed('start-intercept', next === 'intercept');
    ui['opponent-choice'].hidden = next !== 'dogfight';
    ui['combat-choice'].hidden = !combatExercises[next];
    text('briefing-mode', flightLabels[next]);
    reset('ready');
    text('start-detail', next === 'runway' ? 'GROUND START · GEAR DOWN'
      : next === 'practice' ? `3 AERIAL DRONES · ${f16.cannon.capacity} ROUNDS`
      : next === 'dogfight' ? opponentModes[ui['opponent-mode'].value].briefing
      : combatExercises[next] ? combatExercises[next].description
      : `2,950 FT MSL · ${Math.round(flight.airspeed)} KTS`);
  }

  function resize() {
    const preset = presets[settings.preset];
    const width = viewportWidth = ui.viewport.clientWidth;
    const height = viewportHeight = ui.viewport.clientHeight;
    renderer.setPixelRatio(Math.min(devicePixelRatio, preset.pixels));
    renderer.setSize(width, height, false);
    view.camera.aspect = width / Math.max(1, height);
    view.camera.fov = view.camera.aspect < 0.82 ? 66 : 51;
    view.camera.updateProjectionMatrix();
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
    for (const action of combatShortcuts) text(`key-${action}`, keyName(settings.keys[action]));
    text('restart-key', keyName(settings.keys.restart));
    text('help-maneuver', ['pitchUp', 'rollLeft', 'pitchDown', 'rollRight'].map((key) => keyName(settings.keys[key])).join(' '));
    text('help-throttle', [keyName(settings.keys.throttleUp), keyName(settings.keys.throttleDown)].join(' / '));
  }

  function applyPreset() {
    world.setPreset(presets[settings.preset]);
    weaponEffects.setPreset(presets[settings.preset]);
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
    if (!combat.enabled) return;
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
    camera() { view.cycle(); },
    sight() { sightActive = !sightActive; invalidateSight(); },
    sightMode() { sightMode = sightMode === 'impact' ? 'lead' : 'impact'; invalidateSight(); },
    weaponCannon() { changeWeapon('cannon'); },
    weaponInfrared() { changeWeapon('infrared'); },
    weaponRadar() { changeWeapon('radar'); },
    cycleWeapon() { changeWeapon(); },
    radarPower() { if (combat.enabled) combat.player.radar.togglePower(); },
    radarTarget() { if (combat.enabled) combat.player.radar.selectNext(); },
    radarLock() {
      if (!combat.enabled) return;
      const { radar, rack } = combat.player;
      const wasLocked = radar.locked;
      if (!radar.toggleLock() && !wasLocked) rack.message('SELECT A RADAR CONTACT', flight.elapsed);
      invalidateSight();
    },
    radarMode() { if (combat.enabled) combat.player.radar.cycleMode(); },
    radarRange() { if (combat.enabled) combat.player.radar.cycleRange(); },
    radarScope() { if (combat.enabled) { scopeVisible = !scopeVisible; radarRevision = -1; } },
    flares() { if (combat.enabled) combat.player.rack.deploy('flare', flight.elapsed, combat.decoys); },
    chaff() { if (combat.enabled) combat.player.rack.deploy('chaff', flight.elapsed, combat.decoys); },
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
  ui['start-air'].addEventListener('click', () => selectStart('air'));
  ui['start-runway'].addEventListener('click', () => selectStart('runway'));
  ui['start-practice'].addEventListener('click', () => selectStart('practice'));
  ui['start-dogfight'].addEventListener('click', () => selectStart('dogfight'));
  ui['start-short'].addEventListener('click', () => selectStart('short'));
  ui['start-intercept'].addEventListener('click', () => selectStart('intercept'));
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
  ui.return.addEventListener('click', () => reset('ready'));
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
    if (event.metaKey || event.isComposing) return;
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
    if (!key) return;
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
    const gearMoving = flight.gear > 0.01 && flight.gear < 0.99;
    text('heading', degrees(flight.heading));
    text('heading-before', degrees(flight.heading - 15));
    text('heading-after', degrees(flight.heading + 15));
    text('airspeed', Math.round(flight.airspeed));
    text('mach', flight.mach.toFixed(2));
    text('throttle', Math.round(flight.throttle * 100));
    text('engine-state', flight.damage.enginePower === 0 ? 'ENGINE OUT'
      : flight.afterburner ? 'AFTERBURNER' : flight.burnerArmed ? 'ENGINE SPOOLING' : flight.spool > 0.97 ? 'MIL POWER' : 'DRY THRUST');
    text('altitude', Math.round(flight.altitude).toLocaleString('en-US'));
    text('vertical-speed', vertical > 0 ? `+${vertical}` : vertical);
    text('fuel', Math.round(flight.fuel / f16.fuelCapacity * 100));
    text('g-force', flight.g.toFixed(1));
    text('gear-state', gearMoving ? 'In transit' : flight.gear > 0.98 ? 'Down' : 'Up');
    text('burner-state', flight.afterburner ? 'On' : flight.burnerArmed ? 'Spooling' : 'Off');
    text('stores-state', flight.stores ? 'On' : 'Off');
    text('brake-state', brake ? 'On' : 'Off');
    text('camera-state', view.mode === 'hud' ? 'HUD' : 'Chase');
    text('camera-name', view.mode === 'hud' ? 'HUD camera' : 'Chase camera');
    text('elapsed', `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`);
    const warning = flight.stalled ? 'STALL' : flight.stress > 0.28 ? 'STRUCTURAL LOAD'
      : flight.gWarning || (flight.fuel < 200 ? 'LOW FUEL' : '');
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
    const state = guns ? (ammo === 0 ? 'AMMO EMPTY' : firing ? 'FIRING' : 'READY') : rack.launchState(weapon, flight.elapsed);
    text('cannon-label', weapons[weapon].label);
    text('cannon-ammo', ammo);
    text('cannon-unit', guns ? 'RDS' : 'MSL');
    text('cannon-state', state);
    ui['cannon-state'].classList.toggle('weapon-active', state === 'FIRING' || state === 'CLEARED' || ammo === 0);
    ui['range-status'].hidden = !practice.enabled;
    if (practice.enabled) {
      text('targets-remaining', practice.remaining);
      text('target-feedback', flight.elapsed < practice.noticeUntil ? practice.notice : '');
    }
    ui['dogfight-status'].hidden = !dogfight.enabled || combat.enabled;
    if (dogfight.enabled && !combat.enabled) {
      text('opponent-status', dogfight.pilot.status);
      text('opponent-distance', (dogfight.opponent.position.distanceTo(flight.position) / 1000).toFixed(2));
      text('opponent-integrity', dogfight.opponentHull.percentage);
      text('player-integrity', dogfight.playerHull.percentage);
      text('combat-feedback', flight.elapsed < dogfight.noticeUntil ? dogfight.notice : '');
    }
    if (combat.enabled && screen === 'flying' && state === 'CLEARED' && !lastClearance) audio.cue('acquire');
    lastClearance = screen === 'flying' && state === 'CLEARED';
  }

  function updateCombatHud() {
    const enabled = combat.enabled && screen === 'flying';
    ui['combat-avionics'].hidden = ui['combat-shortcuts'].hidden = !enabled;
    if (!enabled) return;
    const { radar, warning, rack } = combat.player;
    const time = flight.elapsed;
    ui['radar-panel'].hidden = !scopeVisible;
    if (scopeVisible && radar.revision !== radarRevision) {
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
    const notice = time < rack.noticeUntil ? rack.notice : time < dogfight.noticeUntil ? dogfight.notice : '';
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
    const canSee = Math.abs(directionMarker.z) < 1 && x >= 22 && x <= width - 22 && y >= 80 && y <= height - 72;
    const weapon = selectedWeapon();
    const transform = `translate(${x}px,${y}px) translate(-50%,-50%)`;
    ui.boresight.hidden = !canSee || weapon !== 'cannon';
    ui.boresight.style.transform = transform;
    const seeker = ui['seeker-marker'];
    seeker.hidden = !canSee || weapon === 'cannon';
    if (!seeker.hidden) {
      seeker.style.transform = transform;
      seeker.dataset.ready = String(combat.player.rack.launchState(weapon, flight.elapsed) === 'CLEARED');
    }
    if (!keyboardFlight && settings.controlMode === 'assist' && !controls.looking) renderAimMarker(width, height);
    ui['g-effect'].classList.toggle('red', flight.redout > flight.blackout);
    ui['g-effect'].style.opacity = Math.max(flight.blackout, flight.redout);
    const looking = String(controls.looking);
    if (document.body.dataset.looking !== looking) document.body.dataset.looking = looking;
  }

  function renderOpponent(blend, time) {
    opponentAircraft.visible = dogfight.enabled && !dogfight.opponentHull.incapacitated;
    const marker = ui['opponent-marker'];
    marker.hidden = true;
    if (!opponentAircraft.visible) return;
    const opponent = dogfight.opponent;
    opponentAircraft.position.copy(opponent.previousPosition).lerp(opponent.position, blend);
    opponentAircraft.quaternion.copy(opponent.previousOrientation).slerp(opponent.orientation, blend);
    opponentVisual.update(opponent, time, blend);
    if (screen !== 'flying') return;
    if (combat.enabled && selectedWeapon() === 'radar') {
      const radar = combat.player.radar;
      const track = radar.contacts.get(radar.selected);
      if (!track) return;
      opponentMarker.copy(track.position);
    } else {
      if (opponent.position.distanceToSquared(flight.position) > 3000 ** 2) return;
      if (combat.enabled && !hasLineOfSight(range, flight.position, opponent.position)) return;
      opponentMarker.copy(opponentAircraft.position);
    }
    opponentMarker.project(view.camera);
    if (Math.abs(opponentMarker.x) > 0.94 || Math.abs(opponentMarker.y) > 0.82 || Math.abs(opponentMarker.z) > 1) return;
    const x = (opponentMarker.x + 1) * viewportWidth * 0.5;
    const y = (1 - opponentMarker.y) * viewportHeight * 0.5;
    marker.style.transform = `translate(${x}px,${y}px) translate(-50%,-50%) rotate(45deg)`;
    marker.hidden = false;
  }

  function invalidateSight() {
    visualTrack.reset();
    gunComputer.valid = false;
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
    if (!dogfight.enabled || !opponentAircraft.visible || !trackVisible(dogfight.opponent.position)) {
      visualTrack.reset();
      return null;
    }
    const contact = dogfight.opponent.position;
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
    const span = f16.opticalSpan;
    const aspect = Math.abs(dogfight.opponent.forward.dot(sightBearing));
    const apparentSize = span * (0.92 + aspect * 0.08) / (2 * distance);
    return visualTrack.observe(flight.elapsed, origin, sightBearing, apparentSize, span);
  }

  function renderSight() {
    const enabled = sightActive && screen === 'flying' && selectedWeapon() === 'cannon';
    ui['sight-readout'].hidden = !enabled;
    const marker = ui['sight-marker'];
    if (!enabled) {
      marker.hidden = true;
      return;
    }
    if (flight.elapsed >= nextSight) {
      nextSight = flight.elapsed + sightInterval;
      if (sightMode === 'impact') gunComputer.impact(flight);
      else gunComputer.lead(flight, acquireTrack());
    }
    const visible = gunComputer.valid && trackVisible(gunComputer.point);
    marker.hidden = !visible;
    if (visible) {
      const x = (sightProjection.x + 1) * viewportWidth * 0.5;
      const y = (1 - sightProjection.y) * viewportHeight * 0.5;
      marker.dataset.mode = sightMode;
      marker.style.transform = `translate(${x}px,${y}px) translate(-50%,-50%)`;
    }
    text('sight-mode', sightMode === 'impact' ? 'CCIP' : practice.enabled ? 'TRAINING LEAD'
      : combat.enabled && combat.player.radar.track ? 'RADAR LEAD' : 'VISUAL LEAD');
    text('sight-state', gunComputer.valid ? `${visible ? 'VALID' : 'OFFSCREEN'} · ${Math.round(gunComputer.range)} M`
      : sightMode === 'impact' ? 'NO IMPACT' : 'NO SOLUTION');
  }

  function finishDogfight(result) {
    const won = result === 'win';
    const draw = result === 'draw';
    text('pause-title', draw ? 'Mutual loss' : won ? 'Dogfight won' : 'Dogfight lost');
    text('pause-description', draw ? 'Both aircraft were lost on the same pass.'
      : won ? `Opponent lost · ${dogfight.opponent.failure}`
      : flight.failure || 'Your airframe took critical damage.');
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
    if (screen === 'flying') {
      const command = controls.sample(brake, !keyboardFlight && settings.controlMode === 'assist');
      // Allow slow frames to catch up while bounding work after a browser stall.
      accumulator += Math.min(0.50, realDt);
      while (accumulator >= STEP) {
        const tickStart = time / 1000 - accumulator;
        flight.step(command);
        accumulator -= STEP;
        if (dogfight.enabled) dogfight.update(combat.enabled ? combat.adjust : null);
        else practice.step(flight.elapsed);
        if (flight.failure) {
          if (!dogfight.enabled) {
            text('pause-title', flight.failure);
            text('pause-description', 'Flight ended. Restart from the selected starting position.');
            changeScreen('failed');
            break;
          }
        }
        const firing = trigger.sample(tickStart, tickStart + STEP);
        if (combat.enabled) {
          combat.step(STEP);
          if (queuedLaunch) {
            combat.launch(combat.player, combat.enemy, queuedLaunch);
            queuedLaunch = null;
          }
          combatEffects.step(flight.elapsed);
        }
        if (!flight.failure && selectedWeapon() === 'cannon') cannon.step(STEP, firing, flight);
        if (dogfight.enabled) dogfight.fire(!combat.enabled || combat.enemyCannon);
        if (ballistics.count) ballistics.step(STEP, dogfight.enabled ? dogfight.playerTargets : colliders);
        if (dogfight.enabled && flight.elapsed >= nextDamageTrail && (flight.damage.active || dogfight.opponent.damage.active)) {
          nextDamageTrail = flight.elapsed + 0.075;
          weaponEffects.damageTrail(flight);
          weaponEffects.damageTrail(dogfight.opponent);
        }
        if (dogfight.enabled && dogfight.finish()) {
          finishDogfight(dogfight.result);
          break;
        }
      }
      if (cannon.ammo === 0) audio.setFiring(false);
    }
    const blend = screen === 'flying' ? accumulator / STEP : 1;
    aircraft.position.copy(flight.previousPosition).lerp(flight.position, blend);
    aircraft.quaternion.copy(flight.previousOrientation).slerp(flight.orientation, blend);
    aircraft.renderMovement.copy(aircraft.position).sub(previousRenderPosition);
    previousRenderPosition.copy(aircraft.position);
    visual.update(flight, time / 1000, blend);
    aircraft.visible = view.mode === 'chase' || screen === 'ready';
    const aim = !keyboardFlight && settings.controlMode === 'assist' ? controls.aim : null;
    view.update(aircraft, flight.velocity, dt, screen, controls.looking, settings.cameraSmoothing, aim, settings.cameraTurnResponse);
    renderOpponent(blend, time / 1000);
    combatEffects?.render(blend);
    renderSight();
    world.update(aircraft.position, view.camera);
    const effectStep = Math.max(0, flight.elapsed - lastEffectsTime);
    lastEffectsTime = flight.elapsed;
    weaponEffects.render(flight.elapsed, effectStep, blend, screen === 'flying');
    if (screen === 'flying') {
      renderFlightMarkers();
      updateWeaponHud();
    } else {
      ui['g-effect'].style.opacity = 0;
    }
    if (time - lastHudTime > 74) {
      updateHud();
      updateCombatHud();
      lastHudTime = time;
    }
    renderer.render(scene, view.camera);
    if (debug && realDt > 0) updateMetrics(realDt);
  }

  text('cannon-label', `${f16.cannon.name} · ${f16.cannon.caliber} MM`);
  renderBindings();
  updateSettings();
  selectStart('air');
  applyPreset();
  requestAnimationFrame(frame);
}
