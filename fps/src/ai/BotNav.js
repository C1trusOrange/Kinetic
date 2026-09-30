import * as THREE from 'three';
import { GRAVITY } from '../core/constants.js';

const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);

/**
 * Cheap movement probe used for wall / step / ledge awareness.
 * Casts a knee-height and a chest-height ray along (dx, dz) and one ray down at the look-ahead point.
 * @param {object} collision CollisionWorld
 * @param {THREE.Vector3} pos feet position
 * @param {number} dx unit direction x
 * @param {number} dz unit direction z
 * @param {number} dist look-ahead distance
 * @param {{wall:boolean, step:boolean, ledge:boolean, wallDist:number, drop:number}} out reused result
 * @param {boolean} [checkLedge=true]
 */
export function probeMove(collision, pos, dx, dz, dist, out, checkLedge = true) {
  _d.set(dx, 0, dz);
  out.wall = false;
  out.step = false;
  out.ledge = false;
  out.wallDist = dist;
  out.drop = 0;
  _o.set(pos.x, pos.y + 0.32, pos.z);
  const k = collision.raycast(_o, _d, dist);
  _o.y = pos.y + 1.25;
  const c = collision.raycast(_o, _d, dist);
  const kneeHit = k && Math.abs(k.normal.y) < 0.7;
  const chestHit = c && Math.abs(c.normal.y) < 0.7;
  if (chestHit) {
    out.wall = true;
    out.wallDist = c.distance;
  } else if (kneeHit) {
    // low obstacle: jumpable when it is close and nothing blocks at chest height
    out.step = k.distance < 1.15;
    if (!out.step) out.wallDist = k.distance;
  }
  if (checkLedge && !out.wall) {
    const ahead = Math.min(dist, 1.3);
    _o.set(pos.x + dx * ahead, pos.y + 0.6, pos.z + dz * ahead);
    const g = collision.raycast(_o, DOWN, 0.6 + 3.2);
    if (!g || g.normal.y < 0.5) {
      out.ledge = true;
      out.drop = 99;
    } else {
      out.drop = Math.max(0, g.distance - 0.6);
      if (out.drop > 1.6) out.ledge = true;
    }
  }
  return out;
}

/**
 * True when there is no safe ground (walkable within 1.6 m below) at `dist` meters ahead along (dx, dz).
 * One downward ray.
 */
export function ledgeAhead(collision, pos, dx, dz, dist) {
  _o.set(pos.x + dx * dist, pos.y + 0.6, pos.z + dz * dist);
  const g = collision.raycast(_o, DOWN, 0.6 + 3.2);
  return !g || g.normal.y < 0.5 || g.distance - 0.6 > 1.6;
}

/** Ground height under (x, z) searching from `y` + 0.6 downwards; NaN when there is no walkable ground within 1.4 m. */
function groundY(collision, x, y, z) {
  _o.set(x, y + 0.6, z);
  const g = collision.raycast(_o, DOWN, 2.0);
  return g && g.normal.y >= 0.5 ? g.point.y : NaN;
}

const EDGE_DIRS = [];
for (let k = 0; k < 8; k++) EDGE_DIRS.push([Math.cos((k * Math.PI) / 4), Math.sin((k * Math.PI) / 4)]);

/**
 * The nav graph puts nodes on cell centres, which on narrow ramps / catwalks / platform rims can be closer to the
 * unsupported edge than the capsule radius. Nudge 'walk' waypoints away from nearby drops so the bot (radius 0.4)
 * keeps a margin. Replaces moved waypoints with clones (keeps `type` / `pad`); never moves drop / jump / pad / last
 * points (a nudged jump waypoint changes height and turns the jump into a steep, invalidated waypoint).
 * @param {object} collision CollisionWorld
 * @param {THREE.Vector3[]} path waypoints (modified in place)
 * @param {number} [margin=0.6] wanted distance to an unsupported edge
 */
