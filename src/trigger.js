export class CannonTrigger {
  constructor(viewport, { enabled, pressed, released }, signal) {
    this.held = false;
    this.released = released;
    viewport.addEventListener('mousedown', (event) => {
      if (event.button !== 0 || this.held || !enabled()) return;
      this.held = true;
      pressed();
    }, { signal });
    window.addEventListener('mouseup', (event) => {
      if (event.button === 0) this.clear();
    }, { signal });
    for (const event of ['blur', 'pointercancel']) {
      window.addEventListener(event, () => this.clear(), { signal });
    }
  }

  clear() {
    if (!this.held) return;
    this.held = false;
    this.released();
  }
}
