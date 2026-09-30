// Spawn loadouts UI: the 'Loadouts' card on the Match Setup panel (beside the Bot arsenal card) and the Loadouts screen
// with two panels:
//   Weapon pool (match rules)  which weapons are allowed, how many each player may carry, spawn ammo and grenades.
//                              Edited by the host on Match Setup (saved as settings.loadoutPool, sent to startMatch as
//                              `pool`); READ-ONLY when opened from the pause menu (a running match keeps its rules).
//   Your loadout               the weapons you pick from the pool (up to its slot count, in your order) and the one you
//                              spawn holding (settings.playerLoadout). From the pause menu, changes apply at the next
//                              respawn.
// Menu.js owns the screen switching and forwards clicks / Esc here; the data rules live in weapons/Loadout.js.

import { WEAPONS, WEAPON_ORDER, GRENADE_TYPES, weaponName } from '../weapons/WeaponDefs.js';
import {
  DEFAULT_POOL, DEFAULT_PICK, MAX_SLOTS, sanitizePool, sanitizePick, resolveLoadout, poolEquals, pickEquals, spawnReserve,
} from '../weapons/Loadout.js';
import { esc } from './dom.js';
import { ICON, weaponIcon } from './Icons.js';

/** Weapon accents (the same colours as the Bot arsenal in Menu.js). */
const W_COLOR = {
  pistol: '#9db3c6', rifle: '#3de0ff', shotgun: '#ff9a3c', sniper: '#5dff9a', rocket: '#ff4a5a',
  smg: '#ffc23a', arc: '#b47bff', rail: '#e6f6ff', gale: '#bfeaff',
};
/** Weapon class shown under the name. */
const W_CLASS = {
  pistol: 'Pistol', rifle: 'Rifle', shotgun: 'Shotgun', sniper: 'Sniper', rocket: 'Launcher',
  smg: 'SMG', arc: 'Arc gun', rail: 'Railgun', gale: 'Repulsor',
};
/** Compact names for the 'Spawn holding' buttons. */
const W_SHORT = {
  pistol: 'Viper', rifle: 'AR-7', shotgun: 'Breacher', sniper: 'Longbow', rocket: 'Hammer',
  smg: 'Slipstream', arc: 'Tempest', rail: 'Javelin', gale: 'Gale',
};
const AMMO_LABEL = { standard: 'Standard', full: 'Full' };
const AMMO_INFO = { standard: 'Starting reserve', full: 'Max reserve' };
const NADE_LABEL = { standard: 'Standard', frag: 'Frags only', none: 'None' };
const NADE_INFO = { standard: 'Frag, smoke, special', frag: 'Frags only', none: 'Crates only' };

/** Padlock glyph for weapons outside the pool. */
const LOCK = '<svg class="ico" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6.5 10.5V8a5.5 5.5 0 0111 0v2.5H19V22H5V10.5zm2.6 0h5.8V8a2.9 2.9 0 00-5.8 0z"/></svg>';

const color = id => W_COLOR[id] || '#3de0ff';
const cls = id => W_CLASS[id] || weaponName(id);
const short = id => W_SHORT[id] || weaponName(id);
const HINT_MS = 2600;

/**
 * Loadouts card + screen. Created by Menu.init (before the menu DOM is built); Menu calls cardHTML() / screenHTML()
 * while building, bind(root) afterwards, onClick(button) first in its click handler, back() on Esc, syncCard() from
 * _syncSetup, syncPause() from _fillPause and summary() for the setup footer.
 */
export class LoadoutScreen {
  /** @param {object} menu the Menu (uses menu.game, menu._cfg.pool, menu._setCfg, menu._go) */
  constructor(menu) {
    this.menu = menu;
    this.game = menu.game;
    /** 'setup' (pool editable) | 'pause' (pool read-only, the running match's rules) */
    this.from = 'setup';
    this.el = null;
    this.r = {};
    this._hintT = { pool: 0, mine: 0 };
  }

  // ================================================================== markup

  /** The Match Setup card (an .opt block). */
  cardHTML() {
    return `
          <div class="opt lo-opt"><div class="opt-h">Loadouts <output data-lo-r="cardout"></output></div>
            <button class="ars-card lo-card" data-act="loadout" title="Weapon pool (match rules) and the weapons you spawn with">
              <span class="ars-body"><span class="lo-icons" data-lo-r="cardicons"></span><span class="lo-cardtxt" data-lo-r="cardtxt"></span></span>
              <b class="ars-go"><span>Edit</span>${ICON.arrow}</b></button></div>`;
  }

