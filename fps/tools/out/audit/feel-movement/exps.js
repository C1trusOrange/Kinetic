import { MOVE as M } from '/src/player/MoveConfig.js';
const q = new URLSearchParams(location.search);
const exp = q.get('exp');

// ---- experiments: apply tuning changes at runtime (scratch only; the source files are not touched)
export function applyExp(g) {
  const p = g.player, mv = p.move;
  if (!exp) return;
  const list = exp.split(',');
  for (const e of list) {
    if (e.startsWith('set:')) { for (const kv of e.slice(4).split('|')) { const [k, v] = kv.split('='); M[k] = parseFloat(v); } }
    if (e === 'wj_look') {
      const o = mv._wallJump.bind(mv);
      mv._wallJump = (n, d) => {
        o(n, d);
        const v = p.velocity;
        const hsp = Math.hypot(v.x, v.z);
        const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
        if (hsp > 0.1 && fx * n.x + fz * n.z > -0.2) {
          let dx = v.x / hsp, dz = v.z / hsp;
          dx += (fx - dx) * 0.6; dz += (fz - dz) * 0.6;
          const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
          let nvx = dx * hsp, nvz = dz * hsp;
          const out = nvx * n.x + nvz * n.z;
          if (out < 4) { nvx += n.x * (4 - out); nvz += n.z * (4 - out); }
          v.x = nvx; v.z = nvz;
        }
      };
    }
    if (e === 'wr_pop') {
      const orig = mv._startWallRun.bind(mv);
      mv._startWallRun = s => { orig(s); if (p.velocity.y < 4.2) p.velocity.y = 4.2; };
    }
    if (e === 'wr_grav') { M.WALLRUN_GRAV_START = 0.06; M.WALLRUN_SINK_START = 0.25; M.WALLRUN_TIME = 2.0; }
    if (e === 'wr_min_h') { M.WALLRUN_MIN_HEIGHT = 0.55; }
    if (e === 'slide_fric') { M.SLIDE_FRICTION = 0.35; }
    if (e === 'slide_const') {
      // constant deceleration slide: replace friction by 2.4 m/s^2 + 0.25 proportional
      M.SLIDE_FRICTION = 0.25;
      const o = mv._groundStep.bind(mv);
      mv._groundStep = dt => {
        if (mv.sliding) { const v = p.velocity; const sp = Math.hypot(v.x, v.z); if (sp > 0.01) { const k = Math.min(sp, 2.4 * dt) / sp; v.x *= 1 - k; v.z *= 1 - k; } }
        o(dt);
      };
    }
    if (e === 'overspeed_fric') {
      // gentler friction when above sprint speed on the ground
      const o = mv._groundStep.bind(mv);
      mv._groundStep = dt => {
        const v = p.velocity;
        if (!mv.sliding) {
          const sp = Math.hypot(v.x, v.z);
          if (sp > M.SPRINT_SPEED + 0.2) {
            // pre-compensate the friction the base step will apply: keep (sp - sprint) decaying at ~2.2/s instead of ~7/s
            const over = sp - M.SPRINT_SPEED;
            const want = M.SPRINT_SPEED + over * Math.exp(-2.2 * dt);
            const willBe = Math.max(sp - Math.max(sp, M.STOP_SPEED) * M.FRICTION * dt, 0);
            if (willBe > 0) { const k = want / willBe; if (k > 1) { v.x *= Math.min(k, 1.3); v.z *= Math.min(k, 1.3); } }
          }
        }
        o(dt);
      };
    }
    if (e === 'mantle_keep') {
      const o = mv._finishMantle.bind(mv);
      mv._finishMantle = () => { const sp = mv.entrySpeed || 0; o(); const d = mv.mantleDir; const s2 = Math.min(8, Math.max(M.MANTLE_EXIT_SPEED, sp * 0.65)); p.velocity.set(d.x * s2, 0, d.z * s2); };
      const t = mv._tryMantle.bind(mv);
      mv._tryMantle = (fg) => { const sp = Math.hypot(p.velocity.x, p.velocity.z); const r = t(fg); if (r) mv.entrySpeed = sp; return r; };
    }
  }
}

