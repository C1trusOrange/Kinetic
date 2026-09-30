// Static scans on the nav graph for findings 3 (jump waypoint nudge), 4 (ceiling links), 5 (nearest node across wall), 9 (spots).
import * as THREE from 'three';
import { pullFromEdges } from '/src/ai/BotNav.js';
const f = v => +v.toFixed(2);
const UP = new THREE.Vector3(0, 1, 0);
const nap = () => new Promise(r => setTimeout(r, 0));

export async function setup(game, report) {
  const C = report.custom = {};
  game.autotest.duration = 1e9;
  const nav = game.world.nav, col = game.world.collision;
  const nodes = nav.nodes;
  C.map = game.params.get('map');
  C.nodes = nodes.length;

  // ---------------- Finding 4: ceiling under 1.85 m along walk links
  {
    const seen = new Set();
    let total = 0;
    const bad = [];
    const o = new THREE.Vector3();
    for (const n of nodes) {
      for (const l of n.links) {
        if (l.type !== 'walk' || l.pad) continue;
        const m = nodes[l.to];
        const key = Math.min(n.id, m.id) + '_' + Math.max(n.id, m.id);
        if (seen.has(key)) continue;
        seen.add(key);
        total++;
        let minHead = 9;
        for (const s of [0.25, 0.5, 0.75]) {
          for (const lat of [0, 0.3, -0.3]) {
            const dx = m.position.x - n.position.x, dz = m.position.z - n.position.z;
            const len = Math.hypot(dx, dz) || 1;
            const x = n.position.x + dx * s + (-dz / len) * lat, z = n.position.z + dz * s + (dx / len) * lat;
            const y = n.position.y + (m.position.y - n.position.y) * s;
            o.set(x, y + 0.9, z);
            const h = col.raycast(o, UP, 1.0);
            if (h) minHead = Math.min(minHead, 0.9 + h.distance);
          }
        }
        if (minHead < 1.8) bad.push({ a: [f(n.position.x), f(n.position.y), f(n.position.z)], b: [f(m.position.x), f(m.position.y), f(m.position.z)], head: f(minHead) });
      }
    }
    C.f4 = { totalWalkLinks: total, ceilingBlocked: bad.length, sample: bad.slice(0, 25) };
    const reg = {};
    for (const b of bad) { const k = `${Math.round(b.a[0] / 4) * 4},${Math.round(b.a[1])},${Math.round(b.a[2] / 4) * 4}`; reg[k] = (reg[k] || 0) + 1; }
    C.f4.regions = reg;
  }
  await nap();

  // ---------------- Finding 3: jump waypoints after pullFromEdges
  {
    let jl = 0, tested = 0, moved = 0, over13 = 0, guard = 0;
    const ex = [];
    for (const a of nodes) {
      for (const l of a.links) {
        if (l.type !== 'jump' || l.pad) continue;
        jl++;
        const b = nodes[l.to];
        // goal: a walk neighbour of b, at least 2 m from a
        let goal = null;
        for (const l2 of b.links) {
          if (l2.type !== 'walk') continue;
          const c = nodes[l2.to];
          if (c === a) continue;
          if (Math.hypot(c.position.x - a.position.x, c.position.z - a.position.z) > 1.8 && Math.abs(c.position.y - b.position.y) < 0.5) { goal = c; break; }
        }
        if (!goal) continue;
        const p = nav.findPath(a.position.clone(), goal.position.clone());
        if (!p || p.length < 2) continue;
        // the first waypoint must be the jump onto b
        let ji = -1;
        for (let i = 0; i < p.length - 1; i++) if (p[i].type === 'jump' && !p[i].pad) { ji = i; break; }
        if (ji < 0) continue;
        tested++;
        const raw = p[ji].clone();
        const q = p.map(w => { const c = w.clone(); c.type = w.type; if (w.pad) c.pad = true; return c; });
        pullFromEdges(col, q);
        const w = q[ji];
        const mv = Math.hypot(w.x - raw.x, w.z - raw.z);
        if (mv > 0.05) moved++;
        const dyRaw = raw.y - a.position.y, dyNew = w.y - a.position.y;
        if (dyNew > 1.3) over13++;
        // guard active when the bot stands near: dy > 1.3 && dy > d*0.75
        const d = Math.hypot(w.x - a.position.x, w.z - a.position.z);
        if (dyNew > 1.3 && dyNew > d * 0.75) guard++;
        if (mv > 0.05 && ex.length < 12) ex.push({ a: [f(a.position.x), f(a.position.y), f(a.position.z)], raw: [f(raw.x), f(raw.y), f(raw.z)], nud: [f(w.x), f(w.y), f(w.z)], moved: f(mv), dyRaw: f(dyRaw), dyNew: f(dyNew), d: f(d), idx: ji, len: p.length });
      }
    }
    C.f3 = { jumpLinks: jl, tested, moved, over13, guardAtStart: guard, ex };
  }
  await nap();

  // ---------------- Finding 5: nearest node across a wall
  {
    const r = { samples: 0, blocked: 0, ex: [], noLosCloseNode: 0 };
    const o = new THREE.Vector3(), tgt = new THREE.Vector3(), dir = new THREE.Vector3(), p = new THREE.Vector3();
    const cap = new (game.bots.list[0].capsule.constructor)(new THREE.Vector3(), new THREE.Vector3(), 0.4);
    const step = Math.max(1, Math.floor(nodes.length / 4000));
    const OFF = [[0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5], [1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]];
    const seenPos = new Set();
    for (let i = 0; i < nodes.length; i += step) {
      const n = nodes[i];
      for (const [ox, oz] of OFF) {
        const x = n.position.x + ox, z = n.position.z + oz;
        o.set(x, n.position.y + 0.6, z);
        const g = col.raycast(o, new THREE.Vector3(0, -1, 0), 1.5);
        if (!g || g.normal.y < 0.7) continue;
        p.set(x, g.point.y, z);
        // bot capsule must fit here
        cap.start.set(p.x, p.y + 0.4 + 0.02, p.z); cap.end.set(p.x, p.y + 1.4, p.z);
        if (col.capsuleIntersect(cap)) continue;
        const key = Math.round(x * 2) + ',' + Math.round(z * 2) + ',' + Math.round(p.y * 2);
        if (seenPos.has(key)) continue; seenPos.add(key);
        r.samples++;
        const nn = nav.nearestNode(p, 8);
        if (!nn) continue;
        // LOS from p to nn at knee and chest height
        let blocked = false;
        for (const h of [0.5, 1.2]) {
          o.set(p.x, p.y + h, p.z);
          tgt.set(nn.position.x, nn.position.y + h, nn.position.z);
          dir.subVectors(tgt, o);
          const dist = dir.length(); dir.multiplyScalar(1 / dist);
          const hit = col.raycast(o, dir, dist);
          if (hit && Math.abs(hit.normal.y) < 0.7) { blocked = true; break; }
        }
        if (blocked) {
          r.blocked++;
          if (r.ex.length < 30) r.ex.push({ p: [f(p.x), f(p.y), f(p.z)], node: [f(nn.position.x), f(nn.position.y), f(nn.position.z)], d: f(nn.position.distanceTo(p)) });
        }
      }
    }
    C.f5 = r;
  }
  await nap();

  // ---------------- Finding 9: spot reachability
  {
    const spots = game.bots.spots;
    const cls = list => {
      const out = { n: list.length, main: 0, notMain: 0, fromMainNotMain: 0, isolated: 0, notConnectedFromMain: 0, sample: [] };
      const mainNode = nav._main[0];
      for (const s of list) {
        const nn = nav.nearestNode(s.pos, 0.8);
        if (!nn) { out.isolated++; continue; }
        if (nn.main) out.main++; else {
          out.notMain++;
          if (nn.fromMain) out.fromMainNotMain++;
          if (out.sample.length < 6) out.sample.push([f(s.pos.x), f(s.pos.y), f(s.pos.z), nn.fromMain, nn.toMain]);
        }
        if (!nav.isConnected(mainNode, nn)) out.notConnectedFromMain++;
      }
      return out;
    };
    C.f9 = { snipe: cls(spots.snipe), cover: cls(spots.cover) };
  }
  game.autotest.duration = game.autotest.t + 0.05;
}
export function drive() {}
