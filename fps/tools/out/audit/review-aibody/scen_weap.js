import * as THREE from 'three';
import { WEAPONS } from '/src/weapons/WeaponDefs.js';
const S = { res: {} };
export async function setup(game, report) {
  report.custom = S.res;
  const b = game.bots.list[0];
  b.brain.update = () => {};
  for (const id of Object.keys(WEAPONS)) if (!b.inv[id]) b._addWeaponInternal(id);
  const ids = Object.keys(WEAPONS);
  for (let i = 0; i < 40; i++) { b.equipUntil = 0; b.selectWeapon(ids[(i * 3) % ids.length]); }
  const sock = b.model.weaponSocket;
  S.res.socketChildren = sock.children.length;
  S.res.socketNames = sock.children.map(c => c.name);
  S.res.weaponId = b.weaponId;
  let sceneWeaponRoots = 0;
  game.scene.traverse(o => { if (o.name && o.name.startsWith('weapon_')) sceneWeaponRoots++; });
  S.res.sceneWeaponRoots = sceneWeaponRoots;
  S.res.botCount = game.bots.list.length;
  // respawn 10x
  for (let i = 0; i < 10; i++) { game.combat.kill(b, { attacker: null, weapon: 'test' }); game.respawnEntity(b); }
  S.res.socketChildrenAfterRespawns = b.model.weaponSocket.children.length;
  S.res.gibsInScene = game.effects.gibList.length;
  S.res.rootVisible = b.model.root.visible;
  S.res.weaponModels = Object.keys(b._weaponModels);
  // dead bot should not update/act
  game.combat.kill(b, { attacker: null, weapon: 'test' });
  S.res.deadVisible = b.model.root.visible;
  S.res.deadAlive = b.alive;
}
export function drive() {}
