const rec = { log: [] };
const L = (k, v) => rec.log.push([k, v]);
let phase = 0, t0 = 0;
export function setup(game, report) { report.custom = rec; game.player.god = true; }
export function drive(t, dt, game, report) {
  const w = game.weapons, inp = game.input;
  const el = t - t0;
  switch (phase) {
    case 0: if (t > 1.0) { L('start', { cur: w.currentId, owned: w.owned.join(',') }); inp.setVirtual('melee', true); phase = 1; t0 = t; } break;
    case 1: inp.setVirtual('melee', false); if (el > 0.1) { L('melee running', { meleeT: +w.meleeT.toFixed(2) }); L('giveWeapon(sniper) during melee ->', w.giveWeapon('sniper')); phase = 2; t0 = t; } break;
    case 2: if (el > 1.5) { L('after melee', { cur: w.currentId, owned: w.owned.join(','), pending: w.pendingId, queued: w._queuedSwitch, sw: w.switchState }); phase = 3; t0 = t; } break;
    case 3: // control: give when idle
      L('giveWeapon(rocket) idle ->', w.giveWeapon('rocket')); phase = 4; t0 = t; break;
    case 4: if (el > 1.5) { L('after idle give', { cur: w.currentId, owned: w.owned.join(',') }); phase = 5; } break;
  }
}
