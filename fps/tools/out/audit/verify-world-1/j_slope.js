(window.__GAME__ && window.__GAME__.state === "menu" && !window.__started && (window.__started = true, (async () => {
  try {
    const g = window.__GAME__;
    const out = {};
    for (const m of g.maps) {
      const list = [];
      (m.solids || []).forEach((s, i) => {
        if ((s.type === 'railing' || s.type === 'catwalk') && Array.isArray(s.from) && Array.isArray(s.to) && Math.abs(s.from[1] - s.to[1]) > 0.01) {
          list.push({ i, type: s.type, from: s.from, to: s.to, collide: s.collide, rails: s.railings });
        }
      });
      out[m.id] = list;
    }
    window.__JOB__ = out;
  } catch (e) { window.__JOB__ = { error: String(e && e.stack || e) }; }
  window.__jobdone = true;
})()), window.__jobdone === true)
