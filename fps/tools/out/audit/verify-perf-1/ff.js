// verify-perf-1: first playing frame + program variant check.
// ?warm=0 baseline; ?warm=1 = disable game's warm-ups and do one compile() with the composer RT set before first frame.
const G = window.__GAME__;
const Q = new URLSearchParams(location.search);
const warm = Q.get('warm') || '0';
const R = window.__VP1__ = { frames: [], notes: {} };
const r = G.renderer;
const gl = r.getContext();

function progInfo(p) {
  let src = '';
  try { src = gl.getShaderSource(p.fragmentShader) || ''; } catch (e) {}
  const tone = /#define TONE_MAPPING/.test(src);
  const m = src.match(/vec4 linearToOutputTexel\([^)]*\)\s*\{[^}]*\}/);
  const srgb = m ? /sRGB/.test(m[0]) : null;
  return { tone, srgb };
}
function snapshot() {
  // material -> currentProgram (for both scenes)
  const map = new Map();
  for (const root of [G.scene, G.viewScene]) {
    root.traverse(o => {
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of mats) {
        const pr = r.properties.get(m);
        if (pr && pr.currentProgram) map.set(m, pr.currentProgram);
      }
    });
  }
  return map;
}
function classify(map) {
  const c = { screen: 0, rt: 0, other: 0 };
  const seen = new Set();
  for (const p of map.values()) {
    if (seen.has(p)) continue; seen.add(p);
    const i = progInfo(p);
    if (i.tone && i.srgb) c.screen++; else if (!i.tone && i.srgb === false) c.rt++; else c.other++;
  }
  return c;
}

const origUpdate = G.update.bind(G), origRender = G.render.bind(G);
let curUpd = 0, curRen = 0, firstRenderDone = false;
G.update = function (dt) { const t = performance.now(); origUpdate(dt); curUpd = performance.now() - t; };
G.render = function () {
  if (!firstRenderDone && G.state === 'playing') {
    firstRenderDone = true;
    const before = snapshot();
    R.notes.progsBeforeFirstRender = r.info.programs.length;
    R.notes.materialsBefore = before.size;
    R.notes.classBefore = classify(before);
    const t = performance.now();
    origRender();
    curRen = performance.now() - t;
    const after = snapshot();
    let changed = 0, newlyProgrammed = 0;
    for (const [m, p] of after) {
      if (!before.has(m)) newlyProgrammed++;
      else if (before.get(m) !== p) changed++;
    }
    R.notes.progsAfterFirstRender = r.info.programs.length;
    R.notes.materialsAfter = after.size;
    R.notes.materialsProgramChangedInFirstRender = changed;
    R.notes.materialsFirstProgramInFirstRender = newlyProgrammed;
    R.notes.classAfter = classify(after);
    R.notes.firstRenderMs = +curRen.toFixed(0);
    return;
  }
  const t = performance.now(); origRender(); curRen = performance.now() - t;
};
let lastNow = performance.now(), lastProg = 0, n = 0;
(function tick() {
  requestAnimationFrame(tick);
  const now = performance.now(); const dt = now - lastNow; lastNow = now;
  const progs = r.info.programs.length;
  if (G.state === 'playing') {
    n++;
    R.frames.push({ n, gt: +G.time.toFixed(2), dt: +dt.toFixed(1), upd: +curUpd.toFixed(1), ren: +curRen.toFixed(1), np: progs - lastProg });
  }
  lastProg = progs; curUpd = 0; curRen = 0;
})();

export async function setup(game, report) {
  R.notes.warm = warm;
  R.notes.progsAtSetup = r.info.programs.length;
  R.notes.quality = Q.get('quality') || 'high';
  R.notes.hasComposer = !!game.composer;
  R.notes.projWarmed = game.projectiles._warmed;
  R.notes.wsCompiled = game.weapons._compiled;
  if (warm === '1') {
    game.projectiles._warmed = true; game.weapons._compiled = true;
    const rt = game.composer ? game.composer.renderTarget1 : null;
    const t = performance.now();
    const p0 = r.info.programs.length;
    r.setRenderTarget(rt);
    const objs = [];
    for (const o of [...game.projectiles._rocketPool, ...game.projectiles._grenadePool]) objs.push(o.group);
    r.compile(game.scene, game.camera);
    r.compile(game.viewScene, game.viewCamera);
    r.setRenderTarget(null);
    R.notes.warmMs = +(performance.now() - t).toFixed(0);
    R.notes.warmNewProgs = r.info.programs.length - p0;
  }
  report.custom = {};
}
export function drive(t, dt, game) {
  game.player.god = true;
}
export function finish(game, report) {
  const map = snapshot();
  R.notes.progsEnd = r.info.programs.length;
  R.notes.classEnd = classify(map);
  const fr = R.frames;
  report.custom = {
    notes: R.notes,
    first5: fr.slice(0, 5),
    later: fr.slice(5).filter(f => f.np > 0 || f.dt > 120).slice(0, 12),
    frames: fr.length,
  };
}
