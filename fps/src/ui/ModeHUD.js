// HUD parts of the two objective modes (kept out of HUD.js): the Escalation weapon-ladder strip, the King of the Hill
// zone widget + world-space zone markers, and the announcements / stingers for both. HUD.js creates one instance,
// forwards init / onMatchStart / update, and uses the mode name helpers below.

import * as THREE from 'three';
import { clamp } from '../core/utils.js';
import { TEAM_NAMES } from '../core/constants.js';
import { weaponName } from '../weapons/WeaponDefs.js';
import { weaponIcon, ICON } from './Icons.js';

/** Display names of the game modes. */
export const MODE_LABEL = { ffa: 'FREE FOR ALL', tdm: 'TEAM DEATHMATCH', escalation: 'ESCALATION', koth: 'KING OF THE HILL' };
export const MODE_SHORT = { ffa: 'FFA', tdm: 'TEAM DM', escalation: 'ESCALATION', koth: 'KOTH' };
export const MODE_NAME = { ffa: 'Free for all', tdm: 'Team deathmatch', escalation: 'Escalation', koth: 'King of the Hill' };
export const modeName = m => MODE_NAME[m] || MODE_NAME.ffa;
export const modeLabel = m => MODE_LABEL[m] || MODE_LABEL.ffa;
export const modeShort = m => MODE_SHORT[m] || MODE_SHORT.ffa;

const _v = new THREE.Vector3();
const M_X = 0.8, M_Y_TOP = 0.7, M_Y_BOT = -0.62;   // marker clamp box in NDC (keeps clear of the top bar / ammo panel)

export class ModeHUD {
  /** @param {import('./HUD.js').HUD} hud */
  constructor(hud) {
    this.hud = hud;
    this.game = hud.game;
    this._c = Object.create(null);
    this._offs = [];
    this._mode = null;
    this._tier = -1;
    this._flip = false;
    this._contestAt = -99;
    this._w = 1280;
    this._h = 720;

    const root = hud.root;
    const mk = (cls, html) => {
      const d = document.createElement('div');
      d.className = cls;
      d.innerHTML = html;
      root.appendChild(d);
      return d;
    };
    this.ladder = mk('hud-ladder', '');
    this.hill = mk('hud-hill', '<div class="hh-row"><b class="hh-name"></b><span class="hh-pill"></span></div>'
      + '<div class="hh-bar"><i></i></div><div class="hh-time"></div>');
    this.hhName = this.hill.querySelector('.hh-name');
    this.hhPill = this.hill.querySelector('.hh-pill');
    this.hhBar = this.hill.querySelector('.hh-bar i');
    this.hhTime = this.hill.querySelector('.hh-time');
    const markHTML = '<div class="zm-in"><svg class="zm-arr" viewBox="-10 -10 20 20"><path d="M-8 6L0 -7L8 6L0 2.5z"/></svg><span class="zm-txt"></span></div>';
    this.mark = mk('hud-zmark', markHTML);
    this.markNext = mk('hud-zmark next', markHTML);
    for (const m of [this.mark, this.markNext]) {
      m._arr = m.querySelector('.zm-arr');
      m._txt = m.querySelector('.zm-txt');
    }
  }

  init() {
    const ev = this.game.events;
    this._offs.push(
      ev.on('esc:tier', e => this._onTier(e)),
      ev.on('esc:final', e => this._onFinal(e)),
      ev.on('hill:move', e => this._onMove(e)),
      ev.on('hill:relocate', e => this._onRelocate(e)),
      ev.on('hill:preview', e => this._onPreview(e)),
      ev.on('hill:capture', e => this._onCapture(e)),
      ev.on('hill:contested', () => this._onContested()),
      ev.on('hill:score', e => this._onScore(e)),
      ev.on('resize', e => { this._w = (e && e.width) || window.innerWidth || 1280; this._h = (e && e.height) || window.innerHeight || 720; }),
    );
    this._w = window.innerWidth || 1280;
    this._h = window.innerHeight || 720;
  }

  onMatchStart(m) {
    this._c = Object.create(null);
    this._mode = m ? m.mode : null;
    this._tier = -1;
    this._flip = false;
    this._contestAt = -99;
    const escalation = this._mode === 'escalation';
    this.ladder.classList.toggle('on', escalation);
    this.hill.classList.toggle('on', this._mode === 'koth');
    this.mark.classList.remove('on');
    this.markNext.classList.remove('on');
    if (escalation) this._buildLadder(m.ladder || []);
  }

  // ---------------------------------------------------------------- Escalation ladder