  /** The screen section. */
  screenHTML() {
    const tile = (id, attr) => `
          <button class="lo-tile" ${attr}="${id}" style="--wc:${color(id)}">
            <span class="lo-ico">${weaponIcon(id)}</span>
            <span class="lo-n"><b>${esc(weaponName(id))}</b><small>${esc(cls(id))}</small></span>
            <kbd>${WEAPONS[id].slot}</kbd><i class="lo-badge"></i>
          </button>`;
    const slots = Array.from({ length: MAX_SLOTS }, (_, i) => `<button data-v="${i + 1}">${i + 1}</button>`).join('');
    const opt2 = (map, info) => Object.keys(map).map(k => `<button data-v="${k}"><b>${map[k]}</b><small>${info[k]}</small></button>`).join('');
    return `
    <section class="k-screen s-loadout" data-screen="loadout">
      <header class="k-head"><button class="k-back" data-lo="back">${ICON.back}<span>Back</span></button>
        <div><h2>Loadouts</h2><small data-lo-r="sub">Weapon pool and the weapons you spawn with</small></div></header>
      <div class="lo-body">
        <div class="lo-panel lo-pool k-cut">
          <div class="k-sec">Weapon pool<span class="lo-tag" data-lo-r="pooltag">Match rules</span><output data-lo-r="poolcount"></output></div>
          <div class="lo-grid">${WEAPON_ORDER.map(id => tile(id, 'data-lo-pool')).join('')}</div>
          <div class="opt lo-slots"><div class="opt-h">Weapons per player <output data-lo-r="slotsout"></output></div>
            <div class="seg" data-lo-seg="slots">${slots}</div></div>
          <div class="lo-row2">
            <div class="opt"><div class="opt-h">Spawn ammo</div><div class="seg lo-seg2" data-lo-seg="ammo">${opt2(AMMO_LABEL, AMMO_INFO)}</div></div>
            <div class="opt"><div class="opt-h">Spawn grenades</div><div class="seg lo-seg2" data-lo-seg="grenades">${opt2(NADE_LABEL, NADE_INFO)}</div></div>
          </div>
          <div class="opt-note lo-note" data-lo-r="poolnote"></div>
        </div>
        <div class="lo-panel lo-mine k-cut">
          <div class="k-sec">Your loadout<span class="lo-tag lo-you">You</span><output data-lo-r="count"></output></div>
          <div class="lo-grid">${WEAPON_ORDER.map(id => tile(id, 'data-lo-pick')).join('')}</div>
          <div class="opt lo-drawopt"><div class="opt-h">Spawn holding <output data-lo-r="drawout"></output></div>
            <div class="seg lo-draw" data-lo-r="draw"></div></div>
          <div class="opt lo-atspawn"><div class="opt-h">At spawn <output data-lo-r="nades"></output></div>
            <div class="lo-ammo" data-lo-r="ammo"></div></div>
          <div class="opt-note lo-note" data-lo-r="minenote"></div>
        </div>
      </div>
      <footer class="k-foot"><div class="summary" data-lo-r="sum"></div>
        <button class="k-btn ghost" data-lo="reset-pool" data-lo-r="resetpool">Reset rules</button>
        <button class="k-btn ghost" data-lo="reset-pick">Reset my loadout</button>
        <button class="k-btn primary" data-lo="back"><span class="lbl">Done</span></button></footer>
    </section>`;
  }

  /**
   * Resolve element references once the menu DOM exists.
   * @param {HTMLElement} root the menu root
   */
  bind(root) {
    this.root = root;
    this.el = root.querySelector('[data-screen="loadout"]');
    this.r = {};
    for (const n of root.querySelectorAll('[data-lo-r]')) this.r[n.dataset.loR] = n;
    this.card = root.querySelector('.lo-card');
    this.poolTiles = {};
    this.pickTiles = {};
    for (const b of root.querySelectorAll('[data-lo-pool]')) this.poolTiles[b.dataset.loPool] = b;
    for (const b of root.querySelectorAll('[data-lo-pick]')) this.pickTiles[b.dataset.loPick] = b;
    this.segs = {};
    for (const s of root.querySelectorAll('[data-lo-seg]')) this.segs[s.dataset.loSeg] = s;
  }

