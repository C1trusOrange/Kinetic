// In-game heads-up display (DOM/CSS/SVG). See ARCHITECTURE.md section 6.11.
//
// Design rules: every element is built once; per-frame work only writes to the DOM when a value
// actually changed (see the _txt/_flag/_css cache helpers); transient feedback (hit markers,
// announcements, damage numbers) uses the Web Animations API on pooled elements.

import { clamp, damp, smoothstep, DEG } from '../core/utils.js';
import { TEAM_BLUE, TEAM_RED, TEAM_NAMES, TEAM_COLORS, WEAPON_IDS, SPAWN_PROTECTION, RESPAWN_DELAY, isTeamMode } from '../core/constants.js';
import { weaponName, GRENADE, WEAPONS, GRENADE_TYPES, GRENADE_ORDER } from '../weapons/WeaponDefs.js';
import { weaponIcon, ICON } from './Icons.js';
import { esc, hexOf, fmtTime, ordinal } from './dom.js';
import { scoreboardHTML, scoreboardSignature } from './Scoreboard.js';
import { ModeHUD, modeLabel } from './ModeHUD.js';

const DI_COUNT = 8;          // damage-direction indicator pool
/** Grenade chip: glyph + colour per type, pips for the selected type's max carry. */
const GRENADE_GLYPH = { frag: ICON.grenade, vortex: ICON.grenadeVortex, static: ICON.grenadeStatic, kinetic: ICON.grenadeKinetic, smoke: ICON.grenadeSmoke };
const gHex = t => '#' + (GRENADE_TYPES[t] || GRENADE_TYPES.frag).color.toString(16).padStart(6, '0');
const GRENADE_PIPS = Math.max(...GRENADE_ORDER.map(t => GRENADE_TYPES[t].maxCarry));
const NUM_COUNT = 8;         // floating damage-number pool
const FEED_MAX = 6;
const TOAST_MAX = 4;
const MULTI_WINDOW = 4.2;    // seconds between kills that still chain
const DI_LIFE = 1.9;
/**
 * Readouts that change almost every frame (speedometer, grapple recharge ring, spawn-shield and respawn timer bars)
 * are rewritten at most ~15 times/s (the bars ease between the steps with a short CSS transition).
 */
const READOUT_DT = 1 / 15;
/** HUD.prewarm(): done after two consecutive frames shorter than this (ms), or after PREWARM_MAX_MS. */
const PREWARM_CALM_MS = 100;
const PREWARM_MAX_MS = 2500;
/** Resolves with the next requestAnimationFrame timestamp (ms). */
const rafTime = () => new Promise(resolve => requestAnimationFrame(resolve));

const MULTI_NAMES = { 2: 'DOUBLE KILL', 3: 'TRIPLE KILL', 4: 'QUAD KILL', 5: 'MULTI KILL' };
const STREAK_NAMES = { 5: 'KILLING SPREE', 8: 'RAMPAGE', 12: 'UNSTOPPABLE', 16: 'GODLIKE' };

const KF_HIT = [
  { opacity: 0, transform: 'scale(.55) rotate(-8deg)' },
  { opacity: 1, transform: 'scale(1.12) rotate(0)', offset: 0.2 },
  { opacity: 1, transform: 'scale(1) rotate(0)', offset: 0.55 },
  { opacity: 0, transform: 'scale(1.35) rotate(0)' },
];
const KF_ANNOUNCE = [
  { opacity: 0, transform: 'scale(1.7)' },
  { opacity: 1, transform: 'scale(1)', offset: 0.1 },
  { opacity: 1, transform: 'scale(1.02)', offset: 0.78 },
  { opacity: 0, transform: 'scale(.97) translateY(-.5em)' },
];
const KF_KILLTEXT = [
  { opacity: 0, transform: 'translateY(.6em) scale(.9)' },
  { opacity: 1, transform: 'translateY(0) scale(1)', offset: 0.12 },
  { opacity: 1, transform: 'translateY(0) scale(1)', offset: 0.72 },
  { opacity: 0, transform: 'translateY(-.4em) scale(1)' },
];
const KF_NUM = [
  { opacity: 0, transform: 'translate(0, .4em) scale(.7)' },
  { opacity: 1, transform: 'translate(0, -.2em) scale(1.08)', offset: 0.15 },
  { opacity: 1, transform: 'translate(var(--dx), -1.6em) scale(1)', offset: 0.6 },
  { opacity: 0, transform: 'translate(var(--dx), -2.6em) scale(.95)' },
];
const KF_SHAKE = [
  { transform: 'translateX(0)' }, { transform: 'translateX(-.35em)' }, { transform: 'translateX(.35em)' },
  { transform: 'translateX(-.25em)' }, { transform: 'translateX(0)' },
];

const NO_WEAPONS = [];
const NO_SCORES = {};

