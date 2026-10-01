/**
 * Byte-exact binary codecs of the two state streams (little-endian, see protocol.js for the 2-byte header):
 *
 * CSTATE (client -> host, 62 bytes, latest-wins): the client's own body, weapon and inventory summary.
 *   0 route u8 | 1 type u8 | 2 epoch u8 | 3 spawnSeq u8 | 4 seq u16 | 6 tHost u32 | 10 pos f32x3 | 22 vel i16x3 cm/s |
 *   28 yaw u16 | 30 pitch i16 | 32 height u8 | 33 flags u16 | 35 flags2 u8 | 36 weapon u8 | 37 ads u8 | 38 charge u8 |
 *   39 grapplePoint i16x3 cm | 45 beamEnd i16x3 cm | 51 ownedMask u16 | 53 reserveFullMask u16 | 55 nades u8x5 |
 *   60 grantAck u8 | 61 cg u8
 *
 * SNAPSHOT (host -> one client, latest-wins): a per-recipient header + own block (34 bytes), then a body shared by
 * every recipient of the tick: N entity records and TLV sections (u8 id, u16 len, bytes) closed by id 0.
 *   0 route | 1 type | 2 epoch | 3 flags (b0 scores keyframe, b1 30 Hz fallback) | 4 snapSeq u32 | 8 tHost u32 |
 *   12 ackSeq u16 | 14 timeLeft u16 ds (0xFFFF none) | 16 teamScore1 u16 | 18 teamScore2 u16 | 20 phase u8 |
 *   21 ownId u8 | 22 health u8 | 23 armor u8 | 24 ownFlags u8 (b0 alive, b1 protected, b2 shocked, b3 held) |
 *   25 protectedUntil u32 | 29 shockedUntil u32 | 33 N u8
 *   entity (22 bytes + optional parts): id u8 | flags u16 | flags2 u8 | pos i16x3 cm | vel i16x3 cm/s | yaw u16 |
 *   pitch i16 | height u8 | weapon u8 | [grapplePoint i16x3 if grappleState] | [beamEnd i16x3 if beaming] |
 *   [charge u8 if charging] | [kills u16, deaths u16, tier u8, zoneTime u16 ds if flags2.hasScore]
 */
import {
  BinaryWriter, BinaryReader, HEADER_BYTES, packCm, unpackCm, packAngle, unpackAngle, packPitch, unpackPitch, packUnit, unpackUnit,
} from './protocol.js';
import { PKT, NADE_ORDER } from './GameProtocol.js';

export { BinaryWriter, BinaryReader };

const clamp8 = v => (v < 0 ? 0 : v > 255 ? 255 : v);

/** Quantizers (wire <-> float). */
export const Q = {
  pos: packCm, unpos: unpackCm,
  vel: packCm, unvel: unpackCm,
  yaw: packAngle, unyaw: unpackAngle,
  pitch: packPitch, unpitch: unpackPitch,
  /** capsule height 1.15..1.80 m -> u8 */
  h: m => clamp8(Math.round((m - 1.15) / 0.65 * 255)),
  unh: u => 1.15 + (u / 255) * 0.65,
  u8f: packUnit, unu8f: unpackUnit,
};

/** CSTATE flags (u16). */
export const CF = Object.freeze({
  TELEPORT: 1 << 0, GROUND: 1 << 1, CROUCH: 1 << 2, SLIDE: 1 << 3, WALLRUN: 1 << 4, MANTLE: 1 << 5, SPRINT: 1 << 6,
  FIRING: 1 << 7, RELOAD: 1 << 8, BEAM: 1 << 9, CHARGE: 1 << 10, AIM: 1 << 11, SWITCH: 1 << 12, THROW: 1 << 13,
  MELEE: 1 << 14, WALL_RIGHT: 1 << 15,
});

/** Snapshot entity flags (u16). */
export const EF = Object.freeze({
  ALIVE: 1 << 0, GROUND: 1 << 1, CROUCH: 1 << 2, SLIDE: 1 << 3, WALLRUN: 1 << 4, MANTLE: 1 << 5, SPRINT: 1 << 6,
  FIRING: 1 << 7, RELOAD: 1 << 8, BEAM: 1 << 9, CHARGE: 1 << 10, AIM: 1 << 11, SHOCKED: 1 << 12, PROTECTED: 1 << 13,
  TELEPORT: 1 << 14, LAGGING: 1 << 15,
});

