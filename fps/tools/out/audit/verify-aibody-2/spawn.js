const rows = [];
let spawnT = -1, target = null, killed = false, killAir = false;
export function setup(game, report) {
  report.custom = report.custom || {};
  report.custom.rows = rows;
  target = game.bots.list[0];
  game.events.on('spawn', (e) => {
    if (e.entity === target && game.time > 1) {
      spawnT = game.time;
      const p = game.player;
      p.position.set(target.position.x + 3, target.position.y, target.position.z);
      p.velocity.set(0, 0, 0);
      rows.push({ mark: 'spawn', t: +game.time.toFixed(3), mAirT_before: +target.model._airT.toFixed(3), wasGround: target.model._wasGround });
    }
  });
}
export function drive(t, dt, game, report) {
  const b = target;
  if (!b) return;
  if (!killed && t > 4 && b.alive) {
    killed = true;
    game.combat.kill(b, { attacker: null, weapon: 'fall', headshot: false, point: b.position.clone(), direction: b.position.clone().set(0, 1, 0) });
    rows.push({ mark: 'kill', t: +game.time.toFixed(3) });
  }
  if (b.alive && spawnT >= 0 && game.time - spawnT < 0.6) {
    const m = b.model;
    rows.push({ t: +game.time.toFixed(3), since: +(game.time - spawnT).toFixed(3), onGround: b.onGround, y: +b.position.y.toFixed(3), vy: +b.velocity.y.toFixed(2), air: +m._k.air.toFixed(2), airT: +m._airT.toFixed(3), land: +m._land.toFixed(3), noSnapLeft: +(b._noSnapUntil - game.time).toFixed(3), lod: +b._lodDt.toFixed(3) });
  }
}
export function finish(game, report) {}
