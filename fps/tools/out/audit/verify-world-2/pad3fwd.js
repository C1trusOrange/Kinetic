// Launch the player from ruins pad #3 with (a) no input, (b) forward held; record landing
const R = { runs: [], tr: [] };
let phase = 0, mode = 0, t0 = 0, launchT = -1, minY = 1e9;
const MODES = ['none', 'forward', 'forward+jump', 'back'];
export function setup(game, report) { game.player.god = true; report.custom = R; }
export function drive(t, dt, game, report) {
  const w = game.world, p = game.player, pad = w.jumpPads[3];
  if (mode >= MODES.length) { report.custom.finished = true; return; }
  const inp = game.input;
  if (phase === 0) {
    inp.clearVirtual();
    p.spawn(pad.position.clone(), 0); p.god = true;
    phase = 1; t0 = game.time; launchT = -1;
    if (MODES[mode].includes('forward')) inp.setVirtual('forward', true);
    if (MODES[mode] === 'back') inp.setVirtual('back', true);
    return;
  }
  if (launchT < 0 && p.lastLaunchTime >= t0 - 1e-6 && p.lastLaunchTime > 0) launchT = p.lastLaunchTime;
  if (launchT >= 0) {
    const air = game.time - launchT;
    if (MODES[mode] === 'forward+jump' && air > 0.3 && air < 0.9) inp.setVirtual('jump', true); else inp.setVirtual('jump', false);
    if (air > 0.2 && air < 2.5 && R.tr.length < 60 && Math.round(air * 20) % 2 === 0) R.tr.push([mode, +air.toFixed(2), ...p.position.toArray().map(v => +v.toFixed(2)), p.controller && p.controller.mantling ? 'M' : '']);
    if ((p.onGround && air > 0.6) || air > 5) {
      R.runs.push({ mode: MODES[mode], land: p.position.toArray().map(v => +v.toFixed(2)), air: +air.toFixed(2) });
      mode++; phase = 0; inp.clearVirtual();
    }
  } else if (game.time - t0 > 1.5) {
    R.runs.push({ mode: MODES[mode], error: 'never launched', pos: p.position.toArray() });
    mode++; phase = 0;
  }
}
