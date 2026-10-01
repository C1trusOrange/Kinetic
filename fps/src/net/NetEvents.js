/**
 * Game-event replication. On the host every registered game event becomes a JSON message (entity ids instead of
 * objects, rounded vectors, host net times) in the broadcast batch; a client applies the state change the host's
 * emitter made (health, life, scores, availability) and re-emits the same event, so HUD, ModeHUD, WeaponSystem,
 * Player and AutoTest listeners work unchanged on every machine.
 *
 * Id rules: `required` fields name entities that must exist on the client (else the message is dropped, warn once);
 * optional ids (attacker, owner) resolve to the live entity, else the departed record (name / colour kept for the
 * kill feed), else null. Every message carries `at` (host net ms); snapshots never override a field an event set
 * later (NetClient guards: ownHpAt, ownLifeAt, lifeAt, hpAt, scoreAt).
 */
import * as THREE from 'three';
import { NET, toWireTime, fromWireTime, wirePos, wireDir, num } from './GameProtocol.js';
import { isTeamMode } from '../core/constants.js';

/** event name -> {name, kind, toWire, apply, required} */
const REG = new Map();
const _warned = new Set();
function warnOnce(key, ...args) {
  if (_warned.has(key)) return;
  _warned.add(key);
  console.warn(...args);
}
const r2 = v => Math.round(v * 100) / 100;
const r3 = v => Math.round(v * 1000) / 1000;
/** A wire [x, y, z] as a new Vector3 (event payloads), or null. */
const vec = a => (Array.isArray(a) && a.length >= 3 ? new THREE.Vector3(num(a[0]), num(a[1]), num(a[2])) : null);

/**
 * Register a replicated event.
 * @param {string} name game.events name
 * @param {{kind: string, required?: string[], toWire: (payload, host) => object|null, apply: (msg, client) => object|null}} def
 *   toWire on the host (null = not replicated); apply on clients returns the payload to re-emit (null = nothing)
 */
export function register(name, def) {
  REG.set(name, { name, ...def });
}

/** Host: subscribe to every registered event (after the game's own listeners: 'death' sees post-scoring values). */
export function installHost(net) {
  const offs = [];
  const host = net.host;
  for (const def of REG.values()) {
    offs.push(net.game.events.on(def.name, payload => {
      if (!net.isHost || !net.game.match) return;
      let msg = null;
      try {
        msg = def.toWire(payload, host);
      } catch (err) {
        warnOnce('tw:' + def.name, `[net] could not send '${def.name}':`, err);
        return;
      }
      if (msg) {
        if (msg.at === undefined) msg.at = Math.round(net.clock.hostNowMs());
        net.send(msg, 'all');
        net.stats.events.out[def.kind] = (net.stats.events.out[def.kind] || 0) + 1;
      }
    }));
  }
  return () => { for (const off of offs) off(); };
}

/** Client: handle every registered message kind. */
export function installClient(net) {
  for (const def of REG.values()) net.on(def.kind, msg => applyOnClient(net, def, msg));
}

function applyOnClient(net, def, msg) {
  const client = net.client, game = net.game;
  if (!client || !game.match) return;
  for (const f of def.required || []) {
    if (!game.getEntityById(msg[f] | 0)) {
      warnOnce('req:' + def.kind + ':' + f, `[net] '${def.kind}' for an unknown entity (${f}=${msg[f]}) dropped`);
      return;
    }
  }
  net.stats.events.in[def.kind] = (net.stats.events.in[def.kind] || 0) + 1;
  const payload = def.apply(msg, client);
  if (payload) game.events.emit(def.name, payload);
}

// ---------------------------------------------------------------------------------------------- core events

register('damage', {
  kind: 'dmg',
  required: ['t'],
  toWire(p, host) {
    const t = p.target, a = p.attacker;
    if (!t) return null;
    const msg = { k: 'dmg', t: t.id, n: r2(p.amount || 0), w: p.weapon || 'unknown', hp: Math.ceil(t.health), ar: Math.ceil(t.armor) };
    if (a) msg.a = a.id;
    if (p.headshot) msg.h = 1;
    if (p.point) msg.p = wirePos(p.point);
    if (p.direction) msg.d = wireDir(p.direction);
    const c = host && host._claimCtx;
    if (c && a === c.rp) msg.ci = c.ci;
    return msg;
  },
  apply(msg, client) {
    const game = client.game;
    const t = game.getEntityById(msg.t | 0);
    const a = client.refOf(msg.a | 0);
    const at = num(msg.at);
    if (t === game.player) {
      if (at >= client.ownHpAt) {
        client.ownHpAt = at;
        t.health = num(msg.hp, t.health);
        t.armor = num(msg.ar, t.armor);
      }
    } else {
      t.health = num(msg.hp, t.health);
      t.armor = num(msg.ar, t.armor);
      t.hpAt = at;
    }
    if (a && a !== t && !a.departed) t.lastAttacker = a;
    t.lastDamageTime = game.time;
    return {
      target: t, attacker: a, amount: num(msg.n), weapon: String(msg.w || 'unknown'), headshot: !!msg.h,
      point: vec(msg.p), direction: vec(msg.d), ci: msg.ci,
    };
  },
});

