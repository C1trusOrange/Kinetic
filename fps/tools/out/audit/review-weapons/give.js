const rec = { log: [] };
const L = (k, v) => rec.log.push([k, v]);
let phase = 0, t0 = 0;
export function setup(game, report) { report.custom = rec; game.player.god = true; }
export function drive(t, dt, game, report) {
  const w = game.weapons, p = game.player, inp = game.input;
  const el = t - t0;
  switch (phase) {
    case 0: if (t > 1.0) { inp.setVirtual('melee', true); phase = 1; t0 = t; } break;
    case 1: inp.setVirtual('melee', false); if (el > 0.1) { L('melee running', { meleeT: +w.meleeT.toFixed(2) }); L('give sniper during melee', w.giveWeapon('sniper')); phase = 2; t0 = t; } break;
    case 2: if (el > 1.5) { L('after melee', { cur: w.currentId, owned: w.owned.join(','), pending: w.pendingId, queued: w._queuedSwitch, sw: w.switchState }); phase = 3; t0 = t; } break;
    case 3: inp.setVirtual('grenade', true); if (el > 0.6) { L('cooking', { g: w.gState, cook: w.cooking }); L('give rocket during cook', w.giveWeapon('rocket')); L('queued', w._queuedSwitch); inp.setVirtual('grenade', false); phase = 4; t0 = t; } break;
    case 4: if (el > 2.0) { L('after cook', { cur: w.currentId, owned: w.owned.join(','), queued: w._queuedSwitch, sw: w.switchState, g: w.gState }); phase = 5; } break;
  }
}
