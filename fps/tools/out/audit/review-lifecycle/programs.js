// Do shader programs get compiled mid-match (hitches)? Track programs count vs frame time over a 15-bot match, and after restart.
export function drive() {}
const frames = n => new Promise(res => { let c = 0; const f = () => (++c >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });

export async function setup(game, report) {
  const out = (window.__LC__ = { done: false, events: [], segs: [], errors: [] });
  try {
    const track = async (label, seconds) => {
      const start = performance.now();
      let last = start, lastProg = game.renderer.info.programs.length, worst = 0, n = 0;
      const p0 = lastProg;
      await new Promise(res => {
        const step = now => {
          const dt = now - last; last = now; n++;
          const pc = game.renderer.info.programs.length;
          if (pc !== lastProg) { out.events.push({ seg: label, t: +((now - start) / 1000).toFixed(1), programs: pc, added: pc - lastProg, frameMs: +dt.toFixed(0) }); lastProg = pc; }
          if (n > 5 && dt > worst) worst = dt;
          if (now - start > seconds * 1000) res(); else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
      out.segs.push({ label, seconds, programsStart: p0, programsEnd: game.renderer.info.programs.length, worstFrameMs: +worst.toFixed(0), frames: n });
    };
    await frames(30);
    await track('match 1 (t=0..45s)', 45);
    game.restartMatch();
    while (game.state === 'loading') await frames(2);
    await track('after restart (45s)', 45);
  } catch (e) { out.errors.push(String(e && e.stack || e)); }
  out.done = true;
}
