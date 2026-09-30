// Isolated test harness for WeaponSystem + Projectiles (real Combat/Input/Collision, stub player/world/fx/audio).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Capsule } from 'three/addons/math/Capsule.js';
import { Events } from '/src/core/Events.js';
import { Settings } from '/src/core/Settings.js';
import { Input, BASE_LOOK_SPEED } from '/src/core/Input.js';
import { Combat } from '/src/core/Combat.js';
import { Entity } from '/src/core/Entity.js';
import { QUALITY_PRESETS, GRAVITY, HUMANOID } from '/src/core/constants.js';
import { forwardFromYaw, rightFromYaw, clamp } from '/src/core/utils.js';
import { CollisionWorld } from '/src/world/Collision.js';
import { WeaponSystem } from '/src/weapons/WeaponSystem.js';
import { Projectiles } from '/src/weapons/Projectiles.js';

const P = new URLSearchParams(location.search);
const VIEW_FOV = 50;

// ------------------------------------------------------------------ renderer / scenes
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.autoClear = false;
document.body.appendChild(renderer.domElement);

const aspect = innerWidth / innerHeight;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, aspect, 0.05, 700);
camera.rotation.order = 'YXZ';
scene.add(camera);
const viewScene = new THREE.Scene();
const viewCamera = new THREE.PerspectiveCamera(VIEW_FOV, aspect, 0.01, 20);
viewCamera.rotation.order = 'YXZ';
viewScene.add(viewCamera);
const viewHemi = new THREE.HemisphereLight(0xdde8ff, 0x3a3228, 1.0);
const viewSun = new THREE.DirectionalLight(0xffffff, 2.0);
viewScene.add(viewHemi, viewSun, viewSun.target);

const pmrem = new THREE.PMREMGenerator(renderer);
const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environment = env;
scene.environmentIntensity = 0.6;
viewScene.environment = env;
viewScene.environmentIntensity = 0.6;
scene.background = new THREE.Color(0x7d93b0);
scene.fog = new THREE.Fog(0x7d93b0, 40, 160);
const sun = new THREE.DirectionalLight(0xfff0dc, 2.4);
sun.position.set(-20, 40, 15);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, far: 120 });
scene.add(sun, new THREE.HemisphereLight(0xbfd4ff, 0x3a3025, 0.8));
const sunDir = sun.position.clone().normalize();

// ------------------------------------------------------------------ world (real CollisionWorld)
const collision = new CollisionWorld();
const checker = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { g.fillStyle = (x + y) % 2 ? '#6a6f78' : '#80858d'; g.fillRect(x * 16, y * 16, 16, 16); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
function solid(min, max, color = 0x9a9fa8, tex = false) {
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const geo = new THREE.BoxGeometry(...size);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05 });
  if (tex) { const t = checker.clone(); t.needsUpdate = true; t.repeat.set(size[0] / 4, size[2] / 4); mat.map = t; }
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(min[0] + size[0] / 2, min[1] + size[1] / 2, min[2] + size[2] / 2);
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.updateMatrixWorld();
  scene.add(mesh);
  collision.addGeometry(geo, mesh.matrixWorld, 'concrete');
  return mesh;
}
solid([-40, -1, -40], [40, 0, 40], 0xffffff, true);
solid([-40, 0, -40], [40, 12, -38], 0x8a8f99);
solid([-40, 0, 38], [40, 12, 40], 0x8a8f99);
solid([-40, 0, -40], [-38, 12, 40], 0x8a8f99);
solid([38, 0, -40], [40, 12, 40], 0x8a8f99);
solid([-6, 0, -20], [-3, 2.4, -17], 0x9a7b55);
solid([4, 0, -14], [6, 1.2, -12], 0x9a7b55);
solid([-12, 0, -8], [-10, 4, 8], 0x7a808c);
solid([9, 0, 2], [15, 1, 6], 0x6f7580);
const world = {
  collision, def: { id: 'harness' }, mapId: 'harness', killY: -60,
  bounds: new THREE.Box3(new THREE.Vector3(-40, -2, -40), new THREE.Vector3(40, 30, 40)),
  lighting: { sunDirection: sunDir },
  raycast: (o, d, m) => collision.raycast(o, d, m),
  update() {},
};
collision.build();

