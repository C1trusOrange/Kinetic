import { DEFAULT_ARSENAL, sanitizeArsenal, arsenalEquals } from '../ai/BotConfig.js';

const STORAGE_KEY = 'kinetic.settings.v1';

export const DEFAULT_SETTINGS = {
  // controls
  sensitivity: 1.0,      // multiplier on the base look speed
  invertY: false,
  // view
  fov: 100,              // horizontal field of view in degrees (converted to vertical per aspect)
  viewBob: true,
  showFps: false,
  glow: 0.65,            // bloom / light diffusion amount, 0..1 (x the map's bloom strength); needs 'medium' or 'high' quality
  brightness: 1.0,       // exposure multiplier, 0.7..1.3 (x the map's exposure)
  quality: 'auto',       // 'auto' (preset picked from the GPU on every start, see core/GraphicsQuality.js) | 'low' | 'medium' | 'high' | 'ultra'
  renderScale: 1.0,      // 0.5..1: multiplies the preset's render resolution (the canvas stays full size)
  lowLatency: true,      // frames-in-flight limiter: skip a rAF while 2-3 earlier frames are still on the GPU (core/FrameLimiter.js)
  // audio
  masterVolume: 0.8,
  // match defaults (remembered from the last match)
  playerName: 'Player',
  map: 'foundry',
  mode: 'ffa',           // 'ffa' | 'tdm'
  bots: 7,
  difficulty: 'normal',  // 'easy' | 'normal' | 'hard' | 'insane'
  scoreLimit: 25,
  timeLimit: 10,         // minutes, 0 = none
  botArsenal: { ...DEFAULT_ARSENAL }, // bot spawn weapons: { pistol|rifle|shotgun|sniper|rocket: 'off'|'rare'|'normal'|'common' }
};

function clampNum(v, lo, hi, fallback) {
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
}

/** Persistent user settings (localStorage, failures ignored). */
export class Settings {
  constructor() {
    this.data = { ...DEFAULT_SETTINGS, botArsenal: { ...DEFAULT_ARSENAL } };
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
        // numeric sliders: keep hand-edited / stale values inside the slider ranges so UI labels and rendering agree
        this.data.glow = clampNum(this.data.glow, 0, 1, DEFAULT_SETTINGS.glow);
        this.data.brightness = clampNum(this.data.brightness, 0.7, 1.3, DEFAULT_SETTINGS.brightness);
        this.data.renderScale = clampNum(this.data.renderScale, 0.5, 1, DEFAULT_SETTINGS.renderScale);
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
