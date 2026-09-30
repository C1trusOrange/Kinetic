// Main menu, match setup, settings, controls reference, loading screen, pause menu and the
// end-of-match screen. Pure DOM/CSS/SVG on top of the live 3D backdrop. See ARCHITECTURE.md 6.11.
//
// Buttons that start a match call game.startMatch() synchronously inside the click handler so
// the pointer-lock request keeps its user gesture.

import { clamp } from '../core/utils.js';
import { DIFFICULTIES, MODES, TEAM_BLUE, TEAM_COLORS, TEAM_NAMES, isTeamMode } from '../core/constants.js';
import { DEFAULT_SETTINGS } from '../core/Settings.js';
import {
  ARSENAL_IDS, ARSENAL_LEVELS, ARSENAL_PRESETS, DEFAULT_ARSENAL, sanitizeArsenal, arsenalPercents, matchArsenalPreset,
} from '../ai/BotConfig.js';
import { weaponName, WEAPONS, WEAPON_ORDER } from '../weapons/WeaponDefs.js';
import { esc, hexOf, keyLabel, fmtTime, ordinal } from './dom.js';
import { ICON, logoSVG, mapArt, mapPalette, tipDiagram, weaponIcon } from './Icons.js';
import { scoreboardHTML } from './Scoreboard.js';
import { modeName, modeShort } from './ModeHUD.js';

const SCORE_OPTS = [10, 25, 50, 100, 0];
const TIME_OPTS = [3, 5, 10, 15, 20, 0];
const DIFF_INFO = {
  easy: 'Slow reactions, poor aim', normal: 'A fair fight', hard: 'Fast, accurate, aggressive', insane: 'Near-perfect machines',
};

// Bot arsenal (which weapons bots spawn with): labels + accent colours used by the summary card and the editor.
const ARS_LABEL = { pistol: 'Pistol', rifle: 'Rifle', shotgun: 'Shotgun', sniper: 'Sniper', rocket: 'Rocket launcher' };
const ARS_SHORT = { pistol: 'Pistol', rifle: 'Rifle', shotgun: 'Shotgun', sniper: 'Sniper', rocket: 'Rocket' };
const ARS_COLOR = { pistol: '#9db3c6', rifle: '#3de0ff', shotgun: '#ff9a3c', sniper: '#5dff9a', rocket: '#ff4a5a' };
Object.assign(ARS_LABEL, { arc: 'Tempest arc gun', gale: 'Gale repulsor' });
Object.assign(ARS_SHORT, { arc: 'Tempest', gale: 'Gale' });
Object.assign(ARS_COLOR, { arc: '#b47bff', gale: '#bfeaff' });
const ARS_LEVEL_LABEL = { off: 'Off', rare: 'Rare', normal: 'Normal', common: 'Common' };
// Weapons added after the original five: anything not listed here still gets a row (weapon name + a palette colour).
const ARS_EXTRA = { smg: { label: 'Submachine gun', short: 'SMG', color: '#ffc23a' }, rail: { label: 'Railgun', short: 'Rail', color: '#e6f6ff' } };
const ARS_FALLBACK_COLORS = ['#c58bff', '#7affc4', '#ff7aa8', '#d4ff3a'];
const arsLabel = id => ARS_LABEL[id] || (ARS_EXTRA[id] && ARS_EXTRA[id].label) || weaponName(id);
const arsShort = id => ARS_SHORT[id] || (ARS_EXTRA[id] && ARS_EXTRA[id].short) || weaponName(id);
const arsColor = id => ARS_COLOR[id] || (ARS_EXTRA[id] && ARS_EXTRA[id].color) || ARS_FALLBACK_COLORS[Math.max(0, ARSENAL_IDS.indexOf(id)) % ARS_FALLBACK_COLORS.length];

const LOADING_TIPS = [
  'Slide (C) while sprinting to keep your momentum — jump out of it to slide-hop.',
  'Wall-run needs speed and a tall wall: jump at it while holding W.',
  'Press Space during a wall-run to kick off the wall with your speed intact.',
  'Your grapple (E) recharges in 3.5 s — release it with a jump for an upward boost.',
  'Rocket jump: fire the Hammer at your feet. You only take 35% of the blast.',
  'Hold G to cook a grenade. The fuse burns while you hold it.',
  'Press X to cycle grenade types: Vortex pulls enemies in, Static shocks them, Kinetic launches, Smoke blocks sight.',
  'Headshots deal double damage. The Longbow one-shots to the head.',
  'Spawn protection ends the moment you fire your weapon.',
  'Jump pads and double jumps refresh your wall-run and grapple.',
  'Bots cannot grapple or wall-run — use the high ground.',
];

const SETTINGS_SPEC = [
  { group: 'Gameplay', col: 0, items: [
    { key: 'sensitivity', label: 'Mouse sensitivity', type: 'range', min: 0.1, max: 3, step: 0.05, fmt: v => v.toFixed(2) },
    { key: 'invertY', label: 'Invert Y axis', type: 'toggle' },
    { key: 'fov', label: 'Field of view', hint: 'Horizontal', type: 'range', min: 70, max: 120, step: 1, fmt: v => Math.round(v) + '°' },
    { key: 'viewBob', label: 'View bob', type: 'toggle' },
  ] },
  { group: 'Video', col: 1, items: [
    { key: 'quality', label: 'Graphics quality', type: 'seg', options: ['low', 'medium', 'high'] },
    { key: 'glow', label: 'Glow', hint: 'Bloom, Medium / High', type: 'range', min: 0, max: 1, step: 0.05, fmt: v => Math.round(v * 100) + '%' },
    { key: 'brightness', label: 'Brightness', hint: 'Exposure', type: 'range', min: 0.7, max: 1.3, step: 0.05, fmt: v => Math.round(v * 100) + '%' },
    { key: 'showFps', label: 'Show FPS counter', type: 'toggle' },
  ] },
  { group: 'Audio', col: 0, items: [
    { key: 'masterVolume', label: 'Master volume', type: 'range', min: 0, max: 1, step: 0.05, fmt: v => Math.round(v * 100) + '%' },
  ] },
  { group: 'Profile', col: 1, items: [
    { key: 'playerName', label: 'Player name', type: 'text', maxlength: 16 },
  ] },
];

