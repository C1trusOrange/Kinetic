// Isolated UI harness: real HUD + Menu + Settings + Events, mock everything else.
import * as THREE from 'three';
import { Events } from '/src/core/Events.js';
import { Settings } from '/src/core/Settings.js';
import { DEFAULT_BINDINGS } from '/src/core/Input.js';
import { MAPS } from '/src/world/maps/index.js';
import { WEAPONS, WEAPON_ORDER } from '/src/weapons/WeaponDefs.js';
import { HUD } from '/src/ui/HUD.js';
import { Menu } from '/src/ui/Menu.js';

const params = new URLSearchParams(location.search);

// ------------------------------------------------------------------ fake backdrop (dusk city)
function paintBackdrop() {
  const c = document.getElementById('bg');
  c.width = innerWidth; c.height = innerHeight;
  c.style.cssText = 'position:fixed;inset:0;width:100%;height:100%';
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, c.height);
  g.addColorStop(0, '#1a2140'); g.addColorStop(0.55, '#9a5a6a'); g.addColorStop(0.7, '#f0a060'); g.addColorStop(1, '#231a20');
  x.fillStyle = g; x.fillRect(0, 0, c.width, c.height);
  let seed = 7; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 40; i++) {
    const w = 30 + r() * 90, h = 60 + r() * 320;
    x.fillStyle = `rgb(${20 + r() * 20},${18 + r() * 20},${28 + r() * 20})`;
    x.fillRect(r() * c.width, c.height * 0.72 - h, w, h + 400);
  }
  x.fillStyle = '#2a2530'; x.fillRect(0, c.height * 0.72, c.width, c.height);
  for (let i = 0; i < 300; i++) { x.fillStyle = `rgba(255,255,255,${r() * 0.05})`; x.fillRect(r() * c.width, r() * c.height, 40 + r() * 100, 2); }
}
paintBackdrop();

// ------------------------------------------------------------------ mocks
const played = [];
const events = new Events();
const settings = new Settings();
const held = {};

function mkEntity(id, name, color, team, opts = {}) {
  return {
    id, name, team, color: new THREE.Color(color), isPlayer: !!opts.player, isBot: !opts.player, alive: true,
    health: 100, maxHealth: 100, armor: 0, maxArmor: 100, kills: 0, deaths: 0, streak: 0,
    position: new THREE.Vector3(opts.x || 0, 0, opts.z || 0), yaw: 0, respawnAt: -1, spawnProtectedUntil: 0,
    isProtected() { return game.time < this.spawnProtectedUntil; },
  };
}

const player = mkEntity(1, 'Player', 0x9fe8ff, 1, { player: true });
Object.assign(player, {
  speed: 0, isSprinting: false, isSliding: false, isWallRunning: false, isGrappling: false, isMantling: false,
  grappleCharge: 1, fovMultiplier: 1, onGround: true,
});

const weapons = {
  currentId: 'rifle', current: WEAPONS.rifle, ammo: 24, reserve: 96, reloading: false, reloadProgress: 0, adsAmount: 0, scoped: false,
  spreadAngle: 0.012, grenades: 3, maxGrenades: 4, cooking: false, cookProgress: 0, owned: ['pistol', 'rifle', 'shotgun'], lastFireTime: -1,
};

const game = {
  uiRoot: document.getElementById('ui'), events, settings,
  input: { bindings: DEFAULT_BINDINGS, action: n => !!held[n], locked: true, lockUnavailable: false },
  audio: { play(n) { played.push(n); }, unlock() {} },
  maps: MAPS, camera: { fov: 60 }, time: 0, realTime: 0, fps: 144, state: 'playing', autotest: null,
  match: null, entities: [player], player, weapons, world: { def: MAPS[0] },
  getScoreboard() {
    return this.entities.map(e => ({ id: e.id, name: e.name, kills: e.kills, deaths: e.deaths, team: e.team, isPlayer: !!e.isPlayer, alive: e.alive, color: '#' + e.color.getHexString() }))
      .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  },
  started: null,
  startMatch(o) { this.started = o; console.log('startMatch', JSON.stringify(o)); },
  resume() { console.log('resume'); }, restartMatch() { console.log('restart'); }, quitToMenu() { console.log('quit'); },
};

const hud = new HUD(game);
const menu = new Menu(game);
game.hud = hud; game.menu = menu;
hud.init(); menu.init();
menu.hideLoading();

const bots = [];
const botNames = ['Sprocket', 'Voltage', 'Glitch', 'Rivet', 'Cog', 'Nimbus', 'Axle'];
const botCols = [0xff4a3d, 0xffb020, 0x6ee05a, 0xb45cff, 0xff5fb0, 0x2ee6d6, 0xf2f2f2];
botNames.forEach((n, i) => { const b = mkEntity(2 + i, n, botCols[i], 2 + i, { x: Math.cos(i) * 12, z: Math.sin(i) * 12 }); bots.push(b); });

function startFakeMatch(mode = 'ffa') {
  game.entities.length = 0;
  game.entities.push(player, ...bots);
  const tdm = mode === 'tdm';
  bots.forEach((b, i) => { b.team = tdm ? (i % 2 ? 1 : 2) : b.id; if (tdm) b.color.set(b.team === 1 ? 0x3d9bff : 0xff4a3d); b.kills = 0; b.deaths = 0; b.alive = true; });
  player.team = tdm ? 1 : player.id; player.kills = 0; player.deaths = 0; player.alive = true; player.health = 100; player.armor = 0;
  game.match = { mapId: 'foundry', mapName: 'Foundry', mode, botCount: 7, difficulty: 'normal', scoreLimit: 25, timeLimit: 10,
    timeLeft: 452, teamScores: { 1: 0, 2: 0 }, over: false, startTime: 0, winner: null, winnerTeam: 0, playerWon: false, results: null };
  game.time = 0;
  hud.onMatchStart(game.match);
  hud.show(true);
  game.state = 'playing';
}

window.__H = { THREE, game, hud, menu, player, weapons, bots, events, settings, WEAPONS, WEAPON_ORDER, startFakeMatch, played, held };
window.__READY = true;

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (!window.__FREEZE) { game.time += dt; game.realTime += dt; }
  game.fps = 1 / Math.max(dt, 1e-3);
  if (game.match && game.state === 'playing') { if (window.__TICK !== false) game.match.timeLeft = Math.max(0, game.match.timeLeft - dt); hud.update(dt); }
}
requestAnimationFrame(frame);
if (params.has('match')) startFakeMatch(params.get('match'));
