// AutoTest: is drive()/finish() called while an async setup() is still running?
const frames = n => new Promise(res => { let c = 0; const f = () => (++c >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
const S = { setupDone: false, driveBeforeSetup: 0, driveAfterSetup: 0, finishSeenAt: null, startedAtFinish: null };
window.__LC__ = S;

export function drive(t, dt, game, report) {
  if (S.setupDone) S.driveAfterSetup++; else S.driveBeforeSetup++;
}

export async function setup(game, report) {
  await frames(120);     // e.g. a scenario that waits for something before starting to measure
  S.setupDone = true;
}

export function finish(game, report) {
  S.finishSeenAt = { t: report.t, setupDone: S.setupDone, started: report.started };
  report.custom = { setupDoneAtFinish: S.setupDone };
}
