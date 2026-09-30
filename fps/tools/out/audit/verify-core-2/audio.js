const sleep = ms => new Promise(r => setTimeout(r, ms));
export function drive() {}
export async function setup(game, report) {
  const c = report.custom = {};
  await sleep(600);
  game.audio.unlock();
  await sleep(300);
  c.ctxState = game.audio.ctx && game.audio.ctx.state;
  c.ready = game.audio.ready;
  // real slide: sprint then crouch
  game.input.setVirtual('forward', true);
  game.input.setVirtual('sprint', true);
  await sleep(1500);
  game.input.setVirtual('crouch', true);
  let waited = 0;
  while (!game.player.isSliding && waited < 2000) { await sleep(50); waited += 50; }
  c.isSliding = game.player.isSliding;
  c.loopsWhileSliding = game.audio.loops.size;
  c.loopBusGainPlaying = game.audio.loopBus.gain.value;
  game.pause();
  c.stateAfterPause = game.state;
  await sleep(1500);
  c.paused = { state: game.state, loops: game.audio.loops.size, loopBusGain: game.audio.loopBus.gain.value, muffle: game.audio._pauseMuffle, muffleFreq: game.audio.muffle && game.audio.muffle.frequency.value, isSliding: game.player.isSliding };
  // resume and then end match with a wall-run/slide loop artificially active
  game.resume();
  game.input.setVirtual('forward', false); game.input.setVirtual('sprint', false); game.input.setVirtual('crouch', false);
  await sleep(600);
  c.afterResume = { state: game.state, loops: game.audio.loops.size };
  game.player._onSlideStart(false);
  c.loopsBeforeEnd = game.audio.loops.size;
  game.endMatch('time');
  await sleep(4500);
  c.ended = { state: game.state, loops: game.audio.loops.size, loopBusGain: game.audio.loopBus.gain.value };
  // natural end-of-outro variant: active real slide when the match ends
}