export function pullFromEdges(collision, path, margin = 0.6) {
  for (let i = 0; i < path.length - 1; i++) {
    const w = path[i];
    if (w.type === 'drop' || w.type === 'jump' || w.pad) continue;
    let px = w.x, pz = w.z, py = w.y, moved = false;
    for (let iter = 0; iter < 3; iter++) {
      let ax = 0, az = 0, hit = false;
      // the four axis directions first; the diagonals only when an edge is near (most waypoints are in the open)
      for (let pass = 0; pass < 2 && (pass === 0 || hit); pass++) {
        for (let k = pass; k < 8; k += 2) {
          const d = EDGE_DIRS[k];
          const gy = groundY(collision, px + d[0] * margin, py, pz + d[1] * margin);
          if (gy !== gy || gy < py - 0.9) { ax -= d[0]; az -= d[1]; hit = true; }
        }
      }
      const l = Math.hypot(ax, az);
      if (l < 0.01) break;
      const nx = px + (ax / l) * 0.2, nz = pz + (az / l) * 0.2;
      const gy = groundY(collision, nx, py, nz);
      if (gy !== gy || Math.abs(gy - py) > 0.5) break;
      px = nx; pz = nz; py = gy; moved = true;
    }
    if (moved) {
      const c = new THREE.Vector3(px, py, pz);
      c.type = w.type;
      path[i] = c;
    }
  }
  return path;
}

const RIDE_MAX = 5;        // s: longest jump-pad ride that is still followed as a ride
const AIR_REPLAN_AFTER = 4; // s of continuous flight after which a path request is allowed again
const JUMP_STEEP = 1.6;    // a jump waypoint may be this far above the bot before it counts as off-route
const STEER_ANGLES = [0, 0.55, -0.55, 1.1, -1.1, 1.7, -1.7, 2.4, -2.4, Math.PI];

/**
 * Per-bot navigation helper: follows nav-graph paths (waypoint reaching, smooth cornering, jump links,
 * repathing under a shared per-frame budget) and falls back to direct steering with obstacle probing
 * when there is no path.
 */
export class BotNav {
  /** @param {object} bot the owning Bot */
  constructor(bot) {
    this.bot = bot;
    this.game = bot.game;
    this.goal = new THREE.Vector3();
    this.hasGoal = false;
    this.radius = 1.2;
    /** @type {THREE.Vector3[]|null} */
    this.path = null;
    this.index = 0;
    this.mode = 'idle'; // 'idle' | 'path' | 'direct'
    this.dirty = false;
    this.nextPathAt = 0;
    /** True when the last path request could not get within reach of the goal (no path, or it ends far from it). */
    this.unreachable = false;
    /** True when the last path started behind a wall (no visible node near the bot): following it pushes into the wall. */
    this.startBlocked = false;
    // outputs
    this.dirX = 0;
    this.dirZ = 0;
    this.jump = false;
    this.arrived = false;
    // steering state
    this._probe = { wall: false, step: false, ledge: false, wallDist: 0, drop: 0 };
    this._sx = 0;
    this._sz = 0;
    this._sgx = 0;
    this._sgz = 0;
    this._sJump = false;
    this._steerUntil = 0;
    this._side = 0;
    this._sideUntil = 0;
    // jump-pad ride / airborne state
    this._ride = false;
    this._rideSeen = -999;
    this._airSince = -1;
  }

  /** Forget the goal and path. */
  clear() {
    this.hasGoal = false;
    this.path = null;
    this.index = 0;
    this.mode = 'idle';
    this.dirty = false;
    this.arrived = false;
    this.dirX = 0;
    this.dirZ = 0;
    this.jump = false;
    this._steerUntil = 0;
    this._ride = false;
  }

