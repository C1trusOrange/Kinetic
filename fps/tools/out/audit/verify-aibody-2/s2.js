const D = { n: 0, skippedLod: 0, ds: [], byFrameDt: {} };
export function setup(game, report) {
  report.custom = report.custom || {};
  report.custom.D = D;
  const b0 = game.bots.list[0];
  const P = Object.getPrototypeOf(b0);
  const V = b0.position.constructor;
  const origFire = P._fire;
  const origMP = P._muzzlePosition;
  P._muzzlePosition = function (out) {
    const r = origMP.call(this, out);
    this.__pend = { p: r.clone(), gt: game.time };
    return r;
  };
  const origUM = P._updateModel;
  P._updateModel = function (dt) {
    const lodBefore = this._lodDt;
    const r = origUM.call(this, dt);
    if (this.__pend) {
      const fresh = this.model.getMuzzleWorldPosition(new V());
      // model root already updated to this frame's position/bodyYaw; if LOD-skipped the bones are stale anyway
      const animated = this._lodDt === 0;
      if (animated) {
        const d = fresh.distanceTo(this.__pend.p);
        D.n++; D.ds.push(d);
      } else D.skippedLod++;
      this.__pend = null;
    }
    return r;
  };
}
export function drive() {}
export function finish(game, report) {
  const s = D.ds.slice().sort((a, b) => a - b);
  const q = p => +(s[Math.min(s.length - 1, Math.floor(s.length * p))] || 0).toFixed(3);
  D.p50 = q(0.5); D.p90 = q(0.9); D.p99 = q(0.99); D.max = q(1);
  D.ds = null;
  D.fps = game.fps;
}
