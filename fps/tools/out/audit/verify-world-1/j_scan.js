(window.__GAME__ && window.__GAME__.state === "menu" && !window.__started && (window.__started = true, (async () => {
  try {
    const g = window.__GAME__;
    const out = {};
    const fin = a => Array.isArray(a) && a.length >= 3 && a.every(Number.isFinite);
    for (const m of g.maps) {
      const bad = [];
      (m.spawns || []).forEach((s, i) => { if (s.lookAt !== undefined && !fin(s.lookAt)) bad.push('spawn' + i); });
      (m.jumpPads || []).forEach((p, i) => { if (p.target !== undefined && !fin(p.target)) bad.push('padT' + i); if (p.apex !== undefined && !Number.isFinite(p.apex)) bad.push('padA' + i); if (p.velocity !== undefined && !fin(p.velocity)) bad.push('padV' + i); });
      out[m.id] = { bad, nSpawns: (m.spawns || []).length, nPads: (m.jumpPads || []).length, lookAtCount: (m.spawns || []).filter(s => s.lookAt).length };
    }
    window.__JOB__ = out;
  } catch (e) { window.__JOB__ = { error: String(e && e.stack || e) }; }
  window.__jobdone = true;
})()), window.__jobdone === true)
