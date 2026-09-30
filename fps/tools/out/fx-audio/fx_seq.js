import * as THREE from 'three';
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const P = new URLSearchParams(location.search);
const kind = P.get('kind') || 'impacts';
const TIMES = (P.get('times') || '0.05,0.15,0.4,1,2,4').split(',').map(Number);
const T0 = 0.3;
const SURFACES = ['metal', 'concrete', 'stone', 'wood', 'dirt', 'sand', 'glass', 'grass', 'energy'];
let fired = false, idx = 0, waitAck = null;

function makeGibs() {
  const mats = [
    new THREE.MeshStandardMaterial({ color: 0x8a94a6, metalness: 0.8, roughness: 0.4 }),
    new THREE.MeshStandardMaterial({ color: 0x33363d, metalness: 0.6, roughness: 0.5 }),
    new THREE.MeshStandardMaterial({ color: 0xff4a3d, emissive: 0xff2a1a, emissiveIntensity: 1.5, metalness: 0.4, roughness: 0.5 }),
  ];
  const geos = [new THREE.BoxGeometry(0.3, 0.5, 0.25), new THREE.BoxGeometry(0.5, 0.6, 0.3), new THREE.BoxGeometry(0.12, 0.45, 0.12),
    new THREE.CylinderGeometry(0.1, 0.1, 0.4, 6), new THREE.BoxGeometry(0.28, 0.28, 0.28)];
  const list = [];
  for (let i = 0; i < 14; i++) {
    const m = new THREE.Mesh(geos[i % geos.length], mats[i % 3 === 2 ? 2 : i % 2]);
    m.position.set(Math.sin(i * 1.7) * 0.25, 0.3 + (i / 14) * 1.5, Math.cos(i * 2.1) * 0.25);
    m.position.add(V(0, 0, 14));
    m.quaternion.setFromEuler(new THREE.Euler(i, i * 2, i * 3));
    m.castShadow = true;
    list.push(m);
  }
  return list;
}

export function setup(game, report) { report.custom = { kind }; }

function fire(game) {
  const fx = game.effects;
  if (kind === 'impacts') {
    SURFACES.forEach((s, i) => {
      const x = -6.4 + i * 1.6;
      for (let k = 0; k < 2; k++) {
        const p = V(x + (k - 0.5) * 0.5, 1.2 + k * 1.1, 12.5);
        fx.impact(p, V(0, 0, 1), s);
        fx.tracer(V(0.5, 1.3, 15.4), p, { color: k ? 0xffd890 : 0x9cd8ff });
      }
    });
  } else if (kind === 'hit') {
    const ent = { model: { flashHit() {} } };
    fx.hitSpark(V(-3, 1.3, 12.6), V(0, 0, 1), ent);
    fx.hitSpark(V(0, 1.6, 12.6), V(0.4, 0.2, 0.9).normalize(), ent);
    fx.hitSpark(V(3, 1.0, 12.6), V(-0.4, 0.5, 0.75).normalize(), ent);
    fx.muzzleFlash(V(-5, 1.4, 15), V(0.3, 0, -1).normalize(), { scale: 1 });
    fx.muzzleFlash(V(5, 1.4, 15), V(-0.3, 0, -1).normalize(), { scale: 1.3, color: 0x9cd8ff });
  } else if (kind === 'muzzle') {
    fx.muzzleFlash(V(-2.2, 1.5, 17), V(1, 0, -0.3).normalize(), { scale: 1 });
    fx.muzzleFlash(V(2.2, 1.5, 17), V(-1, 0.05, -0.4).normalize(), { scale: 1.3, color: 0x9cd8ff });
    fx.muzzleFlash(V(0, 1.4, 15), V(0, 0, -1), { scale: 1 });
    fx.tracer(V(-1.6, 1.5, 16.8), V(8, 1.6, 8), { color: 0xffd890 });
    fx.tracer(V(1.6, 1.5, 16.8), V(-8, 1.6, 8), { color: 0x9cd8ff });
  } else if (kind === 'gibs') {
    fx.gibs(makeGibs(), { point: V(0, 1.1, 14), direction: V(0.2, 0.1, -1).normalize(), velocity: V(1, 0, -3) });
  } else if (kind === 'dust') {
    fx.dust(V(-4, 0, 14), { amount: 0.4 });
    fx.dust(V(0, 0, 14), { amount: 1 });
    fx.dust(V(4, 0, 14), { amount: 2.2 });
  }
}

export function drive(t, dt, game, report) {
  if (waitAck !== null) { if ((window.__SHOT_ACK || 0) > waitAck) { waitAck = null; game.timeScale = 1; } return; }
  if (!fired && t >= T0) { fired = true; fire(game); }
  if (kind === 'trail' && t > 0.3 && t < 1.6) {
    const u = (t - 0.3) / 1.3;
    game.effects.trail(V(4 - u * 5, 1.8, 20 - u * 9), { type: 'rocket' });
    game.effects.trail(V(-4 + u * 3, 1.2 + Math.sin(u * 3) * 0.5, 20 - u * 8), { type: 'grenade' });
  }
  if ((fired || kind === 'trail') && idx < TIMES.length && t >= T0 + TIMES[idx]) {
    window.__SHOT_REQ = 'e' + idx; waitAck = window.__SHOT_ACK || 0; game.timeScale = 0; idx++;
  }
  if (idx >= TIMES.length) report.custom.done = true;
}
export function finish(game, report) { report.custom.stats = { ...game.effects.stats }; }
