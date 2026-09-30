// Worst-case load: constant explosions, impacts, hit sparks, tracers, gibs and trails. Reports CPU cost of effects.update.
import * as THREE from 'three';
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const SURF = ['metal', 'concrete', 'stone', 'wood', 'dirt', 'sand', 'glass', 'grass', 'energy'];
let acc = 0, n = 0, maxMs = 0, peak = { smoke: 0, glow: 0, tracers: 0, decals: 0, gibs: 0 };
const NO = new Set((new URLSearchParams(location.search).get('no') || '').split(','));
const RATE = parseFloat(new URLSearchParams(location.search).get('rate') || '0.22');
let nextExpl = 0.5, nextGib = 1;
let inEmit = 0;

export function setup(game, report) {
  report.custom = { phase: 'perf' };
  const fx = game.effects;
  if (new URLSearchParams(location.search).has('nolights')) fx.flashLight = () => {};
  const orig = fx.update.bind(fx);
  fx.update = (dt) => {
    const t0 = performance.now();
    orig(dt);
    const d = performance.now() - t0;
    acc += d; n++; if (d > maxMs) maxMs = d;
    for (const k of Object.keys(peak)) peak[k] = Math.max(peak[k], fx.stats[k]);
  };
}

function gibMeshes() {
  const mat = new THREE.MeshStandardMaterial({ color: 0x556070, metalness: 0.7, roughness: 0.5 });
  const geo = new THREE.BoxGeometry(0.3, 0.4, 0.25);
  const l = [];
  for (let i = 0; i < 20; i++) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(Math.random() - 0.5, 0.5 + Math.random() * 1.4, 14 + Math.random() - 0.5);
    l.push(m);
  }
  return l;
}

export function drive(t, dt, game, report) {
  const fx = game.effects;
  if (!NO.has('expl') && t > nextExpl) {
    nextExpl += RATE;
    fx.explosion(V((Math.random() - 0.5) * 14, 0.15, 13 + Math.random() * 8), { radius: 4 + Math.random() * 2, normal: V(0, 1, 0) });
  }
  if (!NO.has('gib') && t > nextGib) { nextGib += 0.7; fx.gibs(gibMeshes(), { point: V((Math.random() - 0.5) * 8, 1.2, 15), direction: V(0, 0.2, -1), velocity: V(0, 0, -2) }); }
  if (!NO.has('impact')) for (let i = 0; i < 3; i++) {
    const p = V((Math.random() - 0.5) * 14, 0.5 + Math.random() * 4, 12.5);
    if (!NO.has('imp')) fx.impact(p, V(0, 0, 1), SURF[Math.floor(Math.random() * SURF.length)]);
    if (!NO.has('tracer')) fx.tracer(V(0.5, 1.3, 24), p, { color: 0xffd890 });
  }
  if (!NO.has('hit')) { fx.hitSpark(V((Math.random() - 0.5) * 8, 1.3, 12.6), V(0, 0, 1), null); fx.hitSpark(V((Math.random() - 0.5) * 8, 1.3, 12.6), V(0, 0, 1), null); }
  if (!NO.has('muzzle')) fx.muzzleFlash(V((Math.random() - 0.5) * 8, 1.4, 22), V(0, 0, -1), { scale: 1 });
  if (!NO.has('trail')) for (let k = 0; k < 4; k++) fx.trail(V(-6 + k * 4 + Math.sin(t * 3 + k) * 1.5, 2 + k * 0.3, 24 - ((t * 20 + k * 5) % 12)), { type: k % 2 ? 'grenade' : 'rocket' });
}

export function finish(game, report) {
  report.custom = {
    updateMsAvg: +(acc / Math.max(1, n)).toFixed(3), updateMsMax: +maxMs.toFixed(2), frames: n,
    peak, dropped: game.effects.stats.dropped,
    renderCalls: game.renderer.info.render.calls,
  };
}