  /**
   * Set (or move) the goal. The path is recomputed when the goal moved more than `repathDist`.
   * @param {THREE.Vector3} pos feet position
   * @param {number} [radius=1.2] arrival radius
   * @param {number} [repathDist=2.5]
   */
  setGoal(pos, radius = 1.2, repathDist = 2.5) {
    this.radius = radius;
    if (!this.hasGoal) {
      this.hasGoal = true;
      this.unreachable = false;
      this.goal.copy(pos);
      this.dirty = true;
      this.path = null;
      this.mode = 'idle';
      this.nextPathAt = Math.min(this.nextPathAt, this.game.time);
      return;
    }
    if (this.goal.distanceToSquared(pos) > repathDist * repathDist) {
      this.dirty = true;
      // the last request's verdict belonged to the previous goal: do not let callers act on it for the new one
      this.unreachable = false;
    }
    this.goal.copy(pos);
  }

  /** Drop the current path (stuck / knocked off course); a new one is requested next update. */
  invalidate() {
    this.dirty = true;
    this.path = null;
    this.mode = 'idle';
    this._ride = false;
    this.nextPathAt = Math.min(this.nextPathAt, this.game.time + 0.15);
  }

  /** True while the bot is deliberately heading down a drop link (walking off a ledge is intended). */
  allowsDrop() {
    if (this.mode !== 'path' || !this.path || this.index >= this.path.length) return false;
    const w = this.path[this.index];
    return w.type === 'drop' || w.y < this.bot.position.y - 0.4;
  }

  /** Compute this frame's move direction (dirX, dirZ), jump request and arrival flag. */
  update(/* dt */) {
    this.jump = false;
    this.dirX = 0;
    this.dirZ = 0;
    if (!this.hasGoal) return;
    const game = this.game;
    const t = game.time;
    const bot = this.bot;
    const pos = bot.position;
    const gx = this.goal.x - pos.x, gz = this.goal.z - pos.z;
    const gd = Math.hypot(gx, gz);
    if (gd < this.radius && Math.abs(this.goal.y - pos.y) < 2.4) {
      this.arrived = true;
      return;
    }
    this.arrived = false;

    // While airborne (jump pad, knock-up, long drop) the graph cannot place the bot: a request would fail, flag the
    // goal unreachable and start a route back to where the bot came from. Keep `dirty` and ask again after landing.
    if (bot.onGround) this._airSince = -1;
    else if (this._airSince < 0) this._airSince = t;
    const flying = this._airSince >= 0 && t - this._airSince < AIR_REPLAN_AFTER;

    if (!flying && (this.dirty || (this.mode === 'direct' && (gd > 3.5 || Math.abs(this.goal.y - pos.y) > 2.4)) || this.mode === 'idle') && t >= this.nextPathAt) {
      this._requestPath();
    }

    if (this.mode === 'path' && this.path) {
      if (this._followPath(pos, gx, gz, gd)) return;
    }
    if (flying) return; // nothing to follow in the air: keep momentum (ground probes mean nothing up here)
    this._direct(pos, gx, gz, gd);
  }

  _requestPath() {
    const game = this.game;
    const t = game.time;
    if (!game.bots.consumePathBudget()) return; // try again next frame
    const nav = game.world.nav;
    const t0 = performance.now();
    let p = null;
    let connected = true;
    if (nav && typeof nav.isConnected === 'function') {
      // cheap strong-component test: an A* that cannot succeed would exhaust the whole reachable area
      try {
        connected = nav.isConnected(this.bot.position, this.goal);
      } catch (err) {
        connected = true;
      }
    }
    if (connected && nav && typeof nav.findPath === 'function') {
      try {
        p = nav.findPath(this.bot.position, this.goal);
      } catch (err) {
        console.error('[bot] nav.findPath threw', err);
        p = null;
      }
    }
    this.dirty = false;
    let ends = false;
    if (p && p.length > 0) {
      const last = p[p.length - 1];
      const g = this.goal;
      ends = Math.hypot(last.x - g.x, last.z - g.z) < 3.5 && Math.abs(last.y - g.y) < 2.6;
    }
    this.unreachable = !ends;
    this.startBlocked = !!(p && p.startBlocked);
    if (p && p.length > 0) {
      pullFromEdges(game.world.collision, p);
      this.path = p;
      this.index = 0;
      this._ride = false;
      this.mode = 'path';
      this.nextPathAt = t + 0.45;
    } else {
      this.path = null;
      this.mode = 'direct';
      this.nextPathAt = t + (p ? 0.6 : 1.4);
    }
    game.bots.reportPathTime(performance.now() - t0);
  }

