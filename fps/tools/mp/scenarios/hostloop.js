// Host loop suite: the host keeps the match running while its window is minimized (run_mp --hide), a 400 ms host
// hitch neither speeds the game up afterwards nor bursts frames, and a client frozen for 2 s is not dropped.
//   host page:   ?busy=<s>  busy-loop 400 ms at that many seconds after the match start (default 25)
//   client page: ?busy=<s>  busy-loop 2000 ms (default 32)
// Logs per frame window (20 Hz otherwise): [hostMs, gameTime, hidden, frame, snapsIn, interpDelayMs, botDistance]
import { busyLoop, hostNow, role } from '../lib.js';

const log = { s: [], busy: null, after: [] };
let t0 = 0;
let lastSample = 0;
let botDist = 0;
const lastBotPos = new Map();
let busyDone = false;
let watchUntil = 0;

function sample(game, now) {
  const net = game.net;
  const c = net.client;
  log.s.push([
    Math.round(hostNow(game)), +game.time.toFixed(3), document.hidden ? 1 : 0, game.frame,
    c ? net.stats.snaps.in : 0, c ? +c.interpDelayMs.toFixed(1) : 0, +botDist.toFixed(2),
    c ? +c._lag.spread(now).toFixed(1) : (net.host ? [...net.host.peers.values()].map(r => r.snapHz).join(',') : ''),
    net.host ? net.host.stats.snapsOut : 0, Math.round(performance.now()),
  ]);
}

export function frame(game, report, now) {
  const net = game.net;
  if (!game.match || !net.online) return null;
  if (!t0) t0 = now;
  const t = (now - t0) / 1000;
  // bot travel (host: real bots; a client: their avatars)
  for (const e of game.entities) {
    if (!e.isBot || !e.alive) { lastBotPos.delete(e); continue; }
    const p = lastBotPos.get(e);
    if (p) {
      const d = Math.hypot(e.position.x - p.x, e.position.z - p.z);
      if (d < 5) botDist += d;
      p.copy(e.position);
    } else lastBotPos.set(e, e.position.clone());
  }
  if (now - lastSample >= 50 || document.hidden) {
    lastSample = now;
    sample(game, now);
  }
  if (watchUntil && now <= watchUntil) log.after.push([+(now - log.busy.endPerf).toFixed(2), game.frame, +game.time.toFixed(4)]);
  const host = role(game) === 'host';
  const busyAt = parseFloat(game.params.get('busy') || (host ? '25' : '32'));
  if (!busyDone && t >= busyAt) {
    busyDone = true;
    const ms = host ? 400 : 2000;
    const g0 = game.time, f0 = game.frame, p0 = performance.now();
    busyLoop(ms);
    log.busy = { ms, gameTime: g0, frame: f0, startPerf: p0, endPerf: performance.now(), hostMs: Math.round(hostNow(game)) };
    watchUntil = performance.now() + 300;
  }
  if (t >= 45) {
    report.custom = { ...(report.custom || {}), hostloop: log, role: role(game) };
    return 'done';
  }
  return null;
}

export function finish(game, report) {
  report.custom = { ...(report.custom || {}), hostloop: log, role: role(game) };
  if (game.net && game.net.host) {
    report.custom.softDrops = [...game.net.host.remotes.values()].filter(rp => rp.softDropped).length;
    report.custom.softDropWarned = !!game.net.host._everSoftDropped;
  }
}
