import sys, json, time
from common import *
import pngtool
def mk_session(W, H):
    for a in range(6):
        try: return Session(W, H)
        except Exception as e: print('[retry session]', e); time.sleep(5)
    raise SystemExit('no chrome')
m = sys.argv[1]; camsel = [int(x) for x in sys.argv[2].split(',')]
W, H = 1280, 720
SETUP = r"""
(async () => {
  const THREE = await import('/vendor/three/build/three.module.js');
  const { ShaderPass } = await import('/vendor/three/examples/jsm/postprocessing/ShaderPass.js');
  const GRADE = {
    uniforms: { tDiffuse: { value: null }, uVig: { value: 0.3 }, uLift: { value: 0.02 }, uLiftTint: { value: new THREE.Vector3(0.85, 0.95, 1.2) }, uSat: { value: 1.0 }, uCon: { value: 1.05 }, uGain: { value: new THREE.Vector3(1,1,1) }, uGamma: { value: 1.0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform float uVig, uLift, uSat, uCon, uGamma; uniform vec3 uLiftTint, uGain; varying vec2 vUv;
      void main(){ vec4 c = texture2D(tDiffuse, vUv); float l = dot(c.rgb, vec3(0.2126,0.7152,0.0722));
      c.rgb += uLift * uLiftTint * (1.0 - smoothstep(0.0, 0.3, l));
      c.rgb = pow(max(c.rgb, 0.0), vec3(uGamma));
      l = dot(c.rgb, vec3(0.2126,0.7152,0.0722));
      c.rgb = mix(vec3(l), c.rgb, uSat); c.rgb = max((c.rgb - 0.18) * uCon + 0.18, 0.0); c.rgb *= uGain;
      vec2 d = (vUv - 0.5) * vec2(1.0, 0.85); float v = smoothstep(0.9, 0.3, length(d)); c.rgb *= mix(1.0 - uVig, 1.0, v); gl_FragColor = c; }`
  };
  window.__grade = new ShaderPass(GRADE);
  return true;
})()
"""
VARIANTS = [('lift02', dict(uLift=0.02, uGamma=1.0)), ('lift035', dict(uLift=0.035, uGamma=1.0)), ('lift02_g085', dict(uLift=0.02, uGamma=0.85))]
s = mk_session(W, H)
open_game(s, m, bots=0)
s.run("__GAME__.hud.show(false);")
cams = s.js("""(() => { const w = __GAME__.world; const sp = w.spawnPoints.slice().sort((a,b)=>a.position.y-b.position.y);
  const pick = [sp[0], sp[Math.floor(sp.length/2)], sp[sp.length-1], sp[Math.floor(sp.length*0.25)]];
  return pick.map(s => [s.position.x, s.position.y+1.7, s.position.z, s.yaw, -0.03]); })()""")
s.run(SETUP)
res = {}
for ci in camsel:
    s.run(f"__GAME__.fixedCam = {json.dumps(cams[ci])};")
    s.run("const g=__GAME__; const i=g.composer.passes.indexOf(window.__grade); if(i>=0) g.composer.passes.splice(i,1);")
    s.wait(1.4)
    fa = f'x6_{m}_c{ci}_base.png'; s.shot(fa); res[f'c{ci}_base'] = pngtool.stats(fa)
    s.run("const g=__GAME__; g.composer.insertPass(window.__grade, g.composer.passes.length-1);")
    for name, v in VARIANTS:
        s.run(f"const u=window.__grade.uniforms; u.uLift.value={v['uLift']}; u.uGamma.value={v['uGamma']};")
        s.wait(0.8)
        fb = f'x6_{m}_c{ci}_{name}.png'; s.shot(fb); res[f'c{ci}_{name}'] = pngtool.stats(fb)
    for k, v in res.items(): print(m, k, v)
s.close()
json.dump(res, open(f'x6_{m}.json', 'w'), indent=1)