const TIPS = [
  { id: 'slide', title: 'Slide', keys: ['SHIFT', 'C'], text: 'Sprint, then crouch at speed for a burst of momentum. Slopes speed you up; jump out to slide-hop.' },
  { id: 'wallrun', title: 'Wall-run', keys: ['W', 'SPACE'], text: 'Jump at a tall wall while moving fast and holding forward. Run along it for about 1.7 s.' },
  { id: 'walljump', title: 'Wall-jump', keys: ['SPACE'], text: 'Jump while wall-running to kick off the wall, keeping your speed and gaining height.' },
  { id: 'doublejump', title: 'Double jump', keys: ['SPACE', 'SPACE'], text: 'Jump again in mid-air to redirect. Landing, wall-runs and grapples refresh it.' },
  { id: 'grapple', title: 'Grapple', keys: ['E'], text: 'Hook any surface within 45 m and reel in or swing. Jump to release with an upward boost.' },
  { id: 'rocket', title: 'Rocket jump', keys: ['5', 'LMB'], text: 'Fire the Hammer at your feet. Blast knockback is full, but self-damage is only 35%.' },
  { id: 'gale', title: 'Gale', keys: ['9', 'LMB'], text: 'Blast the floor or a wall to launch yourself. Shove enemies off ledges or into walls, or reflect their rockets.' },
  { id: 'mantle', title: 'Mantle', keys: ['W'], text: 'Run into a ledge between 0.6 and 2.3 m and you will vault up automatically.' },
  { id: 'smg', title: 'Slipstream', keys: ['6', 'SLIDE'], text: 'Speed feeds the Slipstream: slide, wall-run or grapple while firing for up to +40% damage and tighter spread.' },
  { id: 'rail', title: 'Javelin', keys: ['8', 'HOLD LMB'], text: 'Hold fire to charge, release for a beam that pierces up to three enemies and thin walls. Full charge one-shots; release early to cancel.' },
  { id: 'grenades', title: 'Grenade types', keys: ['X', 'G'], text: 'X cycles Frag, Vortex, Static, Kinetic and Smoke. Vortex drags enemies in, Static shocks, Kinetic launches, Smoke blocks sight.' },
  { id: 'cook', title: 'Cook grenades', keys: ['G'], text: 'Hold to pull the pin — the fuse burns while you hold. Release to throw. Do not hold too long!' },
];

/**
 * All non-HUD screens. Built once from init(); the loading overlay is created in the constructor
 * so the very first frame already shows something.
 */
export class Menu {
  /** @param {object} game */
  constructor(game) {
    this.game = game;
    this.built = false;
    this.screen = null;
    this._origin = 'main';
    this._cfg = null;
    this._ctl = {};
    this._ldVisible = false;
    this._ldLast = -1;
    this._hoverT = 0;
    this._quitArmed = 0;
    this._shownAt = 0;
    this._buildLoading();
    this.showLoading('Starting KINETIC', 0.02);
  }

  // ================================================================== construction

  _buildLoading() {
    const el = document.createElement('div');
    el.className = 'k-loading on';
    el.innerHTML = `
      <div class="ld-bg"></div>
      <div class="ld-center">
        ${logoSVG('ld-logo')}
        <div class="ld-label" data-r="ldlabel">LOADING</div>
        <div class="ld-bar"><i class="ld-fill" data-r="ldfill"></i><i class="ld-shine"></i></div>
        <div class="ld-meta"><span data-r="ldpct">0%</span></div>
        <div class="ld-tip" data-r="ldtip"></div>
      </div>`;
    this.game.uiRoot.appendChild(el);
    this.loading = el;
    this._ld = {};
    for (const n of el.querySelectorAll('[data-r]')) this._ld[n.dataset.r] = n;
    this._ldVisible = true;
    this._pickTip();
  }

  /** Build all menu screens. */
  init() {
    if (this.built) return;
    this.built = true;
    const g = this.game;
    const s = g.settings;
    const maps = g.maps || [];
    const known = id => maps.some(m => m.id === id);
    this._cfg = {
      mapId: known(s.get('map')) ? s.get('map') : (maps[0] ? maps[0].id : ''),
      mode: MODES.includes(s.get('mode')) ? s.get('mode') : 'ffa',
      botCount: clamp(Math.round(s.get('bots')), 0, 15),
      difficulty: DIFFICULTIES.includes(s.get('difficulty')) ? s.get('difficulty') : 'normal',
      scoreLimit: Math.max(0, Math.round(s.get('scoreLimit'))),
      timeLimit: Math.max(0, s.get('timeLimit')),
      arsenal: sanitizeArsenal(s.get('botArsenal')),
    };

    const root = document.createElement('div');
    root.className = 'k-menu';
    root.innerHTML = `<div class="k-scrim"></div><div class="k-grid"></div>`
      + this._mainHTML() + this._setupHTML() + this._arsenalHTML() + this._settingsHTML() + this._controlsHTML()
      + this._pauseHTML() + this._endHTML();
    g.uiRoot.appendChild(root);
    this.root = root;
    this.screens = {};
    for (const sc of root.querySelectorAll('[data-screen]')) this.screens[sc.dataset.screen] = sc;
    this.r = {};
    for (const n of root.querySelectorAll('[data-r]')) this.r[n.dataset.r] = n;
    // keep the loading overlay above the menu
    g.uiRoot.appendChild(this.loading);

    this._bindEvents();
    this._syncSetup();
    this._syncSettings();
  }

