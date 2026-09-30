(window.__GAME__ && window.__GAME__.state === "menu" && !window.__started && (window.__started = true, (async () => {
  try {
    const g = window.__GAME__, w = g.world;
    const res = {};
    const pk = w.pickups;
    const count = h => { let n = 0, tris = 0; h.traverse(o => { if (o.isMesh) { n++; const gg = o.geometry; tris += (gg.index ? gg.index.count : gg.attributes.position.count) / 3; } }); return { meshes: n, tris }; };
    for (const [tag, WM] of [['null', null], ['empty', {}], ['throws', { createWeaponModel() { throw new Error('boom'); } }]]) {
      try {
        const h = pk._buildWeaponProp({ weapon: 'rocket' }, WM);
        res[tag] = count(h);
      } catch (e) { res[tag] = 'ERR ' + e.message; }
    }
    const WMreal = await import('/src/weapons/WeaponModels.js');
    for (const id of ['pistol', 'rifle', 'shotgun', 'sniper', 'rocket']) {
      try { const h = pk._buildWeaponProp({ weapon: id }, WMreal); res['real_' + id] = count(h); }
      catch (e) { res['real_' + id] = 'ERR ' + e.message; }
    }
    window.__JOB__ = res;
  } catch (e) { window.__JOB__ = { error: String(e && e.stack || e) }; }
  window.__jobdone = true;
})()), window.__jobdone === true)
