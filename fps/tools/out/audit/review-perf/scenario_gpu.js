// GPU time per composer pass via EXT_disjoint_timer_query_webgl2, and the shadow-map cost by alternating shadowMap.autoUpdate.
const G = window.__GAME__;
const S = { pending: [], res: {}, shadowOn: [], shadowOff: [], frame: 0 };
export function setup(game, report) {
  const gl = game.renderer.getContext();
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  S.ext = ext; S.gl = gl;
  report.custom = { hasTimer: !!ext };
  if (!ext || !game.composer) return;
  const names = game.composer.passes.map((p, i) => i + ':' + p.constructor.name);
  game.composer.passes.forEach((pass, i) => {
    const o = pass.render.bind(pass);
    pass.render = function (...a) {
      if (S.active) return o(...a);
      const q = gl.createQuery();
      gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
      S.active = true;
      const r = o(...a);
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      S.active = false;
      S.pending.push({ q, name: names[i] + (i === 0 || i === 1 ? '' : ''), shadow: S.curShadow, f: S.frame });
      return r;
    };
  });
  S.names = names;
  const ou = game.update.bind(game);
  game.update = function (dt) { ou(dt); };
}
function poll() {
  const gl = S.gl, ext = S.ext;
  const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
  const keep = [];
  for (const p of S.pending) {
    if (gl.getQueryParameter(p.q, gl.QUERY_RESULT_AVAILABLE)) {
      if (!disjoint) {
        const ms = gl.getQueryParameter(p.q, gl.QUERY_RESULT) / 1e6;
        const k = p.name + (p.shadow ? ' [shadowUpdate]' : ' [shadowSkip]');
        (S.res[k] = S.res[k] || []).push(ms);
      }
      gl.deleteQuery(p.q);
    } else keep.push(p);
  }
  S.pending = keep;
}
export function drive(t, dt, game, report) {
  game.player.god = true;
  const inp = game.input;
  const tt = t % 17;
  const s = (a, b) => tt >= a && tt < b;
  inp.setVirtual('forward', s(1, 9.5) || s(12, 17));
  inp.setVirtual('fire', s(4.8, 6.4) || s(7.0, 7.05));
  inp.addLook((s(4.8, 6.4) ? 250 : s(14, 17) ? 140 : 0) * dt, 0);
  if (!S.ext || t < 3) return;
  S.frame++;
  const on = (S.frame % 2) === 0;
  S.curShadow = on;
  game.renderer.shadowMap.autoUpdate = on;
  game.renderer.shadowMap.needsUpdate = false;
  poll();
}
const med = a => { const s = a.slice().sort((x, y) => x - y); return s.length ? +s[Math.floor(s.length / 2)].toFixed(3) : 0; };
export function finish(game, report) {
  poll();
  const out = {};
  for (const [k, v] of Object.entries(S.res)) out[k] = { n: v.length, median: med(v), mean: +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(3), p90: +v.slice().sort((a, b) => a - b)[Math.floor(v.length * 0.9)].toFixed(3) };
  report.custom = { hasTimer: !!S.ext, names: S.names, passes: out, size: [game.renderer.domElement.width, game.renderer.domElement.height], quality: game.quality.name, bots: game.bots.list.length };
}