const TEMPLATE = () => `
<div class="hud-fx hud-speed" data-r="speedfx"></div>
<div class="hud-fx hud-lowhp" data-r="lowhp"><i></i></div>
<div class="hud-fx hud-flash" data-r="flash"></div>
<div class="hud-fx hud-shieldfx" data-r="shieldfx"></div>
<div class="hud-di" data-r="di">${'<div class="di"><i></i></div>'.repeat(DI_COUNT)}</div>

<div class="hud-scope" data-r="scope">
  <div class="sc-mask"></div>
  <svg class="sc-ret" viewBox="-100 -100 200 200" fill="none" stroke-linecap="butt">
    <circle r="98.6" class="sc-rim"/>
    <path class="sc-thin" d="M-98 0H-7M7 0H98M0 -98V-7M0 7V98"/>
    <path class="sc-thick" d="M-98 0H-32M32 0H98M0 98V32M0 -98V-32"/>
    <path class="sc-tick" d="M-20 -2V2M-10 -1.4V1.4M10 -1.4V1.4M20 -2V2M-1.4 10H1.4M-2 20H2M-2 30H2M-1.4 -10H1.4M-2 -20H2M-2 -30H2M-30 -2.4V2.4M30 -2.4V2.4"/>
    <circle r="0.9" class="sc-dot"/>
  </svg>
  <div class="sc-info"><span data-r="zoom">3.6x</span></div>
</div>

<div class="hud-cross" data-r="cross" data-style="ticks">
  <b class="ch t"></b><b class="ch b"></b><b class="ch l"></b><b class="ch r"></b><b class="ch dot"></b><b class="ch-ring"></b>
</div>
<div class="hud-hit" data-r="hit"><svg viewBox="-20 -20 40 40"><path d="M-14 -14L-6 -6M14 -14L6 -6M-14 14L-6 6M14 14L6 6"/></svg></div>
<div class="hud-prog" data-r="ring"><div class="pg-bar"><i data-r="ringarc"></i></div><span data-r="ringtxt"></span></div>
<div class="hud-mom" data-r="mom"><i></i><i></i><i></i><i></i><i></i></div>
<div class="hud-prompt" data-r="prompt"></div>
<div class="hud-killtext" data-r="killtext"></div>
<div class="hud-nums" data-r="nums">${'<span></span>'.repeat(NUM_COUNT)}</div>

<div class="hud-top" data-r="top">
  <div class="t-side t-left" data-r="tleft"><div class="t-lab"><small data-r="tltag">YOU</small><span data-r="tlname"></span></div><b data-r="tlscore">0</b></div>
  <div class="t-center"><div class="t-time" data-r="time">0:00</div><div class="t-sub" data-r="tsub"></div></div>
  <div class="t-side t-right" data-r="tright"><b data-r="trscore">0</b><div class="t-lab"><small data-r="trtag">RIVAL</small><span data-r="trname"></span></div></div>
</div>
<div class="hud-topleft"><div class="tl-map" data-r="mapinfo"></div><div class="tl-fps" data-r="fps"></div></div>
<div class="hud-feed" data-r="feed"></div>

<div class="hud-announce" data-r="announce"><div class="a-title" data-r="atitle"></div><div class="a-sub" data-r="asub"></div></div>
<div class="hud-toasts" data-r="toasts"></div>

<div class="hud-vitals k-cut" data-r="vitals">
  <div class="v-row v-health"><span class="v-ico">${ICON.health}</span><b class="v-num" data-r="hp">100</b>
    <div class="bar"><i class="ghost" data-r="hpghost"></i><i class="fill" data-r="hpfill"></i></div></div>
  <div class="v-row v-armor"><span class="v-ico">${ICON.armor}</span><b class="v-num" data-r="ar">0</b>
    <div class="bar"><i class="ghost" data-r="arghost"></i><i class="fill" data-r="arfill"></i></div></div>
</div>

<div class="hud-ammo k-cut" data-r="ammo">
  <div class="am-top"><span class="am-name" data-r="wname">AR-7 PULSE</span>
    <span class="am-gren" data-r="gren"><span class="g-others" data-r="gothers">${GRENADE_ORDER.map(t => `<em data-t="${t}" style="--gc:${gHex(t)}"><s></s><b>0</b></em>`).join('')}</span><span class="g-ico" data-r="gico">${ICON.grenade}</span><span class="g-pips">${'<i></i>'.repeat(GRENADE_PIPS)}</span><kbd>G</kbd><kbd class="g-x">X</kbd></span></div>
  <div class="am-main"><b class="am-mag" data-r="mag">0</b><span class="am-sep">/</span><span class="am-res" data-r="res">0</span></div>
  <div class="am-rel"><i data-r="relbar"></i></div>
  <div class="am-slots" data-r="slots">${WEAPON_IDS.map((id, i) =>
    `<div class="slot" data-id="${id}"><kbd>${WEAPONS[id] ? WEAPONS[id].slot : i + 1}</kbd>${weaponIcon(id)}</div>`).join('')}</div>
</div>

<div class="hud-move" data-r="move">
  <div class="chips" data-r="chips"><span data-k="sprint">SPRINT</span><span data-k="slide">SLIDE</span><span data-k="wall">WALL-RUN</span><span data-k="grapple">GRAPPLE</span><span data-k="mantle">MANTLE</span></div>
  <div class="mv-row">
    <div class="grap" data-r="grap"><svg viewBox="0 0 100 100"><circle class="trk" cx="50" cy="50" r="42"/><circle class="arc" data-r="grarc" cx="50" cy="50" r="42" pathLength="100" transform="rotate(-90 50 50)"/></svg><span class="g-in">${ICON.grapple}</span><kbd>E</kbd></div>
    <div class="spd" data-r="spd"><div class="spd-num"><b data-r="spdnum">0</b><small>KM/H</small></div>
      <div class="spd-bar"><i data-r="spdfill"></i><s></s><s></s><s></s><s></s></div></div>
  </div>
</div>

<div class="hud-death" data-r="death">
  <div class="d-bar d-top"></div><div class="d-bar d-bot"></div>
  <div class="d-box">
    <div class="d-tag" data-r="dtag">ELIMINATED</div>
    <div class="d-by" data-r="dby"></div>
    <div class="d-hp" data-r="dhp"></div>
    <div class="d-count"><small>RESPAWN IN</small><b data-r="dcount">3.0</b></div>
    <div class="d-prog"><i data-r="dprog"></i></div>
  </div>
</div>

<div class="hud-board" data-r="boardwrap"><div class="k-cut board-panel">
  <div class="board-head"><h3>SCOREBOARD</h3><span data-r="boardinfo"></span></div><div data-r="board"></div></div></div>
<div class="hud-hint" data-r="hint"></div>
<div class="hud-shield" data-r="shield"><span>SPAWN SHIELD</span><div><i data-r="shieldbar"></i></div></div>
`;

/**
 * The in-game HUD. Built once inside game.uiRoot; update() polls the player / weapons / match.
 */
export class HUD {
  /** @param {object} game */
  constructor(game) {
    this.game = game;
    this.visible = false;
    this._c = Object.create(null);      // last written values (write-if-changed cache)
    this._gap = 6;
    this._h = window.innerHeight || 720;
    this._lastRT = 0;
    this._offs = [];

    // transient state
    this._hitAcc = { amount: 0, count: 0, head: false, kill: false, dirty: false };
    this._numIndex = 0;
    this._feedCount = 0;
    this._streak = 0;
    this._multi = 0;
    this._lastKillAt = -99;
    this._firstBlood = false;
    this._lastKiller = null;
    this._matchPoint = 0;
    this._minuteWarned = false;
    this._tenWarned = false;
    this._scoreDirty = false;
    this._deathInfo = null;
    this._leaderId = -1;
    this._boardSig = '';
    this._boardT = 0;
    this._fpsT = 0;
    this._readoutT = 0;
    this._matchStartRT = 0;
    this._notLockedT = 0;
    this._di = [];                      // damage indicator slots
    this._annAnim = null;
    this._killAnim = null;
    this._hitAnim = null;
    this._ringMode = '';
    this._slotId = null;
    this._slotOwned = [];
    this._build();
    this.modeHud = new ModeHUD(this);   // Escalation ladder / King of the Hill widgets (src/ui/ModeHUD.js)
  }

  _build() {
    const root = document.createElement('div');
    root.className = 'k-hud';
    root.style.display = 'none';
    root.innerHTML = TEMPLATE();
    this.game.uiRoot.appendChild(root);
    this.root = root;
    this.e = Object.create(null);
    for (const n of root.querySelectorAll('[data-r]')) this.e[n.dataset.r] = n;
    const dis = this.e.di.children;
    for (let i = 0; i < dis.length; i++) this._di.push({ el: dis[i], t: 99, attacker: null, x: 0, z: 0, angle: 999, opacity: 0 });
    this.e.chipMap = {};
    for (const c of this.e.chips.children) this.e.chipMap[c.dataset.k] = c;
    this.e.slotList = Array.from(this.e.slots.children);
    this.e.momList = Array.from(this.e.mom.children);
    this.e.pips = Array.from(this.e.gren.querySelectorAll('.g-pips i'));
    this.e.gotherList = Array.from(this.e.gothers.children);
    this.e.numList = Array.from(this.e.nums.children);
    this.e.feed.addEventListener('animationend', ev => {
      if (ev.animationName === 'kf-life') { ev.target.remove(); this._feedCount--; }
    });
    this.e.toasts.addEventListener('animationend', ev => {
      if (ev.animationName === 'toast-life') ev.target.remove();
    });
  }