  /** @returns {boolean} true when it produced a direction */
  _followPath(pos, gx, gz, gd) {
    const path = this.path;
    const bot = this.bot;
    if (bot.lastLaunchTime !== this._rideSeen) {
      this._rideSeen = bot.lastLaunchTime;
      this._beginRide(pos);
    }
    if (this._ride) {
      const t = this.game.time - bot.lastLaunchTime;
      if ((bot.onGround && t > 0.2) || t > RIDE_MAX) this._ride = false;
      else return this._steerRide(pos, path[this.index]);
    }
    // in the air (knock-up, drop link) the route cannot be judged from where the bot is: no off-route checks
    const airborne = !bot.onGround;
    let wp = null, dx = 0, dz = 0, d = 0, dy = 0;
    while (this.index < path.length) {
      wp = path[this.index];
      dx = wp.x - pos.x;
      dz = wp.z - pos.z;
      d = Math.hypot(dx, dz);
      dy = wp.y - pos.y;
      const last = this.index === path.length - 1;
      const reach = last ? Math.max(0.55, this.radius * 0.5) : 0.65;
      if (d < reach && dy < 1.3) {
        this.index++;
        continue;
      }
      // a waypoint far above and steeper than any ramp cannot be walked to from here. Right at the start of a
      // path that means it began at a neighbouring ledge node (skip it); later it means we fell off the route
      // (ramp / catwalk edge, knockback): drop the path and plan again from where we actually are
      if (dy > (wp.type === 'jump' && !wp.pad ? JUMP_STEEP : 1.3) && dy > d * 0.75 && !airborne) {
        if (this.index <= 1 && this.index < path.length - 1) {
          this.index++;
          continue;
        }
        this.invalidate();
        return false;
      }
      // waypoint behind us while the next one is clearly closer: skip (corner cutting)
      if (!last && d < 2.2 && dy < 0.5 && dy > -0.8) {
        const n = path[this.index + 1];
        const nd = Math.hypot(n.x - pos.x, n.z - pos.z);
        if (nd < d * 0.7 && Math.abs(n.y - pos.y) < 0.6) {
          this.index++;
          continue;
        }
      }
      break;
    }
    if (this.index >= path.length) {
      // path exhausted (it ends near the goal): walk the last stretch directly
      this.path = null;
      this.mode = 'direct';
      this.nextPathAt = Math.max(this.nextPathAt, this.game.time + 0.8);
      return false;
    }
    if (!airborne && (d > 14 || (Math.abs(dy) > 4 && d < 3))) {
      // blown off the path (knockback, fall)
      this.dirty = true;
    }
    if (d < 0.2) {
      this.jump = false;
      return true; // hold momentum over the waypoint (drops)
    }
    let ux = dx / d, uz = dz / d;
    // smooth cornering: blend toward the next segment when close and at similar height
    if (d < 1.6 && this.index + 1 < path.length && dy < 0.35 && dy > -0.6) {
      const n = path[this.index + 1];
      if (Math.abs(n.y - wp.y) < 0.5) {
        const nx = n.x - wp.x, nz = n.z - wp.z;
        const nl = Math.hypot(nx, nz);
        if (nl > 0.05) {
          const w = (1 - d / 1.6) * 0.65;
          ux = ux * (1 - w) + (nx / nl) * w;
          uz = uz * (1 - w) + (nz / nl) * w;
          const l = Math.hypot(ux, uz) || 1;
          ux /= l; uz /= l;
        }
      }
    }
    this.dirX = ux;
    this.dirZ = uz;
    // Jump only where the graph says so (jump links), or when a step / low wall physically blocks a walk link.
    // Ramps and stairs are walked (jumping on a ramp launches the bot off its side). Jump pads launch by themselves.
    if (dy > 0.3 && this.bot.onGround && !wp.pad) {
      const isJump = wp.type === 'jump';
      if (d < (isJump ? 2.4 : 1.4)) {
        const p = probeMove(this.game.world.collision, pos, ux, uz, 1.0, this._probe, false);
        if (p.step || p.wall || (isJump && d < 1.0)) this.jump = true;
      }
    }
    return true;
  }