  // ================================================================== data

  /** True when opened from the pause menu: the match rules are shown but cannot change. */
  get readOnly() { return this.from === 'pause'; }

  /** The pool on screen: the running match's (pause menu) or the one being set up. */
  _pool() {
    const m = this.game.match;
    if (this.readOnly && m) return sanitizePool(m.pool);
    const c = this.menu._cfg;
    return sanitizePool(c ? c.pool : this.game.settings.get('loadoutPool'));
  }

  _pick() {
    return sanitizePick(this.game.settings.get('playerLoadout'));
  }

  /**
   * Escalation fixes the spawn weapons (the ladder): the running match's mode from the pause menu, else the set-up mode.
   * @param {'setup'|'pause'} [from]
   */
  _escalation(from = this.from) {
    if (from === 'pause') return !!(this.game.match && this.game.match.mode === 'escalation');
    return !!(this.menu._cfg && this.menu._cfg.mode === 'escalation');
  }

  _setPool(pool) {
    if (this.readOnly) return;
    this._clearHints();
    this.menu._setCfg('pool', sanitizePool(pool));   // persists settings.loadoutPool + refreshes the setup panel
    this.sync();
  }

  /** Save a pick edit: what you see is what you save (the effective weapons after the edit, in your order). */
  _setPick(weapons, primary) {
    this._clearHints();
    this.game.settings.set('playerLoadout', sanitizePick({ weapons, primary }));
    this.sync();
    this.syncCard();
  }

  // ================================================================== navigation

  /**
   * Open the screen.
   * @param {'setup'|'pause'} from
   */
  open(from) {
    this.from = from === 'pause' ? 'pause' : 'setup';
    this.menu._go('loadout');
    this.sync();
  }

  /** Back to the screen it was opened from. */
  back() {
    this.menu._go(this.readOnly ? 'pause' : 'setup');
  }

  /**
   * Menu click hook (called before Menu handles the click).
   * @param {HTMLElement} t the clicked button
   * @returns {boolean} true when the click belonged to the loadout UI
   */
  onClick(t) {
    const d = t.dataset;
    if (d.act === 'loadout') {
      const from = this.menu.screen === 'pause' ? 'pause' : 'setup';
      if (!this._escalation(from)) this.open(from);   // Escalation: the card / pause entry are disabled anyway
      return true;
    }
    if (!this.el || !this.el.contains(t)) return false;
    if (d.lo === 'back') this.back();
    else if (d.lo === 'reset-pool') this._setPool(DEFAULT_POOL);
    else if (d.lo === 'reset-pick') this._setPick(DEFAULT_PICK.weapons, DEFAULT_PICK.primary);
    else if (d.loPool) this._togglePool(d.loPool);
    else if (d.loPick) this._togglePick(d.loPick);
    else if (d.loDraw) this._setPrimary(d.loDraw);
    else {
      const seg = t.closest('[data-lo-seg]');
      if (seg && d.v !== undefined) this._setOption(seg.dataset.loSeg, d.v);
    }
    if (t.blur) t.blur();
    return true;
  }

  _togglePool(id) {
    if (this.readOnly) return;
    const p = this._pool();
    if (p.weapons.includes(id)) {
      if (p.weapons.length <= 1) { this._hint('pool', 'The pool needs at least one weapon.'); return; }
      p.weapons = p.weapons.filter(w => w !== id);
    } else {
      p.weapons = [...p.weapons, id];
    }
    this._setPool(p);
  }

  _setOption(key, v) {
    if (this.readOnly) return;
    const p = this._pool();
    if (key === 'slots') p.slots = Number(v);
    else if (key === 'ammo' || key === 'grenades') p[key] = v;
    else return;
    this._setPool(p);
  }

