// Random-input fuzz of WeaponSystem with invariant checks.
import { WEAPONS, WEAPON_ORDER, GRENADE } from '/src/weapons/WeaponDefs.js';
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const R = rng(parseInt(new URLSearchParams(location.search).get("seed") || "12345", 10));
const viol = {};
const log = [];
const note = (k, t, extra) => { if (!viol[k]) { viol[k] = { n: 0, first: t, extra }; } viol[k].n++; };
let held = {};
let nextChange = {};
let stuck = { g: 0, melee: 0, switching: 0, reloading: 0, ads: 0 };
let stats = { deaths: 0, respawns: 0, explosions: 0, fires: 0, cookoffs: 0 };
export function setup(game, report) {
  report.custom = { viol, stats, log };
  game.events.on('death', e => { if (e.victim === game.player) stats.deaths++; });
  game.events.on('spawn', e => { if (e.entity === game.player) stats.respawns++; });
  game.events.on('explosion', e => { stats.explosions++; });
  game.events.on('weapon:fire', e => { if (e.shooter === game.player) stats.fires++; });
  // give everything so all weapons get exercised
  game.weapons.giveWeapon('sniper'); game.weapons.giveWeapon('rocket');
}
function toggle(game, action, t, pOn, minHold, maxHold, minOff, maxOff) {
  const cur = held[action] || false;
  if (t >= (nextChange[action] || 0)) {
    if (cur) { held[action] = false; nextChange[action] = t + minOff + R() * (maxOff - minOff); }
    else if (R() < pOn) { held[action] = true; nextChange[action] = t + minHold + R() * (maxHold - minHold); }
    else nextChange[action] = t + 0.1;
  }
  game.input.setVirtual(action, held[action] || false);
}
export function drive(t, dt, game, report) {
  const w = game.weapons, p = game.player, inp = game.input;
  // movement chaos
  toggle(game, 'forward', t, 0.7, 0.5, 3, 0.2, 1);
  toggle(game, 'sprint', t, 0.4, 0.3, 2, 0.2, 1);
  toggle(game, 'jump', t, 0.5, 0.05, 0.2, 0.3, 1.5);
  toggle(game, 'crouch', t, 0.2, 0.2, 1, 0.5, 2);
  toggle(game, 'fire', t, 0.6, 0.05, 1.5, 0.1, 0.8);
  toggle(game, 'ads', t, 0.4, 0.2, 2, 0.2, 1.5);
  toggle(game, 'reload', t, 0.15, 0.03, 0.08, 0.3, 3);
  toggle(game, 'grenade', t, 0.15, 0.05, 3.3, 1, 4);
  toggle(game, 'melee', t, 0.12, 0.03, 0.08, 0.5, 3);
  for (let i = 1; i <= 5; i++) toggle(game, 'weapon' + i, t, 0.05, 0.03, 0.08, 0.4, 4);
  toggle(game, 'lastWeapon', t, 0.04, 0.03, 0.08, 0.4, 4);
  if (R() < 0.01) inp.wheel = R() < 0.5 ? 1 : -1;
  inp.addLook((R() - 0.5) * 600 * dt * 4, (R() - 0.5) * 120 * dt);
  // auto refill so we exercise more (occasionally)
  if (R() < 0.002) { w.addAmmo(null, 0.5); w.addGrenades(2); }

  // ---- invariants
  const inv = w.inv;
  for (const id of WEAPON_ORDER) {
    const d = WEAPONS[id], v = inv[id];
    if (!(v.ammo >= 0 && v.ammo <= d.magSize)) note('ammo-range-' + id, t, `${v.ammo}`);
    if (!(v.reserve >= 0) || (Number.isFinite(d.reserveMax) && v.reserve > d.reserveMax)) note('reserve-range-' + id, t, `${v.reserve}`);
    if (Number.isNaN(v.ammo) || Number.isNaN(v.reserve)) note('nan-inv', t);
  }
  if (!(w.grenades >= 0 && w.grenades <= w.maxGrenades)) note('grenades-range', t, `${w.grenades}`);
  if (!(w.cookProgress >= 0 && w.cookProgress <= 1)) note('cook-range', t, `${w.cookProgress}`);
  if (!(w.adsAmount >= 0 && w.adsAmount <= 1)) note('ads-range', t, `${w.adsAmount}`);
  if (Number.isNaN(w.spreadAngle)) note('nan-spread', t);
  if (Number.isNaN(p.fovMultiplier) || Number.isNaN(p.lookScale)) note('nan-fov', t);
  if (p.alive) {
    if (w.ammo !== inv[w.currentId].ammo && w.switchState !== 1) note('hud-ammo-mismatch', t, `${w.ammo} vs ${inv[w.currentId].ammo} (${w.currentId})`);
    if (w.reserve !== inv[w.currentId].reserve && w.switchState !== 1) note('hud-reserve-mismatch', t, `${w.reserve} vs ${inv[w.currentId].reserve}`);
    stuck.g = w.gState !== 0 ? stuck.g + dt : 0;
    stuck.melee = w.meleeT >= 0 ? stuck.melee + dt : 0;
    stuck.switching = w.switchState !== 0 ? stuck.switching + dt : 0;
    stuck.reloading = w.reloading ? stuck.reloading + dt : 0;
    if (stuck.g > 4) note('stuck-grenade-state', t, `g=${w.gState}`);
    if (stuck.melee > 1) note('stuck-melee', t);
    if (stuck.switching > 2) note('stuck-switch', t, `s=${w.switchState} eq=${w.equipAmount}`);
    if (stuck.reloading > 6) note('stuck-reload', t);
    if (w.cooking && w.gState === 0) note('cooking-but-idle', t);
    if (w.scoped && !w.current.scoped) note('scoped-nonscope', t);
  } else {
    if (w.scoped) note('scoped-while-dead', t);
  }
}
export function finish(game, report) {
  const w = game.weapons;
  report.custom.final = { cur: w.currentId, owned: w.owned.join(','), grenades: w.grenades, projectiles: game.projectiles.grenades.length, rockets: game.projectiles.rockets.length };
}
