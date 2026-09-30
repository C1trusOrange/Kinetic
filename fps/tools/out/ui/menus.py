import sys
from sess import Session

size = sys.argv[1] if len(sys.argv) > 1 else '1280x720'
w, h = (int(v) for v in size.split('x'))
tag = f'_{w}'
s = Session(w, h)
s.goto('tools/out/ui/harness.html', 'window.__READY')
s.run('window.__H.menu.showMain();')
s.wait(2.2)
s.shot(f'main{tag}.png')
s.hover('[data-act=quick]')
s.wait(0.4)
s.shot(f'main_hover{tag}.png')
s.click('[data-act=play]')
s.wait(0.7)
s.shot(f'setup{tag}.png')
s.click('[data-map=skyline]')
s.click('.seg[data-opt=mode] [data-v=tdm]')
s.click('.seg[data-opt=difficulty] [data-v=hard]')
s.wait(0.4)
s.shot(f'setup2{tag}.png')
s.click('[data-act=back]')
s.click('[data-act=settings]')
s.wait(0.6)
s.shot(f'settings{tag}.png')
s.click('.s-settings [data-act=back]')
s.click('[data-act=controls]')
s.wait(0.6)
s.shot(f'controls{tag}.png')
s.click('.s-controls [data-act=back]')
s.run("""
const g = window.__H.game;
const rows = [];
const names = ['Player','Sprocket','Voltage','Glitch','Rivet','Cog','Nimbus','Axle'];
const cols = ['#9fe8ff','#ff4a3d','#ffb020','#6ee05a','#b45cff','#ff5fb0','#2ee6d6','#f2f2f2'];
for (let i = 0; i < names.length; i++) rows.push({ id: i + 1, name: names[i], kills: 25 - i * 3, deaths: 6 + i, team: i % 2 ? 2 : 1, isPlayer: i === 0, alive: true, color: cols[i] });
window.__fake = { mapId: 'foundry', mapName: 'Foundry', mode: 'ffa', botCount: 7, difficulty: 'normal', scoreLimit: 25, timeLimit: 10,
  over: true, reason: 'score', playerWon: true, winner: { name: 'Player', kills: 25 }, winnerTeam: 0, teamScores: { 1: 25, 2: 19 }, results: rows };
g.menu.showEnd(window.__fake);
""")
s.wait(1.8)
s.shot(f'end{tag}.png')
s.run("""
const g = window.__H.game;
const f = window.__fake; f.mode = 'tdm'; f.winnerTeam = 2; f.playerWon = false; f.winner = null; f.teamScores = { 1: 17, 2: 25 };
g.menu.showEnd(f);
""")
s.wait(1.8)
s.shot(f'end_tdm{tag}.png')
s.run("window.__H.menu.showPause();")
s.wait(0.6)
s.shot(f'pause{tag}.png')
s.run("window.__H.menu.hide(); window.__H.menu.showLoading('Loading Skyline', 0.42);")
s.wait(0.8)
s.shot(f'loading{tag}.png')
s.close()
