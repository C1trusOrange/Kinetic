// Crosshair editor (Settings > Crosshair): live preview on dark / light / busy backgrounds with an animated spread,
// shape / colour / size controls, the per-weapon "when aiming down sights" table with presets, reset, and a share code
// (export / import) - localStorage is per origin, so a LAN player carries a crosshair between hosts with it.
// Also renders the Crosshair card on the Settings screen.
//
// Menu.js owns the routing (_go('crosshair'), Back / Done / Escape -> Settings); this module handles its own
// controls. They use data-xh / data-xw attributes (never data-set / data-opt / data-wpn / data-preset), so Menu's
// generic handlers ignore them. Every change is written straight to game.settings, which the HUD listens to: edits
// apply live, also from the pause menu.

import { WEAPON_IDS } from '../core/constants.js';
import { WEAPONS, weaponName } from '../weapons/WeaponDefs.js';
import { esc } from './dom.js';
import { ICON, weaponIcon } from './Icons.js';
import {
  XH_KEYS, XH_STYLES, XH_ADS_MODES, XH_ADS_PRESETS, XH_RANGES, XH_SWATCHES, WEAPON_XH_STYLE, DEFAULT_XH_ADS,
  readCrosshair, applyCrosshair, crosshairMarkup, encodeCrosshair, decodeCrosshair, defaultCrosshairValues,
  adsModeOf, adsModesEqual,
} from './Crosshair.js';

const DEG = Math.PI / 180;
const STYLE_LABEL = { cross: 'Cross', tee: 'Tee', circle: 'Circle', dot: 'Dot' };
const ADS_LABEL = { hide: 'Hide', fade: 'Fade', show: 'Show' };
const COLOR_NAME = { '#ffffff': 'White', '#4dff6a': 'Green', '#ffe23d': 'Yellow', '#3de0ff': 'Cyan', '#ff4dd8': 'Magenta', '#ff4040': 'Red' };
/** What the player aims with when the crosshair is hidden. */
const SIGHT_INFO = {
  pistol: 'Iron sights · front dot', rifle: 'Holo sight', shotgun: 'Ghost ring · pellet ring', sniper: 'Scope',
  rocket: 'Holo sight', smg: 'Holo sight', arc: 'Holo sight', rail: 'Holo sight', gale: 'Notch sight',
};
const SLIDERS = [
  { key: 'xhSize', label: 'Length' },
  { key: 'xhThickness', label: 'Thickness' },
  { key: 'xhGap', label: 'Gap', hint: 'Minimum' },
  { key: 'xhDotSize', label: 'Dot size' },
  { key: 'xhOutline', label: 'Outline', fmt: v => (v > 0 ? String(v) : 'Off') },
  { key: 'xhOpacity', label: 'Opacity', fmt: v => Math.round(v * 100) + '%' },
];
const TOGGLES = [
  { key: 'xhDot', label: 'Centre dot' },
  { key: 'xhDynamic', label: 'Dynamic spread', hint: 'The gap follows your accuracy' },
  { key: 'xhWeaponStyles', label: 'Weapon reticles', hint: 'Shotgun pellet ring, Javelin charge ring' },
];
const BACKGROUNDS = [['dark', 'Dark'], ['light', 'Light'], ['busy', 'Busy']];
const PREVIEW_WEAPONS = ['rifle', 'shotgun', 'rail', 'gale'];
const PREVIEW_LABEL = { rifle: 'Rifle', shotgun: 'Shotgun', rail: 'Javelin', gale: 'Gale' };

/** Crosshair editor screen + Settings card. Created by Menu.init(). */
export class CrosshairScreen {
  /** @param {import('./Menu.js').Menu} menu */
  constructor(menu) {
    this.menu = menu;
    this.game = menu.game;
    this.el = null;
    this.r = {};
    this._cfg = null;
    this._m = null;
    this._bg = 'dark';
    this._pw = 'rifle';
    this._anim = true;
    this._raf = 0;
    this._gapDev = -1;
    this._queued = false;
    this._msgT = 0;
    this._warned = false;
  }

