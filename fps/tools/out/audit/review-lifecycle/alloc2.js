// Which subsystem allocates per frame? Measure heap growth per frame with subsystems stubbed out one by one.
export function drive() {}
const frames = n => new Promise(res => { let c = 0; const f = () => (++c >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });

async function measure(label, n) {
  try { window.gc(); window.gc(); } catch (e) { /* no gc */ }
  await frames(5);
  let last = performance.memory.usedJSHeapSize, grow = 0, f = 0;
  await new Promise(res => {
    const step = () => {
      const cur = performance.memory.usedJSHeapSize;
      if (cur > last) grow += cur - last;
      last = cur; f++;
      if (f >= n) res(); else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  return { label, kbPerFrame: +(grow / 1024 / n).toFixed(1) };
}

export async function setup(game, report) {
  const out = (window.__LC__ = { done: false, rows: [], errors: [] });
  const N = 240;
  try {
    await frames(90);
    out.rows.push(await measure('all subsystems', N));
    const stub = (obj, name) => { const orig = obj[name]; obj[name] = function () {}; return () => { obj[name] = orig; }; };
    const cases = [
      ['bots.update', game.bots, 'update'],
      ['projectiles.update', game.projectiles, 'update'],
      ['world.update', game.world, 'update'],
      ['effects.update', game.effects, 'update'],
      ['hud.update', game.hud, 'update'],
      ['audio.update', game.audio, 'update'],
      ['weapons.update', game.weapons, 'update'],
      ['weapons.updateViewModel', game.weapons, 'updateViewModel'],
      ['player.update', game.player, 'update'],
      ['player.updateCamera', game.player, 'updateCamera'],
      ['game.render', game, 'render'],
      ['game._updateMatch', game, '_updateMatch'],
    ];
    for (const [label, obj, name] of cases) {
      const restore = stub(obj, name);
      out.rows.push(await measure('without ' + label, N));
      restore();
    }
    // all update stubs at once (render + loop overhead only)
    const restores = [];
    for (const [, obj, name] of cases) if (name !== 'render') restores.push(stub(obj, name));
    out.rows.push(await measure('only render (all updates stubbed)', N));
    restores.forEach(r => r());
    const rr = stub(game, 'render');
    for (const [, obj, name] of cases) if (name !== 'render') restores.push(stub(obj, name));
    out.rows.push(await measure('nothing (loop only)', N));
  } catch (e) { out.errors.push(String(e && e.stack || e)); }
  out.done = true;
}
