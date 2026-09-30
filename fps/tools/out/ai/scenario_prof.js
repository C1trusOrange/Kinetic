// Per-method profile of the AI in the real game (15 bots). Wrapping overhead is ~1 us per call.
const P = {};
function wrap(obj, name, label) {
  const orig = obj[name];
  if (typeof orig !== 'function') return;
  const rec = P[label] || (P[label] = { calls: 0, total: 0, max: 0 });
  obj[name] = function (...a) {
    const t0 = performance.now();
    const r = orig.apply(this, a);
    const ms = performance.now() - t0;
    rec.calls++; rec.total += ms; if (ms > rec.max) rec.max = ms;
    return r;
  };
}
export async function setup(game, report) {
  report.custom = { P };
  for (const b of game.bots.list) {
    for (const n of ['perceive', 'think', 'updateAim', 'updateFire', 'updateMovement', 'updateStuck', 'selectTarget', 'chooseState', 'considerGrenade', 'checkGrenades', 'chooseWeapon']) wrap(b.brain, n, 'brain.' + n);
    wrap(b.brain.nav, 'update', 'nav.update');
    wrap(b.brain.nav, '_requestPath', 'nav._requestPath');
    for (const n of ['_move', '_updateModel', '_handleWeaponIntent', '_updateWeaponState', '_fire']) wrap(b, n, 'bot.' + n);
    wrap(b.model, 'update', 'model.update');
    wrap(b.brain, 'update', 'brain.update(total)');
    wrap(b, 'update', 'bot.update(total)');
  }
  wrap(game.bots, '_separate', 'manager._separate');
  wrap(game.bots, 'update', 'manager.update(total)');
  wrap(game.combat, 'fireBullet', 'combat.fireBullet');
  wrap(game.combat, 'canSee', 'combat.canSee');
  wrap(game.effects, 'tracer', 'fx.tracer');
  wrap(game.effects, 'muzzleFlash', 'fx.muzzleFlash');
  wrap(game.effects, 'hitSpark', 'fx.hitSpark');
  wrap(game.effects, 'impact', 'fx.impact');
  wrap(game.world.collision, 'raycast', 'collision.raycast');
}
export function drive() {}
export function finish(game, report) {
  const out = {};
  const frames = Math.max(1, P['manager.update(total)'] ? P['manager.update(total)'].calls : 1);
  for (const k of Object.keys(P)) out[k] = { calls: P[k].calls, msPerFrame: +(P[k].total / frames).toFixed(3), avgUs: +(P[k].total / Math.max(1, P[k].calls) * 1000).toFixed(1), maxMs: +P[k].max.toFixed(2) };
  const sorted = Object.entries(out).sort((a, b) => b[1].msPerFrame - a[1].msPerFrame);
  report.custom = { frames, top: sorted.map(([k, v]) => `${k.padEnd(26)} ${String(v.msPerFrame).padStart(7)} ms/frame  calls ${String(v.calls).padStart(7)}  avg ${String(v.avgUs).padStart(7)} us  max ${v.maxMs}`) };
}
