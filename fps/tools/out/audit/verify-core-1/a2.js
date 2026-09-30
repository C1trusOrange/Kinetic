const a = game.audio;
const c = {};
await sleep(800);
game.audio.unlock();
game.input.setVirtual('forward', true);
game.input.setVirtual('sprint', true);
await sleep(1500);
game.input.setVirtual('crouch', true);
await sleep(300);
c.sliding = game.player.isSliding; c.loops = a.loops.size;
game.endMatch('time');
c.samples = [];
for (let i = 0; i < 8; i++) {
  await sleep(600);
  c.samples.push({ t: i, state: game.state, loops: a.loops.size, sliding: game.player.isSliding, endTimer: +game._endTimer.toFixed(2), gain: a.loopBus.gain.value });
}
return c;
