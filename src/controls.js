import { MathUtils } from 'three';
import { neutralControls } from './sim/flight.js';

export const keyDefaults = {
  pitchUp: 'KeyW', pitchDown: 'KeyS', rollLeft: 'KeyA', rollRight: 'KeyD', yawLeft: 'KeyQ', yawRight: 'KeyE',
  throttleUp: 'ShiftLeft', throttleDown: 'ControlLeft', afterburner: 'KeyB', gear: 'KeyG', stores: 'KeyH',
  airbrake: 'KeyX', camera: 'KeyV', freeLook: 'KeyF', pause: 'Escape', restart: 'KeyR',
};

export const keyLabels = {
  pitchUp: 'Pitch up', pitchDown: 'Pitch down', rollLeft: 'Roll left', rollRight: 'Roll right', yawLeft: 'Yaw left',
  yawRight: 'Yaw right', throttleUp: 'Throttle up', throttleDown: 'Throttle down', afterburner: 'Afterburner',
  gear: 'Landing gear', stores: 'External stores', airbrake: 'Airbrake / wheel brakes', camera: 'Switch camera',
  freeLook: 'Free look', pause: 'Pause', restart: 'Restart flight',
};

export function keyName(code) {
  const labels = { Escape: 'Esc', Space: 'Space', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };
  return labels[code] || code.replace(/^(Key|Digit)/, '').replace(/(Left|Right)$/, '').replace('Control', 'Ctrl');
}

export const canBind = (code) => /^(Key[A-Z]|Digit[0-9]|Arrow(Up|Down|Left|Right)|Shift(Left|Right)|Control(Left|Right)|Alt(Left|Right)|Space)$/.test(code);

const defaults = {
  preset: 'medium', controlMode: 'assist', mouseSensitivity: 1, cameraSensitivity: 1, invert: false,
};

export function loadSettings() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem('war-browser:settings')); } catch { /* Storage can be disabled. */ }
  const config = { ...defaults, keys: { ...keyDefaults } };
  if (!saved || typeof saved !== 'object') return config;
  if (['low', 'medium', 'high'].includes(saved.preset)) config.preset = saved.preset;
  if (['assist', 'direct'].includes(saved.controlMode)) config.controlMode = saved.controlMode;
  for (const option of ['mouseSensitivity', 'cameraSensitivity']) {
    if (Number.isFinite(saved[option])) config[option] = MathUtils.clamp(saved[option], 0.4, 2.2);
  }
  config.invert = saved.invert === true;
  for (const action of Object.keys(config.keys)) {
    const code = saved.keys?.[action];
    if (code === 'Escape' || canBind(code)) config.keys[action] = code;
  }
  if (new Set(Object.values(config.keys)).size !== Object.keys(config.keys).length) config.keys = { ...keyDefaults };
  return config;
}

export function saveSettings(settings) {
  try { localStorage.setItem('war-browser:settings', JSON.stringify(settings)); } catch { /* Session settings still apply. */ }
}

export class Controls {
  constructor(settings, viewport, isFlying, camera) {
    this.settings = settings;
    this.held = new Set();
    this.aim = { x: 0, y: 0 };
    this.command = { ...neutralControls };
    this.orbiting = false;
    viewport.addEventListener('contextmenu', (event) => event.preventDefault());
    viewport.addEventListener('pointerdown', (event) => {
      if (!isFlying() || event.button !== 2) return;
      this.orbiting = true;
      this.resetAim();
      viewport.setPointerCapture(event.pointerId);
    });
    viewport.addEventListener('lostpointercapture', () => { this.orbiting = false; });
    viewport.addEventListener('pointerup', (event) => {
      if (event.button === 2) this.orbiting = false;
    });
    viewport.addEventListener('pointercancel', () => this.clear());
    viewport.addEventListener('pointerleave', () => {
      if (!this.looking) this.resetAim();
    });
    viewport.addEventListener('pointermove', (event) => {
      if (!isFlying() || event.pointerType !== 'mouse') return;
      if (this.looking) {
        camera.orbit(event.movementX, event.movementY, settings.cameraSensitivity);
        return;
      }
      this.aim.x = MathUtils.clamp((event.clientX / viewport.clientWidth - 0.5) * 2, -0.99, 0.99);
      this.aim.y = MathUtils.clamp((event.clientY / viewport.clientHeight - 0.5) * 2, -0.99, 0.99);
    });
    viewport.addEventListener('wheel', (event) => {
      if (!isFlying()) return;
      event.preventDefault();
      camera.zoom(event.deltaY);
    }, { passive: false });
    window.addEventListener('keyup', (event) => this.held.delete(event.code));
    window.addEventListener('blur', () => this.clear());
  }

  get looking() {
    return this.orbiting || this.held.has(this.settings.keys.freeLook);
  }

  resetAim() {
    this.aim.x = 0;
    this.aim.y = 0;
  }

  clear() {
    this.held.clear();
    this.orbiting = false;
    this.resetAim();
  }

  sample(brakes) {
    const { keys } = this.settings;
    const command = this.command;
    const down = (action) => Number(this.held.has(keys[action]));
    const throttleUp = down('throttleUp');
    const throttleDown = down('throttleDown');
    const sensitivity = this.settings.mouseSensitivity;
    command.pitch = down('pitchUp') - down('pitchDown');
    command.roll = down('rollRight') - down('rollLeft');
    command.yaw = down('yawRight') - down('yawLeft');
    command.throttle = throttleUp - throttleDown;
    command.assisted = this.settings.controlMode === 'assist';
    command.aimX = this.looking ? 0 : MathUtils.clamp(this.aim.x * sensitivity, -1, 1);
    command.aimY = this.looking ? 0 : MathUtils.clamp(this.aim.y * sensitivity * (this.settings.invert ? 1 : -1), -1, 1);
    command.brakes = brakes;
    return command;
  }
}
