const { BotModel } = await import('/src/ai/BotModel.js');
const THREE = await import('three');
const m = new BotModel({ color: 0x33ccff, team: 1 });
const { createWeaponModel } = await import('/src/weapons/WeaponModels.js');
m.setWeapon(createWeaponModel('rifle', { view: false }));
let seed = 12345;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const bad = [];
function check(tag, st) {
  let nan = 0;
  m.root.updateMatrixWorld(true);
  m.root.traverse(o => {
    const p = o.position, q = o.quaternion;
    if (![p.x, p.y, p.z, q.x, q.y, q.z, q.w].every(Number.isFinite)) nan++;
    else { const l = Math.hypot(q.x, q.y, q.z, q.w); if (Math.abs(l - 1) > 1e-3) nan++; }
  });
  if (nan && bad.length < 10) bad.push({ tag, nan, st: JSON.stringify(st), k: JSON.stringify(m._k) });
  return nan;
}
let total = 0;
const ranges = { forwardSpeed: 12, strafeSpeed: 12, speed: 14, crouch: 1, aimPitch: 1.4, aimYawOffset: 1.3 };
for (let i = 0; i < 20000; i++) {
  const st = {
    forwardSpeed: (rnd() * 2 - 1) * ranges.forwardSpeed, strafeSpeed: (rnd() * 2 - 1) * ranges.strafeSpeed,
    speed: rnd() * ranges.speed, onGround: rnd() < 0.8, crouch: rnd(), aimPitch: (rnd() * 2 - 1) * 1.35,
    aimYawOffset: (rnd() * 2 - 1) * 1.3, firing: rnd() < 0.3, reloading: rnd() < 0.15, alive: rnd() < 0.98, aiming: rnd() < 0.5,
  };
  const dt = rnd() < 0.1 ? 0 : rnd() * 0.06;
  m.update(dt, st);
  if (rnd() < 0.02) m.flashHit();
  total += check('rand', st);
}
// extremes
const ext = [
  { forwardSpeed: 1e4, strafeSpeed: -1e4, speed: 1e4 }, { forwardSpeed: -55, strafeSpeed: 30, speed: 60, onGround: false },
  { crouch: 7, aimPitch: 30, aimYawOffset: -40 }, { forwardSpeed: NaN, strafeSpeed: undefined, speed: NaN, crouch: NaN, aimPitch: NaN },
  { forwardSpeed: Infinity }, { speed: -5 }, {},
];
const extRes = [];
for (const e of ext) {
  for (let i = 0; i < 40; i++) m.update(0.016, e);
  extRes.push({ e: JSON.stringify(e), nan: check('ext', e), k: Object.values(m._k).every(Number.isFinite) });
}
// recover?
for (let i = 0; i < 60; i++) m.update(0.016, { forwardSpeed: 0, strafeSpeed: 0, speed: 0 });
const recovered = check('recover', {});
return { total, bad, extRes, recovered, kFinite: Object.values(m._k).every(Number.isFinite), phase: m._phase, time: m._time };
