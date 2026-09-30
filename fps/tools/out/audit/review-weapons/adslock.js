const rec = { log: [], samples: [] };
const L = (k, v) => rec.log.push([k, v]);
let phase = 0, t0 = 0, tFire = 0, tSwapDone = 0;
export function setup(game, report) { report.custom = rec; game.player.god = true; game.weapons.giveWeapon('sniper'); }
export function drive(t, dt, game, report) {
  const w = game.weapons, inp = game.input;
  const el = t - t0;
  switch (phase) {
    case 0: if (t > 0.5) { w._requestSwitch('sniper'); phase = 1; t0 = t; } break;
    case 1: if (el > 1.0) { inp.setVirtual('fire', true); tFire = t; phase = 2; t0 = t; } break;
    case 2: inp.setVirtual('fire', false); if (el > 0.1) { inp.setVirtual('weapon2', true); inp.setVirtual('ads', true); phase = 3; t0 = t; } break;
    case 3:
      inp.setVirtual('weapon2', false);
      rec.samples.push({ t: +(t - tFire).toFixed(2), cur: w.currentId, sw: w.switchState, eq: +w.equipAmount.toFixed(2), ads: +w.adsAmount.toFixed(2), lockLeft: +(w._adsLockUntil - game.time).toFixed(2) });
      if (el > 1.2) phase = 4;
      break;
  }
}
