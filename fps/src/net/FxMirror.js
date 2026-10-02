/**
 * Presentation mirroring (online only). One-shot effects and positional sounds made by this machine's simulation
 * (host: bots, projectiles, explosions, pickups; every machine: its own player's weapons) are captured as compact
 * records while a capture window is open, sent with the frame's messages and replayed on the other machines on the
 * entity timeline (the time their avatars show). Continuous visuals (beams, ropes, trails, poses, footsteps) are
 * derived from replicated state instead and never captured; local feedback (camera shake, viewmodel, hit markers,
 * UI sounds) never leaves the machine.
 *
 * Rules: only the outermost wrapped call records (an effect's own nested effects / sounds replay with it); nothing is
 * captured while game events are dispatched, during Combat.kill / onDeath or during a replay; records whose start point
 * sits at the anchor entity's muzzle replay from that entity's avatar muzzle on the receiver.
 * Design: docs/multiplayer/MULTIPLAYER_CONTRACT.md section 6.
 */
import * as THREE from 'three';
import { TWIN_SOUNDS, NET } from './GameProtocol.js';
import { getRailBeams } from '../fx/RailBeam.js';

/** Sounds the receivers derive themselves from replicated movement (never captured in the simulation window). */
const DERIVED_SOUNDS = new Set(['footstep', 'jump', 'double_jump', 'wall_jump', 'land', 'land_hard', 'mantle', 'bot_death', 'jumppad', 'death']);
const ANCHOR_M2 = 0.35 * 0.35;
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _m = new THREE.Vector3();
const _q = new THREE.Vector3();
const r2 = v => Math.round(v * 100) / 100;
const r3 = v => Math.round(v * 1000) / 1000;
const P = v => [r2(v.x), r2(v.y), r2(v.z)];
const N = v => (v ? [r3(v.x), r3(v.y), r3(v.z)] : null);
const colorInt = c => (c == null ? null : typeof c === 'number' ? c : new THREE.Color(c).getHex());
const V = (arr, i, out) => out.set(arr[i], arr[i + 1], arr[i + 2]);

/** Plain JSON copy of an options object (numbers, booleans, strings, number arrays; colours as ints). */
function plain(o) {
  if (!o || typeof o !== 'object') return null;
  const out = {};
  for (const k in o) {
    const v = o[k];
    if (typeof v === 'number') out[k] = Number.isFinite(v) ? Math.round(v * 1000) / 1000 : 0;
    else if (typeof v === 'boolean' || typeof v === 'string') out[k] = v;
    else if (v && v.isColor) out[k] = v.getHex();
    else if (Array.isArray(v) || ArrayBuffer.isView(v)) out[k] = Array.from(v, x => (typeof x === 'number' ? Math.round(x * 1000) / 1000 : 0));
  }
  return out;
}

export class FxMirror {
  /** @param {object} game */
  constructor(game) {
    this.game = game;
    /** Entity whose muzzle anchors muzzle-origin records (BotManager sets it while a bot updates). */
    this.anchor = 0;
    this.stats = { captured: 0, replayed: 0, dropped: 0, late: 0, batches: 0 };
    this._installed = false;
    this._open = false;
    this._kind = '';
    this._origin = 0;
    this._twins = false;
    this._depth = 0;
    this._suspend = 0;
    this._rec = [];
    /** finished batches waiting to be sent: {o, t, r} */
    this.out = [];
    this._orig = [];
    this._fn = Object.create(null);
    this._queue = [];
  }

  // ------------------------------------------------------------------ install

