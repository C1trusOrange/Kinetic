// Cost of nav.findPath / isConnected for random pairs (main area).
export async function setup(game, report) {
  const nav = game.world.nav;
  const C = report.custom = {};
  let seed = 5; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const main = nav._main;
  const ms = [], msC = [];
  let nulls = 0, walks = 0;
  for (let k = 0; k < 500; k++) {
    const a = main[Math.floor(rnd() * main.length)], b = main[Math.floor(rnd() * main.length)];
    const t0 = performance.now();
    nav.isConnected(a.position, b.position);
    msC.push(performance.now() - t0);
    const t1 = performance.now();
    const p = nav.findPath(a.position, b.position);
    const d = performance.now() - t1;
    if (!p) nulls++; else { ms.push(d); walks += p.length; }
  }
  ms.sort((x, y) => x - y);
  const q = (arr, p) => +arr[Math.min(arr.length - 1, Math.floor(arr.length * p))].toFixed(2);
  C.n = ms.length; C.nulls = nulls; C.avg = +(ms.reduce((s, v) => s + v, 0) / ms.length).toFixed(2);
  C.p50 = q(ms, 0.5); C.p90 = q(ms, 0.9); C.p99 = q(ms, 0.99); C.max = q(ms, 1);
  C.over2_5 = ms.filter(v => v > 2.5).length; C.over8 = ms.filter(v => v > 8).length; C.over16 = ms.filter(v => v > 16).length;
  msC.sort((x, y) => x - y); C.connMax = q(msC, 1);
}
export function drive() {}