  _mainHTML() {
    return `
    <section class="k-screen s-main" data-screen="main">
      <div class="main-left">
        <div class="main-logo">${logoSVG('big')}</div>
        <div class="tagline"><span>Arena shooter</span><i></i><span>Move fast. Stay alive.</span></div>
        <nav class="main-nav">
          <button class="k-btn primary" data-act="play"><span class="lbl">Play</span><em>Set up a match</em><b>${ICON.arrow}</b></button>
          <button class="k-btn" data-act="quick"><span class="lbl">Quick play</span><em data-r="quicksum"></em><b>${ICON.bolt}</b></button>
          <button class="k-btn" data-act="settings"><span class="lbl">Settings</span><em>Controls, video, audio</em></button>
          <button class="k-btn" data-act="controls"><span class="lbl">Controls</span><em>Keys &amp; movement tech</em></button>
        </nav>
      </div>
      <div class="main-right">
        <div class="now-showing"><small>Now showing</small><b data-r="nowmap"></b><span data-r="nowsub"></span></div>
      </div>
      <footer class="main-foot"><span><kbd>WASD</kbd> move</span><span><kbd>SPACE</kbd> jump</span><span><kbd>E</kbd> grapple</span><span><kbd>C</kbd> slide</span><span><kbd>ESC</kbd> pause</span></footer>
    </section>`;
  }

  _setupHTML() {
    const cards = (this.game.maps || []).map(def => {
      const pal = mapPalette(def);
      return `<button class="k-map" data-map="${esc(def.id)}" style="--c0:${esc(pal.base)};--c1:${esc(pal.accent)}">
        <div class="mp-art">${mapArt(def)}</div><div class="mp-fade"></div>
        <div class="mp-info"><span class="mp-sub">${esc(def.subtitle || '')}</span><h3>${esc(def.name || def.id)}</h3><p>${esc(def.description || '')}</p></div>
        <span class="mp-check">${ICON.check}</span></button>`;
    }).join('');
    const seg = (opt, list, fmt) => `<div class="seg" data-opt="${opt}">${list.map(v => `<button data-v="${v}">${fmt(v)}</button>`).join('')}</div>`;
    return `
    <section class="k-screen s-setup" data-screen="setup">
      <header class="k-head"><button class="k-back" data-act="back">${ICON.back}<span>Back</span></button><div><h2>Match setup</h2><small>Choose your arena and rules</small></div></header>
      <div class="setup-body">
        <div class="setup-maps"><div class="k-sec">Arena</div><div class="map-grid">${cards}</div></div>
        <div class="setup-opts k-cut">
          <div class="opt"><div class="opt-h">Mode</div>
            <div class="seg seg-mode" data-opt="mode">
              <button data-v="ffa"><b>Free for all</b><small>Every fighter for themselves</small></button>
              <button data-v="tdm"><b>Team deathmatch</b><small>Blue vs Red, you are Blue</small></button>
              <button data-v="escalation"><b>Escalation</b><small>Kill to upgrade your weapon, finish with the last one</small></button>
              <button data-v="koth"><b>King of the Hill</b><small>Hold the moving zone, Blue vs Red</small></button>
            </div></div>
          <div class="opt"><div class="opt-h">Bots <output data-r="botsout">7</output></div>
            <input type="range" class="k-range" min="0" max="15" step="1" data-opt="bots"><div class="opt-note" data-r="botsnote"></div></div>
          <div class="opt"><div class="opt-h">Difficulty <output data-r="diffout"></output></div>
            ${seg('difficulty', DIFFICULTIES, v => v)}</div>
          <div class="opt"><div class="opt-h">Bot arsenal <output data-r="arsout"></output></div>
            <button class="ars-card" data-act="arsenal" title="Choose which weapons bots spawn with">
              <span class="ars-body"><span class="mix" data-r="arsmix"></span><span class="mix-key" data-r="arskey"></span></span>
              <b class="ars-go"><span>Edit</span>${ICON.arrow}</b></button></div>
          <div class="opt-row">
            <div class="opt"><div class="opt-h">Score limit <output data-r="slout"></output></div>${seg('scoreLimit', SCORE_OPTS, v => (v ? v : '∞'))}</div>
            <div class="opt"><div class="opt-h">Time limit</div>${seg('timeLimit', TIME_OPTS, v => (v ? v + 'm' : '∞'))}</div>
          </div>
        </div>
      </div>
      <footer class="k-foot"><div class="summary" data-r="summary"></div>
        <button class="k-btn ghost" data-act="back">Back</button>
        <button class="k-btn primary big" data-act="deploy"><span class="lbl">Deploy</span><b>${ICON.arrow}</b></button></footer>
    </section>`;
  }

  _arsenalHTML() {
    const rows = ARSENAL_IDS.map(id => `
        <div class="ars-row" data-w="${id}" style="--wc:${arsColor(id)}">
          <div class="ars-w"><span class="ars-ico">${weaponIcon(id)}</span><span class="ars-n"><b>${arsLabel(id)}</b><small>${esc(weaponName(id))}</small></span></div>
          <div class="seg" data-wpn="${id}">${ARSENAL_LEVELS.map(l => `<button data-v="${l}">${ARS_LEVEL_LABEL[l]}</button>`).join('')}</div>
          <div class="ars-share"><i class="ars-bar"><u></u></i><b data-r="arspct_${id}">0%</b></div>
        </div>`).join('');
    const presets = ARSENAL_PRESETS.map(p => `<button data-preset="${p.id}"><b>${esc(p.name)}</b><small>${esc(p.info)}</small></button>`).join('');
    return `
    <section class="k-screen s-arsenal" data-screen="arsenal">
      <header class="k-head"><button class="k-back" data-act="back">${ICON.back}<span>Back</span></button><div><h2>Bot arsenal</h2><small>Which weapons bots spawn with</small></div></header>
      <div class="ars-panel k-cut">
        <div class="k-sec">Presets</div>
        <div class="seg seg-presets" data-r="arspresets">${presets}</div>
        <div class="k-sec ars-sec">Spawn frequency<output>share of bot spawns</output></div>
        <div class="mix mix-lg" data-r="arsmix2"></div>
        <div class="ars-rows">${rows}</div>
        <div class="opt-note ars-note" data-r="arsnote"></div>
      </div>
      <footer class="k-foot"><div class="summary" data-r="arssum"></div><button class="k-btn ghost" data-act="reset-arsenal">Reset to Balanced</button><button class="k-btn primary" data-act="back"><span class="lbl">Done</span></button></footer>
    </section>`;
  }

