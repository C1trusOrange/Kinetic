/**
 * KINETIC network protocol: constants shared with the LAN relay (tools/netserver.py) plus helpers to
 * build and read binary packets without per-message allocations.
 *
 * Every binary packet starts with a 2-byte header:
 *   byte 0  routing. A client writes HOST_PEER (0) and the relay replaces it with the sender's peer id
 *           (1..254) before the host receives it; the host writes one client id or BROADCAST (255).
 *           Transports fill this byte in (sendToHost / sendTo / broadcast).
 *   byte 1  packet type (PKT). Types >= LATEST_WINS are latest-wins: while a receiver's socket is backed
 *           up, the relay keeps only the newest unsent packet per (sender, type), so snapshots never
 *           queue up behind each other. Never use them for data that must arrive. Latest-wins packets can
 *           overtake reliable ones only while a socket is backed up.
 * Multi-byte fields are little-endian. The relay routes packets blindly; everything after byte 1 is
 * defined by the game.
 */

/** Game protocol version: sent with host/join; the relay refuses joins whose version differs from the host's. */
export const PROTOCOL_VERSION = 1;
/** WebSocket endpoint of the relay (same host and port as the page). */
export const RELAY_PATH = '/ws';
export const HOST_PEER = 0;
export const BROADCAST = 255;
export const MAX_PEER = 254;
export const HEADER_BYTES = 2;
/** Packet types >= this are latest-wins (conflated by the relay when the receiver is backed up). */
export const LATEST_WINS = 0x80;

/** Packet types (byte 1). 0x01-0x7F reliable, 0x80-0xFF latest-wins. */
export const PKT = Object.freeze({
  INPUT: 0x01,     // client -> host: input commands
  PING: 0x02,      // app-level ping, body [seq u32, time f64]; the receiver answers PONG with the same body
  PONG: 0x03,
  JSON: 0x10,      // reliable UTF-8 JSON body (lobby, roster, match config, chat): low rate only
  EVENT: 0x11,     // reliable binary game events (fire, damage, death, ...)
  SNAPSHOT: 0x81,  // host -> client world state (latest-wins)
});

/** WebSocket close codes used by the relay. */
export const CLOSE = Object.freeze({
  NORMAL: 1000,
  GOING_AWAY: 1001,     // idle timeout / server stopping / page closed
  PROTOCOL: 1002,
  INVALID_DATA: 1007,
  TOO_BIG: 1009,        // message > 1 MiB
  INTERNAL: 1011,
  SLOW: 1013,           // more than 2 MiB queued for this receiver
  ROOM_CLOSED: 4000,    // the host left
  KICKED: 4001,
  REPLACED: 4002,       // the same token joined on another connection
});

/** Room codes: 4 letters from 20 consonants (no words, no I/O vs 1/0 mix-ups). */
export const CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';
export const CODE_LENGTH = 4;

