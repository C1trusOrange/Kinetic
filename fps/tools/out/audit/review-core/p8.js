// per-frame call counts on allocating core APIs with 8 bots running
const out = {};
const col = game.world.collision;
const counts = { raycast: 0, raycastHits: 0, probeGround: 0, moveCapsule: 0, resolveCapsule: 0, combatRaycast: 0, canSee: 0, consumeLook: 0 };
const wrap = (obj, name, key, hitCheck) => {
  const orig = obj[name].bind(obj);
  obj[name] = (...a) => { counts[key]++; const r = orig(...a); if (hitCheck && r) counts.raycastHits++; return r; };
};
wrap(col, 'raycast', 'raycast', true);
wrap(col, 'probeGround', 'probeGround');
wrap(col, 'moveCapsule', 'moveCapsule');
wrap(col, 'resolveCapsule', 'resolveCapsule');
wrap(game.combat, 'raycast', 'combatRaycast');
wrap(game.combat, 'canSee', 'canSee');
wrap(game.input, 'consumeLook', 'consumeLook');
await sleep(500);
for (const k in counts) counts[k] = 0;
const f0 = game.frame; const t0 = game.time;
await sleep(6000);
const frames = game.frame - f0;
const simFrames = (game.time - t0) / (1 / 60);
out.frames = frames; out.simSeconds = +(game.time - t0).toFixed(2);
out.perSimFrame = {};
for (const k in counts) out.perSimFrame[k] = +(counts[k] / Math.max(1, frames)).toFixed(1);
out.totals = counts;
out.botsAlive = game.bots.list.filter(b => b.alive).length;
return out;
