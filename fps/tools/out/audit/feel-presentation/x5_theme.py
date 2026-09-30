import sys, json, time
from common import *
import pngtool

def mk_session(W, H):
    for a in range(6):
        try:
            return Session(W, H)
        except Exception as e:
            print('[retry session]', e); time.sleep(5)
    raise SystemExit('no chrome')

m = sys.argv[1]
W, H = 1280, 720
TW = {
  'ruins':   dict(hemi=0.60, env=0.40, sun=4.2, fogNear=30, fogFar=210, fogColor='#e8c99a', exposure=1.0,
                  grade=dict(uVig=0.28, uLift=0.0, lift=[1,1,1], uSat=1.10, uCon=1.14, gain=[1.03, 1.0, 0.94])),
  'skyline': dict(hemi=1.10, env=0.85, sun=2.7, fogNear=60, fogFar=270, fogColor='#7f4c8c', exposure=1.12,
                  grade=dict(uVig=0.30, uLift=0.012, lift=[0.85,0.95,1.2], uSat=0.92, uCon=1.06, gain=[1.0,1.02,1.0])),
  'foundry': dict(hemi=1.25, env=0.70, sun=1.5, fogNear=55, fogFar=230, fogColor='#1a2650', exposure=1.22,
                  grade=dict(uVig=0.30, uLift=0.010, lift=[0.75,0.95,1.25], uSat=1.08, uCon=1.05, gain=[1.02,1.0,0.98])),
}[m]
GR = TW['grade']
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
  window.__THREE = THREE;
  return true;
})()
""" % json.dumps(GR)
TWEAK = """(() => { const g=__GAME__, w=g.world, sc=g.scene, T=%s;
  w.hemi.intensity=T.hemi; sc.environmentIntensity=T.env; w.sun.intensity=T.sun; g.renderer.toneMappingExposure=T.exposure;
  sc.fog.near=T.fogNear; sc.fog.far=T.fogFar; sc.fog.color.set(T.fogColor); if (w.sky) w.sky.material.uniforms.uFogColor.value.set(T.fogColor); return true; })()""" % json.dumps(TW)
RESTORE = """(() => { const g=__GAME__, w=g.world, sc=g.scene, L=w.lighting, d=w.def.theme;
  w.hemi.intensity=L.hemiIntensity; sc.environmentIntensity=L.envIntensity; w.sun.intensity=L.sunIntensity; g.renderer.toneMappingExposure=L.exposure;
  sc.fog.near=d.fog.near; sc.fog.far=d.fog.far; sc.fog.color.set(d.fog.color); if (w.sky) w.sky.material.uniforms.uFogColor.value.set(d.fog.color); return true; })()"""
s = mk_session(W, H)
open_game(s, m, bots=0)
s.run("__GAME__.hud.show(false);")
cams = s.js("""(() => { const w = __GAME__.world; const sp = w.spawnPoints.slice().sort((a,b)=>a.position.y-b.position.y);
  const pick = [sp[0], sp[Math.floor(sp.length/2)], sp[sp.length-1], sp[Math.floor(sp.length*0.25)]];
  return pick.map(s => [s.position.x, s.position.y+1.7, s.position.z, s.yaw, -0.03]); })()""")
# sun-facing camera
sundir = s.js("(() => { const d = __GAME__.world.lighting.sunDirection; return [d.x, d.y, d.z]; })()")
import math
p0 = cams[0]
yaw = math.atan2(-sundir[0], -sundir[2]); pitch = min(1.0, math.atan2(sundir[1], math.hypot(sundir[0], sundir[2])))
cams.append([p0[0], p0[1], p0[2], yaw, pitch * 0.7])
s.run(SETUP)
out = {}
for ci, cam in enumerate(cams):
    s.run(f"__GAME__.fixedCam = {json.dumps(cam)};")
    s.run("const g=__GAME__; const i=g.composer.passes.indexOf(window.__grade); if(i>=0) g.composer.passes.splice(i,1);")
    s.js(RESTORE)
    s.wait(1.4)
    fa = f'x5_{m}_c{ci}_base.png'; s.shot(fa)
    s.js(TWEAK); s.wait(1.0)
    fb = f'x5_{m}_c{ci}_tweak.png'; s.shot(fb)
    s.run("const g=__GAME__; g.composer.insertPass(window.__grade, g.composer.passes.length-1);"); s.wait(1.0)
    fc = f'x5_{m}_c{ci}_tweak_grade.png'; s.shot(fc)
    out[ci] = dict(base=pngtool.stats(fa), tweak=pngtool.stats(fb), grade=pngtool.stats(fc))
    print(m, ci, out[ci])
s.close()
json.dump(out, open(f'x5_{m}.json', 'w'), indent=1)
