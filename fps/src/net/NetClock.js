/**
 * Multiplayer time: the host's net clock and the clients' estimate of it, plus the two building blocks of smooth
 * remote movement - InterpBuffer (a ring of timestamped body samples, Hermite-interpolated) and DelayEstimator (how far
 * behind real time to render them, measured from the samples' real ages).
 *
 * Net time = the host's performance.now() - t0, in ms. Every timestamp on the wire is net time. The host's game.time
 * (paused offline, clamped on hitches) is never sent; deadlines are converted with hostGameToNet / netToLocalGame.
 */
import { NET } from './GameProtocol.js';
import { wrapAngle } from '../core/utils.js';

const OFFSET_SAMPLES = 8;
const SLEW_MS = 2;
const SNAP_MS = 250;

/**
 * p95 of the values observed in the last `windowMs` (allocation-free; the percentile is recomputed lazily, at most
 * every `everyMs`).
 */
export class RollingP95 {
  /** @param {number} windowMs @param {number} [capacity=512] @param {number} [everyMs=100] */
  constructor(windowMs, capacity = 512, everyMs = 100) {
    this.windowMs = windowMs;
    this.everyMs = everyMs;
    this._t = new Float64Array(capacity);
    this._v = new Float64Array(capacity);
    this._scratch = new Float64Array(capacity);
    this._i = 0;
    this._n = 0;
    this._p95 = 0;
    this._m = 0;
    this._at = -Infinity;
    this._dirty = false;
  }

  /** @param {number} nowMs a monotonic clock @param {number} v */
  add(nowMs, v) {
    const cap = this._t.length;
    this._t[this._i] = nowMs;
    this._v[this._i] = v;
    this._i = (this._i + 1) % cap;
    if (this._n < cap) this._n++;
    this._dirty = true;
  }

  /** p95 of the window ending at `nowMs` (0 when empty). */
  p95(nowMs) {
    this._sort(nowMs);
    return this._p95;
  }

  /** Any quantile 0..1 of the window ending at `nowMs` (0 when empty). */
  quantile(nowMs, q) {
    this._sort(nowMs);
    const m = this._m;
    if (!m) return 0;
    return this._scratch[Math.min(m - 1, Math.max(0, Math.floor(m * q)))];
  }

  /** Spread of the window: p95 - p5 (the jitter of a latency series, independent of its constant part). */
  spread(nowMs) {
    return this.quantile(nowMs, 0.95) - this.quantile(nowMs, 0.05);
  }

  _sort(nowMs) {
    if (!this._dirty || nowMs - this._at < this.everyMs) return;
    const cap = this._t.length, s = this._scratch, from = nowMs - this.windowMs;
    let m = 0;
    for (let k = 0; k < this._n; k++) {
      const j = (this._i - 1 - k + cap) % cap;
      if (this._t[j] < from) break;
      s[m++] = this._v[j];
    }
    this._m = m;
    if (m === 0) this._p95 = 0;
    else {
      s.subarray(0, m).sort();
      this._p95 = s[Math.min(m - 1, Math.floor(m * 0.95))];
    }
    this._at = nowMs;
    this._dirty = false;
  }

  /** Values in the window (for reports). */
  count(nowMs) {
    const cap = this._t.length, from = nowMs - this.windowMs;
    let m = 0;
    for (let k = 0; k < this._n; k++) {
      if (this._t[(this._i - 1 - k + cap) % cap] < from) break;
      m++;
    }
    return m;
  }

  clear() {
    this._n = 0;
    this._m = 0;
    this._p95 = 0;
    this._dirty = false;
  }

  /** Forget the most recent value. */
  pop() {
    if (!this._n) return;
    this._i = (this._i - 1 + this._t.length) % this._t.length;
    this._n--;
    this._dirty = true;
    this._at = -Infinity;
  }
}

/**
 * Host net clock (host) or the estimate of it (client, from PING / PONG).
 * Client offset: per pong, sample = h + rtt / 2 - recv; the sample with the lowest RTT of the last 8 is the target;
 * the first one is taken as is, later ones are slewed toward at <= 2 ms per pong; a jump > 250 ms snaps, and so does a
 * target measured with a clearly shorter round trip than the current estimate that disagrees beyond its error bound.
 */
