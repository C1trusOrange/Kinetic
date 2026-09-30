/**
 * Keyboard / mouse input with action bindings, pointer lock, and a virtual-input layer
 * (used by the automated test harness).
 *
 * Codes: KeyboardEvent.code values ('KeyW', 'Space', 'ShiftLeft', ...) and 'Mouse0'..'Mouse4'.
 * Frame protocol (driven by Game): input.update() at frame start, input.endFrame() at frame end.
 *
 * Frame window. Every key / button / wheel event that arrives between two frames is appended, with its DOM
 * timestamp, to an ordered per-frame log (`log`) and resolved by update() at the start of the next frame:
 *  - held state (`action()`) always follows the real key state;
 *  - press edges keep every press of the window in order: a tap whose down AND up both land in one window
 *    still reads as pressed (`actionPressed()`, `actionActive()`), two taps count twice (`pressCount()`) and the
 *    newest of several keys can win (`latestPressed()`, `pressTime()`);
 *  - wheel events become whole notch steps (`wheel`) that survive the browser coalescing several notches into
 *    one event (deltaMode normalised, fractions carried, at most WHEEL_MAX_STEPS per frame);
 *  - STALE-PRESS policy: a press (or wheel notch) that is older than STALE_PRESS_MS when its frame consumes it -
 *    it was made during a long main-thread stall and queued by the browser - is dropped from every edge query,
 *    so the game never replays an action the player made a quarter of a second ago against a world that has
 *    moved on. The held state of that key is not affected (holding W / fire / crouch through a stall still
 *    works). Dropped presses are counted in `staleDrops` and flagged `stale` in the log. Only real input is
 *    subject to it (the virtual test layer is exempt).
 * Events dispatched while a frame is running (test probes dispatching inside the scenario's drive(), or the
 * virtual layer) are resolved immediately into that frame.
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
 * A press whose DOM timestamp is older than this (ms) when its frame consumes it is dropped from the edge
 * queries (stale-press policy, see the header). Held state is never dropped.
 */
export const STALE_PRESS_MS = 250;

/** Most wheel steps one frame applies in either direction (more notches in one frame are dropped, not carried). */
export const WHEEL_MAX_STEPS = 3;
/** deltaMode 0 (pixels): Chrome / Edge report 100 px per notch at 100 % zoom. */
const WHEEL_PX_PER_NOTCH = 100;
/** deltaMode 1 (lines): Firefox reports 3 lines per notch by default. */
const WHEEL_LINES_PER_NOTCH = 3;
/** A partial notch (touchpad / high-resolution wheel) older than this (ms) is forgotten. */
const WHEEL_IDLE_RESET_MS = 400;
/** Log code of wheel entries. */
const WHEEL = 'Wheel';
/** Most pending log entries kept while no frame consumes them. */
const LOG_CAP = 256;

/**
 * Sanity guard for one mousemove (raw counts per axis): only absurd values are clamped. Browsers deliver one
 * coalesced mousemove per frame, so a legit event grows with the frame time: at 30 fps a 1600 DPI mouse moving
 * 1.5 m/s already reports ~3000 counts (the old 3000-count clamp ate the rest of such a flick).
 */
const LOOK_GUARD = 100000;

const lookCounts = v => (Number.isFinite(v) ? (v > LOOK_GUARD ? LOOK_GUARD : v < -LOOK_GUARD ? -LOOK_GUARD : v) : 0);

/** DOM timestamp of an event (ms, performance.now() time base); falls back to now for odd values. */
function stamp(e) {
  const now = performance.now();
  const t = e.timeStamp;
  return Number.isFinite(t) && t > 0 && t <= now + 1 ? t : now;
}

/**
 * Wheel event -> notches (+ = scroll down = next, - = up = previous). Chrome's wheelDeltaY counts whole ticks
 * (120 each, summed when events are coalesced) independent of display scaling; otherwise deltaY is normalised by
 * deltaMode. Shift (sprint) + wheel arrives as a horizontal scroll on some platforms, so it is mapped back.
 */
