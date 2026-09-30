// Finding 2: natural sim; log every _ignored.set(...,+90) with airborne info.
import * as THREE from 'three';
const f = v => +v.toFixed(1);
const nap = () => new Promise(r => setTimeout(r, 0));
const DOWN = new THREE.Vector3(0, -1, 0);
export async function setup(game, report) {
  const C = report.custom = { events: [], summary: {} };
  game.autotest.duration = 1e9;
  const col = game.world.collision, gnav = game.world.nav;
  const SEC = parseFloat(game.params.get('sec') || '250');
  for (const b of game.bots.list) {
    const br = b.brain, m = br._ignored, os = m.set.bind(m);
    m.set = (k, v) => {
      const dur = v - game.time;
      if (dur > 60) {
        const g = col.raycast(b.position, DOWN, 40);
        const nn = gnav.nearestNode(b.position, 6);
        C.events.push({ t: f(game.time), bot: b.name, st: br.state, kind: (k && (k.type + (k.weapon ? ':' + k.weapon : ''))) || '?', onGround: b.onGround, gap: g ? f(g.distance) : null, hasNode6: !!nn, mode: br.nav.mode, unr: br.nav.unreachable, vy: f(b.velocity.y), site: (new Error().stack.split('\n')[2] || '').trim().replace(/^.*\//, '') });
      }
      return os(k, v);
    };
  }
  const dt = 1 / 60;
  const n = Math.round(SEC / dt);
  for (let i = 0; i < n; i++) { game.update(dt); if (i % 240 === 239) await nap(); }
  const ev = C.events;
  C.summary = { n: ev.length, airborne: ev.filter(e => !e.onGround).length, noNode: ev.filter(e => !e.hasNode6).length, groundedNoNode: ev.filter(e => e.onGround && !e.hasNode6).length, direct_unreach: ev.filter(e => e.mode === 'direct' && e.unr).length };
  C.byKind = {}; for (const e of ev) C.byKind[e.kind] = (C.byKind[e.kind] || 0) + 1;
  game.autotest.duration = game.autotest.t + 0.05;
}
export function drive() {}
