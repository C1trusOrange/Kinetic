import sys, json
from common import *
s = Session(1280, 720)
print('state', start_match(s, bots=15, score=25))
s.run("__GAME__.bots.update = () => {}; __GAME__.player.god = true;")
s.wait(2.0)

# ---- Finding 1: announcement transform
s.run("__GAME__.hud.announce('DOUBLE KILL', 'HEADSHOT', 'kill', 2000);")
s.wait(0.4)
print('F1 mid', s.js("(() => { const a = document.querySelector('.hud-announce'); const r = a.getBoundingClientRect(); const t = document.querySelector('[data-r=atitle]').getBoundingClientRect(); return {annLeft: r.left, annRight: r.right, annCenter: (r.left+r.right)/2, titleCenter: (t.left+t.right)/2, vw: innerWidth, tf: getComputedStyle(a).transform, op: getComputedStyle(a).opacity, css_left: getComputedStyle(a).left}; })()"))
s.shot('a_announce.png')
s.wait(2.5)
print('F1 idle', s.js("(() => { const a = document.querySelector('.hud-announce'); const r = a.getBoundingClientRect(); return {annCenter: (r.left+r.right)/2, tf: getComputedStyle(a).transform, op: getComputedStyle(a).opacity}; })()"))
# long text
s.run("__GAME__.hud.announce('1 MINUTE REMAINING', '', 'info', 2500);")
s.wait(0.5)
print('F1 minute', s.js("(() => { const a = document.querySelector('.hud-announce'); const r = a.getBoundingClientRect(); return {l: r.left, r: r.right, vw: innerWidth}; })()"))
s.shot('a_minute.png')
s.wait(2.5)
# kill text
s.run("const g = __GAME__; const bot = g.bots.list[0]; g.combat.kill(bot, {attacker: g.player, weapon: 'rifle', headshot: false});")
s.wait(0.3)
print('F1 killtext', s.js("(() => { const k = document.querySelector('.hud-killtext'); const r = k.getBoundingClientRect(); return {l: r.left, r: r.right, center: (r.left+r.right)/2, tf: getComputedStyle(k).transform, op: getComputedStyle(k).opacity, crossCenter: innerWidth/2}; })()"))
s.wait(2.0)

# ---- Finding 2: grapple ring
for ch in (0.5, 0.1):
    s.run(f"__GAME__.player.grappleCharge = {ch};")
    s.wait(0.3)
    print('F2', ch, s.js("""(() => { const a = document.querySelector('[data-r=grarc]'), t = document.querySelector('.grap .trk'); const ca = getComputedStyle(a), ct = getComputedStyle(t);
       return {arc: {dash: ca.strokeDasharray, off: ca.strokeDashoffset, fill: ca.fill, stroke: ca.stroke}, trk: {stroke: ct.stroke, fill: ct.fill, sw: ct.strokeWidth}}; })()"""))
    r = s.js("(() => { const b = document.querySelector('.grap').getBoundingClientRect(); return [b.x, b.y, b.width, b.height]; })()")
    print('grap rect', r)
    clip_shot(s, f'a_grap_{ch}.png', r[0]-20, r[1]-20, r[2]+40, r[3]+40)
s.run("__GAME__.player.grappleCharge = 1;")

# ---- Finding 8: hint / shield over board
s.run("const g = __GAME__; g.player.spawnProtectedUntil = g.time + 30; g.hud._boardForce = true;")
s.wait(1.5)
print('F8', s.js("""(() => { const q = sel => { const e = document.querySelector(sel); const r = e.getBoundingClientRect(); return {x: Math.round(r.x), y: Math.round(r.y), r: Math.round(r.right), b: Math.round(r.bottom), op: getComputedStyle(e).opacity}; };
  const hint = document.querySelector('.hud-hint'), sh = document.querySelector('.hud-shield');
  const pr = document.querySelector('.board-panel').getBoundingClientRect();
  const out = {panel: [Math.round(pr.x), Math.round(pr.y), Math.round(pr.right), Math.round(pr.bottom)], hint: q('.hud-hint'), hintTxt: hint.textContent, shield: q('.hud-shield'), boardInfo: q('.board-head')};
  const sr = sh.getBoundingClientRect();
  const top = document.elementFromPoint(sr.x + sr.width/2, sr.y + 4);
  out.topAtShield = top && (top.className || top.tagName);
  const hr = hint.getBoundingClientRect();
  const top2 = document.elementFromPoint(hr.x + hr.width/2, hr.y + hr.height/2);
  out.topAtHint = top2 && (top2.className || top2.tagName);
  return out; })()"""))
s.shot('a_board.png')
s.run("__GAME__.hud._boardForce = false; __GAME__.player.spawnProtectedUntil = 0;")

# ---- Finding 3 + 9: settings
s.run("__GAME__.pause();")
s.wait(0.8)
s.click('[data-act=settings]')
s.wait(0.6)
print('quality before', s.js("__GAME__.settings.get('quality')"), s.js("__GAME__.quality && __GAME__.quality.name"))
pos = s.js("""(() => { const seg = document.querySelector('.seg[data-set=quality]'); const row = seg.closest('label.set-row'); const l = row.querySelector('.set-l'); const b = l.getBoundingClientRect(); return {label: [b.x + 10, b.y + b.height/2], tag: row.tagName, first: row.querySelector('button, input').outerHTML.slice(0, 60)}; })()""")
print('row info', pos)
mouse_click(s, pos['label'][0], pos['label'][1])
s.wait(0.8)
print('quality after label click', s.js("__GAME__.settings.get('quality')"), s.js("__GAME__.quality && __GAME__.quality.name"))
s.shot('a_settings_after.png')
# restore quality to high for further tests
s.run("__GAME__.settings.set('quality','high');")
# name change
s.run("""const i = document.querySelector('input[data-set=playerName]'); i.value = 'Zed'; i.dispatchEvent(new Event('input', {bubbles: true}));""")
s.wait(0.3)
s.click('.s-settings [data-act=back]')
s.wait(0.5)
s.run("__GAME__.resume();")
s.wait(0.5)
print('F9', s.js("({setting: __GAME__.settings.get('playerName'), playerName: __GAME__.player.name, board: __GAME__.getScoreboard().find(r => r.isPlayer).name})"))
s.close()
