/**
 * Name tags over the other human players (online only): a pooled label above each human avatar's head, projected every
 * frame. Teammates (team modes) show within 80 m; enemies only within 60 m and in sight (a line-of-sight check per tag
 * every 0.1 s), so tags never reveal anyone behind a wall. Hidden while the scoreboard is open or the player is dead.
 */
import * as THREE from 'three';
import { isTeamMode } from '../core/constants.js';
import { hexOf } from './dom.js';

const _v = new THREE.Vector3();
const _eye = new THREE.Vector3();
const FRIEND_RANGE = 80;
const ENEMY_RANGE = 60;
const LOS_EVERY = 0.1;

export class Nameplates {
  /** @param {object} hud the HUD (its root holds the tags) @param {number} [size=16] pool size */
  constructor(hud, size = 16) {
    this.hud = hud;
    this.game = hud.game;
    this.root = document.createElement('div');
    this.root.className = 'hud-names';
    this.pool = [];
    for (let i = 0; i < size; i++) {
      const el = document.createElement('div');
      el.className = 'nm';
      el._on = false;
      el._key = '';
      this.root.appendChild(el);
      this.pool.push(el);
    }
    hud.root.appendChild(this.root);
    this._los = new Map();
  }

  /** Hide every tag. */
  clear() {
    for (const el of this.pool) if (el._on) { el._on = false; el.style.display = 'none'; }
    this._los.clear();
  }

  /** @param {number} rdt real seconds since the last frame */
  update(rdt) {
    const g = this.game, net = g.net, p = g.player, m = g.match;
    if (!net || !net.online || !m || !p || !p.alive || g.input.action('scoreboard')) { this.clear(); return; }
    const cam = g.camera, w = window.innerWidth, h = window.innerHeight;
    const team = isTeamMode(m.mode);
    p.getEyePosition(_eye);
    let n = 0;
    for (const e of g.entities) {
      if (e === p || !e.isHuman || !e.alive || n >= this.pool.length) continue;
      const friend = team && e.team === p.team;
      const d = e.position.distanceTo(_eye);
      if (d > (friend ? FRIEND_RANGE : ENEMY_RANGE)) continue;
      if (!friend) {
        // enemies: only while visible (checked at 10 Hz per player)
        let los = this._los.get(e);
        if (!los) this._los.set(e, los = { t: 0, seen: false });
        los.t -= rdt;
        if (los.t <= 0) {
          los.t = LOS_EVERY;
          _v.set(e.position.x, e.position.y + e.height - 0.1, e.position.z);
          los.seen = g.combat.canSee(_eye, _v, { smoke: true });
        }
        if (!los.seen) continue;
      }
      _v.set(e.position.x, e.position.y + e.height + 0.45, e.position.z).project(cam);
      if (_v.z > 1 || _v.x < -1.05 || _v.x > 1.05 || _v.y < -1.05 || _v.y > 1.05) continue;
      const el = this.pool[n++];
      const px = Math.round((_v.x * 0.5 + 0.5) * w), py = Math.round((-_v.y * 0.5 + 0.5) * h);
      if (!el._on) { el._on = true; el.style.display = 'block'; }
      el.style.transform = `translate(${px}px, ${py}px) translate(-50%, -100%) scale(${Math.max(0.65, Math.min(1, 14 / Math.max(1, d))).toFixed(2)})`;
      const key = e.name + '|' + e.color.getHex() + '|' + (friend ? 1 : 0);
      if (el._key !== key) {
        el._key = key;
        el.textContent = e.name;
        el.style.setProperty('--nc', hexOf(e.color.getHex()));
        el.classList.toggle('friend', friend);
      }
    }
    for (let i = n; i < this.pool.length; i++) {
      const el = this.pool[i];
      if (el._on) { el._on = false; el.style.display = 'none'; }
    }
  }
}
