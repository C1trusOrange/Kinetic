// Bot telemetry scenario (read-only audit). Hooks events + wraps a few methods (in-page only) and samples every frame.
// URL flags read from game.params: human=1 (scripted "average human" player), idlep=1 (player stands still)
import * as THREE from 'three';
import { WEAPONS } from '/src/weapons/WeaponDefs.js';

const r2 = (v, n = 2) => +v.toFixed(n);
const RANGE_BINS = [6, 12, 20, 35, 60, 1e9];
const rb = d => { for (let i = 0; i < RANGE_BINS.length; i++) if (d < RANGE_BINS[i]) return i; return RANGE_BINS.length - 1; };

let S = null;

export function setup(game, report) {
  const C = (report.custom = {});
  const bots = game.bots.list;
  const world = game.world;
  S = {
    t0: game.time,
    bot: new Map(),
    ev: { dmgByWeapon: {}, fireByWeapon: {}, killsByWeapon: {}, killDist: [], deathsSelf: 0, deathsFall: 0, friendlyDmg: 0, spawnKills: 0, lifeSpans: [], killTimes: [] },
    pel: {}, // per weapon per range-bin pellets {n, ent, world, miss}
    playerPel: { n: 0, ent: 0 },
    pickups: {},
    ySec: {},
    cells: new Set(),
    sampleAcc: 0,
    losAcc: 0,
    clump: { samples: 0, withNeighbor: 0, pairs: 0 },
    los: { time: 0, ignored: 0, engaged: 0, behind: 0 },
    timeline: [],
    firstDamageAt: -1,
    firstKillAt: -1,
    spawnAt: new Map(),
    deathNearSpawn: 0, deaths: 0,
    playerSeen: [], // per life: time from spawn to first visible-by-bot
    playerDamageBursts: [],
    blockedFire: 0, botFireEvents: 0,
    nonVisFire: 0,
    reactDelays: [], // first sight -> first shot at that enemy
    weaponSwitches: 0,
    rangeMismatch: { visSec: 0, badSec: 0, byWeapon: {} },
    engageRange: {}, // weapon -> range-bin -> seconds while target visible
    grenadeThrows: 0,
    grenadeHits: 0,
    grenadeKills: 0,
    rocketSelf: 0,
    wSec: {}, pistolWithOthers: 0, pistolDepleted: 0, retreatKinds: {}, coverReload: 0,
    eng: { vis: 0, still: 0, lat: 0, rad: 0, crouch: 0, air: 0, blind: 0 }, yawRates: [], aimErr: [],
    pkAvail: {}, pkTime: 0, pkTypes: {}, pdist: [], colBy: {}, pFirstDmg: -1, pDeaths: [], trans: {}, chaseDur: {}, retEp: [], nullDmg: {}, nullDeaths: {}, expl: {}, gren: [], col: { trips: 0, ok: 0, fail: 0, sec: 0, failSec: 0 }, ret: { enter: 0, exit: 0, dist: [], dur: [], deathAfter: [], hpAtEnter: [] },
  };
  const T = () => game.time - S.t0;

  // ---- per bot records
  for (const b of bots) {
    const rec = {
      name: b.name,
      states: { roam: 0, engage: 0, chase: 0, retreat: 0, collect: 0 },
      stuckT: 0, stuckEvents: 0, recoverCalls: 0, rescues: 0, transitions: 0, fastFlips: 0,
      revs: 0, revAt: -9, lastAng: NaN,
      spinT: 0, yawAcc: 0, yawWin: [], // yaw accumulate windows
      maxY: -1e9, minY: 1e9,
      visT: 0, fireT: 0, engT: 0,
      lastPos: b.position.clone(), lastX: b.position.x, lastZ: b.position.z, stuckSampleAt: 0,
      strafeFlips: 0, lastStrafe: b.brain.strafeDir,
      stateSince: 0, lastState: 'roam',
      sawEnemyAt: new Map(), firedAtEnemy: new Set(),
      weapon: b.weaponId, lastWeapon: b.weaponId,
      idleT: 0, idleWhileEnemyKnown: 0,
      lifeStart: 0,
    };
    S.bot.set(b, rec);
    const br = b.brain;
    const oe = br.enterState.bind(br);
    br.enterState = (next, t) => {
      const prev = br.state;
      if (prev !== next) {
        { const k = prev + '>' + next; S.trans[k] = (S.trans[k] || 0) + 1; }
        if (prev === 'chase' && rec.chaseAt >= 0) { S.chaseDur[next] = S.chaseDur[next] || []; S.chaseDur[next].push(r2(t - rec.chaseAt, 1)); rec.chaseAt = -1; }
        if (next === 'chase') rec.chaseAt = t;
        if (next === 'retreat') {
          const tr = br.targetRec;
          rec.ep = { hp: Math.round(b.health), ehp: tr ? Math.round(tr.ent.health) : -1, d: tr ? Math.round(b.position.distanceTo(tr.visible ? tr.ent.position : tr.pos)) : -1, vis: !!(tr && tr.visible), kind: '', out: '?' };
          S.retEp.push(rec.ep);
          rec.retAt = t; rec.retHp = b.health;
          S.ret.enter++;
          S.ret.dist.push(tr ? r2(b.position.distanceTo(tr.visible ? tr.ent.position : tr.pos), 0) : -1);
        }
        if (next === 'collect') {
          rec.colAt = t; rec.colPk = rec.lastPickupAt || -1; S.col.trips++;
          const cp = br._collect;
          rec.colType = cp ? (cp.type === 'weapon' ? 'weapon:' + cp.weapon : cp.type) : '?';
          rec.colD = cp ? Math.round(cp.position.distanceTo(b.position)) : -1;
        }
        if (prev === 'collect' && rec.colAt >= 0) {
          const ok = (rec.lastPickupAt || -1) > rec.colAt;
          { const ty = S.colBy[rec.colType] || (S.colBy[rec.colType] = { trips: 0, ok: 0, sec: 0, dists: [], to: {} });
            ty.trips++; if (ok) ty.ok++; ty.sec += t - rec.colAt; ty.dists.push(rec.colD); if (!ok) ty.to[next] = (ty.to[next] || 0) + 1; }
          if (ok) S.col.ok++; else S.col.fail++;
          S.col.sec += t - rec.colAt; if (!ok) S.col.failSec += t - rec.colAt;
          rec.colAt = -1;
        }
        if (prev === 'retreat') {
          if (rec.ep) { rec.ep.out = 'alive'; rec.ep.kind = br.retreatKind; rec.ep = null; }
          S.ret.exit++;
          S.ret.dur.push(r2(t - rec.retAt, 1));
          rec.retAt = -1;
        }
        rec.transitions++;
        if (t - rec.stateSince < 0.8) rec.fastFlips++;
        rec.stateSince = t;
      }
      return oe(next, t);
    };
    const orc = br.recoverStuck.bind(br);
    br.recoverStuck = t => { rec.recoverCalls++; return orc(t); };
    const ores = br.rescue.bind(br);
    br.rescue = () => { const ok = ores(); if (ok) rec.rescues++; return ok; };
  }

  // ---- events
  game.events.on('damage', e => {
    const a = e.attacker, tg = e.target;
    if (S.firstDamageAt < 0) S.firstDamageAt = T();
    if (!a) { const k0 = e.weapon || '?'; S.nullDmg[k0] = (S.nullDmg[k0] || 0) + e.amount; }
    if (tg && tg.isPlayer && S.pFirstDmg < 0) S.pFirstDmg = T();
    if (a && a !== tg) {
      const k = e.weapon || '?';
      S.ev.dmgByWeapon[k] = (S.ev.dmgByWeapon[k] || 0) + e.amount;
      if (a.team === tg.team && game.match && game.match.mode === 'tdm') S.ev.friendlyDmg += e.amount;
      if (k === 'grenade' && a.isBot) S.grenadeHits++;
    }
  });
  game.events.on('death', e => {
    const v = e.victim, a = e.attacker;
    S.deaths++;
    if (!a) { const k1 = e.weapon || '?'; S.nullDeaths[k1] = (S.nullDeaths[k1] || 0) + 1; }
    if (v && v.isPlayer) S.pDeaths.push({ t: r2(T(), 1), by: a ? a.name : null, w: e.weapon });
    const spAt = S.spawnAt.get(v);
    if (spAt !== undefined) {
      const life = T() - spAt;
      S.ev.lifeSpans.push(life);
      if (life < 3.5) S.ev.spawnKills++;
    }
    // near a spawn point?
    for (const sp of world.spawnPoints) {
      if (Math.abs(sp.position.y - v.position.y) < 2 && Math.hypot(sp.position.x - v.position.x, sp.position.z - v.position.z) < 4) { S.deathNearSpawn++; break; }
    }
    if (v.isBot && a && a !== v) {
      const br = v.brain;
      const rec2 = br.mem.get(a);
      const known = !!(rec2 && rec2.known);
      const vis = !!(rec2 && rec2.visible);
      const dx = a.position.x - v.position.x, dz = a.position.z - v.position.z;
      const ang = Math.abs(wrap(Math.atan2(-dx, -dz) - v.yaw));
      const D = S.deathCtx || (S.deathCtx = { n: 0, unaware: 0, behind: 0, retreating: 0, engaging: 0, visTarget: 0, lowHpNoRetreat: 0, hpAtDeathTargetOther: 0, byState: {} });
      D.n++;
      const rr = S.bot.get(v);
      if (br.state === 'retreat' && rr && rr.ep) { rr.ep.out = 'dead'; rr.ep.kind = br.retreatKind; rr.ep = null; }
      if (br.state === 'retreat' && rr && rr.retAt >= 0) S.ret.deathAfter.push(r2(game.time - S.t0 - (rr.retAt - S.t0 || 0), 1));
      if (!known) D.unaware++;
      if (ang > 1.4) D.behind++;
      if (br.state === 'retreat') D.retreating++;
      if (br.state === 'engage') D.engaging++;
      D.byState[br.state] = (D.byState[br.state] || 0) + 1;
      if (br.target && br.target !== a && br.targetRec && br.targetRec.visible) D.hpAtDeathTargetOther++;
    }
    if (a === v) S.ev.deathsSelf++;
    if (e.weapon === 'fall') S.ev.deathsFall++;
    if (a && a !== v) {
      S.ev.killsByWeapon[e.weapon] = (S.ev.killsByWeapon[e.weapon] || 0) + 1;
      S.ev.killDist.push(r2(a.position.distanceTo(v.position), 1));
      S.ev.killTimes.push(r2(T(), 1));
      if (S.firstKillAt < 0) S.firstKillAt = T();
      if (e.weapon === 'grenade' && a.isBot) S.grenadeKills++;
    }
    if (e.weapon === 'rocket' && a === v) S.rocketSelf++;
  });
  game.events.on('explosion', e => {
    const k = e.weapon + (e.owner ? ':owner' : ':NOOWNER') + (e.owner && e.owner.isBot ? ':bot' : '');
    S.expl[k] = (S.expl[k] || 0) + 1;
  });
  game.events.on('spawn', e => {
    S.spawnAt.set(e.entity, T());
    const rec = S.bot.get(e.entity);
    if (rec) { rec.sawEnemyAt.clear(); rec.firedAtEnemy.clear(); }
  });
  game.events.on('pickup', e => {
    const who = e.entity.isPlayer ? 'player' : 'bot';
    { const rb0 = S.bot.get(e.entity); if (rb0) rb0.lastPickupAt = game.time; }
    const k = who + ':' + (e.pickup.type === 'weapon' ? 'weapon:' + e.pickup.weapon : e.pickup.type);
    S.pickups[k] = (S.pickups[k] || 0) + 1;
  });
  game.events.on('weapon:fire', e => {
    const w = e.weapon;
    S.ev.fireByWeapon[w] = (S.ev.fireByWeapon[w] || 0) + 1;
    const sh = e.shooter;
    const rec = S.bot.get(sh);
    if (rec) {
      S.botFireEvents++;
      const br = sh.brain;
      const tr = br.targetRec;
      if (!tr || !tr.visible) S.nonVisFire++;
      else {
        // reaction: first sight -> first shot at this enemy
        if (!rec.firedAtEnemy.has(tr.ent)) {
          rec.firedAtEnemy.add(tr.ent);
          S.reactDelays.push(r2(T() - (rec.sawEnemyAt.get(tr.ent) ?? T()), 2));
        }
        tr.ent.getChestPosition(_c);
        _h.subVectors(_c, e.origin);
        const dd0 = _h.length();
        if (dd0 > 1) { _h.multiplyScalar(1 / dd0); S.aimErr.push(Math.acos(Math.min(1, _h.dot(e.direction))) * dd0); }
        // shooting into geometry: ray from eye along aim to target distance
        const d = sh.position.distanceTo(tr.ent.position);
        const hit = world.raycast(e.origin, e.direction, d);
        if (hit && hit.distance < d - 1.5) S.blockedFire++;
      }
    }
  });

  // wrap fireBullet for pellet accuracy
  const combat = game.combat;
  const ofb = combat.fireBullet.bind(combat);
  combat.fireBullet = o => {
    const h = ofb(o);
    const sh = o.shooter;
    if (sh && sh.isBot) {
      const tr = sh.brain.targetRec;
      const td = tr ? sh.position.distanceTo(tr.visible ? tr.ent.position : tr.pos) : -1;
      const d = td >= 0 ? td : (h ? h.distance : 100);
      const key = o.weapon + ':' + rb(d);
      const p = S.pel[key] || (S.pel[key] = { n: 0, ent: 0, cover: 0, past: 0, miss: 0, other: 0 });
      p.n++;
      if (!h) p.miss++;
      else if (h.entity) { if (tr && h.entity === tr.ent) p.ent++; else p.other++; }
      else if (td >= 0 && h.distance < td - 1.5) p.cover++;
      else p.past++;
    } else if (sh && sh.isPlayer) {
      S.playerPel.n++;
      if (h && h.entity) S.playerPel.ent++;
    }
    return h;
  };
  const og = game.projectiles.spawnGrenade.bind(game.projectiles);
  game.projectiles.spawnGrenade = o => { if (o.owner && o.owner.isBot) S.grenadeThrows++; return og(o); };
  const oex = game.projectiles.explode.bind(game.projectiles);
  game.projectiles.explode = (pos, o) => {
    if (o && o.weapon === 'grenade' && o.owner && o.owner.isBot) {
      let md = 1e9, mv = null;
      for (const e of game.entities) { if (e === o.owner || !e.alive || e.team === o.owner.team) continue; const d = e.position.distanceTo(pos); if (d < md) { md = d; mv = e; } }
      S.gren.push({ nearestEnemyM: r2(md, 1), ownerDistM: r2(o.owner.position.distanceTo(pos), 1), t: r2(game.time - S.t0, 0) });
    }
    return oex(pos, o);
  };

  // nav tier stats
  const nav = world.nav;
  const yb = {};
  for (const n of nav.nodes) { const k = Math.floor(n.position.y / 3) * 3; yb[k] = (yb[k] || 0) + 1; }
  C.navY = yb;
  // static nav quality: reachability classes by height, pickups and spawns on the graph
  const cls = {};
  for (const n of nav.nodes) {
    const k = Math.floor(n.position.y / 3) * 3;
    const c = cls[k] || (cls[k] = { n: 0, main: 0, fromOnly: 0, unreachable: 0 });
    c.n++;
    if (n.main) c.main++; else if (n.fromMain) c.fromOnly++; else c.unreachable++;
  }
  C.navClass = cls;
  const pk = [];
  for (const p of world.pickups.list) {
    const nn = nav.nearestNode(p.position, 3);
    pk.push(`${p.type === 'weapon' ? p.weapon : p.type}@${p.position.x.toFixed(0)},${p.position.y.toFixed(0)},${p.position.z.toFixed(0)}:${nn ? (nn.main ? 'main' : nn.fromMain ? 'from' : 'NO') : 'nonode'}`);
  }
  C.pickupNav = pk;
  C.spawnNav = world.spawnPoints.map(sp => { const nn = nav.nearestNode(sp.position, 3); return nn ? (nn.main ? 'm' : nn.fromMain ? 'f' : 'X') : '-'; }).join('');
  C.spawnY = world.spawnPoints.map(sp => Math.round(sp.position.y)).join(',');
  C.navStats = nav.stats;
  C.spots = { cover: game.bots.spots.cover.length, snipe: game.bots.spots.snipe.length };
  C.mode = game.match.mode; C.diff = game.match.difficulty; C.map = game.world.mapId; C.bots = bots.length;

  // player policy
  S.human = game.params.has('human');
  S.pl = { path: null, pathAt: -9, goal: new THREE.Vector3(), strafe: 1, strafeAt: 0, target: null, seenAt: -9, err: [0, 0], errAt: 0, jumpAt: 0, weapon: 2 };
  if (game.player) game.player.god = game.params.has('god');
}

