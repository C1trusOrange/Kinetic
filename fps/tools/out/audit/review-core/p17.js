// random-walk stress test of moveCapsule: penetration residue and escapes from the sealed arena (sandbox)
const col = game.world.collision;
let seed = 424242;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const R = 0.4;
const out = { walkers: 0, escapes: 0, residualPen: 0, maxPen: 0, samples: [], fellThrough: 0 };
const G = 24;
const t0 = performance.now();
for (let w = 0; w < 400; w++) {
  // random start inside arena above floor
  const x = -28 + rnd() * 56, z = -28 + rnd() * 56, y = 0.5 + rnd() * 3;
  const cap = new Capsule(new THREE.Vector3(x, y + R, z), new THREE.Vector3(x, y + 1.8 - R, z), R);
  // ignore starts already penetrating
  if (col.capsuleIntersect(cap)) continue;
  out.walkers++;
  const vel = new THREE.Vector3(0, 0, 0);
  let dir = rnd() * Math.PI * 2, speed = 3 + rnd() * 25;
  let escaped = false, worstPen = 0;
  for (let s = 0; s < 400; s++) {
    if (s % 40 === 0) { dir = rnd() * Math.PI * 2; speed = 3 + rnd() * 25; if (rnd() < 0.3) vel.y = 8; }
    vel.x = Math.cos(dir) * speed; vel.z = Math.sin(dir) * speed;
    vel.y = Math.max(vel.y - G / 120, -55);
    const dt = (s % 7 === 0) ? 0.05 : 1 / 120;
    col.moveCapsule(cap, vel, dt);
    const pen = col.capsuleIntersect(cap);
    if (pen && pen.depth > worstPen) worstPen = pen.depth;
    const p = cap.start;
    if (Math.abs(p.x) > 32.6 || Math.abs(p.z) > 32.6 || p.y < -6) { escaped = true; if (out.samples.length < 5) out.samples.push({ w, s, p: p.toArray().map(v => +v.toFixed(2)) }); break; }
  }
  if (escaped) out.escapes++;
  if (worstPen > 0.02) out.residualPen++;
  out.maxPen = Math.max(out.maxPen, worstPen);
}
out.ms = +(performance.now() - t0).toFixed(0);
return out;
