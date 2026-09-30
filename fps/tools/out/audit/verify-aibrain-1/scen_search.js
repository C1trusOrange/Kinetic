// Verifier: bot standing in the 'searching' phase of chase is hit by an unseen attacker.
const f = v => +v.toFixed(2);
const nap = () => new Promise(r => setTimeout(r, 0));
async function step(game, seconds, dt, cb) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) { game.update(dt); if (cb && cb(i, dt) === false) return; if (i % 240 === 239) await nap(); }
}
export async function setup(game, report) {
  const C = report.custom = { log: [] };
  game.autotest.duration = 1e9;
  const DT = 1 / 60;
  try {
    const bots = game.bots.list;
    for (let i = 2; i < bots.length; i++) { bots[i].alive = false; bots[i].model.setVisible(false); bots[i].respawnAt = -1; }
    game.player.alive = false; game.player.respawnAt = -1;
    const A = bots[0], B = bots[1]; A.god = true; B.god = true;
    const V = game.player.position.constructor;
    const nav = game.world.nav;
    const n = nav._main.find(x => Math.abs(x.position.x) < 8 && Math.abs(x.position.z) < 8 && x.position.y < 0.5) || nav._main[0];
    A.teleportTo(n.position.clone(), 0);
    B.teleportTo(n.position.clone().add(new V(28, 0, 0)), 0);
    B.brain.think = () => {}; B.brain.perceive = () => {}; B.brain.update = () => {};
    const br = A.brain;
    br.perceive = () => {};
    await step(game, 0.5, DT);
    const t = game.time;
    const rec = br._rec(B);
    rec.known = true; rec.lastSeen = t - 0.5; rec.pos.copy(B.position);
    br.targetRec = rec; br.target = B;
    br.state = 'chase'; br.stateSince = t; br.searching = true; br.searchUntil = t + 2.6;
    br.nav.clear();
    const p0 = A.position.clone();
    C.start = { state: br.state, searching: br.searching, searchLeft: 2.6 };
    let el = 0, hit = false;
    await step(game, 3.4, DT, (i, dt) => {
      el += dt;
      if (!hit && el >= 1.0) { hit = true; br.onDamaged(B); C.hitAt = f(el); C.afterHit = { hurtAt: f(rec.hurtAt - t), known: rec.known, searching: br.searching, state: br.state, recPos: rec.pos.toArray().map(f) }; }
      if (Math.floor(el * 4) !== Math.floor((el - dt) * 4)) C.log.push({ el: f(el), state: br.state, searching: br.searching, hasTarget: !!br.targetRec, moved: f(A.position.distanceTo(p0)), navHasGoal: br.nav.hasGoal, hurtAt: rec.hurtAt < 0 ? rec.hurtAt : f(rec.hurtAt - t), known: rec.known });
      return true;
    });
    C.end = { state: br.state, searching: br.searching, targetRec: !!br.targetRec, known: rec.known, hurtAt: rec.hurtAt, moved: f(A.position.distanceTo(p0)) };
  } catch (err) { C.error = String(err && err.stack || err); console.error('[scen_search]', err); }
  game.autotest.duration = 0;
}
export function drive() {}
