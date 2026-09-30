/**
 * Keyboard / mouse input with action bindings, pointer lock, and a virtual-input layer
 * (used by the automated test harness).
 *
 * Codes: KeyboardEvent.code values ('KeyW', 'Space', 'ShiftLeft', ...) and 'Mouse0'..'Mouse4'.
 * Frame protocol (driven by Game): input.update() at frame start, input.endFrame() at frame end.
 */

export const DEFAULT_BINDINGS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  crouch: ['KeyC'],            // NOTE: Ctrl is intentionally not bound (Ctrl+W closes the tab)
  sprint: ['ShiftLeft', 'ShiftRight'],
  fire: ['Mouse0'],
  ads: ['Mouse2'],
  reload: ['KeyR'],
  grenade: ['KeyG'],
  grenadeNext: ['KeyX'],
  grapple: ['KeyE', 'Mouse4'],
  melee: ['KeyV', 'KeyF'],
  weapon1: ['Digit1'],
  weapon2: ['Digit2'],
  weapon3: ['Digit3'],
  weapon4: ['Digit4'],
  weapon5: ['Digit5'],
  weapon6: ['Digit6'],
  weapon7: ['Digit7'],
  weapon8: ['Digit8'],
  weapon9: ['Digit9'],
  lastWeapon: ['KeyQ'],
  scoreboard: ['Tab'],
};

/** Keys whose browser default action must be suppressed while playing. */
const CAPTURED_CODES = new Set([
  'Space', 'Tab', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'KeyC', 'KeyE', 'KeyG', 'KeyX', 'KeyQ', 'KeyR', 'KeyV', 'KeyF', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9',
  'ShiftLeft', 'ShiftRight', 'Backquote',
]);

/** Base look speed in radians per mouse count at sensitivity 1.0. */
export const BASE_LOOK_SPEED = 0.0022;

/**
 * Largest per-axis look delta (raw counts) accepted from one mousemove. Browsers coalesce a whole
 * frame of movement into one event, so a fast flick at high DPI / low fps can exceed 700 counts.
 */
const MAX_LOOK_DELTA = 3000;

export class Input {
  /**
   * @param {object} game
   * @param {HTMLElement} element  element that receives pointer lock (the renderer canvas)
   */
  constructor(game, element) {
    this.game = game;
    this.element = element;
    this.bindings = JSON.parse(JSON.stringify(DEFAULT_BINDINGS));

    /** When false, all actions read as released and look deltas are discarded. */
    this.enabled = true;
    /** When true, browser defaults for game keys are suppressed (set while playing). */
    this.capture = false;

    this.down = new Set();      // codes currently held
    this.pressed = new Set();   // codes that went down this frame
    this.released = new Set();  // codes that went up this frame

    this.virtual = new Map();         // action -> bool (test harness)
    this._virtualPrev = new Map();
    this._virtualPressed = new Set();
    this._virtualReleased = new Set();

    this._lookX = 0;
    this._lookY = 0;
    /** Accumulated wheel notches this frame: +1 = scroll down / next, -1 = scroll up / previous. */
    this.wheel = 0;

    this.locked = false;
    /** One-shot: drop the next mousemove (spurious delta after the lock engages / focus returns). */
    this._skipMove = false;
    /** True if the browser refused pointer lock (e.g. sandboxed iframe) -> free-look fallback. */
    this.lockUnavailable = false;
    this._lockListeners = [];

    this._bind();
  }

  // ---------------------------------------------------------------- DOM wiring

