import sys, json, base64, os
from common import *
from sess import HERE
s = Session(1280, 720)
print('state', start_match(s, bots=7, score=25))
s.run("__GAME__.bots.update = () => {}; __GAME__.player.god = true;")
s.wait(2.0)
def clip(name):
    box = s.js("(() => { const b = document.querySelector('.grap').getBoundingClientRect(); return [b.x, b.y, b.width, b.height]; })()")
    data = s.cdp.call('Page.captureScreenshot', {'format':'png','clip':{'x':box[0]-15,'y':box[1]-15,'width':box[2]+30,'height':box[3]+30,'scale':4}}, timeout=60)['data']
    open(os.path.join(HERE, name), 'wb').write(base64.b64decode(data))
for cd, tag in ((100, '0.5'), (180, '0.1'), (0, '1.0')):
    s.run(f"const G=__GAME__.player.grapple; G.state='idle'; G.cooldownTotal=200; G.cooldown={cd};")
    s.wait(0.5)
    print(tag, 'charge', s.js("__GAME__.player.grappleCharge"), 'offset', s.js("document.querySelector('.grap .arc').style.strokeDashoffset"), 'cls', s.js("document.querySelector('.grap').className"))
    clip(f'v3_grap_{tag}.png')
s.close()
