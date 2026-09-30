// A bot that enters 'roam' while > 3 m above the floor (jump pad flight / rocket jump) cannot pick a goal
// (nav.isConnected() resolves no node) and is teleported by rescue().
const f = v => +v.toFixed(2);
const LOG = [];
let done = false, marker = 0;
export async function setup(game, report) {
  report.custom = { log: LOG };
  const bots = game.bots.list;
  for (let i = 1; i < bots.length; i++) { bots[i].alive = false; bots[i].model.setVisible(false); bots[i].respawnAt = -1; }
  game.player.alive = false; game.player.respawnAt = -1;
  const bot = bots[0]; bot.god = true;
  const br = bot.brain;
  br.perceive = () => {};
  br.wantPickup = () => false;   // keep the bot from switching to 'collect' (isolates the roam behaviour)
  const oTp = bot.teleportTo.bind(bot);
  bot.teleportTo = (p, y) => { LOG.push({ ev: 'TELEPORT', t: f(game.time - marker), from: bot.position.toArray().map(f), to: p.toArray().map(f), roamFailures: br.roamFailures, state: br.state }); return oTp(p, y); };
  report.custom.bots = bots.length;
}
export function drive(t, dt, game, report) {
  const bot = game.bots.list[0], br = bot.brain, nav = game.world.nav;
  if (t > 1.5 && !done) {
    done = true; marker = game.time;
    const n = nav._main.find(n => Math.abs(n.position.x) < 8 && Math.abs(n.position.z) < 8 && n.position.y < 0.5) || nav._main[0];
    bot.teleportTo(n.position.clone(), 0);
    bot.applyImpulse({ x: 0, y: 22, z: 0 });   // pad / rocket-jump style flight (apex ~10 m)
    br.nav.clear();
    br.state = 'chase'; br.enterState('roam', game.time);   // e.g. the target we were chasing just died
    LOG.push({ ev: 'start', y: f(bot.position.y), roamFailures: br.roamFailures, hasGoal: br.nav.hasGoal });
  }
  if (done) {
    const el = game.time - marker;
    if (Math.floor(el * 10) !== Math.floor((el - dt) * 10) && el < 4) {
      LOG.push({ el: f(el), y: f(bot.position.y), air: !bot.onGround, state: br.state, hasGoal: br.nav.hasGoal, rf: br.roamFailures });
    }
  }
}
