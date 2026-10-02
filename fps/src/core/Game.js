import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';

import { Events } from './Events.js';
import { Settings } from './Settings.js';
import { Input } from './Input.js';
import { Combat } from './Combat.js';
import { AudioSystem } from './Audio.js';
import { AutoTest } from './AutoTest.js';
import { RESPAWN_DELAY, TEAM_BLUE, TEAM_COLORS, PLAYER_COLOR, QUALITY_PRESETS, isTeamMode } from './constants.js';
import { Modes } from './Modes.js';
import { freezePool } from '../weapons/Loadout.js';
import { clamp, damp, nextFrame } from './utils.js';
import { SceneLayersPass, KineticBloomPass, KineticOutputPass } from './RenderPipeline.js';
import { detectGpu, resolveQuality, presetPixelRatio, presetsNeedRecompile } from './GraphicsQuality.js';
import { FrameLimiter } from './FrameLimiter.js';

import { World } from '../world/World.js';
import { MAPS, getMap } from '../world/maps/index.js';
import { Player } from '../player/Player.js';
import { WeaponSystem } from '../weapons/WeaponSystem.js';
import { Projectiles } from '../weapons/Projectiles.js';
import { BotManager } from '../ai/BotManager.js';
import { Effects } from '../fx/Effects.js';
import { HUD } from '../ui/HUD.js';
import { Menu } from '../ui/Menu.js';
import { NetSession } from '../net/NetSession.js';
import { NET, fromWireTime } from '../net/GameProtocol.js';


const VIEW_FOV = 50; // vertical fov of the viewmodel camera (weapons are authored for this)
/** Exposure factor on top of the map's exposure: AgX has no ACES-style 1/0.6 pre-gain, so the maps' values need it. */
const TONE_EXPOSURE = 1.45;
/** Saturation grade after tone mapping (KineticOutputPass): gives back some of the colour AgX rolls off. */
const TONE_SATURATION = 1.06;
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/**
 * Owns the renderer, scenes, cameras, main loop, match rules and every subsystem.
 * States: 'boot' | 'loading' | 'menu' | 'playing' | 'paused' | 'ended'
 */
export class Game {
  constructor(gameRoot, uiRoot, params = new URLSearchParams()) {
    this.gameRoot = gameRoot;
    this.uiRoot = uiRoot;
    this.params = params;

    this.events = new Events();
    this.settings = new Settings();
    if (params.get('quality')) this.settings.data.quality = params.get('quality');
    else if (params.has('autotest')) this.settings.data.quality = 'high';   // harness runs: no GPU-dependent 'auto' pick
    /** Active preset (a QUALITY_PRESETS entry); _initRenderer resolves the setting ('auto' too) once the GPU is known. */
    this.quality = QUALITY_PRESETS.high;

    this.state = 'boot';
    /** Simulation time in seconds (advances only while the match simulates, scaled by timeScale). */
    this.time = 0;
    this.realTime = 0;
    this.timeScale = 1;
    this.frame = 0;
    this.fps = 60;
    /** All damageable entities (player + bots) in the current match. */
    this.entities = [];
    this._nextEntityId = 1;
    /** id -> entity of `entities` (getEntityById). */
    this._byId = new Map();
    /** Current match state (see startMatch) or null. */
    this.match = null;
    this.lastMatchConfig = null;
    /** Map registry (array of map definitions). */
    this.maps = MAPS;

    // test / debug modes
    this.spectate = params.has('spectate');
    this.fixedCam = params.get('cam') ? params.get('cam').split(',').map(Number) : null;

    this._initRenderer();

    // Subsystems. Constructors must not touch other subsystems (they may not exist yet).
    this.input = new Input(this, this.renderer.domElement);
    this.audio = new AudioSystem(this);
    this.combat = new Combat(this);
    this.effects = new Effects(this);
    this.world = new World(this);
    this.projectiles = new Projectiles(this);
    this.player = new Player(this);
    this.weapons = new WeaponSystem(this);
    this.bots = new BotManager(this);
    this.modes = new Modes(this);
    this.hud = new HUD(this);
    this.menu = new Menu(this);
    /** Multiplayer session (offline until the player hosts or joins; see net/NetSession.js). */
    this.net = new NetSession(this);
    this.autotest = params.has('autotest') ? new AutoTest(this, params) : null;

    // online frame pacing: rAF interval (render rate) vs simulation frames driven by the HostTicker Worker
    this._lastRafMs = 0;
    this._lastFrameEndMs = 0;
    this._rafIntervalEma = 16.7;
    /** Simulation frames per second (online the host keeps >= 60 even when it renders slower). */
    this.simHz = 60;
    /** Online: the non-pausing match menu is open. */
    this._matchMenu = false;
    this._deferredQuality = false;

    this._frameErrors = new Map();
    this._menuT = 0;
    this._endTimer = 0;
    this._spectateTarget = null;
    this._loop = this._loop.bind(this);
    this._bindGlobalEvents();
  }

  // ================================================================== setup

