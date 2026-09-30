const out = {};
await sleep(600);
const pl = game.player, a = game.audio;
pl.god = true;
game.match.scoreLimit = 2;
game.player._onSlideStart(false);           // a looping sound is active when the match ends (sliding / wall-running / reeling)
out.loopsBefore = a.loops.size;
const [A, B] = game.bots.list;
for (let i = 0; i < 2; i++) { game.combat.kill(B, { attacker: pl, weapon: 'rifle' }); if (game.state !== 'ended') { B.respawnAt = 0; game.respawnEntity(B); } }
out.stateAfterKills = game.state; out.timeScale = game.timeScale; out.reason = game.match.reason; out.playerWon = game.match.playerWon; out.winner = game.match.winner && game.match.winner.name;
await sleep(4500);
out.stateLater = game.state; out.timeScaleLater = game.timeScale;
out.loopsAtEndScreen = a.loops.size;
out.loopBusGain = a.loopBus.gain.value;
out.menuOpen = document.querySelector('#ui .k-root, #ui [class*=menu]') ? true : null;
// restart from ended state
await game.startMatch({ ...game.lastMatchConfig, scoreLimit: 25 });
await sleep(500);
out.afterRestart = { state: game.state, timeScale: game.timeScale, inputEnabled: game.input.enabled, capture: game.input.capture, kills: game.entities.map(e => e.kills).join(','), loops: a.loops.size, matchOver: game.match.over, alive: game.entities.filter(e => e.alive).length };
return out;
