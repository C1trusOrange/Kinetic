import * as THREE from 'three';
const f = v => +v.toFixed(2);
const nap = () => new Promise(r => setTimeout(r, 0));
async function step(game, seconds, dt = 1 / 60, cb = null) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) { game.update(dt); if (cb && cb(i, dt) === false) return i; if (i % 240 === 239) await nap(); }
  return n;
}
function soloBot(game) {
  const bots = game.bots.list;
  for (let i = 1; i < bots.length; i++) { bots[i].alive = false; bots[i].model.setVisible(false); bots[i].respawnAt = -1; }
  game.player.alive = false; game.player.respawnAt = -1;
  const bot = bots[0]; bot.god = true;
  return bot;
}

async function roamRescue(game, C) {
  const bot = soloBot(game), br = bot.brain, nav = game.world.nav;
  br.perceive = () => {};
  br.wantPickup = () => false;
  const tele = [];
  const oTp = bot.teleportTo.bind(bot);
  bot.teleportTo = (p, y) => { tele.push({ from: bot.position.toArray().map(f), to: p.toArray().map(f), t: f(game.time), roamFailures: br.roamFailures }); return oTp(p, y); };
  await step(game, 1.0);
  // an open floor spot: no other walkable level within 12 m above / 3 m sideways (so an airborne bot has no node nearby)
  const n = nav._main.find(n => n.position.y < 0.5 && !nav.nodes.some(m => Math.abs(m.position.x - n.position.x) < 4 && Math.abs(m.position.z - n.position.z) < 4 && m.position.y > n.position.y + 1.0 && m.position.y < n.position.y + 14)) || nav._main[0];
  C.spot = n.position.toArray().map(f);
  bot.teleportTo(n.position.clone(), 0);
  tele.length = 0;
  bot.applyImpulse({ x: 0, y: 22, z: 0 });
  br.nav.clear();
  // wait until well above the floor (apex ~10 m), then the state machine falls back to roam (e.g. its chase target died)
  await step(game, 3, 1 / 60, () => bot.position.y < 6);
  const y0 = bot.position.y;
  br.state = 'chase'; br.enterState('roam', game.time);
  const log = [{ ev: 'enterRoam', y: f(y0), air: !bot.onGround, hasGoal: br.nav.hasGoal, roamFailures: br.roamFailures }];
  let el = 0;
  await step(game, 3, 1 / 60, (i, dt) => {
    el += dt;
    if (i % 6 === 0) log.push({ el: f(el), y: f(bot.position.y), air: !bot.onGround, hasGoal: br.nav.hasGoal, rf: br.roamFailures });
    return true;
  });
  C.roamRescue = { teleports: tele, log: log.slice(0, 40) };
}


async function searchTest(game, C) {
  const bots = game.bots.list;
  for (let i = 2; i < bots.length; i++) { bots[i].alive = false; bots[i].model.setVisible(false); bots[i].respawnAt = -1; }
  game.player.alive = false; game.player.respawnAt = -1;
  const A = bots[0], B = bots[1]; A.god = true; B.god = true;
  const nav = game.world.nav;
  const br = A.brain;
  br.perceive = () => {};
  B.brain.update = () => {};
  br.wantPickup = () => false;
  // A stands on an open node, B is 50+ m away (never visible: perceive is stubbed anyway)
  const nodes = nav._main;
  const a = nodes.find(n => n.position.y < 0.5) || nodes[0];
  const far = nodes.filter(n => n.position.distanceTo(a.position) > 50 && n.position.y < 0.5)[0] || nodes[nodes.length - 1];
  A.teleportTo(a.position.clone(), 0); B.teleportTo(far.position.clone(), 0);
  await step(game, 0.6);
  // A heard B nearby: chase a point 3 m away -> arrives -> 'searching' (stand and scan)
  const rec = br._rec(B);
  const near = nav.nodes[a.links[0].to].position;
  rec.pos.set(near.x, near.y, near.z); rec.known = true; rec.lastHeard = game.time; rec.visible = false;
  const log = [];
  let t0 = -1, hurtT = -1, posAtHurt = null;
  await step(game, 12, 1 / 60, (i, dt) => {
    const t = game.time;
    if (br.searching && hurtT < 0) {
      // being shot by an unseen enemy while standing and scanning
      hurtT = t; posAtHurt = A.position.clone();
      br.onDamaged(B);
      log.push({ ev: 'hurt', t: +t.toFixed(2), searchLeft: +(br.searchUntil - t).toFixed(2), state: br.state, searching: br.searching, recPos: rec.pos.toArray().map(f), hurtAt: +rec.hurtAt.toFixed(2) });
    }
    if (hurtT >= 0 && i % 15 === 0 && t - hurtT < 5) log.push({ el: +(t - hurtT).toFixed(2), moved: f(Math.hypot(A.position.x - posAtHurt.x, A.position.z - posAtHurt.z)), state: br.state, searching: br.searching, hasTarget: !!br.targetRec, hurtAt: +rec.hurtAt.toFixed(2), known: rec.known });
    return !(hurtT >= 0 && t - hurtT > 5);
  });
  C.search = log;
}