  _settingsHTML() {
    const group = gr => `<div class="set-group"><div class="k-sec">${gr.group}</div>${gr.items.map(it => {
      let ctl = '';
      if (it.type === 'range') ctl = `<input type="range" class="k-range" data-set="${it.key}" min="${it.min}" max="${it.max}" step="${it.step}"><output data-out="${it.key}"></output>`;
      else if (it.type === 'toggle') ctl = `<button class="k-toggle" data-set="${it.key}" role="switch"><i></i></button>`;
      else if (it.type === 'seg') ctl = `<div class="seg" data-set="${it.key}">${it.options.map(o => `<button data-v="${o}">${o}</button>`).join('')}</div>`;
      else if (it.type === 'text') ctl = `<input type="text" class="k-text" data-set="${it.key}" maxlength="${it.maxlength}" spellcheck="false" autocomplete="off">`;
      // A seg row must not be a <label>: clicking its text would click the label's first button (quality -> low).
      const tag = it.type === 'seg' ? 'div' : 'label';
      return `<${tag} class="set-row"><span class="set-l">${it.label}${it.hint ? `<small>${it.hint}</small>` : ''}</span><span class="set-c">${ctl}</span></${tag}>`;
    }).join('')}</div>`;
    const col = c => `<div class="set-col">${SETTINGS_SPEC.filter(gr => gr.col === c).map(group).join('')}</div>`;
    return `
    <section class="k-screen s-settings" data-screen="settings">
      <header class="k-head"><button class="k-back" data-act="back">${ICON.back}<span>Back</span></button><div><h2>Settings</h2><small>Changes apply instantly</small></div></header>
      <div class="set-panel k-cut">${col(0)}${col(1)}</div>
      <footer class="k-foot"><div class="summary"></div><button class="k-btn ghost" data-act="reset-settings">Reset to defaults</button><button class="k-btn primary" data-act="back"><span class="lbl">Done</span></button></footer>
    </section>`;
  }

  _controlsHTML() {
    const tips = TIPS.map(t => `<div class="tip k-cut"><div class="tip-art">${tipDiagram(t.id)}</div>
      <div class="tip-txt"><h4>${t.title}</h4><p>${t.text}</p><div class="tip-keys">${t.keys.map(k => `<kbd>${k}</kbd>`).join('')}</div></div></div>`).join('');
    return `
    <section class="k-screen s-controls" data-screen="controls">
      <header class="k-head"><button class="k-back" data-act="back">${ICON.back}<span>Back</span></button><div><h2>Controls</h2><small>Key bindings and movement tech</small></div></header>
      <div class="ctl-body">
        <div class="ctl-keys k-cut" data-r="ctlkeys"></div>
        <div class="ctl-tips"><div class="k-sec">Movement tech</div><div class="tip-grid">${tips}</div></div>
      </div>
    </section>`;
  }

  _pauseHTML() {
    return `
    <section class="k-screen s-pause" data-screen="pause">
      <div class="pause-panel k-cut">
        <div class="pz-head"><small>Match in progress</small><h2>Paused</h2></div>
        <div class="pz-info" data-r="pzinfo"></div>
        <div class="pz-btns">
          <button class="k-btn primary" data-act="resume"><span class="lbl">Resume</span><b>${ICON.arrow}</b></button>
          <button class="k-btn" data-act="restart"><span class="lbl">Restart match</span></button>
          <button class="k-btn" data-act="settings"><span class="lbl">Settings</span></button>
          <button class="k-btn" data-act="controls"><span class="lbl">Controls</span></button>
          <button class="k-btn danger" data-act="quit"><span class="lbl" data-r="quitlbl">Quit to menu</span></button>
        </div>
      </div>
    </section>`;
  }

  _endHTML() {
    return `
    <section class="k-screen s-end" data-screen="end">
      <div class="end-banner" data-r="endbanner"><small data-r="endkind"></small><h1 data-r="endtitle"></h1><p data-r="endsub"></p></div>
      <div class="end-body">
        <div class="end-board k-cut"><div class="board-head"><h3>Final scoreboard</h3><span data-r="endinfo"></span></div><div data-r="endboard"></div></div>
        <div class="end-side">
          <div class="end-stats k-cut" data-r="endstats"></div>
          <div class="end-btns">
            <button class="k-btn primary big" data-act="again"><span class="lbl">Play again</span><b>${ICON.arrow}</b></button>
            <button class="k-btn" data-act="menu"><span class="lbl">Main menu</span></button>
          </div>
        </div>
      </div>
    </section>`;
  }

  // ================================================================== events

