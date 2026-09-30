import sys, json
from common import *
W = int(sys.argv[1]); H = int(sys.argv[2]); m = sys.argv[3] if len(sys.argv) > 3 else 'foundry'
SETUP = r"""
(async () => {
  const THREE = await import('/vendor/three/build/three.module.js');
  const { ShaderPass } = await import('/vendor/three/examples/jsm/postprocessing/ShaderPass.js');
  const { FXAAShader } = await import('/vendor/three/examples/jsm/shaders/FXAAShader.js');
  const g = __GAME__; const gl = g.renderer.getContext();
  const orig = g.render.bind(g);
  window.__samples = []; window.__rec = false;
  g.render = function () { const t0 = performance.now(); orig(); gl.finish(); const t1 = performance.now(); if (window.__rec) window.__samples.push(t1 - t0); };
  const GRADE = {
    uniforms: { tDiffuse: { value: null }, uVig: { value: 0.35 }, uSat: { value: 1.08 }, uContrast: { value: 1.06 }, uTint: { value: new THREE.Vector3(1.0, 0.99, 1.02) } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform float uVig, uSat, uContrast; uniform vec3 uTint; varying vec2 vUv;
      void main(){ vec4 c = texture2D(tDiffuse, vUv); float l = dot(c.rgb, vec3(0.2126,0.7152,0.0722));
      c.rgb = mix(vec3(l), c.rgb, uSat); c.rgb = (c.rgb - 0.18) * uContrast + 0.18; c.rgb *= uTint;
      vec2 d = vUv - 0.5; float v = smoothstep(0.85, 0.25, length(d * vec2(1.0, 0.85))); c.rgb *= mix(1.0 - uVig, 1.0, v); gl_FragColor = c; }`
  };
  window.__mk = { ShaderPass, FXAAShader, GRADE, THREE };
  return true;
})()
"""
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
open_game(s, m, bots=0)
s.run("__GAME__.hud.show(false);")
cams = s.js("""(() => { const w = __GAME__.world; const sp = w.spawnPoints.slice().sort((a,b)=>a.position.y-b.position.y); const s = sp[Math.floor(sp.length/2)]; const p = s.position; return [p.x, p.y+1.7, p.z, s.yaw, -0.03]; })()""")
s.run(f"__GAME__.fixedCam = {json.dumps(cams)};")
s.run(SETUP)
s.wait(2)
print('canvas', s.js("({w: __GAME__.renderer.domElement.width, h: __GAME__.renderer.domElement.height, pr: __GAME__.renderer.getPixelRatio(), msaa: __GAME__.quality.msaa, bloom: !!__GAME__.bloomPass})"))
def meas(label, n=80):
    s.wait(0.5)
    r = s.run(f"return await ({MEASURE})({n});", timeout=120)
    print(f'{label:34s}', r)
    return r
results = {}
for rnd in range(2):
    results.setdefault('high', []).append(meas('high (msaa4, bloom)'))
    s.run("__GAME__.bloomPass.enabled = false;")
    results.setdefault('high-nobloom', []).append(meas('high, bloom pass disabled'))
    s.run("__GAME__.bloomPass.enabled = true;")
    # add grade pass
    s.run("""const g=__GAME__, mk=window.__mk; if(!window.__grade){ window.__grade = new mk.ShaderPass(mk.GRADE); } g.composer.insertPass(window.__grade, g.composer.passes.length-1);""")
    results.setdefault('high+grade', []).append(meas('high + vignette/grade pass'))
    s.run("""const g=__GAME__; const i=g.composer.passes.indexOf(window.__grade); if(i>=0) g.composer.passes.splice(i,1);""")
    s.run("__GAME__.viewPass.enabled = false; __GAME__.composer.render = __GAME__.composer.render;")
print(json.dumps(results))
# quality presets
for q in ['medium', 'low', 'high']:
    s.run(f"__GAME__.setQuality('{q}'); __GAME__.fixedCam = {json.dumps(cams)}; window.__samples.length=0;")
    s.wait(2)
    print(q, s.js("({w: __GAME__.renderer.domElement.width, h: __GAME__.renderer.domElement.height, composer: !!__GAME__.composer})"))
    results.setdefault('q_'+q, []).append(meas('quality '+q))
    if q == 'medium':
        s.run("""const g=__GAME__, mk=window.__mk; const f = new mk.ShaderPass(mk.FXAAShader); const pr = g.renderer.getPixelRatio(); f.material.uniforms['resolution'].value.set(1/(g.renderer.domElement.width), 1/(g.renderer.domElement.height)); window.__fxaa=f; g.composer.insertPass(f, g.composer.passes.length-1);""")
        results.setdefault('q_medium+fxaa', []).append(meas('medium + FXAA'))
        s.run("""const g=__GAME__; const i=g.composer.passes.indexOf(window.__fxaa); if(i>=0) g.composer.passes.splice(i,1);""")
json.dump(results, open(f'perf_{m}_{W}.json','w'), indent=1)
s.close()
