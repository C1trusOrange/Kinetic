// Real-time reproductions through the actual game loop and the Input virtual-key path (Player.update, 120 Hz
// sub-steps, no headless stepping): the exact spots the user reported.
//   python tools/run.py "index.html?autotest=1&map=foundry&bots=0&god=1&duration=99999&scenario=tools/out/collision/realtime.js" --report --timeout 300 --shots 4,9 --out tools/out/collision/rt_foundry
import * as THREE from 'three';
import { Detector, teleport } from './lib.js';

const PI = Math.PI;
// pos = FEET position; yaw 0 looks -Z, PI/2 looks -X, -PI/2 looks +X
const CASES = {
  foundry: [
    { name: 'canyon 3-high container stack (ground jump + double jump)', pos: [-39.4, 0, -40.5], yaw: PI / 2, jumps: [0.35, 0.75], dur: 3.2 },
    { name: 'container stack (sprint at it, jump)', pos: [-35, 0, -40.5], yaw: PI / 2, sprint: true, jumps: [0.55], dur: 3.2 },
    { name: 'north border wall, airborne at 4 m (after a wall-jump)', pos: [0, 4.0, -43.3], yaw: 0, air: true, dur: 3.5, escapeZ: -45.6 },
    { name: 'north border wall, airborne at 13.8 m (upper seam, y=16)', pos: [10, 13.9, -43.3], yaw: 0, air: true, dur: 3.5, escapeZ: -45.6 },
    { name: 'west border wall, airborne at 3.9 m', pos: [-48.3, 3.9, -10], yaw: PI / 2, air: true, dur: 3.5, escapeX: -50.3 },
  ],
  skyline: [
    { name: 'NE building, street side (ground jump + double jump) seam y=3.2', pos: [15.0, 0, -28], yaw: -PI / 2, jumps: [0.35, 0.75], dur: 3.2 },
    { name: 'NE building, sprint + jump', pos: [12.0, 0, -22], yaw: -PI / 2, sprint: true, jumps: [0.5], dur: 3.2 },
    { name: 'N building, plaza side, seam y=3.2', pos: [0, 0, -16], yaw: 0, jumps: [0.35, 0.75], dur: 3.2 },
    { name: 'north perimeter wall, airborne at 3.4 m (seam y=5.6)', pos: [5, 3.4, -43.3], yaw: 0, air: true, dur: 3.5, escapeZ: -45.6 },
    { name: 'north perimeter wall, airborne at 13 m (invisible extension seam y=14.5)', pos: [5, 12.9, -43.3], yaw: 0, air: true, dur: 3.5, escapeZ: -45.6 },
    { name: 'east perimeter wall, airborne at 3.5 m', pos: [43.3, 3.5, 5], yaw: -PI / 2, air: true, dur: 3.5, escapeX: 45.6 },
  ],
};

let det = null, list = null, ci = -1, t0 = 0, cur = null, frame = 0, doneAll = false;
const results = [];

function startCase(game, t) {
  ci++;
  if (ci >= list.length) { doneAll = true; return; }
  cur = list[ci];
  t0 = t;
  teleport(game, cur.pos[0], cur.pos[1], cur.pos[2], cur.yaw, { air: cur.air });
  cur.rec = { mantled: false, insideAny: false, firstInside: null, minY: 1e9, maxY: -1e9, escaped: false, samples: 0 };
  cur.jumps = (cur.jumps || []).slice();
  cur.jumpIdx = 0;
  const inp = game.input;
  for (const a of ['forward', 'jump', 'sprint', 'crouch']) inp.setVirtual(a, false);
}

export async function setup(game, report) {
  det = new Detector(game);
  list = CASES[game.world.mapId] || [];
  report.custom = { detector: { tris: det.count }, cases: [] };
  startCase(game, 0);
}

export function drive(t, dt, game, report) {
  if (doneAll) return;
  if (!cur) return;
  const tc = t - t0;
  const inp = game.input;
  inp.setVirtual('forward', true);
  inp.setVirtual('sprint', !!cur.sprint);
  // jump: pulse 0.05 s at each scheduled time
  let jumpDown = false;
  for (const j of cur.jumps) if (tc >= j && tc < j + 0.06) jumpDown = true;
  inp.setVirtual('jump', jumpDown);
  const P = game.player;
  const rec = cur.rec;
  if (P.isMantling) rec.mantled = true;
  rec.minY = Math.min(rec.minY, P.position.y);
  rec.maxY = Math.max(rec.maxY, P.position.y);
  frame++;
  if (frame % 3 === 0 && !rec.insideAny) {
    rec.samples++;
    if (det.insideCapsule(P.move.capsule)) {
      rec.insideAny = true;
      rec.firstInside = { t: +tc.toFixed(2), pos: P.position.toArray().map(v => +v.toFixed(2)) };
    }
  }
  if (cur.escapeZ !== undefined && P.position.z < cur.escapeZ) rec.escaped = true;
  if (cur.escapeX !== undefined && (cur.escapeX < 0 ? P.position.x < cur.escapeX : P.position.x > cur.escapeX)) rec.escaped = true;
  if (tc >= cur.dur) {
    rec.endInside = det.insideCapsule(P.move.capsule);
    rec.end = P.position.toArray().map(v => +v.toFixed(2));
    rec.rescues = P.move.rescueCount;
    report.custom.cases.push({ name: cur.name, mantled: rec.mantled, INSIDE: rec.insideAny || rec.endInside, firstInside: rec.firstInside, escapedTheMap: rec.escaped, end: rec.end, maxY: +rec.maxY.toFixed(2), rescues: rec.rescues });
    startCase(game, t);
    if (doneAll) {
      for (const a of ['forward', 'jump', 'sprint']) inp.setVirtual(a, false);
      report.custom.rescues = P.move.rescueCount;
      game.autotest.finish();
    }
  }
}
