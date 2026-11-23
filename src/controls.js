import { MathUtils } from 'three';
import { MouseAim } from './aim.js';
import { neutralControls } from './sim/flight.js';

const legacyDefaults = {
  pitchUp: 'KeyW', pitchDown: 'KeyS', rollLeft: 'KeyA', rollRight: 'KeyD', yawLeft: 'KeyQ', yawRight: 'KeyE',
  throttleUp: 'ShiftLeft', throttleDown: 'ControlLeft', afterburner: 'KeyB', gear: 'KeyG', stores: 'KeyH',
  airbrake: 'KeyX', camera: 'KeyV', freeLook: 'KeyF', pause: 'Escape', restart: 'KeyR',
  sight: 'KeyC', sightMode: 'KeyM',
  weaponCannon: 'Digit1', weaponInfrared: 'Digit2', weaponRadar: 'Digit3', cycleWeapon: 'Digit4', fireSelected: 'Space',
  radarPower: 'KeyP', radarTarget: 'KeyT', radarLock: 'KeyL', radarMode: 'KeyY', radarRange: 'KeyU', radarScope: 'KeyI',
  flares: 'KeyJ', chaff: 'KeyK',
  weaponBomb: 'Digit5', weaponRocket: 'Digit6', jettisonTank: 'Digit8', rearmGround: 'Digit9',
  podView: 'Digit7', podMode: 'Digit0', tacticalMap: 'Tab', missileView: 'KeyN', nextMissile: 'KeyO', targetView: 'KeyZ',
};

export const keyDefaults = {
  ...legacyDefaults, yawLeft: 'KeyZ', airbrake: 'Slash', restart: 'Backspace',
  sight: 'Semicolon', sightMode: 'Quote', cycleWeapon: 'KeyQ', targetView: 'Comma',
  tacticalMap: 'KeyM', podView: 'KeyC', targetAction: 'KeyR', defensiveProgram: 'KeyX',
  cannonFire: 'Enter', podZoomIn: 'Equal', podZoomOut: 'Minus', flaps: 'Digit7',
};

export const simpleActions = new Set([
  'pitchUp', 'pitchDown', 'rollLeft', 'rollRight', 'yawLeft', 'yawRight', 'throttleUp', 'throttleDown',
  'afterburner', 'gear', 'airbrake', 'camera', 'freeLook', 'pause', 'cannonFire', 'fireSelected',
  'cycleWeapon', 'targetAction', 'defensiveProgram', 'tacticalMap', 'podView',
]);

export const defensivePrograms = ['auto', 'flare', 'chaff', 'mixed'];

export const keyLabels = {
  pitchUp: 'Pitch up', pitchDown: 'Pitch down', rollLeft: 'Roll left', rollRight: 'Roll right', yawLeft: 'Yaw left',
  yawRight: 'Yaw right', throttleUp: 'Throttle up', throttleDown: 'Throttle down', afterburner: 'Afterburner',
  gear: 'Landing gear', flaps: 'Cycle flap position', stores: 'External stores', airbrake: 'Airbrake / wheel brakes', camera: 'Switch camera',
  freeLook: 'Free look', pause: 'Pause', restart: 'Restart flight',
  sight: 'Toggle gun computer', sightMode: 'Change gun computer mode',
  weaponCannon: 'Select cannon', weaponInfrared: 'Select infrared missile', weaponRadar: 'Select radar missile',
  cycleWeapon: 'Cycle secondary weapons', fireSelected: 'Acquire or release secondary weapon',
  targetAction: 'Select target / hold to clear', defensiveProgram: 'Deploy countermeasure program',
  cannonFire: 'Cannon (keyboard)', podZoomIn: 'Pod zoom in', podZoomOut: 'Pod zoom out',
  radarPower: 'Radar power / pod laser', radarTarget: 'Select radar or visual ground contact', radarLock: 'Radar lock / pod track',
  radarMode: 'Change radar scan mode', radarRange: 'Change radar scan range', radarScope: 'Radar scope / recenter pod',
  flares: 'Release flare', chaff: 'Release chaff',
  weaponBomb: 'Select bombs', weaponRocket: 'Select rockets', jettisonTank: 'Drop external tank', rearmGround: 'Rearm range weapons',
  podView: 'Targeting pod view', podMode: 'Pod sensor mode', tacticalMap: 'Tactical map', missileView: 'Cycle missile camera or return', nextMissile: 'Next missile view / save pod fix', targetView: 'Toggle selected target view',
};

