// Duel suite (host + 1 client, no bots): both stand on the open central deck of the Proving Grounds 12 m apart.
// Phase A (3..13 s): the client shoots rifle bursts at the host, who strafes. Phase B (14..24 s): the host shoots the
// client. Each page counts its own shots / predicted hits / damage events; tools/mp/checks/duel.py compares them
// with the host's claim statistics (favor-the-shooter hit registration).
import { aimAt, hold, otherHuman, place, releaseAll, role } from '../lib.js';

const SPOT = { host: [[-6, 4.6, 0], -Math.PI / 2], client: [[6, 4.6, 0], Math.PI / 2] };
const log = { fired: { A: 0, B: 0 }, predicted: { A: 0, B: 0 }, dealt: { A: 0, B: 0 }, taken: { A: 0, B: 0 }, deaths: 0, kills: 0 };
let place_ = true;
let hooked = false;

function phaseAt(t) {
  return t >= 3 && t < 13 ? 'A' : t >= 14 && t < 24 ? 'B' : null;
}

export function setup(game) {
  if (hooked) return;
  hooked = true;
  const ev = game.events;
  let t0 = performance.now();
  const ph = () => phaseAt((performance.now() - t0) / 1000);
  ev.on('match:start', () => { t0 = performance.now(); });
  ev.on('spawn', e => { if (e && e.entity === game.player) place_ = true; });
  ev.on('weapon:fire', e => { if (e && e.shooter === game.player && ph()) log.fired[ph()]++; });
  ev.on('hit:predicted', () => { if (ph()) log.predicted[ph()]++; });
  ev.on('damage', e => {
    if (!e || !ph()) return;
    if (e.attacker === game.player && e.target !== game.player && e.target.isHuman) log.dealt[ph()]++;
    if (e.target === game.player && e.attacker && e.attacker.isHuman) log.taken[ph()]++;
  });
  ev.on('death', e => {
    if (!e) return;
    if (e.victim === game.player) log.deaths++;
    if (e.attacker === game.player && e.victim !== game.player) log.kills++;
  });
}

export function drive(t, dt, game, report) {
  const me = game.player;
  const mine = role(game) === 'host' ? 'host' : 'client';
  releaseAll(game);
  if (!me.alive) return;
  if (place_ && t > 0.1) {
    place_ = false;
    place(game, SPOT[mine][0], SPOT[mine][1]);
  }
  const ph = phaseAt(t);
  const foe = otherHuman(game);
  // name tag over the other player while both are alive (face-to-face on the deck)
  if (foe && foe.alive && game.hud.names) {
    const shown = game.hud.names.pool.filter(el => el._on && el.textContent === foe.name).length;
    log.tagFrames = (log.tagFrames || 0) + 1;
    if (shown) log.tagShown = (log.tagShown || 0) + 1;
  }
  if (!ph || !foe || !foe.alive) return;
  const shooter = ph === 'A' ? 'client' : 'host';
  if (mine === shooter) {
    aimAt(game, foe);
    hold(game, 'fire', (t % 0.5) < 0.22);   // short bursts: the aim is re-set every frame, recoil stays small
  } else {
    hold(game, (t % 1.4) < 0.7 ? 'left' : 'right', true);
  }
  report.custom = { ...(report.custom || {}), duel: log };
}

export function finish(game, report) {
  report.custom = { ...(report.custom || {}), duel: log };
}
