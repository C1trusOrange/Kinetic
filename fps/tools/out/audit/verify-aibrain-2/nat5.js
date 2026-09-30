// Natural sim, part 3: stuck recoveries (position / stage / current waypoint), clustered.
import * as THREE from 'three';
const f = v => +v.toFixed(1);
const nap = () => new Promise(r => setTimeout(r, 0));
export async function setup(game, report) {
  const C = report.custom = { rec: [], byCell: {} };
  game.autotest.duration = 1e9;
  const SEC = parseFloat(game.params.get('sec') || '250');
  const jit = game.params.get('jit') === '1';
  const col = game.world.collision;
  for (const b of game.bots.list) {
    const br = b.brain, nav = br.nav;
    const orc = br.recoverStuck.bind(br);
    br.recoverStuck = (t) => {
      const wp = nav.path && nav.path[nav.index];
      let los = null;
      if (wp) {
        const o = new THREE.Vector3(b.position.x, b.position.y + 0.5, b.position.z);
        const d = new THREE.Vector3(wp.x - b.position.x, wp.y - b.position.y, wp.z - b.position.z);
        const L = d.length(); if (L > 0.01) { d.multiplyScalar(1 / L); const h = col.raycast(o, d, L); los = h ? f(h.distance) : 'clear'; }
      }
      C.rec.push({ t: f(game.time), bot: b.name, st: br.state, stage: br.stuckStage + 1, pos: [f(b.position.x), f(b.position.y), f(b.position.z)], mode: nav.mode, wp: wp ? [f(wp.x), f(wp.y), f(wp.z), wp.type].join(',') : null, los });
      return orc(t);
    };
  }
  const dt0 = 1 / 60;
  let acc = 0;
  for (let i = 0; acc < SEC; i++) {
    const dt = jit ? dt0 * (0.6 + Math.random() * 1.4) : dt0;
    game.update(dt);
    acc += dt;
    if (i % 240 === 239) await nap();
  }
  for (const r of C.rec) { const k = `${Math.round(r.pos[0] / 3) * 3},${Math.round(r.pos[1])},${Math.round(r.pos[2] / 3) * 3}`; C.byCell[k] = (C.byCell[k] || 0) + 1; }
  C.n = C.rec.length;
  C.top = Object.entries(C.byCell).sort((a, b) => b[1] - a[1]).slice(0, 12);
  C.rec = C.rec.slice(0, 40);
  game.autotest.duration = game.autotest.t + 0.05;
}
export function drive() {}
