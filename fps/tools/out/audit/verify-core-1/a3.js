const inp = game.input;
const res = { calls: [] };
let errs = 0;
document.addEventListener('pointerlockerror', () => errs++);
res.inIframe = window.self !== window.top;
for (let i = 0; i < 3; i++) {
  errs = 0;
  const before = inp._lockFailures;
  inp.requestLock();
  await sleep(600);
  res.calls.push({ i, events: errs, failuresBefore: before, failuresAfter: inp._lockFailures, lockUnavailable: inp.lockUnavailable, locked: inp.locked });
}
// single direct call w/o options to compare
errs = 0;
try { const p = game.renderer.domElement.requestPointerLock(); if (p && p.catch) p.catch(e => { res.plainReject = String(e && e.name); }); } catch (e) { res.plainThrow = String(e); }
await sleep(600);
res.plainEvents = errs;
errs = 0;
try { const p = game.renderer.domElement.requestPointerLock({ unadjustedMovement: true }); if (p && p.catch) p.catch(e => { res.unadjReject = String(e && e.name) + ':' + String(e && e.message); }); } catch (e) { res.unadjThrow = String(e); }
await sleep(600);
res.unadjEvents = errs;
return res;
