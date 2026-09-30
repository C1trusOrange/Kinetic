// Verifier: reachability of BotManager tactical spots (snipe / cover).
const f = v => +v.toFixed(2);
export async function setup(game, report) {
  const C = report.custom = {};
  game.autotest.duration = 1e9;
  const nav = game.world.nav, spots = game.bots.spots;
  const cls = list => {
    const r = { n: list.length, main: 0, trap: 0, unreachable: 0, noNode: 0, examples: [] };
    for (const s of list) {
      const nd = nav.nearestNode(s.pos, 1.0);
      if (!nd) { r.noNode++; continue; }
      if (nd.main) r.main++;
      else if (nd.fromMain) { r.trap++; if (r.examples.length < 4) r.examples.push(['trap', s.pos.toArray().map(f)]); }
      else { r.unreachable++; if (r.examples.length < 6) r.examples.push(['unreach', s.pos.toArray().map(f)]); }
    }
    return r;
  };
  C.map = game.world.mapId;
  C.snipe = cls(spots.snipe);
  C.cover = cls(spots.cover);
  C.navStats = nav.stats;
  game.autotest.duration = 0;
}
export function drive() {}
