import { DEFAULT_ARSENAL, sanitizeArsenal, arsenalEquals } from '../ai/BotConfig.js';
import { XH_DEFAULTS, sanitizeCrosshairSettings, sanitizeCrosshairValue, sanitizeAdsModes, adsModesEqual, normalizeColor } from '../ui/Crosshair.js';
import { DEFAULT_POOL, DEFAULT_PICK, sanitizePool, sanitizePick, poolEquals, pickEquals } from '../weapons/Loadout.js';

const STORAGE_KEY = 'kinetic.settings.v1';

export const DEFAULT_SETTINGS = {
  // controls
  sensitivity: 1.0,      // multiplier on the base look speed
  adsSensitivity: 1.0,   // extra multiplier while aiming down sights (on top of each weapon's own zoom sensitivity)
  invertY: false,
  // view
  fov: 100,              // horizontal field of view in degrees (converted to vertical per aspect)
  viewBob: true,
  enemyOutline: true,    // coloured line around enemy bots (never through walls)
  outlineColor: '#ff2e3a',
  showFps: false,
  glow: 0.65,            // bloom / light diffusion amount, 0..1 (x the map's bloom strength); needs 'medium' or 'high' quality
  brightness: 1.0,       // exposure multiplier, 0.7..1.3 (x the map's exposure)
  quality: 'auto',       // 'auto' (preset picked from the GPU on every start, see core/GraphicsQuality.js) | 'low' | 'medium' | 'high' | 'ultra'
  renderScale: 1.0,      // 0.5..1: multiplies the preset's render resolution (the canvas stays full size)
  lowLatency: true,      // frames-in-flight limiter: skip a rAF while 2-3 earlier frames are still on the GPU (core/FrameLimiter.js)
  // audio
  masterVolume: 0.8,
  musicVolume: 0.6,      // menu / victory / defeat music, on top of the master volume
  // match defaults (remembered from the last match)
  playerName: 'Player',
  playerColor: '#9fe8ff', // your accent colour: first-person arm lights, and your name / marker in free-for-all modes
  map: 'foundry',
  mode: 'ffa',           // 'ffa' | 'tdm'
  bots: 7,
  difficulty: 'normal',  // 'easy' | 'normal' | 'hard' | 'insane'
  scoreLimit: 25,
  timeLimit: 10,         // minutes, 0 = none
  botArsenal: { ...DEFAULT_ARSENAL }, // bot spawn weapons: { pistol|rifle|shotgun|sniper|rocket: 'off'|'rare'|'normal'|'common' }
  // crosshair (src/ui/Crosshair.js): xhStyle, xhColor, xhSize, xhThickness, xhGap, xhDot, xhDotSize, xhOutline, xhOpacity,
  // xhDynamic, xhWeaponStyles, xhAds ({ weaponId: 'hide'|'fade'|'show' } while aiming down sights; frozen default)
  ...XH_DEFAULTS,
  // spawn loadouts (weapons/Loadout.js): the host's weapon pool (match rule) and this player's own pick from it
  loadoutPool: sanitizePool(DEFAULT_POOL),     // { weapons: allowed ids, slots: 1..9, ammo: 'standard'|'full', grenades: 'standard'|'frag'|'none' }
  playerLoadout: sanitizePick(DEFAULT_PICK),   // { weapons: ids in the player's order, primary: id drawn at spawn }
  // multiplayer host options (src/net): snapshot rate, room size, late joins, bots filling team gaps, team choice,
  // listed in the room list, the last room code (re-hosting keeps the code friends know)
  mpSnapHz: 60,          // 60 | 30
  mpMaxPlayers: 8,       // humans incl. the host, 2..8
  mpLateJoin: true,
  mpBotFill: true,
  mpTeams: 'auto',       // 'auto' | 'pick'
  mpPublic: true,
  mpLastCode: '',
  mpPort: 27500,         // port of the desktop app's built-in server when hosting
  mpLastServer: '',      // the last host address typed in Join (desktop app)
  mpHostOn: 'pc',        // 'pc' (the built-in server on this PC) | 'online' (an online server, server/install.sh)
  mpServer: '',          // the online server's address ('' = the one built into this copy of the game, if any)
  mpHostKey: '',         // the online server's host key (printed by server/install.sh); joining needs none
};

/** '#rrggbb' settings (validated on load and set). */
const COLOR_KEYS = ['outlineColor', 'playerColor'];

function clampNum(v, lo, hi, fallback) {
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
}

