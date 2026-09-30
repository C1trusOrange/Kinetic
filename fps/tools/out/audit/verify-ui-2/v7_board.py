import sys, json
from common import *
from sess import HERE
s = Session(1280, 720)
print('state', start_match(s, bots=9, score=25, timelim=0))
s.run("__GAME__.bots.update = () => {}; __GAME__.player.god = true; __GAME__.player.spawnProtectedUntil = __GAME__.time + 30;")
s.wait(1.5)
s.run("__GAME__.input.setVirtual('scoreboard', true);")
s.wait(1.0)
r = s.js("""(() => {
  const q = sel => document.querySelector(sel);
  const rect = e => { const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)]; };
  const hint = q('.hud-hint'), shield = q('.hud-shield'), panel = q('.board-panel'), head = q('.board-head');
  const hb = hint.getBoundingClientRect();
  const cx = (hb.left + hb.right) / 2, cy = (hb.top + hb.bottom) / 2;
  return {hintOn: hint.classList.contains('on'), hintText: hint.textContent, hintRect: rect(hint), shieldOn: shield.classList.contains('on'), shieldRect: rect(shield),
    panelRect: rect(panel), headRect: rect(head), boardOn: q('.hud-board').classList.contains('on'),
    topAtHintCenter: document.elementsFromPoint(cx, cy).slice(0,4).map(e => e.className || e.tagName),
    z: [getComputedStyle(q('.hud-board')).zIndex, getComputedStyle(hint).zIndex, getComputedStyle(shield).zIndex],
    hintOpacity: getComputedStyle(hint).opacity, shieldOpacity: getComputedStyle(shield).opacity};
})()""")
print(json.dumps(r, indent=1))
s.shot('v7_board.png')
s.close()