  _buildLadder(ids) {
    const n = ids.length;
    let html = '<div class="lc-head">LADDER</div>';
    // top of the strip = the final weapon
    for (let i = n - 1; i >= 0; i--) {
      html += `<div class="lc${i === n - 1 ? ' fin' : ''}" data-i="${i}"><b>${i + 1}</b>${weaponIcon(ids[i])}<i class="lc-ck">${ICON.check}</i></div>`;
    }
    this.ladder.innerHTML = html;
    this._chips = Array.from(this.ladder.querySelectorAll('.lc'));
    this._chips.reverse();   // index = tier
  }

  _paintLadder(tier) {
    const chips = this._chips || [];
    for (let i = 0; i < chips.length; i++) {
      const c = chips[i];
      c.classList.toggle('cur', i === tier);
      c.classList.toggle('done', i < tier);
    }
    if (this._flip && chips[tier]) {
      this._flip = false;
      chips[tier].animate([{ transform: 'perspective(200px) rotateX(85deg)', opacity: 0.2 }, { transform: 'perspective(200px) rotateX(0)', opacity: 1 }],
        { duration: 380, easing: 'cubic-bezier(.2,.8,.25,1)' });
    }
  }

  _onTier(e) {
    const g = this.game, p = g.player, m = g.match;
    if (!m || !e || e.entity !== p) return;
    const L = m.ladder ? m.ladder.length : 0;
    const name = weaponName(e.weapon).toUpperCase();
    if (e.delta > 0) {
      if (e.tier < L - 1) this.hud.announce(`TIER ${e.tier + 1} / ${L}`, (e.cause === 'humiliation' ? 'HUMILIATION · ' : '') + name, 'gold', 1500);
      g.audio.play('tier_up', { volume: 0.9 });
    } else {
      this.hud.announce('TIER DOWN', e.cause === 'humiliated' ? 'HUMILIATED BY A MELEE KILL' : name, 'alert', 1500);
      g.audio.play('tier_down', { volume: 0.9 });
    }
    this._flip = true;
    this._tier = -1;   // repaint on the next update
  }

  _onFinal(e) {
    const g = this.game, p = g.player;
    if (!e || !e.entity || !g.match) return;
    if (e.entity === p) {
      const m = g.match;
      const id = m.ladder ? m.ladder[m.ladder.length - 1] : '';
      this.hud.announce('FINAL WEAPON', weaponName(id).toUpperCase() + ' · ONE KILL TO WIN', 'alert', 2400);
      this.hud.e.flash.animate([{ opacity: 0.7 }, { opacity: 0 }], { duration: 900, easing: 'ease-out' });
    } else {
      this.hud.announce(e.entity.name.toUpperCase() + ' IS ON THE FINAL WEAPON', 'STOP THEM', 'alert', 2400);
    }
  }

  // ---------------------------------------------------------------- King of the Hill events

  _onMove(e) {
    if (!e || !e.zone) return;
    this.hud.announce('HILL LIVE: ' + e.zone.name.toUpperCase(), 'HOLD THE ZONE', 'info', 1900);
    this.game.audio.play('hill_move', { volume: 0.9 });
  }

  _onRelocate(e) {
    if (!e || !e.next) return;
    this.hud.announce('RELOCATING', 'NEXT: ' + e.next.name.toUpperCase(), 'alert', 1900);
    this.game.audio.play('hill_move', { volume: 0.7 });
  }

  _onPreview(e) {
    if (!e || !e.next) return;
    this.hud.announce('NEXT ZONE: ' + e.next.name.toUpperCase(), 'ZONE MOVES SOON', 'info', 1500);
  }

  _onCapture(e) {
    const g = this.game, p = g.player;
    if (!e || !g.match) return;
    if (e.team === p.team) {
      this.hud.announce((TEAM_NAMES[e.team] || 'YOUR TEAM').toUpperCase() + ' HOLDING', 'ZONE CAPTURED', 'win', 1500);
      g.audio.play('hill_capture', { volume: 0.85 });
    } else if (e.prev === p.team) {
      this.hud.announce('HILL LOST', (TEAM_NAMES[e.team] || 'ENEMY').toUpperCase() + ' HOLDING', 'alert', 1500);
      g.audio.play('hill_lost', { volume: 0.85 });
    } else {
      this.hud.announce((TEAM_NAMES[e.team] || 'ENEMY').toUpperCase() + ' HOLDING', 'TAKE IT BACK', 'alert', 1500);
      g.audio.play('hill_lost', { volume: 0.6 });
    }
  }

  _onContested() {
    const g = this.game;
    if (g.realTime - this._contestAt < 5) return;
    this._contestAt = g.realTime;
    this.hud.announce('HILL CONTESTED', '', 'gold', 1100);
    g.audio.play('hill_contested', { volume: 0.8 });
  }

