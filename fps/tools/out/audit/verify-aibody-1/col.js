export function setup(game, report) {
  report.custom = { colors: game.bots.list.map(b => b.color.getHexString()), nums: game.bots.list.map(b => b.model && b.model.materialSet ? b.model.materialSet.number : null), n: game.bots.list.length };
}
export function drive() {}
