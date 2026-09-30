// Attribute collision.raycast calls to callers (sampled stacks) and count per-frame calls.
const by = {};
let total = 0, sampled = 0, frames = 0, startT = 0;
export function setup(game, report) {
  const cw = game.world.collision;
  const orig = cw.raycast;
  cw.raycast = function (...a) {
    total++;
    if ((total & 7) === 0) {
      sampled++;
      const st = new Error().stack.split('\n').slice(2, 9);
      let label = '?';
      for (const line of st) {
        const m = line.match(/at (?:async )?([\w$.<>]+) \(.*\/([\w]+\.js):(\d+)/);
        if (!m) continue;
        if (['Collision.js', 'World.js', 'Combat.js'].includes(m[2]) && /raycast|canSee|probeGround/.test(m[1]) && m[2] !== 'Collision.js') continue;
        if (m[2] === 'Collision.js' && m[1] !== 'CollisionWorld.probeGround') continue;
        label = m[1] + ' ' + m[2]; break;
      }
      by[label] = (by[label] || 0) + 1;
    }
    return orig.apply(this, a);
  };
  const ou = game.update.bind(game);
  game.update = function (dt) { if (game.time > 2) frames++; ou(dt); };
  report.custom = {};
}
export function drive(t0, dt, game) {
  game.player.god = true;
  const t = t0 % 17; const inp = game.input; const s = (a, b) => t >= a && t < b;
  inp.setVirtual('forward', s(1, 9.5) || s(12, 17)); inp.setVirtual('sprint', s(1.3, 4.2));
  inp.setVirtual('fire', s(4.8, 6.4) || s(7.0, 7.05));
  inp.addLook((s(4.8, 6.4) ? 250 : 0) * dt, 0);
}
export function finish(game, report) {
  const rows = Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, +(v * 8 / Math.max(1, frames)).toFixed(2)]);
  report.custom = { totalCalls: total, frames, perFrameApprox: +(total / Math.max(1, frames)).toFixed(1), byCallerPerFrame: rows.slice(0, 20) };
}
