import sys, json
from common import *
W = int(sys.argv[1]); H = int(sys.argv[2]); maps = sys.argv[3].split(',')
JS_CAMS = r"""
(() => {
  const g = __GAME__, w = g.world, def = w.def;
  const sp = w.spawnPoints.slice().sort((a,b)=>a.position.y-b.position.y);
  const pick = [sp[0], sp[Math.floor(sp.length/2)], sp[sp.length-1], sp[Math.floor(sp.length*0.25)]];
  const cams = [];
  const yp = (from, to) => { const dx=to[0]-from[0], dy=to[1]-from[1], dz=to[2]-from[2]; return [Math.atan2(-dx,-dz), Math.atan2(dy, Math.hypot(dx,dz))]; };
  pick.forEach((s,i)=>{ const p=s.position; cams.push({name:'sp'+i, c:[p.x,p.y+1.7,p.z,s.yaw,-0.03]}); });
  const pc = def.previewCamera;
  if (pc) { const [yaw,pitch]=yp(pc.pos, pc.lookAt); cams.push({name:'over', c:[...pc.pos, yaw, pitch]}); }
  const p0 = sp[0].position; cams.push({name:'sky', c:[p0.x,p0.y+1.7,p0.z,pick[0].yaw+0.6,0.42]});
  return cams;
})()
"""
for m in maps:
    s = Session(W, H)
    open_game(s, m, bots=6)
    cams = s.js(JS_CAMS)
    s.run("__GAME__.hud.show(false); __GAME__.player.god = true;")
    for cam in cams:
        s.run(f"__GAME__.fixedCam = {json.dumps(cam['c'])};")
        s.wait(2.0)
        s.shot(f'a_{m}_{cam["name"]}_{W}.png')
    print(m, json.dumps(cams))
    print(m, s.js("({fps: __GAME__.fps, lights: __GAME__.world.lighting && {sun: __GAME__.world.lighting.sunIntensity, hemi: __GAME__.world.lighting.hemiIntensity, env: __GAME__.world.lighting.envIntensity, exp: __GAME__.world.lighting.exposure, bloom: __GAME__.world.lighting.bloom}, fog: __GAME__.scene.fog && {near: __GAME__.scene.fog.near, far: __GAME__.scene.fog.far, density: __GAME__.scene.fog.density}})"))
    s.close()
