import * as THREE from 'three';
const S = { falls: [], bounds: null, killY: null, hist: {}, deathsByFall: 0, deaths: [] };
export async function setup(game, report) {
  report.custom = S;
  S.bounds = [game.world.bounds.min.toArray(), game.world.bounds.max.toArray()];
  S.killY = game.world.killY;
  game.events.on('death', e => {
    if (e.victim.isBot) S.deaths.push(e.weapon);
    if (e.weapon === 'fall' && e.victim.isBot) S.deathsByFall++;
  });
}
export function drive(t, dt, game, report) {
  if (S.done) return;
  for (const b of game.bots.list) {
    if (!b.alive) { S.hist[b.name] = []; continue; }
    const h = S.hist[b.name] || (S.hist[b.name] = []);
    h.push({ t: +t.toFixed(2), p: b.position.toArray().map(v => +v.toFixed(1)), v: b.velocity.toArray().map(v => +v.toFixed(1)), g: b.onGround, st: b.brain.state, nm: b.brain.nav.mode, mv: [+b.brain.intent.moveX.toFixed(2), +b.brain.intent.moveZ.toFixed(2), +b.brain.intent.speed.toFixed(1), b.brain.intent.jump ? 1 : 0] });
    if (h.length > 90) h.shift();
    if (b.position.y < S.bounds[0][1] - 0.5 && !b._logged) {
      b._logged = true;
      S.falls.push({ bot: b.name, t: +t.toFixed(1), hist: h.filter((_, i) => i % 6 === 0) }); S.deathsFall = (S.deathsFall||0);
    }
    if (b.position.y > S.bounds[0][1] + 1) b._logged = false;
  }
}
export function finish() { S.done = true; }