  init() {
    const ev = this.game.events;
    this._offs.push(
      ev.on('damage', e => this._onDamage(e)),
      ev.on('death', e => this._onDeath(e)),
      ev.on('spawn', e => this._onSpawn(e)),
      ev.on('weapon:switch', e => this._onSwitch(e)),
      ev.on('grenade:switch', e => this._onGrenadeSwitch(e)),
      ev.on('pickup', e => this._onPickup(e)),
      ev.on('reflect', e => this._onReflect(e)),
      ev.on('match:end', m => this._onMatchEnd(m)),
      ev.on('player:grapple', e => this._onGrapple(e)),
      ev.on('resize', e => { this._h = (e && e.height) || window.innerHeight || 720; }),
    );
    this._h = window.innerHeight || 720;
    this.modeHud.init();
  }

  /** Show / hide the whole HUD. */
  show(visible) {
    this.visible = !!visible;
    this.root.style.display = this.visible ? '' : 'none';
    if (this.visible) { this._c = Object.create(null); this._readoutT = 0; }
  }

  /**
   * Pre-raster the HUD while the loading overlay still covers the screen (Game calls it at the end of loading). The
   * browser's first paint of the HUD layers - clip-path panels, gradient masks, blurred shadows, SVG icons, glyphs -
   * and of the sniper scope overlay took 150-550 ms on an integrated GPU when it happened in the first playing frames
   * or at the first scope-in. Every layer is shown in its visible state above the loading screen at 1 % opacity
   * (style.css `.hud-prewarm`) until the browser has really rasterized it, then the HUD is hidden again with
   * display:none - flushed, so no layer fades out from its prewarm state when the HUD is shown for real.
   * "Really rasterized": rAF keeps firing while the compositor is still rasterizing the frame that first showed the
   * layers, so a fixed frame count let that raster (~0.6 s on the user's iGPU) land on the first playing frame
   * instead. The prewarm lasts until two consecutive frame intervals are short again (at most PREWARM_MAX_MS).
   * @returns {Promise<void>}
   */
  async prewarm() {
    const root = this.root;
    root.classList.add('hud-prewarm');
    root.style.display = '';
    try {
      const t0 = performance.now();
      let last = await rafTime();
      let calm = 0;
      for (let i = 0; calm < 2 && performance.now() - t0 < PREWARM_MAX_MS; i++) {
        const t = await rafTime();
        calm = i >= 1 && t - last < PREWARM_CALM_MS ? calm + 1 : 0;
        last = t;
      }
    } finally {
      root.style.display = 'none';
      root.classList.remove('hud-prewarm');
      void root.offsetWidth;   // commit display:none before the HUD is shown again (no transitions from prewarm)
      if (this.visible) root.style.display = '';
      this._c = Object.create(null);
    }
  }

  /** Reset all per-match HUD state (called by Game.startMatch before the match begins). */
  onMatchStart(match) {
    this._c = Object.create(null);
    this._streak = 0;
    this._multi = 0;
    this._lastKillAt = -99;
    this._firstBlood = false;
    this._lastKiller = null;
    this._matchPoint = 0;
    this._minuteWarned = false;
    this._tenWarned = false;
    this._deathInfo = null;
    this._hitAcc.dirty = false;
    this._boardSig = '';
    this._leaderId = -1;
    this._ringMode = '';
    this._slotId = null;
    this._matchStartRT = this.game.realTime;
    this.e.feed.textContent = '';
    this.e.toasts.textContent = '';
    this._feedCount = 0;
    for (const d of this._di) { d.t = 99; d.attacker = null; d.el.style.opacity = '0'; }
    if (this._annAnim) this._annAnim.cancel();
    const map = match && match.mapName ? match.mapName : '';
    const modeName = modeLabel(match && match.mode);
    this.e.mapinfo.textContent = (map + ' · ' + modeName).toUpperCase();
    this.modeHud.onMatchStart(match);
    this.announce('FIGHT', map ? map.toUpperCase() : '', 'info', 1800);
  }

  // ================================================================== cache helpers

  _txt(key, node, value) {
    if (this._c[key] !== value) { this._c[key] = value; node.textContent = value; }
  }

  /** Write a number as text only when it changed (no per-frame string allocation). */
  _num(key, node, n) {
    if (this._c[key] !== n) { this._c[key] = n; node.textContent = n; }
  }

  _flag(key, node, cls, on) {
    on = !!on;
    if (this._c[key] !== on) { this._c[key] = on; node.classList.toggle(cls, on); }
  }

  _css(key, node, prop, value) {
    if (this._c[key] !== value) { this._c[key] = value; node.style.setProperty(prop, value); }
  }

  _attr(key, node, name, value) {
    if (this._c[key] !== value) { this._c[key] = value; node.setAttribute(name, value); }
  }

  // ================================================================== events

  _onDamage(e) {
    const g = this.game, p = g.player;
    if (!p) return;
    if (e.attacker === p && e.target !== p) {
      const a = this._hitAcc;
      a.amount += e.amount || 0;
      a.count++;
      if (e.headshot) a.head = true;
      a.dirty = true;
    }
    if (e.target === p && p.alive) {
      const amt = e.amount || 0;
      const el = this.e.flash;
      el.animate([{ opacity: clamp(0.25 + amt / 60, 0.25, 0.85) }, { opacity: 0 }], { duration: 420, easing: 'ease-out' });
      if (e.weapon !== 'fall' && e.attacker !== p) this._addIndicator(e);
    }
  }

  _onDeath(e) {
    const g = this.game, p = g.player;
    const { victim, attacker } = e;
    if (!g.match) return;
    this._scoreDirty = true;
    this._addFeed(attacker, victim, e.weapon, e.headshot);

    const lines = [];
    if (attacker && attacker === p && victim !== p) {
      this._hitAcc.kill = true;
      this._hitAcc.dirty = true;
      this._streak++;
      const now = g.time;
      this._multi = now - this._lastKillAt <= MULTI_WINDOW ? this._multi + 1 : 1;
      this._lastKillAt = now;
      if (this._multi >= 2) lines.push(MULTI_NAMES[Math.min(5, this._multi)]);
      if (STREAK_NAMES[this._streak]) lines.push(STREAK_NAMES[this._streak]);
      if (!this._firstBlood) lines.push('FIRST BLOOD');
      if (victim === this._lastKiller) { lines.push('PAYBACK'); this._lastKiller = null; }
      if (e.headshot) lines.push('HEADSHOT');
      this._showKillText(victim, e.headshot);
      if (lines.length) this.announce(lines[0], lines.slice(1).join(' · '), e.headshot && lines.length === 1 ? 'gold' : 'kill');
      if (g.audio && g.audio.play) g.audio.play('kill_confirm', { volume: 0.9 });
    }
    if (attacker && attacker !== victim) this._firstBlood = true;

    if (victim === p) {
      this._streak = 0;
      this._multi = 0;
      const self = !attacker || attacker === p;
      this._deathInfo = {
        self,
        weapon: e.weapon,
        headshot: !!e.headshot,
        name: attacker && attacker !== p ? attacker.name : '',
        color: attacker ? hexOf(attacker.color) : '#ffffff',
        hp: attacker && attacker !== p && attacker.alive ? Math.ceil(attacker.health) : -1,
      };
      if (attacker && attacker !== p) this._lastKiller = attacker;
    }
  }