  _bindEvents() {
    const root = this.root;
    const g = this.game;
    root.addEventListener('pointerdown', () => { if (g.audio && g.audio.unlock) g.audio.unlock(); }, true);
    root.addEventListener('mouseover', e => {
      const t = e.target.closest && e.target.closest('button, .k-map');
      if (!t || t.disabled || t === this._lastHover) return;
      this._lastHover = t;
      const now = performance.now();
      if (now - this._hoverT > 45) { this._hoverT = now; this._sfx('ui_hover', 1); }
    });
    root.addEventListener('mouseout', e => {
      if (!e.relatedTarget || !root.contains(e.relatedTarget)) this._lastHover = null;
    });
    root.addEventListener('click', e => this._onClick(e));
    root.addEventListener('input', e => this._onInput(e));

    window.addEventListener('keydown', e => {
      if (!this.root.classList.contains('open') || e.repeat) return;
      if (performance.now() - this._shownAt < 400) return;   // ignore the Esc that opened the pause menu
      const t = e.target;
      const typing = t && t.tagName === 'INPUT' && t.type === 'text';
      if (e.code === 'Escape' || (e.code === 'KeyP' && !typing)) {
        if (this.screen === 'pause') { if (g.state === 'paused') { g.resume(); } }
        else if (this.screen === 'settings' || this.screen === 'controls') this._go(this._origin);
        else if (this.screen === 'setup') this._go('main');
        else if (this.screen === 'arsenal') this._go('setup');
      } else if (e.code === 'Enter' && this.screen === 'setup' && !typing && t && !t.closest('button')) {
        this._deploy();
      }
    });
  }

  _sfx(name, volume = 1) {
    const a = this.game.audio;
    if (a && a.play) a.play(name, { volume });
  }

  _onClick(e) {
    const t = e.target.closest && e.target.closest('button, .k-map');
    if (!t || t.disabled) return;
    const g = this.game;
    this._sfx('ui_click', 1);
    if (t.dataset.map) { this._setCfg('mapId', t.dataset.map); return; }
    const seg = t.closest('.seg');
    if (seg && t.dataset.v !== undefined) {
      if (seg.dataset.opt) {
        const k = seg.dataset.opt;
        this._setCfg(k, k === 'mode' || k === 'difficulty' ? t.dataset.v : Number(t.dataset.v));
      } else if (seg.dataset.set) {
        g.settings.set(seg.dataset.set, t.dataset.v);
        this._syncSettings();
      } else if (seg.dataset.wpn) {
        this._setCfg('arsenal', { ...this._cfg.arsenal, [seg.dataset.wpn]: t.dataset.v });
      }
      t.blur();
      return;
    }
    if (t.dataset.preset) {
      const p = ARSENAL_PRESETS.find(x => x.id === t.dataset.preset);
      if (p) this._setCfg('arsenal', p.arsenal);
      t.blur();
      return;
    }
    if (t.classList.contains('k-toggle') && t.dataset.set) {
      g.settings.set(t.dataset.set, !g.settings.get(t.dataset.set));
      this._syncSettings();
      t.blur();
      return;
    }
    const act = t.dataset.act;
    if (!act) return;
    if (act !== 'quit') this._disarmQuit();
    switch (act) {
      case 'play': this._go('setup'); break;
      case 'quick': this._deploy(); break;
      case 'deploy': this._deploy(); break;
      case 'settings': this._go('settings'); break;
      case 'controls': this._go('controls'); break;
      case 'arsenal': this._go('arsenal'); break;
      case 'reset-arsenal': this._setCfg('arsenal', DEFAULT_ARSENAL); break;
      case 'back': this._go(this.screen === 'setup' ? 'main' : this.screen === 'arsenal' ? 'setup' : this._origin); break;
      case 'resume': g.resume(); break;
      case 'restart': g.restartMatch(); break;
      case 'again': g.restartMatch(); break;
      case 'menu': g.quitToMenu(); break;
      case 'quit': this._quit(); break;
      case 'reset-settings':
        for (const gr of SETTINGS_SPEC) for (const it of gr.items) g.settings.set(it.key, DEFAULT_SETTINGS[it.key]);
        this._syncSettings();
        break;
      default: break;
    }
    if (t.blur) t.blur();
  }

  _onInput(e) {
    const t = e.target;
    const g = this.game;
    if (t.dataset.opt === 'bots') { this._setCfg('botCount', Number(t.value)); return; }
    const key = t.dataset.set;
    if (!key) return;
    if (t.type === 'range') {
      g.settings.set(key, Number(t.value));
      this._paintRange(t);
      const out = this.root.querySelector(`[data-out="${key}"]`);
      const spec = this._spec(key);
      if (out && spec) out.textContent = spec.fmt(Number(t.value));
    } else if (t.type === 'text') {
      g.settings.set(key, t.value.trim().slice(0, 16));
    }
  }

  _spec(key) {
    for (const gr of SETTINGS_SPEC) for (const it of gr.items) if (it.key === key) return it;
    return null;
  }

  _quit() {
    if (this._quitArmed > performance.now()) { this._disarmQuit(); this.game.quitToMenu(); return; }
    this._quitArmed = performance.now() + 3200;
    const lbl = this.r.quitlbl;
    lbl.textContent = 'Click again to confirm';
    clearTimeout(this._quitT);
    this._quitT = setTimeout(() => this._disarmQuit(), 3200);
  }

  _disarmQuit() {
    this._quitArmed = 0;
    if (this.r && this.r.quitlbl) this.r.quitlbl.textContent = 'Quit to menu';
  }

  _deploy() {
    const c = this._cfg;
    if (!c || !c.mapId) return;
    // Must run synchronously inside the click handler (pointer lock needs the gesture).
    this.game.startMatch({
      mapId: c.mapId, mode: c.mode, botCount: c.botCount, difficulty: c.difficulty,
      scoreLimit: c.scoreLimit, timeLimit: c.timeLimit, arsenal: c.arsenal,
    });
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }

  // ================================================================== screens

  _go(name) {
    if (!this.built) this.init();
    this.screen = name;
    this._shownAt = performance.now();
    this.root.classList.add('open');
    this.root.dataset.screen = name;
    for (const k in this.screens) this.screens[k].classList.toggle('on', k === name);
    if (name === 'main') this._fillMain();
    else if (name === 'setup') this._syncSetup();
    else if (name === 'arsenal') this._syncArsenal();
    else if (name === 'settings') this._syncSettings();
    else if (name === 'controls') this._fillControls();
    this._disarmQuit();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }

