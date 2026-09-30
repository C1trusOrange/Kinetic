import { installProfiler } from '../prof.js';
{
  // top-level: runs before startMatch(); injects CSS experiments
  const q = new URLSearchParams(location.search);
  const css = { b: '*{transition:none!important;animation:none!important}', c: '.k-loading{display:none!important}', d: '*{backdrop-filter:none!important;filter:none!important}', e: '.k-menu{display:none!important}', f: '.k-loading *{animation:none!important;filter:none!important} .k-loading{transition:none!important}', g: '#ui{display:none!important}', h: '.k-hud{display:none!important}', i: '.k-hud *{clip-path:none!important}', j: '.k-hud *{text-shadow:none!important;box-shadow:none!important;filter:none!important}', k: '.k-hud *{will-change:auto!important;transition:none!important;animation:none!important}', l: '.k-hud svg{display:none!important}', m: '.hud-fx,.hud-di,.hud-scope{display:none!important}', n: '.hud-top,.hud-topleft,.hud-feed,.hud-announce,.hud-toasts,.hud-vitals,.hud-ammo,.hud-move{display:none!important}', o: '.hud-death,.hud-board,.hud-hint,.hud-shield{display:none!important}', p: '.hud-cross,.hud-hit,.hud-prog,.hud-prompt,.hud-killtext,.hud-nums{display:none!important}', q: '.hud-speed{display:none!important}' }[q.get('css')];
  if (css) { const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st); }
}
export async function setup(game, report) {
  report.custom = report.custom || {};
  const q = new URLSearchParams(location.search);
  if (q.get('warm') === '1') {
    // proposed fix: compile the *render-target* variants of every program (world + viewmodel) once, before play
    const r = game.renderer;
    const t0 = performance.now();
    const n0 = r.info.programs.length;
    const rt = game.composer ? game.composer.renderTarget1 : null;
    game.projectiles._warmed = true; // skip the (wrong-variant) in-game warm-up
    r.setRenderTarget(rt);
    // make pools visible so lights/instances are set up like in play (materials are traversed regardless of visibility)
    r.compile(game.scene, game.camera);
    r.compile(game.viewScene, game.viewCamera);
    r.setRenderTarget(null);
    { const gl = r.getContext(); for (const p of r.info.programs) gl.getProgramParameter(p.program, gl.LINK_STATUS); }
    report.custom.warmMs = +(performance.now() - t0).toFixed(1);
    report.custom.warmNewProgs = r.info.programs.length - n0;
  }
  if (q.get('hide') === '1') { game.uiRoot.style.display = 'none'; }
  if (q.get('noview') === '1') { game.viewPass && (game.viewPass.enabled = false); game._showViewModel = () => false; }
  installProfiler(game, report, { finish: q.get('fin') === '1' });
  report.custom.startProgs = game.renderer.info.programs.length;
}
export function drive(t, dt, game, report) {
  // default full script
  const inp = game.input;
  const S = (a, b) => t >= a && t < b;
  inp.setVirtual('forward', S(1, 9.5) || S(12, 17));
  inp.setVirtual('sprint', S(1.3, 4.2) || S(14, 16));
  inp.setVirtual('jump', S(2.4, 2.5) || S(2.9, 3.0) || S(10.45, 10.55) || S(13.6, 13.7) || S(15.2, 15.3));
  inp.setVirtual('crouch', S(3.6, 4.4));
  inp.setVirtual('ads', S(5.6, 6.4));
  inp.setVirtual('fire', S(4.8, 6.4) || S(7.0, 7.05) || S(7.35, 7.4) || S(7.7, 7.75) || S(8.3, 8.35) || S(9.6, 9.65) || S(10.5, 10.55));
  inp.setVirtual('reload', S(6.5, 6.55));
  inp.setVirtual('weapon1', S(6.8, 6.85));
  inp.setVirtual('weapon3', S(8.0, 8.05));
  if (t >= 9.0 && !game.__gave) { game.__gave = true; game.weapons.giveWeapon('sniper'); game.weapons.giveWeapon('rocket'); }
  inp.setVirtual('weapon4', S(9.1, 9.15));
  inp.setVirtual('weapon5', S(10.0, 10.05));
  inp.setVirtual('grenade', S(11.0, 11.6));
  inp.setVirtual('weapon2', S(11.8, 11.85));
  inp.setVirtual('grapple', S(12.3, 12.35) || S(13.5, 13.55));
  inp.setVirtual('melee', S(16.5, 16.55));
  let lx = 0, ly = 0;
  if (S(4.8, 6.4)) lx = 250;
  if (S(10.2, 10.45)) ly = 2400;
  if (S(10.7, 10.95)) ly = -2400;
  if (S(12.0, 12.3)) ly = -800;
  if (S(13.8, 14.1)) ly = 800;
  if (S(14, 17)) lx = 140;
  inp.addLook(lx * dt, ly * dt);
}
export function finish(game, report) {
  report.custom.prof = window.__PROF__.summary();
}