  _togglePick(id) {
    const pool = this._pool();
    const lo = resolveLoadout(pool, this._pick());
    const cap = Math.min(pool.slots, pool.weapons.length);
    if (lo.weapons.includes(id)) {
      if (lo.weapons.length <= 1) { this._hint('mine', 'Keep at least one weapon.'); return; }
      this._setPick(lo.weapons.filter(w => w !== id), lo.primary === id ? null : lo.primary);
    } else if (!pool.weapons.includes(id)) {
      this._hint('mine', `The ${weaponName(id)} is not in the weapon pool${this.readOnly ? ' of this match' : ': allow it on the left first'}.`);
    } else if (lo.weapons.length >= cap) {
      this._hint('mine', `Your loadout is full (${lo.weapons.length}/${cap}). Remove a weapon first.`);
    } else {
      this._setPick([...lo.weapons, id], lo.primary);
    }
  }

  _setPrimary(id) {
    const lo = resolveLoadout(this._pool(), this._pick());
    if (lo.weapons.includes(id)) this._setPick(lo.weapons, id);
  }

  /** Drop pending hints so the notes describe the new state right away. */
  _clearHints() {
    for (const panel of ['pool', 'mine']) {
      clearTimeout(this._hintT[panel]);
      const el = this.r[panel === 'pool' ? 'poolnote' : 'minenote'];
      if (el) el.classList.remove('hint');
    }
  }

  _hint(panel, text) {
    const el = this.r[panel === 'pool' ? 'poolnote' : 'minenote'];
    if (!el) return;
    el.textContent = text;
    el.classList.add('hint');
    clearTimeout(this._hintT[panel]);
    this._hintT[panel] = setTimeout(() => { el.classList.remove('hint'); this.sync(); }, HINT_MS);
  }

  // ================================================================== rendering

  /** Refresh the setup card (and lock it in Escalation). */
  syncCard() {
    const r = this.r;
    if (!this.card || !r.cardicons) return;
    const esc_ = this._escalation();
    const pool = this._pool();
    const lo = resolveLoadout(pool, this._pick());
    this.card.disabled = esc_;
    this.card.classList.toggle('locked', esc_);
    const standard = poolEquals(pool, DEFAULT_POOL) && pickEquals(this._pick(), DEFAULT_PICK);
    r.cardout.textContent = esc_ ? 'Ladder' : standard ? 'Standard' : 'Custom';
    r.cardicons.innerHTML = esc_ ? '' : lo.weapons.map(id =>
      `<i class="${id === lo.primary ? 'pri' : ''}" style="--wc:${color(id)}" title="${esc(weaponName(id))}">${weaponIcon(id)}</i>`).join('');
    r.cardtxt.textContent = esc_ ? 'Fixed: the weapon ladder' : this._poolLine(pool);
  }

  /** Enable / label the pause-menu entry (Escalation: fixed ladder). */
  syncPause() {
    const b = this.root && this.root.querySelector('.s-pause [data-act="loadout"]');
    if (!b) return;
    const esc_ = !!(this.game.match && this.game.match.mode === 'escalation');
    b.disabled = esc_;
    const em = b.querySelector('em');
    if (em) em.textContent = esc_ ? 'Fixed: the weapon ladder' : 'Applies at your next respawn';
  }

  /** Match Setup footer fragment (e.g. 'LOADOUTS: 3 SLOTS' or 'LOADOUTS: 2 SLOTS, 5 WEAPONS, FULL AMMO'). */
  summary() {
    if (this._escalation()) return 'LOADOUTS: LADDER';
    return 'LOADOUTS: ' + this._poolLine(this._pool(), false).toUpperCase().replace(/ · /g, ', ');
  }

  /** Pool rules in a few words; `all` = mention 'All weapons' when nothing is excluded. */
  _poolLine(pool, all = true) {
    const n = pool.weapons.length;
    const parts = [`${pool.slots} slot${pool.slots === 1 ? '' : 's'}`];
    if (n < WEAPON_ORDER.length) parts.unshift(`${n} weapon${n === 1 ? '' : 's'}`);
    else if (all) parts.unshift('All weapons');
    if (pool.ammo === 'full') parts.push('full ammo');
    if (pool.grenades !== 'standard') parts.push(pool.grenades === 'frag' ? 'frags only' : 'no grenades');
    return parts.join(' · ');
  }

