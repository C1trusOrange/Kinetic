from sess import Session
s = Session(1280, 720)
s.goto('tools/out/ui/harness.html', 'window.__READY')
s.run("__H.startFakeMatch('ffa'); __H.menu.hide();")
s.wait(2.5)
r = s.run("""
const H = __H;
window.__FREEZE = true; window.__TICK = false;
await new Promise(r => setTimeout(r, 300));
let muts = 0;
const mo = new MutationObserver(l => { muts += l.length; });
mo.observe(document.getElementById('ui'), { subtree: true, attributes: true, childList: true, characterData: true });
// steady state: 120 frames
await new Promise(r => setTimeout(r, 1500));
const steady = muts; muts = 0;
// moving state
H.player.speed = 12;
const t0 = performance.now();
for (let i = 0; i < 3000; i++) { H.player.speed = 8 + (i % 30) * 0.3; H.weapons.spreadAngle = 0.01 + (i % 20) * 0.001; H.game.realTime += 0.016; H.hud.update(0.016); }
const per = (performance.now() - t0) / 3000;
await new Promise(r => setTimeout(r, 100));
return { steadyMutationsIn1_5s: steady, movingMutations: muts, updateMsPerCall: per };
""")
print(r)
s.close()
