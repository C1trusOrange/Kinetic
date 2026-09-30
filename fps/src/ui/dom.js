// Small DOM / formatting helpers shared by the HUD and the menus.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape text for safe insertion into innerHTML. */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ESC[c]);
}

/** '#rrggbb' from a THREE.Color, a number or a css string. */
export function hexOf(color, fallback = '#ffffff') {
  if (color == null) return fallback;
  if (typeof color === 'string') return color;
  if (typeof color === 'number') return '#' + (color >>> 0).toString(16).padStart(6, '0').slice(-6);
  if (typeof color.getHexString === 'function') return '#' + color.getHexString();
  return fallback;
}

/** Mix two '#rrggbb' colors (t = 0 -> a, 1 -> b). */
export function mixHex(a, b, t) {
  const pa = parseHex(a), pb = parseHex(b);
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
}

/** Relative luminance (0..1) of a '#rrggbb' colour. */
export function luminance(h) {
  const [r, g, b] = parseHex(h);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function parseHex(h) {
  let s = String(h || '#000000').replace('#', '');
  if (s.length === 3) s = s.split('').map(c => c + c).join('');
  const n = parseInt(s.slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** 'm:ss' for a number of seconds (clamped at 0). Countdowns round up, elapsed clocks round down. */
export function fmtTime(seconds, countdown = true) {
  const s = Math.max(0, countdown ? Math.ceil(seconds - 1e-6) : Math.floor(seconds + 1e-6));
  const m = Math.floor(s / 60);
  return m + ':' + String(s % 60).padStart(2, '0');
}

/** Human readable label for a KeyboardEvent.code / mouse pseudo-code. */
export function keyLabel(code) {
  if (!code) return '?';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Mouse')) {
    const n = parseInt(code.slice(5), 10);
    return n === 0 ? 'LMB' : n === 1 ? 'MMB' : n === 2 ? 'RMB' : 'MOUSE ' + (n + 1);
  }
  const map = {
    Space: 'SPACE', ShiftLeft: 'SHIFT', ShiftRight: 'SHIFT', ControlLeft: 'CTRL', ControlRight: 'CTRL',
    AltLeft: 'ALT', AltRight: 'ALT', Tab: 'TAB', Escape: 'ESC', Enter: 'ENTER', Backquote: '`',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  };
  return map[code] || code.toUpperCase();
}

/** Ordinal suffix: 1 -> '1ST'. */
export function ordinal(n) {
  const v = n % 100;
  const suffix = (v >= 11 && v <= 13) ? 'TH' : ({ 1: 'ST', 2: 'ND', 3: 'RD' }[n % 10] || 'TH');
  return n + suffix;
}

/** Stable 32-bit string hash. */
export function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
