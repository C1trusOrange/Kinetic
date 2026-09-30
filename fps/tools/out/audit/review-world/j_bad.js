(window.__GAME__ && window.__GAME__.state === "menu" && !window.__started && (window.__started = true, (async () => {
  try {
    const g = window.__GAME__, w = g.world;
    const base = { id: 'bad', name: 'Bad', bounds: { min: [-20, -4, -20], max: [20, 20, 20] }, killY: -10, solids: [{ type: 'box', min: [-20, -1, -20], max: [20, 0, 20] }], spawns: [{ pos: [0, 0, 0] }], lights: [] };
    const cases = {
      padTarget2: { ...base, jumpPads: [{ pos: [2, 0, 2], target: [10, 5] }] },
      padApexNaN: { ...base, jumpPads: [{ pos: [2, 0, 2], target: [10, 5, 3], apex: 'x' }] },
      padVelShort: { ...base, jumpPads: [{ pos: [2, 0, 2], velocity: [1, 2] }] },
      noTheme: { ...base },
      spawnYawStr: { ...base, spawns: [{ pos: [0, 0, 0], yaw: 'a' }, { pos: [3, 0, 3], lookAt: [1] }] },
    };
    const out = {};
    for (const [k, def] of Object.entries(cases)) {
      try {
        await w.load(def);
        out[k] = { warnings: w.warnings.filter(m => !/spawn point|navigation graph|nearest/.test(m)).slice(0, 5), pads: w.jumpPads.map(p => ({ vel: p.velocity.toArray(), tgt: p.target ? p.target.toArray() : null })), spawns: w.spawnPoints.map(s => ({ p: s.position.toArray(), yaw: s.yaw })) };
      } catch (e) { out[k] = { threw: String(e && e.message) }; }
    }
    window.__JOB__ = out;
  } catch (e) { window.__JOB__ = { error: String(e && e.stack || e) }; }
  window.__jobdone = true;
})()), window.__jobdone === true)
