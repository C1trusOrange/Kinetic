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


const VIEW_FOV = 50; // vertical fov of the viewmodel camera (weapons are authored for this)
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
    this.autotest = params.has('autotest') ? new AutoTest(this, params) : null;

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
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.shadowMap.enabled = this.quality.shadows;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.autoClear = false;
    renderer.info.autoReset = false;
    renderer.domElement.tabIndex = 0;
    this.gameRoot.appendChild(renderer.domElement);
    /** 'Low latency mode' (settings.lowLatency): caps the frames in flight on the GPU (maxFrames, 2), see FrameLimiter. */
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

    this.input.onLockChange(locked => {
      if (!locked && this.state === 'playing' && !this.autotest && !this.input.lockUnavailable) this.pause();
    });

    window.addEventListener('keydown', e => {
      if ((e.code === 'Escape' || e.code === 'KeyP') && this.state === 'playing' && !this.input.locked) this.pause();
      else if (e.code === 'KeyP' && this.state === 'playing') { this.input.exitLock(); this.pause(); }
    });

    this.renderer.domElement.addEventListener('click', () => {
      // No lockUnavailable gate: a click is a real gesture, so always retry (a success clears the flag).
      if (this.state === 'playing' && !this.input.locked && !this.autotest) {
        this.input.requestLock();
      }
    });

    this.settings.onChange((key, value) => {
      if (key === 'quality') this._applyQualitySetting();
      else if (key === 'renderScale') this._onResize();
      else if (key === 'lowLatency') this.frameLimiter.setEnabled(value !== false);
      else if (key === 'masterVolume') this.audio.setMasterVolume(value);
      else if (key === 'glow') this._applyBloomSettings();
      else if (key === 'brightness') this._applyExposure();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing' && !this.autotest) {
        this.input.exitLock();
        this.pause();
      }
    });
  }

  /** Initialise subsystems, start the loop and show the main menu (or run the autotest). */
  async boot() {
    this.state = 'loading';
    for (const sys of [this.audio, this.effects, this.world, this.projectiles, this.player, this.weapons, this.bots, this.hud, this.menu]) {
      if (typeof sys.init === 'function') await sys.init();
    }
    this.audio.setMasterVolume(this.settings.get('masterVolume'));
    requestAnimationFrame(this._loop);

    if (this.autotest) {
      this.state = 'menu';
      await this.autotest.start();
      return;
    }

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
  }

  // ================================================================== match flow

  /**
   * Start a match. Must be called from a user gesture (so pointer lock can be requested).
   * @param {object} options { mapId, mode:'ffa'|'tdm', botCount, difficulty, scoreLimit, timeLimit (minutes, 0 = none), arsenal ({weaponId: 'off'|'rare'|'normal'|'common'}) }
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
    };
    this.lastMatchConfig = { ...cfg };

    this.audio.unlock();
    if (!this.autotest) this.input.requestLock();
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
    this.player.color.set(isTeamMode(cfg.mode) ? TEAM_COLORS[TEAM_BLUE] : PLAYER_COLOR);

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
   * @param {boolean} [drawView=false] also draw one composer frame that includes the viewmodel pass (match start
   *        only: the loading overlay hides it; in the menu the viewmodel would flash for a frame)
   * @returns {Promise<void>}
   */
  async warmup(drawView = false) {
    const r = this.renderer;
    try {
      r.setRenderTarget(this.composer ? this.composer.renderTarget1 : null);
      const jobs = [r.compileAsync(this.scene, this.camera), r.compileAsync(this.viewScene, this.viewCamera)];
      r.setRenderTarget(null); // compile() creates the programs synchronously, only the link wait is async
      const cap = new Promise(resolve => setTimeout(resolve, 20000));
      await Promise.race([Promise.all(jobs), cap]);
      // One real composer frame: the driver finishes shadow-depth/bloom/output programs, buffers and pipeline
      // state on first draw, not on compile (the first viewmodel draw alone cost ~0.6 s).
      this._warming = drawView;
      await nextFrame();
      this._warming = false;
    } catch (err) {
      this._warming = false;
      r.setRenderTarget(null);
      console.warn('[game] shader warm-up failed', err);
    }
  }

  restartMatch() {
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
      m.playerWon = m.winnerTeam === this.player.team;
    } else {
      m.winner = this.modes.pickWinner(m) || this.entities.slice().sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)[0] || null;
      m.playerWon = m.winner === this.player;
    }
    this.state = 'ended';
    this.timeScale = 0.25;
    this._endTimer = 2.2;
    this.input.enabled = false;
    this.audio.play('match_end');
    this.events.emit('match:end', m);
  }

  _showEndScreen() {
    this.timeScale = 1;
    this.audio.stopAllLoops(); // the sim is frozen from here on: nothing would ever silence a slide / grapple-reel loop
    this.input.capture = false;
    this.input.exitLock();
    this.hud.show(false);
    this.menu.showEnd(this.match);
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.enabled = false;
    this.input.capture = false;
    this.input.clearAll();
    this.menu.showPause();
    this.events.emit('game:pause');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.input.requestLock();
    this.state = 'playing';
    this.input.enabled = true;
    this.input.capture = true;
    this.menu.hide();
    this.events.emit('game:resume');
  }

  quitToMenu() {
    this._clearMatch();
    this.player.alive = false;
    this.state = 'menu';
    this.input.enabled = false;
    this.input.capture = false;
    this.input.exitLock();
    this.hud.show(false);
    this.menu.showMain();
    this.events.emit('game:menu');
  }

  _clearMatch() {
    this.modes.clear();
    this.bots.clear();
    this.projectiles.clear();
    this.effects.clear();
    this.entities.length = 0;
    this.match = null;
    this.timeScale = 1;
    this._endTimer = 0;
    this._spectateTarget = null;
  }

  // ================================================================== entities

  /** Register an entity (assigns entity.id). */
  addEntity(e) {
    e.id = this._nextEntityId++;
    if (!this.entities.includes(e)) this.entities.push(e);
    return e;
  }

  removeEntity(e) {
    const i = this.entities.indexOf(e);
    if (i >= 0) this.entities.splice(i, 1);
  }

  getEntityById(id) {
    return this.entities.find(e => e.id === id) || null;
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
    if (!m) return;
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
    this.modes.onDeath({ victim, attacker, weapon });   // Escalation promotion / King of the Hill kill bonus
    victim.respawnAt = this.time + (victim.isPlayer ? RESPAWN_DELAY.player : RESPAWN_DELAY.bot);
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
        isPlayer: !!e.isPlayer, alive: e.alive, color: '#' + e.color.getHexString(),
        tier: e.tier | 0, zoneTime: e.zoneTime || 0,
      }))
      .sort((a, b) => b.tier - a.tier || b.kills - a.kills || a.deaths - b.deaths);
  }

  _updateMatch(dt) {
    const m = this.match;
    if (!m) return;
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
        if (e.position.y < killY) {
          const recent = e.lastAttacker && this.time - e.lastDamageTime < 6 ? e.lastAttacker : null;
          // shoved off the map by Gale within 5 s: a ring-out credited to the shover
          const sb = e._shovedBy;
          const ring = recent && sb && sb.attacker === recent && this.time - sb.at < 5;
          this.combat.kill(e, { attacker: recent, weapon: ring ? 'ringout' : 'fall' });
        }
      } else if (!m.over && e.respawnAt >= 0 && this.time >= e.respawnAt) {
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
    this.renderer.toneMappingExposure = ((L && L.exposure) ?? 1) * this._numSetting('brightness', 0.7, 1.3, 1);
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
    const now = nowMs / 1000;
    let raw = this._lastFrameTime ? now - this._lastFrameTime : 1 / 60;
    this._lastFrameTime = now;
    if (!(raw > 0)) raw = 1 / 60;
    if (raw > 0.25) raw = 0.25;
    this.realTime += raw;
    this.fps = this.fps * 0.93 + (1 / raw) * 0.07;
    this.renderer.info.reset();
    this.input.update();

    try {
      const dt = Math.min(raw, 0.05) * this.timeScale;
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
      this.render();
      if (this.state === 'playing') this.frameLimiter.frameSubmitted();
    } catch (err) {
      this._reportFrameError(err);
    }

    if (this.autotest) this.autotest.frame(raw);
    this.input.endFrame();
    this.frame++;
  }

  /** One simulation step. Order matters - see ARCHITECTURE.md "Frame order". */
  update(dt) {
    this.time += dt;
    if (this.autotest) this.autotest.update(dt);
    if (!this.spectate) {
      this.player.update(dt);
      this.weapons.update(dt);
    }
    this.bots.update(dt);
    this.combat.update(dt);
    this.projectiles.update(dt);
    this.world.update(dt);
    this.modes.update(dt);
    this.effects.update(dt);
    this._updateMatch(dt);
    this._updateCamera(dt);
    this.weapons.updateViewModel(dt);
    this.audio.update(dt);
    this.hud.update(dt);
  }

  _updateMenu(dt) {
    this._menuT += dt;
    this.world.update(dt);
    this.effects.update(dt);
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
    this.audio.update(dt);
  }

  _updateCamera(dt) {
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
