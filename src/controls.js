import { MathUtils } from 'three';
import { MouseAim } from './aim.js';
import { neutralControls } from './sim/flight.js';

export const keyDefaults = {
  pitchUp: 'KeyW', pitchDown: 'KeyS', rollLeft: 'KeyA', rollRight: 'KeyD', yawLeft: 'KeyQ', yawRight: 'KeyE',
  throttleUp: 'ShiftLeft', throttleDown: 'ControlLeft', afterburner: 'KeyB', gear: 'KeyG', stores: 'KeyH',
  airbrake: 'KeyX', camera: 'KeyV', freeLook: 'KeyF', pause: 'Escape', restart: 'KeyR',
  sight: 'KeyC', sightMode: 'KeyM',
};

export const keyLabels = {
  pitchUp: 'Pitch up', pitchDown: 'Pitch down', rollLeft: 'Roll left', rollRight: 'Roll right', yawLeft: 'Yaw left',
  yawRight: 'Yaw right', throttleUp: 'Throttle up', throttleDown: 'Throttle down', afterburner: 'Afterburner',
  gear: 'Landing gear', stores: 'External stores', airbrake: 'Airbrake / wheel brakes', camera: 'Switch camera',
  freeLook: 'Free look', pause: 'Pause', restart: 'Restart flight',
  sight: 'Toggle gun computer', sightMode: 'Change gun computer mode',
};

export function keyName(code) {
  const labels = { Escape: 'Esc', Space: 'Space', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };
  return labels[code] || code.replace(/^(Key|Digit)/, '').replace(/(Left|Right)$/, '').replace('Control', 'Ctrl');
}

export const canBind = (code) => /^(Key[A-Z]|Digit[0-9]|Arrow(Up|Down|Left|Right)|Shift(Left|Right)|Control(Left|Right)|Alt(Left|Right)|Space)$/.test(code);

const defaults = {
  preset: 'medium', controlMode: 'assist', mouseSensitivity: 1, cameraSensitivity: 1,
  aimResponsiveness: 1, cameraSmoothing: 1, cameraTurnResponse: 1, invert: false,
};

export function loadSettings() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem('war-browser:settings')); } catch { /* Storage can be disabled. */ }
  const config = { ...defaults, keys: { ...keyDefaults } };
  if (!saved || typeof saved !== 'object') return config;
  if (['low', 'medium', 'high'].includes(saved.preset)) config.preset = saved.preset;
  if (['assist', 'direct'].includes(saved.controlMode)) config.controlMode = saved.controlMode;
  for (const option of ['mouseSensitivity', 'cameraSensitivity', 'aimResponsiveness', 'cameraSmoothing', 'cameraTurnResponse']) {
    if (Number.isFinite(saved[option])) config[option] = MathUtils.clamp(saved[option], 0.4, 2.2);
  }
  config.invert = saved.invert === true;
  for (const action of Object.keys(config.keys)) {
    const code = saved.keys?.[action];
    if (code === 'Escape' || canBind(code)) config.keys[action] = code;
  }
  for (const action of ['sight', 'sightMode']) {
    if (saved.keys?.[action]) continue;
    const used = new Set(Object.entries(config.keys).filter(([key]) => key !== action).map(([, code]) => code));
    if (used.has(config.keys[action])) {
      config.keys[action] = ['KeyC', 'KeyM', 'KeyJ', 'KeyK', 'KeyL', 'KeyT', 'KeyY', 'Digit1']
        .find((code) => !used.has(code)) ?? config.keys[action];
    }
  }
  if (new Set(Object.values(config.keys)).size !== Object.keys(config.keys).length) config.keys = { ...keyDefaults };
  return config;
}

export function saveSettings(settings) {
  try { localStorage.setItem('war-browser:settings', JSON.stringify(settings)); } catch { /* Session settings still apply. */ }
}

export class Controls {
  constructor(settings, viewport, session, camera, signal) {
    this.settings = settings;
    this.held = new Set();
    this.aim = new MouseAim();
    this.command = { ...neutralControls, pitchPriority: true };
    this.orbiting = false;
    const options = { signal };

    viewport.addEventListener('contextmenu', (event) => event.preventDefault(), options);
    viewport.addEventListener('pointerdown', (event) => {
      if (!session.flying() || event.button !== 2) return;
      this.orbiting = true;
      if (!session.locked()) viewport.setPointerCapture(event.pointerId);
    }, options);
    viewport.addEventListener('lostpointercapture', () => { this.orbiting = false; }, options);
    window.addEventListener('pointerup', (event) => {
      if (event.button === 2) this.orbiting = false;
    }, options);
    window.addEventListener('pointercancel', () => this.clear(), options);
    document.addEventListener('mousemove', (event) => {
      if (!session.flying()) return;
      if (this.looking && (session.locked() || viewport.contains(event.target))) {
        camera.orbit(event.movementX, event.movementY, settings.cameraSensitivity);
      } else if (session.locked() && session.assisted()) {
        this.aim.move(event.movementX, event.movementY, settings.mouseSensitivity, settings.invert);
      }
    }, options);
    viewport.addEventListener('wheel', (event) => {
      if (!session.flying()) return;
      event.preventDefault();
      camera.zoom(event.deltaY);
    }, { signal, passive: false });
    window.addEventListener('keyup', (event) => this.held.delete(event.code), options);
  }

  get looking() {
    return this.orbiting || this.held.has(this.settings.keys.freeLook);
  }

  clear() {
    this.held.clear();
    this.orbiting = false;
  }

  sample(brakes, assisted) {
    const { keys } = this.settings;
    const command = this.command;
    const down = (action) => Number(this.held.has(keys[action]));
    command.pitch = down('pitchUp') - down('pitchDown');
    command.roll = down('rollRight') - down('rollLeft');
    command.yaw = down('yawRight') - down('yawLeft');
    command.throttle = down('throttleUp') - down('throttleDown');
    command.assisted = assisted;
    command.aimDirection = this.aim.direction;
    command.aimHint = this.aim.turnHint;
    command.aimResponsiveness = this.settings.aimResponsiveness;
    command.brakes = brakes;
    return command;
  }
}
