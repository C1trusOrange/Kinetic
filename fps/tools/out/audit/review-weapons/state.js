import * as THREE from 'three';
const rec = { log: [] };
const L = (k, v) => rec.log.push([k, v]);
let phase = 0, tPhase = 0;
export function setup(game, report) {
  report.custom = rec;
  game.player.god = false;
  game.weapons.giveWeapon('sniper'); game.weapons.giveWeapon('rocket');
}
const snap = (game) => {
  const w = game.weapons, p = game.player;
  return { id: w.currentId, ads: +w.adsAmount.toFixed(2), scoped: w.scoped, fov: +p.fovMultiplier.toFixed(2), look: +p.lookScale.toFixed(2), reloading: w.reloading, cooking: w.cooking, gState: w.gState, alive: p.alive, state: game.state, prevDots: w.previewDots.visible, prevRing: w.previewRing.visible, camFov: +game.camera.fov.toFixed(1), vmVisible: w.vm[w.currentId].root.visible, ammo: w.ammo, reserve: w.reserve, grenades: w.grenades, cookTime: +w.cookTime.toFixed(2), sw: w.switchState, eq: +w.equipAmount.toFixed(2) };
};
export function drive(t, dt, game, report) {
  const w = game.weapons, p = game.player, inp = game.input;
  tPhase += dt;
  if (game.state === 'menu') { if (phase === 20) { L('menu:dots', snap(game)); phase = 99; } return; }
  switch (phase) {
    case 0: // wait for spawn protection, select sniper & ADS
      if (t > 0.5) { w._requestSwitch('sniper'); phase = 1; tPhase = 0; }
      break;
    case 1:
      if (tPhase > 1.0) { inp.setVirtual('ads', true); phase = 2; tPhase = 0; }
      break;
    case 2:
      if (tPhase > 1.0) {
        L('scoped', snap(game));
        // kill the player while scoped
        game.combat.kill(p, { attacker: null, weapon: 'fall' });
        phase = 3; tPhase = 0;
      }
      break;
    case 3:
      if (tPhase > 0.3) { L('dead+0.3', snap(game)); phase = 4; tPhase = 0; }
      break;
    case 4: // wait for respawn
      if (p.alive && tPhase > 0.2) { L('respawned', snap(game)); phase = 5; tPhase = 0; inp.setVirtual('ads', false); }
      break;
    case 5: // start reload then die during reload, verify reload flag
      if (tPhase > 1.6) {
        w.inv.rifle.ammo = 5; w.ammo = 5;
        inp.setVirtual('reload', true); phase = 6; tPhase = 0;
      }
      break;
    case 6:
      inp.setVirtual('reload', false);
      if (tPhase > 0.4) { L('reloading', snap(game)); game.combat.kill(p, { attacker: null, weapon: 'fall' }); phase = 7; tPhase = 0; }
      break;
    case 7:
      if (p.alive && tPhase > 0.3) { L('respawn2', snap(game)); phase = 8; tPhase = 0; }
      break;
    case 8: // cook grenade and die mid-cook
      if (tPhase > 1.7) { inp.setVirtual('grenade', true); phase = 9; tPhase = 0; }
      break;
    case 9:
      if (tPhase > 0.8) {
        L('cooking', snap(game));
        L('proj before death', game.projectiles.grenades.length);
        game.combat.kill(p, { attacker: null, weapon: 'fall' });
        inp.setVirtual('grenade', false);
        phase = 10; tPhase = 0;
      }
      break;
    case 10:
      if (tPhase > 0.2) { L('dead cook', snap(game)); L('proj after death', game.projectiles.grenades.length ? game.projectiles.grenades.map(g => ({ fuse: +g.fuse.toFixed(2), owner: g.owner === p })) : []); phase = 11; tPhase = 0; }
      break;
    case 11:
      if (p.alive && tPhase > 0.3) { L('respawn3', snap(game)); phase = 12; tPhase = 0; }
      break;
    case 12: // scoped + cooking?  scope then end match, check state after slow-mo
      if (tPhase > 1.7) { w._requestSwitch('sniper'); phase = 13; tPhase = 0; }
      break;
    case 13:
      if (tPhase > 1.0) { inp.setVirtual('ads', true); phase = 14; tPhase = 0; }
      break;
    case 14:
      if (tPhase > 1.0) { L('scoped2', snap(game)); game.endMatch('score'); phase = 15; tPhase = 0; }
      break;
    case 15:
      if (tPhase > 0.6) { L('ended+0.6', snap(game)); }
      if (game.state === 'ended' && game._endTimer <= 0) { L('endscreen', snap(game)); inp.setVirtual('ads', false); phase = 16; tPhase = 0; }
      break;
    case 16:
      if (tPhase > 0.5) { L('endscreen+0.5', snap(game)); phase = 17; }
      break;
  }
}