const _e = new THREE.Vector3(), _c = new THREE.Vector3(), _h = new THREE.Vector3();

function gauss() { let u = 0; while (u === 0) u = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283185307179586 * Math.random()); }
function wrap(a) { while (a > Math.PI) a -= 6.283185307179586; while (a < -Math.PI) a += 6.283185307179586; return a; }

function drivePlayer(t, dt, game) {
  const P = game.player, inp = game.input, pl = S.pl;
  if (!P || !P.alive) return;
  if (!S.human) {
    // idle target (optionally strafing back and forth)
    const strafe = game.params.has('pstrafe');
    inp.setVirtual('left', strafe && Math.sin(t * 1.3) > 0);
    inp.setVirtual('right', strafe && Math.sin(t * 1.3) <= 0);
    return;
  }
  // ---- average-human-ish player: find nearest visible enemy, turn with limited speed + reaction delay, strafe, navigate otherwise
  const eye = P.getEyePosition(_e);
  let best = null, bd = 1e9;
  for (const e of game.entities) {
    if (e === P || !e.alive || e.team === P.team) continue;
    e.getChestPosition(_c);
    const d = _c.distanceTo(eye);
    if (d < 70 && d < bd && game.combat.canSee(eye, _c)) { bd = d; best = e; }
  }
  if (best && best !== pl.target) { pl.target = best; pl.seenAt = t; }
  if (!best) pl.target = null;
  let fire = false;
  let mvF = false, mvL = false, mvR = false, sprint = false, jump = false;
  if (best) {
    best.getChestPosition(_c);
    // aim point: chest + lead-less; error re-rolled every 0.3 s (sigma 0.022 rad ~ decent human)
    if (t > pl.errAt) { pl.err = [gauss() * 0.022, gauss() * 0.016]; pl.errAt = t + 0.3; }
    const dx = _c.x - eye.x, dy = _c.y - eye.y, dz = _c.z - eye.z;
    const hl = Math.hypot(dx, dz);
    const wantYaw = Math.atan2(-dx, -dz) + pl.err[0];
    const wantPitch = Math.atan2(dy, hl) + pl.err[1];
    const react = 0.28;
    if (t - pl.seenAt > react) {
      const maxTurn = 7.0 * dt; // rad per frame (average flick speed)
      const dyaw = wrap(wantYaw - P.yaw), dp = wantPitch - P.pitch;
      P.yaw = wrap(P.yaw + Math.max(-maxTurn, Math.min(maxTurn, dyaw * Math.min(1, dt * 14))));
      P.pitch += Math.max(-maxTurn, Math.min(maxTurn, dp * Math.min(1, dt * 14)));
      const ang = Math.hypot(dyaw, dp);
      fire = ang < 0.05 + 0.6 / Math.max(6, bd);
    }
    if (t > pl.strafeAt) { pl.strafe = -pl.strafe; pl.strafeAt = t + 0.6 + Math.random() * 1.0; }
    if (pl.strafe > 0) mvR = true; else mvL = true;
    if (bd > 25) mvF = true;
    if (Math.random() < dt * 0.25) jump = true;
  } else {
    // roam toward a random node along the nav graph
    const nav = game.world.nav;
    if (!pl.path || t - pl.pathAt > 4 || pl.path.length === 0) {
      const n = nav.randomNode();
      pl.path = n ? nav.findPath(P.position, n.position) : null;
      pl.pathAt = t;
    }
    if (pl.path && pl.path.length) {
      let wp = pl.path[0];
      while (pl.path.length && Math.hypot(wp.x - P.position.x, wp.z - P.position.z) < 0.9) { pl.path.shift(); wp = pl.path[0]; if (!wp) break; }
      if (wp) {
        const wantYaw = Math.atan2(-(wp.x - P.position.x), -(wp.z - P.position.z));
        const dyaw = wrap(wantYaw - P.yaw);
        P.yaw = wrap(P.yaw + Math.max(-5 * dt, Math.min(5 * dt, dyaw * Math.min(1, dt * 10))));
        P.pitch *= 0.9;
        mvF = Math.abs(dyaw) < 1.2;
        sprint = true;
        if (wp.y - P.position.y > 0.5 && P.onGround) jump = true;
      }
    }
  }
  inp.setVirtual('forward', mvF);
  inp.setVirtual('left', mvL);
  inp.setVirtual('right', mvR);
  inp.setVirtual('sprint', sprint && !best);
  inp.setVirtual('jump', jump);
  inp.setVirtual('fire', fire);
  // keep the rifle out (slot 2) unless empty
  inp.setVirtual('weapon2', game.weapons.currentId !== 'rifle');
  inp.setVirtual('reload', game.weapons.ammo === 0);
}