  /** Title screen with Play / Quick play / Settings / Controls. */
  showMain() {
    if (!this.built) this.init();
    this._origin = 'main';
    this._go('main');
  }

  /** Pause menu (Resume / Restart / Settings / Controls / Quit). */
  showPause() {
    if (!this.built) this.init();
    this._origin = 'pause';
    this._fillPause();
    this._go('pause');
  }

  /** End-of-match screen with banner, scoreboard, Play again / Main menu. */
  showEnd(match) {
    if (!this.built) this.init();
    this._origin = 'main';
    this._fillEnd(match || this.game.match);
    this._go('end');
  }

  /**
   * Show the loading overlay.
   * @param {string} text label
   * @param {number} [progress] 0..1
   */
  showLoading(text = 'Loading', progress) {
    const l = this._ld;
    if (!this._ldVisible) {
      this._ldVisible = true;
      this.loading.classList.add('on');
      this._pickTip();
    }
    const label = String(text).toUpperCase();
    if (l.ldlabel.textContent !== label) l.ldlabel.textContent = label;
    const p = progress == null ? null : clamp(progress, 0, 1);
    this.loading.classList.toggle('indet', p === null || p <= 0.001);
    if (p !== null) {
      const q = Math.round(p * 200) / 200;
      if (q !== this._ldLast) {
        this._ldLast = q;
        l.ldfill.style.transform = `scaleX(${q})`;
        l.ldpct.textContent = Math.round(q * 100) + '%';
      }
    }
  }

  /** Hide the loading overlay. */
  hideLoading() {
    if (!this._ldVisible) return;
    this._ldVisible = false;
    this._ldLast = -1;
    this.loading.classList.remove('on');
  }

  /** Hide every menu screen (not the loading overlay). */
  hide() {
    if (!this.built) return;
    this.screen = null;
    this.root.classList.remove('open');
    this.root.dataset.screen = '';   // drops the per-screen scrim (and its backdrop blur)
    for (const k in this.screens) this.screens[k].classList.remove('on');
    this._disarmQuit();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }

  _pickTip() {
    this._ld.ldtip.textContent = 'TIP  —  ' + LOADING_TIPS[Math.floor(Math.random() * LOADING_TIPS.length)];
  }

  // ================================================================== screen content

  _mapDef(id) {
    const maps = this.game.maps || [];
    return maps.find(m => m.id === id) || maps[0] || { id, name: id };
  }

  _summary() {
    const c = this._cfg;
    const def = this._mapDef(c.mapId);
    const lim = c.mode === 'escalation' ? 'FINISH THE LADDER' : c.scoreLimit ? c.scoreLimit + (c.mode === 'koth' ? ' POINTS' : ' FRAGS') : 'NO SCORE LIMIT';
    return `${(def.name || c.mapId).toUpperCase()} · ${modeShort(c.mode)} · ${c.botCount} BOT${c.botCount === 1 ? '' : 'S'} · ${c.difficulty.toUpperCase()}`
      + ` · ${lim} · ${c.timeLimit ? c.timeLimit + ' MIN' : 'NO TIME LIMIT'}`
      + ` · ARSENAL: ${this._arsenalName().toUpperCase()}`;
  }

  _fillMain() {
    const c = this._cfg;
    const def = this._mapDef(c.mapId);
    this.r.quicksum.textContent = `${(def.name || '').toUpperCase()} · ${modeShort(c.mode)} · ${c.botCount} bots`;
    const bd = this.game.world && this.game.world.def;
    this.r.nowmap.textContent = ((bd && bd.name) || def.name || '').toUpperCase();
    this.r.nowsub.textContent = (bd && bd.subtitle) || def.subtitle || '';
  }

  _setCfg(key, value) {
    const c = this._cfg;
    if (key === 'arsenal') value = sanitizeArsenal(value);
    c[key] = value;
    const s = this.game.settings;
    const map = { mapId: 'map', mode: 'mode', botCount: 'bots', difficulty: 'difficulty', scoreLimit: 'scoreLimit', timeLimit: 'timeLimit', arsenal: 'botArsenal' };
    if (map[key]) s.set(map[key], value);
    this._syncSetup();
  }

  _syncSetup() {
    if (!this.built) return;
    const c = this._cfg, root = this.root;
    for (const card of root.querySelectorAll('.k-map')) card.classList.toggle('sel', card.dataset.map === c.mapId);
    const setSeg = (opt, value) => {
      const seg = root.querySelector(`.seg[data-opt="${opt}"]`);
      if (!seg) return;
      // make sure an unusual stored value still has a button
      if (!seg.querySelector(`[data-v="${value}"]`) && (opt === 'scoreLimit' || opt === 'timeLimit')) {
        const b = document.createElement('button');
        b.dataset.v = String(value);
        b.textContent = opt === 'timeLimit' ? value + 'm' : String(value);
        seg.insertBefore(b, seg.lastElementChild);
      }
      for (const b of seg.children) b.classList.toggle('on', b.dataset.v === String(value));
      seg.dataset.value = String(value);
    };
    setSeg('mode', c.mode);
    setSeg('difficulty', c.difficulty);
    setSeg('scoreLimit', c.scoreLimit);
    setSeg('timeLimit', c.timeLimit);
    // Escalation ends on the last-tier kill: the score limit is fixed (read-only); King of the Hill counts points
    const locked = c.mode === 'escalation';
    const slSeg = root.querySelector('.seg[data-opt="scoreLimit"]');
    if (slSeg) { slSeg.classList.toggle('locked', locked); for (const b of slSeg.children) b.disabled = locked; }
    this.r.slout.textContent = locked ? 'Fixed: the weapon ladder' : c.mode === 'koth' ? 'Points' : '';
    const bots = root.querySelector('input[data-opt="bots"]');
    bots.value = String(c.botCount);
    this._paintRange(bots);
    this.r.botsout.textContent = String(c.botCount);
    this.r.diffout.textContent = DIFF_INFO[c.difficulty] || '';
    const red = Math.ceil(c.botCount / 2), blue = Math.floor(c.botCount / 2);
    this.r.botsnote.textContent = isTeamMode(c.mode)
      ? `You + ${blue} on Blue · ${red} on Red` + (c.mode === 'koth' ? ' · hold the zone' : '')
      : (c.botCount === 0 ? 'Solo practice — nobody shoots back'
        : `You vs ${c.botCount} bot${c.botCount === 1 ? '' : 's'}, ` + (c.mode === 'escalation' ? 'everyone climbs the same ladder' : 'all against all'));
    this._syncArsenal();
    this.r.summary.textContent = this._summary();
    if (this.screen === 'main') this._fillMain();
  }

