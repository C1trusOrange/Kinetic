// Grappling hook: travel, attach, pull, swing constraint, release rules, cooldown.
import * as THREE from 'three';
import { teleport, keys, makeScenario, installLog, evs, r2, hs } from './common.js';

let T0 = 0;
const chestOf = p => new THREE.Vector3(p.position.x, p.position.y + p.height * 0.6, p.position.z);

function summarize(g, c) {
  const ev = evs(g, T0, 'grapple');
  const t = name => { const e = ev.find(x => x.a === name); return e ? r2(e.t - T0) : null; };
  const rel = ev.find(x => x.a === 'release');
  return {
    fireAt: t('fire'), attachAt: t('attach'), releaseAt: t('release'), missAt: t('miss'),
    releaseReason: rel ? rel.reason : null,
    travelTime: t('attach') !== null && t('fire') !== null ? r2(t('attach') - t('fire')) : null,
    peakSpeed: r2(c.peak || 0), maxHeight: r2(c.maxY || 0),
    releasePos: rel ? [r2(rel.x), r2(rel.y), r2(rel.z)] : null,
    releaseSpeed: rel ? r2(rel.speed) : null,
    maxStretch: r2(c.stretch || 0),
  };
}

function common(g, c, lt) {
  const p = g.player;
  c.peak = Math.max(c.peak || 0, Math.hypot(p.velocity.x, p.velocity.y, p.velocity.z));
  c.maxY = Math.max(c.maxY || 0, p.position.y);
  const gr = p.grapple;
  if (gr.attached) {
    const d = chestOf(p).distanceTo(gr.anchor);
    c.stretch = Math.max(c.stretch || 0, d - gr.ropeLength);
  }
}

const phases = [
  { name: 'tower', dur: 7,
    start(g, R, c) { teleport(g, 14, 0, 0, -Math.PI / 2, 0.83); T0 = g.time; },
    tick(lt, dt, g, R, c) {
      keys(g, { grapple: lt > 0.5 && lt < 0.55 });
      common(g, c, lt);
      if (lt > 0.5 && !c.snap) c.snap = { charge: r2(g.player.grappleCharge) };
    },
    end(g, R, c) {
      const p = g.player;
      R.tower = { ...summarize(g, c), finalPos: [r2(p.position.x), r2(p.position.y), r2(p.position.z)], chargeAtEnd: r2(p.grappleCharge), doubleJumpReady: p.doubleJumpReady };
    } },

  { name: 'miss', dur: 4,
    start(g, R, c) { teleport(g, 0, 0, 0, 0, 0.9); T0 = g.time; },
    tick(lt, dt, g, R, c) {
      keys(g, { grapple: (lt > 0.3 && lt < 0.35) || (lt > 1.0 && lt < 1.05) });
      if (lt > 0.3 && lt < 1.0 && g.player.grappleCharge < 1) c.charges = (c.charges || []).concat([r2(g.player.grappleCharge)]).slice(-3);
    },
    end(g, R, c) {
      const ev = evs(g, T0, 'grapple').map(e => [r2(e.t - T0), e.a]);
      R.miss = { events: ev, sampleCharges: c.charges };
    } },

  { name: 'jump_release', dur: 6,
    start(g, R, c) { teleport(g, 14, 0, 0, -Math.PI / 2, 0.83); T0 = g.time; },
    tick(lt, dt, g, R, c) {
      const p = g.player;
      keys(g, { grapple: lt > 0.5 && lt < 0.55 });
      if (p.isGrappling) c.g = (c.g || 0) + dt;
      if (c.g > 0.7 && !c.jumped) { c.jumped = true; c.jf = 3; c.vBefore = { vy: r2(p.velocity.y), speed: r2(Math.hypot(p.velocity.x, p.velocity.y, p.velocity.z)) }; }
      if (c.jf > 0) { g.input.setVirtual('jump', true); c.jf--; }
      if (c.jumped && !c.after && !p.isGrappling) c.after = { vy: r2(p.velocity.y), doubleJumpReady: p.doubleJumpReady };
      common(g, c, lt);
    },
    end(g, R, c) { R.jump_release = { ...summarize(g, c), before: c.vBefore, after: c.after }; } },

  { name: 'cooldown', dur: 8,
    start(g, R, c) { teleport(g, 14, 0, 0, -Math.PI / 2, 0.83); T0 = g.time; c.samples = []; },
    tick(lt, dt, g, R, c) {
      const p = g.player;
      // fire, cancel 0.3 s after attach, then try to re-fire at 2 s (still cooling down) and 5 s (ready)
      if (p.isGrappling) c.g = (c.g || 0) + dt;
      else if (c.g > 0) c.g = -99;
      keys(g, { grapple: (lt > 0.5 && lt < 0.55) || (c.g > 0.3 && c.g < 0.36) || (lt > 2.0 && lt < 2.05) || (lt > 5.0 && lt < 5.05) });
      if (Math.floor(lt * 4) !== c.lastS) { c.lastS = Math.floor(lt * 4); if (lt > 1) c.samples.push([r2(lt), r2(p.grappleCharge)]); }
    },
    end(g, R, c) {
      R.cooldown = { events: evs(g, T0, 'grapple').map(e => [r2(e.t - T0), e.a, e.reason || '']), charge: c.samples.filter((_, i) => i % 3 === 0) };
    } },

  { name: 'beam_swing', dur: 6,
    start(g, R, c) { teleport(g, 30, 0, 32, 0, 0.9); T0 = g.time; },
    tick(lt, dt, g, R, c) {
      keys(g, { grapple: lt > 0.4 && lt < 0.45, forward: lt > 1.0, left: lt > 1.5 && lt < 2.2 });
      common(g, c, lt);
    },
    end(g, R, c) { R.beam_swing = summarize(g, c); } },
];

const S = makeScenario(phases, { setup: g => installLog(g) });
export const setup = S.setup;
export const drive = S.drive;
export const finish = S.finish;
