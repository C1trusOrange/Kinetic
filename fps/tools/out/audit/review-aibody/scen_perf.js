import * as THREE from 'three';
const S = { n: 0, sum: 0, max: 0, over4: 0, botSum: {}, modelSum: 0, modelN: 0, moveSum: 0, fireN: 0, deaths: 0, byWeapon: {}, errors: 0, totalShots: 0 };
export async function setup(game, report) {
  report.custom = S;
  const mgr = game.bots;
  const orig = mgr.update.bind(mgr);
  mgr.update = function (dt) {
    const t0 = performance.now();
    orig(dt);
    const ms = performance.now() - t0;
    S.n++; S.sum += ms; if (ms > S.max) S.max = ms; if (ms > 4) S.over4++;
  };
  // time model.update
  for (const b of mgr.list) {
    const m = b.model; const o = m.update.bind(m);
    m.update = (dt, st) => { const t0 = performance.now(); o(dt, st); S.modelSum += performance.now() - t0; S.modelN++; };
  }
  game.events.on('death', e => { if (e.victim.isBot) { S.deaths++; S.byWeapon[e.weapon] = (S.byWeapon[e.weapon] || 0) + 1; } });
  game.events.on('weapon:fire', e => { if (e.shooter.isBot) S.totalShots++; });
}
export function drive() {}
export function finish(game) {
  S.avgMs = +(S.sum / S.n).toFixed(3); S.max = +S.max.toFixed(2); S.sum = null;
  S.modelAvgUs = +(S.modelSum / S.modelN * 1000).toFixed(1); S.modelSum = null;
  S.pathStats = game.bots.pathStats;
  S.kd = game.bots.list.map(b => `${b.kills}/${b.deaths}`).join(' ');
  S.shots = game.bots.list.map(b => `${b.stats.shots}:${b.stats.pelletHits}`).join(' ');
}
