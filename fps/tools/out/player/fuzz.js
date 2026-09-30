// Random-input fuzz: exceptions, NaNs, penetration, falling out of the map, state coverage.
import * as THREE from 'three';
import { teleport, releaseAll, makeScenario, installLog, evs, r2 } from './common.js';

let seed = Number(new URLSearchParams(location.search).get("seed") || 12345);
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const stats = { nan: 0, deep: 0, maxDepth: 0, minY: 1e9, fell: 0, states: {}, frames: 0, stuck: 0, maxSpeed: 0, events: {} };
let nextChange = 0, lastPos = new THREE.Vector3(), stillT = 0;

const phases = [{
  name: 'fuzz', dur: 60,
  start(g, R, c) { teleport(g, ...(g.world.mapId === 'ptest' ? [0, 0, 40] : [g.player.position.x, g.player.position.y, g.player.position.z]), 0); c.T0 = g.time; },
  tick(lt, dt, g, R, c) {
    const p = g.player, inp = g.input;
    if (!p.alive) return;
    if (lt >= nextChange) {
      nextChange = lt + 0.08 + rnd() * 0.25;
      inp.setVirtual('forward', rnd() < 0.75);
      inp.setVirtual('back', rnd() < 0.08);
      inp.setVirtual('left', rnd() < 0.25);
      inp.setVirtual('right', rnd() < 0.25);
      inp.setVirtual('jump', rnd() < 0.3);
      inp.setVirtual('crouch', rnd() < 0.2);
      inp.setVirtual('sprint', rnd() < 0.6);
      inp.setVirtual('grapple', rnd() < 0.12);
      inp.setVirtual('ads', rnd() < 0.1);
      inp.setVirtual('fire', rnd() < 0.15);
      inp.addLook((rnd() - 0.5) * 900, (rnd() - 0.5) * 300);
      if (rnd() < 0.05) p.applyImpulse(new THREE.Vector3((rnd() - 0.5) * 20, rnd() * 14, (rnd() - 0.5) * 20));
    }
    inp.addLook((rnd() - 0.5) * 12, (rnd() - 0.5) * 3);
    stats.frames++;
    const pos = p.position;
    if (!isFinite(pos.x + pos.y + pos.z + p.velocity.x + p.velocity.y + p.velocity.z)) stats.nan++;
    stats.minY = Math.min(stats.minY, pos.y);
    stats.maxSpeed = Math.max(stats.maxSpeed, p.velocity.length());
    stats.states[p.move.state] = (stats.states[p.move.state] || 0) + 1;
    const hit = g.world.collision.capsuleIntersect(p.move.capsule);
    if (hit && hit.depth > 0.12) { stats.deep++; stats.maxDepth = Math.max(stats.maxDepth, hit.depth); }
    if (pos.y < -8) stats.fell++;
    // stuck detection: inputs pressed forward but no movement for 2 s
    if (pos.distanceTo(lastPos) < 0.02 && inp.action('forward') && p.move.state !== 'mantle') stillT += dt; else stillT = 0;
    if (stillT > 2.5) { stats.stuck++; stillT = 0; }
    lastPos.copy(pos);
  },
  end(g, R, c) {
    const ev = evs(g, c.T0);
    for (const e of ev) stats.events[e.ev + (e.ev === 'Jump' ? ':' + e.a : '') + (e.ev === 'grapple' ? ':' + e.a : '') + (e.ev === 'WallRunEnd' ? ':' + e.a : '')] = (stats.events[e.ev + (e.ev === 'Jump' ? ':' + e.a : '') + (e.ev === 'grapple' ? ':' + e.a : '') + (e.ev === 'WallRunEnd' ? ':' + e.a : '')] || 0) + 1;
    R.fuzz = { ...stats, minY: r2(stats.minY), maxDepth: r2(stats.maxDepth), maxSpeed: r2(stats.maxSpeed), alive: g.player.alive, deaths: g.player.deaths };
  },
}];
const S = makeScenario(phases, { setup: g => installLog(g) });
export const setup = S.setup; export const drive = S.drive; export const finish = S.finish;