function wheelNotches(e) {
  let d = e.deltaY;
  let wd = e.wheelDeltaY;
  if (!d && e.shiftKey && e.deltaX) {
    d = e.deltaX;
    wd = e.wheelDeltaX;
  }
  if (!Number.isFinite(d) || d === 0) return 0;
  if (typeof wd === 'number' && wd !== 0 && wd % 120 === 0 && (wd < 0) === (d > 0)) return -wd / 120;
  const unit = e.deltaMode === 1 ? WHEEL_LINES_PER_NOTCH : e.deltaMode === 2 ? 1 : WHEEL_PX_PER_NOTCH;
  return d / unit;
}

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

    this.down = new Set();      // codes currently held (reality)
    this.pressed = new Set();   // codes with at least one accepted (non-stale) press this frame
    this.released = new Set();  // codes that went up this frame

    /**
     * This frame's raw events in arrival order: `{code, down, t, stale, virtual, n}` - code ('Wheel' for wheel
     * notches, the action name for virtual entries), t = DOM timestamp (ms, performance.now() time base),
     * stale = press dropped by the stale policy, n = wheel notches. Entries are pooled and recycled by
     * endFrame(): read them during the frame, never keep references.
     */
    this.log = [];
    this._pool = [];
    this._consumed = 0;         // log entries already resolved into the frame
    this._inFrame = false;      // between update() and endFrame()
    this._frameN = new Map();   // code -> accepted presses this frame
    this._frameT = new Map();   // code -> newest accepted press this frame (ms)
    this._lastT = new Map();    // code -> newest accepted press ever (ms)

    this.virtual = new Map();         // action -> bool (test harness)
    this._virtualPressed = new Set();
    this._virtualReleased = new Set();
    this._vFrameN = new Map();        // action -> virtual presses this frame
    this._vFrameT = new Map();        // action -> newest virtual press this frame (ms)
    this._vLastT = new Map();         // action -> newest virtual press ever (ms)

    /** Frame clock: performance.now() / 1000 when update() resolved this frame's input (seconds). */
    this.time = performance.now() / 1000;
    /** Presses / wheel notches dropped by the stale-press policy so far (tests, diagnostics). */
    this.staleDrops = 0;

    this._lookX = 0;
    this._lookY = 0;
    this._look = { x: 0, y: 0 };
    /** Whole wheel steps this frame: +n = scroll down / next, -n = up / previous (|n| <= WHEEL_MAX_STEPS). */
    this.wheel = 0;
    /** DOM timestamp (s) of the newest wheel event that contributed a step this frame (orders wheel vs keys). */
    this.wheelTime = 0;
    this._wheelAcc = 0;          // carried fraction of a notch
    this._wheelLastT = -1e9;     // ms

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
      if (e.repeat || this.down.has(e.code)) return;
      this.down.add(e.code);
      this._push(e.code, true, stamp(e), false, 0);
    });

    window.addEventListener('keyup', e => {
      if (this.capture && CAPTURED_CODES.has(e.code)) e.preventDefault();
      if (!this.down.has(e.code)) return;
      this.down.delete(e.code);
      this._push(e.code, false, stamp(e), false, 0);
    });

    const mouseActive = () => this.locked || (this.lockUnavailable && this.capture);

    window.addEventListener('mousedown', e => {
      if (!mouseActive()) return;
      if (e.button === 3 || e.button === 4) e.preventDefault(); // stop browser back/forward
      const code = 'Mouse' + e.button;
      if (this.down.has(code)) return;
      this.down.add(code);
      this._push(code, true, stamp(e), false, 0);
    });

    window.addEventListener('mouseup', e => {
      if (e.button === 3 || e.button === 4) e.preventDefault();
      const code = 'Mouse' + e.button;
      if (!this.down.has(code)) return;
      this.down.delete(code);
      this._push(code, false, stamp(e), false, 0);
    });

    window.addEventListener('mousemove', e => {
      if (!this.enabled || !mouseActive()) return;
      // Chrome reports a huge spurious delta on the first event after the lock engages (or focus
      // returns): drop exactly that one event. Everything else is accepted as is - a fast flick coalesced
      // into one event per (long) frame is legit; only absurd values are clamped (LOOK_GUARD).
      if (this._skipMove) { this._skipMove = false; return; }
      this._lookX += lookCounts(e.movementX || 0);
      this._lookY += lookCounts(e.movementY || 0);
    });

    window.addEventListener('wheel', e => {
      if (!mouseActive()) return;
      const n = wheelNotches(e);
      if (n !== 0) this._push(WHEEL, true, stamp(e), false, n);
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

  /** Append one event to the frame log (resolved at the next update(), or right away inside a running frame). */
  _push(code, down, t, virtual, n) {
    // no frames running (throttled / hidden page) while events keep coming: forget the oldest pending ones
    if (!this._inFrame && this.log.length >= LOG_CAP) this._pool.push(this.log.shift());
    const e = this._pool.pop() || { code: '', down: false, t: 0, stale: false, virtual: false, n: 0 };
    e.code = code;
    e.down = down;
    e.t = t;
    e.stale = false;
    e.virtual = virtual;
    e.n = n;
    this.log.push(e);
    if (this._inFrame) {
      this._consume(e);
      this._consumed = this.log.length;
    }
  }

  /**
   * Resolve one log entry into this frame's edge state. The stale-press policy is applied here, to real input only
   * (virtual presses are scripted: a test's first frame after loading may well start late). A stale press still
   * counts as the key's newest physical press for pressTime() - it says since when a held key is down.
   */
  _consume(e) {
    const code = e.code;
    if (!e.down) {
      if (e.virtual) this._virtualReleased.add(code);
      else this.released.add(code);
      return;
    }
    const L = e.virtual ? this._vLastT : this._lastT;
    if (!(L.get(code) >= e.t)) L.set(code, e.t);
    if (!e.virtual && this.time * 1000 - e.t > STALE_PRESS_MS) {
      e.stale = true;
      this.staleDrops++;
      return;
    }
    if (code === WHEEL && !e.virtual) { this._consumeWheel(e); return; }
    const N = e.virtual ? this._vFrameN : this._frameN;
    const T = e.virtual ? this._vFrameT : this._frameT;
    if (e.virtual) this._virtualPressed.add(code);
    else this.pressed.add(code);
    N.set(code, (N.get(code) || 0) + 1);
    if (!(T.get(code) >= e.t)) T.set(code, e.t);
  }

  _consumeWheel(e) {
    const n = e.n;
    // a partial notch left over from an earlier scroll, or one in the other direction, does not carry
    if (e.t - this._wheelLastT > WHEEL_IDLE_RESET_MS || (this._wheelAcc > 0) !== (n > 0)) this._wheelAcc = 0;
    this._wheelLastT = e.t;
    this._wheelAcc += n;
    const whole = this._wheelAcc > 0 ? Math.floor(this._wheelAcc + 1e-6) : Math.ceil(this._wheelAcc - 1e-6);
    if (whole === 0) return;
    this._wheelAcc -= whole;
    const w = this.wheel + whole;
    this.wheel = w > WHEEL_MAX_STEPS ? WHEEL_MAX_STEPS : w < -WHEEL_MAX_STEPS ? -WHEEL_MAX_STEPS : w;
    this.wheelTime = e.t / 1000;
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
  /** True when `code` has an accepted (non-stale) press this frame. */
  wasPressed(code) { return this.enabled && this.pressed.has(code); }
  wasReleased(code) { return this.enabled && this.released.has(code); }

  /** True while any binding of the action is held (the real key state; never affected by the stale policy). */
  action(name) {
    if (!this.enabled) return false;
    if (this.virtual.get(name)) return true;
    const codes = this.bindings[name];
    if (!codes) return false;
    for (let i = 0; i < codes.length; i++) if (this.down.has(codes[i])) return true;
    return false;
  }

  /** True when the action has an accepted (non-stale) press in this frame's window, even if it was released again. */
  actionPressed(name) {
    if (!this.enabled) return false;
    if (this._virtualPressed.has(name)) return true;
    const codes = this.bindings[name];
    if (!codes) return false;
    for (let i = 0; i < codes.length; i++) if (this.pressed.has(codes[i])) return true;
    return false;
  }

  /** True on the frame the action went up. */
  actionReleased(name) {
    if (!this.enabled) return false;
    if (this._virtualReleased.has(name)) return true;
    const codes = this.bindings[name];
    if (!codes) return false;
    for (let i = 0; i < codes.length; i++) if (this.released.has(codes[i])) return true;
    return false;
  }

  /**
   * Held now OR pressed in this frame's window: a tap that went down and up between two frames (a short click at
   * a low frame rate, any click made during a hitch) still counts for one frame.
   */
  actionActive(name) {
    return this.action(name) || this.actionPressed(name);
  }

  /** Number of accepted presses of the action in this frame's window (a double tap inside one long frame is 2). */
  pressCount(name) {
    if (!this.enabled) return 0;
    let n = this._vFrameN.get(name) || 0;
    const codes = this.bindings[name];
    if (codes) for (let i = 0; i < codes.length; i++) n += this._frameN.get(codes[i]) || 0;
    return n;
  }

  /** Newest accepted press of the action in this frame's window (ms), or -Infinity. */
  _framePressMs(name) {
    let t = -Infinity;
    const v = this._vFrameT.get(name);
    if (v !== undefined) t = v;
    const codes = this.bindings[name];
    if (codes) {
      for (let i = 0; i < codes.length; i++) {
        const c = this._frameT.get(codes[i]);
        if (c !== undefined && c > t) t = c;
      }
    }
    return t;
  }

  /**
   * Of the given action names, the one pressed most recently in this frame's window (by DOM timestamp), or null
   * when none of them was pressed. Use it where several presses compete (weapon keys: the last key wins).
   * @param {string[]} names
   * @returns {string|null}
   */
  latestPressed(names) {
    if (!this.enabled) return null;
    let best = null, bestT = -Infinity;
    for (let i = 0; i < names.length; i++) {
      const t = this._framePressMs(names[i]);
      if (t > bestT) { bestT = t; best = names[i]; }
    }
    return best;
  }

  /**
   * DOM timestamp (seconds, same clock as `time`) of the action's newest physical press - this frame's when it was
   * pressed this frame - or -Infinity if it was never pressed. A press dropped by the stale-press policy counts
   * here (it tells since when a held key is down); accepted presses are always newer than stale ones, so while
   * actionPressed() is true this is the time of that press.
   */
  pressTime(name) {
    let t = -Infinity;
    const v = this._vLastT.get(name);
    if (v !== undefined) t = v;
    const codes = this.bindings[name];
    if (codes) {
      for (let i = 0; i < codes.length; i++) {
        const c = this._lastT.get(codes[i]);
        if (c !== undefined && c > t) t = c;
      }
    }
    return t / 1000;
  }

  /** Seconds between the action's newest press (see pressTime) and this frame's start (>= 0; Infinity if never pressed). */
  pressAge(name) {
    const t = this.pressTime(name);
    return t === -Infinity ? Infinity : Math.max(0, this.time - t);
  }

  /** Current time on the input clock (performance.now() in seconds; `time` is the frame's start). */
  now() {
    return performance.now() / 1000;
  }

  /**
   * Returns and clears accumulated mouse look since the last call, in raw counts.
   * Callers multiply by BASE_LOOK_SPEED * settings.sensitivity (and their own zoom scale).
   * The returned object is reused: read it right away.
   * @returns {{x:number, y:number}}
   */
  consumeLook() {
    const out = this._look;
    out.x = this.enabled ? this._lookX : 0;
    out.y = this.enabled ? this._lookY : 0;
    this._lookX = 0;
    this._lookY = 0;
    return out;
  }

  // ---------------------------------------------------------------- virtual input (tests)

  /**
   * Set a virtual action state (test harness). A change is a press / release edge that goes through the same
   * frame log as DOM events: set inside a frame (a scenario's drive()) it applies to that frame, so a virtual
   * press + release within one drive() call is a tap inside one frame window, exactly like DOM input.
   */
  setVirtual(action, isDown) {
    const v = !!isDown;
    if ((this.virtual.get(action) || false) === v) return;
    this.virtual.set(action, v);
    this._push(action, v, performance.now(), true, 0);
  }

  addLook(dx, dy) {
    this._lookX += dx;
    this._lookY += dy;
  }

  /** Release every virtual action (with release edges) and forget them. */
  clearVirtual() {
    const t = performance.now();
    for (const [action, v] of this.virtual) if (v) this._push(action, false, t, true, 0);
    this.virtual.clear();
  }

  // ---------------------------------------------------------------- frame protocol

  /** Frame start: stamp the frame clock and resolve the events that arrived since the last frame. */
  update() {
    this.time = performance.now() / 1000;
    this._inFrame = true;
    const log = this.log;
    for (let i = this._consumed; i < log.length; i++) this._consume(log[i]);
    this._consumed = log.length;
  }

  /** Frame end: clear this frame's edges and recycle the log. */
  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this._virtualPressed.clear();
    this._virtualReleased.clear();
    this._frameN.clear();
    this._frameT.clear();
    this._vFrameN.clear();
    this._vFrameT.clear();
    const log = this.log;
    for (let i = 0; i < log.length; i++) this._pool.push(log[i]);
    log.length = 0;
    this._consumed = 0;
    this.wheel = 0;
    this._inFrame = false;
  }

  /** Release every held key / button (blur, pointer-lock loss, pause). */
  clearAll() {
    const t = performance.now();
    for (const c of this.down) this._push(c, false, t, false, 0);
    this.down.clear();
  }
}
