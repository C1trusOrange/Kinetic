let last = 0, total = 0, n = 0, drops = 0, t0 = 0, frames = 0, maxFrame = 0, sumFrame = 0;
const samples = [];
export function setup() { last = performance.memory.usedJSHeapSize; t0 = performance.now(); }
export function drive(t, dt, game, report) {
  const now = performance.now();
  const m = performance.memory.usedJSHeapSize;
  const d = m - last;
  if (d >= 0) total += d; else drops++;
  last = m;
  frames++;
  if (frames > 30) { const f = now - (drive._p || now); if (f > maxFrame) maxFrame = f; sumFrame += f; }
  drive._p = now;
}
export function finish(game, report) {
  const secs = (performance.now() - t0) / 1000;
  report.custom = { frames, secs: +secs.toFixed(1), allocMBperSec: +(total / 1e6 / secs).toFixed(2), gcDrops: drops, gcDropsPerSec: +(drops / secs).toFixed(2), maxFrameMs: +maxFrame.toFixed(1), avgFrameMs: +(sumFrame / Math.max(1, frames - 30)).toFixed(2), heapMB: +(performance.memory.usedJSHeapSize / 1e6).toFixed(1) };
}