  _onSpawn(e) {
    if (e && e.entity === this.game.player) {
      this._deathInfo = null;
      this._c.deathOn = undefined;
      for (const d of this._di) { d.t = 99; d.attacker = null; }
    }
  }

  _onSwitch(e) {
    if (!e || e.shooter !== this.game.player) return;
    const sel = this.e.slots.querySelector('.slot[data-id="' + e.weapon + '"]');
    if (sel) sel.animate([{ transform: 'scale(1.16)' }, { transform: 'scale(1)' }], { duration: 170, easing: 'ease-out' });
  }

  /** X pressed: pop the chip and flash the selected grenade type. */
  _onGrenadeSwitch(e) {
    if (!e || !e.type || !GRENADE_TYPES[e.type]) return;
    const box = this.e.toasts;
    const old = box.querySelector('.tt-gswap');
    if (old) old.remove();
    const t = document.createElement('div');
    t.className = 'toast tt-gswap';
    t.style.setProperty('--tc', gHex(e.type));
    t.innerHTML = `<span class="t-ic">${GRENADE_GLYPH[e.type]}</span><span><b>${esc(GRENADE_TYPES[e.type].short)}</b> SELECTED</span>`;
    box.appendChild(t);
    while (box.children.length > TOAST_MAX) box.firstElementChild.remove();
    this.e.gren.animate([{ transform: 'scale(1.4)' }, { transform: 'scale(1)' }], { duration: 220, easing: 'ease-out' });
  }

  _onPickup(e) {
    if (!e || e.entity !== this.game.player || !e.pickup) return;
    const pk = e.pickup;
    let cls = 'ammo', icon = ICON.ammo, html = '<b>AMMO</b> REPLENISHED';
    switch (pk.type) {
      case 'health': cls = 'health'; icon = ICON.health; html = `<b>+${pk.amount ?? 25}</b> HEALTH`; break;
      case 'armor': cls = 'armor'; icon = ICON.armor; html = `<b>+${pk.amount ?? 50}</b> ARMOR`; break;
      case 'grenades': {
        cls = 'gren'; icon = ICON.grenade;
        const gg = pk.lastGrant;
        html = gg && gg.frag === 0 ? '' : `<b>+${gg ? gg.frag : (pk.amount ?? 2)}</b> GRENADES`;
        if (gg && gg.special) {
          icon = GRENADE_GLYPH[gg.special];
          html += `${html ? ' ' : ''}<b style="color:${gHex(gg.special)}">+1</b> ${esc(GRENADE_TYPES[gg.special].short)}`;
        }
        break;
      }
      case 'weapon': cls = 'weapon'; icon = weaponIcon(pk.weapon); html = `<b>${esc(weaponName(pk.weapon)).toUpperCase()}</b>`; break;
      default: break;
    }
    const t = document.createElement('div');
    t.className = 'toast tt-' + cls;
    t.innerHTML = `<span class="t-ic">${icon}</span><span>${html}</span>`;
    const box = this.e.toasts;
    box.appendChild(t);
    while (box.children.length > TOAST_MAX) box.firstElementChild.remove();
  }

  /** Gale reflected a rocket / grenade of an enemy: toast when it was the local player. */
  _onReflect(e) {
    if (!e || e.owner !== this.game.player) return;
    const t = document.createElement('div');
    t.className = 'toast tt-weapon';
    t.innerHTML = `<span class="t-ic">${weaponIcon('gale')}</span><span><b>REFLECTED</b></span>`;
    const box = this.e.toasts;
    box.appendChild(t);
    while (box.children.length > TOAST_MAX) box.firstElementChild.remove();
  }

  _onMatchEnd(m) {
    if (!m) return;
    let title, sub, kind;
    if (isTeamMode(m.mode)) {
      if (!m.winnerTeam) { title = 'DRAW'; sub = 'TIME EXPIRED'; kind = 'info'; }
      else { title = m.playerWon ? 'VICTORY' : 'DEFEAT'; sub = (TEAM_NAMES[m.winnerTeam] || 'Team').toUpperCase() + ' TEAM WINS'; kind = m.playerWon ? 'win' : 'alert'; }
    } else {
      title = m.playerWon ? 'VICTORY' : 'MATCH OVER';
      sub = m.winner ? (m.playerWon ? 'YOU WIN' : esc(m.winner.name).toUpperCase() + ' WINS') : '';
      kind = m.playerWon ? 'win' : 'alert';
    }
    this.announce(title, sub, kind, 2800);
  }

  _onGrapple(e) {
    if (!e) return;
    if (e.state === 'miss') {
      this.e.grap.animate(KF_SHAKE, { duration: 260 });
      this.e.grap.classList.add('miss');
      clearTimeout(this._missT);
      this._missT = setTimeout(() => this.e.grap.classList.remove('miss'), 500);
    }
  }

  // ================================================================== transient feedback

  /**
   * Show a big centre-screen announcement.
   * @param {string} title
   * @param {string} [sub]
   * @param {'info'|'kill'|'gold'|'alert'|'win'} [kind]
   * @param {number} [ms]
   */
  announce(title, sub = '', kind = 'info', ms = 2000) {
    const e = this.e;
    e.atitle.textContent = title;
    e.asub.textContent = sub;
    e.announce.dataset.kind = kind;
    if (this._annAnim) this._annAnim.cancel();
    this._annAnim = e.announce.animate(KF_ANNOUNCE, { duration: ms, easing: 'cubic-bezier(.2,.8,.25,1)' });
  }

  _showKillText(victim, headshot) {
    const el = this.e.killtext;
    el.innerHTML = `${headshot ? ICON.head : ''}<b>+1</b> <span style="color:${esc(hexOf(victim && victim.color))}">${esc(victim ? victim.name : '')}</span>`;
    el.classList.toggle('head', !!headshot);
    if (this._killAnim) this._killAnim.cancel();
    this._killAnim = el.animate(KF_KILLTEXT, { duration: 1500 });
  }

