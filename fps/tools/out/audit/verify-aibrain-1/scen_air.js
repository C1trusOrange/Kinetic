// Verifier: a hurt bot (wants health) with no enemies alive is knocked/launched upward mid-way to a pickup.
// Measures: pickups blacklisted while airborne (cascade), and rescue() teleports triggered by roam-goal failures in the air.
const f = v => +v.toFixed(1);
const nap = () => new Promise(r => setTimeout(r, 0));
async function step(game, seconds, dt, cb) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) { game.update(dt); if (cb && cb(i, dt) === false) return; if (i % 240 === 239) await nap(); }
}
export async function setup(game, report) {
  const C = report.custom = { trials: [] };
  game.autotest.duration = 1e9;
  const DT = 1 / 60;
  try {
    const bots = game.bots.list;
    for (let i = 1; i < bots.length; i++) { bots[i].alive = false; bots[i].model.setVisible(false); bots[i].respawnAt = -1; }
    game.player.alive = false; game.player.respawnAt = -1;
    const bot = bots[0]; bot.god = true;
    const br = bot.brain, nav = br.nav;
    const wn = game.world.nav;
    let teleports = 0, rescueCalls = 0;
    const oT = bot.teleportTo.bind(bot);
    bot.teleportTo = (p, y) => { teleports++; return oT(p, y); };
    const oR = br.rescue.bind(br);
    br.rescue = () => { rescueCalls++; return oR(); };
    const starts = wn._main.filter(n => n.position.y < 0.5 && n.position.y > -0.5);
    const mode = game.params.get('mode2') || 'hurt';
    const N = parseInt(game.params.get('n') || '12', 10);
    for (let k = 0; k < N; k++) {
      const s = starts[Math.floor(((k + 0.5) * starts.length) / N)];
      bot.velocity.set(0, 0, 0);
      teleports = 0;
      bot.teleportTo(s.position.clone().add({ x: 0, y: 0.02, z: 0 }), 0);
      teleports = 0; rescueCalls = 0;
      br._ignored.clear(); br.pickupCheckAt = 0; br.roamFailures = 0;
      bot.health = mode === 'hurt' ? 45 : 100;
      br.enterState('roam', game.time);
      br.waitUntil = 0;
      await step(game, 0.8, DT);
      const pre = { state: br.state, hasGoal: nav.hasGoal };
      // launch straight up (rocket splash / pad): ~10 m apex
      bot.applyImpulse({ x: 0, y: 22, z: 0, isVector3: false });
      const y0 = bot.position.y;
      let maxGap = 0, ignAir = 0, tpAir = 0, states = new Set(), ignMax = 0, minRoamF = 0;
      let t = 0, groundAt = -1;
      await step(game, 3.5, DT, (i, dt) => {
        t += dt;
        maxGap = Math.max(maxGap, bot.position.y - y0);
        states.add(br.state);
        ignMax = Math.max(ignMax, [...br._ignored.values()].filter(u => u - game.time > 30).length);
        if (bot.onGround && t > 0.3 && groundAt < 0) groundAt = t;
        return true;
      });
      C.trials.push({ k, pre, maxGap: f(maxGap), states: [...states].join('>'), blacklistedWhileFlying: ignMax, teleports, rescueCalls, landedAt: f(groundAt), roamFailuresEnd: br.roamFailures });
    }
    C.summary = { n: C.trials.length, withBlacklist: C.trials.filter(x => x.blacklistedWhileFlying > 0).length, withRescueCall: C.trials.filter(x => x.rescueCalls > 0).length, withTeleport: C.trials.filter(x => x.teleports > 0).length };
  } catch (err) { C.error = String(err && err.stack || err); console.error('[scen_air]', err); }
  game.autotest.duration = 0;
}
export function drive() {}
