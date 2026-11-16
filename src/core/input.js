// ---------------------------------------------------------------------------
// Keyboard / mouse / pointer-lock input.
// ---------------------------------------------------------------------------

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();     // edge-triggered, cleared each frame
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.locked = false;
    this.enabled = true;
    this.sensitivity = 0.0022;
    this.invertY = false;
    this._onLock = null;

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const c = e.code;
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F1'].includes(c)) e.preventDefault();
      this.keys.add(c);
      this.pressed.add(c);
    });
    addEventListener('keyup', (e) => { this.keys.delete(e.code); });
    addEventListener('blur', () => { this.keys.clear(); });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) this.keys.clear();
      if (this._onLock) this._onLock(this.locked);
    });

    addEventListener('mousemove', (e) => {
      if (!this.locked || !this.enabled) return;
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
    });

    // Touch look: drag anywhere on the canvas.
    this.touchId = null;
    this.touchLast = [0, 0];
    canvas.addEventListener('touchstart', (e) => {
      if (this.touchId === null && e.touches.length) {
        this.touchId = e.touches[0].identifier;
        this.touchLast = [e.touches[0].clientX, e.touches[0].clientY];
      }
    }, { passive: true });
    canvas.addEventListener('touchmove', (e) => {
      if (!this.enabled) return;
      for (const t of e.changedTouches) {
        if (t.identifier !== this.touchId) continue;
        this.mouseDX += (t.clientX - this.touchLast[0]) * 1.6;
        this.mouseDY += (t.clientY - this.touchLast[1]) * 1.6;
        this.touchLast = [t.clientX, t.clientY];
      }
    }, { passive: true });
    canvas.addEventListener('touchend', () => { this.touchId = null; }, { passive: true });
  }

  onLockChange(fn) { this._onLock = fn; }

  requestLock() {
    if (this.locked) return;
    const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
    if (p && p.catch) p.catch(() => this.canvas.requestPointerLock()).catch(() => 0);
  }
  exitLock() { if (this.locked) document.exitPointerLock(); }

  down(code) { return this.keys.has(code); }
  hit(code) { return this.pressed.has(code); }
  axis(neg, pos) { return (this.keys.has(pos) ? 1 : 0) - (this.keys.has(neg) ? 1 : 0); }

  endFrame() {
    this.pressed.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
  }
}
