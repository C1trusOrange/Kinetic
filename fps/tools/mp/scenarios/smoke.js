// Multiplayer lifecycle suite: START -> countdown (one client stalls 300 ms in it) -> live -> the time limit ends the
// match -> host REMATCH -> host ends the rematch for everyone -> BACK TO LOBBY. Every page records what it saw;
// tools/mp/checks/smoke.py compares the pages. Host page params: time=0.5 (minutes) recommended.
//   ?stall=1 on a client: busy-loop 300 ms during the first countdown.
import { busyLoop, hostNow, role } from '../lib.js';

const log = { begins: [], lives: [], ends: [], lobby: [], phases: [] };
let stalled = false;
let endedAt = 0;
let rematchAt = 0;
let lobbyAt = 0;
let matches = 0;
let lastPhase = '';
let lastMatchPhase = '';
let hooked = false;

function hook(game) {
  if (hooked) return;
  hooked = true;
  game.events.on('match:start', m => {
    matches++;
    log.begins.push([game.net.epoch, Math.round(hostNow(game)), game.player.id]);
  });
  game.events.on('match:end', m => {
    const me = (m.results || []).find(r => r.isLocal);
    log.ends.push([game.net.epoch, m.winnerId | 0, me ? me.id : -1, game.player.id, !!m.playerWon, !!m.draw]);
    endedAt = performance.now();
  });
}

export function setup(game) {
  hook(game);
}

export function drive(t, dt, game) {
  // the first countdown: one client stalls its main thread for 300 ms
  const m = game.match;
  if (!stalled && game.params.has('stall') && m && m.phase === 'countdown' && t > 0.5) {
    stalled = true;
    busyLoop(300);
  }
}

export function frame(game, report, now) {
  hook(game);
  const net = game.net, m = game.match;
  if (net.phase !== lastPhase) {
    lastPhase = net.phase;
    log.phases.push([net.phase, Math.round(net.online ? hostNow(game) : 0)]);
    if (net.phase === 'lobby' && matches > 0) log.lobby.push(Math.round(hostNow(game)));
  }
  const mp = m ? m.phase : '';
  if (mp !== lastMatchPhase) {
    lastMatchPhase = mp;
    if (mp === 'live') log.lives.push([net.epoch, Math.round(hostNow(game))]);
  }
  if (role(game) === 'host') {
    // after the first match's end screen: rematch; 8 s into the rematch: end it; 2 s later: everyone to the lobby
    if (matches === 1 && endedAt && !rematchAt && now - endedAt > 4500) {
      rematchAt = now;
      net.rematch();
    }
    if (matches === 2 && m && m.phase === 'live' && !m.over && log.lives.length >= 2 && now - rematchAt > 8000) net.endMatchForAll();
    if (matches === 2 && m && m.over && !lobbyAt && endedAt && now - endedAt > 2000) {
      lobbyAt = now;
      net.toLobby();
    }
  }
  // done once back in the lobby after the second match (clients follow the host's lobby message)
  if (matches >= 2 && net.phase === 'lobby' && log.lobby.length) {
    report.custom = { ...(report.custom || {}), smoke: log, epoch: net.epoch };
    return 'done';
  }
  return 'wait';
}

export function finish(game, report) {
  report.custom = { ...(report.custom || {}), smoke: log, epoch: game.net.epoch };
}
