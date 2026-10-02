// Late join suite: host + C1 play; C2 (?latejoin=12) joins the running match, deploys (auto, 0.5 s) and plays.
// Every page logs what it saw; tools/mp/checks/latejoin.py compares them.
import { hostNow, role } from '../lib.js';

const log = { begin: 0, deployed: 0, spawn: 0, idClash: 0, avatarsMax: 0, rosterAdds: 0, damageBeforeDeploy: 0 };
let hooked = false;

function hook(game) {
  if (hooked) return;
  hooked = true;
  const ev = game.events;
  ev.on('match:start', () => { if (!log.begin) log.begin = Math.round(hostNow(game)); });
  ev.on('spawn', e => { if (e && e.entity === game.player && !log.spawn) log.spawn = Math.round(hostNow(game)); });
  ev.on('damage', e => { if (e && e.target === game.player && !log.spawn) log.damageBeforeDeploy++; });
}

export function setup(game) {
  hook(game);
}

export function frame(game, report, now) {
  hook(game);
  const net = game.net;
  const c = net.client;
  if (c && c.awaitingDeploy === false && c._deploySent && !log.deployed) log.deployed = Math.round(hostNow(game));
  if (c) {
    if (c._deploySent && !log.deploySentAt) log.deploySentAt = Math.round(hostNow(game));
    log.avatarsMax = Math.max(log.avatarsMax, c.avatars.size);
    for (const a of c.avatars.values()) if (a.id === game.player.id) log.idClash++;
  }
  report.custom = {
    ...(report.custom || {}), latejoin: log, role: role(game), me: game.player.id,
    board: game.entities.map(e => [e.id, e.kills | 0, e.deaths | 0]),
  };
  return null;
}
