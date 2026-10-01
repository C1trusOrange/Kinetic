/**
 * Test-only network impairment (installed only with ?netem=): delays, jitter and stalls on both directions of this
 * page's game packets. Each direction is one FIFO like a TCP stream (a stalled packet holds back everything behind it:
 * head-of-line blocking); latest-wins packets (type >= 0x80) waiting in the outbound queue are replaced by newer ones of
 * the same type and route, as the relay does for a backed-up receiver.
 *
 * Spec: 'lan' | 'wifi' | 'bad' | 'lat:8,jit:12,stall:150-300@5' (ms; a stall of 150..300 ms every 5 s).
 *   lan  = lat 1 jit 1;  wifi = lat 8 jit 12 + a 150-300 ms stall every 5 s;  bad = lat 30 jit 40 + a 500 ms stall every 5 s
 */
import { LATEST_WINS } from './protocol.js';
import { mulberry32 } from '../core/utils.js';

const PROFILES = {
  lan: { lat: 1, jit: 1, stallMin: 0, stallMax: 0, every: 0 },
  wifi: { lat: 8, jit: 12, stallMin: 150, stallMax: 300, every: 5 },
  bad: { lat: 30, jit: 40, stallMin: 500, stallMax: 500, every: 5 },
};

/** Parse a NetEm spec. @returns {{lat, jit, stallMin, stallMax, every}} */
export function parseNetEm(spec) {
  const key = String(spec || '').trim().toLowerCase();
  if (PROFILES[key]) return { ...PROFILES[key] };
  const p = { lat: 0, jit: 0, stallMin: 0, stallMax: 0, every: 0 };
  for (const part of key.split(',')) {
    const [k, v] = part.split(':');
    if (!v) continue;
    if (k === 'lat') p.lat = Math.max(0, parseFloat(v) || 0);
    else if (k === 'jit') p.jit = Math.max(0, parseFloat(v) || 0);
    else if (k === 'stall') {
      const m = /^(\d+)(?:-(\d+))?@(\d+(?:\.\d+)?)$/.exec(v);
      if (m) {
        p.stallMin = +m[1];
        p.stallMax = m[2] ? +m[2] : +m[1];
        p.every = +m[3];
      }
    }
  }
  return p;
}

class Lane {
  constructor() {
    this.q = [];          // {at, deliver, u8, key}
    this.lastAt = 0;
  }
}

export class NetEm {
  /** @param {string} spec @param {number} [seed=1] */
  constructor(spec, seed = 1) {
    this.spec = String(spec);
    this.p = parseNetEm(spec);
    this.rand = mulberry32(seed >>> 0 || 1);
    this.inLane = new Lane();
    this.outLane = new Lane();
    this._stallUntil = 0;
    this._nextStall = 0;
    this._timer = 0;
    this.stats = { inbound: 0, outbound: 0, conflated: 0, stalls: 0 };
  }

  /** Switch profiles mid-run (scenarios). */
  setProfile(spec) {
    this.spec = String(spec);
    this.p = parseNetEm(spec);
    this._nextStall = 0;
  }

  _delay(now) {
    const p = this.p;
    if (p.every > 0) {
      if (!this._nextStall) this._nextStall = now + p.every * 1000 * (0.5 + this.rand() * 0.5);
      if (now >= this._nextStall) {
        this._stallUntil = now + p.stallMin + this.rand() * (p.stallMax - p.stallMin);
        this._nextStall = now + p.every * 1000;
        this.stats.stalls++;
      }
    }
    const base = p.lat + (this.rand() * 2 - 1) * p.jit;
    return Math.max(0, base);
  }

  _queue(lane, u8, deliver, key) {
    const now = performance.now();
    let at = now + this._delay(now);
    if (at < this._stallUntil) at = this._stallUntil + this.rand() * 2;
    if (at < lane.lastAt) at = lane.lastAt;   // FIFO per direction
    lane.lastAt = at;
    if (key >= 0) {
      for (let i = 0; i < lane.q.length; i++) {
        const e = lane.q[i];
        if (e.key === key) { e.u8 = u8; e.deliver = deliver; this.stats.conflated++; this._arm(); return; }
      }
    }
    lane.q.push({ at, deliver, u8, key });
    this._arm();
  }

  /** Delay an inbound packet; `deliver(from, u8, releasedAtMs)` runs when it is released. */
  inbound(from, u8, deliver) {
    this.stats.inbound++;
    this._queue(this.inLane, u8, () => deliver(from, u8, performance.now()), -1);
  }

  /** Delay an outbound packet (copied: senders reuse their buffers); `sendFn(u8)` runs when it is released. */
  outbound(sendFn, u8) {
    this.stats.outbound++;
    const copy = u8.slice();
    const key = copy.length > 1 && copy[1] >= LATEST_WINS ? (copy[0] << 8) | copy[1] : -1;
    this._queue(this.outLane, copy, () => sendFn(copy), key);
  }

  /** Release every due packet in FIFO order (stops at the first one still waiting). */
  poll(now = performance.now()) {
    for (const lane of [this.inLane, this.outLane]) {
      const q = lane.q;
      let n = 0;
      while (n < q.length && q[n].at <= now) n++;
      if (!n) continue;
      const due = q.splice(0, n);
      for (const e of due) {
        try { e.deliver(); } catch (err) { console.error('[netem] delivery failed', err); }
      }
    }
    if (!this.inLane.q.length && !this.outLane.q.length && this._timer) {
      clearInterval(this._timer);
      this._timer = 0;
    }
  }

  _arm() {
    if (!this._timer) this._timer = setInterval(() => this.poll(), 2);
  }

  /** Drop everything queued (leaving a session). */
  clear() {
    this.inLane.q.length = 0;
    this.outLane.q.length = 0;
    if (this._timer) clearInterval(this._timer);
    this._timer = 0;
  }
}
