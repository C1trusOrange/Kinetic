import * as THREE from 'three';
const mode = new URLSearchParams(location.search).get('mode') || 'trail';
const st = { maxRockets: 0, maxSmoke: 0, maxGren: 0, dropped: 0, rocketsSpawned: 0 };
export function setup(game, report) {
  report.custom = { mode };
  const c = report.custom;
  if (mode === 'trail') {
    const fx = game.effects;
    let puffs = 0;
    const orig = fx._puff.bind(fx);
    fx._puff = (...a) => { puffs++; return orig(...a); };
    const P = (x, y, z) => new THREE.Vector3(x, y, z);
    const run = (n, two) => {
      const per = [];
      let last = 0;
      for (let k = 0; k < n; k++) {
        fx.time += 1 / 60;
        puffs = 0;
        fx.trail(P(0 + 0.7 * k, 5, 0), { type: 'rocket' });
        const a = puffs;
        puffs = 0;
        if (two) fx.trail(P(0 + 0.7 * k, 5, 3), { type: 'rocket' });
        per.push(a + puffs);
      }
      return per;
    };
    fx.clear();
    c.one = run(12, false);
    fx.time += 5; fx.clear();
    c.two = run(12, true);
    // farther apart (>6 m) should not merge
    fx.time += 5; fx.clear();
    const per = [];
    for (let k = 0; k < 12; k++) {
      fx.time += 1 / 60; puffs = 0;
      fx.trail(P(0.7 * k, 5, 0), { type: 'rocket' });
      fx.trail(P(0.7 * k, 5, 12), { type: 'rocket' });
      per.push(puffs);
    }
    c.twoFar = per;
  } else if (mode === 'natural') {
    const pr = game.projectiles;
    const o = pr.spawnRocket.bind(pr);
    pr.spawnRocket = (a) => { st.rocketsSpawned++; return o(a); };
  } else if (mode === 'decalcap') {
    const fx = game.effects;
    fx.clear();
    const n = new THREE.Vector3(0, 0, 1);
    game.setQuality('high');
    for (let i = 0; i < 120; i++) fx._decal(0, i * 0.01, 1, 1, n, 0.2, [1,1,1], 0.9, 40, false);
    c.highMax = game.quality.maxDecals; c.highLive = fx.decals.liveCount;
    game.setQuality('low');
    c.lowMax = game.quality.maxDecals;
    for (let i = 0; i < 60; i++) fx._decal(0, i * 0.01, 1, 1, n, 0.2, [1,1,1], 0.9, 40, false);
    c.lowLive = fx.decals.liveCount;
  }
}
export function drive(t, dt, game, report) {
  const c = report.custom;
  game.player.god = true;
  if (mode === 'natural') {
    const pr = game.projectiles;
    st.maxRockets = Math.max(st.maxRockets, pr.rockets.length);
    st.maxGren = Math.max(st.maxGren, pr.grenades.length);
    st.maxSmoke = Math.max(st.maxSmoke, game.effects.smoke.count);
    st.dropped = game.effects.stats.dropped;
    c.nat = { ...st };
  }
}
export function finish(game, report) { report.custom.effStats = game.effects.stats; }
