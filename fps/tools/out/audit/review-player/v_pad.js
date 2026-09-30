// Jump pad launch: ground snap suppressed? correct arc? slide / crouch / low ceiling interplay.
import * as THREE from 'three';
import { teleport, releaseAll, r2 } from './common.js';
export async function setup(game, report) {
  const R = report.custom = {};
  const p = game.player; p.god = true;
  game.autotest.duration = 1e9; game.state = 'loading';
  const pad = game.world.jumpPads[0];
  R.pad = { pos: pad.position.toArray().map(r2), vel: pad.velocity.toArray().map(r2), radius: pad.radius };
  const DT = 1 / 60;
  const run = (name, prep, drive, secs) => {
    prep();
    let maxY = -99, land = null, firstAir = null, launched = null, events = [];
    const off = game.events.on('player:jump', e => events.push(['jump', e.type]));
    const off2 = game.events.on('player:land', e => events.push(['land', r2(e.speed)]));
    for (let i = 0; i < secs * 60; i++) {
      drive(i * DT);
      game.input.update(); game.update(DT); game.input.endFrame();
      if (p.velocity.y > 5 && launched === null) launched = { t: r2(i * DT), pos: p.position.toArray().map(r2), vel: p.velocity.toArray().map(r2), state: p.move.state };
      maxY = Math.max(maxY, p.position.y);
      if (launched && p.onGround && !land && i * DT > 0.5) land = { t: r2(i * DT), pos: p.position.toArray().map(r2) };
    }
    off(); off2();
    R[name] = { launched, maxY: r2(maxY), land, finalState: p.move.state, events };
    releaseAll(game);
  };
  // walk onto the pad
  run('walkOn', () => teleport(game, pad.position.x - 6, pad.position.y, pad.position.z, -Math.PI / 2, 0), t => { game.input.setVirtual('forward', true); }, 4);
  // slide onto the pad
  run('slideOn', () => { teleport(game, pad.position.x - 6, pad.position.y, pad.position.z, -Math.PI / 2, 0); p.velocity.set(11, 0, 0); }, t => { game.input.setVirtual('forward', true); game.input.setVirtual('crouch', t > 0.02); }, 4);
  // stand still on the pad
  run('standOn', () => teleport(game, pad.position.x, pad.position.y, pad.position.z, -Math.PI / 2, 0), t => {}, 4);
  report.done = true;
}
export function drive() {}