  _initRenderer() {
    // The canvas is neither multisampled nor depth buffered: every frame renders into the composer's HDR target (with
    // its own MSAA and depth) and the canvas only receives the output pass's fullscreen triangle.
    const renderer = new THREE.WebGLRenderer({ antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' });
    this.renderer = renderer;
    /** Graphics adapter: {renderer, vendor, name, kind: 'discrete'|'integrated'|'apple'|'software'|'unknown'}. */
    this.gpu = detectGpu(renderer.getContext());
    this.quality = resolveQuality(this.settings.get('quality'), this.gpu);
    renderer.setPixelRatio(this._renderPixelRatio());
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    // AgX: smooth highlight roll-off and no hue skew in saturated light (ACES pushed reds to magenta and clipped hard);
    // TONE_EXPOSURE / TONE_SATURATION keep the maps' tuned brightness and colour (see _applyExposure, _setupComposer)
    renderer.toneMapping = THREE.AgXToneMapping;
    renderer.toneMappingExposure = TONE_EXPOSURE;
    renderer.shadowMap.enabled = this.quality.shadows;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.autoClear = false;
    renderer.info.autoReset = false;
    renderer.domElement.tabIndex = 0;
    this.gameRoot.appendChild(renderer.domElement);
    /** 'Low latency mode' (settings.lowLatency): caps the frames in flight on the GPU (2 or 3, automatic), see FrameLimiter. */
    this.frameLimiter = new FrameLimiter(renderer.getContext());
    this.frameLimiter.setEnabled(this.settings.get('lowLatency') !== false);

    const aspect = window.innerWidth / window.innerHeight;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, aspect, 0.05, 700);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    // Viewmodel layer: rendered after the world with a cleared depth buffer (no wall clipping).
    // viewCamera copies the world camera transform every frame; WeaponSystem parents its
    // viewmodel to viewCamera, so lights/environment work in world space.
    this.viewScene = new THREE.Scene();
    this.viewCamera = new THREE.PerspectiveCamera(VIEW_FOV, aspect, 0.01, 20);
    this.viewCamera.rotation.order = 'YXZ';
    this.viewScene.add(this.viewCamera);
    this.viewHemi = new THREE.HemisphereLight(0xdde8ff, 0x3a3228, 1.0);
    this.viewSun = new THREE.DirectionalLight(0xffffff, 2.0);
    this.viewScene.add(this.viewHemi, this.viewSun, this.viewSun.target);

    this._setupComposer();
    this._applyExposure();
    window.addEventListener('resize', () => this._onResize());
  }

  /**
   * Create or reconfigure the composer for the active preset: layers pass (world, then the viewmodel over a cleared
   * depth buffer; one MSAA resolve) -> bloom (presets with bloom) -> output pass (adds the bloom, exposure, ACES tone
   * mapping, sRGB) to the canvas. Every preset renders through it, so colour and tone mapping are identical on all of
   * them. A preset change only sets the MSAA sample count (the target is re-allocated lazily) and adds or disposes the
   * bloom pass: nothing leaks and no material program changes.
   */
  _setupComposer() {
    const q = this.quality;
    const r = this.renderer;
    let composer = this.composer;
    if (!composer) {
      const size = r.getDrawingBufferSize(new THREE.Vector2());
      // resolveDepthBuffer false: nothing samples the resolved depth, so each MSAA resolve copies colour only
      const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: q.msaa, resolveDepthBuffer: false });
      rt.texture.name = 'Kinetic.frame';
      composer = new EffectComposer(r, rt);
      // No pass swaps buffers (the layers and bloom passes have needsSwap false, the output pass writes to the
      // canvas), so the frame lives in readBuffer for good. Make that renderTarget1 (the target warmup() compiles
      // into); renderTarget2 then stays unused and is never allocated on the GPU.
      composer.swapBuffers();
      /** World + viewmodel layers (Game.render toggles its viewEnabled). */
      this.layersPass = new SceneLayersPass(this.scene, this.camera, this.viewScene, this.viewCamera);
      this.outputPass = new KineticOutputPass();
      this.outputPass.uniforms.saturation.value = TONE_SATURATION;
      composer.addPass(this.layersPass);
      composer.addPass(this.outputPass);
      this.composer = composer;
    } else if (composer.renderTarget1.samples !== q.msaa) {
      for (const rt of [composer.renderTarget1, composer.renderTarget2]) {
        rt.samples = q.msaa;
        rt.dispose();   // frees the GPU buffers; three re-creates them with the new sample count on next use
      }
    }
    if (q.bloom && !this.bloomPass) {
      const size = r.getDrawingBufferSize(new THREE.Vector2());
      this.bloomPass = new KineticBloomPass(size.x, size.y);
      composer.insertPass(this.bloomPass, composer.passes.indexOf(this.outputPass));
    } else if (!q.bloom && this.bloomPass) {
      composer.removePass(this.bloomPass);
      this.bloomPass.dispose();
      this.bloomPass = null;
    }
    composer.setSize(window.innerWidth, window.innerHeight);
    composer.setPixelRatio(r.getPixelRatio());
    this._applyBloomSettings();
  }

  /** Drawing-buffer pixel ratio for the active preset, the window size and the Render scale setting. */
  _renderPixelRatio() {
    return presetPixelRatio(this.quality, window.devicePixelRatio || 1, window.innerWidth, window.innerHeight,
      this._numSetting('renderScale', 0.5, 1, 1));
  }

  _onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    const r = this.renderer;
    const pr = this._renderPixelRatio();
    if (r.getPixelRatio() !== pr) r.setPixelRatio(pr);
    r.setSize(w, h);
    this.camera.aspect = w / h;
    this.viewCamera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.viewCamera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(pr);
      this.composer.setSize(w, h);
    }
    this.events.emit('resize', { width: w, height: h });
  }

  _bindGlobalEvents() {
    this.events.on('death', e => this._onDeath(e));

    // Online there is no pause: losing the pointer lock, Esc / P and hiding the tab open the match menu while the match
    // keeps running (pause() / resume() map to openMatchMenu() / closeMatchMenu()).
    this.input.onLockChange(locked => {
      if (locked && this.net.client && this.net.client.awaitingDeploy) this.net.client.sendDeploy();
      if (!locked && this.state === 'playing' && !this.autotest && !this.input.lockUnavailable && !this._matchMenu) this.pause();
    });

    window.addEventListener('keydown', e => {
      if (this.state !== 'playing' || (this.net.online && this._matchMenu)) return;   // the menu's own Esc closes it
      if ((e.code === 'Escape' || e.code === 'KeyP') && !this.input.locked) this.pause();
      else if (e.code === 'KeyP') { this.input.exitLock(); this.pause(); }
    });

    this.renderer.domElement.addEventListener('click', () => {
      // No lockUnavailable gate: a click is a real gesture, so always retry (a success clears the flag).
      if (this.state === 'playing' && !this.input.locked && !this.autotest) {
        this.input.requestLock();
      }
      this.net.onCanvasClick();
    });

    this.settings.onChange((key, value) => {
      // a preset switch can stall the tab for most of a second: the host waits for the end of the match
      if (key === 'quality' && this.net.isHost && this.match && !this.match.over) this._deferredQuality = true;
      else if (key === 'quality') this._applyQualitySetting();
      else if (key === 'renderScale') this._onResize();
      else if (key === 'lowLatency') this.frameLimiter.setEnabled(value !== false);
      else if (key === 'masterVolume') this.audio.setMasterVolume(value);
      else if (key === 'musicVolume') this.audio.setMusicVolume(value);
      else if (key === 'glow') this._applyBloomSettings();
      else if (key === 'brightness') this._applyExposure();
      else if (key === 'enemyOutline') this.bots.outlines.setEnabled(value !== false);
      else if (key === 'outlineColor') this.bots.outlines.setColor(value);
      else if (key === 'playerColor' && this.match && !isTeamMode(this.match.mode)) this.player.color.set(value);
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing' && !this.autotest) {
        this.input.exitLock();
        this.pause();   // online: the match menu (the HostTicker keeps the hidden tab simulating)
      }
    });
  }

  /** Initialise subsystems, start the loop and show the main menu (or run the autotest). */
  async boot() {
    this.state = 'loading';
    for (const sys of [this.audio, this.effects, this.world, this.projectiles, this.player, this.weapons, this.bots, this.hud, this.menu]) {
      if (typeof sys.init === 'function') await sys.init();
    }
    this.net.init();
    this.audio.setMasterVolume(this.settings.get('masterVolume'));
    this.audio.setMusicVolume(this.settings.get('musicVolume'));
    requestAnimationFrame(this._loop);

    if (this.autotest) {
      this.state = 'menu';
      await this.autotest.start();
      return;
    }

    this.audio.playMusic('menu');   // over the backdrop load (in a browser it starts with the first click or key)

    // Load the last played map as an animated backdrop behind the main menu.
    const def = getMap(this.settings.get('map')) || MAPS[0];
    this.menu.showLoading(`Loading ${def.name}`, 0);
    await nextFrame();
    try {
      await this.world.load(def, { onProgress: (p, label) => this.menu.showLoading(label || `Loading ${def.name}`, p) });
      this._syncViewLighting();
      await this.warmup();
    } catch (err) {
      console.error('[game] failed to load backdrop map', err);
    }
    this.menu.hideLoading();
    this.state = 'menu';
    this.hud.show(false);
    this.menu.showMain();
    if (this.net.pendingJoin && this.menu.net) this.menu.net.showHub({ join: this.net.pendingJoin });
  }

  // ================================================================== match flow

  /**
   * Start a match. Must be called from a user gesture (so pointer lock can be requested).
   * @param {object} options { mapId, mode:'ffa'|'tdm', botCount, difficulty, scoreLimit, timeLimit (minutes, 0 = none), arsenal ({weaponId: 'off'|'rare'|'normal'|'common'}),
   *                         pool ({weapons, slots, ammo, grenades}: the spawn weapon pool, weapons/Loadout.js) }
   *                         missing values come from settings.
   */
  async startMatch(options = {}) {
    if (this._starting) return;
    this._starting = true;
    try {
      await this._startMatch(options);
    } finally {
      this._starting = false;
    }
  }

  async _startMatch(options) {
    const s = this.settings;
    const def = getMap(options.mapId ?? s.get('map')) || MAPS[0];
    const cfg = {
      mapId: def.id,
      mode: options.mode ?? s.get('mode'),
      botCount: clamp(Math.round(options.botCount ?? s.get('bots')), 0, 15),
      difficulty: options.difficulty ?? s.get('difficulty'),
      scoreLimit: Math.max(0, Math.round(options.scoreLimit ?? s.get('scoreLimit'))),
      timeLimit: Math.max(0, options.timeLimit ?? s.get('timeLimit')),
      arsenal: options.arsenal ?? s.get('botArsenal'),   // bot spawn weapons, normalised by the AI (BotConfig.resolveArsenal)
      pool: freezePool(options.pool ?? s.get('loadoutPool')),   // spawn weapon pool (match rule): sanitised, frozen, plain JSON
    };
    this.lastMatchConfig = { ...cfg };

    this.audio.unlock();
    if (!this.autotest) {
      this.input.requestLock();
      this.audio.stopMusic(1.2);
      this.audio.preloadMusic(['victory', 'defeat']);   // decoded while the map loads: the end sting starts on time
    }
    this.state = 'loading';
    this.input.enabled = false;
    this.hud.show(false);
    this.menu.showLoading(`Loading ${def.name}`, 0);
    this._clearMatch();
    await nextFrame();

    try {
      if (this.world.mapId !== def.id) {
        await this.world.load(def, { onProgress: (p, label) => this.menu.showLoading(label || `Loading ${def.name}`, p) });
      } else {
        this.world.reset();
      }
      this._syncViewLighting();
      await this.bots.prepare(this.world);
    } catch (err) {
      console.error('[game] failed to load map', err);
      this.menu.hideLoading();
      this.quitToMenu();
      return;
    }

    this.match = {
      ...cfg,
      mapName: def.name,
      timeLeft: cfg.timeLimit > 0 ? cfg.timeLimit * 60 : Infinity,
      teamScores: { 1: 0, 2: 0 },
      over: false,
      reason: null,
      winner: null,     // entity (FFA)
      winnerTeam: 0,    // team id (TDM), 0 = draw
      playerWon: false,
      results: null,
      startTime: this.time,
    };

    this.player.reset();
    this.player.name = s.get('playerName') || 'Player';
    if (!this.spectate) this.addEntity(this.player);
    this.player.team = isTeamMode(cfg.mode) ? TEAM_BLUE : this.player.id;
    // team modes keep the team colour (sides stay readable); otherwise the player's own colour (settings.playerColor)
    this.player.color.set(isTeamMode(cfg.mode) ? TEAM_COLORS[TEAM_BLUE] : (s.get('playerColor') || PLAYER_COLOR));

    this.bots.spawnBots(cfg.botCount, cfg.difficulty, cfg.mode);
    this.weapons.onMatchStart();
    for (const e of this.entities) {
      e.kills = 0;
      e.deaths = 0;
      e.streak = 0;
      e.tier = 0;
      e.zoneTime = 0;
    }
    this.modes.onMatchStart(this.match);   // Escalation ladder / King of the Hill zones (before anyone spawns)
    for (const e of this.entities) this.respawnEntity(e);

    if (!this.autotest) {
      s.set('map', cfg.mapId);
      s.set('mode', cfg.mode);
      s.set('bots', cfg.botCount);
      s.set('difficulty', cfg.difficulty);
    }

    await this.warmup(true);
    this.hud.onMatchStart(this.match);
    // first paint of the HUD (and the scope overlay) while the loading screen still covers it, not in the first frames
    if (!this.spectate && !this.fixedCam && typeof this.hud.prewarm === 'function') await this.hud.prewarm();
    this.menu.hideLoading();
    this.menu.hide();
    this.hud.show(!this.spectate && !this.fixedCam);
    this.state = 'playing';
    this.input.enabled = true;
    this.input.capture = true;
    this.audio.play('match_start');
    this.events.emit('match:start', this.match);
  }

  /**
   * Compile every shader program the scenes will draw (world, pooled fx/projectiles/grapple, bots, all viewmodels)
   * and wait until the driver has linked them, so the first playing frame and first-use effects never hitch.
   * Must run with the loading overlay up, after the map, bots and view lighting exist (lights, fog and
   * environment are part of the program key). Programs are keyed on the render target, so compile into the
   * composer target when there is one (that is what the frame draws into), otherwise the screen.
   *
   * It also compiles the objects that subsystems otherwise create lazily mid-match (`prewarmObjects()` of
   * projectiles / bots / effects: special grenade models, spare bot weapons, hit-flash materials, gibs; added to the
   * scenes as a hidden group for the compile only) and finishes every program's lazy setup (see _prefetchPrograms).
   * With `drawView` (match start) it also uploads every texture and draws one frame with every hidden / off-screen
   * object visible (buffers, VAOs and the driver's per-draw state), all behind the loading overlay.
   * @param {boolean} [drawView=false] also draw one composer frame that includes the viewmodel pass (match start
   *        only: the loading overlay hides it; in the menu the viewmodel would flash for a frame)
   * @returns {Promise<void>}
   */
  async warmup(drawView = false) {
    const r = this.renderer;
    // three.js checks a program's link / compile logs on its first use with synchronous GL queries that wait for the
    // whole GPU queue (70-160 ms mid-match at 1440p). Keep the check on for the programs made here - their first use
    // is forced below, behind the loading overlay - and off afterwards, except for test / debug runs (?autotest,
    // ?debug) where shader errors must surface as console errors.
    r.debug.checkShaderErrors = true;
    const extra = this._addPrewarmObjects();
    try {
      r.setRenderTarget(this.composer ? this.composer.renderTarget1 : null);
      const jobs = [r.compileAsync(this.scene, this.camera), r.compileAsync(this.viewScene, this.viewCamera)];
      r.setRenderTarget(null); // compile() creates the programs synchronously, only the link wait is async
      const cap = new Promise(resolve => setTimeout(resolve, 20000));
      await Promise.race([Promise.all(jobs), cap]);
      this._prefetchPrograms();
      if (drawView) {
        this._initSceneTextures();
        this._drawEverythingOnce();
      }
      for (const g of extra) { g.removeFromParent(); g.clear(); }
      extra.length = 0;
      // One real composer frame: the driver finishes shadow-depth/bloom/output programs, buffers and pipeline
      // state on first draw, not on compile (the first viewmodel draw alone cost ~0.6 s).
      this._warming = drawView;
      await nextFrame();
      this._warming = false;
      this._prefetchPrograms();
    } catch (err) {
      this._warming = false;
      r.setRenderTarget(null);
      console.warn('[game] shader warm-up failed', err);
    } finally {
      for (const g of extra) { g.removeFromParent(); g.clear(); }
      if (!this.params.has('autotest') && !this.params.has('debug')) r.debug.checkShaderErrors = false;
    }
  }

  /**
   * Temporarily add the subsystems' `prewarmObjects()` ({world?: Object3D[], view?: Object3D[]}) to the world scene /
   * view camera, in hidden groups: compile() includes hidden objects, a normal frame does not draw them (warmup may run
   * mid-match after a quality change, without the loading overlay) and _drawEverythingOnce reveals them.
   * @returns {THREE.Group[]} the holder groups (Game.warmup removes them)
   */
  _addPrewarmObjects() {
    const groups = [];
    for (const sys of [this.projectiles, this.bots, this.effects, this.net]) {
      if (!sys || typeof sys.prewarmObjects !== 'function') continue;
      let set = null;
      try {
        set = sys.prewarmObjects();
      } catch (err) {
        console.warn('[game] prewarmObjects failed', err);
      }
      if (!set) continue;
      for (const [key, parent] of [['world', this.scene], ['view', this.viewCamera]]) {
        const list = set[key];
        if (!list || !list.length) continue;
        const g = new THREE.Group();
        g.name = 'prewarm';
        g.visible = false;
        for (const o of list) g.add(o);
        parent.add(g);
        groups.push(g);
      }
    }
    return groups;
  }

  /**
   * Run every compiled program's lazy first-use setup now (uniform / attribute location queries and, while
   * checkShaderErrors is on, the log checks): mid-match these synchronous GL queries wait behind the whole GPU queue.
   * Uses three.js r169 internals (renderer.info.programs holds WebGLProgram objects); typeof-guarded so a three.js
   * upgrade degrades to a no-op instead of throwing.
   */
  _prefetchPrograms() {
    const programs = this.renderer.info.programs;
    if (!Array.isArray(programs)) return;
    for (const p of programs) {
      if (typeof p.getUniforms === 'function') p.getUniforms();
      if (typeof p.getAttributes === 'function') p.getAttributes();
    }
  }

  /** Upload every texture used by a material in either scene (pooled effect atlases, hidden models) now. */
  _initSceneTextures() {
    const r = this.renderer;
    const seen = new Set();
    const tex = v => {
      if (!v || !v.isTexture || v.isRenderTargetTexture || v.image == null || seen.has(v)) return;
      seen.add(v);
      r.initTexture(v);
    };
    const visit = o => {
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : null;
      if (!mats) return;
      for (const m of mats) {
        if (!m || seen.has(m)) continue;
        seen.add(m);
        for (const k in m) { const v = m[k]; if (v && v.isTexture) tex(v); }
        if (m.uniforms) for (const k in m.uniforms) { const u = m.uniforms[k]; if (u) tex(u.value); }
      }
    };
    this.scene.traverse(visit);
    this.viewScene.traverse(visit);
  }

  /**
   * Render one frame with every hidden or off-screen object in both scenes visible (pooled projectiles and effects,
   * all viewmodels, the grenade hand, muzzle flashes, prewarm objects): their first draw uploads vertex buffers,
   * creates VAOs and makes the driver build its per-draw state now, behind the loading overlay, instead of the first
   * time each appears in play. Lights keep their visibility (the light set is part of every program key), and so
   * does anything with a light inside it.
   */
  _drawEverythingOnce() {
    const hidden = [], culled = [];
    const hasLight = o => { let f = false; o.traverse(c => { if (c.isLight) f = true; }); return f; };
    const reveal = o => {
      if (!o.visible && !o.isLight && !hasLight(o)) { o.visible = true; hidden.push(o); }
      if (o.frustumCulled && (o.isMesh || o.isPoints || o.isLine || o.isSprite)) { o.frustumCulled = false; culled.push(o); }
    };
    this.scene.traverse(reveal);
    this.viewScene.traverse(reveal);
    const warming = this._warming;
    this._warming = true;
    try {
      this.render();
    } catch (err) {
      console.warn('[game] warm-up draw failed', err);
    } finally {
      this._warming = warming;
      for (const o of hidden) o.visible = false;
      for (const o of culled) o.frustumCulled = true;
    }
  }

  restartMatch() {
    if (this.net.isHost) { this.net.rematch(); return; }
    if (this.net.isClient) return;   // only the host restarts an online match
    if (this.lastMatchConfig) this.startMatch({ ...this.lastMatchConfig });
  }

  /** End the match (score/time limit reached). Plays a short slow-motion outro, then the end screen. */
  endMatch(reason = 'score') {
    const m = this.match;
    if (!m || m.over) return;
    m.over = true;
    m.reason = reason;
    m.results = this.getScoreboard();
    if (isTeamMode(m.mode)) {
      const b = m.teamScores[1] || 0, r = m.teamScores[2] || 0;
      m.winnerTeam = b === r ? 0 : b > r ? 1 : 2;
      m.winnerId = 0;
      m.playerWon = m.winnerTeam === this.player.team;
    } else {
      const ladder = this.modes.pickWinner(m);
      const order = this.entities.slice().sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
      m.winner = ladder || order[0] || null;
      // online free-for-all: a tie for first place is a draw (every machine works out "did I win" from winnerId)
      if (this.net.online && !ladder && order[1] && order[0].kills === order[1].kills && order[0].deaths === order[1].deaths) {
        m.winner = null;
        m.draw = true;
      }
      m.winnerId = m.winner ? m.winner.id : 0;
      m.playerWon = m.winner === this.player;
    }
    this.state = 'ended';
    if (!this.net.online) this.timeScale = 0.25;   // the slow-motion outro is single player only (no global time online)
    this._endTimer = this.net.online ? NET.OUTRO_S : 2.2;
    this.input.enabled = false;
    this.audio.play('match_end');
    this.events.emit('match:end', m);
  }

  _showEndScreen() {
    this.timeScale = 1;
    this._matchMenu = false;
    if (this._deferredQuality) { this._deferredQuality = false; this._applyQualitySetting(); }
    this.audio.stopAllLoops(); // the sim is frozen from here on: nothing would ever silence a slide / grapple-reel loop
    if (!this.autotest) this.audio.playMusic(this.match && this.match.playerWon ? 'victory' : 'defeat', { loop: false, fadeIn: 0.05 });
    this.input.capture = false;
    this.input.exitLock();
    this.hud.show(false);
    this.menu.showEnd(this.match);
  }

  pause() {
    if (this.net.online) { this.openMatchMenu(); return; }
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.enabled = false;
    this.input.capture = false;
    this.input.clearAll();
    this.menu.showPause();
    this.events.emit('game:pause');
  }

  resume() {
    if (this.net.online) { this.closeMatchMenu(); return; }
    if (this.state !== 'paused') return;
    this.input.requestLock();
    this.state = 'playing';
    this.input.enabled = true;
    this.input.capture = true;
    this.menu.hide();
    this.events.emit('game:resume');
  }

  /**
   * Online: the non-pausing match menu (Esc, lost pointer lock, hidden tab). The match keeps running; input is off
   * until it closes. Idempotent.
   */
  openMatchMenu() {
    if (this._matchMenu || this.state !== 'playing') return;
    this._matchMenu = true;
    this.input.enabled = false;
    this.input.capture = false;
    this.input.clearAll();
    this.menu.showPause();
  }

  /** Close the match menu (Resume / Esc). A click is a gesture and relocks the pointer; after Esc CLICK TO PLAY shows. */
  closeMatchMenu() {
    if (!this._matchMenu) return;
    this._matchMenu = false;
    this.input.requestLock();
    this.input.enabled = this.net.status !== 'reconnecting';
    this.input.capture = true;
    this.menu.hide();
  }

  quitToMenu() {
    if (this.net.online && !this.net.ending) {
      this.net.leave('left');   // ends the session, which calls back here
      return;
    }
    this._clearMatch();
    this.player.reset();
    this.player.alive = false;
    this.weapons._resetState();
    this.audio.stopAllLoops();
    this._matchMenu = false;
    this.state = 'menu';
    this.input.enabled = false;
    this.input.capture = false;
    this.input.exitLock();
    this.hud.show(false);
    this.menu.showMain();
    if (!this.autotest) this.audio.playMusic('menu');
    this.events.emit('game:menu');
  }

  _clearMatch() {
    this.net.onClearMatch();   // remote players / proxies go first (their models sit in the shared bot batches)
    this.modes.clear();
    this.bots.clear();
    this.projectiles.clear();
    this.effects.clear();
    this.entities.length = 0;
    this._byId.clear();
    this.match = null;
    this.timeScale = 1;
    this._endTimer = 0;
    this._spectateTarget = null;
  }

  // ================================================================== online match lifecycle (net/)

  /**
   * Online: load the match's map (the host from net.start() inside the Start click, so the pointer lock request
   * works; clients on 'load'). Never writes settings. After every await it stops if the session or the match epoch
   * changed meanwhile (left, kicked, host gone, a rematch started).
   * @param {object} cfg frozen match config from the host
   * @returns {Promise<boolean>} true when loaded and still wanted
   */
  async netLoadMatch(cfg) {
    const net = this.net;
    const epoch = net.epoch, gen = net.sessionGen;
    const stale = () => epoch !== net.epoch || gen !== net.sessionGen;
    const def = getMap(cfg && cfg.mapId) || MAPS[0];
    this.audio.unlock();
    if (!this.autotest) {
      if (net.isHost) this.input.requestLock();
      this.audio.stopMusic(1.2);
      this.audio.preloadMusic(['victory', 'defeat']);
    }
    this._matchMenu = false;
    this.state = 'loading';
    this.input.enabled = false;
    this.hud.show(false);
    this.menu.showLoading(`Loading ${def.name}`, 0);
    this._clearMatch();
    this.player.reset();
    this.player.alive = false;
    this.weapons._resetState();
    this.audio.stopAllLoops();
    await nextFrame();
    if (stale()) return false;
    let lastProg = 0;
    const onProgress = (pr, label) => {
      this.menu.showLoading(label || `Loading ${def.name}`, pr);
      const now = performance.now();
      if (net.isClient && now - lastProg > 1000 / NET.PROGRESS_HZ) {
        lastProg = now;
        net.send({ k: 'prog', p: Math.round(pr * 100) / 100, vis: document.hidden ? 'hidden' : 'visible' });
      }
    };
    try {
      if (this.world.mapId !== def.id) await this.world.load(def, { onProgress });
      else this.world.reset();
      if (stale()) return false;
      this._syncViewLighting();
      if (net.authority) await this.bots.prepare(this.world);
      if (stale()) return false;
      await this.warmup(true);
      if (stale()) return false;
      if (!this.spectate && !this.fixedCam && typeof this.hud.prewarm === 'function') await this.hud.prewarm();
      if (stale()) return false;
    } catch (err) {
      console.error('[game] failed to load the match map', err);
      if (!stale()) net.leave('failed');
      return false;
    }
    this.menu.showLoading('Waiting for players', 1);
    return true;
  }

  /**
   * Online match start. Clients build the match from the host's 'begin' message `b` (roster, scores, pickups, the own
   * spawn); the host built it already (NetHost.beginMatch) and passes null. Both then run the common tail.
   * @param {object|null} b
   */
  netBeginMatch(b) {
    const net = this.net;
    if (b) {
      const c = net.client;
      const clock = net.clock;
      net.onClearMatch();
      this.entities.length = 0;
      this._byId.clear();
      this.projectiles.clear();
      this.combat.smokes.length = 0;
      this.player.reset();
      c.resetMatchState(b);
      const cfg = b.cfg && typeof b.cfg === 'object' ? b.cfg : {};
      const mm = b.match;
      const ts = mm.teamScores || {};
      this.match = {
        ...cfg,
        mapName: mm.mapName || (getMap(cfg.mapId) || MAPS[0]).name,
        botCount: mm.botCount ?? cfg.botCount ?? 0,
        scoreLimit: mm.scoreLimit ?? cfg.scoreLimit ?? 0,
        timeLeft: typeof mm.timeLeft === 'number' && mm.timeLeft >= 0 ? mm.timeLeft : Infinity,
        teamScores: { 1: ts[1] | 0, 2: ts[2] | 0 },
        over: false, reason: null, winner: null, winnerId: 0, winnerTeam: 0, playerWon: false, results: null, draw: false,
        startTime: clock.netToLocalGame(this, mm.startT),
        phase: mm.phase === 'live' ? 'live' : 'countdown',
        liveAtNet: Number(mm.liveAt) || 0,
        liveAt: clock.netToLocalGame(this, Number(mm.liveAt) || 0),
        online: true,
        epoch: net.epoch,
        ladder: Array.isArray(mm.ladder) ? mm.ladder : undefined,
        departed: [],
      };
      if (!Number.isFinite(this.match.startTime)) this.match.startTime = this.time;
      const p = this.player;
      const mine = b.roster.find(r => r && r.id === b.you);
      if (mine) {
        p.name = String(mine.name || p.name);
        p.team = mine.team | 0;
        p.color.set(mine.color | 0);
      }
      p.netPeer = net.me.peer;
      p.netHost = false;
      p.isProxy = false;
      this.addEntity(p, b.you | 0);
      net.me.entityId = p.id;
      const ents = new Map();
      for (const e of b.ents || []) if (e && typeof e.id === 'number') ents.set(e.id, e);
      for (const row of b.roster) if (row && row.id !== b.you) c.addAvatar(row, ents.get(row.id));
      this.weapons.onMatchStart();
      const own = ents.get(b.you);
      p.kills = own ? own.kills | 0 : 0;
      p.deaths = own ? own.deaths | 0 : 0;
      p.streak = own ? own.streak | 0 : 0;
      p.tier = own ? own.tier | 0 : 0;
      p.zoneTime = own ? own.zoneTime || 0 : 0;
      const pk = this.world.pickups && this.world.pickups.list;
      if (pk && Array.isArray(b.pickups)) {
        for (const q of b.pickups) {
          const item = q && pk[q.id];
          if (!item) continue;
          item.available = !!q.available;
          item.nextRespawn = q.available ? 0 : clock.netToLocalGame(this, fromWireTime(q.nr));
        }
      }
      if (b.spawn) c.applyLocalSpawn(b.spawn, b.at);
      else {
        p.alive = false;
        c.awaitingDeploy = !!b.deploy;
        if (c.awaitingDeploy) {
          this.hud.announce('CLICK TO DEPLOY', 'The match is running', 'info', 5000);
          if (this.autotest) setTimeout(() => c.sendDeploy(), 500);
          else if (this.input.locked) c.sendDeploy();
        }
      }
      c.inMatchEpoch = b.e & 255;
      net._publishTest();
    }
    // tail (both roles)
    this._matchMenu = false;
    this.hud.onMatchStart(this.match);
    this.menu.hideLoading();
    this.menu.hide();
    this.hud.show(!this.spectate && !this.fixedCam);
    this.state = 'playing';
    this.input.enabled = true;
    this.input.capture = true;
    this.audio.play('match_start');
    this.events.emit('match:start', this.match);
  }

  /** Client: the host ended the match ('end'): results with ids, winner per this machine, the outro. */
  netApplyMatchEnd(msg) {
    const m = this.match;
    const c = this.net.client;
    if (!m || m.over || !c) return;
    const me = this.player.id;
    const mark = r => ({ ...r, isLocal: r.id === me, isPlayer: r.id === me });
    m.over = true;
    m.reason = msg.reason || null;
    m.winnerId = msg.winnerId | 0;
    m.winnerTeam = msg.winnerTeam | 0;
    const ts = msg.teamScores || {};
    m.teamScores = { 1: ts[1] | 0, 2: ts[2] | 0 };
    c.scoreAt = Math.max(c.scoreAt, Number(msg.at) || 0);
    m.results = Array.isArray(msg.results) ? msg.results.map(mark) : this.getScoreboard();
    m.departed = Array.isArray(msg.departed) ? msg.departed.map(mark) : [];
    for (const r of m.results) {
      const e = this.getEntityById(r.id);
      if (e) { e.kills = r.kills | 0; e.deaths = r.deaths | 0; e.tier = r.tier | 0; e.zoneTime = r.zoneTime || 0; }
    }
    m.winner = c.refOf(m.winnerId);
    m.draw = !isTeamMode(m.mode) && !m.winnerId;
    m.playerWon = isTeamMode(m.mode) ? m.winnerTeam !== 0 && m.winnerTeam === this.player.team : !!m.winnerId && m.winnerId === me;
    this.state = 'ended';
    this._endTimer = NET.OUTRO_S;
    this.input.enabled = false;
    this.audio.play('match_end');
    this.events.emit('match:end', m);
  }

  /** Online: everyone back to the lobby (the host's BACK TO LOBBY). The map stays loaded as the backdrop. */
  netReturnToLobby() {
    this._clearMatch();
    this.player.reset();
    this.player.alive = false;
    this.weapons._resetState();
    this.audio.stopAllLoops();
    if (this.net.client) this.net.client.inMatchEpoch = -1;
    this._matchMenu = false;
    this.state = 'menu';
    this.input.enabled = false;
    this.input.capture = false;
    this.input.exitLock();
    this.hud.show(false);
    this.menu.hideLoading();
    if (this.menu.net) this.menu.net.showLobby();
    if (this._deferredQuality) { this._deferredQuality = false; this._applyQualitySetting(); }
    if (!this.autotest) this.audio.playMusic('menu');
  }

  /**
   * NetSession._end: the session is over (left, closed, kicked, failed). Leaves the match, then the menu shows why.
   * @param {string} reason @param {boolean} quiet a failed attempt to host / join (the caller reports it)
   */
  netSessionEnded(reason, quiet) {
    if (this.match || (this.state !== 'menu' && this.state !== 'boot')) this.quitToMenu();
    if (this.menu.net) this.menu.net.onSessionEnded(reason, quiet);
  }

  // ================================================================== entities

  /**
   * Register an entity and assign entity.id: the next free id, or `id` when given (online: ids come from the host;
   * the counter moves past it).
   * @param {object} e
   * @param {number} [id=0]
   */
  addEntity(e, id = 0) {
    if (id > 0) {
      e.id = id;
      if (this._nextEntityId <= id) this._nextEntityId = id + 1;
    } else {
      e.id = this._nextEntityId++;
    }
    if (!this.entities.includes(e)) this.entities.push(e);
    this._byId.set(e.id, e);
    return e;
  }

  removeEntity(e) {
    const i = this.entities.indexOf(e);
    if (i >= 0) this.entities.splice(i, 1);
    if (this._byId.get(e.id) === e) this._byId.delete(e.id);
  }

  getEntityById(id) {
    return this._byId.get(id) || null;
  }

  /** Alive entities hostile to `e`. */
  getEnemiesOf(e) {
    return this.entities.filter(o => o !== e && o.alive && o.team !== e.team);
  }

  respawnEntity(e) {
    const sp = this.pickSpawnPoint(e);
    e.spawn(sp.position.clone(), sp.yaw);
    if (e === this.player) this.weapons.onPlayerSpawn();
    this.events.emit('spawn', { entity: e });
  }

  /** Choose the spawn point that is far from and hidden from enemies. */
  pickSpawnPoint(entity) {
    const spawns = this.world.spawnPoints;
    if (!spawns || spawns.length === 0) return { position: new THREE.Vector3(0, 1, 0), yaw: 0 };
    let best = spawns[0], bestScore = -Infinity;
    for (const sp of spawns) {
      let minEnemy = 70, visible = 0, occupied = false, friends = 0;
      _v2.copy(sp.position);
      _v2.y += 1.6;
      for (const o of this.entities) {
        if (o === entity || !o.alive) continue;
        const d = o.position.distanceTo(sp.position);
        if (d < 1.6) occupied = true;
        if (o.team === entity.team) { if (d < 25) friends++; continue; }
        if (d < minEnemy) minEnemy = d;
        if (d < 50 && this.combat.canSee(o.getEyePosition(_v1), _v2)) visible++;
      }
      let score = minEnemy - visible * 30 - (occupied ? 1000 : 0) + Math.min(friends, 3) * 4 + Math.random() * 14;
      if (sp === entity._lastSpawn) score -= 20;
      score += this.modes.spawnBias(entity, sp);   // King of the Hill: spawn nearer the zone
      if (score > bestScore) { bestScore = score; best = sp; }
    }
    entity._lastSpawn = best;
    return best;
  }

  _onDeath({ victim, attacker, weapon }) {
    const m = this.match;
    if (!m || !this.net.authority) return;   // clients never score: the host's messages carry the results
    victim.deaths++;
    victim.streak = 0;
    if (attacker && attacker !== victim) {
      attacker.kills++;
      attacker.streak++;
      if (m.mode === 'tdm' && attacker.team !== victim.team) {
        m.teamScores[attacker.team] = (m.teamScores[attacker.team] || 0) + 1;
      }
    } else if (weapon !== 'lightning') {
      victim.kills = Math.max(0, victim.kills - 1); // suicide penalty (not for storm strikes)
    }
    try {
      this.modes.onDeath({ victim, attacker, weapon });   // Escalation promotion / King of the Hill kill bonus
    } catch (err) {
      console.error('[game] mode death handling failed', err);   // never block the respawn and the score limit
    }
    victim.respawnAt = this.time + (victim.isBot ? RESPAWN_DELAY.bot : RESPAWN_DELAY.player);
    this._checkScoreLimit();
  }

  _checkScoreLimit() {
    const m = this.match;
    if (!m || m.over || !m.scoreLimit || m.mode === 'escalation') return;   // Escalation ends on a last-tier kill (Modes)
    if (isTeamMode(m.mode)) {
      if ((m.teamScores[1] || 0) >= m.scoreLimit || (m.teamScores[2] || 0) >= m.scoreLimit) this.endMatch('score');
    } else if (this.entities.some(e => e.kills >= m.scoreLimit)) {
      this.endMatch('score');
    }
  }

  /** Rows sorted by kills desc, deaths asc. */
  getScoreboard() {
    return this.entities
      .map(e => ({
        id: e.id, name: e.name, kills: e.kills, deaths: e.deaths, team: e.team,
        isPlayer: !!e.isLocal, isLocal: e === this.player, isBot: !!e.isBot, isHuman: !!e.isHuman,
        alive: e.alive, color: '#' + e.color.getHexString(),
        tier: e.tier | 0, zoneTime: e.zoneTime || 0,
        ping: e.ping | 0, host: !!e.netHost, connected: e.connected !== false, hold: !!e.netHold,
      }))
      .sort((a, b) => b.tier - a.tier || b.kills - a.kills || a.deaths - b.deaths);
  }

  _updateMatch(dt) {
    const m = this.match;
    if (!m) return;
    if (!this.net.authority) { this.net.client.updateMatchClock(dt); return; }
    if (m.phase === 'countdown') return;   // online countdown: no timer, no respawns
    if (!m.over && Number.isFinite(m.timeLeft)) {
      m.timeLeft -= dt;
      if (m.timeLeft <= 0) {
        m.timeLeft = 0;
        this.endMatch('time');
      }
    }
    const killY = this.world.killY ?? -50;
    for (const e of this.entities) {
      if (e.alive) {
        if (e.authPos.y < killY) {
          // shoved off the map (Gale, Kinetic Charge) within 8 s: a ring-out credited to the shover, even when someone
          // else hit the victim in mid-air; otherwise the last attacker of the last 6 s gets the fall
          const sb = e._shovedBy;
          const shover = sb && sb.attacker && sb.attacker !== e && this.time - sb.at < 8 ? sb.attacker : null;
          const recent = e.lastAttacker && this.time - e.lastDamageTime < 6 ? e.lastAttacker : null;
          this.combat.kill(e, { attacker: shover || recent, weapon: shover ? 'ringout' : 'fall' });
        }
      } else if (!m.over && e.respawnAt >= 0 && this.time >= e.respawnAt && !e.netHold) {
        this.respawnEntity(e);
      }
    }
  }

  // ================================================================== settings / quality

  /** Base vertical FOV (degrees) derived from the horizontal FOV setting and aspect ratio. */
  getBaseFov() {
    const h = THREE.MathUtils.degToRad(clamp(this.settings.get('fov'), 60, 130));
    return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(h / 2) / this.camera.aspect));
  }

  /**
   * Switch to a quality preset. Resolution, MSAA, bloom, shadow-map size and the decal / particle budgets apply at
   * once and need no shader work (no material is touched); turning shadows on or off changes the program of every
   * lit material (see presetsNeedRecompile), so those switches mark the scene's materials for a rebuild.
   * @param {string} name a QUALITY_PRESETS key, or 'auto' (preset picked from the GPU)
   * @returns {boolean} true when material programs must be rebuilt (see _applyQualitySetting)
   */
  setQuality(name) {
    const prev = this.quality;
    const q = resolveQuality(name, this.gpu);
    this.quality = q;
    const recompile = presetsNeedRecompile(prev, q);
    this.renderer.shadowMap.enabled = q.shadows;
    if (recompile) {
      this.scene.traverse(o => {
        if (!o.material) return;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.needsUpdate = true;
      });
    }
    if (typeof this.world.applyQuality === 'function') this.world.applyQuality(q);
    this._onResize();        // pixel ratio of the new preset first, so the composer is sized once
    this._setupComposer();
    this.events.emit('quality', q);
    return recompile;
  }

  /**
   * Settings listener for 'quality'. Resolution / MSAA / bloom switches are instant. A switch that rebuilds shaders
   * (shadows on/off) runs behind the loading overlay like a map load: the new programs compile in parallel while no
   * frame is drawn (a frame would block on them), then warmup() finishes them.
   * @returns {Promise<void>}
   */
  async _applyQualitySetting() {
    const name = this.settings.get('quality');
    if (!presetsNeedRecompile(this.quality, resolveQuality(name, this.gpu))) {
      this.setQuality(name);
      return;
    }
    const overlay = this.state !== 'loading' && this.state !== 'boot';
    if (overlay) {
      this._qualityJobs = (this._qualityJobs || 0) + 1;
      this.menu.showLoading('Applying graphics settings', null);
      await nextFrame();   // let the overlay paint before the shader work starts
    }
    try {
      this.setQuality(this.settings.get('quality'));
      const r = this.renderer;
      this._holdRender = true;
      try {
        r.setRenderTarget(this.composer.renderTarget1);   // programs are keyed on the target type (see warmup)
        const jobs = [r.compileAsync(this.scene, this.camera), r.compileAsync(this.viewScene, this.viewCamera)];
        r.setRenderTarget(null);
        await Promise.race([Promise.all(jobs), new Promise(resolve => setTimeout(resolve, 20000))]);
      } finally {
        this._holdRender = false;
      }
      await this.warmup();
    } catch (err) {
      console.error('[game] applying the graphics quality failed', err);
    } finally {
      if (overlay && --this._qualityJobs === 0) this.menu.hideLoading();
    }
  }

  /**
   * What the Settings screen shows about rendering.
   * @returns {{gpu: string, gpuKind: string, renderer: string, quality: string, auto: boolean, width: number,
   *   height: number, nativeWidth: number, nativeHeight: number, msaa: number, lowLatency: boolean}}
   */
  getGraphicsInfo() {
    const gl = this.renderer.getContext();
    const dpr = window.devicePixelRatio || 1;
    return {
      gpu: this.gpu.name, gpuKind: this.gpu.kind, renderer: this.gpu.renderer,
      quality: this.quality.name, auto: !QUALITY_PRESETS[this.settings.get('quality')],
      width: gl.drawingBufferWidth, height: gl.drawingBufferHeight,
      nativeWidth: Math.floor(window.innerWidth * dpr), nativeHeight: Math.floor(window.innerHeight * dpr),   // like the canvas
      msaa: this.quality.msaa, lowLatency: this.frameLimiter.enabled,
    };
  }

  _syncViewLighting() {
    const L = this.world.lighting;
    if (!L) return;
    if (L.hemiSky) this.viewHemi.color.copy(L.hemiSky);
    if (L.hemiGround) this.viewHemi.groundColor.copy(L.hemiGround);
    this.viewHemi.intensity = (L.hemiIntensity ?? 0.8) * 1.15;
    if (L.sunColor) this.viewSun.color.copy(L.sunColor);
    this.viewSun.intensity = L.sunIntensity ?? 2;
    this.viewScene.environment = this.scene.environment;
    this.viewScene.environmentIntensity = L.envIntensity ?? 1;
    this._applyExposure();
    this._applyBloomSettings();
  }

  /** A numeric player setting clamped to [lo, hi] (falls back to `fallback` when it is not a finite number). */
  _numSetting(key, lo, hi, fallback) {
    const v = Number(this.settings.get(key));
    return Number.isFinite(v) ? clamp(v, lo, hi) : fallback;
  }

  /** Tone-mapping exposure = the map's exposure x the player's Brightness setting (applies live). */
  _applyExposure() {
    const L = this.world && this.world.lighting;
    this.renderer.toneMappingExposure = ((L && L.exposure) ?? 1) * this._numSetting('brightness', 0.7, 1.3, 1) * TONE_EXPOSURE;
  }

  /**
   * Bloom = the map's bloom (strength / radius / threshold / knee) with the strength scaled by the player's
   * Glow setting (0..1). At 0 the pass is switched off entirely (no cost, no halos).
   */
  _applyBloomSettings() {
    const bp = this.bloomPass;
    if (!bp) return;
    const b = this.world && this.world.lighting && this.world.lighting.bloom;
    const glow = this._numSetting('glow', 0, 1, 0.65);
    if (b) {
      if (b.strength != null) bp.strength = b.strength * glow;
      if (b.radius != null) bp.radius = b.radius;
      if (b.threshold != null) bp.threshold = b.threshold;
      if (b.knee != null) bp.highPassUniforms.smoothWidth.value = b.knee;
    } else {
      bp.strength = 0.45 * glow;
    }
    bp.enabled = bp.strength > 0.002;
  }

  // ================================================================== loop

  _loop(nowMs) {
    requestAnimationFrame(this._loop);
    // Low latency mode (while playing): if frameLimiter.maxFrames earlier frames are still unfinished on the GPU, this
    // rAF does nothing at all (no input edges consumed, no time advanced); the next frame that runs simulates the
    // skipped time with fresh input. Menus, loading and pause never skip (warmup() relies on the next rAF drawing).
    if (this.state === 'playing' && this.frameLimiter.shouldSkip()) return;
    const t = performance.now();
    // a single long frame (a hitch) must not switch the host to Worker-boosted frames for the next dozen frames
    if (this._lastRafMs) this._rafIntervalEma = this._rafIntervalEma * 0.9 + Math.min(t - this._lastRafMs, 100) * 0.1;
    this._lastRafMs = t;
    // online: one clock for rAF and Worker frames; offline: the rAF timestamp exactly as before
    this._frame(this.net.online ? t : nowMs, true);
  }

  /**
   * HostTicker message (online only, ~60 Hz, also while the tab is hidden): run a simulation + network frame without
   * rendering when rAF frames are missing (hidden tab, stall) or - on the host - slower than ~55 Hz, so snapshots and
   * the other players' view of this machine never depend on its render rate.
   */
  _hostTick() {
    if (!this.net.online) return;
    const now = performance.now();
    const since = now - this._lastFrameEndMs;
    if (since < NET.TICK_COALESCE_MS) return;   // ticks queued behind a stall collapse into one frame
    const stalled = document.hidden || now - this._lastRafMs > NET.RAF_STALL_MS;
    const boost = this.net.isHost && this._rafIntervalEma > NET.HOST_BOOST_RAF_MS && since >= NET.HOST_TICK_MS - 1.5;
    if (stalled || boost) this._frame(now, false);
  }

  /** Run fn, reporting (not throwing) its error: one failing stage never skips the rest of the frame. */
  _guard(fn) {
    try {
      fn();
    } catch (err) {
      this._reportFrameError(err);
    }
  }

  /**
   * One frame: input, network in, simulation (by state), network out, render (rAF frames only), autotest, input end.
   * Offline it is exactly the old loop: rAF timestamp clock, dt <= 50 ms x timeScale, no network work. Online the
   * clock is performance.now(), dt <= 250 ms in <= 50 ms sub-steps (real time for everyone), and the packets of this
   * frame leave before the (possibly slow) render.
   * @param {number} nowMs @param {boolean} render
   */
  _frame(nowMs, render) {
    const net = this.net;
    const online = net.online;
    const now = nowMs / 1000;
    let raw = this._lastFrameTime ? now - this._lastFrameTime : 1 / 60;
    this._lastFrameTime = now;
    if (online) { if (!(raw >= 0)) raw = 0; } else if (!(raw > 0)) raw = 1 / 60;   // online never invents 16.7 ms
    if (raw > 0.25) raw = 0.25;
    this.realTime += raw;
    this.simHz = this.simHz * 0.93 + (1 / Math.max(raw, 1e-3)) * 0.07;
    if (render) {
      this.fps = online ? 1000 / Math.max(1, this._rafIntervalEma) : this.fps * 0.93 + (1 / raw) * 0.07;
      this.renderer.info.reset();
    }
    this.input.update();
    if (online) this._guard(() => net.beginFrame(raw));

    try {
      const dt = online ? Math.min(raw, NET.DT_MAX) : Math.min(raw, 0.05) * this.timeScale;
      switch (this.state) {
        case 'playing':
          this.update(dt);
          break;
        case 'ended':
          if (this._endTimer > 0) {
            this._endTimer -= raw;
            this.update(dt);
            if (this._endTimer <= 0) this._showEndScreen();
          } else {
            this.audio.update(raw); // results screen: keep easing the loop bus (real time)
          }
          break;
        case 'menu':
          this._updateMenu(raw);
          break;
        case 'paused':
        case 'loading':
          this.audio.update(raw); // render only, but the pause muffle / loop-bus duck must keep easing
          break;
        default:
          break;
      }
    } catch (err) {
      this._reportFrameError(err);
    }
    if (online) this._guard(() => net.endFrame(raw));   // snapshots / state / messages leave BEFORE the render
    if (render) {
      this._guard(() => {
        this.render();
        if (this.state === 'playing') this.frameLimiter.frameSubmitted();
      });
    }
    if (this.autotest) this._guard(() => this.autotest.frame(raw, render));
    this.input.endFrame();   // always: a stale press edge never leaks into the next frame
    this.frame++;
    this._lastFrameEndMs = performance.now();
  }

  /**
   * One simulation frame. Order matters - see ARCHITECTURE.md "Frame order". Online, frames longer than 50 ms run the
   * world in up to 5 equal sub-steps (the player and weapons once, with <= 100 ms); offline it is a single step in the
   * same order as always.
   */
  update(dt) {
    const net = this.net;
    const online = net.online;
    const n = online && dt > NET.SUB_STEP_MAX ? Math.min(NET.SUBSTEPS_MAX, Math.ceil(dt / NET.SUB_STEP_MAX - 1e-9)) : 1;
    const h = dt / n;
    const dp = online ? Math.min(dt, NET.PLAYER_DT_MAX) : dt;
    const counting = !!(this.match && this.match.phase === 'countdown');   // online only (offline: no phase)
    for (let i = 0; i < n; i++) {
      this.time += h;
      if (i === 0) {
        if (this.autotest) this.autotest.update(dt);
        if (net.client) net.client.refreshTimes();
        if (!this.spectate) {
          this.player.update(dp);
          this._syncAim();            // shots / throws / melee below use THIS frame's view
          net.fxBegin('weapons');
          this.weapons.update(dp);
          net.fxEnd();
        }
        net.updateRemotes(dt);
      }
      net.simBegin();
      if (net.authority) {
        this.bots.update(h);
        this.combat.update(h);
      }
      this.projectiles.update(h);
      this.world.update(h);
      if (!counting) this.modes.update(h);
      net.simEnd();
      if (i === n - 1) this.effects.update(dt);
      this._updateMatch(h);
    }
    this._updateCamera(dt);
    this.weapons.updateViewModel(dt);
    this.audio.update(dt);
    this.hud.update(dt);
  }

  _updateMenu(dt) {
    this._menuT += dt;
    this.world.update(dt);
    this.effects.update(dt);
    this._updateOverviewCamera(0);
    this.audio.update(dt);
  }

  /** Slow orbit over the map (menu backdrop; online: a late joiner before deploying). */
  _updateOverviewCamera(dt) {
    if (dt) this._menuT += dt;
    const def = this.world.def;
    const pc = def && def.previewCamera;
    if (pc) {
      const target = _v1.fromArray(pc.lookAt);
      const off = _v2.fromArray(pc.pos).sub(target);
      off.applyAxisAngle(_up, Math.sin(this._menuT * 0.06) * 0.4);
      this.camera.position.copy(target).add(off);
      this.camera.lookAt(target);
    } else {
      const b = this.world.bounds;
      const c = b ? b.getCenter(_v1) : _v1.set(0, 0, 0);
      const r = b ? b.getSize(_v2).length() * 0.35 : 40;
      const a = this._menuT * 0.05;
      this.camera.position.set(c.x + Math.cos(a) * r, c.y + r * 0.45, c.z + Math.sin(a) * r);
      this.camera.lookAt(c);
    }
    this.camera.fov = this.getBaseFov();
    this.camera.updateProjectionMatrix();
  }

  /**
   * Aim sync (frame order step 2b, between player.update and weapons.update): the world camera and the viewmodel
   * camera take this frame's look - yaw / pitch after this frame's mouse input, with the rig offsets (shake, roll,
   * bob, landing dip) shown last frame - so a flick and a click in the same frame fire / throw / bash along the new
   * view instead of last frame's. _updateCamera() still builds the full camera pose after the simulation. Only the
   * two camera nodes are updated here (cheap); viewmodel parts refresh on demand (WeaponSystem._muzzleWorld walks
   * up its parent chain).
   */
  _syncAim() {
    if (this.fixedCam) return;
    this.player.syncCameraAim();
    const cam = this.camera, vc = this.viewCamera;
    cam.updateWorldMatrix(true, false);
    vc.position.copy(cam.position);
    vc.quaternion.copy(cam.quaternion);
    vc.updateWorldMatrix(true, false);
  }

  _updateCamera(dt) {
    if (this.net.client && this.net.client.awaitingDeploy && !this.player.alive) {
      this._updateOverviewCamera(dt);
      this._syncViewCamera();
      return;
    }
    if (this.fixedCam) {
      const [x, y, z, yaw = 0, pitch = 0] = this.fixedCam;
      this.camera.position.set(x, y, z);
      this.camera.rotation.set(pitch, yaw, 0, 'YXZ');
      this.camera.fov = this.getBaseFov();
      this.camera.updateProjectionMatrix();
    } else if (this.spectate) {
      this._updateSpectatorCamera(dt);
    } else {
      this.player.updateCamera(dt);
    }
    this._syncViewCamera();
  }

  /** Third-person chase camera on a bot (test / screenshot mode). */
  _updateSpectatorCamera(dt) {
    const bots = this.bots.list;
    if (!this._spectateTarget || !this._spectateTarget.alive) {
      this._spectateTarget = bots.find(b => b.alive) || null;
    }
    const t = this._spectateTarget;
    if (!t) return;
    const fwd = _v1.set(-Math.sin(t.yaw), 0, -Math.cos(t.yaw));
    const desired = _v2.copy(t.position).addScaledVector(fwd, -4.2);
    desired.y += 2.4;
    this.camera.position.lerp(desired, damp(4, dt));
    const look = _v1.copy(t.position);
    look.y += 1.3;
    this.camera.lookAt(look);
    this.camera.fov = this.getBaseFov();
    this.camera.updateProjectionMatrix();
  }

  _syncViewCamera() {
    this.camera.updateMatrixWorld();
    this.viewCamera.position.copy(this.camera.position);
    this.viewCamera.quaternion.copy(this.camera.quaternion);
    this.viewCamera.updateMatrixWorld();
    const L = this.world.lighting;
    if (L && L.sunDirection) {
      this.viewSun.position.copy(this.camera.position).addScaledVector(L.sunDirection, 10);
      this.viewSun.target.position.copy(this.camera.position);
      this.viewSun.target.updateMatrixWorld();
    }
  }

  _showViewModel() {
    if (this._warming) return true;
    return (this.state === 'playing' || this.state === 'paused' || this.state === 'ended')
      && !this.spectate && !this.fixedCam && this.player.alive;
  }

  /**
   * Draw the frame: world -> viewmodel (depth cleared) -> bloom (when on) -> output pass (bloom added, exposure,
   * tone mapping, sRGB) to the canvas. Skipped while a quality switch compiles new programs behind the overlay.
   */
  render() {
    if (this._holdRender) return;
    this.layersPass.viewEnabled = this._showViewModel();
    const bp = this.bloomPass;
    this.outputPass.bloomTexture = bp && bp.enabled && bp.fold ? bp.outputTexture : null;
    this.composer.render();
  }

  _reportFrameError(err) {
    const key = String(err && err.message);
    const n = (this._frameErrors.get(key) || 0) + 1;
    this._frameErrors.set(key, n);
    if (n <= 3 || n % 300 === 0) console.error(`[game] frame error (x${n}):`, err);
  }
}