  /** Name of the arsenal preset in force ('Custom' when the levels match none). */
  _arsenalName() {
    const p = matchArsenalPreset(this._cfg.arsenal);
    return p ? p.name : 'Custom';
  }

  /** Stacked spawn-mix bar segments (width = share, label when wide enough). */
  _mixBar(pct, minLabel) {
    return ARSENAL_IDS.filter(id => pct[id] > 0)
      .map(id => `<i style="flex:${pct[id]} 1 0;--wc:${arsColor(id)}">${pct[id] >= minLabel ? pct[id] + '%' : ''}</i>`).join('');
  }

  /** Refresh the setup-panel summary card and the arsenal editor from this._cfg.arsenal. */
  _syncArsenal() {
    if (!this.built) return;
    const a = this._cfg.arsenal;
    const pct = arsenalPercents(a);
    const preset = matchArsenalPreset(a);
    const r = this.r;
    r.arsout.textContent = preset ? preset.name : 'Custom';
    r.arsmix.innerHTML = this._mixBar(pct, 8);
    r.arskey.innerHTML = ARSENAL_IDS.map(id =>
      `<span class="mk${pct[id] ? '' : ' off'}" style="--wc:${arsColor(id)}"><b>${pct[id]}%</b><small>${arsShort(id)}</small></span>`).join('');
    // editor
    r.arsmix2.innerHTML = this._mixBar(pct, 6);
    for (const id of ARSENAL_IDS) {
      const row = this.root.querySelector(`.ars-row[data-w="${id}"]`);
      if (!row) continue;
      const seg = row.querySelector('.seg');
      for (const b of seg.children) b.classList.toggle('on', b.dataset.v === a[id]);
      seg.dataset.value = a[id];
      row.classList.toggle('off', a[id] === 'off');
      row.querySelector('.ars-bar u').style.width = pct[id] + '%';
      r['arspct_' + id].textContent = pct[id] + '%';
    }
    for (const b of r.arspresets.children) b.classList.toggle('on', !!preset && b.dataset.preset === preset.id);
    const allOff = ARSENAL_IDS.every(id => a[id] === 'off');
    let note;
    if (allOff) note = 'Every weapon is off: bots spawn with the pistol only (they always carry one as a sidearm).';
    else if (a.rocket === 'off') note = 'No bot will spawn with a rocket launcher, and bots will not pick one up from its pad. You still can.';
    else note = `Rocket launchers: ${pct.rocket}% of bot spawns${a.rocket === 'rare' ? ', and bots are less keen to grab the rocket pad' : ''}. Weapons set to Off are also ignored by bots on pickup pads.`;
    r.arsnote.textContent = note;
    const top = ARSENAL_IDS.filter(id => pct[id] > 0).sort((x, y) => pct[y] - pct[x]).slice(0, 5);
    r.arssum.textContent = `${(preset ? preset.name : 'Custom').toUpperCase()} · ` + top.map(id => `${arsShort(id).toUpperCase()} ${pct[id]}%`).join(' · ');
  }

  _paintRange(input) {
    const min = Number(input.min), max = Number(input.max);
    const pct = max > min ? ((Number(input.value) - min) / (max - min)) * 100 : 0;
    input.style.setProperty('--pct', pct.toFixed(1) + '%');
  }

  _syncSettings() {
    if (!this.built) return;
    const s = this.game.settings;
    // the Glow (bloom) slider has no effect on the Low preset, which renders without post-processing
    const glowRow = this.root.querySelector('[data-set="glow"]');
    if (glowRow && glowRow.closest('.set-row')) glowRow.closest('.set-row').classList.toggle('dim', s.get('quality') === 'low');
    for (const gr of SETTINGS_SPEC) {
      for (const it of gr.items) {
        const el = this.root.querySelector(`[data-set="${it.key}"]`);
        if (!el) continue;
        const v = s.get(it.key);
        if (it.type === 'range') {
          el.value = String(v);
          this._paintRange(el);
          const out = this.root.querySelector(`[data-out="${it.key}"]`);
          if (out) out.textContent = it.fmt(Number(v));
        } else if (it.type === 'toggle') {
          el.classList.toggle('on', !!v);
          el.setAttribute('aria-checked', v ? 'true' : 'false');
        } else if (it.type === 'seg') {
          for (const b of el.children) b.classList.toggle('on', b.dataset.v === String(v));
        } else if (it.type === 'text') {
          if (document.activeElement !== el) el.value = String(v ?? '');
        }
      }
    }
  }

