const D = { n: 0, dists: [], maxD: 0, skipped: 0 };
export function setup(game, report) {
  report.custom = report.custom || {};
  report.custom.D = D;
  const b0 = game.bots.list[0];
  const P = Object.getPrototypeOf(b0);
  const V = b0.position.constructor;
  const origMF = game.effects.muzzleFlash.bind(game.effects);
  let cur = null;
  game.effects.muzzleFlash = (pos, dir, o) => { if (cur) cur.pending = pos.clone(); return origMF(pos, dir, o); };
  const origFire = P._fire;
  P._fire = function (def, inv) { cur = this; try { return origFire.call(this, def, inv); } finally { cur = null; } };
  const origUM = P._updateModel;
  P._updateModel = function (dt) {
    const pre = { bodyYaw: this.bodyYaw, crouch: this.crouch, gt: game.time };
    const r = origUM.call(this, dt);
    if (this.pending) {
      if (this._lodDt === 0) {
        const fresh = this.model.getMuzzleWorldPosition(new V());
        const d = fresh.distanceTo(this.pending);
        D.n++; D.dists.push(+d.toFixed(3)); D.maxD = Math.max(D.maxD, d);
        if (d > 0.3) { D.big = D.big || []; if (D.big.length < 12) D.big.push({ d: +d.toFixed(2), dt: +dt.toFixed(3), dBody: +(this.bodyYaw - pre.bodyYaw).toFixed(2), yawOff: +(this.yaw - this.bodyYaw).toFixed(2), rel: this.reloading, w: this.weaponId, aim: this.brain.faceAim, crouch: +this.crouch.toFixed(2), speed: +this.speed.toFixed(1), K: { aim: +this.model._k.aim.toFixed(2), reload: +this.model._k.reload.toFixed(2), carry: +this.model._k.carry.toFixed(2) } }); }
      } else D.skipped++;
      this.pending = null;
    }
    return r;
  };
}
export function drive() {}
export function finish(game, report) {
  const s = D.dists.slice().sort((a, b) => a - b);
  D.p50 = s[Math.floor(s.length * 0.5)]; D.p90 = s[Math.floor(s.length * 0.9)]; D.max = s[s.length - 1];
  D.dists = D.dists.slice(0, 5);
}
