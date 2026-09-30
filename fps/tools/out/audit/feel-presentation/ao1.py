import sys, json
from common import *
import pngtool
W, H = int(sys.argv[1]), int(sys.argv[2])
cam = [28, 1.7, 7, 1.1361261116456518, -0.03]
MEASURE = r"""
(async (n) => {
  window.__samples.length = 0; window.__rec = true;
  while (window.__samples.length < n) await new Promise(r => setTimeout(r, 30));
  window.__rec = false;
  const a = window.__samples.slice(5).sort((x, y) => x - y);
  return { med: +a[Math.floor(a.length / 2)].toFixed(2), p10: +a[Math.floor(a.length * 0.1)].toFixed(2), p90: +a[Math.floor(a.length * 0.9)].toFixed(2), n: a.length };
})
"""
s = Session(W, H)
open_game(s, 'foundry', bots=0)
s.run("__GAME__.hud.show(false);")
s.run(f"__GAME__.fixedCam = {json.dumps(cam)};")
s.run("""
(async () => {
  const g = __GAME__; const gl = g.renderer.getContext();
  const orig = g.render.bind(g);
  window.__samples = []; window.__rec = false;
  g.render = function () { const t0 = performance.now(); orig(); gl.finish(); const t1 = performance.now(); if (window.__rec) window.__samples.push(t1 - t0); };
  const { GTAOPass } = await import('/vendor/three/examples/jsm/postprocessing/GTAOPass.js');
  window.__GTAOPass = GTAOPass;
})()
""")
s.wait(2.5)
s.shot('ao_off.png')
r0 = s.run(f"return await ({MEASURE})(70);", timeout=120); print('off', r0)
err = s.run("""
try {
  const g = __GAME__;   const ao = new window.__GTAOPass(g.scene, g.camera, g.renderer.domElement.width, g.renderer.domElement.height);
  ao.output = window.__GTAOPass.OUTPUT.Default;
  ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.2, scale: 1.0, samples: 12, distanceFallOff: 1.0, screenSpaceRadius: false });
  ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, radiusExponent: 1, rings: 2, samples: 8 });
  ao.blendIntensity = 1.0;
  window.__ao = ao;
  g.composer.insertPass(ao, 1);   // after world RenderPass, before viewmodel pass
  return 'ok';
} catch (e) { return 'ERR ' + e.message + ' ' + e.stack; }
""")
print('insert', err)
s.wait(2.0)
s.shot('ao_on.png')
r1 = s.run(f"return await ({MEASURE})(70);", timeout=120); print('gtao', r1)
s.run("__GAME__.composer.passes.splice(1,1);")
s.wait(1.0)
r2 = s.run(f"return await ({MEASURE})(70);", timeout=120); print('off again', r2)
s.close()
