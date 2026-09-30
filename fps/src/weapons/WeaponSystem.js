import * as THREE from 'three';
import { WEAPONS, WEAPON_ORDER, GRENADE_TYPES, MELEE } from './WeaponDefs.js';
import { newInventory, spawnLoadout, addToInventory, nextHeldType } from './GrenadeTypes.js';
import { createWeaponModel, createGrenadeModel } from './WeaponModels.js';
import { clamp, lerp, damp, approach, wrapAngle, randRange, randomInCone } from '../core/utils.js';
import { GRAVITY } from '../core/constants.js';
import { momentumOf, damageScale, rateScale, spreadScale, tracerFor, soundRate, updateGauge } from './special/smg.js';
import { fireRail, updateCharge, cancelCharge, updateViewFx } from './special/rail.js';
import { getRailBeams } from '../fx/RailBeam.js';
import { fireArc, updateBeamVisual, beamCadence } from './special/arc.js';

// ---------------------------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------------------------

const S_NONE = 0, S_OUT = 1, S_IN = 2;                                   // weapon switch phases
const G_IDLE = 0, G_PULL = 1, G_HOLD = 2, G_THROW = 3, G_RECOVER = 4;    // grenade phases

const SWITCH_OUT_TIME = 0.12;
const PULL_TIME = 0.3;          // pin pull animation (a release earlier than this waits)
const THROW_RELEASE = 0.16;     // seconds into the throw swing when the grenade leaves the hand
const RECOVER_TIME = 0.34;
const MELEE_HIT_AT = 0.13;
const MELEE_TIME = 0.5;
const PREVIEW_DOTS = 44;
const GRENADE_RADIUS_SAFE = 0.1;

// ---- input timing: REAL time on the input clock (seconds, measured from the press's own DOM timestamp, see
//      core/Input.js), so hit-stop, the end-of-match slow motion or a long frame never stretch them.
/** A click that meets a fire-rate cooldown or the sprint-out still fires if that ends within this. Nothing else. */
const FIRE_BUFFER = 0.12;
/** A weapon key pressed while a grenade is still in the hand / before the melee hit frame is applied then, if this fresh. */
const KEY_MEMORY = 0.3;
/** A pickup's auto-switch that had to wait for a grenade expires after this. */
const QUEUED_SWITCH_TTL = 0.35;
/** R pressed while the weapon is busy (switch / equip / grenade / melee), or G / V during a switch-out, waits this long. */
const ACTION_LATCH = 0.15;
/** Weapon selection keys (number keys by slot, Q) and the weapon behind each number key. */
const SWITCH_KEYS = ['weapon1', 'weapon2', 'weapon3', 'weapon4', 'weapon5', 'weapon6', 'weapon7', 'weapon8', 'weapon9', 'lastWeapon'];
const KEY_WEAPON = {};
for (const id of WEAPON_ORDER) KEY_WEAPON['weapon' + WEAPONS[id].slot] = id;

const DEFAULT_HIP = new THREE.Vector3(0.17, -0.2, -0.42);

// viewmodel pose tables: [px, py, pz, rx, ry, rz]
const ZERO6 = [0, 0, 0, 0, 0, 0];
const MELEE_WIND = [0.15, 0.035, 0.11, 0.4, -0.75, -0.4];
const MELEE_HIT = [-0.21, -0.075, -0.27, -0.4, 1.15, 0.45];
/** Gun pose at full reload envelope (the gun turns and dips while the hands work). */
const RELOAD_POSE = {
  pistol: [-0.03, -0.03, 0.02, 0.16, 0.1, 0.32],
  rifle: [-0.035, -0.04, 0.03, 0.1, 0.1, 0.3],
  shotgun: [-0.03, 0.045, 0.0, 0.3, 0.1, 0.72],
  sniper: [-0.04, -0.045, 0.04, 0.12, 0.12, 0.34],
  smg: [-0.035, -0.035, 0.03, 0.1, 0.1, 0.28],
  rail: [-0.04, -0.045, 0.04, 0.12, 0.12, 0.34],
  rocket: [-0.04, -0.12, 0.08, -0.35, 0.1, 0.5],
  arc: [-0.035, -0.04, 0.03, 0.1, 0.1, 0.3],
  gale: [-0.03, -0.05, 0.03, 0.12, 0.1, 0.3],
};
/** Camera-space keyframes of the grenade (left) hand. */
const ARM_HIDDEN = [-0.42, -0.62, -0.28, 0.7, -0.9, 0.3];
const ARM_READY = [-0.06, -0.17, -0.5, 0.38, -0.82, 0.25];
const ARM_WIND = [-0.15, -0.1, -0.36, 0.72, -0.95, 0.4];
const ARM_RELEASE = [0.0, -0.13, -0.72, 0.15, -0.4, 0.0];
const ARM_AWAY = [0.06, -0.32, -1.0, 0.0, -0.1, -0.2];

/**
 * Reload choreography per weapon (root space, meters). Mag weapons: `travel`/`dir` = how far/which way the magazine
 * slides out, `fetch` = extra offset of the empty hand while it fetches the new magazine. Shell weapons:
 * `gate` = loading port, `fetch` = shell pouch.
 */
const RELOAD_CFG = {
  pistol: { travel: 0.1, dir: [0, -1, 0.06], fetch: [0.0, -0.08, 0.04] },
  rifle: { travel: 0.15, dir: [0, -1, 0.1], fetch: [-0.02, -0.1, 0.06] },
  sniper: { travel: 0.12, dir: [0, -1, 0], fetch: [-0.02, -0.09, 0.05] },
  smg: { travel: 0.12, dir: [0, -1, 0.12], fetch: [-0.02, -0.09, 0.05] },
  rail: { travel: 0.12, dir: [0, -1, 0], fetch: [-0.02, -0.09, 0.05] },
  rocket: { travel: 0.14, dir: [0, -1, 0], fetch: [-0.03, -0.1, 0.06] },
  shotgun: { gate: [0, -0.03, 0.02], fetch: [-0.09, -0.16, 0.13] },
  arc: { travel: 0.14, dir: [0, -1, 0.08], fetch: [-0.02, -0.1, 0.06] },
  gale: { travel: 0.10, dir: [0, -1, 0], fetch: [-0.02, -0.09, 0.05] },
};

// scratch objects (no per-frame allocation)
const _eye = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _upv = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _muzzleW = new THREE.Vector3();
/**
 * Muzzle-flash brightness. Point lights use a soft-core falloff (World.js), so the viewmodel light - which sits a
 * few centimetres from the gun - needs a larger candela value than before to light the gun/hands at all; the
 * sprite gains are lower than they were (the flash used to burn out to a white starburst on a bright bloom).
 */
const VIEW_FLASH_LIGHT = 3.2;    // x def.flash.light (viewmodel-only light; never lights the world)
const WORLD_FLASH_LIGHT = 16;    // candela of the pooled world light for the player's shots (x weapon flash size)
const VIEW_FLASH_STAR = 1.0;     // x flash colour, additive star sprite
const VIEW_FLASH_JET = 0.85;     // x flash colour, additive barrel jets
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _v4 = new THREE.Vector3();
const _v5 = new THREE.Vector3();
const _box = new THREE.Box3();
const _m4 = new THREE.Matrix4();
const _Z = new THREE.Vector3(0, 0, 1);
const _Y = new THREE.Vector3(0, 1, 0);

const sm = t => { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
/** Smoothstep of x between a and b (clamped). */
const sm01 = (x, a, b) => sm((x - a) / (b - a));
const mixPose = (out, a, b, t) => { for (let i = 0; i < 6; i++) out[i] = a[i] + (b[i] - a[i]) * t; return out; };

/** Critically-ish damped spring used for recoil / landing kicks. */
class Spring {
  constructor(k = 240, c = 22) { this.x = 0; this.v = 0; this.k = k; this.c = c; }
  kick(dx, dv = 0) { this.x += dx; this.v += dv; }
  step(dt) {
    const n = dt > 0.02 ? 3 : 1;
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.v += (-this.k * this.x - this.c * this.v) * h;
      this.x += this.v * h;
    }
  }
  reset() { this.x = 0; this.v = 0; }
}

// ---------------------------------------------------------------------------------------------
// procedural textures
// ---------------------------------------------------------------------------------------------

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Starburst used for the viewmodel muzzle flash. */
function makeStarTexture() {
  return canvasTex(128, 128, (g, w, h) => {
    g.translate(w / 2, h / 2);
    for (let i = 0; i < 8; i++) {
      const len = (i % 2 === 0 ? 62 : 38) * (0.85 + ((i * 37) % 10) / 33);
      g.save();
      g.rotate((i / 8) * Math.PI * 2 + 0.2);
      const grad = g.createLinearGradient(0, 0, len, 0);
      grad.addColorStop(0, 'rgba(255,255,255,0.95)');
      grad.addColorStop(0.35, 'rgba(255,190,90,0.6)');
      grad.addColorStop(1, 'rgba(255,120,30,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(0, -5);
      g.lineTo(len, 0);
      g.lineTo(0, 5);
      g.closePath();
      g.fill();
      g.restore();
    }
    const core = g.createRadialGradient(0, 0, 0, 0, 0, 34);
    core.addColorStop(0, 'rgba(255,255,255,1)');
    core.addColorStop(0.3, 'rgba(255,220,150,0.9)');
    core.addColorStop(1, 'rgba(255,140,40,0)');
    g.fillStyle = core;
    g.fillRect(-64, -64, 128, 128);
  });
}

/** Elongated teardrop (tip up) for the barrel-aligned flash planes. */
function makeJetTexture() {
  return canvasTex(64, 128, (g, w, h) => {
    g.translate(w / 2, h - 14);
    g.scale(0.29, 1);
    const grad = g.createRadialGradient(0, 0, 0, 0, 0, 108);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.25, 'rgba(255,215,140,0.85)');
    grad.addColorStop(0.65, 'rgba(255,140,50,0.28)');
    grad.addColorStop(1, 'rgba(255,90,20,0)');
    g.fillStyle = grad;
    g.fillRect(-80, -120, 160, 240);
  });
}

// ---------------------------------------------------------------------------------------------
// WeaponSystem
// ---------------------------------------------------------------------------------------------

/**
 * The local player's arsenal: inventory, firing, reloading, switching, grenades, melee and the
 * animated first-person viewmodel (parented to game.viewCamera).
 */
export class WeaponSystem {
  /** @param {object} game */
  constructor(game) {
    this.game = game;

    // ---- HUD state (see ARCHITECTURE.md 6.5)
    this.currentId = 'rifle';
    this.current = WEAPONS.rifle;
    this.ammo = 0;
    this.reserve = 0;
    this.reloading = false;
    this.reloadProgress = 0;
    this.adsAmount = 0;
    this.scoped = false;
    this.spreadAngle = WEAPONS.rifle.spread.hip;
    /** Per-type grenade counts (see GrenadeTypes.js); `grenades` / `maxGrenades` below read the SELECTED type. */
    this.nades = newInventory();
    this.grenadeType = 'frag';
    this._throwType = 'frag';
    this.cooking = false;
    this.cookProgress = 0;
    this.owned = [];
    this.lastFireTime = -1;
    /** Slipstream: horizontal-speed momentum 0..1 (damage / spread / rate scaling, HUD meter, view-model gauge). */
    this.momentum = 0;
    /** Javelin: true while the trigger is held and the charge builds (chargeAmount 0..1). */
    this.charging = false;
    this.chargeAmount = 0;
    /** True while a weapon swap animation is running. */
    this.switching = false;
    /** True during the grenade pull / throw / recover sequence and the melee bash. */
    this.throwing = false;
    this.meleeing = false;

    /** Per-weapon inventory: { owned, ammo, reserve }. */
    this.inv = {};
    for (const id of WEAPON_ORDER) this.inv[id] = { owned: false, ammo: 0, reserve: 0 };

    // ---- logic state
    this.lastId = 'pistol';
    this.pendingId = null;
    this.switchState = S_NONE;
    this.equipAmount = 1;
    this._queuedSwitch = null;
    // input latches (input-clock seconds, see the timing constants above)
    this._queuedAt = 0;          // when _queuedSwitch was queued
    this._keyMem = null;         // weapon id of a key waiting for the grenade to leave the hand / the melee hit
    this._keyMemT = 0;
    this._reloadLatchUntil = 0;  // an R waiting for the weapon to become ready
    this._gLatchUntil = 0;       // a G waiting for the switch-out
    this._vLatchUntil = 0;       // a V waiting for the switch-out
    this._switchReqAt = 0;       // when the current switch was asked for (Javelin: a trigger held since then must be released)
    this._meleeRate = 1;         // > 1 while a melee tail plays back under a switch-out
    this._gRate = 1;             // > 1 while a grenade follow-through / recovery plays back under a switch-out
    this._want = { id: null, t: 0 };
    this.nextFireAt = 0;
    this._fireBufferUntil = 0;
    this._dryClickAt = 0;
    this._emptySwitchAt = 0;
    this._adsLockUntil = 0;
    this._chargeLoop = null;
    this._chargeHold = 0;
    this._chargeReady = false;
    this._chargeGlow = false;
    this._chargeLockUntil = 0;
    this._chargeNeedRelease = false;
    this._gaugeM = 0;
    this._fovKick = new Spring(190, 17);
    this._hitStopUntil = 0;
    this._hitStopScale = 1;
    this.bloom = 0;
    this._recoilBias = 1;
    this._lastShotAt = -10;
    this.visible = true;

    this.reloadT = 0;
    this.reloadTotal = 1;
    this.reloadWasEmpty = false;
    this._reloadCommitted = false;
    this._shellsLoaded = 0;
    this._shellsNeeded = 0;
    this._reloadEndSound = false;

    this.cycleT = -1;            // pump / bolt cycle timer (-1 = idle)
    this._cycleSound = false;
    this._cycleEject = false;

    this.gState = G_IDLE;
    this.gT = 0;
    this.cookTime = 0;
    this._pinSound = false;
    this._grenadeLower = 0;

    this.meleeT = -1;
    this._meleeHit = false;
    this.nextMeleeAt = 0;

    this.sprintBlend = 0;

    // ---- Tempest beam / Gale viewmodel FX state
    this._beamOn = false;        // beam loop running
    this._beamLoop = null;       // playLoop handle
    this._beamLast = -10;        // game time of the last beam tick
    this._beamDist = 0;          // hit distance of the last tick (keeps the per-frame beam glued to the muzzle)
    this._beamChained = 0;
    this._beamEventAt = -10;
    this._beamLightAt = -10;
    this._fireAmt = 0;           // 0..1 glow amount, kicked by every shot / tick and decaying
    this._coilAng = 0;
    this._rotorAng = 0;

    // ---- viewmodel state
    this.vm = {};                // id -> prepared viewmodel record
    this._clock = 0;
    this._lastYaw = 0;
    this._lastPitch = 0;
    this._swayYaw = 0;
    this._swayPitch = 0;
    this._lat = 0;
    this._air = 0;
    this._bobAmp = 0;
    this._bobPhase = 0;
    this._crouch = 0;
    this._slide = 0;
    this._wall = 0;
    this._wallSide = 0;
    this._rb = 0;                // smoothed reload pose blend
    this.flashT = 0;
    this._flashDur = 0.05;
    this._trigger = 0;
    this._slideRecoil = new Spring(420, 26);
    this._sp = {
      kz: new Spring(260, 23), ky: new Spring(260, 23),
      krx: new Spring(220, 20), kry: new Spring(220, 20), krz: new Spring(220, 20),
      ly: new Spring(150, 15), lrx: new Spring(150, 15),
    };
    this._ch = {                 // smoothed animation channels for parts
      magOut: 0, handMag: 0, handFetch: 0, handGate: 0, rack: 0, boltBack: 0, boltLift: 0, pump: 0, magVis: 1,
    };
    this._hd = new THREE.Vector3();
    this._pose = [0, 0, 0, 0, 0, 0];
    this._poseA = [0, 0, 0, 0, 0, 0];
    this._previewT = 0;
    this._previewShown = false;

    // ---- scene objects (constructors may add persistent objects)
    this.viewRoot = new THREE.Group();
    this.viewRoot.name = 'viewmodel';
    game.viewCamera.add(this.viewRoot);
    this._buildFlash();
    this._buildCasings();
    this._buildPreview();
    this.throwArm = null;

    // ---- events
    game.events.on('player:land', e => this._onLand(e));
    game.events.on('death', e => this._onDeath(e));
  }

