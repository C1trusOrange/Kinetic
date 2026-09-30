const a = game.audio;
const c = {};
await sleep(800);
game.audio.unlock();
c.ctx = a.ctx && a.ctx.state;
// real slide: sprint forward, jump/crouch
game.input.setVirtual('forward', true);
game.input.setVirtual('sprint', true);
await sleep(1500);
game.input.setVirtual('crouch', true);
await sleep(300);
c.sliding = game.player.isSliding; c.loops = a.loops.size; c.speed = game.player.speed;
game.pause();
game.input.setVirtual('crouch', false);
await sleep(1500);
c.paused = { state: game.state, loops: a.loops.size, loopBusGain: a.loopBus && a.loopBus.gain.value, pauseMuffle: a._pauseMuffle, freq: a.muffle && a.muffle.frequency.value, isSliding: game.player.isSliding };
return c;
