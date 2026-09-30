const G = window.__GAME__;
let before = null;
const summ = () => {
  const m = {};
  for (const p of G.renderer.info.programs) { m[p.name] = (m[p.name] || 0) + 1; }
  return m;
};
export function setup(game, report) { before = summ(); report.custom = { setupProgs: G.renderer.info.programs.length }; }
export function drive(t, dt, game, report) {}
export function finish(game, report) {
  const after = summ();
  report.custom.before = before;
  report.custom.after = after;
  const diff = {};
  for (const k of Object.keys(after)) { const d = after[k] - (before[k] || 0); if (d) diff[k] = d; }
  report.custom.diff = diff;
  report.custom.total = G.renderer.info.programs.length;
}
