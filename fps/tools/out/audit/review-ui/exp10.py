import sys, json, base64, os
from common import *
s = Session(1280, 720)
print('state', start_match(s, bots=2, score=25))
s.run("__GAME__.bots.update = () => {}; __GAME__.player.god = true;")
s.wait(3.0)
for title, sub in [('1 MINUTE REMAINING', ''), ('YOU TOOK THE LEAD', ''), ('LEAD LOST', 'NIMBUS IN FRONT'), ('MATCH POINT', 'BLUE TEAM'), ('UNSTOPPABLE', 'HEADSHOT · FIRST BLOOD · PAYBACK'), ('VICTORY', 'BLUE TEAM WINS')]:
    s.run(f"__GAME__.hud.announce({json.dumps(title)}, {json.dumps(sub)}, 'kill', 4000);")
    s.wait(0.5)
    print(title, s.js("(() => { const a = document.querySelector('.hud-announce'); const r = a.getBoundingClientRect(); const t = document.querySelector('[data-r=atitle]').getBoundingClientRect(); return {left: Math.round(r.left), right: Math.round(r.right), titleLeft: Math.round(t.left), titleRight: Math.round(t.right), vw: innerWidth}; })()"))
s.run("__GAME__.hud.announce('1 MINUTE REMAINING', '', 'info', 4000);")
s.wait(0.6)
s.shot('exp10_minute.png')
s.close()