/** Snapshot entity flags2 (u8): b0-1 grapple state (0 idle, 1 flying, 2 attached, 3 retract). */
export const EF2 = Object.freeze({ GRAPPLE_MASK: 0x03, DISCONNECTED: 1 << 2, HAS_SCORE: 1 << 3, HELD: 1 << 4 });

/** Snapshot own-block flags. */
export const OWN = Object.freeze({ ALIVE: 1 << 0, PROTECTED: 1 << 1, SHOCKED: 1 << 2, HELD: 1 << 3 });

/** Snapshot header flags. */
export const SF = Object.freeze({ KEYFRAME: 1 << 0, FALLBACK: 1 << 1 });

/** Snapshot match phase byte. */
export const PHASE_CODE = Object.freeze({ countdown: 0, live: 1, over: 2 });
export const PHASE_BY_CODE = Object.freeze(['countdown', 'live', 'over']);

export const CSTATE_BYTES = 62;
export const SNAP_HEADER_BYTES = 34;
export const ENTITY_BYTES = 22;
export const TIME_NONE = 0xffff;

/** A reusable plain object with every CSTATE field (decode target / encode source). */
export function makeClientState() {
  return {
    epoch: 0, spawnSeq: 0, seq: 0, tHost: 0,
    px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, h: 1.8,
    flags: 0, flags2: 0, weapon: 0, ads: 0, charge: 0,
    gx: 0, gy: 0, gz: 0, bx: 0, by: 0, bz: 0,
    owned: 0, full: 0, nades: [0, 0, 0, 0, 0], grantAck: 0, cg: 0,
  };
}

/**
 * Write a CSTATE packet. @param {BinaryWriter} w @param {object} st makeClientState-shaped
 * @returns {number} byte length (62)
 */
export function encodeClientState(w, st) {
  w.begin(PKT.CSTATE);
  w.u8(st.epoch & 255).u8(st.spawnSeq & 255).u16(st.seq & 0xffff).u32(Math.max(0, Math.round(st.tHost)) >>> 0);
  w.f32(st.px).f32(st.py).f32(st.pz);
  w.i16(Q.vel(st.vx)).i16(Q.vel(st.vy)).i16(Q.vel(st.vz));
  w.u16(Q.yaw(st.yaw)).i16(Q.pitch(st.pitch)).u8(Q.h(st.h));
  w.u16(st.flags & 0xffff).u8(st.flags2 & 255).u8(st.weapon & 255).u8(Q.u8f(st.ads)).u8(Q.u8f(st.charge));
  w.i16(Q.pos(st.gx)).i16(Q.pos(st.gy)).i16(Q.pos(st.gz));
  w.i16(Q.pos(st.bx)).i16(Q.pos(st.by)).i16(Q.pos(st.bz));
  w.u16(st.owned & 0xffff).u16(st.full & 0xffff);
  for (let i = 0; i < 5; i++) w.u8(clamp8(st.nades[i] | 0));
  w.u8(st.grantAck & 255).u8(st.cg & 255);
  return w.length;
}

/**
 * Read a CSTATE packet into `out` (makeClientState-shaped). @param {BinaryReader} r reset() to the packet
 * @returns {boolean} false if the packet is short
 */
export function decodeClientState(r, out) {
  out.epoch = r.u8(); out.spawnSeq = r.u8(); out.seq = r.u16(); out.tHost = r.u32();
  out.px = r.f32(); out.py = r.f32(); out.pz = r.f32();
  out.vx = Q.unvel(r.i16()); out.vy = Q.unvel(r.i16()); out.vz = Q.unvel(r.i16());
  out.yaw = Q.unyaw(r.u16()); out.pitch = Q.unpitch(r.i16()); out.h = Q.unh(r.u8());
  out.flags = r.u16(); out.flags2 = r.u8(); out.weapon = r.u8(); out.ads = Q.unu8f(r.u8()); out.charge = Q.unu8f(r.u8());
  out.gx = Q.unpos(r.i16()); out.gy = Q.unpos(r.i16()); out.gz = Q.unpos(r.i16());
  out.bx = Q.unpos(r.i16()); out.by = Q.unpos(r.i16()); out.bz = Q.unpos(r.i16());
  out.owned = r.u16(); out.full = r.u16();
  for (let i = 0; i < 5; i++) out.nades[i] = r.u8();
  out.grantAck = r.u8(); out.cg = r.u8();
  return !r.overflow && Number.isFinite(out.px) && Number.isFinite(out.py) && Number.isFinite(out.pz);
}