export function drive(t, dt, game, report) {
  if (!S) return;
  const T = game.time - S.t0;
  const world = game.world;
  drivePlayer(T, dt, game);
  const ents = game.entities;
  const cfgMode = game.match.mode;
  for (const [b, rec] of S.bot) {
    if (!b.alive) { rec.lastAng = NaN; continue; }
    const br = b.brain;
    const st = br.state;
    rec.states[st] = (rec.states[st] || 0) + dt;
    S.wSec[b.weaponId] = (S.wSec[b.weaponId] || 0) + dt;
    if (b.weaponId === 'pistol' && b.owned.length > 1) S.pistolWithOthers += dt;
    if (b.weaponId === 'pistol') {
      // did the bot deplete a primary? (owned weapon with zero ammo)
      for (const id of b.owned) if (id !== 'pistol' && b.inv[id].mag + b.inv[id].reserve <= 0) { S.pistolDepleted += dt; break; }
    }
    if (st === 'retreat') S.retreatKinds[br.retreatKind] = (S.retreatKinds[br.retreatKind] || 0) + dt;
    if (br.reloadCover && b.reloading) S.coverReload += dt;
    if (st === 'engage') {
      const tr0 = br.targetRec;
      if (tr0 && tr0.visible) {
        S.eng.vis += dt;
        const sp0 = b.speed;
        if (sp0 < 0.8) S.eng.still += dt;
        const p0 = tr0.ent.position;
        const ddx = p0.x - b.position.x, ddz = p0.z - b.position.z, dd = Math.hypot(ddx, ddz) || 1;
        const lat = Math.abs((b.velocity.x * -ddz + b.velocity.z * ddx) / dd);
        const rad = (b.velocity.x * ddx + b.velocity.z * ddz) / dd;
        S.eng.lat += lat * dt;
        S.eng.rad += rad * dt;
        if (b.crouch > 0.5) S.eng.crouch += dt;
        if (!b.onGround) S.eng.air += dt;
      } else S.eng.blind += dt;
    }

    // y bins (2 m)
    const yk = Math.floor(b.position.y / 2) * 2;
    S.ySec[yk] = (S.ySec[yk] || 0) + dt;
    rec.maxY = Math.max(rec.maxY, b.position.y);
    rec.minY = Math.min(rec.minY, b.position.y);
    // yaw accumulation
    const yv = b._lastYaw === undefined ? b.yaw : b._lastYaw;
    const dy = Math.abs(wrap(b.yaw - yv));
    b._lastYaw = b.yaw;
    rec.yawWin.push(dy);
    if (br.faceAim && dt > 0) S.yawRates.push(dy / dt);
    rec.yawAcc += dy;
    if (rec.yawWin.length > 60) rec.yawAcc -= rec.yawWin.shift();
    if (rec.yawAcc > 6.28 * 1.5 && !br.faceAim) rec.spinT += dt;
    // vel reversals
    const sp = b.speed;
    if (sp > 2.5) {
      const ang = Math.atan2(b.velocity.x, b.velocity.z);
      if (!Number.isNaN(rec.lastAng)) {
        const d = Math.abs(wrap(ang - rec.lastAng));
        if (d > 2.4 && T - rec.revAt > 0.25) { rec.revs++; rec.revAt = T; if (st === 'roam' || st === 'chase' || st === 'collect') rec.revNav = (rec.revNav || 0) + 1; }
      }
      rec.lastAng = ang;
    } else rec.lastAng = NaN;
    // strafe flips
    if (br.strafeDir !== rec.lastStrafe) { if (st === 'engage') rec.strafeFlips++; rec.lastStrafe = br.strafeDir; }
    // visible target / firing time
    const tr = br.targetRec;
    if (tr && tr.visible) {
      rec.visT += dt;
      // record first sight
      if (!rec.sawEnemyAt.has(tr.ent) || T - (rec._lastVis || 0) > 1.5) rec.sawEnemyAt.set(tr.ent, T);
      rec._lastVis = T;
      if (br.intent.fire) rec.fireT += dt;
      // range bins per weapon
      const d = b.position.distanceTo(tr.ent.position);
      const wk = b.weaponId;
      const eb = S.engageRange[wk] || (S.engageRange[wk] = [0, 0, 0, 0, 0, 0]);
      eb[rb(d)] += dt;
      // weapon range fit
      const wd = WEAPONS[wk].bot;
      S.rangeMismatch.visSec += dt;
      const bad = d > wd.maxRange || d < wd.minRange;
      if (bad) { S.rangeMismatch.badSec += dt; S.rangeMismatch.byWeapon[wk] = (S.rangeMismatch.byWeapon[wk] || 0) + dt; }
    }
    if (rec.lastWeapon !== b.weaponId) { S.weaponSwitches++; rec.lastWeapon = b.weaponId; }
    // stuck sampling (0.5 s)
    if (T >= rec.stuckSampleAt) {
      rec.stuckSampleAt = T + 0.5;
      const moved = Math.hypot(b.position.x - rec.lastX, b.position.z - rec.lastZ);
      rec.lastX = b.position.x; rec.lastZ = b.position.z;
      const it = br.intent;
      const want = it.speed * Math.hypot(it.moveX, it.moveZ);
      if ((st === 'roam' || st === 'chase' || st === 'collect' || st === 'retreat') && want > 2 && moved < 0.3) { rec.stuckT += 0.5; }
      if (want > 2 && moved < 0.3) rec.stuckAny = (rec.stuckAny || 0) + 0.5;
      if (want < 0.5 && (st === 'roam')) rec.idleT += 0.5;
      // heavy dwell: roam/waiting
    }
  }

  // player awareness: time from bot spawn to first sight of the player; bot distance to the player
  const P0 = game.player;
  if (P0 && P0.alive && !game.spectate) {
    for (const [b, rec] of S.bot) {
      if (!b.alive) continue;
      const m = b.brain.mem.get(P0);
      const sp = S.spawnAt.get(b) ?? 0;
      if (!rec.pFirst && m && (m.visible)) { rec.pFirst = true; S.playerSeen.push(r2(T - sp, 1)); }
      if (rec.pFirstLife !== sp) { rec.pFirstLife = sp; rec.pFirst = !!(m && m.visible); if (rec.pFirst) S.playerSeen.push(r2(T - sp, 1)); }
    }
    if (T >= (S.nextPD || 2)) {
      S.nextPD = (S.nextPD || 2) + 2;
      const ds = game.bots.list.filter(b => b.alive).map(b => b.position.distanceTo(P0.position)).sort((a, b) => a - b);
      S.pdist.push({ t: r2(T, 0), min: r2(ds[0] ?? 0, 0), med: r2(ds[ds.length >> 1] ?? 0, 0) });
    }
  }
  // sampled global measurements (every 0.25 s)
  S.sampleAcc += dt;
  if (S.sampleAcc >= 0.25) {
    const step = S.sampleAcc; S.sampleAcc = 0;
    const bl = game.bots.list;
    for (const b of bl) {
      if (!b.alive) continue;
      S.cells.add(Math.floor(b.position.x / 4) + ',' + Math.floor(b.position.z / 4) + ',' + Math.floor(b.position.y / 3));
    }
    // pickup availability (share of time each pickup type is up for grabs)
    const pl0 = world.pickups && world.pickups.list;
    if (pl0) {
      S.pkTime += step;
      for (const p of pl0) {
        const k = p.type === 'weapon' ? 'weapon:' + p.weapon : p.type;
        const rec3 = S.pkAvail[k] || (S.pkAvail[k] = { n: 0, availSec: 0 });
        if (p.available) rec3.availSec += step;
      }
    }
    // clumping
    for (let i = 0; i < bl.length; i++) {
      const a = bl[i]; if (!a.alive) continue;
      S.clump.samples++;
      let near = false;
      for (let j = 0; j < bl.length; j++) {
        if (i === j || !bl[j].alive) continue;
        const o = bl[j];
        if (cfgMode === 'tdm' && o.team !== a.team) continue;
        if (Math.abs(o.position.y - a.position.y) < 2 && Math.hypot(o.position.x - a.position.x, o.position.z - a.position.z) < 3.5) { near = true; if (j > i) S.clump.pairs++; }
      }
      if (near) S.clump.withNeighbor++;
    }
    // ground truth LOS vs behaviour
    for (const b of bl) {
      if (!b.alive) continue;
      const br = b.brain;
      const eye = b.getEyePosition(_e);
      const cosHalf = Math.cos(b.brain.cfg.fov * Math.PI / 360);
      const fx = -Math.sin(b.yaw) * Math.cos(b.pitch), fz = -Math.cos(b.yaw) * Math.cos(b.pitch), fy = Math.sin(b.pitch);
      let anyLos = false, anyLosInFov = false;
      for (const e of ents) {
        if (e === b || !e.alive || e.team === b.team) continue;
        e.getChestPosition(_c);
        const dx = _c.x - eye.x, dy = _c.y - eye.y, dz = _c.z - eye.z;
        const d = Math.hypot(dx, dy, dz);
        if (d > 45) continue;
        if (!game.combat.canSee(eye, _c)) continue;
        anyLos = true;
        const dot = (dx * fx + dy * fy + dz * fz) / d;
        if (dot > cosHalf || d < 4.5) anyLosInFov = true;
      }
      if (anyLos) {
        S.los.time += step;
        if (anyLosInFov) {
          if (br.state === 'engage' || br.state === 'retreat') S.los.engaged += step;
          else S.los.ignored += step;
        } else S.los.behind += step;
      }
    }
  }

  // timeline every 5 s
  if (T >= (S.nextTL || 5)) {
    S.nextTL = (S.nextTL || 5) + 5;
    const c = { roam: 0, engage: 0, chase: 0, retreat: 0, collect: 0 };
    let alive = 0;
    for (const b of game.bots.list) if (b.alive) { c[b.brain.state]++; alive++; }
    S.timeline.push({ t: r2(T, 0), alive, ...c });
  }
}

