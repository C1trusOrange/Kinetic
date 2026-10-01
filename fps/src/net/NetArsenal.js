/**
 * Multiplayer arsenal: rockets, grenades (all types, incl. cooked off in the hand and dropped on death) and Gale blasts.
 *
 * Host: every projectile gets an id; snapshot section 2 carries all of them (kind, state, owner, position, velocity,
 * fuse). A client's rocket / grenade / cook-off / Gale blast arrives as an 'act' message and is executed here with the
 * client's RemotePlayer as the owner (the host decides damage and explosions; their effects are mirrored).
 * Clients: projectiles are shown on the entity timeline from section 2 (no local physics, no damage); the shooter's own
 * rocket is shown at once as a predicted visual-only copy (the host's copy of it is not drawn); a client's Gale self
 * push is predicted locally (it is part of its own movement); a Vortex pulls the local player from the replicated well
 * (the host never moves a body it does not simulate).
 */
import * as THREE from 'three';
import { NET, wirePos, wireDir, num, readVec } from './GameProtocol.js';
import { Q } from './NetCodec.js';
import { WEAPONS, GRENADE_TYPES } from '../weapons/WeaponDefs.js';
import { createGrenadeModel } from '../weapons/WeaponModels.js';
import { galeBlast, galeSelfPush } from '../weapons/special/gale.js';
import { updateBeamVisual } from '../weapons/special/arc.js';
import { Avatar, MF } from './Avatar.js';

const KIND = { rocket: 0, frag: 1, vortex: 2, static: 3, kinetic: 4, smoke: 5 };
const KIND_BY = ['rocket', 'frag', 'vortex', 'static', 'kinetic', 'smoke'];
const STATE = { flight: 0, deploy: 1, active: 2 };
const STATE_BY = ['flight', 'deploy', 'active'];
const IN_AIR = 0x80;   // kindState bit: a vortex deployed in the air (its well is at its position)
const UP = new THREE.Vector3(0, 1, 0);
const _fwd = new THREE.Vector3(0, 0, -1);
const _o = new THREE.Vector3();
const _v = new THREE.Vector3();
const _d = new THREE.Vector3();
const _n = new THREE.Vector3();
const _w = new THREE.Vector3();
const _warned = new Set();
function warnOnce(key, ...args) {
  if (_warned.has(key)) return;
  _warned.add(key);
  console.warn(...args);
}
const r2 = v => Math.round(v * 100) / 100;
const wireVel = v => [r2(v.x), r2(v.y), r2(v.z)];

// Other fighters' Tempest beams: drawn every frame from the replicated beam flag + end point (the beam itself is a
// continuous visual, never mirrored), with its loop and the pulsing light. Registered once for every avatar.
const _bm = new THREE.Vector3();
Avatar.decorators.push({
  update(avatar, e, dt) {
    const game = avatar.game;
    const on = (e.netFlags & MF.BEAM) !== 0 && avatar.weaponId === 'arc' && e.beamEnd && e.beamEnd.lengthSq() > 0;
    const d = avatar.deco;
    if (!on) {
      if (d.arcLoop) { d.arcLoop.stop(); d.arcLoop = null; if (e.isHuman) game.audio.play('arc_end', { position: e.position, volume: 0.6 }); }
      return;
    }
    const def = WEAPONS.arc;
    avatar.muzzle(e, _bm);
    updateBeamVisual(game, e, _bm, e.beamEnd, def);
    if (!d.arcLoop && game.audio.playLoop) d.arcLoop = game.audio.playLoop(def.loop, { volume: 0.6, position: _bm.clone() }) || null;
    if (d.arcLoop && d.arcLoop.setPosition) d.arcLoop.setPosition(_bm);
    d.arcLight = (d.arcLight || 0) + dt;
    if (d.arcLight >= 0.08) {
      d.arcLight = 0;
      game.effects.flashLight(_bm, def.flash.color, 14, 7, 0.06);
    }
  },
  stop(avatar) {
    const d = avatar.deco;
    if (d.arcLoop) { d.arcLoop.stop(); d.arcLoop = null; }
  },
});

/** @param {import('./NetSession.js').NetSession} net */
export function install(net) {
  if (net.isHost) installHost(net);
  else if (net.isClient) installClient(net);
}

// ============================================================================================== host

