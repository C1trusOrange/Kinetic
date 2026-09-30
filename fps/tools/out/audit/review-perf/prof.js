// Profiler helper for perf audit: per-frame timing, GL call attribution, new-program tracking.
export function installProfiler(game, report, opts = {}) {
  const renderer = game.renderer;
  const info = renderer.info;
  const gl = renderer.getContext();
  const P = { frames: [], cur: null, lastNow: 0, progSeen: new Set(), glTot: {}, slowThreshold: opts.slow ?? 40 };
  for (const p of info.programs) P.progSeen.add(p.id);
  // wrap GL calls
  const glNames = ['linkProgram', 'compileShader', 'getProgramParameter', 'getProgramInfoLog', 'getShaderParameter', 'texImage2D', 'texSubImage2D', 'texStorage2D', 'compressedTexImage2D', 'bufferData', 'bufferSubData', 'generateMipmap', 'readPixels', 'finish', 'flush', 'useProgram', 'drawElements', 'drawArrays', 'drawElementsInstanced', 'uniformMatrix4fv', 'createProgram', 'getUniformLocation', 'getActiveUniform', 'getActiveAttrib'];
  for (const n of glNames) {
    if (typeof gl[n] !== 'function') continue;
    const o = gl[n];
    gl[n] = function (...a) {
      const t = performance.now();
      const r = o.apply(gl, a);
      const d = performance.now() - t;
      P.glTot[n] = (P.glTot[n] || 0) + d;
      if (P.cur) { const g = P.cur.gl; const e = g[n] || (g[n] = { n: 0, ms: 0 }); e.n++; e.ms += d; }
      return r;
    };
  }
  const wrap = (obj, name, label) => {
    if (!obj || typeof obj[name] !== 'function') return;
    const o = obj[name];
    obj[name] = function (...a) {
      const t = performance.now();
      const r = o.apply(this, a);
      const d = performance.now() - t;
      if (P.cur) P.cur.parts[label] = (P.cur.parts[label] || 0) + d;
      return r;
    };
  };
  wrap(game.player, 'update', 'player.update');
  wrap(game.weapons, 'update', 'weapons.update');
  wrap(game.bots, 'update', 'bots.update');
  wrap(game.projectiles, 'update', 'projectiles.update');
  wrap(game.world, 'update', 'world.update');
  wrap(game.effects, 'update', 'effects.update');
  wrap(game.player, 'updateCamera', 'player.updateCamera');
  wrap(game.weapons, 'updateViewModel', 'weapons.updateViewModel');
  wrap(game.audio, 'update', 'audio.update');
  wrap(game.hud, 'update', 'hud.update');
  wrap(game, 'render', 'render');
  wrap(game, '_updateMatch', 'updateMatch');
  wrap(game.autotest, 'update', 'autotest.update');
  if (opts.extra) opts.extra(wrap, game);
  const origLoop = game._loop;
  game._loop = function (now) {
    const t0 = performance.now();
    const cur = { i: game.frame, interval: P.lastNow ? now - P.lastNow : 0, parts: {}, gl: {}, t: game.time, ts: +t0.toFixed(0), heap: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : 0, gap: P.lastEnd ? +(t0 - P.lastEnd).toFixed(0) : 0 };
    P.lastNow = now;
    P.cur = cur;
    const tex0 = info.memory.textures, geo0 = info.memory.geometries;
    const r = origLoop(now);
    cur.dur = performance.now() - t0;
    if (opts.finish) { const tf = performance.now(); gl.finish(); cur.finish = +(performance.now() - tf).toFixed(1); }
    P.lastEnd = performance.now(); cur.heapEnd = performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : 0;
    cur.calls = info.render.calls; cur.tris = info.render.triangles;
    cur.dTex = info.memory.textures - tex0; cur.dGeo = info.memory.geometries - geo0;
    const np = [];
    const newIds = new Set();
    for (const p of info.programs) if (!P.progSeen.has(p.id)) { P.progSeen.add(p.id); np.push(p.name + '#' + p.id); newIds.add(p.id); P.progByid = P.progByid || {}; P.progByid[p.id] = { name: p.name, key: String(p.cacheKey).slice(0, 400) }; }
    cur.newProg = np;
    if (newIds.size) {
      const users = {};
      const visit = (scene, label) => scene.traverse(o => {
        const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
        for (const m of mats) {
          const pr = renderer.properties.get(m);
          const cp = pr && pr.currentProgram;
          if (cp && newIds.has(cp.id)) {
            const k = cp.id;
            (users[k] = users[k] || []).push(label + ':' + (o.name || o.type) + '/' + m.type + (m.name ? '(' + m.name + ')' : '') + (o.isInstancedMesh ? '[inst]' : '') + (o.parent && o.parent.name ? '@' + o.parent.name : ''));
          }
        }
      });
      visit(game.scene, 'S'); visit(game.viewScene, 'V');
      cur.users = Object.fromEntries(Object.entries(users).map(([k, v]) => [k, v.slice(0, 3).concat(v.length > 3 ? ['+' + (v.length - 3)] : [])]));
      cur.newProgKeys = [...newIds].map(id => P.progByid[id] && (P.progByid[id].name + '|' + P.progByid[id].key.replace(/\s+/g, ' ')));
    }
    P.cur = null;
    P.frames.push(cur);
    return r;
  };
  P.longtasks = [];
  try {
    const po = new PerformanceObserver(list => { for (const e of list.getEntries()) P.longtasks.push({ start: +e.startTime.toFixed(0), dur: +e.duration.toFixed(0), name: e.name, attr: e.attribution && e.attribution[0] ? e.attribution[0].containerType : '' }); });
    po.observe({ type: 'longtask', buffered: true });
  } catch (e) { P.longtasks.push({ err: String(e) }); }
  window.__PROF__ = P;
  P.summary = () => {
    const fr = P.frames;
    const durs = fr.map(f => f.dur).sort((a, b) => a - b);
    const iv = fr.map(f => f.interval).filter(v => v > 0).sort((a, b) => a - b);
    const pct = (arr, q) => arr.length ? +arr[Math.min(arr.length - 1, Math.floor(arr.length * q))].toFixed(2) : 0;
    const slow = fr.filter(f => f.dur > P.slowThreshold || f.interval > 100 || f.newProg.length || (f.finish || 0) > 30);
    return {
      frames: fr.length,
      cpuMs: { p50: pct(durs, 0.5), p90: pct(durs, 0.9), p99: pct(durs, 0.99), max: pct(durs, 1) },
      intervalMs: { p50: pct(iv, 0.5), p90: pct(iv, 0.9), p99: pct(iv, 0.99), max: pct(iv, 1) },
      totalNewPrograms: P.progSeen.size,
      slow: slow.slice(0, 60).map(f => ({
        i: f.i, finish: f.finish, ts: f.ts, gap: f.gap, heap: f.heap, heapEnd: f.heapEnd, t: +f.t.toFixed(2), dur: +f.dur.toFixed(1), interval: +f.interval.toFixed(1), newProg: f.newProg.length > 12 ? f.newProg.length + ' programs' : f.newProg, users: f.users, keys: f.newProgKeys && f.newProgKeys.length <= 6 ? f.newProgKeys : undefined, dTex: f.dTex, dGeo: f.dGeo,
        parts: Object.fromEntries(Object.entries(f.parts).filter(([, v]) => v > 1).map(([k, v]) => [k, +v.toFixed(1)])),
        gl: Object.fromEntries(Object.entries(f.gl).filter(([, v]) => v.ms > 1).map(([k, v]) => [k, { n: v.n, ms: +v.ms.toFixed(1) }])),
      })),
      longtasks: P.longtasks.slice(0, 80),
      glTotalMs: Object.fromEntries(Object.entries(P.glTot).map(([k, v]) => [k, +v.toFixed(1)]).filter(([, v]) => v > 1)),
    };
  };
  return P;
}
