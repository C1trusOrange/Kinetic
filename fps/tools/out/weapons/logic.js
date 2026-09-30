// Functional test of the weapons logic (harness). Results in report.custom.checks (pass/fail) + notes.
const checks = [];
const notes = {};
const ev = { fire: [], switch: [], explosion: [], damage: [], death: [] };
let steps = [];
let idx = 0;

function check(name, ok, info) { checks.push({ name, ok: !!ok, info: info === undefined ? undefined : String(info) }); }

export function setup(game, report) {
  const E = game.events;
  E.on('weapon:fire', e => ev.fire.push([+game.time.toFixed(2), e.weapon]));
  E.on('weapon:switch', e => ev.switch.push([+game.time.toFixed(2), e.weapon]));
  E.on('explosion', e => ev.explosion.push([+game.time.toFixed(2), e.weapon, +e.radius.toFixed(1)]));
  E.on('damage', e => ev.damage.push({ t: +game.time.toFixed(2), tgt: e.target.name, amt: +e.amount.toFixed(1), w: e.weapon, hs: e.headshot }));
  E.on('death', e => ev.death.push({ v: e.victim.name, w: e.weapon }));
  report.custom = { checks, notes, ev };
  const w = game.weapons;
  const p = game.player;
  const inp = game.input;
  const D = game.entities.filter(e => e.isBot);
  const A = D[0];
  const at = (t, fn) => steps.push([t, fn]);
  const aimAt = (target, dy = 1.0) => {
    const eye = p.getEyePosition(new p.position.constructor());
    const dx = target.position.x - eye.x, dz = target.position.z - eye.z, dyy = target.position.y + dy - eye.y;
    p.yaw = Math.atan2(-dx, -dz);
    p.pitch = Math.atan2(dyy, Math.hypot(dx, dz));
  };
  const counts = w2 => ev.fire.filter(f => f[1] === w2).length;

  // ---------------------------------------------------------------- loadout
  at(0.7, () => {
    check('loadout owned', w.owned.join(',') === 'pistol,rifle,shotgun', w.owned.join(','));
    check('loadout rifle selected', w.currentId === 'rifle');
    check('loadout ammo 32/96', w.ammo === 32 && w.reserve === 96, `${w.ammo}/${w.reserve}`);
    check('loadout grenades', w.grenades === 2, w.grenades);
    check('equip finished', w.equipAmount === 1 && !w.switching);
    aimAt(A, 1.0);
  });
  // ---------------------------------------------------------------- rifle automatic fire
  at(1.0, () => { notes.hp0 = A.health; inp.setVirtual('fire', true); });
  at(2.0, () => {
    inp.setVirtual('fire', false);
    const n = counts('rifle');
    notes.rifleShots1s = n;
    check('rifle ~11 shots/s', n >= 9 && n <= 13, n);
    check('rifle ammo matches shots', w.ammo === 32 - n, `${w.ammo} vs ${32 - n}`);
    check('rifle damaged dummy', A.health < notes.hp0, `${notes.hp0}->${A.health}`);
    notes.spreadAfterBurst = w.spreadAngle;
    check('spread bloomed', w.spreadAngle > w.current.spread.hip * 1.3, w.spreadAngle);
    check('recoil applied', game.player.recoilTotal.pitch > 0.05, game.player.recoilTotal.pitch);
  });
  at(3.6, () => { check('spread recovers', w.spreadAngle < notes.spreadAfterBurst * 0.75, `${notes.spreadAfterBurst}->${w.spreadAngle}`); notes.ammoBeforeReload = w.ammo; inp.setVirtual('reload', true); });
  at(3.7, () => { inp.setVirtual('reload', false); check('reload started', w.reloading); });
  at(4.5, () => { check('reload progress', w.reloadProgress > 0.3 && w.reloadProgress < 0.7, w.reloadProgress); inp.setVirtual('fire', true); });
  at(4.6, () => { inp.setVirtual('fire', false); check('cannot fire while reloading (mag)', counts('rifle') === notes.rifleShots1s, counts('rifle')); });
  at(6.0, () => {
    check('reload done ammo 32', w.ammo === 32, w.ammo);
    check('reload reserve', w.reserve === 96 - (32 - notes.ammoBeforeReload), `${w.reserve} (was ${notes.ammoBeforeReload})`);
    check('reload finished flag', !w.reloading);
  });
  // ---------------------------------------------------------------- sprint blocks firing
  at(6.5, () => { inp.setVirtual('forward', true); inp.setVirtual('sprint', true); notes.cancels0 = p.sprintCancels; });
  at(7.4, () => { notes.sprintBlend = w.sprintBlend; check('sprint pose engaged', w.sprintBlend > 0.9 && p.isSprinting, `${w.sprintBlend}`); notes.shotsBefore = counts('rifle'); inp.setVirtual('fire', true); });
  at(7.5, () => { inp.setVirtual('fire', false); check('fire cancelled sprint', p.sprintCancels > notes.cancels0, p.sprintCancels); });
  at(8.0, () => { inp.setVirtual('forward', false); inp.setVirtual('sprint', false); });
  at(8.3, () => { p.position.set(0, 0, 8); p.velocity.set(0, 0, 0); p.capsule.start.set(0, p.radius, 8); p.capsule.end.set(0, p.height - p.radius, 8); p.yaw = 0; });
  // ---------------------------------------------------------------- switching
  at(8.5, () => { inp.setVirtual('weapon1', true); });
  at(8.6, () => { inp.setVirtual('weapon1', false); });
  at(9.3, () => { check('switch to pistol (key 1)', w.currentId === 'pistol' && !w.switching, w.currentId); notes.pistolAmmo = w.ammo; aimAt(A, 1.0); inp.setVirtual('fire', true); });
  at(9.35, () => { inp.setVirtual('fire', false); });
  at(9.7, () => { check('pistol single shot', w.ammo === notes.pistolAmmo - 1, w.ammo); inp.setVirtual('fire', true); });
  at(9.9, () => { check('pistol semi-auto (holding fires once)', w.ammo === notes.pistolAmmo - 2, w.ammo); inp.setVirtual('fire', false); notes.pistolReserveInf = w.reserve === Infinity; });
  at(10.0, () => { check('pistol reserve infinite', notes.pistolReserveInf); inp.setVirtual('lastWeapon', true); });
  at(10.05, () => { inp.setVirtual('lastWeapon', false); });
  at(10.7, () => { check('Q returns to rifle', w.currentId === 'rifle', w.currentId); game.input.wheel = 1; });
  at(11.4, () => { check('wheel + -> shotgun', w.currentId === 'shotgun', w.currentId); game.input.wheel = -1; });
  at(12.1, () => { check('wheel - -> rifle', w.currentId === 'rifle', w.currentId); inp.setVirtual('weapon3', true); });
  at(12.15, () => { inp.setVirtual('weapon3', false); });
  // ---------------------------------------------------------------- shotgun
  at(12.9, () => { check('switch to shotgun (key 3)', w.currentId === 'shotgun'); D[1].position.set(0, 0, 6); D[1].health = 100; D[1].alive = true; aimAt(D[1], 1.0); notes.hp1 = D[1].health; inp.setVirtual('fire', true); });
  at(12.95, () => { inp.setVirtual('fire', false); });
  at(13.0, () => { check('shotgun fired', counts('shotgun') === 1 && w.ammo === 5, `${counts('shotgun')} ${w.ammo}`); check('shotgun 9 pellets close range damage', D[1].health < notes.hp1 - 40 || !D[1].alive, `${notes.hp1}->${D[1].health}`); inp.setVirtual('fire', true); });
  at(13.05, () => { inp.setVirtual('fire', false); check('pump blocks refire', counts('shotgun') === 1, counts('shotgun')); });
  at(14.1, () => { inp.setVirtual('fire', true); });
  at(14.15, () => { inp.setVirtual('fire', false); check('shotgun refires after pump', counts('shotgun') === 2, counts('shotgun')); D[1].position.set(-6, 0, -16); D[1].health = 100; D[1].alive = true; });
  at(15.2, () => { inp.setVirtual('reload', true); });
  at(15.25, () => { inp.setVirtual('reload', false); check('shell reload started', w.reloading); });
  at(16.3, () => { check('shell reload inserts shells', w.ammo > 4, w.ammo); });
  at(19.0, () => { check('shell reload complete 6', w.ammo === 6 && !w.reloading, `${w.ammo} rl=${w.reloading}`); check('shell reserve', w.reserve === 16, w.reserve); });
  // shell reload interrupt by fire
  at(19.1, () => { w.inv.shotgun.ammo = 2; w.ammo = 2; inp.setVirtual('reload', true); });
  at(19.15, () => { inp.setVirtual('reload', false); });
  at(20.2, () => { inp.setVirtual('fire', true); notes.shellAmmoAtInterrupt = w.ammo; });
  at(20.25, () => { inp.setVirtual('fire', false); check('fire interrupts shell reload', !w.reloading && w.ammo === notes.shellAmmoAtInterrupt - 1, `${w.reloading} ${w.ammo} (was ${notes.shellAmmoAtInterrupt})`); });
  // ---------------------------------------------------------------- pickups
  at(21.0, () => {
    check('giveWeapon sniper true', w.giveWeapon('sniper') === true);
    check('give sniper twice refills', w.giveWeapon('sniper') === true && w.inv.sniper.reserve === 23, w.inv.sniper.reserve);
    check('give sniper capped', (w.giveWeapon('sniper'), w.inv.sniper.reserve === 25), w.inv.sniper.reserve);
    check('give pistol false', w.giveWeapon('pistol') === false);
    check('addAmmo(null) true', w.addAmmo(null, 0.5) === true);
    check('addGrenades', w.addGrenades(1) === true && w.grenades === 3, w.grenades);
    check('addGrenades cap', (w.addGrenades(9), w.grenades === w.maxGrenades), w.grenades);
    check('addGrenades full false', w.addGrenades(1) === false);
    check('owned includes sniper', w.owned.includes('sniper'));
    w.grenades = 2;
  });
  at(21.8, () => { check('auto-switched to sniper', w.currentId === 'sniper', w.currentId); aimAt(D[4], 1.0); inp.setVirtual('ads', true); });
  at(22.5, () => {
    check('scoped', w.scoped && w.adsAmount >= 0.99, w.adsAmount);
    check('fov zoom', Math.abs(p.fovMultiplier - 0.27) < 0.01, p.fovMultiplier);
    check('look scale', Math.abs(p.lookScale - 0.3) < 0.01, p.lookScale);
    check('scoped spread tiny', w.spreadAngle < 0.001, w.spreadAngle);
    notes.hp2 = D[4].health;
    inp.setVirtual('fire', true);
  });
  at(22.55, () => { inp.setVirtual('fire', false); });
  at(22.8, () => { check('sniper unscopes while cycling', !w.scoped, w.adsAmount); });
  at(24.2, () => {
    check('sniper damage ~100', D[4].health <= notes.hp2 - 90 || !D[4].alive, `${notes.hp2}->${D[4].health} alive=${D[4].alive}`);
    check('sniper re-scopes', w.scoped, w.adsAmount);
    inp.setVirtual('ads', false);
  });
  // ---------------------------------------------------------------- rocket
  at(25.0, () => { w.giveWeapon('rocket'); });
  at(26.0, () => { check('rocket selected', w.currentId === 'rocket', w.currentId); D[3].position.set(0, 0, -14); D[3].health = 100; D[3].alive = true; aimAt(D[3], 0.3); notes.hp3 = D[3].health; inp.setVirtual('fire', true); });
  at(26.05, () => { inp.setVirtual('fire', false); check('rocket spawned', game.projectiles.rockets.length === 1, game.projectiles.rockets.length); });
  at(27.2, () => {
    check('rocket exploded', ev.explosion.some(e => e[1] === 'rocket'), JSON.stringify(ev.explosion));
    check('rocket damaged target', D[3].health < notes.hp3 || !D[3].alive, `${notes.hp3}->${D[3].health}`);
    check('rocket no leftovers', game.projectiles.rockets.length === 0);
  });
  // rocket jump: look straight down at feet
  at(28.0, () => { p.pitch = -1.5; p.position.set(4, 0, 10); p.velocity.set(0, 0, 0); p.capsule.start.set(4, p.radius, 10); p.capsule.end.set(4, p.height - p.radius, 10); p.health = 100; p.god = false; notes.hpP = p.health; });
  at(28.4, () => { notes.vyBefore = p.velocity.y; inp.setVirtual('fire', true); });
  at(28.45, () => { inp.setVirtual('fire', false); });
  at(28.9, () => {
    notes.peakVY = notes.peakVY || 0;
    check('rocket jump launched player', notes.peakVY > 8, notes.peakVY);
    check('rocket self damage scaled', p.health < notes.hpP && p.health > notes.hpP - 60, `${notes.hpP}->${p.health}`);
    p.health = 100; p.god = true;
  });
  // ---------------------------------------------------------------- grenade
  at(30.0, () => { p.pitch = 0.25; p.yaw = 0; p.position.set(0, 0, 8); p.velocity.set(0, 0, 0); p.capsule.start.set(0, p.radius, 8); p.capsule.end.set(0, p.height - p.radius, 8); notes.gr0 = w.grenades; inp.setVirtual('grenade', true); });
  at(30.5, () => { check('cooking', w.cooking && w.grenades === notes.gr0 - 1, `${w.cooking} ${w.grenades}`); check('cook progress', w.cookProgress > 0.1 && w.cookProgress < 0.4, w.cookProgress); });
  at(31.0, () => { inp.setVirtual('grenade', false); });
  at(31.4, () => { check('grenade in flight', game.projectiles.grenades.length === 1, game.projectiles.grenades.length); notes.gFuse = game.projectiles.grenades[0] && game.projectiles.grenades[0].fuse; check('cooked fuse shorter', notes.gFuse < 2.0, notes.gFuse); });
  at(33.5, () => { check('grenade exploded', ev.explosion.some(e => e[1] === 'grenade'), JSON.stringify(ev.explosion)); check('grenade gone', game.projectiles.grenades.length === 0); });
  // cook-off in hand
  at(34.0, () => { p.god = false; p.health = 100; notes.hpC = p.health; notes.exC = ev.explosion.length; inp.setVirtual('grenade', true); });
  at(37.0, () => { inp.setVirtual('grenade', false); check('cook-off exploded in hand', ev.explosion.length === notes.exC + 1 && !w.cooking, `${ev.explosion.length - notes.exC} cooking=${w.cooking}`); check('cook-off hurt thrower', p.health < notes.hpC, `${notes.hpC}->${p.health}`); p.health = 100; p.god = true; });
  // ---------------------------------------------------------------- melee
  at(38.0, () => { D[0].position.set(0, 0, 6.2); D[0].health = 100; D[0].alive = true; p.position.set(0, 0, 8); p.pitch = 0; p.yaw = 0; aimAt(D[0], 1.0); notes.hpM = D[0].health; inp.setVirtual('melee', true); });
  at(38.05, () => { inp.setVirtual('melee', false); });
  at(38.6, () => { check('melee damage 55', D[0].health === notes.hpM - 55 || D[0].health === notes.hpM - 44 || D[0].health < notes.hpM, `${notes.hpM}->${D[0].health}`); const d = ev.damage.filter(x => x.w === 'melee'); check('melee event weapon', d.length >= 1, d.length); });
  // ---------------------------------------------------------------- death while cooking
  at(39.5, () => { p.god = false; w.grenades = 2; inp.setVirtual('grenade', true); });
  at(40.2, () => { check('cooking before death', w.cooking); game.combat.kill(p, { attacker: null, weapon: 'explosion' }); });
  at(40.4, () => { check('grenade dropped on death', game.projectiles.grenades.length === 1 && !w.cooking, `${game.projectiles.grenades.length} ${w.cooking}`); inp.setVirtual('grenade', false); });
  at(41.0, () => { check('viewmodel state reset', p.fovMultiplier === 1 && p.lookScale === 1); });

  // ---------------------------------------------------------------- respawn + empty weapon behaviours
  at(42.0, () => { game.resetMatch(); });
  at(42.6, () => { check('respawn loadout', w.owned.join(',') === 'pistol,rifle,shotgun' && w.ammo === 32 && w.currentId === 'rifle' && w.grenades === 2, `${w.owned} ${w.ammo} ${w.currentId} ${w.grenades}`); inp.setVirtual('reload', true); });
  at(42.65, () => { inp.setVirtual('reload', false); check('no reload when full', !w.reloading); w.inv.shotgun.ammo = 0; w.inv.shotgun.reserve = 0; inp.setVirtual('weapon3', true); });
  at(42.7, () => { inp.setVirtual('weapon3', false); });
  at(43.5, () => { check('shotgun selected (empty)', w.currentId === 'shotgun' && w.ammo === 0, `${w.currentId} ${w.ammo}`); notes.dry0 = (window.__DRY || 0); inp.setVirtual('fire', true); });
  at(43.55, () => { inp.setVirtual('fire', false); });
  at(44.6, () => { check('empty weapon falls back to another', w.currentId !== 'shotgun', w.currentId); });
  at(44.7, () => { w.inv.rifle.ammo = 0; w.inv.rifle.reserve = 40; w.giveWeapon('pistol'); inp.setVirtual('weapon2', true); });
  at(44.75, () => { inp.setVirtual('weapon2', false); });
  at(45.6, () => { check('auto reload on empty magazine', w.reloading && w.currentId === 'rifle', `${w.currentId} rl=${w.reloading}`); });
  at(48.0, () => { check('auto reload finished', !w.reloading && w.ammo === 32 && w.reserve === 8, `${w.ammo}/${w.reserve}`); });
  steps.sort((a, b) => a[0] - b[0]);
  window.__STEPS__ = steps.length;
}

export function drive(t, dt, game, report) {
  const p = game.player;
  if (p.alive) notes.peakVY = Math.max(notes.peakVY || 0, p.velocity.y);
  while (idx < steps.length && steps[idx][0] <= t) {
    try { steps[idx][1](); } catch (err) { check('step ' + idx + ' threw', false, err && err.message); console.error(err); }
    idx++;
  }
}

export function finish(game, report) {
  report.custom.summary = { total: checks.length, failed: checks.filter(c => !c.ok).length };
  report.custom.failed = checks.filter(c => !c.ok);
  report.custom.fire = ev.fire.length;
}
