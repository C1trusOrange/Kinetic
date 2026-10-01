// Session suite: a client with another build is refused ('build'), and a client whose link freezes for 4 s
// (net.debugFreeze: no packets in or out) is held out of play by the host after 2.5 s - no death, avatar hidden on
// the other pages - and restored as soon as it reports again.
//   client page ?freeze=<s>: freeze 4000 ms at that many seconds after the match start
import { hostNow, role } from '../lib.js';

const log = { freeze: null, drops: [], restores: [], seenHidden: [], seenVisible: [] };
let t0 = 0;
let frozen = false;
const vis = new Map();
const dropped = new Map();

export function frame(game, report, now) {
  const net = game.net;
  if (!game.match || !net.online) return null;
  if (!t0) t0 = now;
  const t = (now - t0) / 1000;
  const fz = game.params.get('freeze');
  if (fz && !frozen && t >= parseFloat(fz)) {
    frozen = true;
    log.freeze = { at: Math.round(hostNow(game)), ms: 4000 };
    net.debugFreeze(4000);
  }
  if (net.host) {
    for (const rp of net.host.remotes.values()) {
      const was = dropped.get(rp.id) || false;
      if (rp.softDropped !== was) {
        dropped.set(rp.id, rp.softDropped);
        (rp.softDropped ? log.drops : log.restores).push([rp.id, Math.round(hostNow(game)), rp.deaths]);
      }
    }
  }
  if (net.client) {
    for (const a of net.client.avatars.values()) {
      if (!a.isHuman || a.netHost) continue;
      const v = a.avatar.visible;
      if (vis.has(a.id) && vis.get(a.id) !== v) (v ? log.seenVisible : log.seenHidden).push([a.id, Math.round(hostNow(game))]);
      vis.set(a.id, v);
    }
  }
  if (t >= 22) {
    report.custom = { ...(report.custom || {}), session: log, role: role(game), entityId: game.player.id };
    return 'done';
  }
  return null;
}

export function finish(game, report) {
  report.custom = { ...(report.custom || {}), session: log, role: role(game), entityId: game.player.id };
  if (game.net && game.net.host) {
    report.custom.remoteDeaths = [...game.net.host.remotes.values()].map(rp => [rp.id, rp.deaths]);
  }
}