/** Persistent user settings (localStorage, failures ignored). */
export class Settings {
  constructor() {
    this.data = {
      ...DEFAULT_SETTINGS, botArsenal: { ...DEFAULT_ARSENAL }, xhAds: { ...DEFAULT_SETTINGS.xhAds },
      loadoutPool: sanitizePool(DEFAULT_POOL), playerLoadout: sanitizePick(DEFAULT_PICK),
    };
    this._listeners = [];
    this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        for (const k of Object.keys(DEFAULT_SETTINGS)) {
          if (k in parsed && typeof parsed[k] === typeof DEFAULT_SETTINGS[k]) this.data[k] = parsed[k];
        }
        // object-valued keys pass the typeof check for anything (null, arrays, junk): validate + merge with defaults
        this.data.botArsenal = sanitizeArsenal(this.data.botArsenal);
        this.data.loadoutPool = sanitizePool(this.data.loadoutPool);
        this.data.playerLoadout = sanitizePick(this.data.playerLoadout);
        // numeric sliders: keep hand-edited / stale values inside the slider ranges so UI labels and rendering agree
        this.data.glow = clampNum(this.data.glow, 0, 1, DEFAULT_SETTINGS.glow);
        this.data.brightness = clampNum(this.data.brightness, 0.7, 1.3, DEFAULT_SETTINGS.brightness);
        this.data.renderScale = clampNum(this.data.renderScale, 0.5, 1, DEFAULT_SETTINGS.renderScale);
        this.data.adsSensitivity = clampNum(this.data.adsSensitivity, 0.2, 2, DEFAULT_SETTINGS.adsSensitivity);
        this.data.mpSnapHz = this.data.mpSnapHz === 30 ? 30 : 60;
        this.data.mpMaxPlayers = Math.round(clampNum(this.data.mpMaxPlayers, 2, 8, DEFAULT_SETTINGS.mpMaxPlayers));
        if (this.data.mpTeams !== 'pick') this.data.mpTeams = 'auto';
        this.data.mpPort = Math.round(clampNum(this.data.mpPort, 1024, 65535, DEFAULT_SETTINGS.mpPort));
        if (this.data.mpHostOn !== 'online') this.data.mpHostOn = 'pc';
        this.data.mpServer = this.data.mpServer.trim().slice(0, 200);
        this.data.mpHostKey = this.data.mpHostKey.trim().slice(0, 256);
        for (const k of COLOR_KEYS) this.data[k] = normalizeColor(this.data[k]) || DEFAULT_SETTINGS[k];
        // crosshair: style / colour / slider ranges, and the per-weapon ADS map (an object key, like botArsenal)
        sanitizeCrosshairSettings(this.data);
      }
    } catch { /* storage unavailable */ }
  }

  save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data)); } catch { /* ignore */ }
  }

  get(key) {
    return this.data[key];
  }

  set(key, value) {
    if (key === 'botArsenal') {
      value = sanitizeArsenal(value);
      if (arsenalEquals(this.data.botArsenal, value)) return;
    } else if (key === 'xhAds') {
      value = sanitizeAdsModes(value);
      if (adsModesEqual(this.data.xhAds, value)) return;
    } else if (Object.hasOwn(XH_DEFAULTS, key)) {
      value = sanitizeCrosshairValue(key, value);   // crosshair: enums / colour / clamped slider ranges
      if (this.data[key] === value) return;
    } else if (key === 'loadoutPool') {
      value = sanitizePool(value);
      if (poolEquals(this.data.loadoutPool, value)) return;
    } else if (key === 'playerLoadout') {
      value = sanitizePick(value);
      if (pickEquals(this.data.playerLoadout, value)) return;
    } else if (COLOR_KEYS.includes(key)) {
      value = normalizeColor(value) || DEFAULT_SETTINGS[key];
      if (this.data[key] === value) return;
    } else if (this.data[key] === value) return;
    this.data[key] = value;
    this.save();
    for (const fn of this._listeners.slice()) {
      try { fn(key, value); } catch (err) { console.error('[settings] listener threw', err); }
    }
  }

  /** Listen for changes: fn(key, value). Returns unsubscribe. */
  onChange(fn) {
    this._listeners.push(fn);
    return () => {
      const i = this._listeners.indexOf(fn);
      if (i >= 0) this._listeners.splice(i, 1);
    };
  }

  reset() {
    for (const k of Object.keys(DEFAULT_SETTINGS)) this.set(k, DEFAULT_SETTINGS[k]);
  }
}
