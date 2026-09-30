(() => {
  const T = window.__THREE;
  const w = window.__bots[0];
  const b = w.bot;
  const base = { forwardSpeed: 0, strafeSpeed: 0, speed: 0, onGround: true, crouch: 0, aimPitch: 0, aimYawOffset: 0, firing: false, reloading: false, alive: true };
  const seq = [
    ['idle', 60, {}],
    ['run', 90, { forwardSpeed: 7, speed: 7 }],
    ['stop', 60, {}],
    ['walk-back', 60, { forwardSpeed: -3.5, speed: 3.5 }],
    ['strafe', 60, { strafeSpeed: 5, speed: 5 }],
    ['strafe-flip', 60, { strafeSpeed: -5, speed: 5 }],
    ['crouch', 40, { crouch: 1 }],
    ['crouch-walk', 60, { crouch: 1, forwardSpeed: 3, speed: 3 }],
    ['stand', 40, {}],
    ['jump', 30, { forwardSpeed: 6, speed: 6, onGround: false }],
    ['land', 40, { forwardSpeed: 6, speed: 6 }],
    ['fire', 60, { firing: true, aimPitch: 0.4, aimYawOffset: 0.9 }],
    ['fire-twist', 40, { firing: true, aimPitch: -0.5, aimYawOffset: -1.1 }],
    ['reload', 120, { reloading: true }],
    ['run-fire', 60, { forwardSpeed: 8, speed: 8, firing: true, aimYawOffset: 0.6 }],
    ['die', 60, { alive: false }],
    ['respawn', 60, {}],
  ];
  const pts = [
    () => b.head.getWorldPosition(new T.Vector3()),
    () => b.armL[0].getWorldPosition(new T.Vector3()),
    () => b.armL[1].getWorldPosition(new T.Vector3()),
    () => b.feet[0].getWorldPosition(new T.Vector3()),
    () => b.feet[1].getWorldPosition(new T.Vector3()),
    () => b.getMuzzleWorldPosition(new T.Vector3()),
    () => b.hips.getWorldPosition(new T.Vector3()),
  ];
  const names = ['head', 'handL', 'handR', 'footL', 'footR', 'muzzle', 'hips'];
  const out = [];
  let prev = null;
  b.reset();
  for (const [name, n, st] of seq) {
    const state = Object.assign({}, base, st);
    let maxV = {};
    for (let i = 0; i < n; i++) {
      b.update(1 / 60, state);
      b.root.updateMatrixWorld(true);
      const cur = pts.map(f => f());
      if (prev) cur.forEach((p, k) => { const v = p.distanceTo(prev[k]) * 60; if (!maxV[names[k]] || v > maxV[names[k]].v) maxV[names[k]] = { v: +v.toFixed(1), frame: i }; });
      prev = cur;
    }
    const worst = Object.entries(maxV).sort((a, b) => b[1].v - a[1].v)[0];
    out.push(name + ': ' + (worst ? worst[0] + ' ' + worst[1].v + ' m/s @' + worst[1].frame : '-'));
  }
  return out;
})()