function installHost(net) {
  const game = net.game, proj = game.projectiles;
  const st = net.stats.custom.ars = { exec: {}, rejected: {} };
  let pidSeq = 0;
  let actCtx = null;
  const nextPid = () => (pidSeq = (pidSeq % 65535) + 1);
  // every new projectile gets an id (and, while a client action runs, that client's action number)
  const origRocket = proj.spawnRocket, origGrenade = proj.spawnGrenade;
  proj.spawnRocket = function (o) {
    const r = origRocket.call(this, o);
    if (r) { r.pid = nextPid(); r.ownerSeq = actCtx ? actCtx.seq : 0; }
    return r;
  };
  proj.spawnGrenade = function (o) {
    const g = origGrenade.call(this, o);
    if (g) { g.pid = nextPid(); g.ownerSeq = actCtx ? actCtx.seq : 0; }
    return g;
  };
  net.onEnd(() => {
    proj.spawnRocket = origRocket;
    proj.spawnGrenade = origGrenade;
  });

  net.registerSection(2, {
    encode(w) {
      const rs = proj.rockets, gs = proj.grenades;
      const n = Math.min(255, rs.length + gs.length);
      w.u8(n);
      let k = 0;
      for (let i = 0; i < rs.length && k < n; i++, k++) {
        const r = rs[i];
        w.u16(r.pid || 0).u8(KIND.rocket).u8(r.owner ? r.owner.id : 0).u8(r.ownerSeq || 0);
        w.i16(Q.pos(r.position.x)).i16(Q.pos(r.position.y)).i16(Q.pos(r.position.z));
        w.i16(Q.vel(r.direction.x * r.speed)).i16(Q.vel(r.direction.y * r.speed)).i16(Q.vel(r.direction.z * r.speed));
        w.u8(0);
      }
      for (let i = 0; i < gs.length && k < n; i++, k++) {
        const g = gs[i];
        const st = STATE[g.state] | 0;
        const inAir = st !== 0 && g.center.distanceToSquared(g.position) < 1e-4;
        w.u16(g.pid || 0).u8((KIND[g.type] | 0) | (st << 4) | (inAir ? IN_AIR : 0)).u8(g.owner ? g.owner.id : 0).u8(g.ownerSeq || 0);
        w.i16(Q.pos(g.position.x)).i16(Q.pos(g.position.y)).i16(Q.pos(g.position.z));
        w.i16(Q.vel(g.velocity.x)).i16(Q.vel(g.velocity.y)).i16(Q.vel(g.velocity.z));
        w.u8(Math.max(0, Math.min(255, Math.round(g.fuse * 50))));
        if (st !== 0) w.i8(Math.round(g.normal.x * 127)).i8(Math.round(g.normal.y * 127)).i8(Math.round(g.normal.z * 127));
      }
    },
  });

  const buckets = new Map();
  const RATE = { rocket: WEAPONS.rocket.fireRate * 1.3 + 1, nade: 3, cook: 2, gale: (WEAPONS.gale.fireRate || 2) * 1.3 + 1 };
  const allow = (peer, a) => {
    const key = peer + ':' + a, now = performance.now(), refill = RATE[a] || 2, cap = refill * NET.ACTION_BURST;
    let b = buckets.get(key);
    if (!b) buckets.set(key, b = { tokens: cap, at: now });
    b.tokens = Math.min(cap, b.tokens + (now - b.at) / 1000 * refill);
    b.at = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  };

  net.on('act', (m, peer) => {
    const rp = net.host && net.host.remoteOf(peer);
    const a = String(m.a);
    const reject = why => {
      st.rejected[why] = (st.rejected[why] || 0) + 1;
      net.send({ k: 'actx', s: m.s | 0, a, why }, peer);
      warnOnce(`act:${peer}:${why}`, `[net] action '${a}' from ${rp ? rp.name : peer} refused (${why})`);
    };
    const mt = game.match;
    if (!rp || !mt || mt.over || mt.phase === 'countdown') { reject('state'); return; }
    const now = net.clock.hostNowMs();
    const drop = a === 'nade' && !!m.drop;
    if (!rp.alive && !(drop && now - rp.deathNetMs < NET.DEATH_DROP_MS + 500)) { reject('dead'); return; }
    if (!readVec(m.o, _o)) { reject('bad'); return; }
    // the action starts at the shooter: near its reported eye, allowing for its speed and the report's age
    _w.set(rp.netPos.x, rp.netPos.y + rp.raw.h - 0.14, rp.netPos.z);
    const tol = NET.ACTION_ORIGIN_TOL_M + rp.velocity.length() * NET.ACTION_ORIGIN_VEL_K + (drop ? 2 : 0);
    if (_w.distanceTo(_o) > tol) { reject('origin'); return; }
    if (!allow(peer, a)) { reject('rate'); return; }
    const seq = ((m.s | 0) & 255) || 1;
    const fx = net.fx;
    st.exec[a] = (st.exec[a] || 0) + 1;
    actCtx = { rp, seq };
    if (fx) { fx.open('sim', 0); fx.anchor = rp.id; }   // what the action makes is replayed everywhere, the actor too
    try {
      switch (a) {
        case 'rocket':
          if (!readVec(m.d, _d) || _d.lengthSq() < 0.5) { reject('bad'); break; }
          proj.spawnRocket({ owner: rp, origin: _o.clone(), direction: _d.normalize().clone() });
          break;
        case 'nade': {
          const ty = GRENADE_TYPES[m.ty] ? m.ty : 'frag';
          if (!readVec(m.v, _v) || _v.length() > 60) { reject('bad'); break; }
          proj.spawnGrenade({ owner: rp, origin: _o.clone(), velocity: _v.clone(), fuse: Math.max(0.05, Math.min(6, num(m.f, 2.6))), type: ty });
          break;
        }
        case 'cook': {
          const ty = GRENADE_TYPES[m.ty] ? m.ty : 'frag';
          proj.detonate(ty, _o.clone(), UP, rp);
          break;
        }
        case 'gale':
          if (!readVec(m.d, _d) || _d.lengthSq() < 0.5) { reject('bad'); break; }
          galeBlast(game, rp, _o.clone(), _d.normalize().clone(), WEAPONS.gale.blast, !!m.ads, { selfPush: false });
          break;
        default:
          reject('bad');
      }
    } finally {
      actCtx = null;
      if (fx) fx.close();
    }
  });
}