function capsuleLinks(game, C) {
  const w = game.world, col = w.collision, nav = w.nav;
  const V = THREE.Vector3;
  const Cap = game.bots.list[0].capsule.constructor;
  const cap = new Cap(new V(), new V(), 0.3);
  const H = 1.8;
  const test = (x, y, z, r) => {
    cap.radius = r; cap.start.set(x, y + 0.08 + r, z); cap.end.set(x, y + H - r, z);
    const hit = col.capsuleIntersect(cap);
    return hit && hit.depth > 0.04 ? hit : null;
  };
  const res = { nodes: nav.nodes.length, walkLinks: 0, ceil: 0, wall: 0, floor: 0, nodeIntersect: 0, ceilPairs: [] };
  for (const n of nav.nodes) {
    if (test(n.position.x, n.position.y, n.position.z, 0.3)) res.nodeIntersect++;
    for (const l of n.links) {
      if (l.type !== 'walk' || l.pad) continue;
      const m = nav.nodes[l.to];
      if (m.id < n.id) continue;
      res.walkLinks++;
      let kind = null, at = null;
      for (const t of [0.25, 0.5, 0.75]) {
        const x = n.position.x + (m.position.x - n.position.x) * t, y = n.position.y + (m.position.y - n.position.y) * t, z = n.position.z + (m.position.z - n.position.z) * t;
        const hit = test(x, y, z, 0.3);
        if (hit) { kind = hit.normal.y < -0.3 ? 'ceil' : hit.normal.y > 0.7 ? 'floor' : 'wall'; at = [f(x), f(y), f(z)]; break; }
      }
      if (kind) { res[kind]++; if (kind === 'ceil' && res.ceilPairs.length < 400) res.ceilPairs.push(at); }
    }
  }
  // cluster the ceiling-blocked links (3 m cells)
  const cl = new Map();
  for (const a of res.ceilPairs) { const k = `${Math.round(a[0] / 3) * 3},${Math.round(a[1])},${Math.round(a[2] / 3) * 3}`; cl.set(k, (cl.get(k) || 0) + 1); }
  res.ceilClusters = [...cl.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  delete res.ceilPairs;
  C['capsule_' + w.mapId] = res;
}


function nearTest(game, C, pts) {
  const w = game.world, col = w.collision, nav = w.nav;
  const V = THREE.Vector3;
  const out = [];
  const blockedLine = (a, b) => {
    const r = [];
    for (const h of [0.3, 0.9, 1.5]) {
      const o = new V(a.x, a.y + h, a.z), d = new V(b.x - a.x, (b.y + h) - (a.y + h), b.z - a.z); const len = d.length(); d.multiplyScalar(1 / len);
      const hit = col.raycast(o, d, len);
      r.push(hit ? f(hit.distance) + '/' + f(len) : '-');
    }
    return r.join(' ');
  };
  for (const [x, y, z] of pts) {
    const p = new V(x, y, z);
    const g = col.raycast(new V(x, y + 0.5, z), new V(0, -1, 0), 4);
    const nn = nav.nearestNode(p, 8);
    const path = nav.findPath(p, new V(x + 3, y, z + 3));
    const first = path && path[0];
    // all nodes within 3 m horizontally, with distance metric used by nearestNode
    const near = nav.nodes.filter(n => Math.hypot(n.position.x - x, n.position.z - z) < 3 && Math.abs(n.position.y - y) < 3)
      .map(n => ({ p: [f(n.position.x), f(n.position.y), f(n.position.z)], d: f(Math.sqrt((n.position.x - x) ** 2 + (n.position.z - z) ** 2 + ((n.position.y - y) * 2) ** 2)), los: blockedLine(p, n.position) }))
      .sort((a, b) => a.d - b.d).slice(0, 6);
    out.push({ pos: [x, y, z], ground: g ? { dist: f(g.distance - 0.5), n: [f(g.normal.x), f(g.normal.y), f(g.normal.z)], surf: g.surface } : null, nearest: nn ? { p: [f(nn.position.x), f(nn.position.y), f(nn.position.z)], los: blockedLine(p, nn.position) } : null, firstWp: first ? { p: [f(first.x), f(first.y), f(first.z)], type: first.type, los: blockedLine(p, first) } : null, near });
  }
  C.near = out;
}


function astarCheck(game, C) {
  const nav = game.world.nav, nodes = nav.nodes, N = nodes.length;
  const dist = new Float64Array(N);
  function dijkstra(sId, gId) {
    dist.fill(Infinity); dist[sId] = 0;
    const heap = [[0, sId]];
    const push = (it) => { heap.push(it); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { let c = i * 2 + 1; if (c >= heap.length) break; if (c + 1 < heap.length && heap[c + 1][0] < heap[c][0]) c++; if (heap[c][0] >= heap[i][0]) break; [heap[c], heap[i]] = [heap[i], heap[c]]; i = c; } } return top; };
    while (heap.length) {
      const [d, u] = pop();
      if (d > dist[u]) continue;
      if (u === gId) return d;
      for (const l of nodes[u].links) { const nd = d + l.cost; if (nd < dist[l.to]) { dist[l.to] = nd; push([nd, l.to]); } }
    }
    return Infinity;
  }
  let seed = 77; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const main = nav._main;
  let n = 0, worse = 0, worse5 = 0, worse20 = 0, maxRatio = 1, sum = 0;
  const ex = [];
  for (let k = 0; k < 400; k++) {
    const a = main[Math.floor(rnd() * main.length)], b = main[Math.floor(rnd() * main.length)];
    if (a === b) continue;
    const p = nav.findPath(a.position, b.position);
    if (!p) continue;
    const g = nav._g[b.id];
    const opt = dijkstra(a.id, b.id);
    if (!isFinite(opt) || opt <= 0) continue;
    n++;
    const r = g / opt; sum += r;
    if (r > 1.0001) worse++;
    if (r > 1.05) worse5++;
    if (r > 1.2) { worse20++; if (ex.length < 5) ex.push({ a: [f(a.position.x), f(a.position.y), f(a.position.z)], b: [f(b.position.x), f(b.position.y), f(b.position.z)], astar: f(g), optimal: f(opt) }); }
    if (r > maxRatio) maxRatio = r;
  }
  C['astar_' + game.world.mapId] = { n, worse, worse5, worse20, maxRatio: f(maxRatio), avgRatio: +(sum / Math.max(1, n)).toFixed(4), ex };
}