  _addFeed(attacker, victim, weapon, headshot) {
    if (!victim) return;
    const p = this.game.player;
    const row = document.createElement('div');
    const mine = attacker === p && victim !== p;
    row.className = 'kf-row' + (mine ? ' mine' : '') + (victim === p ? ' died' : '');
    const nm = (ent) => `<span class="kf-name" style="color:${esc(hexOf(ent.color))}">${esc(ent.name)}</span>`;
    const isSelf = !attacker || attacker === victim;
    const named = weapon === 'fall' || weapon === 'explosion' || weapon === 'melee' || weapon === 'grenade' || !WEAPON_IDS.includes(weapon);
    row.innerHTML = (isSelf ? '' : nm(attacker))
      + `<span class="kf-w" title="${esc(weaponName(weapon))}">${weaponIcon(weapon)}${headshot ? `<span class="kf-hs">${ICON.head}</span>` : ''}`
      + (named ? `<em>${esc(weaponName(weapon))}</em>` : '') + '</span>'
      + nm(victim);
    const feed = this.e.feed;
    feed.appendChild(row);
    this._feedCount++;
    while (feed.children.length > FEED_MAX) { feed.firstElementChild.remove(); this._feedCount--; }
  }

  _addIndicator(e) {
    const g = this.game, p = g.player;
    let x, z, attacker = e.attacker || null;
    if (attacker) { x = attacker.position.x; z = attacker.position.z; }
    else if (e.direction) { x = p.position.x - e.direction.x * 10; z = p.position.z - e.direction.z * 10; }
    else return;
    let slot = null;
    for (const d of this._di) if (attacker && d.attacker === attacker && d.t < DI_LIFE) { slot = d; break; }
    if (!slot) {
      slot = this._di[0];
      for (const d of this._di) if (d.t > slot.t) slot = d;
    }
    slot.attacker = attacker;
    slot.x = x;
    slot.z = z;
    slot.t = 0;
    slot.angle = 999;
  }

  _flushHits(rdt) {
    const a = this._hitAcc;
    if (!a.dirty) return;
    a.dirty = false;
    const g = this.game;
    const el = this.e.hit;
    el.className = 'hud-hit' + (a.kill ? ' kill' : a.head ? ' head' : '');
    if (this._hitAnim) this._hitAnim.cancel();
    this._hitAnim = el.animate(KF_HIT, { duration: a.kill ? 520 : 340, easing: 'ease-out' });

    if (a.amount > 0.5) {
      const n = this.e.numList[this._numIndex++ % NUM_COUNT];
      n.textContent = Math.round(a.amount);
      n.className = a.kill ? 'kill' : a.head ? 'head' : '';
      n.style.setProperty('--dx', (10 + Math.random() * 30).toFixed(0) + 'px');
      n.style.left = (Math.random() * 26 - 6).toFixed(0) + 'px';
      n.animate(KF_NUM, { duration: 720, easing: 'ease-out' });
    }
    if (g.audio && g.audio.play) g.audio.play(a.head ? 'headshot' : 'hitmarker', { volume: a.head ? 0.85 : 0.7 });
    a.amount = 0;
    a.count = 0;
    a.head = false;
    a.kill = false;
  }

  // ================================================================== per-frame update

  /** Poll game state and refresh the DOM (only changed values are written). */
  update(dt) {
    if (!this.visible) return;
    const g = this.game, p = g.player, w = g.weapons, m = g.match;
    if (!p || !w) return;
    let rdt = g.realTime - this._lastRT;
    this._lastRT = g.realTime;
    if (!(rdt > 0) || rdt > 0.25) rdt = 1 / 60;

    this._readoutT -= rdt;
    const readouts = this._readoutT <= 0;
    if (readouts) this._readoutT = Math.max(0, this._readoutT + READOUT_DT);

    this._updateCrosshair(rdt, p, w);
    this._updateAmmo(w);
    this._updateVitals(p, rdt);
    this._updateMove(p, readouts);
    this._updateFx(p, rdt, readouts);
    this._updateScope(p, w);
    this._updateIndicators(p, rdt);
    this._flushHits(rdt);
    if (m) {
      this._updateTop(m, p);
      this.modeHud.update(rdt, m, p);
      this._updateDeath(p, m, readouts);
      this._updateBoard(rdt, m);
    }
    this._updateHints(rdt, p);
    this._updateFps(rdt);
  }

  _updateCrosshair(rdt, p, w) {
    const g = this.game, e = this.e;
    const scoped = !!w.scoped;
    const alive = p.alive;
    this._flag('xhide', e.cross, 'off', scoped || !alive);
    if (scoped || !alive) return;
    const tanHalf = Math.tan(g.camera.fov * DEG * 0.5) || 1;
    let target = Math.tan(w.spreadAngle || 0) / tanHalf * this._h * 0.5;
    target = clamp(target, 0, 220);
    this._gap += (target - this._gap) * damp(32, rdt);
    const gap = Math.max(3, this._gap);
    if (Math.abs(gap - (this._c.gap || 0)) > 0.25) {
      this._c.gap = gap;
      this.root.style.setProperty('--gap', gap.toFixed(1) + 'px');
      this.root.style.setProperty('--ring', (gap * 2).toFixed(1) + 'px');
    }
    const id = w.currentId;
    this._attr('xstyle', e.cross, 'data-style', id === 'shotgun' ? 'ring' : id === 'rocket' ? 'rocket' : id === 'rail' ? 'rail' : id === 'arc' ? 'arc' : id === 'gale' ? 'cone' : 'ticks');
    const ads = clamp(w.adsAmount || 0, 0, 1);
    const opq = Math.round((1 - ads * 0.7) * 50) / 50;
    if (this._c.xop !== opq) { this._c.xop = opq; e.cross.style.opacity = opq; }
  }