  // ===========================================================================================
  // setup
  // ===========================================================================================

  /** Build the first-person models for every weapon plus the grenade-throwing hand. */
  async init() {
    for (const id of WEAPON_ORDER) {
      let model;
      try {
        model = createWeaponModel(id, { view: true });
      } catch (err) {
        console.error(`[weapons] viewmodel for '${id}' failed, using a placeholder`, err);
        model = this._fallbackModel();
      }
      this.vm[id] = this._prepareModel(id, model);
      model.root.visible = false;
      this.viewRoot.add(model.root);
    }
    this.throwArm = this._buildThrowArm();
    this.viewRoot.add(this.throwArm.group);
    getRailBeams(this.game);      // create the beam mesh up front so Game.warmup compiles its shader (no first-shot hitch)
    this._selectVisual(this.currentId);
  }

  /** Minimal stand-in used only when a weapon model fails to build. */
  _fallbackModel() {
    const root = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x333840, roughness: 0.5, metalness: 0.6 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.6), mat);
    body.position.set(0, 0.05, -0.2);
    root.add(body);
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0.07, -0.5);
    const sight = new THREE.Object3D();
    sight.position.set(0, 0.12, -0.05);
    root.add(muzzle, sight);
    return { root, muzzle, sight, ejectPort: null, hip: DEFAULT_HIP.clone(), adsDistance: 0.2, parts: {} };
  }

  _prepareModel(id, model) {
    const root = model.root;
    root.rotation.order = 'YXZ';
    root.traverse(o => {
      if (o.isMesh) { o.frustumCulled = false; o.castShadow = false; o.receiveShadow = false; }
    });
    root.updateMatrixWorld(true);
    const rootQ = root.getWorldQuaternion(new THREE.Quaternion());
    const vm = {
      id, model, root,
      hip: (model.hip && model.hip.isVector3) ? model.hip.clone() : DEFAULT_HIP.clone(),
      adsDistance: model.adsDistance ?? 0.2,
      adsPos: new THREE.Vector3(),
      parts: {},
      armIsAncestor: false,
    };
    // ADS: put the sight on the camera axis at adsDistance
    if (model.sight) {
      const s = root.worldToLocal(model.sight.getWorldPosition(new THREE.Vector3()));
      vm.adsPos.set(-s.x, -s.y, -vm.adsDistance - s.z);
    } else {
      vm.adsPos.set(0, -0.1, -vm.adsDistance);
    }
    // animatable parts: rest transforms + parent-frame conversion for root-space deltas
    const src = model.parts || {};
    for (const key of Object.keys(src)) {
      const o = src[key];
      if (!o || !o.isObject3D) continue;
      const parentQ = o.parent ? o.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
      vm.parts[key] = {
        obj: o, pos: o.position.clone(), rot: o.rotation.clone(), restQuat: o.quaternion.clone(), visible: o.visible,
        toLocal: parentQ.invert().multiply(rootQ),
      };
    }
    const P = vm.parts;
    if (P.leftHand && P.leftArm) {
      let a = P.leftHand.obj.parent;
      while (a) { if (a === P.leftArm.obj) { vm.armIsAncestor = true; break; } a = a.parent; }
    }
    // reload choreography anchors (all in root space, measured at rest)
    const cfg = RELOAD_CFG[id] || RELOAD_CFG.rifle;
    vm.magTravel = cfg.travel || 0.12;
    vm.magDir = new THREE.Vector3().fromArray(cfg.dir || [0, -1, 0]);
    vm.fetchVec = new THREE.Vector3().fromArray(cfg.fetch || [0, -0.08, 0.05]);
    vm.magCenter = new THREE.Vector3();
    vm.handCenter = new THREE.Vector3(0, -0.03, -0.3);
    vm.elbow = null;
    if (P.leftHand) {
      _box.setFromObject(P.leftHand.obj);
      if (!_box.isEmpty()) root.worldToLocal(_box.getCenter(vm.handCenter));
    }
    if (P.leftArm) vm.elbow = root.worldToLocal(P.leftArm.obj.getWorldPosition(new THREE.Vector3()));
    if (P.mag) {
      _box.setFromObject(P.mag.obj);
      if (!_box.isEmpty()) root.worldToLocal(_box.getCenter(vm.magCenter));
    }
    // animated glow (Tempest coil, Gale funnel rings): private material clones so pulsing them never touches the
    // shared materials used by pickups / bots
    vm.glow = {};
    for (const key of ['coil', 'ring0', 'ring1', 'ring2']) {
      const pt = vm.parts[key];
      if (!pt) continue;
      const list = [];
      pt.obj.traverse(o => {
        if (o.isMesh && o.material && o.material.emissive && o.material.emissiveIntensity > 0) {
          o.material = o.material.clone();
          list.push({ mat: o.material, base: o.material.emissiveIntensity });
        }
      });
      vm.glow[key] = list;
    }
    // Tempest ammo-gauge cells: private, dimmer clones (at full strength the bloom turns the row into a white slab)
    for (let i = 0; vm.parts['gauge' + i]; i++) {
      vm.parts['gauge' + i].obj.traverse(o => {
        if (o.isMesh && o.material && o.material.emissive) { o.material = o.material.clone(); o.material.emissiveIntensity *= 0.5; }
      });
    }
    vm.gatePos = new THREE.Vector3().fromArray(cfg.gate || [0, -0.03, 0.02]);
    vm.fetchPos = new THREE.Vector3().fromArray(cfg.fetch || [-0.09, -0.15, 0.12]);
    return vm;
  }

  _buildFlash() {
    const star = makeStarTexture();
    const jet = makeJetTexture();
    this.flash = new THREE.Group();
    this.flash.visible = false;
    const mk = (map) => new THREE.MeshBasicMaterial({
      map, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      color: new THREE.Color(2, 1.6, 1.1), fog: false,
    });
    this._flashStarMat = new THREE.SpriteMaterial({
      map: star, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: new THREE.Color(2.4, 1.8, 1.1), fog: false,
    });
    this._flashStar = new THREE.Sprite(this._flashStarMat);
    this.flash.add(this._flashStar);
    this._flashJetMat = mk(jet);
    this._flashJets = [];
    for (let i = 0; i < 2; i++) {
      const geo = new THREE.PlaneGeometry(1, 1);
      geo.rotateX(-Math.PI / 2);
      geo.translate(0, 0, -0.5);
      const m = new THREE.Mesh(geo, this._flashJetMat);
      m.rotation.z = i * Math.PI / 2;
      m.frustumCulled = false;
      this._flashJets.push(m);
      this.flash.add(m);
    }
    // the one permanent viewmodel light (intensity 0 when idle; never toggled visible)
    this.flashLight = new THREE.PointLight(0xffc27a, 0, 3.2, 2);
    this.viewRoot.add(this.flashLight);
  }

  _buildCasings() {
    this._brassGeo = new THREE.BoxGeometry(0.007, 0.007, 0.02);
    this._shellGeo = new THREE.CylinderGeometry(0.0115, 0.0115, 0.045, 8).rotateX(Math.PI / 2);
    this._brassMat = new THREE.MeshStandardMaterial({ color: 0xd8a640, metalness: 0.9, roughness: 0.32 });
    this._shellMat = new THREE.MeshStandardMaterial({ color: 0xb8322a, metalness: 0.1, roughness: 0.55 });
    this.casings = [];
    for (let i = 0; i < 10; i++) {
      const mesh = new THREE.Mesh(this._brassGeo, this._brassMat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.viewRoot.add(mesh);
      this.casings.push({ mesh, vel: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0, max: 0.6 });
    }
    this._casingIdx = 0;
  }

  _buildPreview() {
    const game = this.game;
    this._previewMat = new THREE.MeshBasicMaterial({ color: 0x7feaff, transparent: true, opacity: 0.85, depthWrite: false, fog: false });
    this.previewDots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.03, 6, 4), this._previewMat, PREVIEW_DOTS);
    this.previewDots.frustumCulled = false;
    this.previewDots.count = 0;
    this.previewDots.visible = false;
    this.previewDots.renderOrder = 5;
    const ringGeo = new THREE.RingGeometry(0.22, 0.3, 24);
    ringGeo.rotateX(-Math.PI / 2);
    this._previewRingMat = new THREE.MeshBasicMaterial({ color: 0xff9a3c, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, fog: false });
    this.previewRing = new THREE.Mesh(ringGeo, this._previewRingMat);
    this.previewRing.visible = false;
    this.previewRing.frustumCulled = false;
    // footprint of the selected grenade's effect (radius scaled per type; hidden for the frag)
    const areaGeo = new THREE.RingGeometry(0.965, 1, 64);
    areaGeo.rotateX(-Math.PI / 2);
    this._previewAreaMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide, fog: false });
    this.previewArea = new THREE.Mesh(areaGeo, this._previewAreaMat);
    this.previewArea.visible = false;
    this.previewArea.frustumCulled = false;
    this._previewType = '';
    game.scene.add(this.previewDots, this.previewRing, this.previewArea);
  }

  _buildThrowArm() {
    const group = new THREE.Group();
    group.visible = false;
    group.rotation.order = 'YXZ';
    const sleeve = new THREE.MeshStandardMaterial({ color: 0x33465a, roughness: 0.78, metalness: 0.15 });
    const glove = new THREE.MeshStandardMaterial({ color: 0x252a32, roughness: 0.5, metalness: 0.4 });
    const plate = new THREE.MeshStandardMaterial({ color: 0x5b6674, roughness: 0.38, metalness: 0.85 });
    const accent = new THREE.MeshStandardMaterial({ color: 0x0c1418, roughness: 0.4, metalness: 0.3, emissive: 0x3de0ff, emissiveIntensity: 2.6 });
    const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0, parent = group) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      m.frustumCulled = false;
      parent.add(m);
      return m;
    };
    // forearm runs toward +Z (back to the camera)
    add(new THREE.CylinderGeometry(0.036, 0.052, 0.56, 12).rotateX(Math.PI / 2), sleeve, 0, 0, 0.34);
    add(new THREE.CylinderGeometry(0.044, 0.044, 0.05, 12).rotateX(Math.PI / 2), plate, 0, 0, 0.085);     // cuff ring
    add(new THREE.TorusGeometry(0.049, 0.0055, 6, 18), accent, 0, 0, 0.115);                              // glowing band
    add(new THREE.BoxGeometry(0.075, 0.022, 0.15), plate, 0, 0.04, 0.2);                                   // bracer plate
    add(new THREE.BoxGeometry(0.03, 0.006, 0.09), accent, 0, 0.053, 0.2);                                  // bracer light strip
    // glove: palm + knuckle guard + curled fingers + thumb
    add(new THREE.BoxGeometry(0.088, 0.048, 0.085), glove, 0, 0, 0.0);
    add(new THREE.BoxGeometry(0.09, 0.014, 0.04), plate, 0, 0.03, -0.015);
    for (let i = 0; i < 4; i++) {
      const x = -0.033 + i * 0.022;
      add(new THREE.BoxGeometry(0.02, 0.022, 0.05), glove, x, 0.008, -0.062, -0.35, 0, 0);
      add(new THREE.BoxGeometry(0.019, 0.02, 0.04), glove, x, 0.045, -0.085, -1.25, 0, 0);
    }
    add(new THREE.BoxGeometry(0.024, 0.024, 0.06), glove, 0.055, 0.02, -0.03, -0.3, 0.55, 0);
    // grenade held in the palm
    const nade = new THREE.Group();
    nade.add(createGrenadeModel());
    nade.userData.type = 'frag';
    nade.position.set(0.0, 0.062, -0.058);
    nade.traverse(o => { if (o.isMesh) o.frustumCulled = false; });
    group.add(nade);
    // pull-ring (flies off when the pin is pulled)
    const ring = add(new THREE.TorusGeometry(0.014, 0.0025, 6, 12), plate, 0.05, 0.085, -0.052, 0, Math.PI / 2, 0);
    return { group, nade, ring };
  }

  // ===========================================================================================
  // lifecycle
  // ===========================================================================================

  /** Match start: reset inventory (shader warm-up is done by Game.warmup). */
  onMatchStart() {
    this._resetState();
  }

  /** Default loadout: pistol, rifle, shotgun (full reserve) + start grenades; rifle selected. */
  onPlayerSpawn() {
    this._resetState();
    const lo = this.game.modes && this.game.modes.loadoutFor(this.game.player);   // Escalation: sidearm + the weapon of the current tier
    const start = lo ? lo.primary : 'rifle';
    this._escWant = null;
    for (const id of WEAPON_ORDER) {
      const inv = this.inv[id];
      inv.owned = lo ? id === 'pistol' || id === lo.primary : id === 'pistol' || id === 'rifle' || id === 'shotgun';
      inv.ammo = inv.owned ? WEAPONS[id].magSize : 0;
      inv.reserve = inv.owned ? WEAPONS[id].reserveStart : 0;
    }
    this._rebuildOwned();
    spawnLoadout(this.nades);
    this.grenadeType = 'frag';
    this._throwType = 'frag';
    this.lastId = 'pistol';
    this._selectVisual(start);
    this.currentId = start;
    this.current = WEAPONS[start];
    this.ammo = this.inv[start].ammo;
    this.reserve = this.inv[start].reserve;
    this.switchState = S_IN;
    this.equipAmount = 0;
    this.switching = true;
    const p = this.game.player;
    this._lastYaw = p.yaw;
    this._lastPitch = p.pitch;
    this.game.events.emit('weapon:switch', { shooter: p, weapon: start });
  }

  _resetState() {
    cancelCharge(this);
    this._chargeNeedRelease = false;
    this._chargeLockUntil = 0;
    this.momentum = 0;
    this._gaugeM = 0;
    this._fovKick.reset();
    this._updateHitStop(true);
    this.reloading = false;
    this.reloadProgress = 0;
    this.reloadT = 0;
    this.adsAmount = 0;
    this.scoped = false;
    this.bloom = 0;
    this.cooking = false;
    this.cookProgress = 0;
    this.cookTime = 0;
    this.gState = G_IDLE;
    this.gT = 0;
    this.throwing = false;
    this.meleeing = false;
    this.meleeT = -1;
    this.cycleT = -1;
    this.switchState = S_NONE;
    this.switching = false;
    this.equipAmount = 1;
    this.pendingId = null;
    this._resetInputLatches();
    this.nextFireAt = 0;
    this.nextMeleeAt = 0;
    this._fireBufferUntil = 0;
    this._emptySwitchAt = 0;
    this._adsLockUntil = 0;
    this.sprintBlend = 0;
    this._rb = 0;
    this._grenadeLower = 0;
    this.flashT = 0;
    this._slideLock = false;
    this._stopBeam(false);
    this._fireAmt = 0;
    for (const k of Object.keys(this._sp)) this._sp[k].reset();
    this._slideRecoil.reset();
    for (const k of Object.keys(this._ch)) this._ch[k] = k === 'magVis' ? 1 : 0;
    this.flash.visible = false;
    this.flashLight.intensity = 0;
    this.previewDots.visible = false;
    this.previewRing.visible = false;
    this.previewArea.visible = false;
    this._previewShown = false;
    if (this.throwArm) this.throwArm.group.visible = false;
    for (const c of this.casings) { c.mesh.visible = false; c.life = 0; }
    const p = this.game.player;
    if (p) { p.lookScale = 1; p.fovMultiplier = 1; }
  }

  _rebuildOwned() {
    this.owned = WEAPON_ORDER.filter(id => this.inv[id].owned);
  }

  /** Show only the given weapon's viewmodel and move the muzzle flash onto it. */
  _selectVisual(id) {
    for (const k of WEAPON_ORDER) {
      const vm = this.vm[k];
      if (vm) vm.root.visible = k === id && this.visible;
    }
    const vm = this.vm[id];
    if (vm && vm.model.muzzle) vm.model.muzzle.add(this.flash);
    this._resetPartsToRest(vm);
  }

  /**
   * Show / hide the viewmodel content. (viewRoot itself stays visible: it holds the permanent muzzle-flash
   * light and toggling a light's visibility would change the shader light count.)
   */
  setVisible(v) {
    this.visible = !!v;
    if (!this.visible) {
      for (const id of WEAPON_ORDER) if (this.vm[id]) this.vm[id].root.visible = false;
      if (this.throwArm) this.throwArm.group.visible = false;
      this.flash.visible = false;
      this.flashLight.intensity = 0;
      this.flashT = 0;
      for (const c of this.casings) { c.mesh.visible = false; c.life = 0; }
    }
  }

  // ===========================================================================================
  // inventory API
  // ===========================================================================================

  /**
   * Give a weapon: new weapon (auto-switch) or reserve refill.
   * @param {string} id
   * @returns {boolean} false if nothing changed
   */
  giveWeapon(id) {
    const def = WEAPONS[id];
    const inv = this.inv[id];
    if (!def || !inv) return false;
    if (!inv.owned) {
      inv.owned = true;
      inv.ammo = def.magSize;
      inv.reserve = Number.isFinite(def.reserveStart) ? def.reserveStart : Infinity;
      this._rebuildOwned();
      this._requestSwitch(id);
      return true;
    }
    if (!Number.isFinite(def.reserveMax)) return false;
    const before = inv.reserve;
    inv.reserve = Math.min(def.reserveMax, inv.reserve + Math.ceil(def.reserveMax * 0.5));
    if (id === this.currentId) this.reserve = inv.reserve;
    return inv.reserve > before;
  }

  /**
   * Escalation tier change: keep the sidearm, replace every other weapon with `id` at full ammo and draw it.
   * @param {string} id
   * @returns {boolean}
   */
  setEscalationWeapon(id) {
    const def = WEAPONS[id];
    const target = this.inv[id];
    if (!def || !target) return false;
    for (const k of WEAPON_ORDER) this.inv[k].owned = k === 'pistol' || k === id;
    target.ammo = def.magSize;
    target.reserve = Number.isFinite(def.reserveMax) ? def.reserveMax : Infinity;
    this._rebuildOwned();
    if (id === this.currentId) {
      this.ammo = target.ammo;
      this.reserve = target.reserve;
    }
    if (!this._requestSwitch(id)) this._escWant = id;   // grenade / melee in progress: draw it as soon as that ends
    return true;
  }

  /**
   * Add reserve ammo.
   * @param {string|null} id  weapon id, or null for all owned weapons
   * @param {number} fraction fraction of reserveMax
   * @returns {boolean} true if anything was added
   */
  addAmmo(id, fraction) {
    const add = wid => {
      const def = WEAPONS[wid];
      const inv = this.inv[wid];
      if (!def || !inv || !inv.owned || !Number.isFinite(def.reserveMax)) return false;
      const before = inv.reserve;
      inv.reserve = Math.min(def.reserveMax, inv.reserve + Math.max(1, Math.ceil(def.reserveMax * fraction)));
      if (wid === this.currentId) this.reserve = inv.reserve;
      return inv.reserve > before;
    };
    if (id) return add(id);
    let any = false;
    for (const wid of WEAPON_ORDER) if (add(wid)) any = true;
    return any;
  }

  /** Count of the SELECTED grenade type (HUD / legacy readers). */
  get grenades() { return this.nades[this.grenadeType] | 0; }
  set grenades(v) { this.nades[this.grenadeType] = Math.max(0, v | 0); }
  /** Max carry of the selected type. */
  get maxGrenades() { return GRENADE_TYPES[this.grenadeType].maxCarry; }
  /** True while the cook ring should show (the thrown type burns a fuse in hand). */
  get cookRing() { return this.cooking && !!GRENADE_TYPES[this._throwType].cookable; }

  /**
   * Add grenades of a type (capped at that type's max carry). If the selected type is empty the new type is selected.
   * @param {number} n
   * @param {string} [type='frag'] 'frag' | 'vortex' | 'static' | 'kinetic' | 'smoke'
   * @returns {boolean} true if any were added
   */
  addGrenades(n, type = 'frag') {
    const changed = addToInventory(this.nades, type, n);
    if (changed && this.grenades <= 0 && this.gState === G_IDLE) this._setGrenadeType(type);
    return changed;
  }

  /** X: select the next grenade type you hold (skips empty ones). */
  cycleGrenadeType() {
    const next = nextHeldType(this.nades, this.grenadeType, 1);
    if (next !== this.grenadeType) {
      this._setGrenadeType(next);
      this.game.audio.play('weapon_switch', { volume: 0.45, rate: 1.25 });
    }
  }

  /** If the selected type is empty, move to the next type that has stock. */
  _autoSelectGrenade() {
    if (this.grenades > 0) return;
    const next = nextHeldType(this.nades, this.grenadeType, 1);
    if (next !== this.grenadeType) this._setGrenadeType(next);
  }

  _setGrenadeType(type) {
    if (type === this.grenadeType) return;
    this.grenadeType = type;
    this.game.events.emit('grenade:switch', { shooter: this.game.player, type });
  }

  /** 0..1 of the selected throw's fuse burned in hand (0 for grenades that cannot be cooked). */
  _cookFrac() {
    const GT = GRENADE_TYPES[this._throwType];
    return GT.cookable ? clamp(this.cookTime / GT.fuse, 0, 1) : 0;
  }

  /** Fuse handed to the thrown grenade: what is left when cookable, the full fuse otherwise. */
  _throwFuse(min) {
    const GT = GRENADE_TYPES[this._throwType];
    return GT.cookable ? Math.max(min, GT.fuse - this.cookTime) : GT.fuse;
  }

  /** Swap the model held in the throwing hand. */
  _setArmModel(type) {
    const ta = this.throwArm;
    if (!ta || ta.nade.userData.type === type) return;
    ta.nade.clear();
    const m = createGrenadeModel(type);
    m.traverse(o => { if (o.isMesh) o.frustumCulled = false; });
    ta.nade.add(m);
    ta.nade.userData.type = type;
  }

  // ===========================================================================================
  // per-frame logic
  // ===========================================================================================

  /** Gameplay update: input, firing, reloading, switching, grenades, melee, ADS. @param {number} dt */
  update(dt) {
    const game = this.game;
    const p = game.player;
    this._updateHitStop();
    if (game.state !== 'playing' || !p.alive) {
      this._idle(dt);
      return;
    }
    const now = game.time;
    const input = game.input;
    const def = this.current;
    const inv = this.inv[this.currentId];
    this.momentum = def.speedBonus ? momentumOf(def, p.speed) : 0;

    // ---- sprint interaction: a trigger pull or ADS - held, or a click made and released inside this frame's
    //      window - cancels the sprint (a semi-auto click then fires from the buffer once the sprint-out is done)
    if (p.isSprinting && (input.actionActive('fire') || input.actionActive('ads'))) p.cancelSprint();
    this.sprintBlend = approach(this.sprintBlend, p.isSprinting ? 1 : 0, dt * (p.isSprinting ? 7 : 10));

    // ---- switching
    this._updateSwitch(dt);

    if (this._escWant && this.gState === G_IDLE && this.meleeT < 0) {   // an Escalation promotion that had to wait
      const w = this._escWant;
      this._escWant = null;
      this._requestSwitch(w);
    }

    // ---- grenade, melee, weapon selection (number keys / Q / wheel), reload key - in this order, which is the
    //      same-frame priority rule: G / V go first and a weapon key of the same frame is then handled like a key
    //      pressed during that action (see _handleSwitchInput), so it never drops the G / V; R comes last and an R
    //      with a weapon key in the same frame reloads the NEW weapon once it is up. Nothing is dropped silently.
    this._updateGrenadeState(dt, now);
    this._updateMelee(dt, now);
    const switched = this._handleSwitchInput();
    this._handleReloadInput(now, switched);

    // ---- reload
    if (this.reloading) this._updateReload(dt, now);
    else this.reloadProgress = 0;
    if (!this.reloading && inv.ammo === 0 && inv.reserve > 0 && now >= this.nextFireAt + 0.08 && this._canAct() && this.sprintBlend < 0.5) {
      this._startReload(now);
    }

    // ---- completely dry weapon: fall back to the best weapon that still has ammo
    if (this._emptySwitchAt > 0 && now >= this._emptySwitchAt) {
      this._emptySwitchAt = 0;
      if (inv.ammo <= 0 && inv.reserve <= 0 && this._canAct()) {
        let alt = null;
        for (let i = this.owned.length - 1; i >= 0; i--) {
          const o = this.inv[this.owned[i]];
          if (this.owned[i] !== this.currentId && (o.ammo > 0 || o.reserve > 0)) { alt = this.owned[i]; break; }
        }
        if (alt) this._requestSwitch(alt);
      }
    }

    // ---- cycling (pump / bolt)
    this._updateCycle(dt, now);

    // ---- fire
    this._updateFire(now, inv, def, dt);
    this._updateBeam(now);

    // ---- aim down sights
    const adsWanted = input.actionActive('ads') && this._canAct() && !this.reloading && !p.isSprinting && !p.isShocked()
      && this.sprintBlend < 0.3 && now >= this._adsLockUntil;
    this.adsAmount = approach(this.adsAmount, adsWanted ? 1 : 0, dt / Math.max(0.04, adsWanted ? def.adsTime : def.adsTime * 0.65));
    this.scoped = !!def.scoped && this.adsAmount >= 0.9 && this._canAct();

    // ---- spread
    this._updateSpread(dt, def, p);

    // ---- player hooks
    const e = sm(this.adsAmount);
    this._fovKick.step(dt);
    p.fovMultiplier = lerp(1, def.adsZoom, e) * (def.charge ? 1 - def.charge.fovSqueeze * this.chargeAmount : 1) * (1 + this._fovKick.x);
    p.lookScale = lerp(1, def.adsSensitivity, e);

    this.cookProgress = this.cooking ? this._cookFrac() : 0;
    this.throwing = this.gState !== G_IDLE;
    this.meleeing = this.meleeT >= 0;
    this.switching = this.switchState !== S_NONE;
  }

  /** Update while the player is dead / the match is not running. */
  _idle(dt) {
    const p = this.game.player;
    this._stopBeam(false);
    this.adsAmount = approach(this.adsAmount, 0, dt * 6);
    this.scoped = false;
    this.momentum = 0;
    this.sprintBlend = approach(this.sprintBlend, 0, dt * 6);
    if (!p.alive) { p.lookScale = 1; p.fovMultiplier = 1; }
    this.bloom = Math.max(0, this.bloom - this.current.spread.recovery * dt);
  }

  _canAct() {
    return this.gState === G_IDLE && this.meleeT < 0
      && (this.switchState === S_NONE || (this.switchState === S_IN && this.equipAmount > 0.86));
  }

  // ---------------------------------------------------------------- switching

  /**
   * Weapon selection (number keys, Q, wheel). Priority rules, in one frame and across frames:
   *  - The NEWEST selection input of the frame wins (by DOM timestamp; keys for weapons you do not own are skipped),
   *    and the wheel applies all of its steps. Any manual selection cancels a queued pickup switch.
   *  - G / V are resolved before this (update order), so a weapon key in the same frame never drops them: the key
   *    is handled as if pressed during that action. R is resolved after this: see _handleReloadInput.
   *  - While a grenade is still in the hand (pull / cook / throw swing) or a melee has not hit yet, the key is
   *    remembered for KEY_MEMORY s of real time and applied the moment the grenade leaves the hand / the melee
   *    hits - or dropped if it has gone stale by then.
   *  - During the grenade follow-through / recovery and after the melee hit frame the switch starts immediately:
   *    the rest of that animation plays back (faster) under the switch-out, so it never holds up the new weapon.
   *  - A pickup's auto-switch queued behind a grenade (_queuedSwitch) only happens within QUEUED_SWITCH_TTL.
   * @returns {boolean} true when a switch the player asked for started this frame
   */
  _handleSwitchInput() {
    const input = this.game.input;
    const want = this._readSwitchInput();
    let started = false;
    if (want) {
      this._queuedSwitch = null;
      this._keyMem = null;
      if (this._switchBlocked()) {
        this._keyMem = want.id;
        this._keyMemT = want.t;
      } else {
        started = this._requestSwitch(want.id, true, want.t);
      }
    } else if (this._keyMem) {
      if (input.time - this._keyMemT > KEY_MEMORY) this._keyMem = null;
      else if (!this._switchBlocked()) {
        const id = this._keyMem;
        this._keyMem = null;
        started = this._requestSwitch(id, true, this._keyMemT);
      }
    }
    if (this._queuedSwitch && this.gState === G_IDLE && this.meleeT < 0) {
      const q = this._queuedSwitch;
      this._queuedSwitch = null;
      if (input.time - this._queuedAt <= QUEUED_SWITCH_TTL) this._requestSwitch(q);
    }
    return started;
  }

  /** Newest weapon-selection input of this frame as `{id, t}` (reused object; t = press time, s), or null. */
  _readSwitchInput() {
    const input = this.game.input;
    let id = null, t = -Infinity;
    for (let i = 0; i < SWITCH_KEYS.length; i++) {
      const key = SWITCH_KEYS[i];
      if (!input.actionPressed(key)) continue;
      const pt = input.pressTime(key);
      if (pt <= t) continue;
      const wid = key === 'lastWeapon' ? this._lastWeaponTarget() : KEY_WEAPON[key];
      if (!wid || !this.inv[wid] || !this.inv[wid].owned) continue;
      id = wid;
      t = pt;
    }
    if (input.wheel !== 0 && input.wheelTime >= t) {
      const wid = this._cycleOwned(input.wheel);
      if (wid) { id = wid; t = input.wheelTime; }
    }
    if (!id) return null;
    this._want.id = id;
    this._want.t = t;
    return this._want;
  }

  /** Q: the previous weapon, or any other owned one. */
  _lastWeaponTarget() {
    const last = this.inv[this.lastId];
    if (last && last.owned && this.lastId !== this.currentId) return this.lastId;
    for (let i = 0; i < this.owned.length; i++) if (this.owned[i] !== this.currentId) return this.owned[i];
    return null;
  }

  /** True while a grenade is still in the hand or a melee swing has not hit yet (weapon keys are remembered). */
  _switchBlocked() {
    return (this.gState !== G_IDLE && this.cooking) || (this.meleeT >= 0 && !this._meleeHit);
  }

  /** Seconds (at rate 1) until the grenade sequence is back to idle, from the throw swing or the recovery. */
  _grenadeLeft() {
    if (this.gState === G_THROW) return Math.max(0, THROW_RELEASE + RECOVER_TIME * 0.55 - this.gT) + RECOVER_TIME;
    if (this.gState === G_RECOVER) return Math.max(0, RECOVER_TIME - this.gT);
    return 0;
  }

  /** Forget every input latch / remembered key (match start, spawn): nothing pressed in a previous life carries over. */
  _resetInputLatches() {
    this._queuedSwitch = null;
    this._keyMem = null;
    this._reloadLatchUntil = 0;
    this._gLatchUntil = 0;
    this._vLatchUntil = 0;
    this._fireBufferUntil = 0;
    this._meleeRate = 1;
    this._gRate = 1;
  }

  /** The owned weapon `steps` places after (+) / before (-) the current (or incoming) one; wraps around. */
  _cycleOwned(steps) {
    const from = this.switchState === S_OUT && this.pendingId ? this.pendingId : this.currentId;
    const list = this.owned;
    const n = list.length;
    if (n < 2) return null;
    const i = Math.max(0, list.indexOf(from));
    return list[(((i + steps) % n) + n) % n];
  }

  /**
   * R: start the reload now, or - while the weapon is busy (switch / equip / grenade / melee) - latch it for
   * ACTION_LATCH s of real time and start it the moment the weapon can act (an R in the last moments of an equip).
   * An R in the same frame as a weapon key that started a switch reloads the NEW weapon once it is up.
   * Any other weapon action (fire click, switch, grenade, melee) cancels the latch.
   * @param {number} now game time
   * @param {boolean} switched a switch the player asked for started this frame
   */
  _handleReloadInput(now, switched) {
    const input = this.game.input;
    if (input.actionPressed('reload')) {
      this._reloadLatchUntil = 0;
      if (this.charging) return;
      if (switched) this._reloadLatchUntil = input.time + SWITCH_OUT_TIME + WEAPONS[this.pendingId].equipTime + ACTION_LATCH;
      else if (this._canAct()) this._startReload(now);
      else this._reloadLatchUntil = input.pressTime('reload') + ACTION_LATCH;
    } else if (this._reloadLatchUntil > 0 && this._canAct()) {
      const ok = input.time <= this._reloadLatchUntil && !this.charging;
      this._reloadLatchUntil = 0;
      if (ok) this._startReload(now);
    }
  }

  /**
   * Switch to `id`. Programmatic requests (pickup auto-switch, empty weapon, modes) are queued while a grenade is
   * out (see _handleSwitchInput) and refused during a melee; `manual` requests (the player's keys) are also allowed
   * during the grenade follow-through / recovery and after the melee hit frame: the rest of that animation then
   * plays back during the switch-out (it never holds up the incoming weapon, which never comes up in a bash pose).
   * @param {string} id
   * @param {boolean} [manual=false]
   * @param {number} [t] input-clock time (s) of the key press behind a manual request
   * @returns {boolean} true when the switch started
   */
  _requestSwitch(id, manual = false, t = 0) {
    const inv = this.inv[id];
    if (!inv || !inv.owned) return false;
    const target = this.switchState === S_OUT ? this.pendingId : this.currentId;
    if (id === target) return false;
    const input = this.game.input;
    if (this.gState !== G_IDLE && !(manual && !this.cooking)) {
      if (!manual) {
        this._queuedSwitch = id;
        this._queuedAt = input.time;
      }
      return false;
    }
    if (this.meleeT >= 0 && !(manual && this._meleeHit)) return false;
    const out = SWITCH_OUT_TIME * Math.max(0.25, this.equipAmount);     // what is left of the switch-out
    if (this.gState !== G_IDLE) this._gRate = Math.max(1, this._grenadeLeft() / out);
    if (this.meleeT >= 0) this._meleeRate = Math.max(1, (MELEE_TIME - this.meleeT) / out);
    this._cancelReload();
    cancelCharge(this);
    this._fireBufferUntil = 0;
    this._reloadLatchUntil = 0;
    this._switchReqAt = manual ? t : input.now();
    this.pendingId = id;
    if (this.switchState !== S_OUT) {
      this.switchState = S_OUT;
      // a weapon still raising drops from where it is (equipAmount continues downward)
    }
    this.switching = true;
    return true;
  }

  _updateSwitch(dt) {
    if (this.switchState === S_OUT) {
      this.equipAmount -= dt / SWITCH_OUT_TIME;
      if (this.equipAmount <= 0) {
        this.equipAmount = 0;
        this._applyWeapon(this.pendingId || this.currentId);
        this.switchState = S_IN;
      }
    } else if (this.switchState === S_IN) {
      this.equipAmount += dt / Math.max(0.08, this.current.equipTime);
      if (this.equipAmount >= 1) {
        this.equipAmount = 1;
        this.switchState = S_NONE;
        this.switching = false;
      }
    }
  }

  _applyWeapon(id) {
    const game = this.game;
    const old = this.currentId;
    if (old !== id) this.lastId = old;
    this.currentId = id;
    this.current = WEAPONS[id];
    const inv = this.inv[id];
    this.ammo = inv.ammo;
    this.reserve = inv.reserve;
    this._cancelReload();
    this.cycleT = -1;
    this.bloom = 0;
    this.adsAmount = Math.min(this.adsAmount, 0.3);
    this._slideLock = inv.ammo === 0;
    this.pendingId = null;
    cancelCharge(this);
    this._selectVisual(id);
    game.audio.play('weapon_switch', { volume: 0.9 });
    game.events.emit('weapon:switch', { shooter: game.player, weapon: id });
  }

  // ---------------------------------------------------------------- firing

  /**
   * Trigger logic. Automatic weapons fire while held AND for a click that went down and up inside one frame (at
   * least one shot). A click is buffered for FIRE_BUFFER s of real time counted from the click itself, but only
   * across the fire-rate cooldown and the sprint-out; a reload, switch / equip, grenade, melee or shock drops it,
   * so a click never fires once one of those has ended.
   */
  _updateFire(now, inv, def, dt = 0) {
    if (def.charge) { updateCharge(this, dt, now, inv, def); return; }
    const game = this.game;
    const input = game.input;
    const p = game.player;
    const press = input.actionPressed('fire');
    const held = input.action('fire');
    if (press) {
      this._fireBufferUntil = input.pressTime('fire') + FIRE_BUFFER;
      this._reloadLatchUntil = 0;
    }
    const want = press || (def.auto && held) || input.time < this._fireBufferUntil;
    if (!want) return;
    if (p.isShocked() || !this._canAct()) { this._fireBufferUntil = 0; return; }
    if (this.reloading) {
      if (def.reloadMode === 'shell' && inv.ammo > 0) this._cancelReload();
      else { this._fireBufferUntil = 0; return; }
    }
    if (now < this.nextFireAt) return;
    if (p.isSprinting || this.sprintBlend > 0.3) return;
    if (inv.ammo <= 0) {
      if (press && now >= this._dryClickAt) {
        this._dryClickAt = now + 0.28;
        game.audio.play('dry_fire');
        this._sp.kz.kick(0.006);
        this._trigger = 1;
      }
      if (inv.reserve > 0 && press) this._startReload(now);
      else if (inv.reserve <= 0 && press) this._emptySwitchAt = now + 0.3;
      this._fireBufferUntil = 0;
      return;
    }
    this._fire(def, inv, now);
    this._fireBufferUntil = 0;
  }

  _fire(def, inv, now, opts = null) {
    const game = this.game;
    const p = game.player;
    const cam = game.camera;
    inv.ammo--;
    this.ammo = inv.ammo;
    const prevFireAt = this.nextFireAt;
    this.nextFireAt = now + 1 / (def.fireRate * rateScale(def, this.momentum));
    this.lastFireTime = now;
    if (now - this._lastShotAt > 0.45) this._recoilBias = Math.random() < 0.5 ? -1 : 1;
    this._lastShotAt = now;

    // aim from the camera (what the crosshair shows)
    _eye.copy(cam.position);
    _fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const spread = this.spreadAngle;
    this._muzzleWorld(_muzzleW);

    if (def.kind === 'beam') { this._fireBeam(def, inv, now, spread, prevFireAt); return; }
    if (def.kind === 'blast') { this._fireBlast(def, inv, now); return; }
    if (def.kind === 'projectile') {
      this._fireRocket(def, spread);
    } else if (def.charge) {
      this._fireRail(def, opts && opts.power != null ? opts.power : 1, spread);
    } else {
      for (let i = 0; i < def.pellets; i++) {
        const dir = randomInCone(_fwd, spread, new THREE.Vector3());
        game.combat.fireBullet({
          shooter: p, origin: _eye, direction: dir, damage: def.damage * damageScale(def, this.momentum), weapon: def.id, range: def.range,
          headshotMult: def.headshotMult, falloff: def.falloff,
          tracerFrom: (def.pellets === 1 || i % 3 === 0) ? _muzzleW : null, tracerColor: tracerFor(def, this.momentum),
        });
      }
    }

    // world lighting flash + sound + event
    const fl = def.flash;
    const fs = clamp(fl.size / 0.25, 0.6, 1.8);
    game.effects.flashLight(_muzzleW.clone(), fl.color, WORLD_FLASH_LIGHT * fs, 9 * fs, 0.06);
    game.audio.play(def.sound, { rate: soundRate(def, this.momentum) + randRange(-0.03, 0.03) });
    game.events.emit('weapon:fire', { shooter: p, weapon: def.id, origin: _eye.clone(), direction: _fwd.clone() });

    // recoil on the aim
    const rc = def.recoil;
    const adsK = lerp(1, rc.adsScale, sm(this.adsAmount));
    const crouchK = p.isCrouching ? 0.85 : 1;
    p.addRecoil(rc.pitch * adsK * crouchK * randRange(0.85, 1.15),
      rc.yaw * adsK * (this._recoilBias * 0.5 + randRange(-1, 1) * 0.65));

    // bloom
    this.bloom = Math.min(def.spread.max, this.bloom + def.spread.perShot);

    if (def.view && def.view.shake) p.addShake(def.view.shake * lerp(1, 0.5, sm(this.adsAmount)));
    this._viewKick(def, adsK);

    // cycling weapons (pump / bolt)
    if (def.cycleTime && inv.ammo > 0) {
      this.cycleT = 0;
      this._cycleSound = false;
      this._cycleEject = false;
      if (def.scoped) this._adsLockUntil = now + def.cycleDelay + def.cycleTime * 0.8;
    } else if (def.scoped) {
      this._adsLockUntil = now + 0.4;
    }
    if (inv.ammo === 0) this._slideLock = true;
  }

  /** Javelin shot: piercing beam along the (charge-tightened) aim ray, kick + FOV punch. */
  _fireRail(def, power, spread) {
    const game = this.game;
    _dir.copy(_fwd);
    if (spread > 0) randomInCone(_fwd, spread, _dir);
    fireRail(game, game.player, { origin: _eye, dir: _dir, muzzle: _muzzleW, def, power });
    this._fovKick.kick(0.06);
    this._fovKick.v += 0.5;
  }

  /** Empty-magazine trigger pull (click, auto-reload / fall back to another weapon). */
  _dryFire(now, inv, press) {
    if (press && now >= this._dryClickAt) {
      this._dryClickAt = now + 0.28;
      this.game.audio.play('dry_fire');
      this._sp.kz.kick(0.006);
      this._trigger = 1;
    }
    if (inv.reserve > 0 && press) this._startReload(now);
    else if (inv.reserve <= 0 && press) this._emptySwitchAt = now + 0.3;
    this._fireBufferUntil = 0;
  }

  /**
   * Tempest: one beam tick (called at def.fireRate while the trigger is held). Damage, chaining and the beam visual
   * live in special/arc.js; this handles the loop sound, ammo cadence, recoil and viewmodel kick.
   */
  _fireBeam(def, inv, now, spread, prevFireAt) {
    const game = this.game;
    const p = game.player;
    // keep the tick rate exact at any frame rate: a late frame applies up to 3 owed ticks at once (damage x n, ammo - n)
    const cad = beamCadence(now, prevFireAt, this._beamLast, 1 / def.fireRate);
    this.nextFireAt = cad.next;
    const ticks = cad.n;
    if (ticks > 1) { inv.ammo = Math.max(0, inv.ammo - (ticks - 1)); this.ammo = inv.ammo; }
    randomInCone(_fwd, spread, _dir);
    const res = fireArc(game, p, { origin: _eye, dir: _dir, muzzle: _muzzleW, def, dmgScale: ticks });
    this._beamDist = res.dist;
    this._beamChained = res.chained;
    this._beamLast = now;
    if (!this._beamOn) {
      this._beamOn = true;
      game.audio.play(def.sound);
      this._beamLoop = game.audio.playLoop(def.loop, { volume: 0.8 });
    }
    if (this._beamLoop) this._beamLoop.setRate(1 + 0.15 * res.chained);
    if (now - this._beamEventAt >= def.beam.eventInterval) {
      this._beamEventAt = now;
      game.events.emit('weapon:fire', { shooter: p, weapon: def.id, origin: _eye.clone(), direction: _fwd.clone() });
    }
    if (now - this._beamLightAt >= 0.08) {
      this._beamLightAt = now;
      game.effects.flashLight(_muzzleW, def.flash.color, 14, 7, 0.06);
    }
    const rc = def.recoil;
    const adsK = lerp(1, rc.adsScale, sm(this.adsAmount));
    p.addRecoil(rc.pitch * adsK * randRange(0.85, 1.15), rc.yaw * adsK * randRange(-1, 1));
    if (def.view && def.view.shake) p.addShake(Math.min(0.14, def.view.shake) * lerp(1, 0.5, sm(this.adsAmount)));
    this._viewKick(def, adsK);
    if (inv.ammo === 0) this._stopBeam(true);
  }

  /** Gale: one blast (cone shove + reflect + self push, see special/gale.js). */
  _fireBlast(def, inv, now) {
    const game = this.game;
    const p = game.player;
    const b = def.blast;
    const ads = this.adsAmount >= 0.6;
    game.combat.blast(p, _eye, _fwd, b, ads);
    game.effects.galeBlast(_muzzleW, _fwd, { range: ads ? b.adsRange : b.range, halfAngle: ads ? b.adsHalfAngle : b.halfAngle });
    game.audio.play(def.sound, { rate: 1 + randRange(-0.03, 0.03) });
    game.events.emit('weapon:fire', { shooter: p, weapon: def.id, origin: _eye.clone(), direction: _fwd.clone() });
    const rc = def.recoil;
    const adsK = lerp(1, rc.adsScale, sm(this.adsAmount));
    p.addRecoil(rc.pitch * adsK * randRange(0.85, 1.15), rc.yaw * adsK * (this._recoilBias * 0.5 + randRange(-1, 1) * 0.65));
    if (def.view && def.view.shake) p.addShake(def.view.shake * lerp(1, 0.6, sm(this.adsAmount)));
    this._viewKick(def, adsK);
    if (inv.ammo === 0) this._slideLock = true;
  }

  /** Stop the Tempest loop (`fizz` plays the closing sound). */
  _stopBeam(fizz = true) {
    if (!this._beamOn) return;
    this._beamOn = false;
    if (this._beamLoop) { this._beamLoop.stop(); this._beamLoop = null; }
    if (fizz) this.game.audio.play('arc_end');
  }

  /** Per-frame beam upkeep: keeps the beam glued to the muzzle between ticks and ends it when firing stops. */
  _updateBeam(now) {
    if (!this._beamOn) return;
    const game = this.game;
    const def = WEAPONS.arc;
    if (this.currentId !== 'arc' || now - this._beamLast > 0.09 || !game.player.alive) { this._stopBeam(true); return; }
    if (now - this._beamLast > 0.001) {
      this._muzzleWorld(_muzzleW);
      _fwd.set(0, 0, -1).applyQuaternion(game.camera.quaternion);
      _v1.copy(game.camera.position).addScaledVector(_fwd, this._beamDist);
      updateBeamVisual(game, game.player, _muzzleW, _v1, def);
    }
  }

  _fireRocket(def, spread) {
    const game = this.game;
    const p = game.player;
    // target point under the crosshair
    _dir.copy(_fwd);
    if (spread > 0) randomInCone(_fwd, spread, _dir);
    const hit = game.combat.raycast(_eye, _dir, def.range, p);
    const dist = hit ? hit.distance : def.range;
    _v1.copy(_eye).addScaledVector(_dir, dist);           // target
    // spawn at the muzzle (screen-aligned), unless a wall is in the way
    _v2.copy(_muzzleW);
    _v3.subVectors(_v2, _eye);
    const len = _v3.length();
    if (len > 1e-3) {
      _v3.multiplyScalar(1 / len);
      // something (wall or enemy) between the eye and the muzzle: launch from just in front of the eye instead
      if (game.combat.raycast(_eye, _v3, len + 0.1, p)) _v2.copy(_eye).addScaledVector(_fwd, 0.2);
    }
    _v3.subVectors(_v1, _v2);
    if (_v3.lengthSq() < 1.2 * 1.2) _v3.copy(_dir); else _v3.normalize();
    game.projectiles.spawnRocket({ owner: p, origin: _v2, direction: _v3 });
  }

  /** Viewmodel kick, muzzle flash, casing eject and part recoil for one shot. */
  _viewKick(def, adsK) {
    const s = this._sp;
    const k = (def.view ? def.view.kick : 1) * lerp(1, 0.6, sm(this.adsAmount));
    s.kz.kick(0.03 * k);
    s.ky.kick(0.006 * k);
    s.krx.kick(0.038 * k);
    s.krz.kick(randRange(-1, 1) * 0.022 * k);
    s.kry.kick(randRange(-1, 1) * 0.012 * k);
    s.kz.x = Math.min(s.kz.x, 0.1);
    s.krx.x = Math.min(s.krx.x, 0.2);
    this._slideRecoil.kick(1);
    this._trigger = 1;
    this._fireAmt = 1;
    // muzzle flash
    const fl = def.flash;
    this.flashT = fl.time;
    this._flashDur = fl.time;
    const ads = 1 - 0.45 * sm(this.adsAmount);
    const size = fl.size * randRange(0.85, 1.2) * ads;
    this._flashStar.scale.set(size * 1.25, size * 1.25, 1);
    this._flashStarMat.rotation = Math.random() * 6.28;
    this._flashStarMat.color.set(fl.color).multiplyScalar(VIEW_FLASH_STAR);
    this._flashJetMat.color.set(fl.color).multiplyScalar(VIEW_FLASH_JET);
    for (const j of this._flashJets) j.scale.set(size * 0.7, 1, size * 2.2);
    this.flash.visible = true;
    this.flashLight.color.set(fl.color);
    this.flashLight.intensity = fl.light * VIEW_FLASH_LIGHT;
    // brass (shells for the shotgun are ejected during the pump)
    if (def.view && def.view.eject === 'brass') this._ejectCasing(false);
  }

  _ejectCasing(shell) {
    const vm = this.vm[this.currentId];
    if (!vm) return;
    const c = this.casings[this._casingIdx];
    this._casingIdx = (this._casingIdx + 1) % this.casings.length;
    const port = vm.model.ejectPort || vm.model.sight;
    if (port) {
      vm.root.updateWorldMatrix(true, true);
      port.getWorldPosition(_v1);
      this.viewRoot.worldToLocal(_v1);
      c.mesh.position.copy(_v1);
    } else {
      c.mesh.position.set(0.12, -0.12, -0.35);
    }
    c.mesh.geometry = shell ? this._shellGeo : this._brassGeo;
    c.mesh.material = shell ? this._shellMat : this._brassMat;
    c.vel.set(randRange(1.3, 2.1), randRange(1.0, 1.9), randRange(0.1, 0.9));
    c.spin.set(randRange(-18, 18), randRange(-18, 18), randRange(-18, 18));
    c.life = c.max = randRange(0.5, 0.75);
    c.mesh.visible = true;
    c.mesh.scale.setScalar(1);
  }

  /** World position of the visual muzzle, screen-aligned with the viewmodel (used for tracers/rockets). */
  _muzzleWorld(out) {
    const game = this.game;
    const cam = game.camera;
    const vm = this.vm[this.currentId];
    const muzzle = vm && vm.model.muzzle;
    if (muzzle) {
      muzzle.updateWorldMatrix(true, false);
      _v1.setFromMatrixPosition(muzzle.matrixWorld);
      game.viewCamera.worldToLocal(_v1);
      if (_v1.z < -0.02) {
        const ve = game.viewCamera.projectionMatrix.elements;
        const ce = cam.projectionMatrix.elements;
        const nx = (_v1.x / -_v1.z) * ve[0];
        const ny = (_v1.y / -_v1.z) * ve[5];
        const d = 0.85;
        out.set((nx / ce[0]) * d, (ny / ce[5]) * d, -d).applyQuaternion(cam.quaternion).add(cam.position);
        return out;
      }
    }
    _v2.set(0, 0, -1).applyQuaternion(cam.quaternion);
    return out.copy(cam.position).addScaledVector(_v2, 0.7);
  }

  // ---------------------------------------------------------------- cycle (pump / bolt)

  _updateCycle(dt, now) {
    if (this.cycleT < 0) return;
    const def = this.current;
    this.cycleT += dt;
    const c = (this.cycleT - def.cycleDelay) / def.cycleTime;
    if (c >= 0.3 && !this._cycleSound) {
      this._cycleSound = true;
      this.game.audio.play(this.currentId === 'sniper' ? 'bolt' : 'pump');
    }
    if (c >= 0.45 && !this._cycleEject) {
      this._cycleEject = true;
      if (def.view && def.view.eject === 'shell') this._ejectCasing(true);
    }
    if (c >= 1) this.cycleT = -1;
  }

  // ---------------------------------------------------------------- reload

  _startReload(now) {
    const def = this.current;
    const inv = this.inv[this.currentId];
    if (this.reloading || inv.ammo >= def.magSize || inv.reserve <= 0 || !this._canAct()) return false;
    this.reloading = true;
    this._fireBufferUntil = 0;   // a click from before the reload never fires when it ends
    this.reloadT = 0;
    this.reloadWasEmpty = inv.ammo === 0;
    this._reloadCommitted = false;
    this._reloadEndSound = false;
    this.cycleT = -1;
    if (def.reloadMode === 'shell') {
      this._shellsLoaded = 0;
      this._shellsNeeded = Math.min(def.magSize - inv.ammo, inv.reserve);
      this.reloadTotal = def.reloadStart + this._shellsNeeded * def.shellTime + def.reloadEnd;
    } else {
      this.reloadTotal = def.reloadTime + (this.reloadWasEmpty ? (def.reloadEmptyExtra || 0) : 0);
    }
    this.game.audio.play('reload_start');
    return true;
  }

  _cancelReload() {
    this.reloading = false;
    this.reloadProgress = 0;
    this._stopBeam(false);
  }

  _updateReload(dt) {
    const def = this.current;
    const inv = this.inv[this.currentId];
    this.reloadT += dt;
    const T = this.reloadT;
    if (def.reloadMode === 'shell') {
      const q = (T - def.reloadStart) / def.shellTime;
      while (this._shellsLoaded < this._shellsNeeded && q >= this._shellsLoaded + 0.75) {
        this._shellsLoaded++;
        inv.ammo++;
        if (Number.isFinite(inv.reserve)) inv.reserve--;
        this.ammo = inv.ammo;
        this.reserve = inv.reserve;
        this.game.audio.play('reload_insert', { rate: randRange(0.95, 1.06) });
        this._sp.kz.kick(0.006);
        this._sp.krx.kick(0.012);
      }
      if (this.reloadWasEmpty && !this._reloadEndSound && this._shellsLoaded >= this._shellsNeeded
        && T >= this.reloadTotal - def.reloadEnd * 0.75) {
        this._reloadEndSound = true;
        this.game.audio.play('pump');
      }
      if (T >= this.reloadTotal || (this._shellsLoaded >= this._shellsNeeded && T >= def.reloadStart + this._shellsNeeded * def.shellTime + def.reloadEnd)) {
        this.reloading = false;
        this.reloadProgress = 0;
        return;
      }
    } else {
      const p = T / this.reloadTotal;
      if (!this._reloadCommitted && p >= 0.62) {
        this._reloadCommitted = true;
        const need = def.magSize - inv.ammo;
        const take = Number.isFinite(inv.reserve) ? Math.min(need, inv.reserve) : need;
        inv.ammo += take;
        if (Number.isFinite(inv.reserve)) inv.reserve -= take;
        this.ammo = inv.ammo;
        this.reserve = inv.reserve;
        this.game.audio.play('reload_insert');
        this._sp.kz.kick(0.014);
        this._sp.krx.kick(0.05);
        this._sp.ky.kick(-0.004);
      }
      const endP = this.reloadWasEmpty ? 0.86 : 0.8;
      if (!this._reloadEndSound && p >= endP) {
        this._reloadEndSound = true;
        this.game.audio.play('reload_end');
        if (this.reloadWasEmpty) this._slideLock = false;
        this._sp.kz.kick(0.008);
      }
      if (T >= this.reloadTotal) {
        this.reloading = false;
        this.reloadProgress = 0;
        return;
      }
    }
    this.reloadProgress = clamp(T / this.reloadTotal, 0, 1);
  }

  // ---------------------------------------------------------------- spread

  _updateSpread(dt, def, p) {
    const s = def.spread;
    this.bloom = Math.max(0, this.bloom - s.recovery * dt);
    const speedK = Math.min(1, p.speed / 6.2);
    let base = lerp(s.hip, s.moving, speedK);
    if (p.isCrouching && !p.isSliding) base *= 0.8;
    const adsBase = s.ads + speedK * Math.max(0, s.moving - s.hip) * 0.3;
    base = lerp(base, adsBase, sm(this.adsAmount));
    if (!p.onGround && !p.isWallRunning) base = Math.max(base, lerp(s.air, s.air * 0.75, sm(this.adsAmount)));
    this.spreadAngle = Math.min(s.max, base + this.bloom);
    if (def.speedBonus) this.spreadAngle *= spreadScale(def, this.momentum);
    if (def.charge) this.spreadAngle *= 1 - 0.6 * this.chargeAmount;
  }

  // ---------------------------------------------------------------- grenades

  _updateGrenadeState(dt, now) {
    const game = this.game;
    const input = game.input;
    const held = input.action('grenade');
    const GT = GRENADE_TYPES[this._throwType];
    const cookMax = GT.cookable ? GT.fuse : Infinity;
    switch (this.gState) {
      case G_IDLE: {
        if (input.actionPressed('grenadeNext') && this.meleeT < 0) this.cycleGrenadeType();
        const press = input.actionPressed('grenade');
        if (press && this.grenades <= 0) this._autoSelectGrenade();
        // a G during a switch-out (the weapon still going down) waits for it: ACTION_LATCH s of real time
        if (press) this._gLatchUntil = this.switchState === S_OUT ? input.pressTime('grenade') + ACTION_LATCH : 0;
        const latched = this._gLatchUntil > 0 && input.time <= this._gLatchUntil;
        if ((press || latched) && this.grenades > 0 && this.meleeT < 0 && !this.charging
          && this.switchState !== S_OUT && !game.player.isShocked()) {
          this._pullPin();
        }
        break;
      }
      case G_PULL:
      case G_HOLD:
        this.gT += dt;
        this.cookTime += dt;
        if (!this._pinSound && this.gT >= 0.14) {
          this._pinSound = true;
          game.audio.play(GT.pinSound || 'grenade_pin');
        }
        if (this.gState === G_PULL && this.gT >= PULL_TIME) this.gState = G_HOLD;
        if (this.cookTime >= cookMax) { this._grenadeCookOff(); break; }
        if (this.gState === G_HOLD && !held) { this.gState = G_THROW; this.gT = 0; }
        break;
      case G_THROW:
        this.gT += dt * this._gRate;   // _gRate > 1 only after the release, when a weapon key interrupted the follow-through
        this.cookTime += dt;
        if (this.cookTime >= cookMax && this.cooking) { this._grenadeCookOff(); break; }
        if (this.cooking && this.gT >= THROW_RELEASE) this._throwGrenade();
        if (this.gT >= THROW_RELEASE + RECOVER_TIME * 0.55) { this.gState = G_RECOVER; this.gT = 0; }
        break;
      case G_RECOVER:
        this.gT += dt * this._gRate;
        if (this.gT >= RECOVER_TIME) { this.gState = G_IDLE; this.gT = 0; }
        break;
      default:
        break;
    }
    this._grenadeLower = approach(this._grenadeLower, this.gState === G_IDLE ? 0 : (this.gState === G_RECOVER ? 0.35 * (1 - this.gT / RECOVER_TIME) : 1),
      dt * (this.gState === G_IDLE || this.gState === G_RECOVER ? 3.2 : 6.5));
  }

  _pullPin() {
    this._cancelReload();
    this._fireBufferUntil = 0;
    this._reloadLatchUntil = 0;
    this._gLatchUntil = 0;
    this._gRate = 1;
    this.cycleT = -1;
    this._throwType = this.grenadeType;
    this._setArmModel(this._throwType);
    this.grenades--;
    this.cooking = true;
    this.cookTime = 0;
    this.gState = G_PULL;
    this.gT = 0;
    this._pinSound = false;
  }

  /** Launch parameters shared by the throw and the preview (camera space based). */
  _grenadeLaunch(outOrigin, outVel) {
    const game = this.game;
    const cam = game.camera;
    const p = game.player;
    _fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
    _right.set(1, 0, 0).applyQuaternion(cam.quaternion);
    _upv.set(0, 1, 0).applyQuaternion(cam.quaternion);
    _eye.copy(cam.position);
    outOrigin.copy(_eye).addScaledVector(_fwd, 0.5).addScaledVector(_right, -0.12).addScaledVector(_upv, -0.1);
    _v3.subVectors(outOrigin, _eye);
    const len = _v3.length();
    _v3.multiplyScalar(1 / len);
    const hit = game.world.raycast(_eye, _v3, len + GRENADE_RADIUS_SAFE);
    if (hit) outOrigin.copy(_eye).addScaledVector(_v3, Math.max(0.05, hit.distance - 0.12));
    outVel.copy(_fwd).multiplyScalar(GRENADE_TYPES[this._throwType].throwSpeed);
    outVel.y += 3;
    outVel.addScaledVector(p.velocity, 0.4);
  }

  _throwGrenade() {
    const game = this.game;
    this.cooking = false;
    this._grenadeLaunch(_v1, _v2);
    game.projectiles.spawnGrenade({ owner: game.player, origin: _v1, velocity: _v2, fuse: this._throwFuse(0.1), type: this._throwType });
    game.audio.play('grenade_throw');
    this._sp.kz.kick(-0.01);
    this.cookTime = 0;
  }

  _grenadeCookOff() {
    const game = this.game;
    const cam = game.camera;
    _fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
    _v1.copy(cam.position).addScaledVector(_fwd, 0.3);
    _v1.y -= 0.25;
    this.cooking = false;
    this.cookTime = 0;
    this.gState = G_RECOVER;
    this.gT = 0;
    game.projectiles.detonate(this._throwType, _v1, _Y, game.player);
  }

  _onDeath(e) {
    const game = this.game;
    if (e.weapon === 'rail' && e.attacker === game.player && e.victim !== game.player) this._hitStop(0.3, 0.12);
    if (e.weapon === 'ringout' && e.attacker === game.player) game.audio.play('ringout');
    if (e.victim !== game.player) return;
    cancelCharge(this);
    if (this.cooking) {
      // drop the live grenade at the player's feet
      const p = game.player;
      _v1.copy(game.camera.position);
      _v2.copy(p.velocity).multiplyScalar(0.5);
      _v2.y += 1.5;
      game.projectiles.spawnGrenade({ owner: p, origin: _v1, velocity: _v2, fuse: this._throwFuse(0.15), type: this._throwType });
      this.cooking = false;
    }
    this.gState = G_IDLE;
    this.cookTime = 0;
    this.reloading = false;
    this._stopBeam(false);
    this.meleeT = -1;
    this.previewDots.visible = false;
    this.previewRing.visible = false;
    this.previewArea.visible = false;
    this._previewShown = false;
    if (this.throwArm) this.throwArm.group.visible = false;
  }

  /** Brief slow-motion on a Javelin kill (game.timeScale; never fights the match-end outro). */
  _hitStop(scale, seconds) {
    const g = this.game;
    if (typeof g.hitStop === 'function') { g.hitStop(scale, seconds); return; }     // the mode package's own hit-stop, when present
    if (g.state !== 'playing' || (g.match && g.match.over) || g.timeScale !== 1) return;
    g.timeScale = scale;
    this._hitStopScale = scale;
    this._hitStopUntil = g.realTime + seconds;
  }

  _updateHitStop(force = false) {
    if (this._hitStopUntil <= 0) return;
    const g = this.game;
    if (force || g.realTime >= this._hitStopUntil || g.state !== 'playing') {
      this._hitStopUntil = 0;
      if (g.timeScale === this._hitStopScale) g.timeScale = 1;
    }
  }

  // ---------------------------------------------------------------- melee

  _updateMelee(dt, now) {
    const game = this.game;
    const input = game.input;
    if (this.meleeT < 0) {
      const press = input.actionPressed('melee');
      // a V during a switch-out (the weapon still going down) or in the last moments of the melee cooldown waits
      // for it: ACTION_LATCH s of real time (an earlier one is dropped, it never swings much later)
      if (press) {
        this._vLatchUntil = this.switchState === S_OUT || now < this.nextMeleeAt
          ? input.pressTime('melee') + ACTION_LATCH : 0;
      }
      const latched = this._vLatchUntil > 0 && input.time <= this._vLatchUntil;
      if ((press || latched) && now >= this.nextMeleeAt && this.gState === G_IDLE && !this.charging
        && this.switchState !== S_OUT) {
        this.meleeT = 0;
        this._meleeRate = 1;
        this._meleeHit = false;
        this.nextMeleeAt = now + MELEE.cooldown;
        this._cancelReload();
        this._fireBufferUntil = 0;
        this._reloadLatchUntil = 0;
        this._vLatchUntil = 0;
        this.cycleT = -1;
        if (game.player.isSprinting) game.player.cancelSprint();
        game.audio.play('melee_swing');
      }
      return;
    }
    this.meleeT += dt * this._meleeRate;
    if (!this._meleeHit && this.meleeT >= MELEE_HIT_AT) {
      this._meleeHit = true;
      this._meleeStrike();
    }
    if (this.meleeT >= MELEE_TIME) this.meleeT = -1;
  }

  _meleeStrike() {
    const game = this.game;
    const p = game.player;
    const cam = game.camera;
    _eye.copy(cam.position);
    _fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
    _right.set(1, 0, 0).applyQuaternion(cam.quaternion);
    _upv.set(0, 1, 0).applyQuaternion(cam.quaternion);
    let best = null;
    let bestWorld = null;
    for (let i = 0; i < 5; i++) {
      _dir.copy(_fwd);
      if (i === 1) _dir.addScaledVector(_right, 0.08);
      else if (i === 2) _dir.addScaledVector(_right, -0.08);
      else if (i === 3) _dir.addScaledVector(_upv, 0.08);
      else if (i === 4) _dir.addScaledVector(_upv, -0.08);
      _dir.normalize();
      const hit = game.combat.raycast(_eye, _dir, MELEE.range, p);
      if (!hit) continue;
      if (hit.entity) { if (!best || hit.distance < best.distance) best = hit; }
      else if (!bestWorld || hit.distance < bestWorld.distance) bestWorld = hit;
    }
    if (best && (!bestWorld || best.distance <= bestWorld.distance + 0.2)) {
      const dir = _fwd.clone();
      game.effects.hitSpark(best.point, best.normal, best.entity);
      game.combat.applyDamage(best.entity, {
        amount: MELEE.damage, attacker: p, weapon: 'melee', headshot: best.part === 'head',
        point: best.point, direction: dir, knockback: dir.clone().multiplyScalar(4.5),
      });
      game.audio.play('melee_hit');
      this._sp.kz.kick(-0.03);
      this._sp.krx.kick(0.08);
      game.player.addShake(0.22);
    } else if (bestWorld) {
      game.effects.impact(bestWorld.point, bestWorld.normal, bestWorld.surface);
      game.audio.play('melee_hit', { volume: 0.65, rate: 1.15 });
      this._sp.kz.kick(-0.02);
      this._sp.krx.kick(0.05);
      game.player.addShake(0.12);
    }
  }

  // ---------------------------------------------------------------- events from the player

  _onLand(e) {
    const k = clamp((e && e.speed ? e.speed : 0) / 22, 0, 1);
    if (k <= 0.04) return;
    this._sp.ly.kick(-0.07 * k, -0.4 * k);
    this._sp.lrx.kick(-0.14 * k, -0.6 * k);
  }

  // ===========================================================================================
  // viewmodel
  // ===========================================================================================

  /** Position and animate the viewmodel in view-camera space. @param {number} dt */
  updateViewModel(dt) {
    const game = this.game;
    const p = game.player;
    const vm = this.vm[this.currentId];
    if (!vm || !(dt > 0)) return;
    this._clock += dt;
    const def = this.current;
    const sp = this._sp;
    for (const k in sp) sp[k].step(dt);
    this._slideRecoil.step(dt);

    // ---- movement inputs
    const yawRate = clamp(wrapAngle(p.yaw - this._lastYaw) / dt, -14, 14);
    const pitchRate = clamp((p.pitch - this._lastPitch) / dt, -10, 10);
    this._lastYaw = p.yaw;
    this._lastPitch = p.pitch;
    const ks = damp(9, dt);
    this._swayYaw += (yawRate - this._swayYaw) * ks;
    this._swayPitch += (pitchRate - this._swayPitch) * ks;
    const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw);
    const lat = p.velocity.x * cy - p.velocity.z * sy;
    this._lat += (lat - this._lat) * damp(8, dt);
    const vy = clamp(p.velocity.y / 12, -1, 1);
    this._air += ((p.onGround || p.isWallRunning ? 0 : vy) - this._air) * damp(7, dt);
    this._crouch += ((p.isCrouching ? 1 : 0) - this._crouch) * damp(9, dt);
    this._slide += ((p.isSliding ? 1 : 0) - this._slide) * damp(8, dt);
    this._wall += ((p.isWallRunning ? 1 : 0) - this._wall) * damp(7, dt);
    if (p.isWallRunning) this._wallSide = p.wallRunSide || this._wallSide;

    const viewBob = game.settings.get('viewBob');
    const bobK = viewBob === false ? 0.12 : (typeof viewBob === 'number' ? viewBob : 1);
    const grounded = p.onGround || p.isWallRunning || p.isSliding;
    const bobTarget = grounded ? clamp(p.speed / 6.2, 0, 1.6) : 0.15;
    this._bobAmp += (bobTarget - this._bobAmp) * damp(8, dt);
    this._bobPhase += dt * (0.6 + p.speed * 0.95) * (grounded ? 1 : 0.3);

    const adsE = sm(this.adsAmount);
    const dyn = 1 - 0.82 * adsE;
    const spr = sm(this.sprintBlend) * (this.reloading ? 0.45 : 1);
    const eq = 1 - sm(this.equipAmount);
    const heavy = this.currentId === 'rocket' || this.currentId === 'sniper' || this.currentId === 'rail' ? 1.25 : 1;

    // ---- base: hip -> ADS
    const hip = vm.hip, ap = vm.adsPos;
    let px = lerp(hip.x, ap.x, adsE);
    let py = lerp(hip.y, ap.y, adsE);
    let pz = lerp(hip.z, ap.z, adsE);
    let rx = 0, ry = 0, rz = 0;

    // ---- idle breathing
    const bt = this._clock;
    py += Math.sin(bt * 1.7) * 0.0011 * dyn;
    rx += Math.sin(bt * 1.7 + 0.6) * 0.0018 * dyn;
    px += Math.sin(bt * 0.9) * 0.0007 * dyn;

    // ---- walk / sprint bob
    const amp = this._bobAmp * bobK * dyn * (1 + spr * 0.55);
    const ph = this._bobPhase;
    px += Math.sin(ph) * 0.0068 * amp;
    py += Math.cos(ph * 2) * 0.0046 * amp - Math.abs(Math.sin(ph)) * 0.002 * amp;
    rz += Math.sin(ph) * 0.0105 * amp;
    rx += Math.sin(ph * 2 + 0.4) * 0.0075 * amp;
    ry += Math.cos(ph) * 0.006 * amp;

    // ---- look sway (weapon lags behind the view)
    px += this._swayYaw * 0.0042 * dyn;
    ry += -this._swayYaw * 0.0125 * dyn;
    py += -this._swayPitch * 0.0034 * dyn;
    rx += -this._swayPitch * 0.0095 * dyn;
    rz += -this._swayYaw * 0.004 * dyn;

    // ---- strafe tilt, jump lift, crouch
    rz += this._lat * 0.0032 * dyn;
    px += -this._lat * 0.0016 * dyn;
    py += -this._air * 0.022 * dyn;
    rx += -this._air * 0.05 * dyn;
    py += -0.012 * this._crouch * dyn;

    // ---- sprint pose (lowered, angled across the body)
    px += -0.012 * spr;
    py += -0.018 * spr;
    pz += 0.03 * spr;
    rx += -0.2 * spr;
    ry += 0.72 * spr;
    rz += 0.2 * spr;

    // ---- slide & wall-run tilt
    py += -0.03 * this._slide;
    rz += 0.2 * this._slide;
    ry += 0.08 * this._slide;
    rx += -0.05 * this._slide;
    const ws = this._wallSide;
    rz += -ws * 0.12 * this._wall;
    px += ws * 0.018 * this._wall;
    ry += ws * 0.1 * this._wall;
    py += -0.014 * this._wall;

    // ---- landing kick
    py += sp.ly.x;
    rx += sp.lrx.x;

    // ---- recoil springs
    pz += sp.kz.x;
    py += sp.ky.x;
    rx += sp.krx.x;
    ry += sp.kry.x;
    rz += sp.krz.x;

    // ---- equip / unequip dip
    py += -0.34 * eq * heavy;
    px += 0.06 * eq;
    rx += -0.75 * eq;
    rz += 0.4 * eq;
    ry += 0.25 * eq;

    // ---- reload pose
    const rEnv = this.reloading ? this._reloadEnvelope(def) : 0;
    this._rb += (rEnv - this._rb) * damp(this.reloading ? 14 : 10, dt);
    this._applyReloadPose(def, this._rb, this._pose);
    px += this._pose[0]; py += this._pose[1]; pz += this._pose[2];
    rx += this._pose[3]; ry += this._pose[4]; rz += this._pose[5];

    // ---- grenade: weapon lowers while the left hand works
    const gl = sm(this._grenadeLower);
    px += 0.09 * gl;
    py += -0.3 * gl * heavy;
    pz += 0.05 * gl;
    rx += -0.55 * gl;
    rz += 0.35 * gl;

    // ---- melee bash
    if (this.meleeT >= 0) {
      const mt = this.meleeT;
      if (mt < MELEE_HIT_AT) mixPose(this._poseA, ZERO6, MELEE_WIND, sm(mt / MELEE_HIT_AT));
      else if (mt < 0.24) mixPose(this._poseA, MELEE_WIND, MELEE_HIT, sm((mt - MELEE_HIT_AT) / (0.24 - MELEE_HIT_AT)));
      else mixPose(this._poseA, MELEE_HIT, ZERO6, sm((mt - 0.24) / (MELEE_TIME - 0.24)));
      px += this._poseA[0]; py += this._poseA[1]; pz += this._poseA[2];
      rx += this._poseA[3]; ry += this._poseA[4]; rz += this._poseA[5];
    }

    vm.root.position.set(px, py, pz);
    vm.root.rotation.set(rx, ry, rz);
    vm.root.visible = this.visible && !this.scoped;

    this._animateParts(vm, def, dt);
    this._animateSpecial(vm, def, dt);
    this._updateFlash(vm, dt);
    this._updateCasings(dt);
    this._updateThrowArm(dt);
    this._updatePreview(dt);
  }

  /** 0..1 pose envelope over the reload (gun turns and dips while the hands work). */
  _reloadEnvelope(def) {
    const T = this.reloadT;
    if (def.reloadMode === 'shell') {
      const start = def.reloadStart;
      const end = this.reloadTotal - def.reloadEnd;
      return sm01(T, 0, start * 0.9) * (1 - sm01(T, end, this.reloadTotal));
    }
    const p = T / this.reloadTotal;
    return sm01(p, 0, 0.12) * (1 - sm01(p, 0.86, 1.0));
  }

  _applyReloadPose(def, e, out) {
    const a = RELOAD_POSE[this.currentId] || RELOAD_POSE.rocket;
    for (let i = 0; i < 6; i++) out[i] = a[i] * e;
  }

  // ---------------------------------------------------------------- viewmodel parts

  _resetPartsToRest(vm) {
    if (!vm) return;
    for (const key in vm.parts) {
      const pt = vm.parts[key];
      pt.obj.position.copy(pt.pos);
      pt.obj.rotation.copy(pt.rot);
      pt.obj.visible = pt.visible;
    }
  }

  /** Move a part by a root-space translation and add a rotation (radians) to its rest pose. */
  _movePart(pt, dx, dy, dz, rx = 0, ry = 0, rz = 0) {
    if (!pt) return;
    _v3.set(dx, dy, dz).applyQuaternion(pt.toLocal);
    pt.obj.position.copy(pt.pos).add(_v3);
    pt.obj.rotation.set(pt.rot.x + rx, pt.rot.y + ry, pt.rot.z + rz, pt.rot.order);
  }

  _animateParts(vm, def, dt) {
    const P = vm.parts;
    const ch = this._ch;
    const id = this.currentId;
    const T = this.reloadT;
    const rl = this.reloading;
    const wasEmpty = this.reloadWasEmpty;

    // ---- targets from the reload timeline
    let magOut = 0, magVis = 1, handMag = 0, handFetch = 0, handGate = 0, rack = 0, boltBack = 0, boltLift = 0, pump = 0;
    if (rl && def.reloadMode === 'mag') {
      const p = T / this.reloadTotal;
      magOut = p < 0.28 ? sm01(p, 0.1, 0.28) : (p < 0.46 ? 1 : 1 - sm01(p, 0.46, 0.62));
      magVis = (p >= 0.28 && p < 0.46) ? 0 : 1;
      handMag = sm01(p, 0.05, 0.14) * (1 - sm01(p, 0.64, 0.78));
      handFetch = sm01(p, 0.26, 0.33) * (1 - sm01(p, 0.41, 0.47));
      if (wasEmpty && id !== 'sniper' && id !== 'rocket') {
        const c = clamp((p - 0.78) / 0.12, 0, 1);
        rack = Math.sin(c * Math.PI);
      }
      if (id === 'sniper') {
        const c = clamp((p - 0.7) / 0.24, 0, 1);
        boltLift = sm01(c, 0, 0.2) * (1 - sm01(c, 0.8, 1));
        boltBack = sm01(c, 0.2, 0.45) * (1 - sm01(c, 0.55, 0.8));
      }
    } else if (rl) {
      // shell reload: hand shuttles between the shell pouch and the loading gate
      const start = def.reloadStart;
      const q = (T - start) / def.shellTime;
      const active = T >= start && this._shellsLoaded < this._shellsNeeded;
      const lead = sm01(T, 0.05, start);
      const tail = 1 - sm01(T, this.reloadTotal - def.reloadEnd, this.reloadTotal - def.reloadEnd * 0.35);
      handMag = lead * tail;
      if (active) {
        const f = q - Math.floor(q);
        handGate = sm01(f, 0.22, 0.6) * (1 - sm01(f, 0.78, 1.0));
      }
      handFetch = 1 - handGate;
      if (wasEmpty && this._shellsLoaded >= this._shellsNeeded) {
        const c = clamp((T - (this.reloadTotal - def.reloadEnd)) / (def.reloadEnd * 0.8), 0, 1);
        pump = Math.sin(c * Math.PI);
      }
    }
    // pump / bolt cycle after firing
    if (this.cycleT >= 0 && def.cycleTime) {
      const c = clamp((this.cycleT - def.cycleDelay) / def.cycleTime, 0, 1);
      if (id === 'shotgun') pump = Math.max(pump, c < 0.45 ? sm01(c, 0, 0.45) : 1 - sm01(c, 0.55, 1));
      if (id === 'sniper') {
        boltLift = Math.max(boltLift, sm01(c, 0, 0.2) * (1 - sm01(c, 0.8, 1)));
        boltBack = Math.max(boltBack, sm01(c, 0.2, 0.5) * (1 - sm01(c, 0.55, 0.8)));
      }
    }

    // ---- smoothing (hands/mag get a little inertia so the motion is not robotic)
    const k = damp(30, dt);
    ch.magOut += (magOut - ch.magOut) * k;
    ch.handMag += (handMag - ch.handMag) * damp(22, dt);
    ch.handFetch += (handFetch - ch.handFetch) * damp(22, dt);
    ch.handGate += (handGate - ch.handGate) * damp(22, dt);
    ch.rack += (rack - ch.rack) * k;
    ch.boltBack += (boltBack - ch.boltBack) * k;
    ch.boltLift += (boltLift - ch.boltLift) * k;
    ch.pump += (pump - ch.pump) * k;
    ch.magVis = magVis;

    // ---- apply
    if (P.mag) {
      // the magazine slides straight down out of the well (rocket: the round retreats)
      const mt = vm.magTravel * ch.magOut;
      this._movePart(P.mag, vm.magDir.x * mt, vm.magDir.y * mt, vm.magDir.z * mt);
      P.mag.obj.visible = P.mag.visible && (ch.magVis > 0.5);
    }
    // ---- slide / bolt / pump
    const rec = this._slideRecoil.x;
    if (P.slide) {
      const back = this._slideLock && !rl ? 1 : Math.max(rec, ch.rack, (this._slideLock && rl && ch.rack < 0.01 ? 1 : 0));
      this._movePart(P.slide, 0, 0, 0.042 * back);
    }
    if (P.bolt) {
      if (id === 'sniper') {
        this._movePart(P.bolt, 0, 0, 0.085 * ch.boltBack, 0, 0, -0.95 * ch.boltLift);
      } else {
        this._movePart(P.bolt, 0, 0, 0.032 * Math.max(rec * 0.7, ch.rack));
      }
    }
    if (P.pump) this._movePart(P.pump, 0, 0, 0.095 * ch.pump);
    if (P.trigger) {
      this._trigger = Math.max(0, this._trigger - dt * 9);
      this._movePart(P.trigger, 0, 0, 0, -0.5 * this._trigger);
    }
    if (id === 'arc' || id === 'gale') this._animateEnergyParts(vm, def, id, dt);

    // ---- left hand: target displacement of the glove centre (root space), then swing the arm to it
    const hd = this._hd;
    hd.set(0, 0, 0);
    const w = ch.handMag;
    if (def.reloadMode === 'shell') {
      const gate = ch.handGate;
      _v1.copy(vm.gatePos).sub(vm.handCenter).multiplyScalar(gate);
      _v2.copy(vm.fetchPos).sub(vm.handCenter).multiplyScalar(1 - gate);
      hd.copy(_v1).add(_v2).multiplyScalar(w);
      hd.z += 0.095 * ch.pump * (1 - w);
    } else if (P.mag) {
      const travel = vm.magTravel;
      _v1.copy(vm.magCenter).addScaledVector(vm.magDir, travel * ch.magOut).sub(vm.handCenter).multiplyScalar(w);
      hd.copy(_v1).addScaledVector(vm.fetchVec, ch.handFetch * w);
      hd.z += 0.035 * ch.rack * (1 - w);
    }
    if (P.leftHand || P.leftArm) this._moveLeftHand(vm, hd);
  }

  /** Weapon-specific view-model animation: Slipstream momentum gauge, Javelin charge glow (rings, channel, muzzle). */
  _animateSpecial(vm, def, dt) {
    const parts = vm.model.parts;
    if (def.speedBonus) {
      this._gaugeM += (this.momentum - this._gaugeM) * damp(14, dt);
      updateGauge(parts, this._gaugeM);
    }
    if (def.charge) {
      updateViewFx(parts, this.chargeAmount, this.ammo / Math.max(1, def.magSize), this._clock);
      if (this.charging && this.flashT <= 0) {
        const c = this.chargeAmount;
        const size = (0.05 + 0.15 * c) * (1 + 0.12 * Math.sin(this._clock * 63));
        this._flashStar.scale.set(size, size, 1);
        this._flashStarMat.color.setRGB(0.25, 0.75, 1).multiplyScalar(0.5 + 0.9 * c);
        this._flashStarMat.opacity = 0.55 + 0.4 * c;
        for (const j of this._flashJets) j.scale.set(0.0001, 1, 0.0001);
        this.flash.visible = true;
        this._chargeGlow = true;
      }
    }
  }

  /** Tempest coil / gauge and Gale rotor / rings / dial (all cosmetic, driven by the shot glow `_fireAmt`). */
  _animateEnergyParts(vm, def, id, dt) {
    const P = vm.parts;
    const inv = this.inv[id];
    const frac = inv && def.magSize ? clamp(inv.ammo / def.magSize, 0, 1) : 0;
    this._fireAmt = Math.max(0, this._fireAmt - dt * (id === 'arc' ? 5 : 3.5));
    const fa = this._fireAmt;
    if (id === 'arc') {
      if (P.coil) {
        this._coilAng += dt * (4 + 30 * fa);
        P.coil.obj.rotation.z = P.coil.rot.z + this._coilAng;
      }
      const glow = vm.glow && vm.glow.coil;
      if (glow) for (const g of glow) g.mat.emissiveIntensity = g.base * (0.5 + 0.7 * fa);
      const n = Math.ceil(frac * 8 - 1e-6);
      for (let i = 0; i < 8; i++) {
        const cell = P['gauge' + i];
        if (cell) cell.obj.visible = cell.visible && i < n && !(this.reloading && this.reloadProgress < 0.62);
      }
    } else {
      if (P.rotor) {
        this._rotorAng += dt * (2 + 40 * fa);
        P.rotor.obj.rotation.z = P.rotor.rot.z + this._rotorAng;
      }
      const since = this.game.time - this.lastFireTime;
      for (let i = 0; i < 3; i++) {
        const glow = vm.glow && vm.glow['ring' + i];
        if (!glow) continue;
        const x = (since - (0.04 + 0.06 * i)) / 0.07;
        const pulse = since < 0.7 ? Math.exp(-x * x) : 0;
        const k = 0.4 + 1.1 * pulse + 0.3 * fa;
        for (const g of glow) g.mat.emissiveIntensity = g.base * k;
      }
      if (P.dial) P.dial.obj.rotation.y = P.dial.rot.y + (frac * 2 - 1) * 0.9;
    }
  }

  /**
   * Move the glove centre by `d` (root space): swing the arm about the elbow (part of the way) and slide it
   * for the remainder so the hand lands exactly on target. Falls back to a plain translation.
   */
  _moveLeftHand(vm, d) {
    const P = vm.parts;
    const arm = P.leftArm;
    if (arm && vm.armIsAncestor && vm.elbow) {
      _v1.subVectors(vm.handCenter, vm.elbow);              // u: elbow -> hand
      _v2.copy(_v1).add(d);                                 // v: elbow -> target
      const lu = _v1.length(), lv = _v2.length();
      if (lu < 1e-4 || lv < 1e-4) return;
      _q1.setFromUnitVectors(_v4.copy(_v1).multiplyScalar(1 / lu), _v5.copy(_v2).multiplyScalar(1 / lv));
      _q3.identity().slerp(_q1, 0.55);                      // swing only part of the way ...
      _v4.copy(_v1).applyQuaternion(_q3);
      _v2.sub(_v4);                                         // ... and translate the residual
      _q2.copy(arm.toLocal);
      _v2.applyQuaternion(_q2);
      _q3.premultiply(_q2).multiply(_q2.invert());          // rotation expressed in the arm's parent frame
      arm.obj.position.copy(arm.pos).add(_v2);
      arm.obj.quaternion.copy(_q3).multiply(arm.restQuat);
      return;
    }
    if (P.leftHand) this._movePart(P.leftHand, d.x, d.y, d.z);
    if (arm) this._movePart(arm, d.x, d.y, d.z);
  }

  // ---------------------------------------------------------------- flash / casings

  _updateFlash(vm, dt) {
    if (this.flashT > 0) {
      this.flashT -= dt;
      const t = clamp(this.flashT / this._flashDur, 0, 1);
      if (this.flashT <= 0) {
        this.flash.visible = false;
        this.flashLight.intensity = 0;
      } else {
        const muzzle = vm.model.muzzle;
        if (muzzle) {
          muzzle.updateWorldMatrix(true, false);
          _v1.setFromMatrixPosition(muzzle.matrixWorld);
          this.viewRoot.worldToLocal(_v1);
          this.flashLight.position.copy(_v1);
          this.flashLight.position.z -= 0.08;
        }
        this.flashLight.intensity = this.current.flash.light * VIEW_FLASH_LIGHT * t;
        this._flashStarMat.opacity = 0.35 + 0.65 * t;
        this._flashJetMat.opacity = 0.3 + 0.7 * t;
      }
    }
  }

  _updateCasings(dt) {
    for (const c of this.casings) {
      if (c.life <= 0) continue;
      c.life -= dt;
      if (c.life <= 0) { c.mesh.visible = false; continue; }
      c.vel.y -= 9.8 * dt;
      c.mesh.position.addScaledVector(c.vel, dt);
      c.mesh.rotation.x += c.spin.x * dt;
      c.mesh.rotation.y += c.spin.y * dt;
      c.mesh.rotation.z += c.spin.z * dt;
      c.mesh.scale.setScalar(Math.min(1, c.life / 0.15));
    }
  }

  // ---------------------------------------------------------------- grenade hand & preview

  _updateThrowArm(dt) {
    const ta = this.throwArm;
    if (!ta) return;
    const g = ta.group;
    const active = this.gState !== G_IDLE;
    if (!active) {
      if (g.visible) g.visible = false;
      return;
    }
    g.visible = this.visible;
    const t = this.gT;
    const out = this._pose;
    const hidden = ARM_HIDDEN, ready = ARM_READY, wind = ARM_WIND, release = ARM_RELEASE, away = ARM_AWAY;
    switch (this.gState) {
      case G_PULL:
        mixPose(out, hidden, ready, sm01(t, 0, PULL_TIME));
        break;
      case G_HOLD: {
        const tremble = 1 + 2.4 * this._cookFrac();
        const s = Math.sin(this._clock * 34) * 0.0012 * tremble;
        out[0] = ready[0] + s; out[1] = ready[1] + Math.sin(this._clock * 29) * 0.0012 * tremble;
        out[2] = ready[2]; out[3] = ready[3]; out[4] = ready[4]; out[5] = ready[5];
        break;
      }
      case G_THROW: {
        if (t < 0.07) mixPose(out, ready, wind, sm01(t, 0, 0.07));
        else mixPose(out, wind, release, sm01(t, 0.07, THROW_RELEASE));
        if (t > THROW_RELEASE) mixPose(out, release, away, sm01(t, THROW_RELEASE, THROW_RELEASE + RECOVER_TIME * 0.55));
        break;
      }
      default:
        mixPose(out, away, hidden, sm01(t, 0, RECOVER_TIME * 0.6));
        break;
    }
    g.position.set(out[0], out[1], out[2]);
    g.rotation.set(out[3], out[4], out[5]);
    // the grenade leaves the hand at the release moment; the pin ring pops off during the pull
    ta.nade.visible = this.cooking;
    if (this.gState === G_PULL || this.gState === G_HOLD) {
      const pull = sm01(this.gT, 0.12, 0.3);
      ta.ring.visible = true;
      ta.ring.position.set(0.05 + pull * 0.05, 0.085 - pull * 0.04, -0.052 + pull * 0.03);
      ta.ring.scale.setScalar(this.gT > 0.42 ? Math.max(0, 1 - (this.gT - 0.42) / 0.1) : 1);
    } else {
      ta.ring.visible = false;
    }
  }

  /** Throw-arc preview (dots + landing ring) while a grenade is being cooked. */
  _updatePreview(dt) {
    const game = this.game;
    const show = this.cooking && (this.gState === G_HOLD || (this.gState === G_PULL && this.gT > 0.15)
      || (this.gState === G_THROW && this.gT < THROW_RELEASE));
    if (!show) {
      if (this._previewShown) {
        this._previewShown = false;
        this.previewDots.visible = false;
        this.previewRing.visible = false;
        this.previewArea.visible = false;
      }
      return;
    }
    this._previewT += dt;
    if (this._previewShown && this._previewT < 0.033) return;
    this._previewT = 0;
    this._previewShown = true;

    this._grenadeLaunch(_v1, _v2);            // _v1 = position, _v2 = velocity
    const pos = _v1, vel = _v2;
    const GT = GRENADE_TYPES[this._throwType];
    if (this._previewType !== this._throwType) {
      this._previewType = this._throwType;
      const col = this._throwType === 'frag' ? 0x7feaff : GT.color;
      this._previewMat.color.setHex(col);
      this._previewRingMat.color.setHex(this._throwType === 'frag' ? 0xff9a3c : GT.color);
      this._previewAreaMat.color.setHex(GT.color);
    }
    const life = this._throwFuse(0.1);
    const H = 1 / 30;
    let t = 0, bounces = 0, dots = 0, acc = 0;
    _dir.set(0, 1, 0);                         // last contact normal
    const dotsMesh = this.previewDots;
    const cam = game.camera;
    const spacing = 0.6;
    while (t < life && dots < PREVIEW_DOTS && bounces < 3) {
      vel.y -= GRAVITY * H;
      const speed = vel.length();
      if (speed < 0.05) break;
      _v3.copy(vel).multiplyScalar(1 / speed);
      const travel = speed * H;
      const hit = game.world.raycast(pos, _v3, travel + 0.07);
      let step = travel;
      if (hit) {
        step = Math.max(0, hit.distance - 0.07);
        pos.addScaledVector(_v3, step);
        const n = hit.normal;
        _dir.copy(n);
        if (GT.stick) t = life;                 // a Vortex sticks to the first surface
        const vn = vel.dot(n);
        if (vn < 0) {
          vel.addScaledVector(n, -(1 + 0.45) * vn);
          const vnn = vel.dot(n);
          const tan = _v3.copy(n).multiplyScalar(vnn);
          vel.sub(tan).multiplyScalar(0.72).add(tan);
          bounces++;
          if (-vn < 1.3 && n.y > 0.6) { t = life; }   // comes to rest
        }
      } else {
        pos.addScaledVector(_v3, travel);
      }
      acc += step;
      while (acc >= spacing && dots < PREVIEW_DOTS) {
        acc -= spacing;
        // keep the dots a roughly constant size on screen; skip the ones right in front of the camera
        const camDist = pos.distanceTo(cam.position);
        if (camDist > 1.4) {
          const s = clamp(camDist * 0.11, 0.5, 3.2) * (1 - 0.4 * (t / life));
          _m4.makeScale(s, s, s).setPosition(pos);
          dotsMesh.setMatrixAt(dots++, _m4);
        }
      }
      t += H;
    }
    dotsMesh.count = dots;
    dotsMesh.instanceMatrix.needsUpdate = true;
    dotsMesh.visible = dots > 0;
    // landing marker
    const ring = this.previewRing;
    ring.visible = true;
    ring.position.copy(pos).addScaledVector(_dir, 0.03);
    _q1.setFromUnitVectors(_Y, _dir);
    ring.quaternion.copy(_q1);
    const pulse = 1 + 0.08 * Math.sin(this._clock * 12);
    ring.scale.setScalar(pulse * (0.9 + 0.4 * this._cookFrac()));
    const area = this.previewArea;
    if (this._throwType === 'frag') {
      area.visible = false;
    } else {
      area.visible = true;
      area.position.copy(ring.position);
      area.quaternion.copy(ring.quaternion);
      area.scale.setScalar(GT.radius * (0.96 + 0.04 * Math.sin(this._clock * 9)));
    }
  }
}