  install() {
    if (this._installed) return;
    this._installed = true;
    const g = this.game, fx = g.effects;
    const rb = getRailBeams(g);
    const gfx = g.projectiles && g.projectiles.types && g.projectiles.types.fx;
    const self = this;
    // effects: [record kind, object, method, toRecord(args) (start point first when it can be muzzle-anchored)]
    this._wrap('I', fx, 'impact', (p, n, s) => [...P(p), ...N(n), s || 'concrete']);
    this._wrap('H', fx, 'hitSpark', (p, n, e) => [...P(p), ...(N(n) || [0, 1, 0]), e && e.id ? e.id : 0]);
    this._wrap('T', fx, 'tracer', (f, t, o) => [...P(f), ...P(t), colorInt(o && o.color), o && o.width ? r3(o.width) : null], 0);
    this._wrap('M', fx, 'muzzleFlash', (p, d, o) => [...P(p), ...N(d), o && o.scale ? r3(o.scale) : 1, colorInt(o && o.color)], 0);
    this._wrap('L', fx, 'flashLight', (p, c, i, dist, dur) => [...P(p), colorInt(c), r2(i), r2(dist), r3(dur)]);
    this._wrap('X', fx, 'explosion', (p, o) => [...P(p), r2((o && o.radius) || 5), N(o && o.normal)]);
    this._wrap('D', fx, 'dust', (p, o) => [...P(p), r2((o && o.amount) || 1)]);
    this._wrap('B', fx, 'lightning', (f, t, o) => [...P(f), ...P(t), plain(o)], 0);
    this._wrap('A', fx, 'arcHit', (p, n, e) => [...P(p), N(n), e && e.id ? e.id : 0]);
    this._wrap('G', fx, 'galeBlast', (o, d, opt) => [...P(o), ...N(d), plain(opt)], 0);
    this._wrap('R', fx, 'galeRing', (p, n, o) => [...P(p), ...(N(n) || [0, 1, 0]), plain(o)]);
    if (rb) {
      this._wrap('RB', rb, 'add', (f, t, o) => [...P(f), ...P(t), r3((o && o.power) ?? 1)], 0);
      this._wrap('RR', rb, 'rings', (f, d, len, pw) => [...P(f), ...N(d), r2(len), r3(pw)], 0);
      this._wrap('RI', rb, 'impact', (p, n, pw) => [...P(p), ...(N(n) || [0, 1, 0]), r3(pw)]);
    }
    if (gfx) {
      this._wrap('VC', gfx, 'vortexCollapse', (c, R) => [...P(c), r2(R)]);
      this._wrap('SB', gfx, 'staticBurst', (c, chests, R) => [...P(c), (chests || []).slice(0, 16).map(P), r2(R)]);
      this._wrap('KB', gfx, 'kineticBlast', (c, R) => [...P(c), r2(R)]);
      this._wrap('SP', gfx, 'splat', p => [...P(p)]);
      this._wrap('SC', gfx, 'smokeCloud', (c, r, d) => [...P(c), r2(r), r2(d)]);
      this._wrap('GB', gfx, 'bolt', (f, t, o) => [...P(f), ...P(t), plain(o)], 0);
    }
    // audio: positional one-shots; non-positional weapon sounds only as "twins" of the local shooter
    const audio = g.audio;
    const playOrig = audio.play;
    this._fn.play = (...args) => playOrig.apply(audio, args);
    audio.play = function (name, opts) {
      if (self._open && self._depth === 0 && self._suspend === 0) {
        const pos = opts && opts.position;
        if (pos) {
          if (!(self._kind === 'sim' && DERIVED_SOUNDS.has(name))) {
            self._push(['P', name, ...P(pos), r3((opts && opts.volume) ?? 1), r3((opts && opts.rate) ?? 1)]);
          }
        } else if (self._twins && TWIN_SOUNDS.has(name)) {
          self._push(['S', name, r3((opts && opts.volume) ?? 1), r3((opts && opts.rate) ?? 1)]);
        }
      }
      self._depth++;
      try { return playOrig.call(this, name, opts); } finally { self._depth--; }
    };
    this._orig.push([audio, 'play', playOrig]);
    // no capture while game events are dispatched (HUD, scoring, kill feeds react locally on every machine)
    const ev = g.events;
    const emitOrig = ev.emit;
    ev.emit = function (...args) {
      self._suspend++;
      try { return emitOrig.apply(this, args); } finally { self._suspend--; }
    };
    this._orig.push([ev, 'emit', emitOrig]);
  }

  uninstall() {
    for (let i = this._orig.length - 1; i >= 0; i--) {
      const [obj, name, fn] = this._orig[i];
      obj[name] = fn;
    }
    this._orig.length = 0;
    this._fn = Object.create(null);
    this._installed = false;
    this._open = false;
    this._queue.length = 0;
    this.out.length = 0;
  }