// ------------------------------------------------------------------ stub systems
const soundLog = [];
const soundCounts = {};
const audio = {
  play(name, opts) { soundCounts[name] = (soundCounts[name] || 0) + 1; soundLog.push([+game.time.toFixed(2), name]); if (soundLog.length > 400) soundLog.shift(); },
  playLoop() { return { setVolume() {}, setRate() {}, setPosition() {}, stop() {} }; },
  unlock() {}, update() {}, setMasterVolume() {},
};

const fxObjs = [];
const fxCounts = { impact: 0, hitSpark: 0, tracer: 0, flashLight: 0, explosion: 0, trail: 0 };
const fxMat = new THREE.LineBasicMaterial({ color: 0xffe9a8 });
const effects = {
  counts: fxCounts,
  impact(point, normal) {
    fxCounts.impact++;
    const m = new THREE.Mesh(new THREE.CircleGeometry(0.08, 8), new THREE.MeshBasicMaterial({ color: 0x111111 }));
    m.position.copy(point).addScaledVector(normal, 0.01);
    m.lookAt(point.clone().add(normal));
    scene.add(m);
    fxObjs.push({ obj: m, life: 6 });
  },
  hitSpark(point) {
    fxCounts.hitSpark++;
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffdd66 }));
    m.position.copy(point);
    scene.add(m);
    fxObjs.push({ obj: m, life: 0.15 });
  },
  tracer(from, to, o = {}) {
    fxCounts.tracer++;
    const g = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
    const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: o.color ?? 0xffe9a8, transparent: true }));
    scene.add(l);
    fxObjs.push({ obj: l, life: 0.09 });
  },
  muzzleFlash() {},
  flashLight() { fxCounts.flashLight++; },
  explosion(pos, o = {}) {
    fxCounts.explosion++;
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff9a3c, transparent: true, opacity: 0.7 }));
    m.position.copy(pos);
    m.scale.setScalar((o.radius || 5) * 0.5);
    scene.add(m);
    fxObjs.push({ obj: m, life: 0.5 });
  },
  trail() { fxCounts.trail++; },
  gibs() {}, dust() {}, clear() {},
  update(dt) {
    for (let i = fxObjs.length - 1; i >= 0; i--) {
      const f = fxObjs[i];
      f.life -= dt;
      if (f.life <= 0) { scene.remove(f.obj); f.obj.geometry.dispose(); fxObjs.splice(i, 1); }
      else if (f.obj.material.transparent) f.obj.material.opacity = Math.min(0.7, f.life * 3);
    }
  },
};

// ------------------------------------------------------------------ player stub
class HPlayer extends Entity {
  constructor(g) {
    super(g);
    this.isPlayer = true;
    this.name = 'Player';
    this.capsule = new Capsule(new THREE.Vector3(), new THREE.Vector3(), HUMANOID.radius);
    this.speed = 0; this.isSprinting = false; this.isCrouching = false; this.isSliding = false; this.isWallRunning = false;
    this.wallRunSide = 0; this.isGrappling = false; this.isMantling = false; this.grappleCharge = 1; this.grappleAnchor = null;
    this.landImpact = 0; this.lookScale = 1; this.fovMultiplier = 1;
    this.recoilTotal = { pitch: 0, yaw: 0 }; this.shake = 0; this.sprintCancels = 0; this.frozenMove = false;
  }
  spawn(pos, yaw) { super.spawn(pos, yaw); this._sync(); }
  _sync() {
    this.capsule.start.set(this.position.x, this.position.y + this.radius, this.position.z);
    this.capsule.end.set(this.position.x, this.position.y + this.height - this.radius, this.position.z);
  }
  update(dt) {
    if (!this.alive || dt <= 0) return;
    const input = this.game.input;
    const look = input.consumeLook();
    const k = BASE_LOOK_SPEED * this.game.settings.get('sensitivity') * this.lookScale;
    this.yaw -= look.x * k;
    this.pitch = clamp(this.pitch - look.y * k, -1.55, 1.55);
    { const dp = (this._rp || 0) * Math.min(1, dt * 6), dy = (this._ry || 0) * Math.min(1, dt * 6); this.pitch -= dp; this.yaw -= dy; this._rp -= dp; this._ry -= dy; }
    const f = forwardFromYaw(this.yaw, new THREE.Vector3()), r = rightFromYaw(this.yaw, new THREE.Vector3());
    const wish = new THREE.Vector3();
    if (input.action('forward')) wish.add(f);
    if (input.action('back')) wish.sub(f);
    if (input.action('right')) wish.add(r);
    if (input.action('left')) wish.sub(r);
    if (wish.lengthSq() > 0) wish.normalize();
    this.isSprinting = input.action('sprint') && input.action('forward');
    this.isCrouching = input.action('crouch');
    const sp = this.isSprinting ? 9.6 : (this.isCrouching ? 3.2 : 6.2);
    const b = this.onGround ? Math.min(1, dt * 10) : Math.min(1, dt * 2);
    this.velocity.x += (wish.x * sp - this.velocity.x) * b;
    this.velocity.z += (wish.z * sp - this.velocity.z) * b;
    if (this.onGround && input.actionPressed('jump')) { this.velocity.y = 8; this.onGround = false; }
    this.velocity.y -= GRAVITY * dt;
    const wasAir = !this.onGround, vy = this.velocity.y;
    const res = this.game.world.collision.moveCapsule(this.capsule, this.velocity, dt);
    this.onGround = res.onGround;
    if (wasAir && this.onGround && vy < -6) this.game.events.emit('player:land', { speed: -vy });
    this.position.set(this.capsule.start.x, this.capsule.start.y - this.radius, this.capsule.start.z);
    this.speed = Math.hypot(this.velocity.x, this.velocity.z);
  }
  updateCamera() {
    const cam = this.game.camera;
    this.getEyePosition(cam.position);
    cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    cam.fov = this.game.getBaseFov() * this.fovMultiplier;
    cam.updateProjectionMatrix();
  }
  addRecoil(p, y) { this.pitch += p; this.yaw += y; this.recoilTotal.pitch += p; this.recoilTotal.yaw += y; this._rp = (this._rp || 0) + p; this._ry = (this._ry || 0) + y; }
  addShake(a) { this.shake += a; }
  cancelSprint() { this.isSprinting = false; this.sprintCancels++; }
  giveWeapon(id) { return this.game.weapons.giveWeapon(id); }
  addAmmo(id, f) { return this.game.weapons.addAmmo(id, f); }
  addGrenades(n) { return this.game.weapons.addGrenades(n); }
}

