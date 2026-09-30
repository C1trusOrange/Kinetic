// Ground movement, jumps, slide, curbs, crouch under a ceiling.
import { teleport, keys, makeScenario, r2, hs } from './common.js';

const P0 = [2, 0, 50];
let pulse = 0;
function press(game, action, frames = 3) { pulse = frames; game.input.setVirtual(action, true); }

const phases = [
  { name: 'jump', dur: 2.2,
    start(g, R, c) { teleport(g, ...P0); c.y0 = g.player.position.y; c.max = 0; },
    tick(lt, dt, g, R, c) {
      keys(g, { jump: lt > 0.3 && lt < 0.36 });
      c.max = Math.max(c.max, g.player.position.y - c.y0);
    },
    end(g, R, c) { R.jump_height = r2(c.max); } },

  { name: 'doublejump', dur: 2.6,
    start(g, R, c) { teleport(g, ...P0); c.y0 = g.player.position.y; c.max = 0; c.n = 0; c.dj = false; },
    tick(lt, dt, g, R, c) {
      const p = g.player;
      let j = lt > 0.3 && lt < 0.36;
      if (lt > 0.4 && p.velocity.y <= 0 && !c.dj) { c.dj = true; c.djFrames = 3; c.djY = p.position.y - c.y0; }
      if (c.djFrames > 0) { j = true; c.djFrames--; }
      keys(g, { jump: j });
      c.max = Math.max(c.max, p.position.y - c.y0);
    },
    end(g, R, c) { R.double_jump_total_height = r2(c.max); R.double_jump_first_apex = r2(c.djY || 0); } },

  { name: 'sprint_and_stop', dur: 5,
    start(g, R, c) { teleport(g, ...P0); c.max = 0; c.t90 = null; c.stopT = null; c.rel = null; },
    tick(lt, dt, g, R, c) {
      const p = g.player, s = hs(p);
      const go = lt > 0.2 && lt < 2.6;
      keys(g, { forward: go, sprint: go });
      c.max = Math.max(c.max, s);
      if (c.t90 === null && s >= 0.9 * 9.6) c.t90 = lt - 0.2;
      if (lt >= 2.6 && !c.rel) c.rel = { z: p.position.z, s };
      if (c.rel && c.stopT === null && s < 0.2) { c.stopT = lt - 2.6; c.stopDist = Math.abs(p.position.z - c.rel.z); }
    },
    end(g, R, c) { R.sprint_max = r2(c.max); R.sprint_time_to_90pct = r2(c.t90 ?? -1); R.stop_time = r2(c.stopT ?? -1); R.stop_dist = r2(c.stopDist ?? -1); } },

  { name: 'walk', dur: 2.2,
    start(g, R, c) { teleport(g, ...P0); c.max = 0; },
    tick(lt, dt, g, R, c) { keys(g, { forward: lt > 0.1 }); c.max = Math.max(c.max, hs(g.player)); },
    end(g, R, c) { R.walk_speed = r2(c.max); } },

  { name: 'crouchwalk', dur: 2.2,
    start(g, R, c) { teleport(g, ...P0); c.max = 0; },
    tick(lt, dt, g, R, c) { keys(g, { forward: lt > 0.1, crouch: lt > 0.1 }); c.max = Math.max(c.max, hs(g.player)); },
    end(g, R, c) { R.crouch_speed = r2(c.max); } },

  { name: 'slide', dur: 4.5,
    start(g, R, c) { teleport(g, ...P0); c.max = 0; c.sliding = false; c.dist = 0; c.dur = 0; },
    tick(lt, dt, g, R, c) {
      const p = g.player, s = hs(p);
      keys(g, { forward: lt > 0.1 && lt < 2.6, sprint: lt > 0.1 && lt < 1.6, crouch: lt > 1.6 && lt < 3.6 });
      if (p.isSliding) {
        if (!c.sliding) { c.sliding = true; c.startSpeed = s; c.p0 = p.position.clone(); c.max = s; }
        c.max = Math.max(c.max, s); c.dur += dt;
      } else if (c.sliding && !c.done) { c.done = true; c.endSpeed = s; c.dist = p.position.distanceTo(c.p0); }
    },
    end(g, R, c) { R.slide_entry_speed = r2(c.startSpeed ?? -1); R.slide_peak_speed = r2(c.max); R.slide_duration = r2(c.dur); R.slide_distance = r2(c.dist); R.slide_end_speed = r2(c.endSpeed ?? -1); } },

  { name: 'slidehop', dur: 6,
    start(g, R, c) { teleport(g, ...P0); c.hops = []; c.air = false; },
    tick(lt, dt, g, R, c) {
      const p = g.player, s = hs(p);
      const sprintOn = lt > 0.1;
      // slide at 1.6, jump at 2.2 (mid-slide), press crouch again 0.1 s before landing
      let jump = lt > 2.2 && lt < 2.26;
      let crouch = (lt > 1.6 && lt < 2.2) || (lt > 3.0 && lt < 4.4);
      keys(g, { forward: lt > 0.1 && lt < 5, sprint: sprintOn, crouch, jump });
      if (lt > 2.2 && !c.jumped) { c.jumped = true; c.jumpSpeed = s; c.before = c.lastS; }
      if (c.jumped && !c.landed && p.onGround && lt > 2.4) { c.landed = true; c.landSpeed = s; c.landT = lt; }
      if (p.isSliding && lt > 3) { c.secondSlide = true; c.secondSlideSpeed = Math.max(c.secondSlideSpeed || 0, s); }
      c.lastS = s;
    },
    end(g, R, c) { R.slidehop = { speedBeforeJump: r2(c.before ?? -1), speedAtJump: r2(c.jumpSpeed ?? -1), landSpeed: r2(c.landSpeed ?? -1), landedAt: r2(c.landT ?? -1), secondSlide: !!c.secondSlide, secondSlidePeak: r2(c.secondSlideSpeed || 0) }; } },

  { name: 'curbs', dur: 6,
    start(g, R, c) { teleport(g, -36, 0, 25, -Math.PI / 2); c.minS = 99; c.maxY = 0; c.stuck = 0; },
    tick(lt, dt, g, R, c) {
      const p = g.player, s = hs(p);
      keys(g, { forward: lt > 0.1 });
      if (lt > 1.0) c.minS = Math.min(c.minS, s);
      c.maxY = Math.max(c.maxY, p.position.y);
      c.x = p.position.x;
    },
    end(g, R, c) { R.curbs = { finalX: r2(c.x), minSpeedWhileCrossing: r2(c.minS), maxFeetY: r2(c.maxY), crossedAll: c.x > -18 }; } },

  { name: 'curbs_sprint', dur: 4,
    start(g, R, c) { teleport(g, -36, 0, 25, -Math.PI / 2); c.minS = 99; },
    tick(lt, dt, g, R, c) {
      keys(g, { forward: lt > 0.1, sprint: lt > 0.1 });
      if (lt > 1.0) c.minS = Math.min(c.minS, hs(g.player));
      c.x = g.player.position.x;
    },
    end(g, R, c) { R.curbs_sprint = { finalX: r2(c.x), minSpeed: r2(c.minS), crossedAll: c.x > -18 }; } },

  { name: 'ceiling', dur: 8,
    start(g, R, c) { teleport(g, 28, 0, -16, 0); c.blockedWhileInside = false; c.stood = null; },
    tick(lt, dt, g, R, c) {
      const p = g.player;
      // crouch-walk under the slab (z -22..-30), release crouch while inside
      keys(g, { forward: lt > 0.1, crouch: lt < 2.2 });
      const inside = p.position.z < -23 && p.position.z > -29;
      if (inside && lt > 2.4 && p.isCrouching) c.blockedWhileInside = true;
      if (p.position.z < -33 && c.stood === null) c.tExit = lt;
      if (c.tExit && lt > c.tExit + 0.6 && c.stood === null) c.stood = !p.isCrouching;
    },
    end(g, R, c) { R.ceiling = { staysCrouchedUnderSlab: c.blockedWhileInside, standsAfterExit: c.stood }; } },
];

const S = makeScenario(phases);
export const setup = S.setup;
export const drive = S.drive;
export const finish = S.finish;
export const TOTAL = S.total;
