import sys
from common import *
W = int(sys.argv[1]); H = int(sys.argv[2]); m = sys.argv[3] if len(sys.argv) > 3 else 'skyline'
mode = sys.argv[4] if len(sys.argv) > 4 else 'ffa'
tag = f'{m}_{mode}_{W}'
s = Session(W, H)
open_game(s, m, bots=7, mode=mode)
# keep bots busy but player passive; give them time to score
s.run("__GAME__.player.god = true;")
s.wait(6)
# scoreboard
s.run("__GAME__.input.setVirtual('scoreboard', true);")
s.wait(1.2); s.shot(f'u_board_{tag}.png')
s.run("__GAME__.input.setVirtual('scoreboard', false);")
# damage indicator + flash (non-lethal)
s.run("""const g=__GAME__, p=g.player; p.god=false; p.health=100; p.armor=0;
 const b=g.bots.list.find(b=>b.alive); const d=p.position.clone().sub(b.position).normalize();
 g.combat.applyDamage(p,{amount:22,attacker:b,weapon:'rifle',point:p.position.clone(),direction:d});""")
s.wait(0.12); s.shot(f'u_damage_{tag}.png')
# low health
s.run("const p=__GAME__.player; p.health=17; p.armor=0;")
s.wait(1.0); s.shot(f'u_lowhp_{tag}.png')
# death overlay
s.run("""const g=__GAME__, p=g.player; p.god=false; p.health=1; const b=g.bots.list.find(b=>b.alive)||null;
 g.combat.kill(p,{attacker:b,weapon:'rifle',headshot:true,point:p.position.clone(),direction:p.position.clone().sub(b.position).normalize()});""")
s.wait(1.6); s.shot(f'u_death_{tag}.png')
s.wait(2.6)
# sniper scope
s.run("""const g=__GAME__; g.player.god=true; g.weapons.giveWeapon('sniper'); g.input.setVirtual('weapon4', true);""")
s.wait(0.2); s.run("__GAME__.input.setVirtual('weapon4', false);")
s.wait(1.2); s.run("__GAME__.input.setVirtual('ads', true);")
s.wait(2.0); s.shot(f'u_scope_{tag}.png')
print('scoped', s.js("__GAME__.weapons.scoped"))
s.run("__GAME__.input.setVirtual('ads', false);")
s.wait(1)
# pause
s.run("__GAME__.pause();")
s.wait(1.0); s.shot(f'u_pause_{tag}.png')
s.run("__GAME__.resume();")
s.wait(0.5)
# end screen
s.run("__GAME__.endMatch('score');")
s.wait(1.0); s.shot(f'u_endslowmo_{tag}.png')
s.wait(6.0); s.shot(f'u_end_{tag}.png')
print(s.js("({state: __GAME__.state, fps: __GAME__.fps})"))
s.close()
