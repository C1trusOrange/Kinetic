import sys, json, time
from common import *
import pngtool
def mk_session(W, H):
    for a in range(6):
        try: return Session(W, H)
        except Exception as e: print('[retry session]', e); time.sleep(5)
    raise SystemExit('no chrome')
MEAS = r"""
(() => {
  const q = (sel) => document.querySelector(sel);
  const out = {};
  const sels = { top: '.hud-top', tsub: '.t-sub', tlab: '.t-lab small', vitals: '.hud-vitals', ammo: '.hud-ammo', vnum: '.v-num', ammag: '.am-mag', amname: '.am-name', slotkbd: '.slot kbd', gren: '.am-gren', move: '.hud-move', spd: '.spd-num small', feed: '.hud-feed', tlmap: '.tl-map', toasts: '.hud-toasts', chips: '.chips span' };
  const W = innerWidth, H = innerHeight;
  for (const [k, s] of Object.entries(sels)) {
    const e = q(s); if (!e) continue; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
    out[k] = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), font: parseFloat(cs.fontSize).toFixed(1), areaPct: +(100 * r.width * r.height / (W * H)).toFixed(2) };
  }
  out.base = parseFloat(getComputedStyle(q('.k-hud')).fontSize);
  out.W = W; out.H = H;
  return out;
})()
"""
res = {}
s = mk_session(1280, 720)
open_game(s, 'sandbox', bots=3, extra='')
s.run("__GAME__.hud.show(true); __GAME__.player.god = true;")
s.wait(2)
for (w, h) in [(1280, 720), (1920, 1080), (2560, 1440)]:
    s.resize(w, h); s.wait(1.0)
    res[f'{w}x{h}'] = s.js(MEAS)
    print(w, h, json.dumps(res[f'{w}x{h}']))
# low HP & damage capture (bots frozen so nothing explodes)
s.resize(1280, 720); s.wait(0.8)
s.run("__GAME__.bots.update = () => {}; const p=__GAME__.player; p.god=false; p.health=17; p.armor=0;")
s.wait(1.2); s.shot('x7_lowhp.png')
s.run("const p=__GAME__.player; p.health=100; p.god=true; ")
# spawn protection look
s.run("const p=__GAME__.player; p.spawnProtectedUntil = __GAME__.time + 2.5;")
s.wait(0.6); s.shot('x7_shield.png')
s.close()
json.dump(res, open('x7_hud.json', 'w'), indent=1)