class Dummy extends Entity {
  constructor(g, x, z, name) {
    super(g);
    this.name = name;
    this.isBot = true;
    this.position.set(x, 0, z);
    this.alive = true;
    this.team = 100 + Math.floor(x);
    this.mesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.38, 1.0, 4, 10), new THREE.MeshStandardMaterial({ color: 0xd04a3a, roughness: 0.6, metalness: 0.3 }));
    this.head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 8), new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.4, metalness: 0.5 }));
    scene.add(this.mesh, this.head);
    this.sync();
  }
  sync() {
    this.mesh.position.set(this.position.x, this.position.y + 0.9, this.position.z);
    this.head.position.set(this.position.x, this.position.y + this.height - 0.22, this.position.z);
    this.mesh.visible = this.head.visible = this.alive;
    if (this.alive) this.mesh.material.color.setHex(this.health < 100 ? 0xff7a30 : 0xd04a3a);
  }
  onDeath() { this.sync(); this.deathTime = this.game.time; }
}

// ------------------------------------------------------------------ game object
const game = {
  isHarness: true, params: P, renderer, scene, camera, viewScene, viewCamera, events: new Events(), settings: new Settings(),
  quality: QUALITY_PRESETS.high, time: 0, timeScale: 1, state: 'playing', entities: [], match: { over: false }, world, audio, effects,
  getBaseFov() {
    const h = THREE.MathUtils.degToRad(clamp(this.settings.get('fov'), 60, 130));
    return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(h / 2) / this.camera.aspect));
  },
  addEntity(e) { e.id = this.entities.length + 1; this.entities.push(e); return e; },
  removeEntity(e) { const i = this.entities.indexOf(e); if (i >= 0) this.entities.splice(i, 1); },
  getEnemiesOf(e) { return this.entities.filter(o => o !== e && o.alive && o.team !== e.team); },
};
game.input = new Input(game, renderer.domElement);
game.input.enabled = true;
game.input.capture = true;
game.combat = new Combat(game);
game.projectiles = new Projectiles(game);
game.player = new HPlayer(game);
game.weapons = new WeaponSystem(game);
game.viewSync = () => {
  camera.updateMatrixWorld();
  viewCamera.position.copy(camera.position);
  viewCamera.quaternion.copy(camera.quaternion);
  viewCamera.updateMatrixWorld();
  viewSun.position.copy(camera.position).addScaledVector(sunDir, 10);
  viewSun.target.position.copy(camera.position);
  viewSun.target.updateMatrixWorld();
};
window.__GAME__ = game;

