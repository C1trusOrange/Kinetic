// Helpers for multiplayer autotest scenarios (scenario=tools/mp/scenarios/<suite>.js, run by tools/run_mp.py).
// A scenario module exports drive(t, dt, game, report) and optionally setup(game, report) / finish(game, report).

/** 'host' | 'client' | 'offline' */
export function role(game) {
  return game.net ? game.net.role : 'offline';
}

/** Host net time in ms (the host's clock; a client's estimate of it). */
export function hostNow(game) {
  return game.net.clock.hostNowMs();
}

/** Hold / release a virtual input action ('forward', 'jump', 'sprint', 'crouch', 'fire', ...). */
export function hold(game, action, on) {
  game.input.setVirtual(action, !!on);
}

const ACTIONS = ['forward', 'back', 'left', 'right', 'jump', 'crouch', 'sprint', 'fire', 'ads', 'grapple', 'reload', 'melee', 'grenade'];

/** Release every movement / weapon action. */
export function releaseAll(game) {
  for (const a of ACTIONS) game.input.setVirtual(a, false);
}

/** Mouse look in counts (+x turns right, +y looks down). */
export function look(game, dx, dy = 0) {
  game.input.addLook(dx, dy);
}

/** Busy-wait `ms` milliseconds on the main thread (simulates a hitch / frozen tab). */
export function busyLoop(ms) {
  const end = performance.now() + ms;
  let x = 0;
  while (performance.now() < end) x += Math.random();
  return x;
}

/**
 * 20 Hz position log for movement checks: `self` = this machine's own player [hostMs, x, y, z, alive] (the host time
 * at which this machine simulated that state); `seen` = per entity id the positions shown for the other humans
 * [shownHostMs, x, y, z] (the host time the shown state belongs to). tools/mp/checks compare one machine's `seen`
 * with the owner's `self` at the same host time.
 */
export class Tracker {
  constructor(game, hz = 20) {
    this.game = game;
    this.interval = 1000 / hz;
    this.next = 0;
    this.self = [];
    this.seen = {};
    this.spawns = [];
    game.events.on('spawn', e => {
      if (e && e.entity) this.spawns.push([Math.round(hostNow(game)), e.entity.id]);
    });
  }

  sample() {
    const g = this.game, net = g.net;
    if (!net || !net.online || !g.match) return;
    const now = performance.now();
    if (now < this.next) return;
    this.next = now + this.interval;
    // the own position was computed in the previous frame and sent at its end: stamp it with that time (the network
    // stamps it the same way), not with this frame's start
    const t = net.frameHostMs || hostNow(g);
    const p = g.player;
    const r2 = v => Math.round(v * 100) / 100;
    this.self.push([Math.round(t), r2(p.position.x), r2(p.position.y), r2(p.position.z), p.alive ? 1 : 0]);
    for (const e of g.entities) {
      if (e === p || !e.alive) continue;
      const human = e.isRemote || (e.isProxy && e.isHuman);
      if (!human || typeof e.shownT !== 'number' || !e.shownT) continue;
      (this.seen[e.id] || (this.seen[e.id] = [])).push([Math.round(e.shownT), r2(e.position.x), r2(e.position.y), r2(e.position.z)]);
    }
  }

  toReport() {
    return { self: this.self, seen: this.seen, spawns: this.spawns, me: this.game.player.id };
  }
}

const _eye = { x: 0, y: 0, z: 0 };

/** Teleport the local player (feet position [x, y, z], facing yaw); the next states / snapshots flag the jump. */
export function place(game, pos, yaw = 0) {
  const p = game.player;
  p.position.set(pos[0], pos[1], pos[2]);
  p.velocity.set(0, 0, 0);
  p.yaw = yaw;
  p.pitch = 0;
  p.move.place(p.position);
  p.prevPosition.copy(p.position);
  if (game.net && game.net.client) game.net.client._teleportHold = 3;
  else p.teleportHold = 3;
}

/** Turn the local player toward `target`'s chest (part 'head' / 'feet' for the head / the ground at its feet). */
export function aimAt(game, target, part = 'chest') {
  const p = game.player;
  _eye.x = p.position.x;
  _eye.y = p.position.y + p.eyeHeight;
  _eye.z = p.position.z;
  const tx = target.position.x, tz = target.position.z;
  const ty = target.position.y + (part === 'head' ? target.height - 0.22 : part === 'feet' ? 0.1 : target.height * 0.62);
  const dx = tx - _eye.x, dy = ty - _eye.y, dz = tz - _eye.z;
  p.yaw = Math.atan2(-dx, -dz);
  p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
}

/** The other human fighter (online), or null. */
export function otherHuman(game) {
  for (const e of game.entities) if (e !== game.player && e.isHuman) return e;
  return null;
}