// ------------------------------------------------------------------------------------------------ snapshots

/** A reusable plain object with every entity-record field. */
export function makeEntityRecord() {
  return {
    id: 0, flags: 0, flags2: 0, px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, h: 1.8, weapon: 0,
    gx: 0, gy: 0, gz: 0, bx: 0, by: 0, bz: 0, charge: 0, kills: 0, deaths: 0, tier: 0, zoneTime: 0,
  };
}

/** A reusable plain object with every header / own-block field. */
export function makeSnapshotHeader() {
  return {
    epoch: 0, flags: 0, snapSeq: 0, tHost: 0, ackSeq: 0, timeLeftDs: TIME_NONE, teamScore1: 0, teamScore2: 0, phase: 0,
    ownId: 0, health: 0, armor: 0, ownFlags: 0, protectedUntil: 0, shockedUntil: 0, count: 0,
  };
}

/**
 * Snapshot body writer: entity records, then sections. Usage per tick: begin(); entity(rec) xN; section(id, fn) ...;
 * end(). The body bytes (bytes()) are appended after each recipient's header (writeSnapshot).
 */
export class SnapshotBody {
  constructor() {
    this.w = new BinaryWriter(2048);
    this.count = 0;
    this._open = false;
  }

  begin() {
    this.w.begin(0);       // the 2 header bytes are scratch: bytes() skips them
    this.count = 0;
    this._open = true;
    return this;
  }

  /** Append one entity record (makeEntityRecord-shaped; optional parts follow flags / flags2). */
  entity(e) {
    const w = this.w;
    w.u8(e.id & 255).u16(e.flags & 0xffff).u8(e.flags2 & 255);
    w.i16(Q.pos(e.px)).i16(Q.pos(e.py)).i16(Q.pos(e.pz));
    w.i16(Q.vel(e.vx)).i16(Q.vel(e.vy)).i16(Q.vel(e.vz));
    w.u16(Q.yaw(e.yaw)).i16(Q.pitch(e.pitch)).u8(Q.h(e.h)).u8(e.weapon & 255);
    if (e.flags2 & EF2.GRAPPLE_MASK) w.i16(Q.pos(e.gx)).i16(Q.pos(e.gy)).i16(Q.pos(e.gz));
    if (e.flags & EF.BEAM) w.i16(Q.pos(e.bx)).i16(Q.pos(e.by)).i16(Q.pos(e.bz));
    if (e.flags & EF.CHARGE) w.u8(Q.u8f(e.charge));
    if (e.flags2 & EF2.HAS_SCORE) {
      w.u16(Math.max(0, Math.min(0xffff, e.kills | 0))).u16(Math.max(0, Math.min(0xffff, e.deaths | 0)));
      w.u8(clamp8(e.tier | 0)).u16(Math.max(0, Math.min(0xffff, Math.round((e.zoneTime || 0) * 10))));
    }
    this.count++;
    return this;
  }

  /**
   * Append a TLV section: `fn(w)` writes its payload (u16 length patched afterwards). Ids 1..255; 0 ends the list.
   * @param {number} id @param {(w: BinaryWriter) => void} fn
   */
  section(id, fn) {
    const w = this.w;
    w.u8(id & 255);
    const lenAt = w.pos;
    w.u16(0);
    const start = w.pos;
    fn(w);
    const len = w.pos - start;
    if (len > 0xffff) throw new RangeError(`snapshot section ${id} too large (${len} bytes)`);
    w.view.setUint16(lenAt, len, true);
    return this;
  }

  /** Close the section list. */
  end() {
    this.w.u8(0);
    this._open = false;
    return this;
  }

  /** The body bytes (valid until the next begin()). */
  bytes() {
    return this.w.data.subarray(HEADER_BYTES, this.w.pos);
  }
}

/**
 * One recipient's snapshot: header + own block, then the shared body. @param {BinaryWriter} w
 * @param {object} hdr makeSnapshotHeader-shaped (count = body.count) @param {SnapshotBody} body
 * @returns {Uint8Array} the packet (a view valid until `w` is used again)
 */
