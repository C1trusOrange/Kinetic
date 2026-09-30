// Classify every compiled program: kind (cacheKey head), output colour space, and whether any material of scene/viewScene currently uses it.
const G = window.__GAME__;
export function setup(game, report) { report.custom = {}; }
export function drive(t, dt, game) {
  const inp = game.input;
  game.player.god = true;
  // run through fire / grenade / rocket / grapple quickly so first-use programs exist
  const s = (a, b) => t >= a && t < b;
  inp.setVirtual('forward', s(0.5, 6));
  inp.setVirtual('fire', s(1, 1.5) || s(3, 3.05));
  if (t > 2 && !game.__g) { game.__g = true; game.weapons.giveWeapon('rocket'); }
  inp.setVirtual('weapon5', s(2.2, 2.25));
  inp.setVirtual('grenade', s(4, 4.5));
  inp.setVirtual('grapple', s(5, 5.05));
}
export function finish(game, report) {
  const r = game.renderer;
  const users = new Map();
  const mark = (scene) => scene.traverse(o => {
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of mats) { const p = r.properties.get(m); if (p && p.currentProgram) users.set(p.currentProgram.id, (users.get(p.currentProgram.id) || 0) + 1); }
  });
  mark(game.scene); mark(game.viewScene);
  const rows = {};
  let dead = 0;
  for (const p of r.info.programs) {
    const key = String(p.cacheKey);
    const parts = key.split(',');
    const head = parts[0].split('|').pop() || '?';
    const cs = parts.includes('srgb-linear') ? 'linear(RT)' : parts.includes('srgb') ? 'srgb(screen)' : '?';
    const isLive = users.has(p.id);
    const k = head + ' | ' + cs + ' | ' + (isLive ? 'live' : 'dead');
    rows[k] = (rows[k] || 0) + 1;
    if (!isLive) dead++;
  }
  report.custom = { total: r.info.programs.length, dead, rows, lights: { world: game.scene.children.filter(o => o.isLight).length }, ext: { parallel: r.extensions.has('KHR_parallel_shader_compile'), timer2: r.extensions.has('EXT_disjoint_timer_query_webgl2') } };
}
