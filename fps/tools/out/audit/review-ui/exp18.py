import sys, json
from common import *
s = Session(1280, 720)
print('state', start_match(s, bots=3, score=25))
s.run("__GAME__.bots.update = () => {}; __GAME__.player.god = true;")
s.wait(3.0)
obs = """
window.__mut = {}; window.__mutN = 0;
const key = n => { const e = n.nodeType === 1 ? n : n.parentElement; let p = e; while (p && !(p.dataset && p.dataset.r) && p.className !== undefined) { if (p.classList && (p.classList.length)) { break; } p = p.parentElement; } const q = (p && (p.dataset && p.dataset.r || p.className)) || 'x'; return q; };
window.__mo = new MutationObserver(list => { for (const m of list) { window.__mutN++; const k = key(m.target) + ':' + (m.attributeName || m.type); window.__mut[k] = (window.__mut[k] || 0) + 1; } });
window.__mo.observe(document.querySelector('.k-hud'), {attributes: true, characterData: true, childList: true, subtree: true});
"""
s.run(obs)
f0 = s.js("__GAME__.frame")
s.wait(3.0)
f1 = s.js("__GAME__.frame")
print('frames', f1 - f0, 'mutations', s.js("window.__mutN"))
print(json.dumps(s.js("Object.entries(window.__mut).sort((a,b)=>b[1]-a[1]).slice(0,15)")))
# now move: force player.speed and spread variation
s.run("window.__mut = {}; window.__mutN = 0; const w = __GAME__.weapons; Object.defineProperty(w, 'spreadAngle', {get: () => 0.02 + 0.015*Math.sin(performance.now()/150), set: () => {}, configurable: true}); Object.defineProperty(__GAME__.player, 'speed', {get: () => 8 + 6*Math.sin(performance.now()/400), set: () => {}, configurable: true});")
f0 = s.js("__GAME__.frame")
s.wait(3.0)
f1 = s.js("__GAME__.frame")
print('moving frames', f1 - f0, 'mutations', s.js("window.__mutN"))
print(json.dumps(s.js("Object.entries(window.__mut).sort((a,b)=>b[1]-a[1]).slice(0,15)")))
s.close()