  /**
   * Called when the bot was just launched (jump pad). When the path's next pad waypoint is the landing of that pad,
   * the follower switches to ride mode: hold the landing waypoint and fly there instead of replanning mid-air.
   */
  _beginRide(pos) {
    const path = this.path;
    if (!path || this.game.time - this.bot.lastLaunchTime > 0.5) return;
    for (let j = this.index; j < path.length && j <= this.index + 2; j++) {
      const w = path[j];
      if (!w.pad) continue;
      if (j > 0) {
        const from = path[j - 1]; // the pad's own node
        if (Math.hypot(from.x - pos.x, from.z - pos.z) > 3) return;
      }
      this.index = j;
      this._ride = true;
      return;
    }
  }

  /**
   * Airborne steering during a pad ride: the launch arc already ends on the landing spot, so only correct the
   * predicted landing point when it is clearly off (bang-bang on the prediction, no braking against the launch).
   * @returns {boolean} true (always produces a direction, possibly zero)
   */
  _steerRide(pos, wp) {
    const v = this.bot.velocity;
    // time until the feet come back down to the landing height
    const disc = v.y * v.y + 2 * GRAVITY * (pos.y - wp.y);
    const tl = disc >= 0 ? (v.y + Math.sqrt(disc)) / GRAVITY : Math.max(0.3, v.y / GRAVITY);
    const ex = wp.x - (pos.x + v.x * tl);
    const ez = wp.z - (pos.z + v.z * tl);
    const e = Math.hypot(ex, ez);
    this.jump = false;
    if (e > 0.8) {
      this.dirX = ex / e;
      this.dirZ = ez / e;
    } else {
      this.dirX = 0;
      this.dirZ = 0;
    }
    return true;
  }

  _direct(pos, gx, gz, gd) {
    const ux = gx / (gd || 1), uz = gz / (gd || 1);
    const t = this.game.time;
    if (t < this._steerUntil && ux * this._sgx + uz * this._sgz > 0.94) {
      this.dirX = this._sx;
      this.dirZ = this._sz;
      this.jump = this._sJump && this.bot.onGround;
      return;
    }
    const col = this.game.world.collision;
    const probe = this._probe;
    const lookAhead = 2.0;
    // order candidate angles so the previously chosen side is tried first (prevents dithering)
    const side = t < this._sideUntil ? this._side : 0;
    let bestScore = -1e9, bx = ux, bz = uz, bJump = false, bAngle = 0;
    for (let i = 0; i < STEER_ANGLES.length; i++) {
      let a = STEER_ANGLES[i];
      if (side < 0 && a !== 0 && a !== Math.PI) a = -a;
      const c = Math.cos(a), s = Math.sin(a);
      const cx = ux * c - uz * s, cz = ux * s + uz * c;
      probeMove(col, pos, cx, cz, lookAhead, probe);
      let score = 100 - Math.abs(a) * 8;
      if (probe.wall) score -= 120 - probe.wallDist * 20;
      if (probe.ledge) score -= 90;
      if (score > bestScore) {
        bestScore = score; bx = cx; bz = cz; bJump = probe.step; bAngle = a;
      }
      if (score >= 90) break; // clean direction found
    }
    if (bAngle !== 0 && bAngle !== Math.PI) {
      this._side = bAngle > 0 ? 1 : -1;
      this._sideUntil = t + 1.2;
    }
    this._sx = bx; this._sz = bz; this._sgx = ux; this._sgz = uz; this._sJump = bJump;
    this._steerUntil = t + 0.22;
    this.dirX = bx;
    this.dirZ = bz;
    this.jump = bJump && this.bot.onGround;
  }
}