// ------------------------------------------------------------------ composer (bloom like the real game)
let composer = null, viewPass = null;
function setupComposer() {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  composer = new EffectComposer(renderer, rt);
  composer.setSize(innerWidth, innerHeight);
  viewPass = new RenderPass(viewScene, viewCamera);
  viewPass.clear = false;
  viewPass.clearDepth = true;
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(viewPass);
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.45, 0.4, 0.88));
  composer.addPass(new OutputPass());
}
if (P.get('bloom') !== '0') setupComposer();

function render() {
  if (composer) { composer.render(); return; }
  renderer.setRenderTarget(null);
  renderer.clear();
  renderer.render(scene, camera);
  renderer.clearDepth();
  renderer.render(viewScene, viewCamera);
}

// ------------------------------------------------------------------ setup match
const dummies = [];
function resetMatch() {
  game.entities.length = 0;
  game.addEntity(game.player);
  for (const d of dummies) { scene.remove(d.mesh, d.head); }
  dummies.length = 0;
  const spots = [[0, -12, 'A'], [-6, -16, 'B'], [7, -22, 'C'], [14, -30, 'D'], [-20, -25, 'E']];
  for (const [x, z, n] of spots) { const d = new Dummy(game, x, z, n); game.addEntity(d); dummies.push(d); }
  game.player.reset && game.player.reset();
  game.player.spawn(new THREE.Vector3(0, 0, 8), 0);
  game.projectiles.clear();
  game.weapons.onMatchStart();
  game.weapons.onPlayerSpawn();
}
game.resetMatch = resetMatch;

const report = { done: false, started: false, t: 0, errors: window.__ERRORS__ || [], custom: {} };
window.__TEST__ = report;
window.__ERRORS__ = window.__ERRORS__ || [];
window.addEventListener('error', e => { report.errors.push(String(e.message)); });
window.addEventListener('unhandledrejection', e => { report.errors.push('unhandled: ' + e.reason); });
const origError = console.error;
console.error = (...a) => { report.errors.push(a.map(String).join(' ')); origError(...a); };

let scenario = null;
const duration = parseFloat(P.get('duration') || '20');
let simT = 0;

function step(dt) {
  game.time += dt;
  simT += dt;
  report.t = +simT.toFixed(2);
  if (scenario && scenario.drive) scenario.drive(simT, dt, game, report);
  game.player.update(dt);
  game.weapons.update(dt);
  for (const d of dummies) d.sync();
  game.projectiles.update(dt);
  effects.update(dt);
  game.player.updateCamera(dt);
  game.viewSync();
  game.weapons.updateViewModel(dt);
  if (simT >= duration && !report.done) {
    if (scenario && scenario.finish) { try { scenario.finish(game, report); } catch (e) { console.error(e); } }
    report.custom.sounds = soundCounts;
    report.custom.fx = fxCounts;
    report.done = true;
    report.ok = report.errors.length === 0;
  }
}

let lastT = 0;
let frames = 0;
function loop(nowMs) {
  requestAnimationFrame(loop);
  const now = nowMs / 1000;
  let raw = lastT ? now - lastT : 1 / 60;
  lastT = now;
  if (!(raw > 0)) raw = 1 / 60;
  if (raw > 0.25) raw = 0.25;
  game.input.update();
  try {
    if (report.started) step(Math.min(raw, 0.05) * game.timeScale);
    game.viewSync();
    game.viewCamera.aspect = camera.aspect;
    if (viewPass) viewPass.enabled = !!game.weapons && game.player.alive;
    render();
  } catch (err) {
    console.error('frame error', err);
  }
  game.input.endFrame();
  frames++;
  if (frames % 15 === 0) {
    const w = game.weapons;
    document.getElementById('hud').textContent = `${w.currentId} ${w.ammo}/${w.reserve} ads ${w.adsAmount.toFixed(2)} spread ${w.spreadAngle.toFixed(4)} gr ${w.grenades} t ${simT.toFixed(1)}`;
  }
}

async function main() {
  await game.weapons.init();
  game.projectiles.init();
  if (P.get('scenario')) scenario = await import('/' + P.get('scenario').replace(/^\/+/, ''));
  resetMatch();
  if (scenario && scenario.setup) await scenario.setup(game, report);
  report.started = true;
  requestAnimationFrame(loop);
}
main().catch(e => { console.error('harness boot failed', e); report.errors.push(String(e && e.stack || e)); });
