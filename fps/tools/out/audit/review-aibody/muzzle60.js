const g = window.__GAME__;
g.state = 'paused';
const b0 = g.bots.list[0];
const P = Object.getPrototypeOf(b0);
const V = b0.position.constructor;
const out = {};
for (const fps of [144, 60, 30]) {
  const dt = 1 / fps;
  const D = [];
  const big = [];
  const origMF = g.effects.muzzleFlash;
  let cur = null;
  g.effects.muzzleFlash = function (pos, dir, o) { if (cur) cur.pending = pos.clone(); return origMF.call(this, pos, dir, o); };
  const origFire = P._fire;
  P._fire = function (def, inv) { cur = this; try { return origFire.call(this, def, inv); } finally { cur = null; } };
  const origUM = P._updateModel;
  P._updateModel = function (d) {
    const r = origUM.call(this, d);
    if (this.pending) {
      if (this._lodDt === 0) { const fresh = this.model.getMuzzleWorldPosition(new V()); D.push(fresh.distanceTo(this.pending)); }
      this.pending = null;
    }
    return r;
  };
  const steps = Math.round(50 * fps);
  for (let i = 0; i < steps; i++) { g.time += dt; g.bots.update(dt); g.projectiles.update(dt); g.effects.update(dt); g._updateMatch(dt); }
  P._fire = origFire; P._updateModel = origUM; g.effects.muzzleFlash = origMF;
  D.sort((a, c) => a - c);
  const q = f => +(D[Math.min(D.length - 1, Math.floor(D.length * f))] || 0).toFixed(3);
  out[fps] = { n: D.length, p50: q(0.5), p90: q(0.9), p99: q(0.99), max: q(1) };
}
g.state = 'playing';
return out;