  _updateAmmo(w) {
    const e = this.e;
    const def = w.current;
    const id = w.currentId;
    if (this._c.wid !== id || this._c.wdef !== def) {
      this._c.wid = id;
      this._c.wdef = def;
      e.wname.textContent = ((def && def.name) || weaponName(id) || '').toUpperCase();
    }
    const mag = w.ammo | 0;
    const magMax = (def && def.magSize) || 0;
    const reserve = w.reserve;
    this._num('mag', e.mag, mag);
    const resN = Number.isFinite(reserve) ? (reserve | 0) : -1;
    if (this._c.res !== resN) { this._c.res = resN; e.res.textContent = resN < 0 ? '∞' : resN; }
    const noReserve = Number.isFinite(reserve) && reserve <= 0;
    this._flag('low', e.ammo, 'low', magMax > 0 && mag <= Math.ceil(magMax * 0.25) && mag > 0);
    this._flag('empty', e.ammo, 'empty', mag <= 0);
    this._flag('nores', e.ammo, 'nores', noReserve);
    const rel = w.reloading ? clamp(w.reloadProgress || 0, 0, 1) : 0;
    const q = Math.round(rel * 200) / 200;
    if (this._c.rel !== q) { this._c.rel = q; e.relbar.style.transform = `scaleX(${q})`; }
    this._flag('reloading', e.ammo, 'reloading', !!w.reloading);

    // weapon slots
    const owned = w.owned || NO_WEAPONS;
    const cache = this._slotOwned;
    let same = this._slotId === id && cache.length === owned.length;
    for (let i = 0; same && i < owned.length; i++) if (cache[i] !== owned[i]) same = false;
    if (!same) {
      this._slotId = id;
      cache.length = 0;
      for (let i = 0; i < owned.length; i++) cache.push(owned[i]);
      for (const s of e.slotList) {
        const sid = s.dataset.id;
        s.classList.toggle('owned', owned.indexOf(sid) >= 0);
        s.classList.toggle('sel', sid === id);
      }
    }
    // grenades: type-aware chip (glyph + colour per type, pips = count of the selected type, tiny counters for the others)
    const gt = w.grenadeType || 'frag';
    const n = w.grenades | 0;
    const nades = w.nades;
    let gsig = gt + ':' + n;
    if (nades) for (let i = 0; i < GRENADE_ORDER.length; i++) gsig += ',' + (nades[GRENADE_ORDER[i]] | 0);
    if (this._c.gn !== gsig) {
      this._c.gn = gsig;
      const gdef = GRENADE_TYPES[gt] || GRENADE_TYPES.frag;
      if (this._c.gtype !== gt) {
        this._c.gtype = gt;
        e.gico.innerHTML = GRENADE_GLYPH[gt] || GRENADE_GLYPH.frag;
        e.gren.style.setProperty('--gc', gHex(gt));
      }
      for (let i = 0; i < e.pips.length; i++) {
        e.pips[i].classList.toggle('on', i < n);
        e.pips[i].style.display = i < gdef.maxCarry ? '' : 'none';
      }
      e.gren.classList.toggle('none', n <= 0);
      for (const tag of e.gotherList) {
        const t = tag.dataset.t;
        const cnt = nades ? nades[t] | 0 : 0;
        tag.style.display = t !== gt && cnt > 0 ? 'flex' : 'none';
        tag.lastChild.textContent = cnt;
      }
    }
    this._flag('cook', e.gren, 'cooking', !!w.cooking);

    // reload / cook ring around the crosshair, plus the prompt below it
    let mode = '', prog = 0;
    if (w.cookRing) { mode = 'cook'; prog = clamp(w.cookProgress || 0, 0, 1); }
    else if (w.charging) { mode = 'charge'; prog = clamp(w.chargeAmount || 0, 0, 1); }
    else if (w.reloading) { mode = 'reload'; prog = clamp(w.reloadProgress || 0, 0, 1); }
    if (mode !== this._ringMode) {
      this._ringMode = mode;
      e.ring.className = 'hud-prog' + (mode ? ' on ' + mode : '');
      e.ringtxt.textContent = mode === 'cook' ? (w._throwType === 'kinetic' ? 'CHARGING' : 'COOKING') : mode === 'reload' ? 'RELOADING' : mode === 'charge' ? 'CHARGING' : '';
      this._c.chgRdy = false;
    }
    if (mode) {
      const q = Math.round(prog * 200) / 200;
      if (this._c.ringq !== q) { this._c.ringq = q; e.ringarc.style.transform = `scaleX(${q})`; }
      this._flag('ringhot', e.ring, 'hot', (mode === 'cook' && prog > 0.72) || (mode === 'charge' && prog >= 0.999));
      if (mode === 'charge') {
        const rdy = prog >= 0.999;
        if (this._c.chgRdy !== rdy) { this._c.chgRdy = rdy; e.ringtxt.textContent = rdy ? 'READY' : 'CHARGING'; }
      }
    }
    // Slipstream momentum meter (five chevrons under the crosshair, hot above 60%)
    const sb = !!(def && def.speedBonus);
    this._flag('momon', e.mom, 'on', sb && this.game.player.alive);
    if (sb) {
      const m = w.momentum || 0;
      const lit = Math.ceil(m * 5 - 1e-3);
      if (this._c.momn !== lit) {
        this._c.momn = lit;
        for (let i = 0; i < e.momList.length; i++) e.momList[i].classList.toggle('lit', i < lit);
      }
      this._flag('momhot', e.mom, 'hot', m > 0.6);
    }
    let prompt = '';
    if (!mode && this.game.player.alive) {
      if (mag <= 0 && (reserve > 0 || !Number.isFinite(reserve))) prompt = 'RELOAD';
      else if (mag <= 0 && noReserve) prompt = 'NO AMMO';
    }
    if (this._c.prompt !== prompt) {
      this._c.prompt = prompt;
      e.prompt.textContent = prompt;
      e.prompt.classList.toggle('on', !!prompt);
      e.prompt.classList.toggle('bad', prompt === 'NO AMMO');
    }
  }

  _updateVitals(p, rdt) {
    const e = this.e;
    const hpMax = p.maxHealth || 100, arMax = p.maxArmor || 100;
    const hp = p.alive ? Math.max(0, p.health) : 0;
    const ar = p.alive ? Math.max(0, p.armor) : 0;
    this._num('hp', e.hp, Math.ceil(hp));
    this._num('ar', e.ar, Math.ceil(ar));
    const hf = Math.round(clamp(hp / hpMax, 0, 1) * 200) / 200;
    const af = Math.round(clamp(ar / arMax, 0, 1) * 200) / 200;
    if (this._c.hf !== hf) { this._c.hf = hf; e.hpfill.style.transform = `scaleX(${hf})`; e.hpghost.style.transform = `scaleX(${hf})`; }
    if (this._c.af !== af) { this._c.af = af; e.arfill.style.transform = `scaleX(${af})`; e.arghost.style.transform = `scaleX(${af})`; }
    const pct = hp / hpMax;
    this._flag('hpwarn', e.vitals, 'warn', p.alive && pct <= 0.5 && pct > 0.25);
    this._flag('hpcrit', e.vitals, 'crit', p.alive && pct <= 0.25);
    this._flag('hasar', e.vitals, 'noarmor', ar <= 0);
  }

  /**
   * @param {object} p player
   * @param {boolean} readouts refresh the fast-changing readouts (speed number / bar, grapple ring) this frame (~15 Hz)
   */
  _updateMove(p, readouts = true) {
    const e = this.e;
    const sp = Math.max(0, p.speed || 0);
    if (readouts) {
      const kmh = Math.round(sp * 3.6);
      this._num('spd', e.spdnum, kmh);
      const f = Math.round(clamp(sp / 26, 0, 1) * 100) / 100;
      if (this._c.spf !== f) { this._c.spf = f; e.spdfill.style.transform = `scaleX(${f})`; }
    }
    this._flag('fast', e.spd, 'fast', sp >= 14);
    this._flag('blaze', e.spd, 'blaze', sp >= 19);
    const cm = e.chipMap;
    this._flag('c_sprint', cm.sprint, 'on', p.isSprinting && !p.isSliding);
    this._flag('c_slide', cm.slide, 'on', p.isSliding);
    this._flag('c_wall', cm.wall, 'on', p.isWallRunning);
    this._flag('c_grapple', cm.grapple, 'on', p.isGrappling);
    this._flag('c_mantle', cm.mantle, 'on', p.isMantling);

    // grapple ring (the recharge sweep is a readout; the ready state below is not throttled)
    const ch = clamp(p.grappleCharge ?? 1, 0, 1);
    if (readouts || ch >= 0.999) {
      const off = Math.round((1 - ch) * 100);
      if (this._c.groff !== off) { this._c.groff = off; e.grarc.style.strokeDashoffset = off; }
    }
    this._flag('grready', e.grap, 'ready', ch >= 0.999);
    this._flag('gract', e.grap, 'active', !!p.isGrappling);
  }