  /** Refresh the whole screen from the pool + the saved pick. */
  sync() {
    const r = this.r;
    if (!this.el || !r.poolcount) return;
    const ro = this.readOnly;
    const pool = this._pool();
    const pick = this._pick();
    const lo = resolveLoadout(pool, pick);
    const cap = Math.min(pool.slots, pool.weapons.length);
    this.el.classList.toggle('ro', ro);
    r.sub.textContent = ro ? 'Match rules are locked · your changes apply at your next respawn' : 'Weapon pool and the weapons you spawn with';
    r.pooltag.textContent = ro ? 'Locked' : 'Match rules';
    r.resetpool.style.display = ro ? 'none' : '';

    // pool panel
    r.poolcount.textContent = `${pool.weapons.length} / ${WEAPON_ORDER.length} allowed`;
    for (const id of WEAPON_ORDER) {
      const b = this.poolTiles[id];
      const on = pool.weapons.includes(id);
      b.classList.toggle('on', on);
      b.classList.toggle('off', !on);
      b.disabled = ro;
      b.querySelector('.lo-badge').innerHTML = on ? ICON.check : '';
    }
    const setSeg = (key, value) => {
      const seg = this.segs[key];
      for (const b of seg.children) {
        b.classList.toggle('on', b.dataset.v === String(value));
        b.disabled = ro;
      }
      seg.classList.toggle('locked', ro);
    };
    setSeg('slots', pool.slots);
    setSeg('ammo', pool.ammo);
    setSeg('grenades', pool.grenades);
    r.slotsout.textContent = pool.slots === 1 ? '1 weapon' : `${pool.slots} weapons`;
    if (!r.poolnote.classList.contains('hint')) {
      r.poolnote.textContent = ro
        ? 'The host set these rules when the match started. Weapon pads still hand out every weapon.'
        : `Players pick up to ${cap} weapon${cap === 1 ? '' : 's'} from the pool. Weapon pads still hand out every weapon; bots use the Bot arsenal.`;
    }

    // your loadout panel
    const order = lo.weapons;
    r.count.textContent = `${order.length} / ${cap}`;
    r.count.classList.toggle('full', order.length >= cap);
    for (const id of WEAPON_ORDER) {
      const b = this.pickTiles[id];
      const i = order.indexOf(id);
      const allowed = pool.weapons.includes(id);
      b.classList.toggle('on', i >= 0);
      b.classList.toggle('primary', id === lo.primary);
      b.classList.toggle('blocked', !allowed);
      b.classList.toggle('full', allowed && i < 0 && order.length >= cap);
      b.querySelector('.lo-badge').innerHTML = i >= 0 ? String(i + 1) : allowed ? '' : LOCK;
      b.querySelector('small').textContent = !allowed ? 'Not in pool' : id === lo.primary ? 'Spawn weapon' : cls(id);
    }
    r.draw.innerHTML = order.map(id => `<button data-lo-draw="${id}" class="${id === lo.primary ? 'on' : ''}" style="--wc:${color(id)}">${esc(short(id))}</button>`).join('');
    r.draw.classList.toggle('many', order.length > 5);
    r.drawout.textContent = weaponName(lo.primary);
    r.ammo.innerHTML = order.map(id => {
      const def = WEAPONS[id];
      const res = spawnReserve(def, pool.ammo);
      return `<span class="lo-am" style="--wc:${color(id)}" title="${esc(weaponName(id))}"><i>${weaponIcon(id)}</i><b>${def.magSize}</b><small>/ ${Number.isFinite(res) ? res : '∞'}</small></span>`;
    }).join('');
    const G = GRENADE_TYPES;
    r.nades.textContent = pool.grenades === 'none' ? 'No grenades'
      : pool.grenades === 'frag' ? `${G.frag.start} frag` : `${G.frag.start} frag · ${G.smoke.start} smoke · 1 special`;
    if (!r.minenote.classList.contains('hint')) {
      const q = lo.secondary !== lo.primary ? ` Q swaps to the ${weaponName(lo.secondary)}.` : '';
      const trimmed = pick.weapons.filter(id => !order.includes(id));
      const drop = trimmed.length ? ` Not used with these rules: ${trimmed.map(weaponName).join(', ')}.` : '';
      r.minenote.textContent = (ro ? 'Changes apply at your next respawn.' : 'Click a weapon to add or remove it.') + q + drop;
    }
    r.sum.textContent = `YOU SPAWN WITH ${order.map(id => short(id).toUpperCase()).join(' · ')}  —  HOLDING THE ${weaponName(lo.primary).toUpperCase()}`;
  }
}