register('death', {
  kind: 'death',
  required: ['v'],
  toWire(p, host) {
    const v = p.victim, a = p.attacker;
    if (!v) return null;
    const game = host.game, m = game.match, clock = host.net.clock;
    const msg = {
      k: 'death', v: v.id, w: p.weapon || 'unknown', vd: v.deaths | 0, vk: v.kills | 0,
      ra: v.respawnAt >= 0 ? toWireTime(clock.hostGameToNet(game, v.respawnAt)) : NET.NEVER,
    };
    if (a) {
      msg.a = a.id;
      msg.ak = a.kills | 0;
      msg.as = a.streak | 0;
      msg.ahp = Math.ceil(a.health);
      msg.at2 = a.tier | 0;
    }
    if (p.headshot) msg.h = 1;
    if (p.point) msg.p = wirePos(p.point);
    if (p.direction) msg.d = wireDir(p.direction);
    if (m && isTeamMode(m.mode)) msg.ts = [m.teamScores[1] || 0, m.teamScores[2] || 0];
    return msg;
  },
  apply(msg, client) {
    const game = client.game, m = game.match;
    const v = game.getEntityById(msg.v | 0);
    const a = client.refOf(msg.a | 0);
    const at = num(msg.at);
    // team scores first: the kill feed / match point read them in the 'death' listeners
    if (Array.isArray(msg.ts) && at >= client.scoreAt) {
      m.teamScores[1] = msg.ts[0] | 0;
      m.teamScores[2] = msg.ts[1] | 0;
      client.scoreAt = at;
    }
    const payload = {
      victim: v, attacker: a, weapon: String(msg.w || 'unknown'), headshot: !!msg.h, point: vec(msg.p), direction: vec(msg.d),
    };
    v.deaths = msg.vd | 0;
    v.kills = msg.vk | 0;
    v.streak = 0;
    v.scoreAt = at;
    if (a && !a.departed && a !== v) {
      a.kills = msg.ak | 0;
      a.streak = msg.as | 0;
      if (typeof msg.ahp === 'number') a.health = msg.ahp;
      a.scoreAt = at;
    }
    const wasAlive = v.alive;
    v.alive = false;
    v.health = 0;
    if (v === game.player) {
      client.ownLifeAt = Math.max(client.ownLifeAt, at);
      client.ownHpAt = Math.max(client.ownHpAt, at);
      client.respawnAtNet = typeof msg.ra === 'number' && msg.ra >= 0 ? msg.ra : NET.NEVER;
      client.refreshTimes();
    } else {
      v.lifeAt = at;
      v.respawnAt = typeof msg.ra === 'number' && msg.ra >= 0 ? client.net.clock.netToLocalGame(game, msg.ra) : -1;
    }
    if (wasAlive) {
      try {
        v.onDeath(payload);
      } catch (err) {
        console.error('[net] onDeath threw', err);
      }
    }
    return payload;
  },
});

register('spawn', {
  kind: 'spawn',
  required: ['e'],
  toWire(p, host) {
    const e = p.entity;
    if (!e || host._building) return null;   // the 'begin' message carries the spawns of the match start
    const game = host.game, clock = host.net.clock;
    const msg = {
      k: 'spawn', e: e.id, p: wirePos(e.position), y: r3(e.yaw), pu: toWireTime(clock.hostGameToNet(game, e.spawnProtectedUntil)),
    };
    if (e.isRemote) {
      msg.ss = e.spawnSeq;
      if (game.modes.isEscalation) msg.lo = game.modes.loadoutFor(e);   // only Escalation: elsewhere the client resolves its pick
    }
    return msg;
  },
  apply(msg, client) {
    const game = client.game;
    const id = msg.e | 0;
    const at = num(msg.at);
    if (id === game.player.id) {
      if ((msg.ss & 255) === client.stateSpawnSeq && client.ownLifeAt >= at) return null;   // already applied
      client.applyLocalSpawn(msg, at);   // emits 'spawn' itself
      return null;
    }
    const a = client.avatars.get(id);
    if (!a) return null;
    const pos = vec(msg.p);
    if (!pos) return null;
    a.spawn(pos, num(msg.y));
    a.lifeAt = a.hpAt = at;
    const pu = fromWireTime(msg.pu);
    a.spawnProtectedUntil = Number.isFinite(pu) ? client.net.clock.netToLocalGame(game, pu) : 0;
    return { entity: a };
  },
});