  /**
   * Wrap obj[name]: inside an open window the outermost call is recorded as [kind, ...toRecord(args), anchor?].
   * `anchorAt` = index (in toRecord's output) of the start point that may sit at the anchor's muzzle, or undefined.
   */
  _wrap(kind, obj, name, toRecord, anchorAt) {
    const orig = obj && obj[name];
    if (typeof orig !== 'function') return;
    const self = this;
    this._fn[kind] = (...args) => orig.apply(obj, args);
    obj[name] = function (...args) {
      if (self._open && self._depth === 0 && self._suspend === 0 && !(kind === 'L' && self._kind === 'weapons')) {
        try {
          const rec = [kind, ...toRecord(...args)];
          if (anchorAt !== undefined) rec.push(self._anchorOf(rec[1 + anchorAt], rec[2 + anchorAt], rec[3 + anchorAt]));
          self._push(rec);
        } catch (err) {
          self.stats.dropped++;
        }
      }
      self._depth++;
      try { return orig.apply(this, args); } finally { self._depth--; }
    };
    this._orig.push([obj, name, orig]);
  }

  _push(rec) {
    this._rec.push(rec);
    this.stats.captured++;
  }

  /** The anchor entity id when (x, y, z) is at its muzzle, else 0. */
  _anchorOf(x, y, z) {
    const g = this.game;
    const id = this._kind === 'weapons' ? g.player.id : this.anchor;
    if (!id) return 0;
    _q.set(x, y, z);
    if (this._kind === 'weapons') {
      const w = g.weapons;
      if (w && typeof w._muzzleWorld === 'function') {
        w._muzzleWorld(_m);
        return _m.distanceToSquared(_q) < ANCHOR_M2 ? id : 0;
      }
      return 0;
    }
    const e = g.getEntityById(id);
    if (!e || !e.model || typeof e.model.getMuzzleWorldPosition !== 'function') return 0;
    e.model.getMuzzleWorldPosition(_m);
    return _m.distanceToSquared(_q) < ANCHOR_M2 ? id : 0;
  }

  // ------------------------------------------------------------------ capture windows

  /**
   * Open a capture window. kind 'weapons' (this machine's player: twins allowed, no lights) or 'sim' (host
   * simulation: derived movement sounds excluded). Windows never nest.
   * @param {'weapons'|'sim'} kind @param {number} originId entity id of the batch origin (0 = host simulation)
   */
  open(kind, originId) {
    if (!this._installed || this._open) return;
    this._open = true;
    this._kind = kind;
    this._origin = originId | 0;
    this._twins = kind === 'weapons';
    this._rec = [];
  }

  /** Close the window: its records become a batch for this frame's messages. */
  close() {
    if (!this._open) return;
    this._open = false;
    this.anchor = 0;
    if (this._rec.length) {
      this.out.push({ o: this._origin, t: Math.round(this.game.net.clock.hostNowMs()), r: this._rec });
      this.stats.batches++;
    }
    this._rec = [];
  }

  /** Suspend capture (nesting): Combat.kill / onDeath, storm, replays. */
  suspend() { this._suspend++; }
  resume() { this._suspend = Math.max(0, this._suspend - 1); }

  /** Batches captured since the last take(). */
  take() {
    if (!this.out.length) return null;
    const b = this.out;
    this.out = [];
    return b;
  }

  // ------------------------------------------------------------------ replay

  /**
   * Queue a received batch for replay when `timeline()` (host net ms) reaches its time.
   * @param {{t: number, r: any[][]}} batch @param {number} originId @param {() => number} timeline
   */
  schedule(batch, originId, timeline) {
    if (!batch || !Array.isArray(batch.r)) return;
    const q = this._queue;
    const t = Number(batch.t) || 0;
    let i = q.length;
    while (i > 0 && q[i - 1].t > t) i--;
    q.splice(i, 0, { t, r: batch.r, o: originId | 0, timeline });
  }

  /** Replay every due batch (net.updateRemotes). */
  drain() {
    const q = this._queue;
    if (!q.length) return;
    const now = this.game.net.clock.hostNowMs();
    let k = 0;
    for (; k < q.length; k++) {
      const b = q[k];
      const due = b.t <= b.timeline();
      const late = now - b.t > NET.INTERP_MAX_MS + 250;
      if (!due && !late) break;
      if (late && !due) this.stats.late++;
      this.replay(b.r, b.o);
    }
    if (k) q.splice(0, k);
  }

