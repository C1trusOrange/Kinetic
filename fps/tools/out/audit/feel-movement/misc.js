// Jump pads, rocket jump, landing dip, head bob. Sandbox map (pads) / flat map (?flat=1).
import * as THREE from 'three';
import { teleport, keys, makeScenario, evs, tr, r2, r3, hs, stats, firstT } from './common.js';

const F = (g, name, on) => g.input.setVirtual(name, on);
const H = s => Math.hypot(s.vx, s.vz);
const V3 = s => Math.hypot(s.vx, s.vy, s.vz);
const seriesEvery = (T, dtS, f) => { const out = []; if (!T.length) return out; let next = T[0].t; for (const s of T) if (s.t >= next) { out.push(f(s)); next += dtS; } return out; };
function pulse(g, c, name, lt, when, hold = 1) {
  const k = '_p_' + name + when;
  if (lt >= when && !c[k]) { c[k] = 1; c[k + 'f'] = 0; F(g, name, true); return; }
  if (c[k] === 1) { c[k + 'f']++; if (c[k + 'f'] >= hold) { c[k] = 2; F(g, name, false); } }
}
const flat = new URLSearchParams(location.search).get('flat');
let phases;
if (!flat) {
  phases = [
    { name: 'pad1_walk_on', dur: 5,
      start(g) { teleport(g, 9.5, 0, -16, -Math.PI / 2, 0.1); },
      tick(lt, dt, g, R, c) {
        keys(g, { forward: lt > 0.2 });
        if (g.player.velocity.y > 4 && !c.l) { c.l = 1; c.lv = [r2(g.player.velocity.x), r2(g.player.velocity.y), r2(g.player.velocity.z)]; c.lt = lt; }
        c.maxY = Math.max(c.maxY || 0, g.player.position.y);
        c.maxV = Math.max(c.maxV || 0, hs(g.player));
      },
      end(g, R, c) {
        const T = tr(g); const last = T[T.length - 1];
        const first = T.findIndex(s => s.vy > 4);
        const land = T.find((s, i) => i > first + 20 && s.g);
        R.pad1_walk_on = { launchVel: c.lv, launchT: r2(c.lt), maxY: r2(c.maxY), landAt: land ? [r2(land.x), r2(land.y), r2(land.z), 'after ' + r2(land.t - T[first].t) + 's'] : null, final: [r2(last.x), r2(last.y), r2(last.z)], doubleJumpReady: g.player.doubleJumpReady };
        R.pad1_walk_on.speedSeries = seriesEvery(T.slice(first), 0.2, s => [r2(H(s)), r2(s.vy), r2(s.y)]);
        // camera fov / shake trace
        const fr = g.__frames.filter(f => f.t > c.T0 + c.lt - 0.1);
        R.pad1_walk_on.fovSeries = seriesEvery(fr, 0.25, f => r2(f.fov)).slice(0, 8);
        R.pad1_walk_on.traumaAtLaunch = r2(Math.max(...fr.slice(0, 10).map(f => f.trauma)));
      } },
    { name: 'pad1_walk_on_holding_W_but_looking_other_way', dur: 5,
      start(g) { teleport(g, 12, 0, -14, 0, 0.1); },
      tick(lt, dt, g, R, c) { keys(g, { forward: lt > 0.2 }); },
      end(g, R, c) {
        const T = tr(g); const last = T[T.length - 1];
        const first = T.findIndex(s => s.vy > 4);
        const land = T.find((s, i) => i > first + 20 && s.g);
        R.pad1_lookaway = { landAt: land ? [r2(land.x), r2(land.y), r2(land.z)] : null, final: [r2(last.x), r2(last.y), r2(last.z)], note: 'target is (19.5,16,-16); player looks -z holding W' };
      } },
    { name: 'pad2', dur: 5,
      start(g) { teleport(g, -25, -4, 17, Math.PI, 0.3); },
      tick(lt, dt, g, R, c) { keys(g, { forward: lt > 0.2 }); c.maxY = Math.max(c.maxY || 0, g.player.position.y); },
      end(g, R, c) { const T = tr(g); const last = T[T.length - 1]; const first = T.findIndex(s => s.vy > 4); const j = first >= 0 ? T[first] : null;
        R.pad2 = { launchVel: j ? [r2(j.vx), r2(j.vy), r2(j.vz)] : null, maxY: r2(c.maxY), final: [r2(last.x), r2(last.y), r2(last.z)] }; } },
    { name: 'rocket_jump_from_ground', dur: 5,
      start(g, R, c) {
        teleport(g, 0, 0, 30, 0, -1.5533);
        g.weapons.giveWeapon('rocket'); c.wait = 0;
        g.player.god = false; g.player.health = 100; g.player.maxHealth = 100;
      },
      tick(lt, dt, g, R, c) {
        const p = g.player; p.god = false; p.health = 100;
        // wait for equip, then fire straight down at feet
        if (g.weapons.currentId === 'rocket' && lt > 1.0) pulse(g, c, 'fire', lt, 1.0);
        if (lt > 1.0) { c.maxY = Math.max(c.maxY || 0, p.position.y); if (p.velocity.y > 6 && !c.v) c.v = [r2(p.velocity.x), r2(p.velocity.y), r2(p.velocity.z), r2(lt)]; }
      },
      end(g, R, c) { R.rocket_jump_ground = { weapon: g.weapons.currentId, launch: c.v, maxY: r2(c.maxY), hp: r2(g.player.health), fired: g.events && null }; } },
    { name: 'rocket_jump_from_jump_apex', dur: 5,
      start(g, R, c) { teleport(g, 0, 0, 30, 0, -1.5533); g.weapons.giveWeapon('rocket'); g.player.god = false; g.player.health = 100; },
      tick(lt, dt, g, R, c) {
        const p = g.player; p.god = false;
        pulse(g, c, 'jump', lt, 1.0);
        if (lt > 1.16) pulse(g, c, 'fire', lt, 1.16);
        if (lt > 1.0) { c.maxY = Math.max(c.maxY || 0, p.position.y); if (p.velocity.y > 9.5 && !c.v && lt > 1.2) c.v = [r2(p.velocity.x), r2(p.velocity.y), r2(p.velocity.z), r2(lt)]; }
      },
      end(g, R, c) { R.rocket_jump_apex = { weapon: g.weapons.currentId, launch: c.v, maxY: r2(c.maxY), hp: r2(g.player.health) }; } },
  ];
} else {
  phases = [
    ...[0.3, 3, 8, 15, 30].map(h => ({
      name: 'land_from_' + h, dur: 3.2,
      start(g) { teleport(g, 0, h, 30, 0, 0); g.player.move.grounded = false; g.player.move.landSuppressUntil = 0; },
      tick(lt, dt, g, R, c) {
        const p = g.player;
        c.minLandY = Math.min(c.minLandY ?? 0, p.rig.landY); c.maxLandY = Math.max(c.maxLandY ?? 0, p.rig.landY);
        c.minPitch = Math.min(c.minPitch ?? 0, g.camera.rotation.x); c.maxLandImpact = Math.max(c.maxLandImpact ?? 0, p.landImpact);
        c.trauma = Math.max(c.trauma ?? 0, p.rig.trauma);
      },
      end(g, R, c) {
        const le = evs(g, 'Land')[0];
        const fr = g.__frames.filter(f => le && f.t >= le.gt - 0.02 && f.t < le.gt + 1.0);
        R['land_from_' + h] = { impact: le ? r2(le.a) : null, dipMin: r3(c.minLandY), overshoot: r3(c.maxLandY), pitchDipDeg: r2(c.minPitch * 180 / Math.PI), landImpact: r2(c.maxLandImpact), trauma: r2(c.trauma),
          recoverT: (() => { const k = fr.findIndex(f => f.t > le.gt + 0.05 && Math.abs(f.landY) < 0.004); return k >= 0 ? r2(fr[k].t - le.gt) : null; })(),
          dipSeries: seriesEvery(fr, 0.05, f => r3(f.landY)).slice(0, 14), speedAfter: r2(hs(g.player)) };
      },
    })),
    // head-bob amplitude: sprint / walk / crouch over 2 s
    ...[['walk', { forward: 1 }], ['sprint', { forward: 1, sprint: 1 }], ['crouch', { forward: 1, crouch: 1 }]].map(([n, k]) => ({
      name: 'bob_' + n, dur: 3.2,
      start(g) { teleport(g, 0, 0, 40, 0); },
      tick(lt, dt, g, R, c) {
        keys(g, lt > 0.2 ? k : {});
        const p = g.player;
        if (lt > 1.2) {
          const y = g.camera.position.y - p.position.y - p.eyeHeight;
          c.ymin = Math.min(c.ymin ?? 9, y); c.ymax = Math.max(c.ymax ?? -9, y);
          const x = (g.camera.position.x - p.position.x);
          c.rmin = Math.min(c.rmin ?? 9, g.camera.rotation.z); c.rmax = Math.max(c.rmax ?? -9, g.camera.rotation.z);
          c.steps0 = c.steps0 ?? p.stepCount; c.stepsN = p.stepCount; c.t1 = lt; c.t0 = c.t0 ?? lt;
        }
      },
      end(g, R, c) {
        R['bob_' + n] = { bobY_cm: r2((c.ymax - c.ymin) * 100), rollDegPP: r2((c.rmax - c.rmin) * 180 / Math.PI), stepsPerSec: r2((c.stepsN - c.steps0) / (c.t1 - c.t0)), speed: r2(hs(g.player)) };
      },
    })),
  ];
}

const S = makeScenario(phases, { setup: g => {
  const e = new URLSearchParams(location.search).get('exp');
  if (e && e.startsWith('land')) { const k = parseFloat(e.slice(4)); const o = g.player.rig.kickLand.bind(g.player.rig); g.player.rig.kickLand = i => o(i * k); }
  if (e === 'padlock') {
    // air control scale 0.3 for the first 75% of a pad flight
    const mv = g.player.move; const oa = mv._airControl.bind(mv);
    mv._airControl = (dt, scale) => { const P = g.player; const since = g.time - P.lastLaunchTime; oa(dt, since < 1.4 ? scale * 0.3 : scale); };
  }
} });
export const setup = S.setup;
export const drive = S.drive;
export const finish = S.finish;
