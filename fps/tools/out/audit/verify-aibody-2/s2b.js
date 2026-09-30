const D = { n: 0, tot: [], yawOnly: [], boneOnly: [] };
export function setup(game, report) {
  report.custom = report.custom || {};
  report.custom.D = D;
  const b0 = game.bots.list[0];
  const P = Object.getPrototypeOf(b0);
  const V = b0.position.constructor;
  const origMP = P._muzzlePosition;
  P._muzzlePosition = function (out) {
    const r = origMP.call(this, out);
    this.__pend = { p: r.clone(), yaw: this.bodyYaw };
    return r;
  };
  const origUM = P._updateModel;
  P._updateModel = function (dt) {
    const r = origUM.call(this, dt);
    if (this.__pend) {
      if (this._lodDt === 0) {
        const m = this.model;
        const fresh = m.getMuzzleWorldPosition(new V());
        // new bones, OLD yaw
        const yawNow = m.root.rotation.y;
        m.root.rotation.y = this.__pend.yaw; m.root.updateMatrixWorld(true);
        const oldYawNewBones = m.getMuzzleWorldPosition(new V());
        m.root.rotation.y = yawNow; m.root.updateMatrixWorld(true);
        D.n++;
        D.tot.push(fresh.distanceTo(this.__pend.p));
        D.boneOnly.push(oldYawNewBones.distanceTo(this.__pend.p)); // bone change only (yaw held stale)
        D.yawOnly.push(fresh.distanceTo(oldYawNewBones)); // yaw change only
      }
      this.__pend = null;
    }
    return r;
  };
}
export function drive() {}
export function finish(game, report) {
  const st = a => { const s = a.slice().sort((x, y) => x - y); const q = p => +(s[Math.min(s.length - 1, Math.floor(s.length * p))] || 0).toFixed(3); return { p50: q(0.5), p90: q(0.9), max: q(1) }; };
  report.custom.summary = { n: D.n, total: st(D.tot), boneOnly: st(D.boneOnly), yawOnly: st(D.yawOnly) };
  D.tot = D.yawOnly = D.boneOnly = null;
}