/** A room code as typed by a player: upper-cased, spaces / dashes / punctuation removed. */
export function normalizeCode(text) {
  return String(text ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** True for a well-formed room code (after normalizeCode). */
export function isValidCode(code) {
  if (typeof code !== 'string' || code.length !== CODE_LENGTH) return false;
  for (const ch of code) if (!CODE_ALPHABET.includes(ch)) return false;
  return true;
}

/** True if packets of this type are latest-wins. */
export function isLatestWins(type) {
  return type >= LATEST_WINS;
}

const VIEW_CACHE_MAX = 64;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Reusable packet builder. begin(type) -> write fields -> finish() returns a Uint8Array view that stays
 * valid until the writer is used again (transports copy it synchronously when sending). The buffer only
 * grows (rarely); finished views are cached per length, so steady-state packets allocate nothing.
 */
export class BinaryWriter {
  /** @param {number} [capacity=1024] initial size in bytes */
  constructor(capacity = 1024) {
    this._alloc(Math.max(16, capacity | 0));
    this.pos = 0;
  }

  _alloc(size) {
    this.buffer = new ArrayBuffer(size);
    this.data = new Uint8Array(this.buffer);
    this.view = new DataView(this.buffer);
    this._views = new Map();
  }

  _need(n) {
    if (this.pos + n <= this.data.length) return;
    let size = this.data.length * 2;
    while (size < this.pos + n) size *= 2;
    const old = this.data;
    this._alloc(size);
    this.data.set(old);
  }

  /** Start a packet of `type` (PKT.*); byte 0 is filled in by the transport. */
  begin(type) {
    this.data[0] = 0;
    this.data[1] = type;
    this.pos = HEADER_BYTES;
    return this;
  }

  /** Bytes written so far (header included). */
  get length() {
    return this.pos;
  }

  u8(v) { this._need(1); this.data[this.pos++] = v; return this; }
  i8(v) { this._need(1); this.data[this.pos++] = v & 0xff; return this; }
  bool(v) { return this.u8(v ? 1 : 0); }
  u16(v) { this._need(2); this.view.setUint16(this.pos, v, true); this.pos += 2; return this; }
  i16(v) { this._need(2); this.view.setInt16(this.pos, v, true); this.pos += 2; return this; }
  u32(v) { this._need(4); this.view.setUint32(this.pos, v, true); this.pos += 4; return this; }
  i32(v) { this._need(4); this.view.setInt32(this.pos, v, true); this.pos += 4; return this; }
  f32(v) { this._need(4); this.view.setFloat32(this.pos, v, true); this.pos += 4; return this; }
  f64(v) { this._need(8); this.view.setFloat64(this.pos, v, true); this.pos += 8; return this; }

  /** Append raw bytes (Uint8Array). */
  raw(bytes) {
    this._need(bytes.length);
    this.data.set(bytes, this.pos);
    this.pos += bytes.length;
    return this;
  }

  /** u16 byte length + UTF-8 (allocates a little: keep strings out of per-tick packets). */
  str(s) {
    const bytes = encoder.encode(String(s));
    const n = Math.min(bytes.length, 0xffff);
    this.u16(n);
    return this.raw(n === bytes.length ? bytes : bytes.subarray(0, n));
  }

  /** The finished packet: a view of the first `length` bytes (valid until the next begin()). */
  finish() {
    let v = this._views.get(this.pos);
    if (!v) {
      v = new Uint8Array(this.buffer, 0, this.pos);
      if (this._views.size < VIEW_CACHE_MAX) this._views.set(this.pos, v);
    }
    return v;
  }
}

const scratch = new DataView(new ArrayBuffer(8));
const scratchBytes = new Uint8Array(scratch.buffer);
const EMPTY = new Uint8Array(0);

/**
 * Reusable packet reader: reset(u8) then read fields in order. Reading past the end returns 0 and sets
 * `overflow` (check it once after parsing instead of guarding every field). Allocation-free except str().
 */
export class BinaryReader {
  constructor() {
    this.data = EMPTY;
    this.pos = 0;
    this.end = 0;
    this.overflow = false;
  }

  /** Read `u8` (a packet from Transport.onMessage) starting after the header (or at `offset`). */
  reset(u8, offset = HEADER_BYTES) {
    this.data = u8;
    this.pos = offset;
    this.end = u8.length;
    this.overflow = false;
    return this;
  }

  /** Routing byte (host side: sender peer id). */
  get route() { return this.data[0]; }
  /** Packet type (PKT.*). */
  get type() { return this.data[1]; }
  /** Unread bytes. */
  get remaining() { return this.end - this.pos; }

  _take(n) {
    const p = this.pos;
    if (p + n > this.end) {
      this.overflow = true;
      this.pos = this.end;
      return -1;
    }
    this.pos = p + n;
    return p;
  }

  u8() { const p = this._take(1); return p < 0 ? 0 : this.data[p]; }
  i8() { return (this.u8() << 24) >> 24; }
  bool() { return this.u8() !== 0; }
  u16() { const p = this._take(2); if (p < 0) return 0; const d = this.data; return d[p] | (d[p + 1] << 8); }
  i16() { return (this.u16() << 16) >> 16; }
  u32() {
    const p = this._take(4);
    if (p < 0) return 0;
    const d = this.data;
    return (d[p] | (d[p + 1] << 8) | (d[p + 2] << 16) | (d[p + 3] << 24)) >>> 0;
  }
  i32() { return this.u32() | 0; }
  f32() {
    const p = this._take(4);
    if (p < 0) return 0;
    const d = this.data;
    scratchBytes[0] = d[p]; scratchBytes[1] = d[p + 1]; scratchBytes[2] = d[p + 2]; scratchBytes[3] = d[p + 3];
    return scratch.getFloat32(0, true);
  }
  f64() {
    const p = this._take(8);
    if (p < 0) return 0;
    const d = this.data;
    for (let i = 0; i < 8; i++) scratchBytes[i] = d[p + i];
    return scratch.getFloat64(0, true);
  }

  /** Skip `n` bytes. */
  skip(n) { this._take(n); return this; }

  /** Counterpart of BinaryWriter.str (allocates). */
  str() {
    const n = this.u16();
    const p = this._take(n);
    return p < 0 ? '' : decoder.decode(this.data.subarray(p, p + n));
  }
}

/** Encode a low-rate message as a JSON packet (allocates: lobby / roster / config traffic, not per tick). */
export function encodeJsonPacket(obj, type = PKT.JSON) {
  const body = encoder.encode(JSON.stringify(obj));
  const out = new Uint8Array(HEADER_BYTES + body.length);
  out[1] = type;
  out.set(body, HEADER_BYTES);
  return out;
}

/** Decode a JSON packet (throws on malformed JSON). */
export function decodeJsonPacket(u8, offset = HEADER_BYTES) {
  return JSON.parse(decoder.decode(u8.subarray(offset)));
}

// ---------------------------------------------------------------------------------------- quantization

const TAU = Math.PI * 2;
const HALF_PI = Math.PI / 2;

function clampInt(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Angle in radians (any range) -> u16 (1/65536 turn, ~0.0055 deg). */
export function packAngle(rad) {
  return Math.round(rad * (65536 / TAU)) & 0xffff;
}

/** u16 -> angle in [-PI, PI). */
export function unpackAngle(u) {
  return ((u << 16) >> 16) * (TAU / 65536);
}

/** Pitch in radians (clamped to +-PI/2) -> i16. */
export function packPitch(rad) {
  return Math.round(Math.max(-HALF_PI, Math.min(HALF_PI, rad)) * (32767 / HALF_PI));
}

/** i16 -> pitch in radians. */
export function unpackPitch(v) {
  return v * (HALF_PI / 32767);
}

/** Meters (or m/s) -> i16 centimeters (cm/s), clamped to +-327.67. */
export function packCm(m) {
  return clampInt(Math.round(m * 100), -32768, 32767);
}

/** i16 centimeters -> meters. */
export function unpackCm(v) {
  return v * 0.01;
}

/** 0..1 -> u8 (clamped). */
export function packUnit(v) {
  return clampInt(Math.round(v * 255), 0, 255);
}

/** u8 -> 0..1. */
export function unpackUnit(u) {
  return u / 255;
}

/** Signed distance a - b between u16 sequence numbers (wrap-around safe, -32768..32767). */
export function seqDelta(a, b) {
  return ((a - b) << 16) >> 16;
}

/** True if u16 sequence number `a` is newer than `b`. */
export function seqNewer(a, b) {
  return seqDelta(a, b) > 0;
}
