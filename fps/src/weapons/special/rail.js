// Javelin (rail) mechanics: charge state machine (player), piercing beam (player + bots), view-model charge glow.
//
//   hold fire -> charge 0..1 over def.charge.time (0.7 s); release below minFrac (0.4) cancels (no ammo spent, 0.25 s lockout);
//   release above -> beam with dmg = minDamage + (damage - minDamage) * power^1.2 (34..130).
//   The beam passes through up to `pierce.entities` targets (x entityFalloff each) and, at power >= 0.9, up to `pierce.wall`
//   metres of thin cover (thickness measured with a reverse ray from the far side).
//   `charge.auto`: the shot fires by itself once the button has been held for `holdLimit` seconds (0.5 s window at full charge).
import * as THREE from 'three';
import { clamp, lerp } from '../../core/utils.js';
import { getMaterials } from '../models/WeaponMaterials.js';
import { getRailBeams } from '../../fx/RailBeam.js';

const _org = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _probe = new THREE.Vector3();
const _rev = new THREE.Vector3();
const _end = new THREE.Vector3();
const _v = new THREE.Vector3();
const CYAN = 0x8fe8ff;

/** Damage of a shot released at `power` (charge fraction; clamped to [minFrac, 1]). */
export function railDamage(def, power) {
  const c = def.charge;
  const p = clamp(power, c.minFrac, 1);
  return c.minDamage + (def.damage - c.minDamage) * Math.pow(p, 1.2);
}

/**
 * Fire the beam. Does the damage and all visuals (beam ribbon, shock rings, impact). Works for the player and for bots.
 * @param {object} game
 * @param {object} shooter entity
 * @param {{origin:THREE.Vector3, dir:THREE.Vector3, muzzle:THREE.Vector3, def:object, power?:number, dmgScale?:number}} o
 *   origin/dir = the aim ray (eye, spread applied), muzzle = where the visual beam starts
 * @returns {{hits:{entity:object, part:string, dmg:number, dealt:number, headshot:boolean}[], end:THREE.Vector3, length:number, pierced:number}}
 */
export function fireRail(game, shooter, o) {
  const def = o.def;
  const pr = def.pierce || { entities: 1, entityFalloff: 1, wall: 0 };
  const power = clamp(o.power ?? 1, def.charge.minFrac, 1);
  const base = railDamage(def, power) * (o.dmgScale ?? 1);
  _dir.copy(o.dir).normalize();
  _org.copy(o.origin);
  let remaining = def.range;
  let wallLeft = power >= 0.9 ? pr.wall : 0;
  const hits = [];
  const seen = [];
  let pierced = 0;
  let endWorld = null;
  let ended = false;
  for (let iter = 0; iter < 26 && remaining > 0.01; iter++) {
    const hit = game.combat.raycast(_org, _dir, remaining, shooter);
    if (!hit) break;
    if (hit.entity) {
      const e = hit.entity;
      if (seen.indexOf(e) < 0) {
        seen.push(e);
        if (hits.length < pr.entities) {
          let dmg = base * Math.pow(pr.entityFalloff, hits.length);
          const headshot = hit.part === 'head';
          if (headshot) dmg *= def.headshotMult; else if (hit.part === 'legs') dmg *= 0.8;
          game.effects.hitSpark(hit.point, hit.normal, e);
          const dealt = game.combat.applyDamage(e, {
            amount: dmg, attacker: shooter, weapon: def.id, headshot, point: hit.point, direction: _dir,
          });
          hits.push({ entity: e, part: hit.part, dmg, dealt, headshot });
        }
      }
      const adv = hit.distance + 0.3;       // continue behind the target (the same body is skipped via `seen`)
      _org.addScaledVector(_dir, adv);
      remaining -= adv;
      continue;
    }
    // world surface: pierce thin cover, otherwise stop
    if (wallLeft > 0.05) {
      _probe.copy(hit.point).addScaledVector(_dir, wallLeft);
      _rev.copy(_dir).negate();
      const back = game.world.raycast(_probe, _rev, wallLeft - 0.02);
      if (back) {
        const thick = wallLeft - back.distance;
        game.effects.impact(hit.point, hit.normal, hit.surface);
        game.effects.impact(back.point, back.normal, back.surface);
        wallLeft -= thick;
        pierced++;
        const adv = hit.distance + thick + 0.05;
        _org.addScaledVector(_dir, adv);
        remaining -= adv;
        continue;
      }
    }
    endWorld = hit;
    ended = true;
    break;
  }
  if (ended) _end.copy(endWorld.point);
  else _end.copy(_org).addScaledVector(_dir, Math.max(0, remaining));

  // ---- visuals
  const beams = getRailBeams(game);
  beams.add(o.muzzle, _end, { power });
  _v.subVectors(_end, o.muzzle);
  const length = _v.length();
  if (length > 0.01) _v.multiplyScalar(1 / length);
  beams.rings(o.muzzle, _v, length, power);
  if (endWorld) {
    game.effects.impact(endWorld.point, endWorld.normal, endWorld.surface);
    beams.impact(endWorld.point, endWorld.normal, power);
  }
  return { hits, end: _end, length, pierced };
}

