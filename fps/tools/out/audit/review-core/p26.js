// Does the final kill's announcement replace the VICTORY banner?
const out = {};
await sleep(600);
const pl = game.player; pl.god = true;
const hud = game.hud;
game.match.scoreLimit = 1;
const B = game.bots.list[0];
const seen = [];
const obs = new MutationObserver(() => seen.push(hud.e.atitle.textContent));
obs.observe(hud.e.atitle, { childList: true, characterData: true, subtree: true });
game.combat.kill(B, { attacker: pl, weapon: 'sniper', headshot: true });
await sleep(300);
obs.disconnect();
out.state = game.state;
out.playerWon = game.match.playerWon;
out.bannerSequence = seen;
out.bannerNow = hud.e.atitle.textContent + ' / ' + hud.e.asub.textContent;
return out;
