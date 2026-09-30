// what does a gesture-less requestLock() do to Input's failure counters?
const inp = game.input;
const out = { start: { fails: inp._lockFailures, unavailable: inp.lockUnavailable, locked: inp.locked } };
const events = [];
document.addEventListener('pointerlockerror', () => events.push('error'));
document.addEventListener('pointerlockchange', () => events.push('change:' + !!document.pointerLockElement));
out.attempts = [];
for (let i = 0; i < 3; i++) {
  inp.requestLock();
  await sleep(800);
  out.attempts.push({ fails: inp._lockFailures, unavailable: inp.lockUnavailable, locked: inp.locked, events: events.splice(0) });
}
return out;