/** Cyan muzzle glow of a charging shooter (bots: lets the victim dodge). */
export function chargeGlow(game, muzzle, dir, charge) {
  if (game.effects && typeof game.effects.muzzleFlash === 'function') {
    game.effects.muzzleFlash(muzzle, dir, { scale: 0.15 + 0.25 * clamp(charge, 0, 1), color: CYAN });
  }
}

// ------------------------------------------------------------------------------------------------ player charge

/** Stop the charge (loop, glow); no ammo is spent. `ws` is the WeaponSystem. */
export function cancelCharge(ws) {
  if (ws._chargeLoop) { ws._chargeLoop.stop(); ws._chargeLoop = null; }
  if (ws.charging && ws._chargeGlow) { ws.flash.visible = false; ws._chargeGlow = false; }
  ws.charging = false;
  ws.chargeAmount = 0;
  ws._chargeHold = 0;
  ws._chargeReady = false;
}

/**
 * Trigger logic of a charge weapon (called from WeaponSystem._updateFire instead of the normal semi/auto logic).
 * @param {object} ws WeaponSystem
 * @param {number} dt
 * @param {number} now game time
 * @param {object} inv inventory record of the weapon
 * @param {object} def
 */
export function updateCharge(ws, dt, now, inv, def) {
  const game = ws.game;
  const input = game.input;
  const p = game.player;
  const c = def.charge;
  const held = input.action('fire');
  const press = input.actionPressed('fire');
  const canAct = ws._canAct() && !ws.reloading && !p.isSprinting && ws.sprintBlend < 0.3;

  if (ws._chargeNeedRelease) {
    if (held) return;
    ws._chargeNeedRelease = false;
  }
  if (!ws.charging) {
    if (!held && !press) return;
    if (!canAct || now < ws.nextFireAt || now < ws._chargeLockUntil) return;
    if (inv.ammo <= 0) { ws._dryFire(now, inv, press); return; }
    ws.charging = true;
    ws.chargeAmount = 0;
    ws._chargeHold = 0;
    ws._chargeReady = false;
    ws._chargeLoop = game.audio.playLoop(def.chargeSound || 'rail_charge', { volume: 0.85, rate: 0.7 });
  }

  // ---- charging
  if (!held || !canAct || inv.ammo <= 0) {
    const power = ws.chargeAmount;
    const fire = canAct && inv.ammo > 0 && power >= c.minFrac;
    const wasCharging = ws.charging;
    cancelCharge(ws);
    if (fire) {
      ws._fire(def, inv, now, { power });
    } else if (wasCharging && canAct) {
      ws._chargeLockUntil = now + 0.25;         // released too early: fizzle
      game.audio.play('dry_fire', { volume: 0.5, rate: 0.7 });
    }
    return;
  }
  ws._chargeHold += dt;
  ws.chargeAmount = Math.min(1, ws.chargeAmount + dt / c.time);
  if (ws._chargeLoop) ws._chargeLoop.setRate(0.7 + 1.5 * ws.chargeAmount);
  if (ws.chargeAmount >= 1 && !ws._chargeReady) {
    ws._chargeReady = true;
    game.audio.play('rail_ready', { volume: 0.8 });
  }
  if (c.auto && ws._chargeHold >= c.holdLimit) {
    cancelCharge(ws);
    ws._fire(def, inv, now, { power: 1 });
    ws._chargeNeedRelease = true;
  }
}

// ------------------------------------------------------------------------------------------------ view model

/**
 * Charge glow of the view model: ring frames + rail channel ramp with the charge (rings jitter), the fusion cell dims as
 * the magazine empties. Uses the view-only glow materials (glowRing / glowChannel / glowCell).
 * @param {Object<string, THREE.Object3D>} parts model.parts
 * @param {number} charge 0..1
 * @param {number} ammoFrac mag / magSize
 * @param {number} clock seconds (jitter phase)
 */
export function updateViewFx(parts, charge, ammoFrac, clock) {
  const M = getMaterials();
  if (M.glowRing) M.glowRing.emissiveIntensity = lerp(0.3, 2.8, charge);
  if (M.glowChannel) M.glowChannel.emissiveIntensity = lerp(0.25, 2.8, charge * charge);
  if (M.glowCell) M.glowCell.emissiveIntensity = lerp(0.25, 1.7, clamp(ammoFrac, 0, 1));
  const r = parts.rings;
  if (r && r.userData.rest) {
    const j = 0.002 * charge;
    r.position.set(
      r.userData.rest.position.x + Math.sin(clock * 91) * j,
      r.userData.rest.position.y + Math.sin(clock * 77 + 1.3) * j,
      r.userData.rest.position.z);
  }
}
