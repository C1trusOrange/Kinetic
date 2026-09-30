// Instrumented long run: records nav request outcomes, pickup ignoring, stuck recovery, state times.
import { BotNav } from '/src/ai/BotNav.js';
import { BotBrain } from '/src/ai/BotBrain.js';

const LOG = { wsw: [], req: [], ign: [], stuck: [], rescue: [], errors: [] };
let patched = false;

export async function setup(game, report) {
  if (!patched) {
    patched = true;
    const origReq = BotNav.prototype._requestPath;
    BotNav.prototype._requestPath = function () {
      const bot = this.bot;
      const before = this.mode;
      const budgetOk = game.bots._pathBudgetMs > 0;
      origReq.call(this);
      if (!budgetOk) return;
      const nav = game.world.nav;
      const lastWp = this.path && this.path.length ? this.path[this.path.length - 1] : null;
      const trec = bot.brain.targetRec;
      LOG.req.push({
        gn8: !!nav.nearestNode(this.goal, 8), gn6: !!nav.nearestNode(this.goal, 6), bn6: !!nav.nearestNode(bot.position, 6), bn8: !!nav.nearestNode(bot.position, 8),
        conn: nav.isConnected(bot.position, this.goal),
        goalY: +this.goal.y.toFixed(1),
        endD: lastWp ? +Math.hypot(lastWp.x - this.goal.x, lastWp.z - this.goal.z).toFixed(1) : null,
        endDy: lastWp ? +(lastWp.y - this.goal.y).toFixed(1) : null,
        tgtGround: trec ? trec.ent.onGround : null, tgtVis: trec ? trec.visible : null,
        t: +game.time.toFixed(2), bot: bot.id, st: bot.brain.state, ground: bot.onGround, vy: +bot.velocity.y.toFixed(1),
        y: +bot.position.y.toFixed(1), unreach: this.unreachable, mode: this.mode, before,
        len: this.path ? this.path.length : 0,
        goalD: +Math.hypot(this.goal.x - bot.position.x, this.goal.z - bot.position.z).toFixed(1),
      });
    };
    const origRec = BotBrain.prototype.recoverStuck;
    BotBrain.prototype.recoverStuck = function (t) {
      const b = this.bot;
      LOG.stuck.push({ t: +t.toFixed(1), bot: b.id, st: this.state, stage: this.stuckStage + 1, pos: b.position.toArray().map(v => +v.toFixed(1)) });
      return origRec.call(this, t);
    };
    const origRes = BotBrain.prototype.rescue;
    BotBrain.prototype.rescue = function () {
      const r = origRes.call(this);
      LOG.rescue.push({ t: +game.time.toFixed(1), bot: this.bot.id, st: this.state, ok: r, pos: this.bot.position.toArray().map(v => +v.toFixed(1)) });
      return r;
    };
  }
  for (const b of game.bots.list) {
    const origSel = b.selectWeapon.bind(b);
    b.selectWeapon = (id) => {
      const from = b.weaponId, fi = b.inv[from];
      const r = origSel(id);
      if (r) LOG.wsw.push({ t: +game.time.toFixed(1), bot: b.id, from, to: id, fromMag: fi ? fi.mag : null, fromRes: fi ? fi.reserve : null, owned: b.owned.join(',') });
      return r;
    };
    const ign = b.brain._ignored;
    const origSet = ign.set.bind(ign);
    ign.set = (p, until) => {
      LOG.ign.push({ t: +game.time.toFixed(1), bot: b.id, st: b.brain.state, type: p.type, w: p.weapon, until: +until.toFixed(1), unreach: b.brain.nav.unreachable, mode: b.brain.nav.mode, ground: b.onGround, y: +b.position.y.toFixed(1) });
      return origSet(p, until);
    };
  }
  report.custom = report.custom || {};
  report.custom.stateTime = {};
}

let acc = 0;
export function drive(t, dt, game, report) {
  const st = report.custom.stateTime;
  for (const b of game.bots.list) {
    if (!b.alive) continue;
    const k = b.brain.state;
    st[k] = (st[k] || 0) + dt;
  }
}

export function finish(game, report) {
  const c = report.custom;
  const req = LOG.req;
  c.reqTotal = req.length;
  c.reqAirborne = req.filter(r => !r.ground).length;
  c.reqAirUnreach = req.filter(r => !r.ground && r.unreach).length;
  c.reqGroundUnreach = req.filter(r => r.ground && r.unreach).length;
  c.airSamples = req.filter(r => !r.ground && r.unreach).slice(0, 12);
  c.groundUnreach = req.filter(r => r.ground && r.unreach).slice(0, 12);
  c.ign = LOG.ign.slice(0, 30);
  c.ignCount = LOG.ign.length;
  c.stuckCount = LOG.stuck.length;
  c.stuck = LOG.stuck.slice(0, 20);
  c.rescue = LOG.rescue.slice(0, 20);
  c.pathStats = game.bots.pathStats;
  c.wsw = LOG.wsw.slice(0, 60);
  c.wswCount = LOG.wsw.length;
  c.wswToPistol = LOG.wsw.filter(w => w.to === 'pistol').length;
  c.wswFromPistol = LOG.wsw.filter(w => w.from === 'pistol').length;
}
