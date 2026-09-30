// Per-subsystem CPU cost per frame (mean / p95 / max) + path stats + frame intervals. Loops the standard 17 s script.
const G = window.__GAME__;
const S = { parts: {}, frames: [], hitchFrames: [] };
let cur = null;
const wrap = (obj, name, label) => {
  if (!obj || typeof obj[name] !== 'function') return;
  const o = obj[name];
  obj[name] = function (...a) {
    const t = performance.now();
    const r = o.apply(this, a);
    const d = performance.now() - t;
    if (cur) cur[label] = (cur[label] || 0) + d;
    return r;
  };
};
export function setup(game, report) {
  wrap(game.player, 'update', 'player.update');
  wrap(game.weapons, 'update', 'weapons.update');
  wrap(game.bots, 'update', 'bots.update');
  wrap(game.projectiles, 'update', 'projectiles.update');
  wrap(game.world, 'update', 'world.update');
  wrap(game.effects, 'update', 'effects.update');
  wrap(game.player, 'updateCamera', 'player.updateCamera');
  wrap(game.weapons, 'updateViewModel', 'weapons.updateViewModel');
  wrap(game.audio, 'update', 'audio.update');
  wrap(game.hud, 'update', 'hud.update');
  wrap(game, '_updateMatch', 'updateMatch');
  wrap(game, 'render', 'render');
  // path requests
  wrap(game.world.nav, 'findPath', 'nav.findPath');
  wrap(game.world.nav, 'isConnected', 'nav.isConnected');
  const cw = game.world.collision;
  wrap(cw, 'raycast', 'collision.raycast');
  wrap(cw, 'moveCapsule', 'collision.moveCapsule');
  wrap(cw, 'probeGround', 'collision.probeGround');
  wrap(game.combat, 'canSee', 'combat.canSee');
  wrap(game.combat, 'raycast', 'combat.raycast');
  // count raycasts per frame
  const or = cw.raycast;
  let n = 0;
  cw.raycast = function (...a) { n++; return or.apply(this, a); };
  S.rc = () => { const v = n; n = 0; return v; };
  const ou = game.update.bind(game);
  game.update = function (dt) {
    cur = {};
    const t = performance.now();
    ou(dt);
    cur.total_update = performance.now() - t - (cur.render || 0);
    cur.rays = S.rc();
    S.frames.push(cur);
    cur = null;
  };
  // render is called outside update; capture separately
  const orr = game.render.bind(game);
  game.render = function () {
    const t = performance.now();
    orr();
    const d = performance.now() - t;
    S.render = S.render || [];
    S.render.push(d);
  };
  report.custom = {};
  S.t0 = performance.now();
}
export function drive(t0, dt, game, report) {
  const t = t0 % 17;
  const inp = game.input;
  const s = (a, b) => t >= a && t < b;
  inp.setVirtual('forward', s(1, 9.5) || s(12, 17));
  inp.setVirtual('sprint', s(1.3, 4.2) || s(14, 16));
  inp.setVirtual('jump', s(2.4, 2.5) || s(2.9, 3.0) || s(10.45, 10.55) || s(13.6, 13.7) || s(15.2, 15.3));
  inp.setVirtual('crouch', s(3.6, 4.4));
  inp.setVirtual('ads', s(5.6, 6.4));
  inp.setVirtual('fire', s(4.8, 6.4) || s(7.0, 7.05) || s(7.35, 7.4) || s(7.7, 7.75) || s(8.3, 8.35) || s(9.6, 9.65) || s(10.5, 10.55));
  inp.setVirtual('reload', s(6.5, 6.55));
  inp.setVirtual('weapon1', s(6.8, 6.85));
  inp.setVirtual('weapon3', s(8.0, 8.05));
  if (t >= 9.0 && !game.__gave) { game.__gave = true; game.weapons.giveWeapon('sniper'); game.weapons.giveWeapon('rocket'); }
  inp.setVirtual('weapon4', s(9.1, 9.15));
  inp.setVirtual('weapon5', s(10.0, 10.05));
  inp.setVirtual('grenade', s(11.0, 11.6));
  inp.setVirtual('weapon2', s(11.8, 11.85));
  inp.setVirtual('grapple', s(12.3, 12.35) || s(13.5, 13.55));
  inp.setVirtual('melee', s(16.5, 16.55));
  let lx = 0, ly = 0;
  if (s(4.8, 6.4)) lx = 250;
  if (s(10.2, 10.45)) ly = 2400;
  if (s(10.7, 10.95)) ly = -2400;
  if (s(12.0, 12.3)) ly = -800;
  if (s(13.8, 14.1)) ly = 800;
  if (s(14, 17)) lx = 140;
  inp.addLook(lx * dt, ly * dt);
  if (!game.player.alive || game.player.health < 40) { game.player.god = true; }
}
const pct = (arr, q) => { if (!arr.length) return 0; const s = arr.slice().sort((a, b) => a - b); return +s[Math.min(s.length - 1, Math.floor(s.length * q))].toFixed(2); };
export function finish(game, report) {
  const fr = S.frames.slice(10);
  const keys = new Set(); fr.forEach(f => Object.keys(f).forEach(k => keys.add(k)));
  const out = {};
  for (const k of keys) {
    const a = fr.map(f => f[k] || 0);
    out[k] = { mean: +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(3), p95: pct(a, 0.95), p99: pct(a, 0.99), max: +Math.max(...a).toFixed(2) };
    if (k.startsWith('nav.') || k.includes('canSee')) { const nz = a.filter(v => v > 0); out[k].calls = 0; }
  }
  report.custom = {
    frames: fr.length,
    perFrame: out,
    renderMs: { mean: +(S.render.reduce((x, y) => x + y, 0) / S.render.length).toFixed(2), p95: pct(S.render, 0.95), max: +Math.max(...S.render).toFixed(1) },
    pathStats: game.bots.pathStats,
    botCount: game.bots.list.length,
  };
}