register('pickup', {
  kind: 'pk',
  required: ['e'],
  toWire(p, host) {
    const pk = p.pickup, e = p.entity;
    if (!pk || !e) return null;
    const game = host.game, clock = host.net.clock;
    const msg = {
      k: 'pk', p: pk.id, e: e.id, hp: Math.ceil(e.health), ar: Math.ceil(e.armor),
      nr: Number.isFinite(pk.nextRespawn) ? toWireTime(clock.hostGameToNet(game, pk.nextRespawn)) : NET.NEVER,
    };
    if (pk.lastGrant) msg.g = pk.lastGrant;
    return msg;
  },
  apply(msg, client) {
    const game = client.game;
    const pickups = game.world.pickups;
    const pk = pickups && pickups.list[msg.p | 0];
    const e = game.getEntityById(msg.e | 0);
    if (!pk || !e) return null;
    const at = num(msg.at);
    pickups.applyEvent(pk.id, false, msg.nr, at);
    pk.lastGrant = msg.g && typeof msg.g === 'object' ? msg.g : null;
    if (e === game.player) {
      if (at >= client.ownHpAt) {
        client.ownHpAt = at;
        e.health = num(msg.hp, e.health);
        e.armor = num(msg.ar, e.armor);
      }
    } else {
      e.health = num(msg.hp, e.health);
      e.armor = num(msg.ar, e.armor);
      e.hpAt = at;
    }
    return { entity: e, pickup: pk };
  },
});

register('explosion', {
  kind: 'exp',
  toWire(p) {
    if (!p || !p.position) return null;
    const msg = { k: 'exp', p: wirePos(p.position), r: r2(p.radius || 0), w: p.weapon || 'explosion' };
    if (p.owner) msg.o = p.owner.id;
    return msg;
  },
  apply(msg, client) {
    const pos = vec(msg.p);
    if (!pos) return null;
    return { position: pos, radius: num(msg.r), owner: client.refOf(msg.o | 0), weapon: String(msg.w || 'explosion') };
  },
});

register('shove', {
  kind: 'shove',
  required: ['t'],
  toWire(p) {
    if (!p || !p.target) return null;
    const msg = { k: 'shove', t: p.target.id, w: p.weapon || 'gale', s: r2(p.speed || 0) };
    if (p.attacker) msg.a = p.attacker.id;
    return msg;
  },
  apply(msg, client) {
    return { target: client.game.getEntityById(msg.t | 0), attacker: client.refOf(msg.a | 0), weapon: String(msg.w || 'gale'), speed: num(msg.s) };
  },
});

register('splat', {
  kind: 'splat',
  required: ['v'],
  toWire(p) {
    if (!p || !p.victim) return null;
    const msg = { k: 'splat', v: p.victim.id, n: r2(p.damage || 0), dr: r2(p.drop || 0) };
    if (p.attacker) msg.a = p.attacker.id;
    return msg;
  },
  apply(msg, client) {
    return { victim: client.game.getEntityById(msg.v | 0), attacker: client.refOf(msg.a | 0), damage: num(msg.n), drop: num(msg.dr) };
  },
});

register('reflect', {
  kind: 'reflect',
  toWire(p) {
    if (!p) return null;
    const msg = { k: 'reflect', kind: p.kind === 'grenade' ? 'grenade' : 'rocket' };
    if (p.owner) msg.o = p.owner.id;
    return msg;
  },
  apply(msg, client) {
    return { owner: client.refOf(msg.o | 0), kind: msg.kind === 'grenade' ? 'grenade' : 'rocket' };
  },
});

register('storm:strike', {
  kind: 'storm',
  toWire(p) {
    if (!p || typeof p.rod !== 'number') return null;
    return { k: 'storm', rod: p.rod, warn: Math.round((p.warn || 0) * 1000) / 1000 };
  },
  apply(msg, client) {
    const storm = client.game.world && client.game.world.storm;
    if (storm && storm.beginStrike) storm.beginStrike(msg.rod | 0, num(msg.warn));
    return null;
  },
});

// --------------------------------------------------------------------------------------- snapshot section 1

const _bits = new Uint8Array(32);

/** Snapshot section 1: pickup availability bits (re-syncs what the 'pk' events set; respawns arrive this way). */
export const PICKUP_SECTION = {
  encode(w, ctx) {
    const list = (ctx.game.world.pickups && ctx.game.world.pickups.list) || [];
    const k = Math.min(255, list.length);
    w.u8(k);
    for (let i = 0; i < k; i += 8) {
      let b = 0;
      for (let j = 0; j < 8 && i + j < k; j++) if (list[i + j].available) b |= 1 << j;
      w.u8(b);
    }
  },
  decode(r, ctx) {
    const k = r.u8();
    const bytes = Math.min(_bits.length, Math.ceil(k / 8));
    for (let i = 0; i < bytes; i++) _bits[i] = r.u8();
    const pk = ctx.game.world.pickups;
    if (pk && pk.applyNet && !r.overflow) pk.applyNet(_bits, Math.min(k, bytes * 8), ctx.tHost);
  },
};