  // ================================================================== markup

  /** @returns {string} the Crosshair screen (a .k-screen section). */
  html() {
    const seg = (key, list, label) => `<div class="seg" data-xh="${key}">${list.map(v => `<button data-v="${v}">${label(v)}</button>`).join('')}</div>`;
    const sliders = SLIDERS.map(s => {
      const [min, max, step] = XH_RANGES[s.key];
      return `<label class="xhs-row sl"><span class="xhs-l">${s.label}${s.hint ? `<small>${s.hint}</small>` : ''}</span>`
        + `<span class="xhs-c"><input type="range" class="k-range" data-xh="${s.key}" min="${min}" max="${max}" step="${step}"><output data-xo="${s.key}"></output></span></label>`;
    }).join('');
    const toggles = TOGGLES.map(t => `<label class="xhs-row"><span class="xhs-l">${t.label}${t.hint ? `<small class="xhs-sub">${t.hint}</small>` : ''}</span>`
      + `<span class="xhs-c"><button class="k-toggle" data-xh="${t.key}" role="switch"><i></i></button></span></label>`).join('');
    const swatches = XH_SWATCHES.map(c => `<button class="xhs-sw" data-xh="swatch" data-v="${c}" style="--sw:${c}" title="${COLOR_NAME[c] || c}" aria-label="${COLOR_NAME[c] || c}"></button>`).join('');
    const presets = XH_ADS_PRESETS.map(p => `<button data-v="${p.id}"><b>${esc(p.name)}</b><small>${esc(p.info)}</small></button>`).join('');
    const rows = WEAPON_IDS.filter(id => WEAPONS[id]).map(id => `
          <div class="xhs-arow" data-xw="${id}">
            <span class="xhs-aico">${weaponIcon(id)}</span>
            <span class="xhs-an"><b>${esc(weaponName(id))}</b><small>${esc(SIGHT_INFO[id] || 'Sights')}</small></span>
            <div class="seg" data-xh="ads" data-xw="${id}">${XH_ADS_MODES.map(m => `<button data-v="${m}">${ADS_LABEL[m]}</button>`).join('')}</div>
          </div>`).join('');
    return `
    <section class="k-screen s-xh" data-screen="crosshair">
      <header class="k-head"><button class="k-back" data-act="back">${ICON.back}<span>Back</span></button><span class="xhs-hico">${ICON.crosshair}</span><div><h2>Crosshair</h2><small>Style and aim-down-sights behaviour · changes apply instantly</small></div></header>
      <div class="xhs-panel k-cut">
        <div class="xhs-col xhs-a">
          <div class="k-sec">Preview</div>
          <div class="xhs-view" data-xr="view" data-bg="dark"><div class="xh" data-xr="prev" data-style="ticks">${crosshairMarkup()}</div></div>
          <div class="xhs-full" title="Preview background">${seg('bg', BACKGROUNDS.map(b => b[0]), v => BACKGROUNDS.find(b => b[0] === v)[1])}</div>
          <div class="xhs-full" title="Preview the reticle of a weapon">${seg('pw', PREVIEW_WEAPONS, v => PREVIEW_LABEL[v])}</div>
          <label class="xhs-row"><span class="xhs-l">Animate spread<small class="xhs-sub">Hip spread to full bloom</small></span><span class="xhs-c"><button class="k-toggle" data-xh="anim" role="switch"><i></i></button></span></label>
          <div class="k-sec xhs-sec">Share code</div>
          <input type="text" class="k-text xhs-code" data-xh="code" data-xr="code" maxlength="80" spellcheck="false" autocomplete="off" aria-label="Crosshair share code">
          <div class="xhs-btns"><button class="k-btn ghost" data-xh="copy">Copy</button><button class="k-btn ghost" data-xh="import">Import</button></div>
          <div class="opt-note xhs-msg" data-xr="msg"></div>
        </div>
        <div class="xhs-col xhs-b">
          <div class="k-sec">Appearance</div>
          <div class="xhs-row"><span class="xhs-l">Style</span><span class="xhs-c">${seg('xhStyle', XH_STYLES, v => STYLE_LABEL[v])}</span></div>
          <div class="xhs-row"><span class="xhs-l">Colour</span><span class="xhs-c xhs-cols">${swatches}<label class="xhs-pick" title="Custom colour"><input type="color" data-xh="xhColor" aria-label="Custom colour"><i></i></label></span></div>
          ${sliders}
          ${toggles}
        </div>
        <div class="xhs-col xhs-c3">
          <div class="k-sec">When aiming down sights</div>
          <div class="seg seg-presets xhs-presets" data-xh="adsPreset">${presets}</div>
          <div class="xhs-ads">${rows}</div>
          <div class="opt-note xhs-note">Hide: the gun's own sight is the aim point, and it stays on target while you fire and move. Fade: a faint crosshair. Show: always visible.</div>
        </div>
      </div>
      <footer class="k-foot"><div class="summary" data-xr="sum"></div><button class="k-btn ghost" data-xh="reset">Reset crosshair</button><button class="k-btn primary" data-act="back"><span class="lbl">Done</span></button></footer>
    </section>`;
  }

