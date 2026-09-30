const dists = [];
const stats = { fires: 0, skippedLod: 0 };
let installed = false;
export function setup(game, report) {
  report.custom = report.custom || {};
  report.custom.muz = stats;
  for (const b of game.bots.list) {
    const T = b.constructor.prototype;
    if (installed) break;
    installed = true;
    const origFire = T._fire;
    const origUpd = T._updateModel;
    T._fire = function (def, inv) {
      const r = origFire.call(this, def, inv);
      // the muzzle used by _fire is _muz module scratch; recompute equivalent: model pose as currently posed
      const out = new (this.position.constructor)();
      this.model.root.updateMatrixWorld(true);
      this.model.getMuzzleWorldPosition(out);
      this._vf = out; this._vfTime = this.game.time; this._vfWeapon = def.id;
      return r;
    };
    T._updateModel = function (dt) {
      const t0 = this.model ? this.model._time : 0;
      const r = origUpd.call(this, dt);
      if (this._vf && this._vfTime === this.game.time) {
        if (this.model._time === t0) stats.skippedLod++;
        else {
          const out = new (this.position.constructor)();
          this.model.root.updateMatrixWorld(true);
          this.model.getMuzzleWorldPosition(out);
          dists.push(out.distanceTo(this._vf));
          stats.fires++;
        }
        this._vf = null;
      }
      return r;
    };
  }
}
export function drive(t, dt, game, report) {}
export function finish(game, report) {
  const s = dists.slice().sort((a, b) => a - b);
  const q = p => s.length ? +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(3) : null;
  report.custom.muzDist = { n: s.length, p50: q(0.5), p90: q(0.9), p99: q(0.99), max: q(1) };
  report.custom.fps = game.fps;
}