export function finish(game, report) {
  const C = report.custom;
  const world0 = game.world;
  const T = game.time - S.t0;
  C.simSeconds = r2(T, 1);
  const bots = game.bots.list;
  let tot = { roam: 0, engage: 0, chase: 0, retreat: 0, collect: 0 };
  let aliveT = 0;
  let stuckT = 0, stuckAny = 0, transitions = 0, fastFlips = 0, revs = 0, revNav = 0, spinT = 0, recover = 0, rescues = 0, visT = 0, fireT = 0, idleT = 0, strafeFlips = 0;
  const per = [];
  let shots = 0, hits = 0, dmg = 0, gren = 0;
  for (const [b, r] of S.bot) {
    for (const k in tot) tot[k] += r.states[k] || 0;
    const a = Object.values(r.states).reduce((x, y) => x + y, 0);
    aliveT += a;
    stuckT += r.stuckT; stuckAny += r.stuckAny || 0; transitions += r.transitions; fastFlips += r.fastFlips; revs += r.revs; revNav += r.revNav || 0; spinT += r.spinT; recover += r.recoverCalls; rescues += r.rescues;
    visT += r.visT; fireT += r.fireT; idleT += r.idleT; strafeFlips += r.strafeFlips;
    shots += b.stats.shots; hits += b.stats.pelletHits; dmg += b.stats.damage; gren += b.stats.grenades;
    per.push({
      n: b.name.slice(0, 6), k: b.kills, d: b.deaths, w: b.weaponId, dmg: Math.round(b.stats.damage), shots: b.stats.shots, hits: b.stats.pelletHits,
      stuck: r.stuckT, rec: r.recoverCalls, resc: r.rescues, y: [r2(r.minY, 0), r2(r.maxY, 0)], tr: r.transitions, ff: r.fastFlips, revs: r.revs, spin: r2(r.spinT, 1),
    });
  }
  C.aliveBotSec = r2(aliveT, 0);
  C.stateShare = Object.fromEntries(Object.entries(tot).map(([k, v]) => [k, r2(v / Math.max(1, aliveT), 3)]));
  C.stuck = { sec: r2(stuckT, 1), share: r2(stuckT / Math.max(1, aliveT), 4), anySec: r2(stuckAny, 1), recoverCalls: recover, rescues };
  C.flap = { transitionsPerMin: r2(transitions / Math.max(1, aliveT) * 60, 1), fastFlips, revsPerMin: r2(revs / Math.max(1, aliveT) * 60, 1), revNavPerMin: r2(revNav / Math.max(1, aliveT) * 60, 1), spinSec: r2(spinT, 1), strafeFlipsPerEngageMin: r2(strafeFlips / Math.max(1, tot.engage) * 60, 1) };
  C.roamIdleShare = r2(idleT / Math.max(1, tot.roam), 3);
  C.combat = {
    kills: S.deaths, kpm: r2(S.deaths / Math.max(1, T) * 60, 1), firstDamageAt: r2(S.firstDamageAt, 1), firstKillAt: r2(S.firstKillAt, 1),
    botShots: shots, botPelletHits: hits, botDamage: Math.round(dmg), grenadesThrown: gren, grenadeHits: S.grenadeHits, grenadeKills: S.grenadeKills,
    visShare: r2(visT / Math.max(1, aliveT), 3), triggerShareOfVis: r2(fireT / Math.max(1, visT), 3),
    fireByWeapon: S.ev.fireByWeapon, dmgByWeapon: Object.fromEntries(Object.entries(S.ev.dmgByWeapon).map(([k, v]) => [k, Math.round(v)])),
    killsByWeapon: S.ev.killsByWeapon, suicides: S.ev.deathsSelf, falls: S.ev.deathsFall, friendlyDmg: Math.round(S.ev.friendlyDmg),
    spawnKills: S.ev.spawnKills, deathNearSpawn: S.deathNearSpawn,
  };
  const ld = S.ev.killDist.slice().sort((a, b) => a - b);
  C.combat.killDist = { n: ld.length, med: ld[ld.length >> 1] ?? null, p10: ld[Math.floor(ld.length * 0.1)] ?? null, p90: ld[Math.floor(ld.length * 0.9)] ?? null };
  const lf = S.ev.lifeSpans.slice().sort((a, b) => a - b);
  C.combat.lifeSpan = { n: lf.length, med: r2(lf[lf.length >> 1] ?? 0, 1), p10: r2(lf[Math.floor(lf.length * 0.1)] ?? 0, 1), p90: r2(lf[Math.floor(lf.length * 0.9)] ?? 0, 1) };
  const rd = S.reactDelays.slice().sort((a, b) => a - b);
  C.combat.reactDelay = { n: rd.length, med: rd[rd.length >> 1] ?? null, p10: rd[Math.floor(rd.length * 0.1)] ?? null, p90: rd[Math.floor(rd.length * 0.9)] ?? null };
  C.combat.blockedFireShare = r2(S.blockedFire / Math.max(1, S.botFireEvents), 4);
  C.combat.nonVisibleFire = S.nonVisFire;
  // accuracy per weapon/range
  const acc = {};
  for (const k in S.pel) {
    const [w, bin] = k.split(':');
    const p = S.pel[k];
    (acc[w] || (acc[w] = {}))[['<6', '6-12', '12-20', '20-35', '35-60', '60+'][bin]] = `${p.ent}/${p.n} (${Math.round(100 * p.ent / p.n)}%) cover ${p.cover} past ${p.past} other ${p.other} miss ${p.miss}`;
  }
  C.accuracy = acc;
  C.playerPel = S.playerPel;
  C.engageRangeSec = Object.fromEntries(Object.entries(S.engageRange).map(([w, a]) => [w, a.map(v => r2(v, 1))]));
  C.rangeMismatch = { visSec: r2(S.rangeMismatch.visSec, 1), badSec: r2(S.rangeMismatch.badSec, 1), byWeapon: S.rangeMismatch.byWeapon };
  C.los = { totalBotSec: r2(S.los.time, 1), engaged: r2(S.los.engaged, 1), ignoredInFov: r2(S.los.ignored, 1), behind: r2(S.los.behind, 1) };
  C.clump = { withNeighborShare: r2(S.clump.withNeighbor / Math.max(1, S.clump.samples), 3), pairSamples: S.clump.pairs, samples: S.clump.samples };
  C.pickups = S.pickups;
  C.coverage = { cells4m: S.cells.size };
  const yb = {};
  let ysum = 0;
  for (const k in S.ySec) ysum += S.ySec[k];
  for (const k of Object.keys(S.ySec).sort((a, b) => a - b)) yb[k] = r2(S.ySec[k] / ysum, 3);
  C.botTimeByY = yb;
  C.timeline = S.timeline;
  if (!game.spectate) {
    const ps = S.playerSeen.slice().sort((a, b) => a - b);
    C.playerSeenAfterSpawn = { n: ps.length, med: ps[ps.length >> 1] ?? null, p10: ps[Math.floor(ps.length * 0.1)] ?? null, p90: ps[Math.floor(ps.length * 0.9)] ?? null };
    C.playerDist = S.pdist.filter((_, i) => i % 3 === 0).slice(0, 14);
    const P1 = game.player;
    C.playerIdleFind = { firstDamageAt: r2(S.pFirstDmg, 1), deaths: S.pDeaths };
    C.playerStats = { kills: P1.kills, deaths: P1.deaths, health: Math.round(P1.health), dmgTaken: report.player.damageTaken, dmgDealt: report.player.damageDealt, shots: report.player.shots, acc: S.playerPel.n ? r2(S.playerPel.ent / S.playerPel.n, 3) : null };
  }
  C.deathCtx = S.deathCtx || null;
  C.collectByType = Object.fromEntries(Object.entries(S.colBy).map(([k, v]) => { const d = v.dists.slice().sort((x, y) => x - y); return [k, { trips: v.trips, ok: v.ok, sec: r2(v.sec, 0), medDist: d[d.length >> 1], abortedTo: v.to }]; }));
  C.transitions = S.trans;
  C.chaseDurMedByExit = Object.fromEntries(Object.entries(S.chaseDur).map(([k, v]) => { const b = v.slice().sort((x, y) => x - y); return [k, { n: b.length, med: b[b.length >> 1] }]; }));
  { // retreat episodes: did the enemy have less health than the retreating bot?
    const ep = S.retEp;
    const lower = ep.filter(e => e.ehp >= 0 && e.ehp <= e.hp);
    const cnt = a => ({ n: a.length, dead: a.filter(e => e.out === 'dead').length, alive: a.filter(e => e.out === 'alive').length });
    C.retreatEpisodes = { all: cnt(ep), enemyHpLEmine: cnt(lower), enemyHpGTmine: cnt(ep.filter(e => e.ehp > e.hp)), visibleAtStart: cnt(ep.filter(e => e.vis)), kinds: ep.reduce((o, e) => { o[e.kind || '?'] = (o[e.kind || '?'] || 0) + 1; return o; }, {}), sample: ep.slice(0, 12) };
  }
  C.nullAttacker = { dmg: Object.fromEntries(Object.entries(S.nullDmg).map(([k, v]) => [k, Math.round(v)])), deaths: S.nullDeaths, explosions: S.expl };
  C.grenadeExplosions = S.gren;
  C.collect = { trips: S.col.trips, ok: S.col.ok, fail: S.col.fail, secTotal: r2(S.col.sec, 0), secFailed: r2(S.col.failSec, 0) };
  const med = a => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[b.length >> 1] : null; };
  C.retreat = { enter: S.ret.enter, exit: S.ret.exit, deaths: S.ret.deathAfter.length, medDistToThreatAtEnter: med(S.ret.dist), medDur: med(S.ret.dur), medSecToDeath: med(S.ret.deathAfter) };
  const wtot = Object.values(S.wSec).reduce((a, b) => a + b, 0) || 1;
  C.weaponShare = Object.fromEntries(Object.entries(S.wSec).map(([k, v]) => [k, r2(v / wtot, 3)]));
  C.pistolHeld = { withOtherOwnedShare: r2(S.pistolWithOthers / wtot, 3), primaryDepletedShare: r2(S.pistolDepleted / wtot, 3) };
  C.retreatKinds = Object.fromEntries(Object.entries(S.retreatKinds).map(([k, v]) => [k, r2(v, 1)]));
  C.coverReloadSec = r2(S.coverReload, 1);
  const E = S.eng;
  C.engage = { visSec: r2(E.vis, 1), blindSec: r2(E.blind, 1), stillShare: r2(E.still / Math.max(1, E.vis), 3), meanLatSpeed: r2(E.lat / Math.max(1, E.vis), 2), meanRadialSpeed: r2(E.rad / Math.max(1, E.vis), 2), crouchShare: r2(E.crouch / Math.max(1, E.vis), 3), airShare: r2(E.air / Math.max(1, E.vis), 3) };
  const yr = S.yawRates.slice().sort((a, b) => a - b);
  C.yawRate = { n: yr.length, p50: r2(yr[yr.length >> 1] ?? 0, 2), p95: r2(yr[Math.floor(yr.length * 0.95)] ?? 0, 2), p99: r2(yr[Math.floor(yr.length * 0.99)] ?? 0, 2) };
  const ae = S.aimErr.slice().sort((a, b) => a - b);
  C.aimErrMetersAtFire = { n: ae.length, p50: r2(ae[ae.length >> 1] ?? 0, 2), p90: r2(ae[Math.floor(ae.length * 0.9)] ?? 0, 2) };
  const cnt0 = {};
  for (const p of world0.pickups.list) { const k = p.type === 'weapon' ? 'weapon:' + p.weapon : p.type; cnt0[k] = (cnt0[k] || 0) + 1; }
  C.pickupAvailShare = Object.fromEntries(Object.entries(S.pkAvail).map(([k, v]) => [k, r2(v.availSec / Math.max(1, S.pkTime) / (cnt0[k] || 1), 2)]));
  C.pickupCounts = (() => { const o = {}; for (const p of world0.pickups.list) { const k = p.type === 'weapon' ? 'weapon:' + p.weapon : p.type; o[k] = (o[k] || 0) + 1; } return o; })();
  C.per = per;
  C.grenadeThrows = S.grenadeThrows;
  C.weaponSwitches = S.weaponSwitches;
  C.rocketSelf = S.rocketSelf;
  if (game.player) C.player = { kills: game.player.kills, deaths: game.player.deaths };
}
