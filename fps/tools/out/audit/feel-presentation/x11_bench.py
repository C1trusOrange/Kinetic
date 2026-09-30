import sys, json, time
from common import *
from bloomlib import mk_session
BENCH = r"""
(() => {
  const g = __GAME__, w = g.world, out = {};
  const T = g.camera.position.constructor;
  const o = new T(), d = new T(), tgt = new T();
  const cp = g.camera.position.clone();
  let hits = 0; const N = 3000;
  let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const t0 = performance.now();
  for (let i = 0; i < N; i++) {
    tgt.set(cp.x + (rnd() - 0.5) * 80, cp.y + (rnd() - 0.5) * 20, cp.z + (rnd() - 0.5) * 80);
    d.copy(tgt).sub(cp); const L = d.length(); d.multiplyScalar(1 / L);
    if (w.raycast(cp, d, L)) hits++;
  }
  const t1 = performance.now();
  out.raycast = { n: N, totalMs: +(t1 - t0).toFixed(2), usPerRay: +((t1 - t0) * 1000 / N).toFixed(2), blockedPct: +(100 * hits / N).toFixed(1) };
  // particle update cost with N ambient glow particles
  const fx = g.effects;
  function bench(n) {
    fx.clear();
    for (let i = 0; i < n; i++) fx._spark(cp.x + (rnd() - 0.5) * 20, cp.y + (rnd() - 0.5) * 6, cp.z + (rnd() - 0.5) * 20, (rnd() - 0.5) * 0.4, (rnd() - 0.5) * 0.4, (rnd() - 0.5) * 0.4, 999, 0.06, 1, 1);
    for (let i = 0; i < 20; i++) fx.update(1 / 60);
    const a = performance.now();
    for (let i = 0; i < 300; i++) fx.update(1 / 60);
    const b = performance.now();
    return { n, live: fx.glow.count, msPerUpdate: +((b - a) / 300).toFixed(3) };
  }
  out.particles = [bench(0), bench(150), bench(400), bench(1200)];
  fx.clear();
  return out;
})()
"""
s = mk_session(1280, 720)
open_game(s, 'foundry', bots=0)
s.run("__GAME__.hud.show(false); __GAME__.state='paused';")
r = s.js(BENCH)
print(json.dumps(r, indent=1))
json.dump(r, open('x11_bench.json','w'), indent=1)
s.close()
