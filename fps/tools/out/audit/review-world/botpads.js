const S = { launches: [], seen: new Map(), byPad: {} };
export function setup(game, report) { report.custom = S; }
export function drive(t, dt, game, report) {
  const w = game.world;
  for (const e of game.entities) {
    if (!e.alive) continue;
    const last = S.seen.get(e) ?? -1;
    if (e.lastLaunchTime > last && e.lastLaunchTime > 0) {
      S.seen.set(e, e.lastLaunchTime);
      let bi = -1, bd = 1e9;
      w.jumpPads.forEach((p, i) => { const d = Math.hypot(p.position.x - e.position.x, p.position.z - e.position.z); if (d < bd) { bd = d; bi = i; } });
      S.launches.push({ who: e.isPlayer ? 'player' : e.name, pad: bi, t0: game.time, rec: false, ent: e, tgt: w.jumpPads[bi].target });
    }
  }
  for (const L of S.launches) {
    if (L.rec) continue;
    const e = L.ent;
    const el = game.time - L.t0;
    if (!e.alive) { L.rec = true; const o = (S.byPad['pad' + L.pad] ||= { n: 0, ok: 0, died: 0, res: [] }); o.n++; o.died++; continue; }
    if (el > 0.4 && e.onGround || el > 5) {
      L.rec = true;
      const d = Math.hypot(e.position.x - L.tgt.x, e.position.z - L.tgt.z);
      const dy = e.position.y - L.tgt.y;
      const o = (S.byPad['pad' + L.pad] ||= { n: 0, ok: 0, died: 0, res: [] });
      o.n++;
      if (d < 3 && Math.abs(dy) < 1.5) o.ok++;
      o.res.push([+d.toFixed(1), +dy.toFixed(1)]);
    }
  }
  report.custom = { byPad: S.byPad, launches: S.launches.length };
}
