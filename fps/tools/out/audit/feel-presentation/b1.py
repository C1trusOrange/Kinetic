import sys, json
from common import *
W = int(sys.argv[1]); H = int(sys.argv[2]); m = sys.argv[3]; mode = sys.argv[4] if len(sys.argv) > 4 else 'tdm'
FIND = r"""
((which, d) => {
  const g = __GAME__, p = g.player, w = g.world;
  const bots = g.bots.list.filter(b => b.alive && (which === 'enemy' ? b.team !== p.team : b.team === p.team));
  const out = [];
  for (const b of bots) {
    const c = b.getChestPosition(b.position.clone());
    for (let k = 0; k < 24; k++) {
      const a = k / 24 * Math.PI * 2;
      const px = b.position.x + Math.cos(a) * d, pz = b.position.z + Math.sin(a) * d;
      const from = b.position.clone(); from.x = px; from.z = pz; from.y = b.position.y + 1.5;
      const down = w.raycast(from, {x:0,y:-1,z:0, clone(){return this}}, 3);
      let fy = null;
      if (down && down.point) fy = down.point.y; else continue;
      if (Math.abs(fy - b.position.y) > 0.6) continue;
      const eye = from.clone(); eye.y = fy + 1.65;
      if (!g.combat.canSee(eye, c)) continue;
      const dx = c.x - eye.x, dy = c.y - eye.y, dz = c.z - eye.z;
      out.push({name: b.name, team: b.team, cam: [eye.x, eye.y, eye.z, Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))]});
      break;
    }
    if (out.length) break;
  }
  return out;
})
"""
s = Session(W, H)
open_game(s, m, bots=8, mode=mode)
s.run("__GAME__.hud.show(false); __GAME__.player.god = true;")
s.wait(9)
s.run("__GAME__.timeScale = 0;")
s.wait(0.5)
for which in ['enemy', 'ally']:
    for d in ([8, 20, 40] if which == 'enemy' else [12]):
        r = s.js(f"({FIND})('{which}', {d})")
        if not r:
            print('no', which, d); continue
        s.run(f"__GAME__.fixedCam = {json.dumps(r[0]['cam'])};")
        s.wait(0.6)
        s.shot(f'b_{m}_{mode}_{which}_{d}_{W}.png')
        print(which, d, r[0]['name'], r[0]['team'])
s.close()
