// Watch bot physics for anomalies: NaN, hovering, flicker, teleports, capsule out of sync, penetration.
const st = new Map();
let tele = [];
let patched = false;
const anomalies = [];
function note(kind, b, extra) { if (anomalies.length < 60) anomalies.push({ kind, name: b.name, t: +window.__GAME__.time.toFixed(2), pos: b.position.toArray().map(v => +v.toFixed(2)), ...extra }); }

export function setup(game, report) {
  report.custom = report.custom || {};
  report.custom.anomalies = anomalies;
  report.custom.tele = tele;
  const proto = Object.getPrototypeOf(game.bots.list[0]);
  if (!patched) {
    patched = true;
    const orig = proto.teleportTo;
    proto.teleportTo = function (p, y) { tele.push({ name: this.name, t: +game.time.toFixed(2), from: this.position.toArray().map(v => +v.toFixed(1)), stage: this.brain.stuckStage, state: this.brain.state }); return orig.call(this, p, y); };
  }
}

export function drive(t, dt, game, report) {
  const c = report.custom;
  c.frames = (c.frames || 0) + 1;
  c.flicker = c.flicker || 0; c.liftoffs = c.liftoffs || 0; c.maxAir = c.maxAir || 0;
  c.capMismatch = c.capMismatch || 0; c.maxPen = c.maxPen || 0; c.hover = c.hover || 0;
  const col = game.world.collision;
  for (const b of game.bots.list) {
    if (!b.alive) { st.delete(b); continue; }
    let s = st.get(b);
    if (!s) { s = { wasGround: b.onGround, airStart: -1, lastJump: -9, lastLaunch: -9 }; st.set(b, s); }
    const vals = [b.position.x, b.position.y, b.position.z, b.velocity.x, b.velocity.y, b.velocity.z, b.yaw, b.pitch, b.bodyYaw, b.crouch, b.health];
    if (vals.some(v => !Number.isFinite(v))) note('nan', b, { vals });
    // capsule vs position
    const cap = b.capsule;
    const dx = cap.start.x - b.position.x, dz = cap.start.z - b.position.z, dy = cap.start.y - cap.radius - b.position.y;
    if (Math.hypot(dx, dy, dz) > 0.01) { c.capMismatch++; note('capMismatch', b, { d: [dx, dy, dz] }); }
    const ht = cap.end.y - cap.start.y + 2 * cap.radius;
    if (Math.abs(ht - b.height) > 0.02) note('heightMismatch', b, { ht, h: b.height });
    // penetration: capsule vs geometry after the update (measured next frame start)
    const r = col.capsuleIntersect(cap);
    if (r && r.depth > 0.05) { c.maxPen = Math.max(c.maxPen, r.depth); if (r.depth > 0.15) note('penetration', b, { depth: +r.depth.toFixed(3), n: [r.normal.x, r.normal.y, r.normal.z].map(v => +v.toFixed(2)) }); }
    if (b.brain.intent.jump) s.lastJump = t;
    if (b.lastLaunchTime > -100) s.lastLaunch = b.lastLaunchTime;
    if (s.wasGround && !b.onGround) {
      s.airStart = t;
      c.liftoffs++;
    }
    if (!s.wasGround && b.onGround && s.airStart >= 0) {
      const air = t - s.airStart;
      c.maxAir = Math.max(c.maxAir, air);
      if (air < 0.13 && t - s.lastJump > 0.6 && game.time - s.lastLaunch > 1) { c.flicker++; if (c.flicker < 12) note('flicker', b, { air: +air.toFixed(3), vy: b.velocity.y }); }
      s.airStart = -1;
    }
    if (!b.onGround && s.airStart >= 0 && t - s.airStart > 3 && Math.abs(b.velocity.y) < 0.3) { c.hover++; note('hover', b, { air: t - s.airStart, vy: b.velocity.y }); }
    s.wasGround = b.onGround;
  }
}
export function finish(game, report) { report.custom.teleports = tele.length; }