export function keyName(code) {
  const labels = { Escape: 'Esc', Tab: 'Tab', Space: 'Space', Equal: '+', Minus: '−',
    Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };
  return labels[code] || code.replace(/^(Key|Digit)/, '').replace(/(Left|Right)$/, '').replace('Control', 'Ctrl');
}

export const canBind = (code) => /^(Tab|Key[A-Z]|Digit[0-9]|Arrow(Up|Down|Left|Right)|Shift(Left|Right)|Control(Left|Right)|Alt(Left|Right)|Space|Enter|Backspace|Equal|Minus|Comma|Period|Slash|Semicolon|Quote|Bracket(Left|Right))$/.test(code);

const defaults = {
  preset: 'medium', controlMode: 'assist', mouseSensitivity: 1, cameraSensitivity: 1,
  aimResponsiveness: 1, cameraSmoothing: 1, cameraTurnResponse: 1, invert: false, counterProgram: 'auto', unknownProgram: 'mixed', releaseOrder: 'mounted', keyVersion: 2,
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
  if (defensivePrograms.includes(saved.counterProgram)) config.counterProgram = saved.counterProgram;
  if (defensivePrograms.slice(1).includes(saved.unknownProgram)) config.unknownProgram = saved.unknownProgram;
  if (['mounted', 'left', 'right'].includes(saved.releaseOrder)) config.releaseOrder = saved.releaseOrder;
  const legacy = saved.keyVersion !== defaults.keyVersion;
  const preserved = Object.fromEntries(Object.entries(saved.keys ?? {}).filter(([action, code]) =>
    Object.hasOwn(keyDefaults, action) && (code === 'Escape' || canBind(code))
    && (!legacy || legacyDefaults[action] !== code)));
  config.keys = completeBindings(preserved);
  return config;
}

function completeBindings(preferred) {
  const bindings = {};
  const used = new Set();
  for (const [action, code] of Object.entries(preferred)) {
    if (used.has(code)) continue;
    bindings[action] = code;
    used.add(code);
  }
  const spare = [
    ...Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ', (character) => 'Key' + character),
    ...Array.from('0123456789', (character) => 'Digit' + character),
    'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftRight', 'ControlRight', 'AltLeft', 'AltRight',
    'Period', 'BracketLeft', 'BracketRight',
  ];
  const reserved = new Set(Object.values(keyDefaults));
  for (const [action, code] of Object.entries(keyDefaults)) {
    if (Object.hasOwn(bindings, action)) continue;
    const previous = legacyDefaults[action];
    const binding = !used.has(code) ? code : previous && !used.has(previous) && !reserved.has(previous) ? previous
      : spare.find((candidate) => !used.has(candidate) && !reserved.has(candidate));
    bindings[action] = binding;
    used.add(binding);
  }
  return bindings;
}

export function resetBindings(keys, advanced) {
  const selected = (action) => simpleActions.has(action) !== advanced;
  const defaults = Object.fromEntries(Object.entries(keyDefaults).filter(([action]) => selected(action)));
  const previous = Object.fromEntries(Object.entries(keys).filter(([action]) => !selected(action)));
  return completeBindings({ ...defaults, ...previous });
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
      const sensor = session.sensor?.();
      if (sensor) {
        if (session.locked() || this.orbiting) sensor.slew(event.movementX, event.movementY);
        return;
      }
      if (session.observing?.()) return;
      if (this.looking && (session.locked() || viewport.contains(event.target))) {
        camera.orbit(event.movementX, event.movementY, settings.cameraSensitivity);
      } else if (session.locked() && session.assisted()) {
        this.aim.move(event.movementX, event.movementY, settings.mouseSensitivity, settings.invert);
      }
    }, options);
    viewport.addEventListener('wheel', (event) => {
      if (!session.flying()) return;
      event.preventDefault();
      const sensor = session.sensor?.();
      if (sensor) sensor.changeZoom(event.deltaY);
      else camera.zoom(event.deltaY);
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
