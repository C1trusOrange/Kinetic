// Player death / pause / match end during grapple, wall-run, slide, ADS, reload, grenade cook. Checks state cleanup.
const frames = n => new Promise(res => { let c = 0; const f = () => (++c >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
async function until(cond, max = 400) { for (let i = 0; i < max; i++) { if (cond()) return true; await frames(1); } return false; }
export function drive() {}

export async function setup(game, report) {
  const out = (window.__LC__ = { done: false, rows: [], events: [], errors: [] });
  const p = game.player, inp = game.input, w = game.weapons, a = game.audio;
  game.events.on('player:grapple', e => out.events.push({ t: +game.time.toFixed(2), grapple: e.state, reason: e.reason }));
  game.events.on('explosion', e => out.events.push({ t: +game.time.toFixed(2), explosion: e.weapon, owner: e.owner ? e.owner.name : null, pos: [e.position.x, e.position.y, e.position.z].map(v => +v.toFixed(1)) }));
  game.events.on('death', e => out.events.push({ t: +game.time.toFixed(2), death: e.victim.name, by: e.attacker ? e.attacker.name : null, weapon: e.weapon }));
  const S = label => {
    const r = {
      label, state: game.state, alive: p.alive, health: Math.round(p.health),
      grState: p.grapple.state, isGrappling: p.isGrappling, anchor: !!p.grappleAnchor, grVisible: p.grapple.group && p.grapple.group.visible, charge: +p.grappleCharge.toFixed(2),
      wallRun: p.isWallRunning, slide: p.isSliding, mantle: p.isMantling,
      loops: a.loops.size,
      weapon: w.currentId, ammo: w.ammo, reserve: w.reserve, reloading: w.reloading, ads: +w.adsAmount.toFixed(2), scoped: w.scoped, cooking: w.cooking, gState: w.gState, throwing: w.throwing, grenades: w.grenades,
      fovMult: +p.fovMultiplier.toFixed(2), lookScale: +p.lookScale.toFixed(2), camFov: +game.camera.fov.toFixed(1),
      nadesLive: game.projectiles.grenades.length, rockets: game.projectiles.rockets.length,
      camNaN: [game.camera.position.x, game.camera.position.y, game.camera.position.z].some(v => !Number.isFinite(v)),
    };
    out.rows.push(r);
    return r;
  };
  const killPlayer = () => game.combat.kill(p, { attacker: game.bots.list[0] || null, weapon: 'rifle', direction: { x: 0, y: 0, z: -1 } });
  const respawnWait = async () => { await until(() => p.alive, 600); await frames(10); };
  const clearInput = () => { for (const k of ['forward', 'ads', 'reload', 'grenade', 'grapple', 'fire', 'crouch', 'jump', 'sprint']) inp.setVirtual(k, false); };
  const aimAtWall = () => {
    const eye = p.getEyePosition(p.position.clone());
    for (let k = 0; k < 40; k++) {
      p.yaw = k * 0.157; p.pitch = 0.25;
      const hit = game.world.raycast(eye, p.getAimDirection(p.position.clone()), 44);
      if (hit) return true;
    }
    return false;
  };
  try {
    await frames(60);
    // freeze bots so they cannot interfere
    game.bots.update = () => {};
    for (const b of game.bots.list) b.spawnProtectedUntil = 0;
    p.spawnProtectedUntil = 0;

    // ---------- T1: death while grappling
    {
      aimAtWall();
      p.grapple.fire();
      const ok = await until(() => p.isGrappling, 200);
      S('T1 grapple attached ok=' + ok);
      killPlayer();
      await frames(6);
      S('T1 6 frames after death');
      await respawnWait();
      S('T1 after respawn');
    }
    // ---------- T2: death while wall-running (injected wall-run) and sliding
    {
      const m = p.move;
      m._startWallRun({ nx: 1, nz: 0, side: 1, d: 0 });
      await frames(3);
      S('T2 wallrun started');
      killPlayer();
      await frames(6);
      S('T2 6 frames after death');
      await respawnWait();
      S('T2 after respawn');
      m._startSlide(9);
      await frames(3);
      S('T2b slide started');
      killPlayer();
      await frames(6);
      S('T2b 6 frames after death');
      await respawnWait();
      S('T2b after respawn');
    }
    // ---------- T3: death while scoped ADS
    {
      w.giveWeapon('sniper');
      await until(() => w.currentId === 'sniper' && w.switchState === 0, 200);
      inp.setVirtual('ads', true);
      const ok = await until(() => w.scoped, 200);
      S('T3 scoped ok=' + ok);
      killPlayer();
      await frames(6);
      S('T3 6 frames after death');
      inp.setVirtual('ads', false);
      await respawnWait();
      S('T3 after respawn');
    }
    // ---------- T4: death while reloading
    {
      w.inv.rifle.ammo = 5; w.ammo = 5;
      inp.setVirtual('reload', true); await frames(2); inp.setVirtual('reload', false);
      const ok = await until(() => w.reloading, 100);
      await frames(8);
      S('T4 reloading ok=' + ok);
      killPlayer();
      await frames(6);
      S('T4 6 frames after death');
      await respawnWait();
      S('T4 after respawn');
    }
    // ---------- T5: death while cooking a grenade
    {
      inp.setVirtual('grenade', true);
      const ok = await until(() => w.cooking && w.gState === 2, 200);
      await frames(40);
      S('T5 cooking ok=' + ok);
      killPlayer();
      await frames(6);
      S('T5 6 frames after death (dropped grenade should be live)');
      inp.setVirtual('grenade', false);
      await frames(150);
      S('T5 after fuse');
      await respawnWait();
      S('T5 after respawn');
    }
    // ---------- T6: pause during grapple then restart
    {
      clearInput();
      aimAtWall();
      p.grapple.fire();
      const ok = await until(() => p.isGrappling, 200);
      S('T6 attached ok=' + ok);
      game.pause();
      await frames(20);
      S('T6 paused');
      game.restartMatch();
      while (game.state === 'loading') await frames(2);
      await frames(20);
      S('T6 after restart from pause');
    }
    // ---------- T7: match end while grappling + cooking + rockets in flight
    {
      game.bots.update = () => {};
      p.spawnProtectedUntil = 0;
      aimAtWall();
      p.grapple.fire();
      await until(() => p.isGrappling, 200);
      inp.setVirtual('grenade', true);
      await until(() => w.cooking && w.gState === 2, 200);
      game.projectiles.spawnRocket({ owner: p, origin: game.camera.position.clone(), direction: p.getAimDirection(p.position.clone()) });
      S('T7 before end');
      game.endMatch('score');
      await frames(300);
      S('T7 end screen shown');
      inp.setVirtual('grenade', false);
      game.restartMatch();
      while (game.state === 'loading') await frames(2);
      await frames(20);
      S('T7 after restart from end screen');
    }
    // ---------- T8: quit to menu while grappling, start other map
    {
      game.bots.update = () => {};
      aimAtWall();
      p.spawnProtectedUntil = 0;
      p.grapple.fire();
      await until(() => p.isGrappling, 200);
      S('T8 attached');
      game.pause(); game.quitToMenu();
      await frames(30);
      S('T8 in menu');
      await game.startMatch({ mapId: 'foundry', mode: 'tdm', botCount: 3, scoreLimit: 0, timeLimit: 0 });
      await frames(20);
      S('T8 new match foundry tdm');
    }
  } catch (e) { out.errors.push(String(e && e.stack || e)); }
  out.done = true;
}
