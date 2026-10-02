// Multiplayer movement suite: every human runs a scripted movement loop (sprint, strafe, jumps, crouch slides, turns)
// while each page logs its own track and what it shows of the other humans (tools/mp/lib.js Tracker).
// tools/mp/checks/move.py compares them (host view of each client, client views of the host and of each other).
// Optional ?netstep=<s>&netemTo=<spec>: switch this page's network impairment mid-run (Wi-Fi step test).
import { Tracker, hold, look, role } from '../lib.js';

let tracker = null;
let stepped = false;

export function setup(game, report) {
  tracker = new Tracker(game, 20);
  report.custom = report.custom || {};
}

export function drive(t, dt, game, report) {
  if (!tracker) return;
  tracker.sample();
  const p = game.params;
  if (!stepped && p.get('netstep') && t >= parseFloat(p.get('netstep')) && game.net.netem) {
    stepped = true;
    game.net.netem.setProfile(p.get('netemTo') || 'wifi');
    report.custom.steppedAt = Math.round(game.net.clock.hostNowMs());
  }
  // a 10 s loop, shifted per page so the humans do not move in lockstep
  const shift = role(game) === 'host' ? 0 : (game.net.me.peer % 4) * 1.3;
  const c = (t + shift) % 10;
  const S = (a, b) => c >= a && c < b;
  hold(game, 'forward', S(0.5, 4.5) || S(5.5, 9.2));
  hold(game, 'sprint', S(0.8, 3.0) || S(6.0, 8.0));
  hold(game, 'left', S(4.5, 5.5));
  hold(game, 'right', S(9.2, 9.9));
  hold(game, 'jump', S(1.5, 1.58) || S(3.4, 3.48) || S(7.1, 7.18) || S(7.5, 7.58));
  hold(game, 'crouch', S(2.4, 3.0) || S(8.0, 8.6));
  let lx = 0;
  if (S(4.0, 4.6)) lx = 900;
  if (S(9.0, 9.6)) lx = -700;
  if (S(5.6, 6.0)) lx = 300;
  look(game, lx * dt, 0);
}

export function finish(game, report) {
  report.custom = report.custom || {};
  if (tracker) report.custom.track = tracker.toReport();
}