export class NetClock {
  constructor() {
    /** Host: performance.now() when the room was created. */
    this.t0 = 0;
    /** hostNowMs() = performance.now() + offsetMs (host: -t0). */
    this.offsetMs = 0;
    /** Client: at least one pong received (host: always). */
    this.synced = false;
    /** Client: smoothed / p95 round trip to the host in ms. */
    this.rttMs = 0;
    this.rttP95Ms = 0;
    /** Client: mean absolute per-pong offset correction (report). */
    this.offsetJitterMs = 0;
    /** Bumped when the offset snaps (render clocks must not treat that as time running backwards). */
    this.snaps = 0;
    this._rtt = new Float64Array(OFFSET_SAMPLES);
    this._off = new Float64Array(OFFSET_SAMPLES);
    this._n = 0;
    this._i = 0;
    this._anchorRtt = Infinity;
    this._rttWin = new RollingP95(10000, 64, 250);
  }

  /** Host: start the net clock now. */
  startHost() {
    this.t0 = performance.now();
    this.offsetMs = -this.t0;
    this.synced = true;
  }

  /** Forget the offset (leaving a session). */
  reset() {
    this.t0 = 0;
    this.offsetMs = 0;
    this.synced = false;
    this.rttMs = this.rttP95Ms = this.offsetJitterMs = 0;
    this._n = this._i = 0;
    this._anchorRtt = Infinity;
    this._rttWin.clear();
  }

  /** Host net time in ms (host: exact; client: the current estimate). */
  hostNowMs() {
    return performance.now() + this.offsetMs;
  }

  /** Host only: net time in ms (same as hostNowMs on the host). */
  netNowMs() {
    return performance.now() - this.t0;
  }

  /**
   * Client: a PONG arrived.
   * @param {number} cMs client performance.now() when the PING was sent
   * @param {number} hMs host net time when the host answered
   * @param {number} recvPerfMs client performance.now() at arrival
   */
  onPong(cMs, hMs, recvPerfMs) {
    const rtt = recvPerfMs - cMs;
    if (!(rtt >= 0) || rtt > 10000 || !Number.isFinite(hMs)) return;
    this._rtt[this._i] = rtt;
    this._off[this._i] = hMs + rtt / 2 - recvPerfMs;
    this._i = (this._i + 1) % OFFSET_SAMPLES;
    if (this._n < OFFSET_SAMPLES) this._n++;
    let best = 0;
    for (let k = 1; k < this._n; k++) if (this._rtt[k] < this._rtt[best]) best = k;
    const target = this._off[best];
    const targetRtt = this._rtt[best];
    if (!this.synced) {
      this.offsetMs = target;
      this._anchorRtt = targetRtt;
      this.synced = true;
    } else {
      const d = target - this.offsetMs;
      // a sample is only good to +-rtt/2. The estimate came from a sample with a much longer round trip (e.g. the
      // first pong crossed a host stall) and a precise one disagrees beyond its own error bound: trust it at once
      // instead of slewing 2 ms per second for a minute
      const better = targetRtt < this._anchorRtt - 4 && Math.abs(d) > targetRtt / 2 + 2;
      if (Math.abs(d) > SNAP_MS || better) {
        this.offsetMs = target;
        this._anchorRtt = targetRtt;
        this.snaps++;
      } else {
        const step = Math.max(-SLEW_MS, Math.min(SLEW_MS, d));
        this.offsetMs += step;
        this.offsetJitterMs = this.offsetJitterMs * 0.9 + Math.abs(step) * 0.1;
        if (Math.abs(d) <= SLEW_MS) this._anchorRtt = Math.min(this._anchorRtt, targetRtt);
      }
    }
    this.rttMs = this.rttMs ? this.rttMs * 0.8 + rtt * 0.2 : rtt;
    this._rttWin.add(recvPerfMs, rtt);
    this.rttP95Ms = this._rttWin.p95(recvPerfMs);
  }

  /** Host: a game-time stamp (game.time based) as net ms; Infinity / NaN -> NET.NEVER. */
  hostGameToNet(game, t) {
    return Number.isFinite(t) ? this.hostNowMs() + (t - game.time) * 1000 : NET.NEVER;
  }

  /** Client: a net-time stamp as local game time; NET.NEVER (any negative) / non-numbers -> Infinity. */
  netToLocalGame(game, ms) {
    return typeof ms === 'number' && ms >= 0 ? game.time + (ms - this.hostNowMs()) / 1000 : Infinity;
  }
}

// ------------------------------------------------------------------------------------------- interpolation

const RING = 32;
/** A consumer frame longer than this (ms) is a local stall, not network lag (DelayEstimator). */
const LOCAL_STALL_MS = 100;
/** Above this sample gap (s) Hermite tangents get unreliable (a stall): interpolate linearly. */
const HERMITE_MAX_GAP_S = 0.1;

