import sys, json, base64, os
from common import *
s = Session(1280, 720)
print('state', start_match(s, bots=7, score=25))
s.run("__GAME__.bots.update = () => {}; __GAME__.player.god = true;")
s.wait(2.5)

# ---- 1. announce transform
s.run("__GAME__.hud.announce('DOUBLE KILL', 'HEADSHOT', 'kill', 2000);")
s.wait(0.4)
print('ANNOUNCE mid', json.dumps(s.js("""(() => { const a = document.querySelector('.hud-announce'); const r = a.getBoundingClientRect(); const t = document.querySelector('[data-r=atitle]').getBoundingClientRect();
 const an = a.getAnimations()[0]; return {vw: innerWidth, annLeft: r.left, annRight: r.right, titleCenter: (t.left+t.right)/2, tf: getComputedStyle(a).transform, cssTransform: 'translateX(-50%) in CSS', composite: an && an.effect.getComputedTiming ? an.effect.composite : null, op: getComputedStyle(a).opacity}; })()""")))
s.shot('v2_announce.png')
s.wait(2.4)
print('ANNOUNCE idle', json.dumps(s.js("(() => { const a = document.querySelector('.hud-announce'); const r = a.getBoundingClientRect(); return {center:(r.left+r.right)/2, tf: getComputedStyle(a).transform, op: getComputedStyle(a).opacity}; })()")))
s.run("__GAME__.hud.announce('1 MINUTE REMAINING', '', 'info', 1700);")
s.wait(0.5)
print('MINUTE', json.dumps(s.js("(() => { const r = document.querySelector('[data-r=atitle]').getBoundingClientRect(); return {left:r.left,right:r.right,vw:innerWidth}; })()")))
s.shot('v2_minute.png')
s.wait(2.0)
# kill text
s.run("const g = __GAME__; const bot = g.bots.list[0]; g.combat.kill(bot, {attacker: g.player, weapon: 'rifle', headshot: false});")
s.wait(0.3)
print('KILLTEXT', json.dumps(s.js("(() => { const k = document.querySelector('.hud-killtext'); const r = k.getBoundingClientRect(); return {center:(r.left+r.right)/2, left:r.left, right:r.right, vw: innerWidth, tf:getComputedStyle(k).transform, txt:k.textContent}; })()")))
s.shot('v2_kill.png')
s.wait(2.0)

# ---- 2. grapple ring
print('GRAPPLE', json.dumps(s.js("""(() => { const arc = document.querySelector('.grap .arc'), trk = document.querySelector('.grap .trk');
 const a = getComputedStyle(arc), t = getComputedStyle(trk);
 return {arc: {dash: a.strokeDasharray, off: a.strokeDashoffset, fill: a.fill, stroke: a.stroke, w: a.strokeWidth}, trk: {stroke: t.stroke, fill: t.fill, dash: t.strokeDasharray}, charge: __GAME__.player.grappleCharge, attrOff: arc.style.strokeDashoffset}; })()""")))
# force charge and screenshot clip
s.run("const g=__GAME__; g.player.grappleCharge = 0.4; window.__gc = setInterval(() => { g.player.grappleCharge = 0.4; }, 5);")
s.wait(0.5)
box = s.js("(() => { const b = document.querySelector('.grap').getBoundingClientRect(); return [b.x, b.y, b.width, b.height]; })()")
print('grap box', box, 'charge now', s.js("__GAME__.player.grappleCharge"), 'offset', s.js("document.querySelector('.grap .arc').style.strokeDashoffset"))
data = s.cdp.call('Page.captureScreenshot', {'format':'png','clip':{'x':box[0]-20,'y':box[1]-20,'width':box[2]+40,'height':box[3]+40,'scale':4}}, timeout=60)['data']
open(os.path.join(HERE, 'v2_grap_0.4.png'), 'wb').write(base64.b64decode(data))
s.run("clearInterval(window.__gc);")
s.close()
