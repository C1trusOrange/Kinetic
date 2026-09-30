/**
 * Standalone asset viewer used for screenshot-based review (tools/run.py) and manual inspection.
 * Only imports the module under review, so unrelated broken modules do not block it.
 *
 *   ?kind=weapons[&id=rifle,shotgun][&yaw=0.6]    world weapon models side by side (+ grenade/rocket)
 *   ?kind=viewmodel&id=rifle[&ads=1]              first-person view model as seen in game
 *   ?kind=bots[&pose=idle,walk,run,aim,air,crouch][&t=0.35][&weapon=rifle][&yaw=0.5]
 *   ?kind=materials[&names=a,b]                   material swatches (cubes, 2 m)
 *   ?kind=map&id=foundry[&preview=1|&overview=1|&cam=x,y,z,yaw,pitch][&nav=1][&markers=1]
 *   ?kind=test                                    simple benchmark scene
 *   &orbit=1                                      enable mouse orbit controls (manual use)
 *
 * Sets window.__VIEWER_READY__ = true once rendered, and window.__VIEWER_INFO__ with stats.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Events } from '/src/core/Events.js';
import { Settings } from '/src/core/Settings.js';
import { QUALITY_PRESETS } from '/src/core/constants.js';
import { setMaxAnisotropy } from '/src/core/procgen.js';

const P = new URLSearchParams(location.search);
const kind = P.get('kind') || 'weapons';
const infoEl = document.getElementById('info');
const labelsEl = document.getElementById('labels');
const INFO = (window.__VIEWER_INFO__ = { kind });

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
setMaxAnisotropy(renderer.capabilities.getMaxAnisotropy());
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.01, 1500);
camera.rotation.order = 'YXZ';
let controls = null;
const updaters = [];
const labels = [];

function studio({ bg = '#2b3038', floor = true, envIntensity = 0.7 } = {}) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = envIntensity;
  scene.background = new THREE.Color(bg);
  const hemi = new THREE.HemisphereLight(0xdfe8ff, 0x302a24, 0.7);
  const sun = new THREE.DirectionalLight(0xfff2e0, 2.4);
  sun.position.set(4, 7, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -6;
  sun.shadow.camera.right = sun.shadow.camera.top = 6;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(hemi, sun);
  if (floor) {
    const g = new THREE.PlaneGeometry(60, 60);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x3a3f48, roughness: 0.92 }));
    m.receiveShadow = true;
    scene.add(m);
  }
}

function frameObject(obj, dir = new THREE.Vector3(1, 0.5, 1.2), padding = 1.15) {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const r = Math.max(size.length() * 0.5, 0.05) * padding;
  const dist = r / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2));
  camera.position.copy(center).addScaledVector(dir.clone().normalize(), dist);
  camera.lookAt(center);
  camera.near = Math.max(0.005, dist / 200);
  camera.far = dist * 20 + 100;
  camera.updateProjectionMatrix();
  if (controls) { controls.target.copy(center); controls.update(); }
  return center;
}

function label(text, obj, offsetY = 0) {
  const el = document.createElement('div');
  el.className = 'lbl';
  el.textContent = text;
  labelsEl.appendChild(el);
  labels.push({ el, obj, offsetY });
}

const _lp = new THREE.Vector3();
function updateLabels() {
  for (const l of labels) {
    const box = new THREE.Box3().setFromObject(l.obj);
    _lp.set((box.min.x + box.max.x) / 2, box.min.y + l.offsetY, (box.min.z + box.max.z) / 2).project(camera);
    l.el.style.left = ((_lp.x * 0.5 + 0.5) * innerWidth) + 'px';
    l.el.style.top = ((-_lp.y * 0.5 + 0.5) * innerHeight + 6) + 'px';
    l.el.style.display = _lp.z < 1 ? '' : 'none';
  }
}

function makeMockGame() {
  const noop = () => {};
  const loop = () => ({ stop: noop, setVolume: noop, setPitch: noop, setPosition: noop });
  const noopSystem = new Proxy({}, { get: (t, k) => (k === 'playLoop' ? loop : noop) });
  return {
    isViewer: true, params: P, renderer, scene, camera, viewScene: new THREE.Scene(),
    events: new Events(), settings: new Settings(), quality: QUALITY_PRESETS.high,
    time: 0, entities: [], match: null, state: 'viewer', player: null,
    audio: noopSystem, effects: noopSystem, hud: noopSystem,
  };
}

// ------------------------------------------------------------------ kinds

async function viewWeapons() {
  const WM = await import('/src/weapons/WeaponModels.js');
  studio();
  const ids = P.get('id') ? P.get('id').split(',') : ['pistol', 'rifle', 'shotgun', 'sniper', 'rocket', 'smg', 'arc', 'rail', 'gale'];
  const yaw = parseFloat(P.get('yaw') || '0');
  const group = new THREE.Group();
  scene.add(group);
  let y = 0.25;
  const add = (name, root) => {
    const holder = new THREE.Group();
    holder.add(root);
    holder.rotation.y = Math.PI / 2 + yaw; // barrel (-Z) points to -X, side profile faces the camera
    const box = new THREE.Box3().setFromObject(holder);
    holder.position.y = y - box.min.y;
    y += box.max.y - box.min.y + 0.12;
    holder.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    group.add(holder);
    label(name, holder, -0.02);
  };
  for (const id of ids) {
    const m = WM.createWeaponModel(id, { view: false });
    add(id, m.root);
  }
  if (!P.get('id')) {
    if (WM.createGrenadeModel) add('grenade', WM.createGrenadeModel());
    if (WM.createRocketModel) add('rocket (projectile)', WM.createRocketModel());
  }
  frameObject(group, new THREE.Vector3(0.12, 0.1, 1), 0.85);
}

async function viewViewmodel() {
  const WM = await import('/src/weapons/WeaponModels.js');
  studio({ bg: '#7b8797', floor: true });
  // context: a wall and some boxes ahead
  const wall = new THREE.Mesh(new THREE.BoxGeometry(20, 6, 0.5), new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.9 }));
  wall.position.set(0, 3, -12);
  wall.receiveShadow = true;
  scene.add(wall);
  for (let i = 0; i < 4; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), new THREE.MeshStandardMaterial({ color: 0x9a7b55, roughness: 0.8 }));
    b.position.set(-4 + i * 2.6, 0.6, -7 - (i % 2) * 2);
    b.castShadow = b.receiveShadow = true;
    scene.add(b);
  }
  camera.fov = 50;
  camera.near = 0.01;
  camera.position.set(0, 1.65, 0);
  camera.rotation.set(0, 0, 0);
  camera.updateProjectionMatrix();
  scene.add(camera);
  const id = P.get('id') || 'rifle';
  const m = WM.createWeaponModel(id, { view: true });
  camera.add(m.root);
  m.root.updateMatrixWorld(true);
  const ads = P.get('ads') === '1';
  if (ads) {
    // place the sight on the camera axis at adsDistance
    m.root.position.set(0, 0, 0);
    m.root.rotation.set(0, 0, 0);
    m.root.updateMatrixWorld(true);
    const s = m.root.worldToLocal(m.sight.getWorldPosition(new THREE.Vector3()));
    m.root.position.set(-s.x, -s.y, -(m.adsDistance ?? 0.2) - s.z);
    const xh = document.createElement('div');
    xh.className = 'xh';
    document.body.appendChild(xh);
  } else if (m.hip) {
    m.root.position.copy(m.hip);
  }
  INFO.hip = m.hip ? m.hip.toArray() : null;
  INFO.adsDistance = m.adsDistance ?? null;
  INFO.parts = Object.keys(m.parts || {});
  let tris = 0;
  m.root.traverse(o => { if (o.isMesh && o.geometry) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
  INFO.triangles = Math.round(tris);
}

async function viewBots() {
  const { BotModel } = await import('/src/ai/BotModel.js');
  let WM = null;
  try { WM = await import('/src/weapons/WeaponModels.js'); } catch (e) { console.warn('viewer: WeaponModels unavailable', e.message); }
  studio();
  const poses = (P.get('pose') || 'idle,walk,run,aim,air,crouch').split(',');
  const colors = [0xff4a3d, 0x3d9bff, 0x6ee05a, 0xffb020, 0xb45cff, 0x2ee6d6];
  const t = parseFloat(P.get('t') || '0.35');
  const yaw = parseFloat(P.get('yaw') || '0.5');
  const group = new THREE.Group();
  scene.add(group);
  const states = {
    idle: { forwardSpeed: 0, strafeSpeed: 0, speed: 0, onGround: true, crouch: 0, aimPitch: 0, aimYawOffset: 0, firing: false, reloading: false, alive: true },
    walk: { forwardSpeed: 3.5, strafeSpeed: 0, speed: 3.5, onGround: true, crouch: 0, aimPitch: 0, aimYawOffset: 0, firing: false, reloading: false, alive: true },
    run: { forwardSpeed: 8, strafeSpeed: 0, speed: 8, onGround: true, crouch: 0, aimPitch: 0, aimYawOffset: 0, firing: false, reloading: false, alive: true },
    strafe: { forwardSpeed: 0, strafeSpeed: 5, speed: 5, onGround: true, crouch: 0, aimPitch: 0, aimYawOffset: 0, firing: false, reloading: false, alive: true },
    aim: { forwardSpeed: 0, strafeSpeed: 0, speed: 0, onGround: true, crouch: 0, aimPitch: 0.35, aimYawOffset: 0.3, firing: true, reloading: false, alive: true },
    air: { forwardSpeed: 5, strafeSpeed: 0, speed: 5, onGround: false, crouch: 0, aimPitch: -0.2, aimYawOffset: 0, firing: false, reloading: false, alive: true },
    crouch: { forwardSpeed: 0, strafeSpeed: 0, speed: 0, onGround: true, crouch: 1, aimPitch: 0, aimYawOffset: 0, firing: false, reloading: false, alive: true },
    reload: { forwardSpeed: 0, strafeSpeed: 0, speed: 0, onGround: true, crouch: 0, aimPitch: 0, aimYawOffset: 0, firing: false, reloading: true, alive: true },
  };
  let tris = 0;
  poses.forEach((pose, i) => {
    const bot = new BotModel({ color: colors[i % colors.length] });
    if (WM) bot.setWeapon(WM.createWeaponModel(P.get('weapon') || 'rifle', { view: false }));
    bot.root.position.set((i - (poses.length - 1) / 2) * 1.5, 0, 0);
    bot.root.rotation.y = yaw;
    const st = states[pose] || states.idle;
    const steps = Math.max(1, Math.round(t * 60));
    for (let k = 0; k < steps; k++) bot.update(1 / 60, st);
    bot.root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    group.add(bot.root);
    label(pose, bot.root, -0.05);
    if (i === 0) bot.root.traverse(o => { if (o.isMesh && o.geometry) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
  });
  INFO.trianglesPerBot = Math.round(tris);
  frameObject(group, new THREE.Vector3(0.25, 0.3, 1), 0.8);
}

async function viewMaterials() {
  const T = await import('/src/world/Textures.js');
  if (T.initTextures) T.initTextures(renderer);
  studio({ floor: false, bg: '#23272e' });
  const names = P.get('names') ? P.get('names').split(',') : T.MATERIAL_NAMES;
  const cols = Math.ceil(Math.sqrt(names.length * 1.7));
  const group = new THREE.Group();
  scene.add(group);
  const t0 = performance.now();
  names.forEach((n, i) => {
    const mat = T.getMaterial(n);
    const info = T.getMaterialInfo ? T.getMaterialInfo(n) : { scale: 2 };
    const geo = new THREE.BoxGeometry(2, 2, 2);
    const uv = geo.attributes.uv;
    const k = 2 / (info.scale || 2);
    for (let j = 0; j < uv.count; j++) uv.setXY(j, uv.getX(j) * k, uv.getY(j) * k);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set((i % cols) * 2.9, -Math.floor(i / cols) * 3.2, 0);
    mesh.rotation.set(0.35, -0.6, 0);
    group.add(mesh);
    label(n, mesh, -0.45);
  });
  INFO.generationMs = Math.round(performance.now() - t0);
  INFO.count = names.length;
  frameObject(group, new THREE.Vector3(0, 0, 1), 0.72);
}

async function viewMap() {
  const id = P.get('id') || 'sandbox';
  const [{ World }, mapMod] = await Promise.all([
    import('/src/world/World.js'),
    import(`/src/world/maps/${id}.js`),
  ]);
  const def = mapMod.default;
  const game = makeMockGame();
  const world = new World(game);
  if (world.init) await world.init();
  const t0 = performance.now();
  await world.load(def, { onProgress: (p, l) => { infoEl.textContent = `${l || ''} ${Math.round(p * 100)}%`; } });
  INFO.loadMs = Math.round(performance.now() - t0);
  INFO.collisionTriangles = world.collision ? world.collision.triangleCount : null;
  INFO.spawns = world.spawnPoints ? world.spawnPoints.length : null;
  INFO.pickups = world.pickups && world.pickups.list ? world.pickups.list.length : null;
  INFO.nav = world.nav && world.nav.stats ? world.nav.stats : null;
  INFO.warnings = world.warnings || [];

  camera.fov = 70;
  camera.near = 0.05;
  camera.far = 1500;
  camera.updateProjectionMatrix();
  const b = world.bounds || new THREE.Box3(new THREE.Vector3(-40, 0, -40), new THREE.Vector3(40, 20, 40));
  const center = b.getCenter(new THREE.Vector3());
  const size = b.getSize(new THREE.Vector3());
  if (P.get('cam')) {
    const [x, y, z, yaw = 0, pitch = 0] = P.get('cam').split(',').map(Number);
    camera.position.set(x, y, z);
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
  } else if (P.get('overview')) {
    camera.position.set(center.x + size.x * 0.05, center.y + Math.max(size.x, size.z) * 0.95, center.z + size.z * 0.55);
    camera.lookAt(center);
  } else if (def.previewCamera && !P.get('top')) {
    camera.position.fromArray(def.previewCamera.pos);
    camera.lookAt(new THREE.Vector3().fromArray(def.previewCamera.lookAt));
  } else {
    camera.position.set(center.x, center.y + Math.max(size.x, size.z) * 1.1, center.z + 0.01);
    camera.lookAt(center);
  }
  if (P.get('nav') && world.nav && world.nav.debugObject) scene.add(world.nav.debugObject());
  if (P.get('markers') !== '0') {
    const sm = new THREE.MeshBasicMaterial({ color: 0x33ff66 });
    for (const sp of world.spawnPoints || []) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.8, 8), sm);
      cone.position.copy(sp.position).add(new THREE.Vector3(0, 2.2, 0));
      cone.rotation.x = Math.PI;
      scene.add(cone);
    }
  }
  if (controls) { controls.target.copy(center); controls.update(); }
  updaters.push(dt => { try { world.update(dt); } catch (e) { /* viewer only */ } });
}