  _bind() {
    const el = this.element;

    window.addEventListener('keydown', e => {
      if (this.capture && (CAPTURED_CODES.has(e.code))) e.preventDefault();
      if (e.repeat) return;
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
    });

    window.addEventListener('keyup', e => {
      if (this.capture && CAPTURED_CODES.has(e.code)) e.preventDefault();
      if (this.down.has(e.code)) this.released.add(e.code);
      this.down.delete(e.code);
    });

    const mouseActive = () => this.locked || (this.lockUnavailable && this.capture);

    window.addEventListener('mousedown', e => {
      if (!mouseActive()) return;
      if (e.button === 3 || e.button === 4) e.preventDefault(); // stop browser back/forward
      const code = 'Mouse' + e.button;
      if (!this.down.has(code)) this.pressed.add(code);
      this.down.add(code);
    });

    window.addEventListener('mouseup', e => {
      if (e.button === 3 || e.button === 4) e.preventDefault();
      const code = 'Mouse' + e.button;
      if (this.down.has(code)) this.released.add(code);
      this.down.delete(code);
    });

    window.addEventListener('mousemove', e => {
      if (!this.enabled || !mouseActive()) return;
      // Chrome reports a huge spurious delta on the first event after the lock engages (or focus
      // returns): drop exactly that one event. Later events are legitimate (a fast flick can
      // coalesce to well over 700 counts) so they are clamped, not discarded.
      if (this._skipMove) { this._skipMove = false; return; }
      const dx = Math.max(-MAX_LOOK_DELTA, Math.min(MAX_LOOK_DELTA, e.movementX || 0));
      const dy = Math.max(-MAX_LOOK_DELTA, Math.min(MAX_LOOK_DELTA, e.movementY || 0));
      this._lookX += dx;
      this._lookY += dy;
    });

    window.addEventListener('wheel', e => {
      if (!mouseActive()) return;
      this.wheel += Math.sign(e.deltaY);
    }, { passive: true });

    el.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('contextmenu', e => { if (this.capture) e.preventDefault(); });

    window.addEventListener('blur', () => this.clearAll());
    window.addEventListener('focus', () => { this._skipMove = true; });

    this._lockFailures = 0;

    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === this.element;
      if (locked === this.locked) return;
      this.locked = locked;
      if (locked) { this.lockUnavailable = false; this._lockFailures = 0; this._skipMove = true; }
      if (!locked) this.clearAll();
      for (const fn of this._lockListeners.slice()) {
        try { fn(locked); } catch (err) { console.error('[input] lock listener threw', err); }
      }
    });

    document.addEventListener('pointerlockerror', () => {
      // Happens in sandboxed iframes, or when re-locking too quickly after Esc.
      this._lockFailures++;
      let inIframe = true;
      try { inIframe = window.self !== window.top; } catch { /* cross-origin -> iframe */ }
      if (inIframe || this._lockFailures >= 4) this.lockUnavailable = true;
    });
  }

  // ---------------------------------------------------------------- pointer lock

  /**
   * Request pointer lock. Must be called from a user gesture (click / key handler). Without a
   * transient user activation (e.g. the Esc keydown that resumes from the pause menu is never
   * one) the browser would reject the request, so it is skipped: it must not count towards
   * `lockUnavailable`, and the HUD's click-to-capture hint / the canvas click re-locks instead.
   */
  requestLock() {
    if (this.locked) return;
    const el = this.element;
    if (!el.requestPointerLock) { this.lockUnavailable = true; return; }
    const ua = navigator.userActivation;
    if (ua && !ua.isActive) return;
    try {
      const p = el.requestPointerLock({ unadjustedMovement: true });
      if (p && typeof p.catch === 'function') {
        p.catch(err => {
          // Retry without options only when unadjustedMovement is unsupported: a refusal
          // (NotAllowedError / SecurityError...) would just fail again and double-count.
          const name = err && err.name;
          if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'InvalidStateError' || name === 'WrongDocumentError') return;
          try {
            const p2 = el.requestPointerLock();
            if (p2 && typeof p2.catch === 'function') p2.catch(() => { /* counted by pointerlockerror */ });
          } catch { this.lockUnavailable = true; }
        });
      }
    } catch {
      this.lockUnavailable = true;
    }
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** fn(locked:boolean). Returns unsubscribe. */
  onLockChange(fn) {
    this._lockListeners.push(fn);
    return () => {
      const i = this._lockListeners.indexOf(fn);
      if (i >= 0) this._lockListeners.splice(i, 1);
    };
  }

  // ---------------------------------------------------------------- queries

  /** Raw key/button state by code. */
  isDown(code) { return this.enabled && this.down.has(code); }
  wasPressed(code) { return this.enabled && this.pressed.has(code); }
  wasReleased(code) { return this.enabled && this.released.has(code); }

  /** True while any binding of the action is held. */
  action(name) {
    if (!this.enabled) return false;
    if (this.virtual.get(name)) return true;
    const codes = this.bindings[name];
    if (!codes) return false;
    for (const c of codes) if (this.down.has(c)) return true;
    return false;
  }

  /** True on the frame the action went down. */
  actionPressed(name) {
    if (!this.enabled) return false;
    if (this._virtualPressed.has(name)) return true;
    const codes = this.bindings[name];
    if (!codes) return false;
    for (const c of codes) if (this.pressed.has(c)) return true;
    return false;
  }

  /** True on the frame the action went up. */
  actionReleased(name) {
    if (!this.enabled) return false;
    if (this._virtualReleased.has(name)) return true;
    const codes = this.bindings[name];
    if (!codes) return false;
    for (const c of codes) if (this.released.has(c)) return true;
    return false;
  }

  /**
   * Returns and clears accumulated mouse look since the last call, in raw counts.
   * Callers multiply by BASE_LOOK_SPEED * settings.sensitivity (and their own zoom scale).
   * @returns {{x:number, y:number}}
   */
  consumeLook() {
    const out = { x: this._lookX, y: this._lookY };
    this._lookX = 0;
    this._lookY = 0;
    if (!this.enabled) { out.x = 0; out.y = 0; }
    return out;
  }

  // ---------------------------------------------------------------- virtual input (tests)

  setVirtual(action, isDown) {
    this.virtual.set(action, !!isDown);
  }

  addLook(dx, dy) {
    this._lookX += dx;
    this._lookY += dy;
  }

  clearVirtual() {
    this.virtual.clear();
  }

  // ---------------------------------------------------------------- frame protocol

  update() {
    this._virtualPressed.clear();
    this._virtualReleased.clear();
    for (const [name, isDown] of this.virtual) {
      const was = this._virtualPrev.get(name) || false;
      if (isDown && !was) this._virtualPressed.add(name);
      if (!isDown && was) this._virtualReleased.add(name);
      this._virtualPrev.set(name, isDown);
    }
  }

  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.wheel = 0;
  }

  clearAll() {
    for (const c of this.down) this.released.add(c);
    this.down.clear();
  }
}