function makeSample() {
  return {
    t: 0, px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, h: 1.8,
    // carried from the newer bracketing sample (no interpolation): flags, flags2, weapon index, grapple point, beam end, charge
    f: 0, f2: 0, w: 0, gx: 0, gy: 0, gz: 0, bx: 0, by: 0, bz: 0, c: 0,
  };
}

function copyAux(out, s) {
  out.f = s.f; out.f2 = s.f2; out.w = s.w;
  out.gx = s.gx; out.gy = s.gy; out.gz = s.gz;
  out.bx = s.bx; out.by = s.by; out.bz = s.bz;
  out.c = s.c;
}

/** A sample-shaped object for InterpBuffer.push / sample outputs. */
export function makeBodySample() {
  return makeSample();
}

/**
 * Ring of the last 32 body samples of one remote entity ({t, px..pz, vx..vz, yaw, pitch, h} + carried flags), in
 * net-time order. sample(t) gives the state at render time t: Hermite between the bracketing samples (with their
 * velocities), yaw along the shortest arc, flags from the newer sample; past the newest sample it extrapolates with the
 * velocity for at most `maxExtrapMs`, then holds. No allocation after construction.
 */
export class InterpBuffer {
  constructor() {
    this._s = [];
    for (let i = 0; i < RING; i++) this._s.push(makeSample());
    this._head = 0;
    this._n = 0;
  }

  /** Net time of the newest sample (-Infinity when empty). */
  get newestT() {
    return this._n ? this._s[this._head].t : -Infinity;
  }

  /** Number of samples held. */
  get size() {
    return this._n;
  }

  /** The newest sample (read-only) or null. */
  newest() {
    return this._n ? this._s[this._head] : null;
  }

  clear() {
    this._n = 0;
  }

  /**
   * Append a sample at net time tMs (fields copied from `src`, a makeBodySample-shaped object). A sample older than the
   * newest one is moved just after it (clock slew), or - if it is much older (a clock snap) - starts the buffer over.
   */
  push(tMs, src) {
    if (this._n) {
      const last = this._s[this._head];
      if (tMs <= last.t) {
        if (last.t - tMs > 50) this._n = 0;
        else tMs = last.t + 0.5;
      }
    }
    this._head = (this._head + 1) % RING;
    const s = this._s[this._head];
    s.t = tMs;
    s.px = src.px; s.py = src.py; s.pz = src.pz;
    s.vx = src.vx; s.vy = src.vy; s.vz = src.vz;
    s.yaw = src.yaw; s.pitch = src.pitch; s.h = src.h;
    copyAux(s, src);
    if (this._n < RING) this._n++;
  }

  /** Drop every sample and start from this one (spawn, teleport). */
  reset(tMs, src) {
    this._n = 0;
    this.push(tMs, src);
  }

  /**
   * State at net time tMs into `out` (makeBodySample-shaped; out.t = the sample time actually shown).
   * @returns {'interp'|'extrap'|'hold'|'empty'}
   */
  sample(tMs, out, maxExtrapMs) {
    const n = this._n;
    if (!n) return 'empty';
    const newest = this._s[this._head];
    if (tMs >= newest.t) {
      const over = tMs - newest.t;
      const ex = Math.min(over, Math.max(0, maxExtrapMs));
      const k = ex / 1000;
      out.px = newest.px + newest.vx * k;
      out.py = newest.py + newest.vy * k;
      out.pz = newest.pz + newest.vz * k;
      out.vx = newest.vx; out.vy = newest.vy; out.vz = newest.vz;
      out.yaw = newest.yaw; out.pitch = newest.pitch; out.h = newest.h;
      copyAux(out, newest);
      out.t = newest.t + ex;
      if (over > maxExtrapMs) return 'hold';
      return ex > 0 ? 'extrap' : 'interp';
    }
    let b = newest;
    for (let i = 1; i < n; i++) {
      const a = this._s[(this._head - i + RING) % RING];
      if (a.t <= tMs) {
        interpolate(a, b, tMs, out);
        return 'interp';
      }
      b = a;
    }
    // older than every sample (just after a reset): show the oldest
    out.px = b.px; out.py = b.py; out.pz = b.pz;
    out.vx = b.vx; out.vy = b.vy; out.vz = b.vz;
    out.yaw = b.yaw; out.pitch = b.pitch; out.h = b.h;
    copyAux(out, b);
    out.t = b.t;
    return 'hold';
  }
}

