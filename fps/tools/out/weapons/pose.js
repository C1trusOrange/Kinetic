// Pose scenario: sets up one viewmodel pose, freezes the sim and raises window.__POSE_READY__ for a screenshot.
// URL: pose=hip|ads|fire|reload|sprint|throw|melee|slide|equip|cycle|hold  weapon=rifle  p=<progress or seconds>  yaw/pitch
let step = 0;
let t0 = 0;
let frozen = false;

export function setup(game) {
  const P = game.params;
  if (P.get('notracer')) game.effects.tracer = () => {};
  if (P.get('nolight')) game.effects.flashLight = () => {};
  if (P.get('noimpact')) { game.effects.impact = () => {}; }
  const id = P.get('weapon') || 'rifle';
  const w = game.weapons;
  for (const wid of ['pistol', 'rifle', 'shotgun', 'sniper', 'rocket']) w.giveWeapon(wid);
  // force-select the weapon immediately (skip the switch animation unless pose=equip)
  w._applyWeapon(id);
  if (P.get('pose') !== 'equip') { w.switchState = 0; w.equipAmount = 1; }
  game.player.yaw = parseFloat(P.get('yaw') || '0');
  game.player.pitch = parseFloat(P.get('pitch') || '0');
  if (P.get('pose') === 'reload' && !P.get('ammo')) { w.inv[id].ammo = 1; w.ammo = 1; }
  if (P.get('ammo')) { w.inv[id].ammo = parseInt(P.get('ammo'), 10); w.ammo = w.inv[id].ammo; }
  window.__POSE_READY__ = false;
}

function freeze(game) {
  if (frozen) return;
  frozen = true;
  if (game.params.get('hideflash')) { game.weapons.flash.scale.setScalar(0.00001); game.weapons.flashLight.intensity = 0; }
  if (game.params.get('hideview')) { game.weapons.viewRoot.visible = false; }
  if (game.params.get('dbg')) { const w = game.weapons; w._flashStarMat.depthTest = false; w._flashStar.scale.set(0.5, 0.5, 1); w._flashStarMat.opacity = 1; w._flashJetMat.depthTest = false; }
  game.timeScale = 0;
  if (game.params.get('dbgcam')) {
    const [cx, cy, cz, lx, ly, lz] = game.params.get('dbgcam').split(',').map(Number);
    game.player.updateCamera = function () { const c = this.game.camera; c.position.set(cx, cy, cz); c.lookAt(lx, ly, lz); c.fov = 60; c.updateProjectionMatrix(); };
  }
  const w = game.weapons;
  window.__POSE_INFO__ = {
    id: w.currentId, ammo: w.ammo, reloading: w.reloading, prog: +w.reloadProgress.toFixed(3), ads: +w.adsAmount.toFixed(2),
    gState: w.gState, gT: +w.gT.toFixed(3), meleeT: +w.meleeT.toFixed(3), flashT: +w.flashT.toFixed(3), eq: +w.equipAmount.toFixed(2),
  };
  // let a couple of frames render at dt 0 before flagging
  setTimeout(() => { window.__POSE_READY__ = true; }, 400);
}

export function drive(t, dt, game) {
  const P = game.params;
  const pose = P.get('pose') || 'hip';
  const inp = game.input;
  const w = game.weapons;
  const p = parseFloat(P.get('p') || '0.5');
  const pl = game.player;
  if (frozen) return;
  switch (pose) {
    case 'hip':
      if (t > 1.2) freeze(game);
      break;
    case 'hold': // walk in place for bob
      inp.setVirtual('forward', t > 0.3);
      if (t > (p || 1.4)) freeze(game);
      break;
    case 'ads':
      inp.setVirtual('ads', t > 0.3);
      if (t > 1.3) freeze(game);
      break;
    case 'fire':
      inp.setVirtual('ads', P.get('ads') === '1');
      inp.setVirtual('fire', t > 1.0 && t < 1.05);
      if (w.lastFireTime > 0) { w.flashT = w._flashDur + 0.3; w.flash.visible = true; freeze(game); }
      break;
    case 'reload':
      if (t > 0.6 && t < 0.65) inp.setVirtual('reload', true); else inp.setVirtual('reload', false);
      if (w.reloading && w.reloadProgress >= p) freeze(game);
      break;
    case 'sprint':
      inp.setVirtual('forward', true);
      inp.setVirtual('sprint', t > 0.2);
      window.__DBG = window.__DBG || []; if (window.__DBG.length < 40) window.__DBG.push([+t.toFixed(2), +pl.speed.toFixed(2), pl.isSprinting, w.sprintBlend, game.state, pl.alive, inp.enabled, inp.action('forward')]);
      if (t > 0.85) freeze(game);
      break;
    case 'throw':
      inp.setVirtual('grenade', t > 0.6 && (w.gState === 0 || (w.gState !== 3 && w.gState !== 4 && t < 0.6 + p)));
      if (t > 0.6 + p) freeze(game);
      break;
    case 'melee':
      inp.setVirtual('melee', t > 0.6 && t < 0.65);
      if (w.meleeT >= p) freeze(game);
      break;
    case 'slide':
      pl.isSliding = true; pl.speed = 8; pl.isCrouching = true;
      if (t > 1.2) freeze(game);
      break;
    case 'wall':
      pl.isWallRunning = true; pl.wallRunSide = parseFloat(P.get('side') || '1'); pl.speed = 10; pl.onGround = false;
      if (t > 1.2) freeze(game);
      break;
    case 'equip':
      if (t > 0.4 && t < 0.45) { inp.setVirtual('weapon1', true); } else inp.setVirtual('weapon1', false);
      if (t > 0.45 && w.equipAmount >= p && w.switchState === 2) freeze(game);
      break;
    case 'cycle':
      inp.setVirtual('fire', t > 0.6 && t < 0.65);
      if (w.cycleT >= 0 && (w.cycleT - w.current.cycleDelay) / w.current.cycleTime >= p) freeze(game);
      break;
    default:
      if (t > 1.2) freeze(game);
  }
}
