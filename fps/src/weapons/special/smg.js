// Slipstream (smg) mechanics: horizontal speed ("momentum") scales damage, spread and fire rate.
//
//   b = clamp((speed - from) / (to - from), 0, 1)                      (def.speedBonus, from 7 to 12 m/s)
//   damage x (1 + damage*b) . spread x (1 - spread*b) . fire interval / (1 + rate*b) . tracer white-hot at b > 0.6
//
// Shared by the player's WeaponSystem and Bot.js (bots pass their own horizontal speed).
import * as THREE from 'three';
import { clamp, lerp } from '../../core/utils.js';
import { getMaterials } from '../models/WeaponMaterials.js';

const HOT_AT = 0.6;
const _amber = new THREE.Color(0xffc23a);
const _white = new THREE.Color(0xffffff);
const SEGMENTS = 6;

/** Momentum 0..1 of `def` at horizontal `speed` (0 for weapons without a speedBonus). */
export function momentumOf(def, speed) {
  const sb = def && def.speedBonus;
  if (!sb) return 0;
  return clamp((speed - sb.from) / (sb.to - sb.from), 0, 1);
}

/** Damage multiplier at momentum m. */
export function damageScale(def, m) {
  return def.speedBonus ? 1 + def.speedBonus.damage * m : 1;
}

/** Fire-rate multiplier at momentum m. */
export function rateScale(def, m) {
  return def.speedBonus ? 1 + def.speedBonus.rate * m : 1;
}

/** Spread multiplier at momentum m. */
export function spreadScale(def, m) {
  return def.speedBonus ? 1 - def.speedBonus.spread * m : 1;
}

/** Tracer colour: the weapon's own, white-hot above 60% momentum. */
export function tracerFor(def, m) {
  return def.speedBonus && m > HOT_AT ? def.speedBonus.tracerHot : def.tracerColor;
}

/** Fire-sound playback rate (higher speed = higher pitch = audible feedback of the bonus). */
export function soundRate(def, m) {
  return def.speedBonus ? 1 + 0.1 * m : 1;
}

/**
 * Drive the view model's momentum gauge: `ceil(m * 6)` LED segments (parts gauge0..gauge5) on the shroud, brighter
 * with speed, amber -> white above 60%. The gauge material (`glowGauge`) is only used by the view model.
 * @param {Object<string, THREE.Object3D>} parts model.parts
 * @param {number} m smoothed momentum 0..1
 */
export function updateGauge(parts, m) {
  const M = getMaterials().glowGauge;
  const lit = Math.ceil(m * SEGMENTS - 1e-3);
  for (let i = 0; i < SEGMENTS; i++) {
    const seg = parts['gauge' + i];
    if (seg) seg.visible = i < lit;
  }
  if (M) {
    M.emissiveIntensity = lerp(0.35, 2.8, m);
    M.emissive.lerpColors(_amber, _white, clamp((m - 0.5) / 0.3, 0, 1));
  }
}
