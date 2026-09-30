// Counts how often three.js re-derives program keys (getProgram) per frame, and which materials are shared between scenes.
export function setup(game, report) {
  report.custom = { frames: 0 };
}
let counting = false, frames0 = 0;
const counts = new Map();
function patch(scene, label, sets) {
  scene.traverse(o => {
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of mats) {
      if (!sets.has(m)) sets.set(m, new Set());
      sets.get(m).add(label);
      if (!m.__patched) {
        m.__patched = true;
        const orig = m.customProgramCacheKey.bind(m);
        m.customProgramCacheKey = function () { if (counting) counts.set(m, (counts.get(m) || 0) + 1); return orig(); };
      }
    }
  });
}
const sets = new Map();
export function drive(t, dt, game, report) {
  const c = report.custom;
  if (t > 2.5 && !game.__k1) {
    game.__k1 = true;
    patch(game.scene, 'S', sets); patch(game.viewScene, 'V', sets);
    counting = true; frames0 = game.frame; c.startFrame = game.frame;
  }
  if (t > 4.5 && !game.__k2) {
    game.__k2 = true;
    counting = false;
    const frames = game.frame - frames0;
    c.frames = frames;
    let total = 0, shared = 0, sharedCount = 0, sOnly = 0, vOnly = 0;
    const rows = [];
    for (const [m, s] of sets) {
      const n = counts.get(m) || 0;
      total += n;
      const both = s.has('S') && s.has('V');
      if (both) { shared++; sharedCount += n; }
      else if (s.has('S')) sOnly++; else vOnly++;
      if (n > 0) rows.push({ name: m.name || m.type, type: m.type, scenes: [...s].join(''), calls: n, perFrame: +(n / frames).toFixed(2) });
    }
    rows.sort((a, b) => b.calls - a.calls);
    c.totalGetProgramCalls = total;
    c.perFrame = +(total / frames).toFixed(1);
    c.materialsTotal = sets.size; c.sharedMaterials = shared; c.sharedCalls = sharedCount; c.sOnly = sOnly; c.vOnly = vOnly;
    c.matsWithCalls = rows.length;
    c.top = rows.slice(0, 25);
    c.info = { lights: game.scene.children.filter(o => o.isLight).length };
  }
}
