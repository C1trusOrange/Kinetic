const sleep = ms => new Promise(r => setTimeout(r, ms));
const q = new URLSearchParams(location.search);
export function drive() {}
export async function setup(game, report) {
  const c = report.custom = {};
  await sleep(500);

  // ---------- F4: mouse delta filter
  {
    const inp = game.input;
    inp.lockUnavailable = true; inp.capture = true; inp.enabled = true;
    const res = {};
    for (const v of [300, 699, 701, 900, 1500]) {
      inp.consumeLook();
      window.dispatchEvent(new MouseEvent('mousemove', { movementX: v, movementY: 0 }));
      res['x' + v] = inp.consumeLook().x;
    }
    inp.consumeLook();
    window.dispatchEvent(new MouseEvent('mousemove', { movementX: 450, movementY: 0 }));
    window.dispatchEvent(new MouseEvent('mousemove', { movementX: 450, movementY: 0 }));
    res.two450 = inp.consumeLook().x;
    c.mouse = res;
    inp.lockUnavailable = false;
  }

  // ---------- F2: render skipped on exception
  {
    let renders = 0;
    const origRender = game.render.bind(game);
    game.render = () => { renders++; return origRender(); };
    await sleep(500);
    const base = renders;
    const t0 = game.time, f0 = game.frame;
    const orig = game.hud.update;
    game.hud.update = () => { throw new Error('probe: hud.update fault'); };
    renders = 0;
    await sleep(1000);
    c.frameError = { rendersDuringFault: renders, framesAdvanced: game.frame - f0, simAdvanced: +(game.time - t0).toFixed(3), baselineRenders500ms: base };
    game.hud.update = orig;
    renders = 0;
    await sleep(500);
    c.frameError.rendersAfterRestore500ms = renders;
    game.render = origRender;
  }

  // ---------- F3: pointerlockerror double count
  {
    const inp = game.input;
    const ev = { n: 0 };
    const cnt = () => ev.n++;
    document.addEventListener('pointerlockerror', cnt);
    const key = code => window.dispatchEvent(new KeyboardEvent('keydown', { code }));
    const snap = () => ({ state: game.state, failures: inp._lockFailures, unavailable: inp.lockUnavailable, errEvents: ev.n });
    const seq = [];
    seq.push(['start', snap()]);
    key('Escape'); await sleep(100);          // playing + not locked -> pause
    seq.push(['esc1 (pause)', snap()]);
    await sleep(600);
    key('Escape'); await sleep(400);          // menu resume -> requestLock w/o activation
    seq.push(['esc2 (resume)', snap()]);
    key('Escape'); await sleep(100);
    seq.push(['esc3 (pause)', snap()]);
    await sleep(600);
    key('Escape'); await sleep(400);
    seq.push(['esc4 (resume)', snap()]);
    // does click still request lock?
    let reqs = 0;
    const origReq = inp.requestLock.bind(inp);
    inp.requestLock = () => { reqs++; };
    const at = game.autotest; game.autotest = null;
    game.renderer.domElement.dispatchEvent(new MouseEvent('click'));
    game.autotest = at;
    seq.push(['click after flag', { requestLockCalls: reqs, ...snap() }]);
    inp.requestLock = origReq;
    // and with the flag cleared, a click does request
    inp.lockUnavailable = false;
    inp.requestLock = () => { reqs++; };
    game.autotest = null;
    game.renderer.domElement.dispatchEvent(new MouseEvent('click'));
    game.autotest = at;
    seq.push(['click when flag clear', { requestLockCalls: reqs }]);
    inp.requestLock = origReq;
    document.removeEventListener('pointerlockerror', cnt);
    c.lock = seq;
    inp.lockUnavailable = false; inp._lockFailures = 0;
  }

  // ---------- F9: stale attacker credit
  {
    const bots = game.bots.list.filter(b => b.alive);
    const A = bots[0], B = bots[1];
    if (A && B) {
      B.spawnProtectedUntil = 0; A.spawnProtectedUntil = 0; B.god = false;
      const before = { Ak: A.kills, Bd: B.deaths };
      game.combat.applyDamage(B, { amount: 5, attacker: A, weapon: 'rifle' });
      const t1 = game.time;
      game.time += 20;
      game.combat.applyDamage(B, { amount: 5, attacker: B, weapon: 'rocket' });   // self damage (rocket jump)
      B.position.y = (game.world.killY ?? -50) - 5;
      game._updateMatch(0);
      c.staleCredit = { attackerKillsDelta: A.kills - before.Ak, victimDeathsDelta: B.deaths - before.Bd, lastAttackerName: B.lastAttacker && B.lastAttacker.name, timeSinceAttackerHit: +(game.time - t1).toFixed(1) };
    }
  }

  // ---------- F5: banner overwritten (variant hs | plain)
  {
    const variant = q.get('variant') || 'hs';
    const bots = game.bots.list.filter(b => b.alive);
    const victim = bots[bots.length - 1];
    if (victim) {
      game.match.scoreLimit = game.player.kills + 1;
      game.hud._firstBlood = variant === 'hs' ? true : true; // isolate: no FIRST BLOOD line
      victim.spawnProtectedUntil = 0; victim.god = false;
      game.combat.applyDamage(victim, { amount: 9999, attacker: game.player, weapon: 'rifle', headshot: variant === 'hs' });
      c.banner = {
        variant, state: game.state, over: game.match.over, playerWon: game.match.playerWon,
        title: game.hud.e.atitle.textContent, sub: game.hud.e.asub.textContent, kind: game.hud.e.announce.dataset.kind,
      };
    }
  }
}
