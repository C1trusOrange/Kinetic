const { BotModel } = await import('/src/ai/BotModel.js');
const { createWeaponModel } = await import('/src/weapons/WeaponModels.js');
function fresh() { const m = new BotModel({ color: 0x33ccff, team: 1 }); m.setWeapon(createWeaponModel('rifle', { view: false })); return m; }
function nanCount(m) {
  let nan = 0; m.root.updateMatrixWorld(true);
  m.root.traverse(o => { const p = o.position, q = o.quaternion; if (![p.x, p.y, p.z, q.x, q.y, q.z, q.w].every(Number.isFinite)) nan++; else if (Math.abs(Math.hypot(q.x, q.y, q.z, q.w) - 1) > 1e-3) nan++; });
  return nan;
}
const cases = {
  'speed -5': { speed: -5, forwardSpeed: 0, strafeSpeed: 0 },
  'empty {}': {},
  'undefined state': undefined,
  'forward Infinity': { forwardSpeed: Infinity },
  'speed Infinity': { forwardSpeed: 0, strafeSpeed: 0, speed: Infinity },
  'crouch Infinity': { crouch: Infinity },
  'aimPitch Infinity': { aimPitch: Infinity },
  'yawOff Infinity': { aimYawOffset: Infinity },
  'huge finite': { forwardSpeed: 1e30, strafeSpeed: 1e30, speed: 1e30 },
  'huge finite2': { forwardSpeed: 1e160, strafeSpeed: 1e160, speed: 1e160 },
};
const out = {};
for (const [name, st] of Object.entries(cases)) {
  const m = fresh();
  for (let i = 0; i < 30; i++) m.update(0.016, st);
  const a = nanCount(m);
  // now feed clean input and see if it recovers
  for (let i = 0; i < 60; i++) m.update(0.016, { forwardSpeed: 3, strafeSpeed: 0, speed: 3 });
  const b = nanCount(m);
  m.reset();
  for (let i = 0; i < 5; i++) m.update(0.016, { forwardSpeed: 3, strafeSpeed: 0, speed: 3 });
  const c = nanCount(m);
  out[name] = { nanAfterBad: a, nanAfterClean: b, nanAfterReset: c };
}
// dt variants
const dts = { negative: -1, NaN: NaN, huge: 1e9, Infinity: Infinity, tiny: 1e-12 };
for (const [name, dt] of Object.entries(dts)) {
  const m = fresh();
  for (let i = 0; i < 30; i++) m.update(dt, { forwardSpeed: 5, strafeSpeed: 0, speed: 5 });
  out['dt ' + name] = nanCount(m);
}
return out;
