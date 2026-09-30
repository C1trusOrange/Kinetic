// Scripted firing scenario for gun-feel screenshots.
// Params: w=<weapon> ads=0|1 n=<shots before freeze> t=bot|wall|metal|brick|stone|wood|glass|crate d=<bot distance>
import * as THREE from 'three';
const P = new URLSearchParams(location.search);
const W = P.get('w') || 'rifle';
const ADS = P.get('ads') === '1';
const N = parseInt(P.get('n') || '3', 10);
const T = P.get('t') || 'wall';
const DIST = parseFloat(P.get('d') || '14');
const PZ = parseFloat(P.get('pz') || '22');
const AFTER = parseFloat(P.get('after') || '0');
const slotKey = { pistol: 'weapon1', rifle: 'weapon2', shotgun: 'weapon3', sniper: 'weapon4', rocket: 'weapon5' }[W];
let shots = 0, frozen = false, bot = null, freezeAt = -1, fireStep = 0, doneShotsAt = -1, explodedAt = -1;
const R = {};

export async function setup(game, report) {
  report.custom = R;
  game.player.god = true;
  for (const id of ['sniper', 'rocket']) game.weapons.giveWeapon(id);
  const p = game.player;
  p.move.place(new THREE.Vector3(0, 0, PZ));
  p.prevPosition.copy(p.position);
  p.yaw = 0; p.pitch = 0;
  game.events.on('weapon:fire', e => { if (e.shooter === game.player) { shots++; if (shots >= N && AFTER === 0 && W !== 'rocket') { game.timeScale = +(P.get('slow') || 0); frozen = true; freezeAt = game.time; } } });
  game.events.on('explosion', () => { explodedAt = game.time; });
  if (T === 'bot' && game.bots.list[0]) {
    bot = game.bots.list[0];
    bot.god = !(P.get('kill') === '1');
    if (P.get('kill') === '1') bot.health = 10;
    if (P.get('hp')) { bot.god = false; bot.maxHealth = bot.health = parseFloat(P.get('hp')); }
    bot.update = () => {};
    bot.position.set(0, 0, PZ - DIST);
    bot.velocity.set(0, 0, 0);
    bot.yaw = 0; bot.bodyYaw = 0;
    bot.model.root.position.copy(bot.position);
    bot.model.root.rotation.y = 0;
    bot.model.root.updateMatrixWorld(true);
  }
  for (const id of Object.keys(game.weapons.inv)) { const inv = game.weapons.inv[id]; inv.ammo = Math.max(inv.ammo, 5); }
}

export function drive(t, dt, game, report) {
  const inp = game.input;
  const p = game.player;
  if (frozen) {
    if (!window.__FROZEN__) { try { document.getAnimations().forEach(a => { a.pause(); if (P.get('t90') === '1') a.currentTime = 90; }); } catch (e) { /* ignore */ } }
    window.__FROZEN__ = true;
    return;
  }
  let ty = P.get('head') === '1' ? 1.58 : 1.116, tx = 0, tz = PZ - DIST;
  if (T === 'wall') { tx = 0; tz = -30; ty = 2; }
  if (T === 'metal') { tx = -18; tz = -29.5; ty = 2; }
  if (T === 'brick') { tx = -8; tz = -29.5; ty = 2; }
  if (T === 'stone') { tx = 2; tz = -29.5; ty = 2; }
  if (T === 'wood') { tx = 12; tz = -29.5; ty = 2; }
  if (T === 'glass') { tx = 20.5; tz = -29.5; ty = 2; }
  if (T === 'crate') { tx = -6; tz = -12; ty = 0.6; }
  const dx = tx - p.position.x, dz = tz - p.position.z;
  if (t < 1.6) {
    p.yaw = Math.atan2(-dx, -dz);
    p.pitch = Math.atan2(ty - 1.66, Math.hypot(dx, dz));
    inp.setVirtual(slotKey, t > 0.1 && t < 0.2);
    inp.setVirtual('ads', false);
    return;
  }
  inp.setVirtual(slotKey, false);
  inp.setVirtual('ads', ADS);
  if (t < 2.4) { p.yaw = Math.atan2(-dx, -dz); p.pitch = Math.atan2(ty - 1.66, Math.hypot(dx, dz)); return; }
  const def = game.weapons.current;
  if (P.get('act')) {
    const w = game.weapons;
    if (!w._act) { w._act = true; inp.setVirtual(P.get('act'), true); return; }
    if (P.get('act') === 'melee') { inp.setVirtual('melee', false); if (w.meleeT >= parseFloat(P.get('actAt') || '0.19')) { game.timeScale = 0; frozen = true; R.meleeT = w.meleeT; } }
    if (P.get('act') === 'grenade' && w.gState >= 1 && w.cookTime > parseFloat(P.get('actAt') || '1.0')) { game.timeScale = 0; frozen = true; R.cook = w.cookTime; }
    return;
  }
  if (P.get('reloadAt')) {
    const want = parseFloat(P.get('reloadAt'));
    const w = game.weapons;
    if (!w._rl) { w._rl = true; w.inv[W].ammo = Math.min(w.inv[W].ammo, 1); w.ammo = w.inv[W].ammo; inp.setVirtual('reload', true); return; }
    inp.setVirtual('reload', false);
    if (w.reloading && w.reloadProgress >= want) { game.timeScale = 0; frozen = true; R.reloadProgress = w.reloadProgress; R.reloadT = w.reloadT; }
    return;
  }
  if (game.weapons.currentId !== W) R.error = 'weapon not equipped ' + game.weapons.currentId;
  if (shots < N) {
    if (def.auto) inp.setVirtual('fire', true);
    else { fireStep++; inp.setVirtual('fire', fireStep % 2 === 1); }
  } else {
    inp.setVirtual('fire', false);
    if (doneShotsAt < 0) doneShotsAt = game.time;
    const wantFreeze = W === 'rocket' ? (explodedAt >= 0 && game.time - explodedAt >= AFTER) : (game.time - doneShotsAt >= AFTER);
    if (wantFreeze && freezeAt < 0) {
      freezeAt = game.time;
      game.timeScale = +(P.get('slow') || 0);
      R.shots = shots; R.flashT = game.weapons.flashT; R.spread = game.weapons.spreadAngle;
      frozen = true;
    }
  }
  R.tFire = t;
}

export function finish(game, report) { report.custom.shots = shots; }
