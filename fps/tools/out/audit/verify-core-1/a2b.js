const res = {};
await sleep(800);
const origUpdate = game.hud.update;
game.endMatch('time');
// throw exactly on the frame(s) around the timer expiry: make hud.update throw once when the timer is about to expire
let thrown = 0;
game.hud.update = function (dt) {
  if (game._endTimer <= 0 && thrown === 0) { thrown++; throw new Error('probe-once'); }
  return origUpdate.call(this, dt);
};
await sleep(3500);
game.hud.update = origUpdate;
await sleep(1500);
res.thrown = thrown;
res.state = game.state;
res.endTimer = game._endTimer;
res.menuScreen = game.menu.screen;
res.menuOpen = game.menu.root.classList.contains('open');
res.hudVisible = !!(game.hud.root && game.hud.root.style && game.hud.root.style.display !== 'none');
res.frameErrors = Array.from(game._frameErrors.entries());
return res;
