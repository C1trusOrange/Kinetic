const LOG = [];
let patched = false;
export function setup(game, report) {
  report.custom = report.custom || {};
  report.custom.LOG = LOG;
  const b0 = game.bots.list[0];
  const P = Object.getPrototypeOf(b0);
  const origUM = P._updateModel;
  P._updateModel = function (dt) {
    const r = origUM.call(this, dt);
    if (this === game.bots.list[0]) {
      const m = this.model;
      LOG.push({ t: +game.time.toFixed(3), og: this.onGround, y: +this.position.y.toFixed(3), vy: +this.velocity.y.toFixed(2), air: +m._k.air.toFixed(2), airT: +m._airT.toFixed(3), land: +m._land.toFixed(3), sp: +this.speed.toFixed(1), hp: this.alive });
    }
    return r;
  };
  const origS = P.spawn;
  P.spawn = function (pos, yaw) {
    if (this === game.bots.list[0]) LOG.push({ EVENT: 'spawn', t: +game.time.toFixed(3), prevAirT: this.model ? +this.model._airT.toFixed(3) : null, prevWasGround: this.model ? this.model._wasGround : null });
    return origS.call(this, pos, yaw);
  };
}
let killed = false;
export function drive(t, dt, game, report) {
  const b = game.bots.list[0];
  // kill bot mid-air at ~t=4: launch it then kill
  if (t > 4 && !killed && b.alive) {
    b.launch(b.velocity.constructor ? new b.velocity.constructor(0, 12, 0) : { x: 0, y: 12, z: 0 });
    report.custom.launchedAt = t;
    killed = 'launched';
  }
  if (killed === 'launched' && t > 4.5 && b.alive) {
    game.combat.kill(b, { attacker: game.player, weapon: 'test', headshot: false });
    killed = 'dead';
    report.custom.killedAt = t;
    report.custom.killedAirT = b.model ? b.model._airT : null;
  }
}
export function finish(game, report) {
  // condense
  report.custom.LOG = LOG.filter((e, i) => e.EVENT || (e.t < 0.6) || (e.t > 4.4 && e.t < 20));
}
