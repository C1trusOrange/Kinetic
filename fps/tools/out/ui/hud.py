import sys
from sess import Session

size = sys.argv[1] if len(sys.argv) > 1 else '1280x720'
w, h = (int(v) for v in size.split('x'))
tag = f'_{w}'
s = Session(w, h)
s.goto('tools/out/ui/harness.html', 'window.__READY')
s.run("window.__H.startFakeMatch('ffa'); window.__H.menu.hide();")
s.wait(2.6)
s.shot(f'hud_base{tag}.png')

# --- speed / movement tech / low health / grapple charging
s.run("""
const H = __H, p = H.player, w = H.weapons;
p.speed = 19.5; p.isSliding = true; p.isSprinting = true; p.grappleCharge = 0.55; p.health = 32; p.armor = 45;
w.ammo = 6; w.spreadAngle = 0.03;
H.bots[0].kills = 4; H.bots[1].kills = 7; p.kills = 5; p.deaths = 2;
""")
s.wait(0.9)
s.shot(f'hud_fast{tag}.png')

# --- events: damage indicators, hit markers, kill feed, announcements, toasts
s.run("""
const H = __H, ev = H.events, p = H.player;
p.speed = 9; p.isSliding = false; p.isWallRunning = true; p.grappleCharge = 1; p.health = 74; p.armor = 30;
H.bots[2].position.set(10, 0, -8); H.bots[3].position.set(-9, 0, 4);
ev.emit('damage', { target: p, attacker: H.bots[2], amount: 18, weapon: 'rifle', headshot: false, point: null, direction: null });
ev.emit('damage', { target: p, attacker: H.bots[3], amount: 25, weapon: 'shotgun', headshot: false, point: null, direction: null });
p.health = 56;
ev.emit('damage', { target: H.bots[0], attacker: p, amount: 34, weapon: 'rifle', headshot: true });
H.game.time += 0.1;
p.kills++; H.bots[0].deaths++;
H.bots[0].alive = false;
ev.emit('death', { victim: H.bots[0], attacker: p, weapon: 'rifle', headshot: true });
H.game.time += 0.4;
ev.emit('damage', { target: H.bots[1], attacker: p, amount: 60, weapon: 'rifle', headshot: false });
H.bots[1].alive = false; p.kills++;
ev.emit('death', { victim: H.bots[1], attacker: p, weapon: 'rifle', headshot: false });
ev.emit('death', { victim: H.bots[4], attacker: H.bots[5], weapon: 'rocket', headshot: false });
ev.emit('death', { victim: H.bots[6], attacker: null, weapon: 'fall', headshot: false });
ev.emit('death', { victim: H.bots[3], attacker: H.bots[2], weapon: 'sniper', headshot: true });
ev.emit('pickup', { entity: p, pickup: { type: 'health', amount: 50 } });
ev.emit('pickup', { entity: p, pickup: { type: 'weapon', weapon: 'rocket' } });
ev.emit('pickup', { entity: p, pickup: { type: 'grenades', amount: 2 } });
""")
s.wait(0.25)
s.shot(f'hud_events{tag}.png')

# --- reload ring + prompt + weapon slots
s.run("""
const H = __H, w = H.weapons, p = H.player;
p.isWallRunning = false; p.speed = 3;
w.owned = ['pistol','rifle','shotgun','sniper','rocket']; w.currentId = 'shotgun'; w.current = H.WEAPONS.shotgun; w.ammo = 2; w.reserve = 14;
w.reloading = true; w.reloadProgress = 0.62; w.spreadAngle = 0.06; w.grenades = 1;
""")
s.wait(0.5)
s.shot(f'hud_reload{tag}.png')

# --- grenade cook + rocket crosshair
s.run("""
const H = __H, w = H.weapons;
w.reloading = false; w.cooking = true; w.cookProgress = 0.82; w.currentId = 'rocket'; w.current = H.WEAPONS.rocket; w.ammo = 0; w.reserve = 0; w.spreadAngle = 0.01;
""")
s.wait(0.4)
s.shot(f'hud_cook{tag}.png')

# --- sniper scope
s.run("""
const H = __H, w = H.weapons, p = H.player;
w.cooking = false; w.currentId = 'sniper'; w.current = H.WEAPONS.sniper; w.ammo = 3; w.reserve = 10; w.scoped = true; w.adsAmount = 1; p.fovMultiplier = 0.28;
""")
s.wait(0.5)
s.shot(f'hud_scope{tag}.png')

# --- scoreboard
s.run("""
const H = __H, w = H.weapons, p = H.player;
w.scoped = false; w.adsAmount = 0; p.fovMultiplier = 1; w.currentId = 'rifle'; w.current = H.WEAPONS.rifle; w.ammo = 20; w.reserve = 64;
H.bots.forEach((b, i) => { b.kills = 3 + i * 2; b.deaths = 2 + i; b.alive = i !== 2; }); p.kills = 12; p.deaths = 5;
H.held.scoreboard = true;
""")
s.wait(0.6)
s.shot(f'hud_board{tag}.png')

# --- death overlay
s.run("""
const H = __H, p = H.player, ev = H.events;
H.held.scoreboard = false;
p.alive = false; p.health = 0; p.respawnAt = H.game.time + 2.4;
ev.emit('death', { victim: p, attacker: H.bots[1], weapon: 'sniper', headshot: true });
""")
s.wait(1.4)
s.shot(f'hud_death{tag}.png')

# --- spawn protection + match point + tdm
s.run("""
const H = __H, p = H.player;
H.startFakeMatch('tdm');
p.speed = 0; p.spawnProtectedUntil = H.game.time + 1.4; H.game.match.teamScores = { 1: 18, 2: 24 };
H.bots.forEach((b, i) => { b.kills = 2 + i; }); p.kills = 7;
H.game.state = 'playing';
H.hud._scoreDirty = true;
window.__FREEZE = false;
""")
s.wait(0.9)
s.shot(f'hud_tdm{tag}.png')
s.run("__H.held.scoreboard = true; __H.player.kills = 9; __H.bots.forEach((b,i)=>{b.kills=1+i*2; b.deaths=i;});")
s.wait(0.5)
s.shot(f'hud_tdm_board{tag}.png')
s.close()
