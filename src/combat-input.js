const targetHold = 475;
const interactive = 'input, textarea, select, [contenteditable="true"]';

export class FlightInput {
  constructor(settings, controls, context, actions, refresh) {
    this.settings = settings;
    this.controls = controls;
    this.context = context;
    this.actions = actions;
    this.refresh = refresh;
    this.presses = new Set();
  }

  keydown(event) {
    if (!this.context.flying() || event.target.closest?.(interactive)) return;
    if (event.target.closest?.('button') && ['Enter', 'Space'].includes(event.code)) return;
    const key = Object.keys(this.settings.keys).find((action) => this.settings.keys[action] === event.code);
    if (!key || !this.context.available(key)) return;
    event.preventDefault();
    this.controls.held.add(event.code);
    if (event.repeat || this.presses.has(event.code)) return;
    this.presses.add(event.code);
    if (key === 'targetAction') {
      this.targetStarted = event.timeStamp;
      this.targetTimer = setTimeout(() => this.finishTarget(true), targetHold);
      return;
    }
    this.run(key);
  }

  keyup(event) {
    this.presses.delete(event.code);
    if (event.code === this.settings.keys.cannonFire) this.actions.endCannon();
    if (event.code === this.settings.keys.targetAction && this.targetTimer !== undefined) {
      this.finishTarget(event.timeStamp - this.targetStarted >= targetHold);
    }
  }

  clear() {
    this.cancelTarget();
    this.presses.clear();
    this.controls.clear();
  }

  cancelTarget() {
    clearTimeout(this.targetTimer);
    this.targetTimer = undefined;
  }

  finishTarget(clear) {
    this.cancelTarget();
    if (this.context.flying()) this.run(clear ? 'clearTarget' : 'targetAction');
  }

  run(key) {
    this.actions[key]?.();
    this.refresh();
  }
}

export function countermeasureProgram(mode, fallback, warning) {
  if (mode !== 'auto') return mode;
  if (['SEARCH', 'TRACK', 'ACTIVE SEEKER'].includes(warning)) return 'chaff';
  if (warning === 'INFRARED') return 'flare';
  return fallback;
}

export function secondaryAction(weapon, readiness) {
  if (weapon === 'cannon') return '';
  if (readiness === 'CLEARED') return ['infrared', 'radar', 'optical'].includes(weapon) ? 'FIRE MISSILE' : 'RELEASE BOMB';
  if (readiness === 'READY') return weapon === 'rocket' ? 'FIRE ROCKET' : 'RELEASE BOMB';
  const action = {
    'SEEKER STANDBY': 'ACQUIRE TARGET',
    'STT REQUIRED': 'ACQUIRE RADAR TRACK',
    'POINT TRACK REQUIRED': 'ACQUIRE POINT TRACK',
    'DESIGNATE AREA': 'DESIGNATE AREA',
    'LASER REQUIRED': 'DESIGNATE / LASER',
  };
  return action[readiness] ?? readiness;
}