  /**
   * @param {object} p player
   * @param {number} rdt real seconds since the last HUD frame
   * @param {boolean} [readouts=true] refresh the spawn-shield timer bar this frame (~15 Hz; always when it appears)
   */
  _updateFx(p, rdt, readouts = true) {
    const e = this.e, g = this.game;
    // speed lines
    let s = p.alive ? smoothstep(12.5, 24, p.speed || 0) : 0;
    if (p.isGrappling) s = Math.max(s, 0.35);
    s = Math.round(s * 40) / 40;
    if (this._c.sl !== s) {
      this._c.sl = s;
      e.speedfx.style.opacity = (s * 0.6).toFixed(3);
      e.speedfx.style.visibility = s > 0.01 ? 'visible' : 'hidden';
    }
    // low health vignette
    const hp = p.alive ? p.health / (p.maxHealth || 100) : 1;
    const lv = hp < 0.4 ? Math.round(((0.4 - hp) / 0.4) * 20) / 20 : 0;
    if (this._c.lv !== lv) {
      this._c.lv = lv;
      e.lowhp.style.opacity = lv.toFixed(2);
      e.lowhp.style.visibility = lv > 0 ? 'visible' : 'hidden';
    }
    this._flag('lvpulse', e.lowhp, 'pulse', hp < 0.25 && p.alive);
    // spawn protection
    const prot = p.alive && typeof p.isProtected === 'function' && p.isProtected();
    const fresh = prot && this._c.protw !== true;
    this._flag('prot', e.shieldfx, 'on', prot);
    this._flag('protw', e.shield, 'on', prot);
    if (prot && (readouts || fresh)) {
      const k = clamp((p.spawnProtectedUntil - g.time) / SPAWN_PROTECTION, 0, 1);
      const q = Math.round(k * 50) / 50;
      if (this._c.pk !== q) { this._c.pk = q; e.shieldbar.style.transform = `scaleX(${q})`; }
    }
  }

  _updateScope(p, w) {
    const e = this.e;
    const on = !!w.scoped && p.alive;
    this._flag('scope', e.scope, 'on', on);
    if (on) {
      const z = 1 / Math.max(0.05, p.fovMultiplier || 1);
      this._txt('zoom', e.zoom, z.toFixed(1) + 'x');
    }
  }

  _updateIndicators(p, rdt) {
    const yaw = p.yaw, sy = Math.sin(yaw), cy = Math.cos(yaw);
    for (const d of this._di) {
      if (d.t >= DI_LIFE) {
        if (d.opacity !== 0) { d.opacity = 0; d.el.style.opacity = '0'; }
        continue;
      }
      d.t += rdt;
      if (d.attacker && d.attacker.alive) { d.x = d.attacker.position.x; d.z = d.attacker.position.z; }
      const dx = d.x - p.position.x, dz = d.z - p.position.z;
      const fwd = -sy * dx - cy * dz;
      const right = cy * dx - sy * dz;
      const ang = Math.atan2(right, fwd) / DEG;
      if (Math.abs(ang - d.angle) > 0.6) { d.angle = ang; d.el.style.transform = `rotate(${ang.toFixed(1)}deg)`; }
      const k = 1 - d.t / DI_LIFE;
      const op = Math.round(Math.min(1, k * 1.6) * 30) / 30;
      if (op !== d.opacity) { d.opacity = op; d.el.style.opacity = op; }
    }
  }

  _updateTop(m, p) {
    const e = this.e, g = this.game, c = this._c;
    // clock: counts down with a time limit, otherwise counts up
    const limited = Number.isFinite(m.timeLeft);
    let secs, cls = '';
    if (limited) {
      secs = Math.ceil(m.timeLeft - 1e-6);
      cls = m.timeLeft <= 10 ? 'crit' : m.timeLeft <= 30 ? 'warn' : '';
      if (!this._minuteWarned && m.timeLeft <= 60 && m.timeLeft > 50 && m.timeLimit >= 2) {
        this._minuteWarned = true;
        this.announce('1 MINUTE REMAINING', '', 'info', 1700);
      }
      if (!this._tenWarned && m.timeLeft <= 10 && m.timeLeft > 0 && m.timeLimit >= 1) {
        this._tenWarned = true;
        this.announce('10 SECONDS', '', 'alert', 1200);
      }
    } else {
      secs = Math.floor(g.time - m.startTime + 1e-6);
    }
    if (c.tsecs !== secs) { c.tsecs = secs; e.time.textContent = fmtTime(secs, limited); }
    this._attr('timecls', e.time, 'data-state', cls);

    const tdm = isTeamMode(m.mode);
    const escl = m.mode === 'escalation';   // Escalation: the score is the weapon tier
    // static labels are rebuilt only when the mode / limit / team changes
    const mkey = (tdm ? 't' + p.team : 'f') + (m.scoreLimit | 0) + m.mode;
    if (c.mkey !== mkey) {
      c.mkey = mkey;
      e.tsub.textContent = escl ? 'FIRST TO FINISH THE LADDER'
        : m.scoreLimit ? (tdm ? 'FIRST TEAM TO ' : 'FIRST TO ') + m.scoreLimit + (m.mode === 'koth' ? ' POINTS' : '')
        : (tdm ? modeLabel(m.mode) : 'FREE FOR ALL');
      if (tdm) {
        e.tleft.style.setProperty('--tc', hexOf(TEAM_COLORS[TEAM_BLUE]));
        e.tright.style.setProperty('--tc', hexOf(TEAM_COLORS[TEAM_RED]));
        e.tltag.textContent = 'BLUE';
        e.trtag.textContent = 'RED';
        e.tlname.textContent = p.team === TEAM_BLUE ? 'YOUR TEAM' : '';
        e.trname.textContent = p.team === TEAM_RED ? 'YOUR TEAM' : '';
      } else {
        e.tleft.style.setProperty('--tc', '#3de0ff');
        e.tltag.textContent = 'YOU';
        c.best = undefined;
        c.rank = undefined;
      }
    }
    if (tdm) {
      const ts = m.teamScores || NO_SCORES;
      const bs = ts[TEAM_BLUE] || 0, rs = ts[TEAM_RED] || 0;
      this._num('tlscore', e.tlscore, bs);
      this._num('trscore', e.trscore, rs);
      this._scoreMatchPoint(m, bs, rs, true);
    } else {
      let best = null, bestK = -1, rank = 1;
      const ents = g.entities;
      const pk = escl ? p.tier : p.kills;
      for (let i = 0; i < ents.length; i++) {
        const o = ents[i];
        if (o === p) continue;
        const ok = escl ? o.tier : o.kills;
        if (ok > bestK) { bestK = ok; best = o; }
        if (ok > pk) rank++;
      }
      if (c.rank !== rank) { c.rank = rank; e.tlname.textContent = ordinal(rank); }
      if (c.best !== best) {
        c.best = best;
        e.tright.style.setProperty('--tc', best ? hexOf(best.color) : '#ff9a3c');
        e.trname.textContent = best ? best.name : '—';
      }
      if (escl) {
        const L = m.ladder ? m.ladder.length : 0;
        this._txt('tlscore', e.tlscore, (pk + 1) + '/' + L);
        this._txt('trscore', e.trscore, best ? (bestK + 1) + '/' + L : '-');
      } else {
        this._num('tlscore', e.tlscore, p.kills | 0);
        this._num('trscore', e.trscore, best ? bestK : 0);
      }
      this._txt('trtag', e.trtag, best && bestK > pk ? 'LEADER' : 'RIVAL');
      if (this._scoreDirty && !escl) {
        this._scoreMatchPoint(m, Math.max(pk, bestK), 0, false);
        const leader = rank === 1 && best ? p.id : (best ? best.id : -1);
        if (leader !== this._leaderId && this._leaderId !== -1 && best && bestK > 0) {
          if (leader === p.id) this.announce('YOU TOOK THE LEAD', '', 'info', 1500);
          else if (this._leaderId === p.id) this.announce('LEAD LOST', esc(best.name).toUpperCase() + ' IN FRONT', 'alert', 1500);
        }
        this._leaderId = leader;
      }
    }
    this._scoreDirty = false;
  }

