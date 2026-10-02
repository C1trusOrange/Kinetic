// Arsenal suite (host + 1 client, no bots) on the Proving Grounds deck, 12 m apart:
//   A 3..9 s   the client fires rockets at the host        B 9..15 s  the client throws frag grenades at the host
//   C 15..19 s the client blasts the host with the Gale    D 19..25 s the host fires rockets at the client
// Each page logs damage taken by weapon, shoves, impulses; NetArsenal stats count actions / replicated projectiles.
import { aimAt, hold, otherHuman, place, releaseAll, role } from '../lib.js';

const SPOT = { host: [[-6, 4.6, 0], -Math.PI / 2], client: [[6, 4.6, 0], Math.PI / 2] };
const log = { taken: {}, shoved: 0, maxShoveSpeed: 0, deaths: 0 };
let place_ = true, hooked = false, given = false, lastPhase = null;

function phase(t) {
  return t >= 3 && t < 9 ? 'A' : t >= 9 && t < 15 ? 'B' : t >= 15 && t < 19 ? 'C' : t >= 19 && t < 25 ? 'D' : null;
}

export function setup(game) {
  if (hooked) return;
  hooked = true;
  const ev = game.events;
  ev.on('spawn', e => {
    if (!e || !e.entity) return;
    if (e.entity === game.player) { place_ = true; given = false; }
    // the host keeps both humans alive for the whole run (health is the host's): every phase hits a live target
    if (role(game) === 'host' && e.entity.isHuman) e.entity.maxHealth = e.entity.health = 5000;
  });
  ev.on('damage', e => {
    if (e && e.target === game.player && e.attacker && e.attacker !== game.player) log.taken[e.weapon] = (log.taken[e.weapon] || 0) + 1;
  });
  ev.on('shove', e => {
    if (e && e.target === game.player) { log.shoved++; log.maxShoveSpeed = Math.max(log.maxShoveSpeed, e.speed || 0); }
  });
  ev.on('death', e => { if (e && e.victim === game.player) log.deaths++; });
  if (role(game) === 'host') for (const e of game.entities) if (e.isHuman) e.maxHealth = e.health = 5000;
}

export function drive(t, dt, game, report) {
  const me = game.player;
  const mine = role(game) === 'host' ? 'host' : 'client';
  releaseAll(game);
  if (!me.alive) return;
  // back to the spots at the start of every phase (knockback moves both players around)
  const ph0 = phase(t);
  if (ph0 !== lastPhase) {
    lastPhase = ph0;
    place_ = true;
  }
  if (place_ && t > 0.1) {
    place_ = false;
    place(game, SPOT[mine][0], SPOT[mine][1]);
  }
  const w = game.weapons;
  if (!given) {
    given = true;
    for (const id of ['rocket', 'gale']) w.giveWeapon(id);
    w.addGrenades(4, 'frag');
  }
  const ph = phase(t);
  const foe = otherHuman(game);
  if (!ph || !foe || !foe.alive) return;
  const shooter = ph === 'D' ? 'host' : 'client';
  if (mine !== shooter) {
    if (ph === 'B') hold(game, (t % 1.4) < 0.7 ? 'left' : 'right', true);   // rockets / Gale: a standing target
    return;
  }
  aimAt(game, foe, ph === 'A' || ph === 'D' ? 'feet' : 'chest');
  if (ph === 'A' || ph === 'D') {
    if (w.currentId !== 'rocket') w._requestSwitch('rocket');
    else hold(game, 'fire', (t % 1.0) < 0.1);
  } else if (ph === 'B') {
    me.pitch += 0.12;                        // lob it
    hold(game, 'grenade', (t % 1.6) < 0.5);
  } else if (ph === 'C') {
    if (w.currentId !== 'gale') w._requestSwitch('gale');
    else hold(game, 'fire', (t % 0.8) < 0.1);
  }
  report.custom = { ...(report.custom || {}), arsenal: log };
}

export function finish(game, report) {
  report.custom = { ...(report.custom || {}), arsenal: log };
}
