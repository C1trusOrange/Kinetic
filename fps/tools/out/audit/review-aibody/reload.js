const g = window.__GAME__;
g.state = 'paused';
const { WEAPONS } = await import('/src/weapons/WeaponDefs.js');
const b = g.bots.list[0];
const res = {};
for (const id of Object.keys(WEAPONS)) {
  for (const dt of [1 / 144, 1 / 60, 0.05]) {
    b.giveWeapon(id);
    b.selectWeapon(id === 'pistol' ? 'rifle' : 'pistol'); b.selectWeapon(id);
    const def = WEAPONS[id], inv = b.inv[id];
    inv.mag = 0; inv.reserve = Number.isFinite(def.reserveMax) ? def.reserveMax : Infinity;
    b.equipUntil = 0;
    const ok = b.startReload();
    let t = 0, n = 0;
    while (b.reloading && n < 5000) { g.time += dt; b._updateWeaponState(dt); t += dt; n++; }
    res[id + '@' + Math.round(1 / dt)] = { started: ok, time: +t.toFixed(2), mag: inv.mag, reserve: inv.reserve, expect: (def.reloadMode === 'shell' ? (0.42 + def.magSize * 0.46 + 0.34).toFixed(2) : (def.reloadTime + (def.reloadEmptyExtra || 0)).toFixed(2)) };
  }
}
// partial: mag 3 reserve 1 shotgun
const sg = b.inv.shotgun; b.selectWeapon('shotgun'); sg.mag = 3; sg.reserve = 1; b.startReload();
let n = 0; while (b.reloading && n < 5000) { g.time += 0.016; b._updateWeaponState(0.016); n++; }
res.shotgunPartial = { mag: sg.mag, reserve: sg.reserve, t: n * 0.016 };
g.state = 'playing';
return res;
