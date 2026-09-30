// Grenade dodge: which directions does moveDodge try? (angles relative to the "straight away" direction)
const f = v => +v.toFixed(2);
export async function setup(game, report) {
  const C = report.custom = { };
  const bots = game.bots.list;
  for (let i = 1; i < bots.length; i++) { bots[i].alive = false; bots[i].model.setVisible(false); bots[i].respawnAt = -1; }
  game.player.alive = false; game.player.respawnAt = -1;
  const bot = bots[0]; bot.god = true;
  const br = bot.brain;
  br.perceive = () => {}; br.think = () => {};
  // 1) angles tried when everything is blocked (mock probe): shows the search order
  const tried = { first1: [], firstM1: [] };
  const oProbe = br.probeDir.bind(br);
  for (const [key, sd] of [['first1', 1], ['firstM1', -1]]) {
    br.strafeDir = sd;
    br.dodgeFrom.set(bot.position.x + 3, bot.position.y, bot.position.z);   // grenade east of us -> away = -x
    br.probeDir = (mx, mz) => {
      // angle of (mx,mz) relative to away vector (-1,0), using the same rotation the code uses: c=(ax*c-az*s, ax*s+az*c)
      const ax = -1, az = 0;
      // the code builds the probe as R(a)*(ax,az): cx = ax*c - az*s, cz = ax*s + az*c  =>  a = atan2(ax*cz - az*cx, ax*cx + az*cz)
      tried[key].push(f(Math.atan2(ax * mz - az * mx, ax * mx + az * mz)));
      return { wall: true, ledge: true, wallDist: 0 };
    };
    br.moveDodge(game.time);
  }
  br.probeDir = oProbe;
  C.anglesTried = tried;
}
export function drive() {}
