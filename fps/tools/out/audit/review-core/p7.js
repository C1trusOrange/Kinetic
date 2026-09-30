// A throw in a late-frame subsystem (hud.update) skips render(): count render calls with and without the throw
const out = {};
let renders = 0;
const origRender = game.render.bind(game);
game.render = () => { renders++; origRender(); };
await sleep(500);
let r0 = renders; await sleep(500); out.rendersPer500msNormal = renders - r0;
const origHud = game.hud.update.bind(game.hud);
game.hud.update = (dt) => { throw new Error('injected hud failure'); };
r0 = renders; const f0 = game.frame; const t0 = game.time;
await sleep(1000);
out.rendersPer1000msWithThrow = renders - r0;
out.framesAdvanced = game.frame - f0;
out.simTimeAdvanced = +(game.time - t0).toFixed(3);
game.hud.update = origHud;
await sleep(300);
out.rendersAfterFix = renders;
return out;