function interpolate(a, b, t, out) {
  const span = b.t - a.t;
  const s = span > 0 ? Math.min(1, Math.max(0, (t - a.t) / span)) : 1;
  const dt = span / 1000;
  if (dt > 0 && dt <= HERMITE_MAX_GAP_S) {
    const s2 = s * s, s3 = s2 * s;
    const h00 = 2 * s3 - 3 * s2 + 1, h10 = (s3 - 2 * s2 + s) * dt, h01 = -2 * s3 + 3 * s2, h11 = (s3 - s2) * dt;
    out.px = h00 * a.px + h10 * a.vx + h01 * b.px + h11 * b.vx;
    out.py = h00 * a.py + h10 * a.vy + h01 * b.py + h11 * b.vy;
    out.pz = h00 * a.pz + h10 * a.vz + h01 * b.pz + h11 * b.vz;
  } else {
    out.px = a.px + (b.px - a.px) * s;
    out.py = a.py + (b.py - a.py) * s;
    out.pz = a.pz + (b.pz - a.pz) * s;
  }
  out.vx = a.vx + (b.vx - a.vx) * s;
  out.vy = a.vy + (b.vy - a.vy) * s;
  out.vz = a.vz + (b.vz - a.vz) * s;
  out.yaw = wrapAngle(a.yaw + wrapAngle(b.yaw - a.yaw) * s);
  out.pitch = a.pitch + (b.pitch - a.pitch) * s;
  out.h = a.h + (b.h - a.h) * s;
  copyAux(out, b);
  out.t = t;
}

/**
 * How far behind "now" (host net time) to show remote entities. Each consumer frame observes the age of the newest
 * sample (one-way lag + the send-interval sawtooth + frame alignment + clock error); the target delay is
 * p95(age over 2 s) + interval / 2 + 2 ms, clamped to [minMs, maxMs]. A late gap (age > the current delay: we would
 * extrapolate) raises the target at once to age + interval / 2. The effective delay chases a higher target at
 * DELAY_DILATION x real time (render time keeps advancing, at half speed) and decays toward a lower one at
 * DELAY_DECAY_MS_PER_S, so the render clock never runs backwards.
 */
export class DelayEstimator {
  /** @param {{minMs: number, maxMs: number}} opts */
  constructor({ minMs, maxMs }) {
    this.minMs = minMs;
    this.maxMs = maxMs;
    this.effectiveMs = minMs;
    this.targetMs = minMs;
    /** p95 of the observed ages (report). */
    this.ageP95Ms = 0;
    this._ages = new RollingP95(NET.DELAY_WINDOW_MS, 1024, 100);
    this._clock = 0;
    this._lastAge = 0;
    this._observed = false;
    this._muteUntil = 0;
  }

  /** The age (ms) of the newest sample at this consumer frame. */
  observe(ageMs) {
    if (this._clock < this._muteUntil) return;
    this._lastAge = ageMs;
    this._ages.add(this._clock, ageMs);
    this._observed = true;
  }

  /**
   * Advance by one consumer frame.
   * @param {number} realDtMs real time since the last update
   * @param {number} intervalMs the samples' send interval
   * @returns {number} the effective delay in ms
   */
  update(realDtMs, intervalMs) {
    // this consumer itself stalled (a hitch, a frozen tab): the samples queued meanwhile are still being delivered,
    // so ages measured now are local, not network lag - drop them and ignore the next 300 ms
    if (realDtMs > LOCAL_STALL_MS) {
      if (this._observed) this._ages.pop();
      this._lastAge = 0;
      this._muteUntil = this._clock + Math.max(0, realDtMs) + 300;
    }
    this._observed = false;
    this._clock += Math.max(0, realDtMs);
    this.ageP95Ms = this._ages.p95(this._clock);
    let target = this.ageP95Ms + intervalMs / 2 + NET.DELAY_MARGIN_MS;
    if (this._lastAge > this.effectiveMs) target = Math.max(target, this._lastAge + intervalMs / 2);
    target = Math.min(this.maxMs, Math.max(this.minMs, target));
    this.targetMs = target;
    if (target > this.effectiveMs) this.effectiveMs = Math.min(target, this.effectiveMs + NET.DELAY_DILATION * realDtMs);
    else this.effectiveMs = Math.max(target, this.effectiveMs - NET.DELAY_DECAY_MS_PER_S * realDtMs / 1000);
    return this.effectiveMs;
  }

  /** Start over at the minimum (new match / new connection). */
  reset() {
    this.effectiveMs = this.targetMs = this.minMs;
    this.ageP95Ms = 0;
    this._ages.clear();
    this._lastAge = 0;
    this._muteUntil = 0;
  }
}