function spotsCheck(game, C) {
  const nav = game.world.nav, sp = game.bots.spots;
  const chk = (list) => {
    let total = 0, main = 0, fromMain = 0, none = 0, ex = [];
    for (const s of list) {
      total++;
      const n = nav.nearestNode(s.pos, 2.5);
      if (!n) { none++; continue; }
      if (n.main) main++; else if (n.fromMain) fromMain++; else if (ex.length < 6) ex.push([f(s.pos.x), f(s.pos.y), f(s.pos.z)]);
    }
    return { total, main, reachableNotMain: fromMain, noNode: none, unreachable: total - main - fromMain - none, ex };
  };
  C['spots_' + game.world.mapId] = { snipe: chk(sp.snipe), cover: chk(sp.cover) };
}

function pathTiming(game, C) {
  const nav = game.world.nav;
  let seed = 5; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const main = nav._main;
  const ms = [], msC = [];
  let nulls = 0;
  for (let k = 0; k < 500; k++) {
    const a = main[Math.floor(rnd() * main.length)], b = main[Math.floor(rnd() * main.length)];
    const t0 = performance.now(); nav.isConnected(a.position, b.position); msC.push(performance.now() - t0);
    const t1 = performance.now(); const p = nav.findPath(a.position, b.position); const d = performance.now() - t1;
    if (!p) nulls++; else ms.push(d);
  }
  ms.sort((x, y) => x - y); msC.sort((x, y) => x - y);
  const q = (arr, p) => +arr[Math.min(arr.length - 1, Math.floor(arr.length * p))].toFixed(2);
  C['pathTiming_' + game.world.mapId] = { n: ms.length, nulls, avg: +(ms.reduce((s, v) => s + v, 0) / ms.length).toFixed(2), p50: q(ms, 0.5), p90: q(ms, 0.9), p99: q(ms, 0.99), max: q(ms, 1), over2_5: ms.filter(v => v > 2.5).length, over8: ms.filter(v => v > 8).length, over16: ms.filter(v => v > 16).length, connMax: q(msC, 1) };
}

