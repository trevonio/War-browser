export class CannonTrigger {
  constructor(viewport, { enabled, pressed, released }, signal) {
    this.held = false;
    this.pointerHeld = false;
    this.keyHeld = false;
    this.simHeld = false;
    this.transitions = [];
    this.windows = [];
    this.pressed = pressed;
    this.released = released;
    viewport.addEventListener('mousedown', (event) => {
      if (event.button === 0 && enabled()) {
        this.pointerHeld = true;
        this.setHeld(true);
      }
    }, { signal });
    window.addEventListener('mouseup', (event) => {
      if (event.button === 0) {
        this.pointerHeld = false;
        this.setHeld(this.keyHeld);
      }
    }, { signal });
    for (const event of ['blur', 'pointercancel']) {
      window.addEventListener(event, () => this.clear(), { signal });
    }
  }

  setKey(held) {
    this.keyHeld = held;
    this.setHeld(held || this.pointerHeld);
  }

  setHeld(held) {
    if (this.held === held) return;
    this.held = held;
    this.transitions.push({ time: performance.now() / 1000, held });
    if (held) this.pressed();
    else this.released();
  }

  sample(start, end) {
    const windows = this.windows;
    windows.length = 0;
    let opened = this.simHeld ? start : null;
    let consumed = 0;
    for (const event of this.transitions) {
      if (event.time >= end) break;
      const time = Math.max(start, event.time);
      if (event.held) opened = time;
      else if (opened !== null) {
        if (time > opened) windows.push(opened - start, time - start);
        opened = null;
      }
      consumed++;
    }
    if (consumed) this.transitions.splice(0, consumed);
    this.simHeld = opened !== null;
    if (this.simHeld) windows.push(opened - start, end - start);
    return windows;
  }

  clear() {
    this.pointerHeld = this.keyHeld = false;
    this.transitions.length = 0;
    this.simHeld = false;
    if (this.held) {
      this.held = false;
      this.released();
    }
  }
}
