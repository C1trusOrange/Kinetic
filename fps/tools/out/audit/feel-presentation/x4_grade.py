import sys, json, time
from common import *
import pngtool
import sess as _sess

def mk_session(W, H):
    for a in range(5):
        try:
            return Session(W, H)
        except Exception as e:
            print('[retry session]', e); time.sleep(4)
    raise SystemExit('no chrome')

m = sys.argv[1]
W, H = 1280, 720
PARAMS = {
  'foundry': dict(uVig=0.30, uLift=0.010, lift=[0.75, 0.95, 1.25], uSat=1.08, uCon=1.05, gain=[1.02, 1.0, 0.98]),
  'skyline': dict(uVig=0.30, uLift=0.014, lift=[0.85, 0.95, 1.20], uSat=0.90, uCon=1.06, gain=[1.0, 1.02, 1.0]),
  'ruins':   dict(uVig=0.28, uLift=0.0, lift=[1, 1, 1], uSat=1.10, uCon=1.14, gain=[1.03, 1.0, 0.94]),
  'sandbox': dict(uVig=0.25, uLift=0.0, lift=[1, 1, 1], uSat=1.05, uCon=1.08, gain=[1.0, 1.0, 1.0]),
}
P = PARAMS[m]
SETUP = r"""
(async () => {
  const THREE = await import('/vendor/three/build/three.module.js');
  const { ShaderPass } = await import('/vendor/three/examples/jsm/postprocessing/ShaderPass.js');
  const P = %s;
  const GRADE = {
    uniforms: { tDiffuse: { value: null }, uVig: { value: P.uVig }, uLift: { value: P.uLift }, uLiftTint: { value: new THREE.Vector3(...P.lift) }, uSat: { value: P.uSat }, uCon: { value: P.uCon }, uGain: { value: new THREE.Vector3(...P.gain) } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform float uVig, uLift, uSat, uCon; uniform vec3 uLiftTint, uGain; varying vec2 vUv;
      void main(){ vec4 c = texture2D(tDiffuse, vUv); float l = dot(c.rgb, vec3(0.2126,0.7152,0.0722));
      c.rgb += uLift * uLiftTint * (1.0 - smoothstep(0.0, 0.3, l));
      l = dot(c.rgb, vec3(0.2126,0.7152,0.0722));
      c.rgb = mix(vec3(l), c.rgb, uSat); c.rgb = max((c.rgb - 0.18) * uCon + 0.18, 0.0); c.rgb *= uGain;
      vec2 d = (vUv - 0.5) * vec2(1.0, 0.85); float v = smoothstep(0.9, 0.3, length(d)); c.rgb *= mix(1.0 - uVig, 1.0, v); gl_FragColor = c; }`
  };
  window.__grade = new ShaderPass(GRADE);
  return true;
})()
""" % json.dumps(P)
s = mk_session(W, H)
open_game(s, m, bots=0)
s.run("__GAME__.hud.show(false);")
cams = s.js("""(() => { const w = __GAME__.world; const sp = w.spawnPoints.slice().sort((a,b)=>a.position.y-b.position.y);
  const pick = [sp[0], sp[Math.floor(sp.length/2)], sp[sp.length-1], sp[Math.floor(sp.length*0.25)]];
  return pick.map(s => [s.position.x, s.position.y+1.7, s.position.z, s.yaw, -0.03]); })()""")
s.run(SETUP)
out = {}
for ci, cam in enumerate(cams):
    s.run(f"__GAME__.fixedCam = {json.dumps(cam)};")
    s.run("const g=__GAME__; const i=g.composer.passes.indexOf(window.__grade); if(i>=0) g.composer.passes.splice(i,1);")
    s.wait(1.5)
    fa = f'x4_{m}_c{ci}_base.png'; s.shot(fa)
    s.run("const g=__GAME__; g.composer.insertPass(window.__grade, g.composer.passes.length-1);")
    s.wait(1.0)
    fb = f'x4_{m}_c{ci}_grade.png'; s.shot(fb)
    out[ci] = dict(base=pngtool.stats(fa), grade=pngtool.stats(fb))
    print(m, ci, out[ci])
s.close()
json.dump(out, open(f'x4_{m}.json', 'w'), indent=1)
