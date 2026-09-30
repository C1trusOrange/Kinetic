// Logs every single call > threshold ms of bot / nav / effects / weapons methods.
export function setup(game, report) {
  const c = report.custom = { slow: [], counts: {} };
  const TH = 6;
  const wrapProto = (proto, name, label) => {
    const orig = proto[name];
    if (typeof orig !== 'function') return;
    proto[name] = function (...a) {
      const t = performance.now();
      const r = orig.apply(this, a);
      const d = performance.now() - t;
      c.counts[label] = (c.counts[label] || 0) + 1;
      if (d > TH) c.slow.push({ label, ms: +d.toFixed(1), t: +game.time.toFixed(2), who: this && this.name ? this.name : '' });
      return r;
    };
  };
  const bot0 = game.bots.list[0];
  const BotP = Object.getPrototypeOf(bot0);
  for (const n of ['update', '_move', '_updateModel', 'selectWeapon', 'spawn', 'onDeath', '_getWeaponModel', '_fire', 'startReload', 'throwGrenade', '_updateWeaponState', '_handleWeaponIntent']) wrapProto(BotP, n, 'Bot.' + n);
  const BrainP = Object.getPrototypeOf(bot0.brain);
  for (const n of ['update', 'perceive', 'think', 'selectTarget', 'chooseState', 'pickRoamGoal', 'pickRetreatGoal', 'updateMovement', 'updateAim', 'updateFire', 'updateStuck', 'considerGrenade', 'checkGrenades', 'rescue', 'findCover', 'chooseWeapon']) wrapProto(BrainP, n, 'Brain.' + n);
  const NavP = Object.getPrototypeOf(bot0.brain.nav);
  for (const n of Object.getOwnPropertyNames(NavP)) if (n !== 'constructor' && typeof NavP[n] === 'function') wrapProto(NavP, n, 'BotNav.' + n);
  const GraphP = Object.getPrototypeOf(game.world.nav);
  for (const n of ['findPath', 'nearestNode', 'randomNode', 'randomPointNear', 'isConnected']) wrapProto(GraphP, n, 'NavGraph.' + n);
  const BM = Object.getPrototypeOf(bot0.model);
  for (const n of ['update', 'breakApart', 'setWeapon', 'flashHit', 'setVisible', 'reset']) wrapProto(BM, n, 'BotModel.' + n);
  const EP = Object.getPrototypeOf(game.effects);
  for (const n of ['impact', 'hitSpark', 'tracer', 'muzzleFlash', 'flashLight', 'explosion', 'trail', 'gibs', 'dust', '_updateGibs', 'update']) wrapProto(EP, n, 'Effects.' + n);
  const CP = Object.getPrototypeOf(game.combat);
  for (const n of ['raycast', 'canSee', 'fireBullet', 'radialDamage', 'applyDamage', 'kill']) wrapProto(CP, n, 'Combat.' + n);
  const PP = Object.getPrototypeOf(game.projectiles);
  for (const n of ['update', 'explode', 'spawnRocket', 'spawnGrenade', '_warm']) wrapProto(PP, n, 'Projectiles.' + n);
  const WP = Object.getPrototypeOf(game.weapons);
  for (const n of ['update', 'updateViewModel', 'onPlayerSpawn', '_selectVisual', 'giveWeapon']) wrapProto(WP, n, 'Weapons.' + n);
  const AP = Object.getPrototypeOf(game.audio);
  for (const n of ['play', 'playLoop', 'update']) wrapProto(AP, n, 'Audio.' + n);
  const HP = Object.getPrototypeOf(game.hud);
  for (const n of ['update', '_onDamage', '_onDeath', '_onSpawn', '_onPickup', 'onMatchStart']) wrapProto(HP, n, 'HUD.' + n);
  const PLP = Object.getPrototypeOf(game.player);
  for (const n of ['update', 'updateCamera', 'spawn']) wrapProto(PLP, n, 'Player.' + n);
  const WOP = Object.getPrototypeOf(game.world);
  for (const n of ['update', 'reset']) wrapProto(WOP, n, 'World.' + n);
  wrapProto(Object.getPrototypeOf(game), 'respawnEntity', 'Game.respawnEntity');
  wrapProto(Object.getPrototypeOf(game), 'pickSpawnPoint', 'Game.pickSpawnPoint');
  wrapProto(Object.getPrototypeOf(game), '_updateMatch', 'Game._updateMatch');
}
export function drive(t, dt, game, report) {
  const S = (a, b) => t >= a && t < b;
  const inp = game.input;
  inp.setVirtual('forward', S(1, 9.5) || S(12, 17));
  inp.setVirtual('sprint', S(1.3, 4.2) || S(14, 16));
  inp.setVirtual('fire', S(4.8, 6.4) || S(7.0, 7.05) || S(7.35, 7.4) || S(7.7, 7.75) || S(8.3, 8.35));
  inp.setVirtual('grenade', S(11.0, 11.6));
  let lx = 0;
  if (S(4.8, 6.4)) lx = 250;
  if (S(14, 17)) lx = 140;
  inp.addLook(lx * dt, 0);
}
export function finish(game, report) {
  const c = report.custom;
  c.slowByLabel = {};
  for (const s of c.slow) { const e = c.slowByLabel[s.label] || (c.slowByLabel[s.label] = { n: 0, max: 0, sum: 0 }); e.n++; e.max = Math.max(e.max, s.ms); e.sum += s.ms; }
  c.slow.sort((a, b) => b.ms - a.ms);
  c.slow = c.slow.slice(0, 40);
}
