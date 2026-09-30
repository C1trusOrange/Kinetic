// Read-only feasibility probes for the Javelin (rail) wall-pierce algorithm and beam raycasts.
export function setup(game, report) {
  const V3 = game.camera.position.constructor;
  const col = game.world.collision;
  const out = {};
  // sandbox north wall occupies z in [-32,-31], y in [-5,10]
  const o = new V3(20, 1.5, -20), d = new V3(0, 0, -1);
  const h = col.raycast(o, d, 100);
  out.forwardHit = h ? { dist: +h.distance.toFixed(3), n: h.normal.toArray().map(v => +v.toFixed(2)) } : null;
  // start INSIDE the wall (z=-31.5) casting outward (-z): front-face-only => should be null (passes out of solids)
  const inside = col.raycast(new V3(20, 1.5, -31.5), d, 50);
  out.fromInsideForward = inside ? { dist: +inside.distance.toFixed(3) } : null;
  // exit-face probe: point 1.5 m past the entry face, cast back toward the shooter
  const P = h.point.clone();
  const probe = P.clone().addScaledVector(d, 1.5);
  const back = col.raycast(probe, d.clone().negate(), 1.5 - 0.02);
  out.reverseFromOutside = back ? { dist: +back.distance.toFixed(3), thickness: +(1.5 - back.distance).toFixed(3) } : null;
  // probe that is still inside the solid (0.5 m past entry) => reverse ray must NOT hit (backface) => treated as "too thick"
  const probeIn = P.clone().addScaledVector(d, 0.5);
  const backIn = col.raycast(probeIn, d.clone().negate(), 0.48);
  out.reverseFromInside = backIn ? { dist: +backIn.distance.toFixed(3) } : null;
  // combat.raycast returns fresh objects (allocation per call)
  const c1 = game.combat.raycast(o, d, 100, game.player), c2 = game.combat.raycast(o, d, 100, game.player);
  out.combatRaycastFreshObjects = c1 !== c2 && c1.point !== c2.point;
  // timing of 2000 world raycasts (beam ticks / chain LOS budget)
  const t0 = performance.now();
  for (let i = 0; i < 2000; i++) col.raycast(o, d, 100);
  out.rays2000ms = +(performance.now() - t0).toFixed(1);
  // grenade / weapon registries actually present
  out.grenadeKeys = Object.keys(game.projectiles);
  out.weaponOrder = game.weapons.owned.slice();
  report.custom = out;
}
export function drive() {}
