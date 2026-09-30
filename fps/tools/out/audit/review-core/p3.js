// audio state during pause / quit; grapple rope after quitToMenu
const a = game.audio;
const out = {};
out.audioCtx = !!a.ctx; out.ctxState = a.ctx && a.ctx.state; out.ready = a.ready;
await sleep(500);
// start a slide loop the way the player does
game.player._onSlideStart(false);
out.loopsAfterStart = a.loops ? a.loops.size : null;
out.loopBusGainPlaying = a.loopBus && a.loopBus.gain.value;
game.pause();
await sleep(1500);
out.state = game.state;
out.loopsDuringPause = a.loops ? a.loops.size : null;
out.loopBusGainPaused = a.loopBus && a.loopBus.gain.value;
out.pauseMuffleDuringPause = a._pauseMuffle;
game.resume();
await sleep(300);
game.player._onSlideEnd();
return out;
