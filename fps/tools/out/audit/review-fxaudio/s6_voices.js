import * as THREE from 'three';
const st = {};
export function setup(game, report) { report.custom = { log: [] }; game.player.god = true; }
export function drive(t, dt, game, report) {
  const a = game.audio, c = report.custom;
  if (t > 1 && !st.a) {
    st.a = true;
    const names = ['pistol_fire', 'rifle_fire', 'shotgun_fire', 'explosion', 'impact_metal', 'impact_concrete', 'footstep', 'bot_death', 'grenade_bounce', 'impact_robot', 'hitmarker', 'jump', 'land', 'melee_hit'];
    let played = 0, nulls = 0;
    for (let i = 0; i < 300; i++) {
      const n = names[i % names.length];
      const v = a.play(n, { position: new THREE.Vector3(Math.random() * 20 - 10, 1, Math.random() * 20 - 10) });
      if (v) played++; else nulls++;
    }
    c.burst = { played, nulls, voices: a.voices.length, hrtf: a._hrtf, max: 32 };
    // check for duplicates in voices list
    c.burst.unique = new Set(a.voices).size === a.voices.length;
  }
  if (t > 7 && !st.b) {
    st.b = true;
    c.after = { voices: a.voices.length, hrtf: a._hrtf, loops: a.loops.size };
    // suspended context behaviour
    a.ctx.suspend().then(() => {
      c.suspended = { state: a.ctx.state, play: a.play('pistol_fire') === null };
      let loop; try { loop = a.playLoop('slide'); c.suspended.loopOk = !!loop; loop.stop(); } catch (e) { c.suspended.loopErr = String(e.message); }
      a.unlock(); a.unlock();
      setTimeout(() => { c.suspended.afterUnlock = a.ctx.state; window.__S6DONE__ = true; }, 800);
    });
  }
}
export function finish() {}