  _onScore(e) {
    const g = this.game, p = g.player;
    if (!e || e.team !== p.team) return;
    if (e.reason === 'hold') g.audio.play('hill_tick', { volume: 0.8 });
    else if (e.reason === 'kill') this.hud.announce('+' + e.n + ' ZONE KILL', 'TEAM POINT', 'gold', 1000);
  }

  // ---------------------------------------------------------------- per frame

  update(rdt, m, p) {
    if (m.mode === 'escalation') {
      if (this._tier !== p.tier) {
        this._tier = p.tier;
        this._paintLadder(p.tier);
      }
    } else if (m.mode === 'koth' && m.koth) {
      this._updateHill(m.koth, p);
    }
  }

  _txt(key, node, value) {
    if (this._c[key] !== value) { this._c[key] = value; node.textContent = value; }
  }

  _updateHill(k, p) {
    const c = this._c;
    const live = k.phase === 'live';
    const z = k.zones[k.index];
    this._txt('hn', this.hhName, z ? z.name.toUpperCase() : 'NO ZONE');
    let state, pill;
    if (!live) { state = 'idle'; pill = k.phase === 'countdown' ? 'GET READY' : 'RELOCATING'; }
    else if (k.contested) { state = 'contested'; pill = 'CONTESTED'; }
    else if (k.owner) { state = k.owner === 1 ? 'blue' : 'red'; pill = (TEAM_NAMES[k.owner] || '').toUpperCase() + ' HOLDING'; }
    else { state = 'neutral'; pill = 'NEUTRAL'; }
    if (c.hs !== state) { c.hs = state; this.hill.dataset.state = state; }
    this._txt('hp', this.hhPill, pill);
    const prog = live && k.owner ? Math.round(clamp(k.progress, 0, 1) * 100) / 100 : 0;
    if (c.hb !== prog) { c.hb = prog; this.hhBar.style.transform = `scaleX(${prog})`; }
    const secs = Math.max(0, Math.ceil(k.left - 1e-6));
    const label = !live ? 'LIVE IN ' + secs : 'MOVES IN ' + secs;
    this._txt('ht', this.hhTime, label);
    const warn = live && k.previewed;
    if (c.hw !== warn) { c.hw = warn; this.hill.classList.toggle('warn', warn); }

    // world markers (hidden after the match, while the scoreboard is open, and while dead)
    const over = !!(this.game.match && this.game.match.over);
    if (c.ho !== over) { c.ho = over; this.hill.classList.toggle('done', over); }
    const alive = p.alive && !over && !this.game.input.action('scoreboard');
    let main = null, nextZ = null, mainLabel = '', mainState = state;
    if (live) {
      main = z;
      if (k.previewed) nextZ = k.zones[(k.index + 1) % k.zones.length];
    } else {
      main = z;
      mainLabel = 'NEXT: ';
      mainState = 'idle';
    }
    this._marker(this.mark, alive ? main : null, mainLabel, mainState, p);
    this._marker(this.markNext, alive ? nextZ : null, 'NEXT: ', 'idle', p);
  }

  _marker(el, z, prefix, state, p) {
    if (!z) {
      if (el._on) { el._on = false; el.classList.remove('on'); }
      return;
    }
    const cam = this.game.camera;
    _v.set(z.pos.x, z.pos.y + 3.4, z.pos.z).project(cam);
    let x = _v.x, y = _v.y;
    const behind = _v.z > 1;
    if (behind) { x = -x; y = -y; }
    let ax = x, ay = y;
    const off = behind || Math.abs(x) > M_X || y > M_Y_TOP || y < M_Y_BOT;
    if (off) {
      const s = Math.max(Math.abs(x) / M_X, y > 0 ? y / M_Y_TOP : y / M_Y_BOT, 1e-3);
      ax = x / s; ay = y / s;
    }
    const px = Math.round((ax * 0.5 + 0.5) * this._w);
    const py = Math.round((-ay * 0.5 + 0.5) * this._h);
    if (!el._on) { el._on = true; el.classList.add('on'); }
    if (el._px !== px || el._py !== py) { el._px = px; el._py = py; el.style.transform = `translate(${px}px, ${py}px)`; }
    if (el._state !== state) { el._state = state; el.dataset.state = state; }
    // the arrow points towards an off-screen zone, and down at an on-screen one
    const rot = off ? Math.round(Math.atan2(ax, ay * (this._h / this._w)) * 57.2958) : 180;
    if (el._rot !== rot) { el._rot = rot; el._arr.style.transform = `rotate(${rot}deg)`; }
    const dx = z.pos.x - p.position.x, dy = z.pos.y - p.position.y, dz = z.pos.z - p.position.z;
    const dist = Math.round(Math.sqrt(dx * dx + dy * dy + dz * dz));
    const text = prefix + z.name.toUpperCase() + ' · ' + dist + ' M';
    if (el._label !== text) { el._label = text; el._txt.textContent = text; }
  }
}