// ============================================================================================== client

function installClient(net) {
  const game = net.game, client = net.client, proj = game.projectiles;
  const st = net.stats.custom.ars = { sent: {}, refused: {}, replicatedMax: 0, predictedMax: 0 };
  let seq = 0;
  /** pid -> replicated projectile on the entity timeline */
  const live = new Map();
  /** own rockets shown at once: {seq, obj, pos, dir, speed, age, stopped, hostSeen} */
  const predicted = [];
  const send = (a, fields) => {
    st.sent[a] = (st.sent[a] || 0) + 1;
    seq = (seq % 255) + 1;
    net.send({ k: 'act', a, s: seq, t: Math.round(net.clock.hostNowMs()), ...fields });
    return seq;
  };

  // ---- visuals from the shared pools (Projectiles' rocket / grenade meshes), never simulated here
  const rocketVisual = () => {
    const obj = proj._makeRocket();
    obj.group.visible = true;
    return obj;
  };
  const freeRockets = [], freeGrenades = [];
  const takeRocket = () => {
    const o = freeRockets.pop() || rocketVisual();
    o.group.visible = true;
    return o;
  };
  const takeGrenade = type => {
    const o = freeGrenades.pop() || proj._makeGrenade();
    o.type = type;
    o.def = GRENADE_TYPES[type];
    let m = o.models[type];
    if (!m) {
      m = o.models[type] = createGrenadeModel(type);
      o.group.add(m);
    }
    if (o.model !== m) { o.model.visible = false; o.model = m; }
    o.model.visible = true;
    o.glow.material = proj._glowMatFor(type);
    o.glow.visible = true;
    o.group.visible = true;
    o.state = 'flight';
    o.stateT = 0;
    return o;
  };
  const release = rec => {
    const o = rec.obj;
    if (!o) return;
    o.group.visible = false;
    if (rec.kind === 'rocket') freeRockets.push(o);
    else {
      if (o.rig) proj.types.fx.vortexRelease(o);
      if (o.loop) { o.loop.stop(); o.loop = null; }
      freeGrenades.push(o);
    }
    rec.obj = null;
  };

  client.act = {
    rocket(o, d) {
      const s = send('rocket', { o: wirePos(o), d: wireDir(d) });
      const obj = takeRocket();
      obj.group.position.copy(o);
      obj.group.quaternion.setFromUnitVectors(_fwd, d);
      predicted.push({ seq: s, obj, pos: o.clone(), dir: d.clone().normalize(), speed: WEAPONS.rocket.projectile.speed, age: 0, stopped: false, hostSeen: false });
    },
    nade(o, v, f, ty, drop) {
      send('nade', { o: wirePos(o), v: wireVel(v), f: r2(f), ty, drop: drop ? 1 : 0 });
    },
    cook(o, ty) {
      send('cook', { o: wirePos(o), ty });
    },
  };
  client.hooks.blast = (shooter, origin, dir, b, ads) => {
    if (shooter !== game.player) return { hits: 0, reflected: 0 };
    galeSelfPush(game, shooter, origin, dir, b);   // part of this player's own movement: predicted, never forwarded back
    send('gale', { o: wirePos(origin), d: wireDir(dir), ads: ads ? 1 : 0 });
    return { hits: 0, reflected: 0 };
  };
  net.on('actx', m => {
    st.refused[m.why] = (st.refused[m.why] || 0) + 1;
    warnOnce('actx:' + m.why, `[net] the host refused a '${m.a}' (${m.why})`);
  });

  // ---- section 2: every projectile of this snapshot
  net.registerSection(2, {
    decode(r, ctx) {
      const n = r.u8();
      const t = ctx.tHost;
      for (const rec of live.values()) rec.seen = false;
      for (let i = 0; i < n; i++) {
        const pid = r.u16(), ks = r.u8(), owner = r.u8(), oseq = r.u8();
        const px = Q.unpos(r.i16()), py = Q.unpos(r.i16()), pz = Q.unpos(r.i16());
        const vx = Q.unvel(r.i16()), vy = Q.unvel(r.i16()), vz = Q.unvel(r.i16());
        const fuse = r.u8() / 50;
        const kind = KIND_BY[ks & 0x0f] || 'frag';
        const state = STATE_BY[(ks >> 4) & 0x07] || 'flight';
        let nx = 0, ny = 1, nz = 0;
        if (state !== 'flight') { nx = r.i8() / 127; ny = r.i8() / 127; nz = r.i8() / 127; }
        if (r.overflow) return;
        let rec = live.get(pid);
        if (!rec) {
          rec = { pid, kind, owner, oseq, a: null, b: null, obj: null, state: 'flight', goneAt: 0, fuse: 0, n: new THREE.Vector3(0, 1, 0),
            center: new THREE.Vector3(), inAir: false, own: owner === game.player.id && oseq > 0 };
          live.set(pid, rec);
        }
        rec.seen = true;
        rec.goneAt = 0;
        rec.a = rec.b;
        rec.b = { t, px, py, pz, vx, vy, vz };
        rec.fuse = fuse;
        rec.n.set(nx, ny, nz);
        rec.inAir = (ks & IN_AIR) !== 0;
        if (state !== rec.state) rec.nextState = state;
        if (rec.own && kind === 'rocket') {
          const pr = predicted.find(p => p.seq === oseq);
          if (pr) pr.hostSeen = true;
        }
      }
      // gone from the host (exploded, expired): removed when the entity timeline reaches this snapshot
      for (const rec of live.values()) if (!rec.seen && !rec.goneAt) rec.goneAt = t;
    },
  });

  client.frameHooks.push((dt, renderMs) => {
    if (live.size > st.replicatedMax) st.replicatedMax = live.size;
    if (predicted.length > st.predictedMax) st.predictedMax = predicted.length;
    // own predicted rockets fly at the present until the host's copy of them is gone
    for (let i = predicted.length - 1; i >= 0; i--) {
      const p = predicted[i];
      p.age += dt;
      const hostCopy = [...live.values()].find(x => x.own && x.kind === 'rocket' && x.oseq === p.seq);
      const done = p.age > 6 || (p.hostSeen && (!hostCopy || hostCopy.goneAt)) || (p.stopped && p.age > 1.5);
      if (done) {
        p.obj.group.visible = false;
        freeRockets.push(p.obj);
        predicted.splice(i, 1);
        continue;
      }
      if (p.stopped) continue;
      const step = p.speed * dt;
      const hit = game.world.raycast(p.pos, p.dir, step + 0.06);
      if (hit) {
        p.stopped = true;
        p.obj.group.visible = false;   // the host's explosion follows a round trip later
        continue;
      }
      p.pos.addScaledVector(p.dir, step);
      p.obj.group.position.copy(p.pos);
      p.obj.spin += dt * 9;
      p.obj.model.rotation.z = p.obj.spin;
      _w.copy(p.pos).addScaledVector(p.dir, -0.32);
      game.effects.trail(_w, { type: 'rocket' });
    }
    // replicated projectiles at render time
    const iv = 1000 / client.snapHz;
    for (const rec of live.values()) {
      if (rec.goneAt && renderMs >= rec.goneAt) {
        release(rec);
        live.delete(rec.pid);
        continue;
      }
      const b = rec.b;
      if (!b) continue;
      if (renderMs < (rec.a ? rec.a.t : b.t) - iv) continue;   // not on the timeline yet
      if (rec.own && rec.kind === 'rocket') continue;          // drawn by the predicted copy
      if (!rec.obj) rec.obj = rec.kind === 'rocket' ? takeRocket() : takeGrenade(rec.kind);
      const a = rec.a && rec.a.t < b.t ? rec.a : null;
      let x, y, z;
      if (a && renderMs <= b.t) {
        const s = Math.max(0, Math.min(1, (renderMs - a.t) / (b.t - a.t)));
        x = a.px + (b.px - a.px) * s; y = a.py + (b.py - a.py) * s; z = a.pz + (b.pz - a.pz) * s;
      } else {
        const ex = Math.min(iv, Math.max(0, renderMs - b.t)) / 1000;
        x = b.px + b.vx * ex; y = b.py + b.vy * ex; z = b.pz + b.vz * ex;
      }
      const o = rec.obj;
      o.position.set(x, y, z);
      o.group.position.copy(o.position);
      if (rec.kind === 'rocket') {
        _d.set(b.vx, b.vy, b.vz);
        if (_d.lengthSq() > 1e-6) {
          _d.normalize();
          o.group.quaternion.setFromUnitVectors(_fwd, _d);
          _w.copy(o.position).addScaledVector(_d, -0.32);
          game.effects.trail(_w, { type: 'rocket' });
        }
        o.spin = (o.spin || 0) + dt * 9;
        o.model.rotation.z = o.spin;
        continue;
      }
      // grenades: tumble in flight; a vortex shows its rig and pulls the local player (C7)
      if (rec.nextState) {
        const st = rec.nextState;
        rec.nextState = null;
        rec.state = st;
        o.state = st;
        if (st !== 'flight' && rec.kind === 'vortex') {
          rec.center.copy(o.position).addScaledVector(rec.n, rec.inAir ? 0 : 0.9);
          o.center.copy(rec.center);
          o.normal.copy(rec.n);
          if (!o.rig) proj.types.fx.vortexAcquire(o);
          if (st === 'active') {
            o.model.visible = false;
            o.glow.visible = false;
            if (!o.loop) o.loop = game.audio.playLoop('vortex_loop', { position: o.center, volume: 1, rate: 0.8 });
          }
        }
      }
      if (rec.state === 'flight') {
        o.model.rotateOnAxis(UP, dt * 11);
      } else if (rec.kind === 'vortex') {
        const def = GRENADE_TYPES.vortex;
        o.stateT = rec.state === 'active' ? Math.max(0, def.duration - rec.fuse) : Math.max(0, def.deploy - (rec.fuse - def.duration));
        if (o.loop) o.loop.setRate(0.8 + 0.8 * (o.stateT / def.duration));
        proj.types.fx.vortexTick(o, dt);
        if (rec.state === 'active') pullLocal(game, rec.center, dt);
      }
    }
  });

  net.onEnd(() => {
    for (const rec of live.values()) release(rec);
    live.clear();
    for (const p of predicted) p.obj.group.visible = false;
    predicted.length = 0;
  });
  client.onClear(() => {
    for (const rec of live.values()) release(rec);
    live.clear();
    for (const p of predicted) { p.obj.group.visible = false; freeRockets.push(p.obj); }
    predicted.length = 0;
  });
}

