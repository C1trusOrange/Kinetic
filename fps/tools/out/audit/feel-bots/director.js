// Director scenario (read-only audit): waits for a specific bot behaviour, frames it with a fixed camera, annotates it and freezes the sim.
// URL: scenario=.../director.js&shot=retreat|pistol|blocked|clump&cam=0,0,0,0,0 (cam flag makes Game use game.fixedCam that we rewrite each frame)
import * as THREE from 'three';

let mode = 'retreat';
let lock = null;      // { bot, enemy, since }
let frozen = false;
let label = null;
let blockedHit = null;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _m = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Vector3();

function setLabel(text) {
  if (!label) {
    label = document.createElement('div');
    label.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:99999;background:rgba(0,0,0,0.75);color:#fff;font:600 18px/1.35 monospace;padding:8px 12px;border-left:4px solid #3de0ff;white-space:pre;pointer-events:none';
    document.body.appendChild(label);
  }
  label.textContent = text;
}

function aimCam(game, from, to) {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  game.fixedCam = [from.x, from.y, from.z, Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))];
}

function freeze(game) {
  frozen = true;
  game.timeScale = 0;
  window.__FREEZE = true;
}

export function setup(game) {
  mode = game.params.get('shot') || 'retreat';
  game.fixedCam = [0, 30, 0, 0, -1.2];
  if (mode === 'blocked') {
    game.events.on('weapon:fire', e => {
      if (frozen || blockedHit) return;
      const sh = e.shooter;
      if (!sh || !sh.isBot) return;
      const tr = sh.brain.targetRec;
      if (!tr || !tr.visible) return;
      const d = sh.position.distanceTo(tr.ent.position);
      if (d < 12) return;
      const hit = game.world.raycast(e.origin, e.direction, d);
      if (hit && hit.distance < d - 2.0 && hit.distance > 3) blockedHit = { bot: sh, enemy: tr.ent, hitDist: hit.distance, d, at: game.time, point: hit.point.clone(), origin: e.origin.clone() };
    });
  }
}

export function drive(t, dt, game) {
  if (frozen) return;
  const bots = game.bots.list;
  if (mode === 'blocked') {
    if (!blockedHit) return;
    const h = blockedHit;
    // side view of shooter -> wall impact -> target
    _m.copy(h.bot.position).add(h.enemy.position).multiplyScalar(0.5);
    _a.subVectors(h.enemy.position, h.bot.position); _a.y = 0; _a.normalize();
    _s.set(-_a.z, 0, _a.x);
    _c.copy(_m).addScaledVector(_s, h.d * 0.55 + 3); _c.y += 6;
    // only frame it if the side is not inside geometry
    aimCam(game, _c, _m);
    setLabel(`BLOCKED SHOT (normal bot)\n${h.bot.name} fired at ${h.enemy.name} ${h.d.toFixed(0)} m away\nbullet hits geometry after ${h.hitDist.toFixed(1)} m`);
    if (game.time - h.at > 0.05) freeze(game);
    return;
  }
  if (!lock) {
    for (const b of bots) {
      if (!b.alive) continue;
      const br = b.brain, tr = br.targetRec;
      if (!tr || !tr.visible || !tr.ent.alive) continue;
      const d = b.position.distanceTo(tr.ent.position);
      if (mode === 'retreat' && br.state === 'retreat' && b.health < 40 && d > 7 && d < 28 && Math.abs(b.position.y - tr.ent.position.y) < 2) { lock = { bot: b, enemy: tr.ent, since: game.time }; break; }
      if (mode === 'pistol' && b.weaponId === 'pistol' && d > 12 && d < 40) {
        let better = null;
        for (const id of b.owned) if ((id === 'rifle' || (id === 'rocket' && d > 10) || (id === 'sniper' && d > 30)) && b.inv[id].mag + b.inv[id].reserve > 0) better = id;
        if (better && Math.abs(b.position.y - tr.ent.position.y) < 2) { lock = { bot: b, enemy: tr.ent, since: game.time, better }; break; }
      }
      if (mode === 'longfire' && b.weaponId === 'pistol' && d > 34 && br.intent.fire) { lock = { bot: b, enemy: tr.ent, since: game.time }; break; }
    }
    if (!lock && mode === 'clump') {
      for (const b of bots) {
        if (!b.alive) continue;
        let n = 0;
        for (const o of bots) if (o !== b && o.alive && o.team === b.team && Math.hypot(o.position.x - b.position.x, o.position.z - b.position.z) < 3.5 && Math.abs(o.position.y - b.position.y) < 2) n++;
        if (n >= 2) { lock = { bot: b, enemy: b, since: game.time }; break; }
      }
    }
    return;
  }
  const { bot, enemy } = lock;
  if (!bot.alive || (!enemy.alive && mode !== 'clump')) { lock = null; return; }
  _m.copy(bot.position).add(enemy.position).multiplyScalar(0.5);
  _m.y += 1.0;
  _a.subVectors(enemy.position, bot.position); _a.y = 0;
  const d = Math.max(4, _a.length());
  _a.normalize();
  _s.set(-_a.z, 0, _a.x);
  if (mode === 'clump') { _m.copy(bot.position); _m.y += 1; _c.copy(bot.position).addScaledVector(_s, 7); _c.y += 3; }
  else { _c.copy(_m).addScaledVector(_s, Math.max(6, d * 0.7 + 3)); _c.y += 2.5; }
  aimCam(game, _c, _m);
  const el = game.time - lock.since;
  const tr = bot.brain.targetRec;
  if (mode === 'retreat') setLabel(`RETREAT (normal bot)\n${bot.name} hp ${Math.round(bot.health)} sprinting for health/cover, back to ${enemy.name} (${d.toFixed(0)} m)\nstate=${bot.brain.state}/${bot.brain.retreatKind}  weapon=${bot.weaponId}`);
  else if (mode === 'pistol') setLabel(`WEAPON CHOICE (normal bot)\n${bot.name} holds PISTOL vs ${enemy.name} at ${d.toFixed(0)} m\nowns ${bot.owned.join('+')}  (${lock.better}: mag ${bot.inv[lock.better].mag} + reserve ${bot.inv[lock.better].reserve})`);
  else if (mode === 'longfire') setLabel(`LONG-RANGE PISTOL (normal bot)\n${bot.name} firing pistol at ${enemy.name} ${d.toFixed(0)} m away`);
  else setLabel(`CLUMP (normal bot)\n${bot.name} within 3.5 m of 2+ teammates`);
  if (el > (mode === 'retreat' ? 0.9 : 0.5)) freeze(game);
}

export function finish() {}
