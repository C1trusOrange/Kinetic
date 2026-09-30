// large-but-legitimate coalesced mousemove deltas are discarded entirely by the >700 spurious-delta filter
const inp = game.input;
inp.lockUnavailable = true;   // mouseActive() path without real pointer lock (headless)
inp.capture = true; inp.enabled = true;
inp.consumeLook();
const out = {};
for (const dx of [300, 600, 699, 701, 900, 1500]) {
  window.dispatchEvent(new MouseEvent('mousemove', { movementX: dx, movementY: 0 }));
  out['dx' + dx] = inp.consumeLook().x;
}
// same physical flick delivered as two events (finer sampling) is kept
window.dispatchEvent(new MouseEvent('mousemove', { movementX: 450, movementY: 0 }));
window.dispatchEvent(new MouseEvent('mousemove', { movementX: 450, movementY: 0 }));
out.twoEvents450 = inp.consumeLook().x;
// what flick speed is that? counts per frame for typical DPI at 60 fps
out.speedMetersPerSecAt700CountsPerFrame = {};
for (const dpi of [800, 1600, 3200]) out.speedMetersPerSecAt700CountsPerFrame[dpi + 'dpi@60fps'] = +(700 * 60 / dpi * 0.0254).toFixed(2);
for (const dpi of [800, 1600, 3200]) out.speedMetersPerSecAt700CountsPerFrame[dpi + 'dpi@30fps'] = +(700 * 30 / dpi * 0.0254).toFixed(2);
inp.lockUnavailable = false; inp.capture = false;
return out;