  _fillControls() {
    const b = this.game.input.bindings || {};
    const keys = (action, all = true) => {
      const list = b[action] || [];
      const labels = [];
      for (const c of list) { const l = keyLabel(c); if (!labels.includes(l)) labels.push(l); if (!all) break; }
      return labels;
    };
    const wasd = [...keys('forward', false), ...keys('left', false), ...keys('back', false), ...keys('right', false)];
    const groups = [
      { name: 'Movement', rows: [
        ['Move', wasd], ['Jump / double jump', keys('jump')], ['Sprint', keys('sprint')],
        ['Crouch / slide', keys('crouch')], ['Grappling hook', keys('grapple')],
      ] },
      { name: 'Combat', rows: [
        ['Fire', keys('fire')], ['Aim down sights', keys('ads')], ['Reload', keys('reload')],
        ['Throw grenade (hold to cook)', keys('grenade')], ['Cycle grenade type', keys('grenadeNext')], ['Melee', keys('melee')],
        ['Select weapon', ['1–' + Math.max(...WEAPON_ORDER.map(id => WEAPONS[id].slot)), 'WHEEL']], ['Last weapon', keys('lastWeapon')],
      ] },
      { name: 'Interface', rows: [['Scoreboard (hold)', keys('scoreboard')], ['Pause', ['ESC', 'P']]] },
    ];
    this.r.ctlkeys.innerHTML = groups.map(gr => `<div class="k-sec">${gr.name}</div>`
      + gr.rows.map(([l, ks]) => `<div class="key-row"><span>${l}</span><span class="keys">${ks.map(k => `<kbd>${esc(k)}</kbd>`).join('')}</span></div>`).join('')).join('');
  }

  _fillPause() {
    const g = this.game, m = g.match;
    if (!m) { this.r.pzinfo.innerHTML = ''; return; }
    const p = g.player;
    const row = (l, v) => `<div><span>${l}</span><b>${v}</b></div>`;
    const tdm = isTeamMode(m.mode);
    const score = tdm ? `<span style="color:${hexOf(TEAM_COLORS[1])}">${m.teamScores[1] || 0}</span> : <span style="color:${hexOf(TEAM_COLORS[2])}">${m.teamScores[2] || 0}</span>`
      : m.mode === 'escalation' ? `Tier ${(p.tier | 0) + 1} / ${m.ladder ? m.ladder.length : 0}` : `${p.kills} kills`;
    this.r.pzinfo.innerHTML = row('Arena', esc(m.mapName || ''))
      + row('Mode', modeName(m.mode))
      + row('Score', score)
      + row('Time', Number.isFinite(m.timeLeft) ? fmtTime(m.timeLeft) + ' left' : fmtTime(g.time - m.startTime, false) + ' elapsed')
      + row('Bots', `${m.botCount} · ${esc(m.difficulty)}`);
  }

  _fillEnd(m) {
    const g = this.game;
    if (!m) return;
    const rows = m.results && m.results.length ? m.results : g.getScoreboard();
    const tdm = isTeamMode(m.mode);
    let kind, title, sub, tone;
    if (tdm) {
      if (!m.winnerTeam) { title = 'Draw'; sub = 'Both teams finished level'; tone = 'draw'; }
      else {
        title = m.playerWon ? 'Victory' : 'Defeat';
        sub = `${TEAM_NAMES[m.winnerTeam] || 'Team'} team wins ${m.teamScores[1] || 0} – ${m.teamScores[2] || 0}`.replace(/^(\w)/, c => c.toUpperCase());
        tone = m.playerWon ? 'win' : 'lose';
      }
      kind = modeName(m.mode);
    } else {
      const w = m.winner;
      title = m.playerWon ? 'Victory' : 'Match over';
      sub = w ? (m.playerWon ? `You won with ${w.kills} kills` : `${w.name} wins with ${w.kills} kills`) : '';
      if (w && m.mode === 'escalation') {
        const L = m.ladder ? m.ladder.length : 0;
        sub = m.reason === 'ladder' ? (m.playerWon ? 'You finished the ladder' : `${w.name} finished the ladder`) : (m.playerWon ? `You led on tier ${(w.tier | 0) + 1} / ${L}` : `${w.name} led on tier ${(w.tier | 0) + 1} / ${L}`);
      }
      tone = m.playerWon ? 'win' : 'lose';
      kind = modeName(m.mode);
    }
    const reason = m.reason === 'time' ? 'Time expired' : m.reason === 'score' ? 'Score limit reached' : m.reason === 'ladder' ? 'Last weapon kill' : '';
    this.r.endbanner.dataset.tone = tone;
    if (tdm && m.winnerTeam) this.r.endbanner.style.setProperty('--tc', hexOf(TEAM_COLORS[m.winnerTeam]));
    else this.r.endbanner.style.removeProperty('--tc');
    this.r.endkind.textContent = `${kind}${reason ? ' · ' + reason : ''}`;
    this.r.endtitle.textContent = title;
    this.r.endsub.textContent = sub;
    this.r.endinfo.textContent = `${(m.mapName || '').toUpperCase()} · ${m.botCount} BOTS · ${String(m.difficulty || '').toUpperCase()}`;
    this.r.endboard.innerHTML = scoreboardHTML(rows, m, {});

    const me = rows.find(r => r.isPlayer);
    let stats = '';
    if (me) {
      const rank = rows.indexOf(me) + 1;
      const kd = me.deaths > 0 ? (me.kills / me.deaths).toFixed(2) : me.kills.toFixed(2);
      const tile = (l, v, cls = '') => `<div class="st ${cls}"><small>${l}</small><b>${v}</b></div>`;
      stats = `<div class="k-sec">Your performance</div><div class="st-grid">`
        + tile('Kills', me.kills, 'c') + tile('Deaths', me.deaths)
        + (m.mode === 'escalation' ? tile('Tier', (me.tier | 0) + 1 + ' <em>of ' + (m.ladder ? m.ladder.length : 0) + '</em>')
          : m.mode === 'koth' ? tile('Zone time', Math.round(me.zoneTime || 0) + 's') : tile('K/D', kd))
        + tile(tdm ? 'Team' : 'Placement', tdm ? esc(TEAM_NAMES[TEAM_BLUE] || 'Blue') : ordinal(rank) + ' <em>of ' + rows.length + '</em>', tdm ? '' : 'o')
        + '</div>';
    }
    this.r.endstats.innerHTML = stats;
  }
}