export function writeSnapshot(w, hdr, body) {
  w.begin(PKT.SNAPSHOT);
  w.u8(hdr.epoch & 255).u8(hdr.flags & 255).u32(hdr.snapSeq >>> 0).u32(Math.max(0, Math.round(hdr.tHost)) >>> 0);
  w.u16(hdr.ackSeq & 0xffff).u16(hdr.timeLeftDs & 0xffff).u16(hdr.teamScore1 & 0xffff).u16(hdr.teamScore2 & 0xffff);
  w.u8(hdr.phase & 255).u8(hdr.ownId & 255).u8(clamp8(Math.ceil(hdr.health))).u8(clamp8(Math.ceil(hdr.armor)));
  w.u8(hdr.ownFlags & 255).u32(Math.max(0, Math.round(hdr.protectedUntil)) >>> 0).u32(Math.max(0, Math.round(hdr.shockedUntil)) >>> 0);
  w.u8(body.count & 255);
  w.raw(body.bytes());
  return w.finish();
}

/**
 * Decode a snapshot. `sink.header(hdr)` is called first (return false to stop), then `sink.entity(rec)` per record
 * (the same reused object every time) and `sink.section(id, r, len)` per section (the reader is positioned at the
 * payload; reading less than `len` is fine).
 * @param {BinaryReader} r reset() to the packet
 * @param {object} hdr makeSnapshotHeader-shaped target @param {object} rec makeEntityRecord-shaped target
 * @param {{header: Function, entity: Function, section?: Function}} sink
 * @returns {boolean} false if the packet was malformed
 */
export function decodeSnapshot(r, hdr, rec, sink) {
  hdr.epoch = r.u8(); hdr.flags = r.u8(); hdr.snapSeq = r.u32(); hdr.tHost = r.u32();
  hdr.ackSeq = r.u16(); hdr.timeLeftDs = r.u16(); hdr.teamScore1 = r.u16(); hdr.teamScore2 = r.u16();
  hdr.phase = r.u8(); hdr.ownId = r.u8(); hdr.health = r.u8(); hdr.armor = r.u8();
  hdr.ownFlags = r.u8(); hdr.protectedUntil = r.u32(); hdr.shockedUntil = r.u32(); hdr.count = r.u8();
  if (r.overflow) return false;
  if (sink.header(hdr) === false) return true;
  for (let i = 0; i < hdr.count; i++) {
    rec.id = r.u8(); rec.flags = r.u16(); rec.flags2 = r.u8();
    rec.px = Q.unpos(r.i16()); rec.py = Q.unpos(r.i16()); rec.pz = Q.unpos(r.i16());
    rec.vx = Q.unvel(r.i16()); rec.vy = Q.unvel(r.i16()); rec.vz = Q.unvel(r.i16());
    rec.yaw = Q.unyaw(r.u16()); rec.pitch = Q.unpitch(r.i16()); rec.h = Q.unh(r.u8()); rec.weapon = r.u8();
    if (rec.flags2 & EF2.GRAPPLE_MASK) { rec.gx = Q.unpos(r.i16()); rec.gy = Q.unpos(r.i16()); rec.gz = Q.unpos(r.i16()); }
    else rec.gx = rec.gy = rec.gz = 0;
    if (rec.flags & EF.BEAM) { rec.bx = Q.unpos(r.i16()); rec.by = Q.unpos(r.i16()); rec.bz = Q.unpos(r.i16()); }
    else rec.bx = rec.by = rec.bz = 0;
    rec.charge = rec.flags & EF.CHARGE ? Q.unu8f(r.u8()) : 0;
    if (rec.flags2 & EF2.HAS_SCORE) {
      rec.kills = r.u16(); rec.deaths = r.u16(); rec.tier = r.u8(); rec.zoneTime = r.u16() / 10;
    }
    if (r.overflow) return false;
    sink.entity(rec);
  }
  for (;;) {
    const id = r.u8();
    if (r.overflow) return false;
    if (id === 0) break;
    const len = r.u16();
    const start = r.pos;
    if (r.overflow || start + len > r.end) return false;
    if (sink.section) sink.section(id, r, len);
    r.pos = start + len;
  }
  return true;
}

/** Grenade counts in wire order from a {type: count} table. */
export function nadesToWire(table, out) {
  for (let i = 0; i < 5; i++) out[i] = table ? table[NADE_ORDER[i]] | 0 : 0;
  return out;
}