  /** Call the ORIGINAL effect / sound functions for these records (never captured). */
  replay(records, originId) {
    const g = this.game, f = this._fn;
    this._suspend++;
    try {
      for (const rec of records) {
        if (!Array.isArray(rec)) continue;
        try {
          this._replayOne(rec, originId, g, f);
          this.stats.replayed++;
        } catch (err) {
          this.stats.dropped++;
        }
      }
    } finally {
      this._suspend--;
    }
  }

  /** Start point of an anchored record: the anchor's avatar muzzle when it is another machine's fighter. */
  _start(rec, i, anchorId, out) {
    V(rec, i, out);
    if (!anchorId) return out;
    const g = this.game;
    const e = g.getEntityById(anchorId);
    if (!e || e === g.player || !e.avatar || !e.alive) return out;
    return e.avatar.muzzle(e, out);
  }

  _replayOne(rec, originId, g, f) {
    const ent = id => (id ? g.getEntityById(id) : null);
    switch (rec[0]) {
      case 'I': f.I(V(rec, 1, _a), V(rec, 4, _b), rec[7]); break;
      case 'H': f.H(V(rec, 1, _a), V(rec, 4, _b), ent(rec[7])); break;
      case 'T': {
        const from = this._start(rec, 1, rec[9], _a);
        f.T(from, V(rec, 4, _b), { color: rec[7] ?? undefined, width: rec[8] ?? undefined });
        break;
      }
      case 'M': f.M(this._start(rec, 1, rec[9], _a), V(rec, 4, _b), { scale: rec[7], color: rec[8] ?? undefined }); break;
      case 'L': f.L(V(rec, 1, _a), rec[4], rec[5], rec[6], rec[7]); break;
      case 'X': f.X(V(rec, 1, _a), { radius: rec[4], normal: rec[5] ? _b.fromArray(rec[5]) : null }); break;
      case 'D': f.D(V(rec, 1, _a), { amount: rec[4] }); break;
      case 'B': f.B(this._start(rec, 1, rec[8], _a), V(rec, 4, _b), rec[7] || undefined); break;
      case 'A': f.A(V(rec, 1, _a), rec[4] ? _b.fromArray(rec[4]) : null, ent(rec[5])); break;
      case 'G': f.G(this._start(rec, 1, rec[8], _a), V(rec, 4, _b), rec[7] || undefined); break;
      case 'R': f.R(V(rec, 1, _a), V(rec, 4, _b), rec[7] || undefined); break;
      case 'RB': f.RB(this._start(rec, 1, rec[8], _a), V(rec, 4, _b), { power: rec[7] }); break;
      case 'RR': f.RR(this._start(rec, 1, rec[9], _a), V(rec, 4, _b), rec[7], rec[8]); break;
      case 'RI': f.RI(V(rec, 1, _a), V(rec, 4, _b), rec[7]); break;
      case 'VC': f.VC(V(rec, 1, _a), rec[4]); break;
      case 'SB': f.SB(V(rec, 1, _a), (rec[4] || []).map(c => new THREE.Vector3(c[0], c[1], c[2])), rec[5]); break;
      case 'KB': f.KB(V(rec, 1, _a), rec[4]); break;
      case 'SP': f.SP(V(rec, 1, _a)); break;
      case 'SC': f.SC(V(rec, 1, _a), rec[4], rec[5]); break;
      case 'GB': f.GB(this._start(rec, 1, rec[8], _a), V(rec, 4, _b), rec[7] || undefined); break;
      case 'P': f.play(rec[1], { position: V(rec, 2, _c).clone(), volume: rec[5], rate: rec[6] }); break;
      case 'S': {
        // a twin: the shooter's own (non-positional) weapon sound, heard at its avatar
        const e = ent(originId);
        if (!e || e === g.player || !e.avatar) break;
        f.play(rec[1], { position: e.avatar.muzzle(e, new THREE.Vector3()), volume: 0.9 * (rec[2] ?? 1), rate: rec[3] ?? 1 });
        break;
      }
      default:
        this.stats.dropped++;
    }
  }
}