async function viewTest() {
  studio();
  const geo = new THREE.TorusKnotGeometry(0.6, 0.2, 200, 32);
  for (let i = 0; i < 30; i++) {
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(i / 30, 0.6, 0.5), metalness: 0.5, roughness: 0.4 }));
    m.position.set((i % 6) * 1.8 - 4.5, 1 + Math.floor(i / 6) * 1.6, -3);
    m.castShadow = true;
    scene.add(m);
    updaters.push(dt => { m.rotation.y += dt; });
  }
  camera.position.set(0, 4, 8);
  camera.lookAt(0, 4, -3);
}

// ------------------------------------------------------------------ run

const KINDS = { weapons: viewWeapons, weapon: viewWeapons, viewmodel: viewViewmodel, bots: viewBots, bot: viewBots, materials: viewMaterials, map: viewMap, test: viewTest };

async function main() {
  if (P.get('orbit') === '1') controls = new OrbitControls(camera, renderer.domElement);
  const fn = KINDS[kind];
  if (!fn) throw new Error('unknown kind ' + kind);
  await fn();
  let frames = 0;
  let last = performance.now();
  let fpsAcc = 0;
  const loop = () => {
    requestAnimationFrame(loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    for (const u of updaters) u(dt);
    if (controls) controls.update();
    renderer.render(scene, camera);
    updateLabels();
    frames++;
    if (frames > 3) fpsAcc += dt;
    if (frames === 12) {
      INFO.renderCalls = renderer.info.render.calls;
      INFO.renderTriangles = renderer.info.render.triangles;
      INFO.fps = +(8 / Math.max(fpsAcc, 1e-3)).toFixed(1);
      if (!infoEl.textContent) infoEl.textContent = `${kind}  calls=${INFO.renderCalls} tris=${INFO.renderTriangles}`;
      window.__VIEWER_READY__ = true;
    }
  };
  loop();
}

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

main().catch(err => {
  console.error('[viewer]', err);
  infoEl.textContent = 'ERROR: ' + (err && err.stack ? err.stack : err);
  window.__VIEWER_READY__ = true;
  INFO.error = String(err && err.stack ? err.stack : err);
});