  /** @returns {string} the Crosshair card for the Settings screen (opens this screen through data-act="crosshair"). */
  cardHTML() {
    return `<div class="set-group"><div class="k-sec">Crosshair</div>
      <button class="ars-card xhs-card" data-act="crosshair" title="Crosshair style and aim-down-sights behaviour">
        <span class="xhs-mini"><span class="xh" data-xr="cardprev" data-style="ticks">${crosshairMarkup()}</span></span>
        <span class="xhs-ct"><b data-xr="cardname"></b><small data-xr="cardsub"></small></span>
        <b class="ars-go"><span>Edit</span>${ICON.arrow}</b></button></div>`;
  }

  // ================================================================== wiring

  /**
   * Hook up the screen and the Settings card once the menu DOM exists.
   * @param {HTMLElement} root the menu root
   */
  bind(root) {
    this.el = root.querySelector('[data-screen="crosshair"]');
    if (!this.el) { console.error('[crosshair] screen markup missing'); return; }
    for (const n of root.querySelectorAll('[data-xr]')) this.r[n.dataset.xr] = n;
    this.el.addEventListener('click', e => this._onClick(e));
    this.el.addEventListener('input', e => this._onInput(e));
    this.el.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target === this.r.code) { e.preventDefault(); this._import(); }
    });
    // re-snap the preview once the screen's entry animation has settled (a transform shifts the measured box)
    this.el.addEventListener('animationend', e => { if (e.target === this.el && this._visible()) this._renderPreview(); });
    this.game.settings.onChange(key => { if (XH_KEYS.includes(key)) this._queueSync(); });
    this.game.events.on('resize', () => { this._renderCard(); if (this._visible()) this._renderPreview(); });
    this._cfg = readCrosshair(this.game.settings);
    this._renderCard();
  }

  /** The screen was opened (Menu._go('crosshair')): sync every control and start the preview animation. */
  show() {
    this._msg('Copy the code to use this crosshair on another PC or host. Paste a code and press Import to load one.');
    this._sync();
    this._start();
  }

  _visible() {
    return !!this.el && this.menu.screen === 'crosshair' && this.menu.root.classList.contains('open');
  }

  /** Several settings change at once (reset / import / presets): sync once. */
  _queueSync() {
    if (this._queued) return;
    this._queued = true;
    queueMicrotask(() => {
      this._queued = false;
      this._cfg = readCrosshair(this.game.settings);
      this._renderCard();
      if (this._visible()) this._sync();
    });
  }

  // ================================================================== events

  _onClick(e) {
    const t = e.target.closest && e.target.closest('button');
    if (!t || t.disabled || !this.el.contains(t)) return;
    const s = this.game.settings;
    const seg = t.closest('.seg');
    const key = (seg && seg.dataset.xh) || t.dataset.xh;
    if (!key) return;
    const v = t.dataset.v;
    switch (key) {
      case 'xhStyle': s.set('xhStyle', v); break;
      case 'swatch': s.set('xhColor', v); break;
      case 'ads': {
        const id = seg.dataset.xw;
        if (id) s.set('xhAds', { ...readCrosshair(s).ads, [id]: v });
        break;
      }
      case 'adsPreset': {
        const p = XH_ADS_PRESETS.find(x => x.id === v);
        if (p) {
          const ads = {};
          for (const id of WEAPON_IDS) ads[id] = p.mode || DEFAULT_XH_ADS[id] || 'fade';
          s.set('xhAds', ads);
        }
        break;
      }
      case 'xhDot': case 'xhDynamic': case 'xhWeaponStyles': s.set(key, !s.get(key)); break;
      case 'bg': this._bg = v; this.r.view.dataset.bg = v; this._syncLocal(); break;
      case 'pw': this._pw = v; this._syncLocal(); this._renderPreview(); break;
      case 'anim': this._anim = !this._anim; this._syncLocal(); break;
      case 'copy': this._copy(); break;
      case 'import': this._import(); break;
      case 'reset': {
        const d = defaultCrosshairValues();
        for (const k of XH_KEYS) s.set(k, d[k]);
        this._msg('Crosshair reset to the defaults.', 'ok');
        break;
      }
      default: return;
    }
    if (key !== 'copy' && t.blur) t.blur();
  }

  _onInput(e) {
    const t = e.target;
    const key = t.dataset && t.dataset.xh;
    if (!key) return;
    const s = this.game.settings;
    if (t.type === 'range' && XH_RANGES[key]) {
      s.set(key, Number(t.value));
      this._paintRange(t);
    } else if (t.type === 'color' && key === 'xhColor') {
      s.set('xhColor', t.value);
    }
  }

  // ================================================================== share code

  async _copy() {
    const code = encodeCrosshair(this.game.settings);
    const inp = this.r.code;
    inp.value = code;
    let ok = false;
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(code);
        ok = true;
      } catch (err) {
        this._warnOnce('clipboard write failed, falling back to execCommand', err);
      }
    }
    if (!ok) {
      // http://<host-ip> (LAN) is not a secure context: no async clipboard there
      inp.focus();
      inp.select();
      try { ok = document.execCommand('copy'); } catch (err) { this._warnOnce('execCommand copy failed', err); }
    }
    this._msg(ok ? 'Copied: paste it into Import on the other PC.' : 'Select the code and press Ctrl+C to copy it.', ok ? 'ok' : '');
  }

  _import() {
    const vals = decodeCrosshair(this.r.code.value);
    if (!vals) {
      this._msg('That is not a crosshair code: codes start with XH1-.', 'bad');
      return;
    }
    const s = this.game.settings;
    for (const k of XH_KEYS) s.set(k, vals[k]);
    this.r.code.blur();
    this._msg('Crosshair imported.', 'ok');
  }

  _warnOnce(text, err) {
    if (this._warned) return;
    this._warned = true;
    console.warn('[crosshair] ' + text, err);
  }

  _msg(text, kind = '') {
    const el = this.r.msg;
    if (!el) return;
    el.textContent = text;
    el.dataset.kind = kind;
  }

  // ================================================================== sync / render

  /** Paint every control from settings (+ preview, card, summary). */
  _sync() {
    const cfg = this._cfg = readCrosshair(this.game.settings);
    const el = this.el;
    const setSeg = (seg, value) => {
      if (!seg) return;
      for (const b of seg.children) b.classList.toggle('on', b.dataset.v === value);
      seg.dataset.value = value;
    };
    setSeg(el.querySelector('.seg[data-xh="xhStyle"]'), cfg.style);
    for (const b of el.querySelectorAll('.xhs-sw')) b.classList.toggle('on', b.dataset.v === cfg.color);
    const pick = el.querySelector('input[type="color"][data-xh="xhColor"]');
    if (pick && document.activeElement !== pick) pick.value = cfg.color;
    pick.closest('.xhs-pick').classList.toggle('on', !XH_SWATCHES.includes(cfg.color));
    pick.closest('.xhs-pick').style.setProperty('--sw', cfg.color);
    const vals = { xhSize: cfg.size, xhThickness: cfg.thickness, xhGap: cfg.gap, xhDotSize: cfg.dotSize, xhOutline: cfg.outline, xhOpacity: cfg.opacity };
    for (const sl of SLIDERS) {
      const inp = el.querySelector(`input[data-xh="${sl.key}"]`);
      const v = vals[sl.key];
      if (inp && document.activeElement !== inp) inp.value = String(v);
      if (inp) this._paintRange(inp);
      const out = el.querySelector(`[data-xo="${sl.key}"]`);
      if (out) out.textContent = sl.fmt ? sl.fmt(v) : String(v);
    }
    const dotRow = el.querySelector('input[data-xh="xhDotSize"]').closest('.xhs-row');
    dotRow.classList.toggle('dim', !cfg.dot && cfg.style !== 'dot');
    const tog = { xhDot: cfg.dot, xhDynamic: cfg.dynamic, xhWeaponStyles: cfg.weaponStyles };
    for (const k of Object.keys(tog)) {
      const b = el.querySelector(`.k-toggle[data-xh="${k}"]`);
      b.classList.toggle('on', tog[k]);
      b.setAttribute('aria-checked', tog[k] ? 'true' : 'false');
    }
    for (const seg of el.querySelectorAll('.seg[data-xh="ads"]')) setSeg(seg, adsModeOf(cfg.ads, seg.dataset.xw));
    const preset = XH_ADS_PRESETS.find(p => {
      const target = {};
      for (const id of WEAPON_IDS) target[id] = p.mode || DEFAULT_XH_ADS[id] || 'fade';
      return adsModesEqual(target, cfg.ads);
    });
    setSeg(el.querySelector('.seg[data-xh="adsPreset"]'), preset ? preset.id : '');
    if (document.activeElement !== this.r.code) this.r.code.value = encodeCrosshair(this.game.settings);
    this.r.sum.textContent = this._summary(cfg).toUpperCase();
    this._syncLocal();
    this._renderPreview();
    this._renderCard();
  }

  /** Preview-only controls (background / weapon / animation). */
  _syncLocal() {
    const el = this.el;
    for (const [key, value] of [['bg', this._bg], ['pw', this._pw]]) {
      const seg = el.querySelector(`.seg[data-xh="${key}"]`);
      for (const b of seg.children) b.classList.toggle('on', b.dataset.v === value);
    }
    const a = el.querySelector('.k-toggle[data-xh="anim"]');
    a.classList.toggle('on', this._anim);
    a.setAttribute('aria-checked', this._anim ? 'true' : 'false');
  }

  _summary(cfg) {
    const hidden = WEAPON_IDS.filter(id => adsModeOf(cfg.ads, id) === 'hide').length;
    const colour = COLOR_NAME[cfg.color] || cfg.color;
    return `${STYLE_LABEL[cfg.style]} · ${colour} · ${cfg.dynamic ? 'dynamic spread' : 'fixed gap'} · hidden when aiming on ${hidden} of ${WEAPON_IDS.length} weapons`;
  }

  _paintRange(input) {
    const min = Number(input.min), max = Number(input.max);
    const pct = max > min ? ((Number(input.value) - min) / (max - min)) * 100 : 0;
    input.style.setProperty('--pct', pct.toFixed(1) + '%');
  }

  /** Settings card: mini preview + one-line description. */
  _renderCard() {
    const r = this.r;
    if (!r.cardprev) return;
    const cfg = this._cfg || readCrosshair(this.game.settings);
    const dpr = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    const emPx = parseFloat(getComputedStyle(this.menu.root).fontSize) || 16;
    applyCrosshair(r.cardprev, cfg, { emPx, dpr });
    r.cardprev.style.setProperty('--gap', Math.round(Math.max(cfg.gap, 3) * dpr) / dpr + 'px');
    const hidden = WEAPON_IDS.filter(id => adsModeOf(cfg.ads, id) === 'hide').length;
    r.cardname.textContent = `${STYLE_LABEL[cfg.style]} · ${COLOR_NAME[cfg.color] || cfg.color.toUpperCase()}`;
    r.cardsub.textContent = hidden ? `Hidden when aiming on ${hidden} of ${WEAPON_IDS.length} weapons` : 'Visible when aiming';
  }

  /** Preview crosshair: geometry for the menu's em size, anchored on a whole device pixel at the box centre. */
  _renderPreview() {
    const view = this.r.view, el = this.r.prev;
    if (!view || !el) return;
    const cfg = this._cfg || readCrosshair(this.game.settings);
    const dpr = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    const emPx = parseFloat(getComputedStyle(view).fontSize) || 16;
    this._m = applyCrosshair(el, cfg, { emPx, dpr });
    el.dataset.style = cfg.weaponStyles ? (WEAPON_XH_STYLE[this._pw] || 'ticks') : 'ticks';
    const rect = view.getBoundingClientRect();
    if (rect.width > 0) {
      const x = Math.round((rect.left + view.clientLeft + view.clientWidth / 2) * dpr) / dpr - rect.left - view.clientLeft;
      const y = Math.round((rect.top + view.clientTop + view.clientHeight / 2) * dpr) / dpr - rect.top - view.clientTop;
      el.style.left = x + 'px';
      el.style.top = y + 'px';
    }
    this._gapDev = -1;
    this._tick(performance.now());
  }

  _start() {
    if (this._raf) return;
    const step = now => {
      if (!this._visible()) { this._raf = 0; return; }
      this._raf = requestAnimationFrame(step);
      this._tick(now);
    };
    this._raf = requestAnimationFrame(step);
  }

  /**
   * Preview gap: the preview weapon's real hip spread at the current FOV setting and window height (like the HUD),
   * breathing up to its maximum bloom while "Animate spread" is on.
   */
  _tick(now) {
    const cfg = this._cfg, m = this._m, el = this.r.prev;
    if (!cfg || !m || !el) return;
    const def = WEAPONS[this._pw] || WEAPONS.rifle;
    const sp = def.spread || { hip: 0.01, max: 0.04 };
    const wave = this._anim ? 0.5 - 0.5 * Math.cos((now / 1000) * (Math.PI * 2 / 1.9)) : 0;
    const angle = sp.hip + wave * Math.max(0.02, sp.max || 0);
    const vfov = typeof this.game.getBaseFov === 'function' ? this.game.getBaseFov() : 70;
    const tanHalf = Math.tan(vfov * DEG * 0.5) || 1;
    const css = Math.min(220, Math.tan(angle) / tanHalf * (window.innerHeight || 720) * 0.5);
    const style = el.dataset.style;
    const functional = style === 'ring' || style === 'rail';
    const minGap = functional ? Math.round(3 * m.dpr) : m.gap;
    const gap = functional || cfg.dynamic ? Math.max(minGap, Math.round(css * m.dpr)) : minGap;
    if (gap === this._gapDev) return;
    this._gapDev = gap;
    el.style.setProperty('--gap', gap / m.dpr + 'px');
    el.classList.toggle('g0', gap === 0);
  }
}