function geomProbe(game, C, cx, cz, cy) {
  const w = game.world, col = w.collision, nav = w.nav;
  const V = THREE.Vector3;
  const out = { rays: [], nodes: [] };
  for (const [x, z] of [[cx, cz - 0.3], [cx, cz + 0.3], [cx + 0.5, cz]]) {
    for (const h of [0.1, 0.32, 0.6, 1.0, 1.25, 1.7]) {
      for (const dir of [[0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0]]) {
        const hit = col.raycast(new V(x, cy + h, z), new V(...dir), 2.0);
        if (hit) out.rays.push([f(x), f(z), h, dir.join(','), f(hit.distance), [f(hit.normal.x), f(hit.normal.y), f(hit.normal.z)].join(','), hit.surface, [f(hit.point.x), f(hit.point.y), f(hit.point.z)].join(',')].join(' | '));
      }
    }
  }
  for (const n of nav.nodes) {
    if (Math.abs(n.position.x - cx) < 2.6 && Math.abs(n.position.z - cz) < 2.6 && Math.abs(n.position.y - cy) < 3) {
      out.nodes.push({ id: n.id, p: [f(n.position.x), f(n.position.y), f(n.position.z)], links: n.links.filter(l => { const q = nav.nodes[l.to].position; return Math.abs(q.x - cx) < 3.6 && Math.abs(q.z - cz) < 3.6; }).map(l => { const q = nav.nodes[l.to].position; return l.type + '->' + [f(q.x), f(q.y), f(q.z)].join(','); }) });
    }
  }
  out.solids = (w.def.solids || []).filter(s => {
    let x, z;
    if (s.pos) { x = s.pos[0]; z = s.pos[2]; } else if (s.from) { x = (s.from[0] + s.to[0]) / 2; z = (s.from[s.from.length - 1] + s.to[s.to.length - 1]) / 2; } else if (s.min) { x = (s.min[0] + s.max[0]) / 2; z = (s.min[2] + s.max[2]) / 2; } else return false;
    return Math.abs(x - cx) < 7 && Math.abs(z - cz) < 7;
  }).slice(0, 14);
  C.geom = out;
}

export async function setup(game, report) {
  const C = report.custom = {};
  game.autotest.duration = 1e9;
  const which = (game.params.get('test') || 'roam,path').split(',');
  try {
    if (which.includes('roam')) await roamRescue(game, C);
    if (which.includes('search')) await searchTest(game, C);
    if (which.includes('capsule')) capsuleLinks(game, C);
    if (which.includes('near')) nearTest(game, C, game.params.get('pts').split(';').map(q => q.split(',').map(Number)));
    if (which.includes('astar')) astarCheck(game, C);
    if (which.includes('spots')) spotsCheck(game, C);
    if (which.includes('path')) pathTiming(game, C);
    if (which.includes('geom')) {
      const [cx, cz, cy] = game.params.get('geom').split(',').map(Number);
      geomProbe(game, C, cx, cz, cy);
    }
  } catch (err) { C.error = String(err && err.stack || err); console.error('[multi]', err); }
  game.autotest.duration = 0;
}
export function drive() {}