/**
 * A Vortex well's pull on the local player (the same rule GrenadeSystem._vortexActive applies to bodies the host
 * simulates; the crush damage stays on the host).
 */
function pullLocal(game, center, dt) {
  const p = game.player;
  if (!p.alive) return;
  const def = GRENADE_TYPES.vortex;
  const R = def.radius;
  p.getChestPosition(_w);
  _d.subVectors(center, _w);
  const d = _d.length();
  if (d > R || d < 0.05) return;
  _d.multiplyScalar(1 / d);
  const k = Math.pow(1 - d / R, 0.8);
  const accel = def.pull * k;
  const v = p.velocity;
  const vt = v.x * _d.x + v.y * _d.y + v.z * _d.z;
  const boost = p.onGround ? 3 : 1;
  const add = Math.min(accel * boost * dt, Math.max(0, def.maxPullSpeed - vt));
  if (p.onGround) {
    const h = Math.hypot(_d.x, _d.z);
    if (h > 0.01) { v.x += (_d.x / h) * add; v.z += (_d.z / h) * add; }
  } else {
    v.x += _d.x * add; v.y += _d.y * add; v.z += _d.z * add;
  }
  const sw = accel * 0.28 * dt;
  v.x += -_d.z * sw;
  v.z += _d.x * sw;
  // the periodic lift in the inner band
  const now = game.time;
  if (p.onGround && d <= def.lift.radius && now - (p._vortexLiftAt || -9) >= def.lift.every) {
    p._vortexLiftAt = now;
    p.applyImpulse(_n.set(0, def.lift.impulseY, 0));
  }
}
