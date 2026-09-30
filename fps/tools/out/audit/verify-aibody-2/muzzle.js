const D = { n: 0, ds: [], bigCases: [] };
let cur = null;
export function setup(game, report) {
  report.custom = report.custom || {};
  report.custom.D = D;
  const b0 = game.bots.list[0];
  const P = Object.getPrototypeOf(b0);
  const V = b0.position.constructor;
  const origMF = game.effects.muzzleFlash.bind(game.effects);
  game.effects.muzzleFlash = (pos, dir, o) => { if (cur) cur.pend = pos.clone(); return origMF(pos, dir, o); };
  const origFire = P._fire;
  P._fire = function (def, inv) { cur = this; try { return origFire.call(this, def, inv); } finally { cur = null; } };
  const origUM = P._updateModel;
  P._updateModel = function (dt) {
    const r = origUM.call(this, dt);
    if (this.pend) {
      if (this._lodDt === 0) { // pose refreshed this frame (not LOD-skipped)
        this.model.root.updateMatrixWorld(true);
        const fresh = this.model.getMuzzleWorldPosition(new V());
        const d = fresh.distanceTo(this.pend);
        D.n++; D.ds.push(d);
        // shot count relative to camera distance
      }
      this.pend = null;
    }
    return r;
  };
}
export function drive() {}
export function finish(game, report) {
  const s = D.ds.slice().sort((a, b) => a - b);
  const q = p => +(s[Math.floor(s.length * p)] || 0).toFixed(3);
  D.p50 = q(0.5); D.p90 = q(0.9); D.p99 = q(0.99); D.max = +(s[s.length - 1] || 0).toFixed(3);
  D.avgFrameMs = +(1000 * game.time / Math.max(1, game.fps ? 1 : 1)).toFixed(1);
  D.ds = undefined;
}
