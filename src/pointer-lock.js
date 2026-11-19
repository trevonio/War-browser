export class FlightPointerLock {
  constructor(target, callbacks, signal) {
    this.target = target;
    this.callbacks = callbacks;
    this.pending = null;
    this.active = false;
    const options = { signal };
    document.addEventListener('pointerlockchange', () => {
      if (this.locked) {
        if (!this.pending) {
          if (!this.active) document.exitPointerLock();
          return;
        }
        this.clearRequest();
        this.active = true;
        callbacks.acquired();
      } else if (this.active) {
        this.active = false;
        callbacks.lost();
      }
    }, options);
    document.addEventListener('pointerlockerror', () => this.reject(this.pending), options);
    signal.addEventListener('abort', () => this.release(), { once: true });
  }

  get locked() {
    return document.pointerLockElement === this.target;
  }

  request() {
    if (this.pending || this.locked) return;
    if (typeof this.target.requestPointerLock !== 'function') {
      this.callbacks.failed('This browser does not support mouse capture.');
      return;
    }
    const request = {};
    this.pending = request;
    request.timeout = setTimeout(() => this.reject(request), 4500);
    try {
      // Older implementations report success via the document event alone.
      this.target.requestPointerLock()?.catch((error) => this.reject(request, error));
    } catch (error) {
      this.reject(request, error);
    }
  }

  reject(request, error) {
    if (!request || this.pending !== request) return;
    this.clearRequest();
    const reason = error?.name === 'SecurityError' ? 'This page is not allowed to capture the mouse.'
      : 'The browser did not capture the mouse.';
    this.callbacks.failed(reason);
  }

  clearRequest() {
    clearTimeout(this.pending?.timeout);
    this.pending = null;
  }

  release() {
    this.clearRequest();
    this.active = false;
    if (this.locked) document.exitPointerLock();
  }
}
