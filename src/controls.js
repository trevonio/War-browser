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
  preset: 'medium', controlMode: 'assist', mouseSensitivity: 1, cameraSensitivity: 1,
  aimResponsiveness: 1, cameraSmoothing: 1, invert: false,
};

export function loadSettings() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem('war-browser:settings')); } catch { /* Storage can be disabled. */ }
  const config = { ...defaults, keys: { ...keyDefaults } };
  if (!saved || typeof saved !== 'object') return config;
  if (['low', 'medium', 'high'].includes(saved.preset)) config.preset = saved.preset;
  if (['assist', 'direct'].includes(saved.controlMode)) config.controlMode = saved.controlMode;
  for (const option of ['mouseSensitivity', 'cameraSensitivity', 'aimResponsiveness', 'cameraSmoothing']) {
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

const AIM_RADIANS_PER_PIXEL = 0.00255;
const MAX_AIM_PITCH = MathUtils.degToRad(74);

export class Controls {
  constructor(settings, viewport, session, camera, signal) {
    this.settings = settings;
    this.held = new Set();
    this.aim = { heading: 0, pitch: 0 };
    this.command = { ...neutralControls };
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
        this.moveAim(event.movementX, event.movementY);
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

  align(heading, pitch) {
    this.aim.heading = heading;
    this.aim.pitch = MathUtils.clamp(pitch, -MAX_AIM_PITCH, MAX_AIM_PITCH);
  }

  moveAim(dx, dy) {
    const scale = this.settings.mouseSensitivity * AIM_RADIANS_PER_PIXEL;
    const verticalSign = this.settings.invert ? 1 : -1;
    const heading = MathUtils.euclideanModulo(this.aim.heading + dx * scale + Math.PI, 2 * Math.PI) - Math.PI;
    this.align(heading, this.aim.pitch + dy * scale * verticalSign);
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
    command.aimHeading = this.aim.heading;
    command.aimPitch = this.aim.pitch;
    command.aimResponsiveness = this.settings.aimResponsiveness;
    command.brakes = brakes;
    return command;
  }
}