  _scoreMatchPoint(m, a, b, tdm) {
    if (!m.scoreLimit || m.scoreLimit < 3 || !this._scoreDirty) return;
    const top = Math.max(a, b);
    if (top === m.scoreLimit - 1 && this._matchPoint < m.scoreLimit - 1) {
      this._matchPoint = top;
      const who = tdm ? (a > b ? 'BLUE TEAM' : 'RED TEAM') : '';
      this.announce('MATCH POINT', who, 'alert', 1800);
    }
  }

  /**
   * @param {object} p player
   * @param {object} m match
   * @param {boolean} [readouts=true] refresh the respawn progress bar this frame (~15 Hz; always when the overlay opens)
   */
  _updateDeath(p, m, readouts = true) {
    const e = this.e, g = this.game;
    const on = !p.alive && !m.over && this.game.state === 'playing';
    let opened = false;
    if (this._c.deathOn !== on) {
      this._c.deathOn = on;
      opened = on;
      e.death.classList.toggle('on', on);
      if (on) {
        const d = this._deathInfo;
        if (!d) {
          e.dtag.textContent = 'ELIMINATED';
          e.dby.innerHTML = '';
          e.dhp.textContent = '';
        } else if (d.self) {
          e.dtag.textContent = d.weapon === 'fall' ? 'YOU FELL' : (d.weapon === 'explosion' || d.weapon === 'rocket' || d.weapon === 'grenade' || d.weapon === 'vortex' || d.weapon === 'static' || d.weapon === 'kinetic') ? 'SELF-ELIMINATED' : 'ELIMINATED';
          e.dby.innerHTML = '';
          e.dhp.textContent = '';
        } else {
          e.dtag.textContent = 'ELIMINATED';
          e.dby.innerHTML = `<span>BY</span><b style="color:${esc(d.color)}">${esc(d.name)}</b>`
            + `<span class="d-w">${weaponIcon(d.weapon)}${esc(weaponName(d.weapon))}${d.headshot ? ' · HEADSHOT' : ''}</span>`;
          e.dhp.textContent = d.hp >= 0 ? `KILLER HEALTH ${d.hp}` : 'KILLER DOWN';
        }
      }
    }
    if (on) {
      const left = p.respawnAt >= 0 ? Math.max(0, p.respawnAt - g.time) : -1;
      const tenths = left < 0 ? -1 : Math.round(left * 10);
      if (this._c.dcount !== tenths) { this._c.dcount = tenths; e.dcount.textContent = tenths < 0 ? '--' : (tenths / 10).toFixed(1); }
      if (left >= 0 && (readouts || opened)) {
        const q = Math.round(clamp(1 - left / (RESPAWN_DELAY.player || 3), 0, 1) * 100) / 100;
        if (this._c.dprog !== q) { this._c.dprog = q; e.dprog.style.transform = `scaleX(${q})`; }
      }
    }
  }

  _updateBoard(rdt, m) {
    const e = this.e, g = this.game;
    const show = g.input.action('scoreboard') || (this._boardForce === true);
    this._flag('boardon', e.boardwrap, 'on', show);
    if (!show) { this._boardT = 0; return; }
    this._boardT -= rdt;
    if (this._boardT > 0) return;
    this._boardT = 0.2;
    const rows = g.getScoreboard();
    const sig = scoreboardSignature(rows, m);
    if (sig === this._boardSig) return;
    this._boardSig = sig;
    e.board.innerHTML = scoreboardHTML(rows, m, { dim: true });
    const lim = m.mode === 'escalation' ? 'FIRST TO FINISH THE LADDER'
      : m.scoreLimit ? (isTeamMode(m.mode) ? 'FIRST TEAM TO ' : 'FIRST TO ') + m.scoreLimit + (m.mode === 'koth' ? ' POINTS' : '') : 'NO SCORE LIMIT';
    e.boardinfo.textContent = `${(m.mapName || '').toUpperCase()} · ${modeLabel(m.mode)} · ${lim}`;
  }

  _updateHints(rdt, p) {
    const g = this.game, inp = g.input;
    let text = '';
    if (g.state === 'playing' && !g.autotest) {
      const sinceStart = g.realTime - this._matchStartRT;
      if (inp.lockUnavailable) {
        if (sinceStart < 14) text = 'Pointer lock is unavailable here — mouse look works while the cursor is over the game. Open the game in its own tab for full control.';
      } else if (!inp.locked) {
        this._notLockedT += rdt;
        if (this._notLockedT > 0.6) text = 'CLICK TO CAPTURE MOUSE';
      }
      if (inp.locked) this._notLockedT = 0;
    } else {
      this._notLockedT = 0;
    }
    if (this._c.hint !== text) {
      this._c.hint = text;
      this.e.hint.textContent = text;
      this.e.hint.classList.toggle('on', !!text);
    }
  }

  _updateFps(rdt) {
    const on = !!this.game.settings.get('showFps');
    this._flag('fpson', this.e.fps, 'on', on);
    if (!on) return;
    this._fpsT -= rdt;
    if (this._fpsT > 0) return;
    this._fpsT = 0.25;
    const fps = this.game.fps;
    this._txt('fps', this.e.fps, `${Math.round(fps)} FPS · ${(1000 / Math.max(1, fps)).toFixed(1)} MS`);
    this._attr('fpsq', this.e.fps, 'data-q', fps >= 55 ? 'good' : fps >= 30 ? 'ok' : 'bad');
  }
}
