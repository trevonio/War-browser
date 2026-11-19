import * as T from 'three';
import { f16 } from './aircraft/f16.js';
import { createF16Visual } from './aircraft/f16-visual.js';
import { canBind, Controls, keyDefaults, keyLabels, keyName, loadSettings, saveSettings } from './controls.js';
import { FlightPointerLock } from './pointer-lock.js';
import { Flight, STEP } from './sim/flight.js';
import { range, scenarios } from './sim/range.js';
import { FlightCamera } from './view/camera.js';
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
  const previousRenderPosition = new T.Vector3();
  const directionMarker = new T.Vector3();
  const flightDirection = new T.Vector3();
  const aimDirection = new T.Vector3();
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
    controls.align(heading, Math.atan2(velocity.y, Math.max(1, groundSpeed)));
  }

  function changeScreen(next, pauseMessage = 'Your aircraft is holding position.') {
    if (next !== 'flying') capture.release();
    screen = next;
    document.body.dataset.screen = next;
    text('phase', { ready: 'PREFLIGHT', flying: 'FREE FLIGHT', paused: 'PAUSED', failed: 'FLIGHT ENDED' }[next]);
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
  }

  function pauseFlight(message) {
    if (screen === 'flying' || capture.pending) changeScreen('paused', message);
  }

  function requestFlight() {
    if (stopped || ui.settings.open) return;
    keyboardFlight = false;
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
    flight.reset(scenarios[startingPosition]);
    aircraft.position.copy(flight.position);
    aircraft.quaternion.copy(flight.orientation);
    previousRenderPosition.copy(flight.position);
    brake = false;
    view.mode = 'chase';
    view.azimuth = 0;
    view.elevation = 0;
    view.snap = true;
    changeScreen(next);
  }

  function selectStart(next) {
    startingPosition = next;
    pressed('start-air', next === 'air');
    pressed('start-runway', next === 'runway');
    reset('ready');
    text('start-detail', next === 'air' ? `2,950 FT MSL · ${Math.round(flight.airspeed)} KTS` : 'GROUND START · GEAR DOWN');
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
    if (screen === 'ready') view.snap = true;
  }

  function updateSettings() {
    saveSettings(settings);
    document.body.dataset.direct = String(keyboardFlight || settings.controlMode === 'direct');
    text('mouse-value', settings.mouseSensitivity.toFixed(1));
    text('camera-value', settings.cameraSensitivity.toFixed(1));
    text('aim-response-value', settings.aimResponsiveness.toFixed(1));
    text('camera-smoothing-value', settings.cameraSmoothing.toFixed(1));
    for (const action of ['afterburner', 'gear', 'stores', 'airbrake', 'camera', 'pause']) {
      text(`key-${action}`, keyName(settings.keys[action]));
    }
    text('restart-key', keyName(settings.keys.restart));
    text('help-maneuver', ['pitchUp', 'rollLeft', 'pitchDown', 'rollRight'].map((key) => keyName(settings.keys[key])).join(' '));
    text('help-throttle', [keyName(settings.keys.throttleUp), keyName(settings.keys.throttleDown)].join(' / '));
  }

  function applyPreset() {
    world.setPreset(presets[settings.preset]);
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

  const actions = {
    afterburner() { flight.toggleAfterburner(); },
    gear() { if (!flight.grounded) flight.gearDown = !flight.gearDown; },
    stores() { flight.stores = !flight.stores; },
    airbrake() { brake = !brake; },
    camera() { view.cycle(); },
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
  ui.launch.addEventListener('click', () => { view.snap = true; requestFlight(); });
  ui.resume.addEventListener('click', requestFlight);
  ui.restart.addEventListener('click', restartFlight);
  ui['keyboard-flight'].addEventListener('click', () => {
    keyboardFlight = true;
    capture.release();
    changeScreen('flying');
  });
  ui.viewport.addEventListener('click', () => {
    if ((screen === 'ready' || screen === 'paused') && !ui.settings.open) requestFlight();
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
    'aim-responsiveness': 'aimResponsiveness', 'camera-smoothing': 'cameraSmoothing' })) {
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
    if (code === 'Enter' && !(event.target instanceof HTMLButtonElement) && (screen === 'ready' || screen === 'paused')) {
      event.preventDefault();
      if (!event.repeat) requestFlight();
      return;
    }
    const key = Object.keys(settings.keys).find((action) => settings.keys[action] === code);
    if (!key) return;
    if (screen === 'paused' || screen === 'failed') {
      if (!event.repeat && key === 'restart') {
        event.preventDefault();
        restartFlight();
      }
      return;
    }
    if (screen !== 'flying') return;
    event.preventDefault();
    controls.held.add(code);
    if (!event.repeat) {
      actions[key]?.();
      updateHud();
    }
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
    text('engine-state', flight.afterburner ? 'AFTERBURNER' : flight.burnerArmed ? 'ENGINE SPOOLING' : flight.spool > 0.97 ? 'MIL POWER' : 'DRY THRUST');
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
    ui['g-force'].parentElement.classList.toggle('g-warning', Boolean(flight.gWarning));
    pressed('toggle-burner', flight.burnerArmed);
    pressed('toggle-gear', flight.gearDown);
    pressed('toggle-stores', flight.stores);
    pressed('toggle-airbrake', brake);
    ui['toggle-gear'].disabled = flight.grounded;
  }

  function renderFlightMarkers() {
    const width = viewportWidth;
    const height = viewportHeight;
    flightDirection.set(0, 0, 1).applyQuaternion(aircraft.quaternion);
    directionMarker.copy(aircraft.position).addScaledVector(flightDirection, 1800).project(view.camera);
    const x = (directionMarker.x + 1) * width * 0.5;
    const y = (1 - directionMarker.y) * height * 0.5;
    ui.boresight.hidden = directionMarker.z > 1 || x < 22 || x > width - 22 || y < 80 || y > height - 72;
    ui.boresight.style.transform = `translate(${x}px,${y}px) translate(-50%,-50%)`;
    if (!keyboardFlight && settings.controlMode === 'assist' && !controls.looking) renderAimMarker(width, height);
    ui['g-effect'].classList.toggle('red', flight.redout > flight.blackout);
    ui['g-effect'].style.opacity = Math.max(flight.blackout, flight.redout);
    const looking = String(controls.looking);
    if (document.body.dataset.looking !== looking) document.body.dataset.looking = looking;
  }

  function renderAimMarker(width, height) {
    const { heading, pitch } = controls.aim;
    const horizontal = Math.cos(pitch);
    aimDirection.set(-Math.sin(heading) * horizontal, Math.sin(pitch), Math.cos(heading) * horizontal);
    aimDirection.transformDirection(view.camera.matrixWorldInverse);
    const projection = view.camera.projectionMatrix.elements;
    const depth = Math.max(0.001, -aimDirection.z);
    const behind = aimDirection.z >= 0;
    let x = aimDirection.x * projection[0] * width * 0.5 / depth;
    const y = -aimDirection.y * projection[5] * height * 0.5 / depth;
    // A world-space target may lie outside the chase view. Indicate its
    // direction at the edge while continuing to accumulate relative input.
    const horizontalLimit = Math.max(10, width * 0.5 - 25);
    const verticalLimit = Math.max(10, height * 0.5 - 86);
    if (behind && Math.abs(x) + Math.abs(y) < 0.01) x = Math.sign(aimDirection.x || 1);
    const fit = Math.min(behind ? Infinity : 1, horizontalLimit / Math.max(0.001, Math.abs(x)), verticalLimit / Math.max(0.001, Math.abs(y)));
    const marker = ui['aim-cursor'];
    const offscreen = behind || fit < 1;
    marker.classList.toggle('offscreen', offscreen);
    marker.style.transform = `translate(${width * 0.5 + x * fit}px,${height * 0.5 + y * fit}px) translate(-50%,-50%)`;
    if (offscreen) marker.style.setProperty('--aim-bearing', `${Math.atan2(y, x)}rad`);
  }

  function updateMetrics(frameSeconds) {
    frameCount++;
    frameWindow += frameSeconds;
    if (frameWindow < 0.75) return;
    const info = renderer.info.render;
    ui.metrics.hidden = false;
    text('metrics', `${(frameCount / frameWindow).toFixed(1)} FPS · ${(1000 * frameWindow / frameCount).toFixed(1)} ms · ${info.calls} draws · ${info.triangles.toLocaleString()} triangles · AOA ${T.MathUtils.radToDeg(flight.alpha).toFixed(1)}°`);
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
        flight.step(command);
        accumulator -= STEP;
        if (flight.failure) {
          text('pause-title', flight.failure);
          text('pause-description', 'Free flight ended. Restart from the selected starting position.');
          changeScreen('failed');
          break;
        }
      }
    }
    const blend = screen === 'flying' ? accumulator / STEP : 1;
    aircraft.position.copy(flight.previousPosition).lerp(flight.position, blend);
    aircraft.quaternion.copy(flight.previousOrientation).slerp(flight.orientation, blend);
    aircraft.renderMovement.copy(aircraft.position).sub(previousRenderPosition);
    previousRenderPosition.copy(aircraft.position);
    visual.update(flight, time / 1000);
    aircraft.visible = view.mode === 'chase' || screen === 'ready';
    view.update(aircraft, flight.velocity, dt, screen, controls.looking, settings.cameraSmoothing);
    world.update(aircraft.position, view.camera);
    if (screen === 'flying') renderFlightMarkers();
    else ui['g-effect'].style.opacity = 0;
    if (time - lastHudTime > 74) {
      updateHud();
      lastHudTime = time;
    }
    renderer.render(scene, view.camera);
    if (debug && realDt > 0) updateMetrics(realDt);
  }

  renderBindings();
  updateSettings();
  selectStart('air');
  applyPreset();
  requestAnimationFrame(frame);
}
