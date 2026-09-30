// Inline SVG art for the UI: weapon silhouettes, HUD glyphs, the KINETIC logo, movement-tip
// diagrams and procedural map card art. Everything is generated in code (no external assets).

import { mulberry32 } from '../core/utils.js';
import { hashString, mixHex, luminance } from './dom.js';

const ico = (vb, body, cls = '') =>
  `<svg class="ico ${cls}" viewBox="${vb}" fill="currentColor" aria-hidden="true">${body}</svg>`;

// ------------------------------------------------------------------------------------ weapons
// Side silhouettes, muzzle pointing right, viewBox 0 0 80 28.
const WEAPON_BODY = {
  pistol:
    '<path d="M14 5h50l5 3.5V12H14z"/><path d="M24 12h12l-6.5 14H17z"/><path d="M37 12h11l-2 4.5H36z"/>'
    + '<path d="M56 3.4h3v1.6h-3z"/><path d="M17 3.4h3V5h-3z"/>',
  rifle:
    '<path d="M2 9h13v10L5 20 2 16z"/><path d="M15 8h34v10H15z"/><path d="M20 5h20v3H20z"/><path d="M60 5.5h2.4V10H60z"/>'
    + '<path d="M49 9h20v7H49z"/><path d="M69 10.4h9v3H69z"/><path d="M30 18h8l-2.4 9h-7z"/><path d="M17 18h7l-2 8h-7z"/>',
  shotgun:
    '<path d="M2 8h14v11L4 19 2 14z"/><path d="M16 8h22v9H16z"/><path d="M38 8h40v3H38z"/><path d="M38 12h36v2.4H38z"/>'
    + '<path d="M44 14.4h18v5.4H44z"/><path d="M18 17h7l-2 8h-7z"/><path d="M76 6.6h2v1.4h-2z"/>',
  sniper:
    '<path d="M2 8h20v11H11l-2 3.4-3-1L2 16z"/><path d="M22 9h22v8H22z"/><path d="M44 11h32v2.6H44z"/><path d="M75 9.2h4.6v6H75z"/>'
    + '<path d="M27 3.2h23v3.6H27z"/><path d="M24.6 1.8h4v6.4h-4z"/><path d="M48.4 1.8h4v6.4h-4z"/><path d="M31 6.8h2v2.2h-2z"/><path d="M43 6.8h2v2.2h-2z"/>'
    + '<path d="M30 17h7l-1.2 6H29z"/><path d="M22 17h6l-2 8h-6z"/><path d="M52 13.6h2v6h-2z"/>',
  smg:
    '<path d="M0 7h3.4v9H0z"/><path d="M3 9h18v1.8H3z"/><path d="M3 12.6h18v1.6H3z"/><path d="M20 8h33v9.4H20z"/><path d="M52 9.4h17v6.2H52z"/>'
    + '<path d="M69 10.4h9v3.4h-9z"/><path d="M72 8.6h1.8v1.8H72z"/><path d="M72 13.8h1.8v1.8H72z"/><path d="M30 3.6h10v3.6H30z"/><path d="M56 15.6h4.2v9H56z"/>'
    + '<path d="M37 17.4h8.6l3.8 9.4h-8z"/><path d="M24 17.4h7l-2.4 9h-7z"/>',
  rail:
    '<path d="M0 7.6h10.4l1.6 1.4v8H0z"/><path d="M12 7h22v10H12z"/><path d="M34 10h38v4.4H34z"/><path d="M39 6.4h1.8v11.6H39z"/><path d="M47 6.4h1.8v11.6H47z"/>'
    + '<path d="M55 6.4h1.8v11.6H55z"/><path d="M63 6.4h1.8v11.6H63z"/><path d="M72 8l6.6-1.8v14.2L72 18.6z"/><path d="M17 3h10.4v3.6H17z"/>'
    + '<path d="M22 17h6l-2.2 8.4h-6z"/><path d="M33 17h7v5.4h-7z"/>',
  rocket:
    '<path d="M6 7h58v10H6z"/><path d="M2 5.4h6v13.2H2z"/><path d="M64 4.6h8v14.8h-8z"/><path d="M72 6h3.4v12H72z"/>'
    + '<path d="M30 2.8h10v4.2H30z"/><path d="M34 17h8l-2 9h-8z"/><path d="M52 17h6v6.4h-6z"/>',
  // Tempest: capacitor drum (left), receiver + gauge hump, coil rings on the plasma tube, forked emitter (right)
  arc:
    '<path d="M2 7h14v12H2z"/><path d="M16 8.4h26v10.4H16z"/><path d="M21 4.4h13v4H21z"/><path d="M42 11.4h20v4.6H42z"/>'
    + '<path d="M45 7.6h3.2v12.6H45z"/><path d="M51.4 7.6h3.2v12.6h-3.2z"/><path d="M57.8 7.6H61v12.6h-3.2z"/>'
    + '<path d="M62 8.2l16.4 1.8v2.6L62 11.4z"/><path d="M62 16.4l16.4-1.8V12L62 13.2z"/><path d="M22 18.8h8l-1.8 8.4h-7z"/><path d="M34 18.8h6v6.4h-6z"/>',
  // Gale: short fat horn with a flared funnel (right), rear piston sleeve, grip and forward handle
  gale:
    '<path d="M2 8h6v12H2z"/><path d="M8 7h14v14H8z"/><path d="M22 5h18v18H22z"/><path d="M40 7.4L72 1v26L40 20.6z"/><path d="M72 0h4v28h-4z"/>'
    + '<path d="M25 23h8l-1.8 5h-7z"/><path d="M44 21h8v4h-8z"/><path d="M14 4h8v3h-8z"/>',
};

const EXTRA_BODY = {
  grenade:
    '<circle cx="40" cy="16" r="8.4"/><path d="M36.5 4.6h7V8.6h-7z"/><path d="M43.5 5.4h8l1.4 3.2-9.4 1.2z"/>'
    + '<circle cx="34" cy="6" r="3" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  melee:
    '<path d="M6 13.4L48 6.6l24 6.6-24 7.4z"/><path d="M6 12.4h4v3.6H6z"/><path d="M0 11.4h6v5.6H0z"/>',
  fall: '<path d="M34 3h12v11h9L40 27 25 14h9z"/>',
  ringout: '<path d="M34 3h12v11h9L40 27 25 14h9z"/>',
  splat:
    '<path d="M40 2l3.6 7.6 8-4-2.4 8.4 8.6 .6-6.4 5.6 5.6 6.4-8.4-1.4-1 8.6-5.6-6.6-5.6 6.6-1-8.6-8.4 1.4 5.6-6.4-6.4-5.6 8.6-.6-2.4-8.4 8 4z"/>',
  vortex: '<circle cx="40" cy="14" r="4.2"/><path d="M40 1.6a12.4 12.4 0 0 1 12.4 12.4h-3.6A8.8 8.8 0 0 0 40 5.2z"/><path d="M40 26.4A12.4 12.4 0 0 1 27.6 14h3.6a8.8 8.8 0 0 0 8.8 8.8z"/>',
  static: '<path d="M44 1L31 15.6h7.6L36 27l13-16h-7.6z"/>',
  kinetic: '<circle cx="40" cy="14" r="5"/><path d="M40 1.6l3.6 5.2h-7.2zM40 26.4l-3.6-5.2h7.2zM27.6 14l5.2-3.6v7.2zM52.4 14l-5.2 3.6v-7.2z"/>',
  smoke: '<path d="M31 23a6 6 0 0 1-.8-11.8A8 8 0 0 1 46 9.8 6.4 6.4 0 0 1 47.4 23z"/>',
  explosion:
    '<path d="M40 1l4.6 8.6 9.6-3.4-3.4 9.6L60 20l-10 2.4 2 9.6-10-5-10 5 2-9.6L20 20l9.2-4.2-3.4-9.6 9.6 3.4z" transform="scale(.86) translate(6 -1)"/>',
  unknown: '<path d="M30 4h20v20H30z"/>',
};

/** Weapon side-silhouette icon (any weapon id incl. grenade / melee / fall / explosion). */
export function weaponIcon(id, cls = '') {
  const body = WEAPON_BODY[id] || EXTRA_BODY[id] || EXTRA_BODY.unknown;
  return ico('0 0 80 28', body, 'w-ico ' + cls);
}

// ------------------------------------------------------------------------------------ hud glyphs
export const ICON = {
  health: ico('0 0 24 24', '<path d="M9 2h6v7h7v6h-7v7H9v-7H2V9h7z"/>'),
  armor: ico('0 0 24 24', '<path d="M12 1.6l9.4 3.2v6.6c0 5.2-3.8 9.3-9.4 11-5.6-1.7-9.4-5.8-9.4-11V4.8z"/>'),
  ammo: ico('0 0 24 24', '<path d="M3 21V9l2.4-3L7.8 9v12zM10 21V6l2.4-4L14.8 6v15zM17 21V9l2.4-3L21.8 9v12z" transform="translate(-.4 0)"/>'),
  grenade: ico('0 0 24 24', '<circle cx="11.6" cy="14" r="7.4"/><path d="M9 2.4h5.4v3H9z"/><path d="M14.6 3.4h6l1 2.6-7 .8z"/>'),
  grenadeVortex: ico('0 0 24 24', '<circle cx="12" cy="12" r="2.6"/><path d="M12 2.4a9.6 9.6 0 0 1 9.6 9.6h-2.8A6.8 6.8 0 0 0 12 5.2z"/><path d="M12 21.6A9.6 9.6 0 0 1 2.4 12h2.8a6.8 6.8 0 0 0 6.8 6.8z"/><path d="M12 7.2a4.8 4.8 0 0 1 4.8 4.8h-2.2A2.6 2.6 0 0 0 12 9.4z"/>'),
  grenadeStatic: ico('0 0 24 24', '<path d="M13.8 1.6L5 13.4h5.6L9.2 22.4l9.8-12.6h-5.8z"/>'),
  grenadeKinetic: ico('0 0 24 24', '<circle cx="12" cy="12" r="3.6"/><path d="M12 1.8l2.8 4.2H9.2zM12 22.2L9.2 18h5.6zM1.8 12L6 9.2v5.6zM22.2 12L18 14.8V9.2z"/>'),
  grenadeSmoke: ico('0 0 24 24', '<path d="M7 19a4.3 4.3 0 0 1-.6-8.5A5.6 5.6 0 0 1 17.2 9.4 4.7 4.7 0 0 1 17.6 19z"/>'),
  grapple: ico('0 0 24 24',
    '<path d="M4 20l7.4-7.4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"/>'
    + '<path d="M12.4 2.6l9 9-3.4.8-1.4 3.4-3.4-1.2-1.6 1.6-1.8-1.8 1.6-1.6-1.2-3.4 3.4-1.4z"/>'),
  skull: ico('0 0 24 24',
    '<path d="M12 2C7 2 4 5.4 4 9.6c0 2.6 1.2 4.4 3 5.6V19h2v-2h2v2h2v-2h2v2h2v-3.8c1.8-1.2 3-3 3-5.6C20 5.4 17 2 12 2zm-3.4 8.2a1.9 1.9 0 110 3.8 1.9 1.9 0 010-3.8zm6.8 0a1.9 1.9 0 110 3.8 1.9 1.9 0 010-3.8z"/>'),
  head: ico('0 0 24 24', '<path d="M12 2l3 6.6 7 .8-5.2 4.8 1.5 7L12 17.6 5.7 21.2l1.5-7L2 9.4l7-.8z"/>'),
  check: ico('0 0 24 24', '<path d="M9.2 16.4L4.8 12l-1.8 1.8 6.2 6.2L21 8.2 19.2 6.4z"/>'),
  arrow: ico('0 0 24 24', '<path d="M8 4l10 8-10 8V4z"/>'),
  back: ico('0 0 24 24', '<path d="M16 4L6 12l10 8v-4l-5-4 5-4z"/>'),
  bolt: ico('0 0 24 24', '<path d="M13.6 1L4.4 13.4h6L9.6 23l10-13H13z"/>'),
  crown: ico('0 0 24 24', '<path d="M2 8l5 4 5-8 5 8 5-4-2 12H4z"/>'),
  bot: ico('0 0 24 24', '<path d="M11 2h2v3h5a2 2 0 012 2v9a2 2 0 01-2 2H6a2 2 0 01-2-2V7a2 2 0 012-2h5zM8 9a1.6 1.6 0 100 3.2A1.6 1.6 0 008 9zm8 0a1.6 1.6 0 100 3.2A1.6 1.6 0 0016 9zM9 15h6v1.6H9zM10 20h4v2h-4z"/>'),
};

// ------------------------------------------------------------------------------------ logo
const LOGO_LETTERS = [
  { x: 0, d: 'M5 3V57 M35 3L8 31 M17 24L36 57' },                       // K
  { x: 52, d: 'M5 3V57' },                                              // I
  { x: 76, d: 'M5 57V3L35 57V3' },                                      // N
  { x: 130, d: 'M34 4H12L5 11V56H34 M5 30H28' },                        // E
  { x: 180, d: 'M2 4H38 M20 4V57' },                                    // T
  { x: 234, d: 'M5 3V57' },                                             // I
  { x: 258, d: 'M34 4H12L5 11V49L12 56H34' },                           // C
];

/**
 * The KINETIC wordmark as an angular monoline SVG.
 * @param {string} [cls] extra css class
 */
let logoUid = 0;
export function logoSVG(cls = '') {
  const uid = 'lg' + (++logoUid);   // unique ids: url(#id) fails inside a display:none twin
  const paths = LOGO_LETTERS.map((l, i) =>
    `<path class="lg-p" pathLength="1" style="--i:${i}" transform="translate(${l.x} 0)" d="${l.d}"/>`).join('');
  return `<svg class="k-logo ${cls}" viewBox="0 0 330 84" aria-label="KINETIC">
    <defs>
      <linearGradient id="${uid}-grad" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="60"><stop offset="0" stop-color="#c8faff"/><stop offset=".55" stop-color="#3de0ff"/><stop offset="1" stop-color="#1b8fe8"/></linearGradient>
      <linearGradient id="${uid}-trail" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ff9a3c" stop-opacity="0"/><stop offset="1" stop-color="#ff9a3c"/></linearGradient>
    </defs>
    <g transform="translate(20 5) skewX(-14)">
      <g class="lg-glow">${paths}</g>
      <g class="lg-main" stroke="url(#${uid}-grad)">${paths}</g>
    </g>
    <path class="lg-trail" style="stroke:url(#${uid}-trail)" d="M0 76H150L158 70H330" />
    <path class="lg-trail2" d="M40 81H120" />
  </svg>`;
}

// ------------------------------------------------------------------------------------ tip diagrams
const TIP = {
  slide:
    '<path d="M6 46H90" opacity=".5"/><rect x="42" y="33" width="30" height="11" rx="5.5"/><path d="M10 34h22M18 39h16M6 29h14" opacity=".7"/><path d="M78 40l8 0-4-4M86 40l-4 4" opacity=".9"/>',
  wallrun:
    '<path d="M76 4V52" stroke-width="5" opacity=".5"/><path d="M14 46C34 40 52 30 68 12" stroke-dasharray="4 4"/><path d="M62 10l8 0 0 8" /><rect x="52" y="12" width="9" height="16" rx="4.5" transform="rotate(28 56 20)"/>',
  walljump:
    '<path d="M18 4V52" stroke-width="5" opacity=".5"/><path d="M26 44C26 30 28 20 30 14" stroke-dasharray="4 4"/><path d="M34 12C44 10 56 18 68 34" /><path d="M62 30l8 5-9 3"/>',
  doublejump:
    '<path d="M6 48H90" opacity=".5"/><path d="M14 48C20 24 34 24 40 46" /><path d="M40 46C46 12 66 12 74 44" stroke-dasharray="4 3"/><circle cx="40" cy="46" r="4"/><path d="M68 40l6 5 2-8"/>',
  grapple:
    '<path d="M6 50H90" opacity=".5"/><path d="M78 6l8 8-4 3-4-2-3 3-3-3 3-3-2-4z" fill="currentColor"/><path d="M76 16L28 40" stroke-dasharray="3 3"/><rect x="18" y="34" width="10" height="16" rx="5"/><path d="M28 24C40 44 62 40 74 26" opacity=".6"/>',
  rocket:
    '<path d="M6 50H90" opacity=".5"/><path d="M48 50l-9-5 5-2-7-6 8 2 3-8 3 8 8-2-6 6 5 2z" fill="currentColor" opacity=".9"/><path d="M48 32V8"/><path d="M42 14l6-8 6 8"/>',
  mantle:
    '<path d="M6 50H50V26H90" opacity=".5"/><path d="M28 48C30 30 40 20 52 20" stroke-dasharray="4 4"/><path d="M52 14l8 6-8 6"/><rect x="18" y="32" width="9" height="16" rx="4.5"/>',
  smg:
    '<path d="M6 50H90" opacity=".5"/><path d="M8 34h18M4 40h16M10 28h12" opacity=".7"/><rect x="30" y="30" width="10" height="16" rx="5"/><path d="M42 36h26v6H42z" fill="currentColor" opacity=".9"/><path d="M72 36h16M72 40h14M72 32l14-3" stroke-dasharray="3 2"/>',
  rail:
    '<path d="M6 50H90" opacity=".5"/><rect x="10" y="30" width="9" height="16" rx="4.5"/><circle cx="34" cy="38" r="7" opacity=".7"/><circle cx="34" cy="38" r="2.6" fill="currentColor"/><path d="M42 38H92" stroke-width="3"/><rect x="58" y="24" width="8" height="28" rx="4" opacity=".6"/><rect x="76" y="24" width="8" height="28" rx="4" opacity=".6"/>',
  gale:
    '<path d="M6 50H90" opacity=".5"/><rect x="38" y="16" width="20" height="11" rx="2.5"/><path d="M42 30L30 46M48 31V47M54 30L66 46" stroke-dasharray="3 3"/><path d="M48 12V3M43 8l5-5 5 5"/>',
  grenades:
    '<circle cx="26" cy="32" r="12"/><path d="M20 14h12v6H20z" fill="currentColor"/><path d="M42 32h10M48 27l5 5-5 5" opacity=".7"/><circle cx="72" cy="32" r="4" fill="currentColor"/><path d="M72 18a14 14 0 0114 14M72 46a14 14 0 01-14-14" opacity=".8"/>',
  cook:
    '<circle cx="34" cy="32" r="14"/><path d="M28 14h12v6H28z" fill="currentColor"/><path d="M46 20l12 4" /><path d="M64 10a20 20 0 010 44" stroke-dasharray="3 3" opacity=".8"/><path d="M70 30v4M70 32h-6" />',
};

/** Line-art diagram (viewBox 96x56) for a movement tip. */
export function tipDiagram(kind) {
  return `<svg class="tip-svg" viewBox="0 0 96 56" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${TIP[kind] || ''}</svg>`;
}

// ------------------------------------------------------------------------------------ map art
/**
 * Procedural card illustration for a map, coloured by def.colors and seeded by def.id.
 * @param {{id:string, colors?:string[]}} def
 */
export function mapPalette(def) {
  const a = (def.colors && def.colors[0]) || '#1d2b4a';
  const b = (def.colors && def.colors[1]) || '#ff9a3c';
  // the brighter colour is the accent (sun, lights, grid); the darker one is the base tone
  return luminance(a) >= luminance(b) ? { base: b, accent: a } : { base: a, accent: b };
}

export function mapArt(def) {
  const { base: c0, accent: c1 } = mapPalette(def);
  const rnd = mulberry32(hashString(def.id || 'map'));
  const gid = 'ma-' + String(def.id || 'x').replace(/[^a-z0-9]/gi, '');
  const skyTop = mixHex(c0, '#000000', 0.3);
  const skyMid = mixHex(c0, c1, 0.28);
  const skyLow = mixHex(c0, c1, 0.82);
  const far = mixHex(mixHex(c0, c1, 0.4), '#000000', 0.55);
  const near = mixHex(c0, '#000000', 0.84);
  const W = 320, H = 200, gy = 150;
  let farS = '', nearS = '', extra = '';
  const style = String(def.id || '');

  const rect = (x, y, w, h, fill, op = 1) => `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${fill}" opacity="${op}"/>`;

  if (style === 'skyline') {
    for (let x = -4; x < W; x += 16 + rnd() * 10) {
      const w = 14 + rnd() * 16, h = 40 + rnd() * 70;
      farS += rect(x, gy - h, w, h, far, 0.9);
    }
    for (let x = -8; x < W; x += 22 + rnd() * 16) {
      const w = 20 + rnd() * 22, h = 60 + rnd() * 80;
      nearS += rect(x, gy - h, w, h + 6, near);
      const cols = Math.floor(w / 6), rows = Math.floor(h / 9);
      for (let cx = 0; cx < cols; cx++) for (let ry = 0; ry < rows; ry++) {
        if (rnd() < 0.24) nearS += rect(x + 3 + cx * 6, gy - h + 5 + ry * 9, 2.6, 3.4, rnd() < 0.7 ? c1 : '#bff4ff', 0.85);
      }
      if (rnd() < 0.5) nearS += rect(x + w / 2 - 0.6, gy - h - 12, 1.2, 12, near);
    }
  } else if (style === 'ruins') {
    for (let x = 0; x < W; x += 20 + rnd() * 18) {
      const h = 24 + rnd() * 34;
      farS += rect(x, gy - h, 14 + rnd() * 10, h, far, 0.85);
    }
    for (let x = 14; x < W - 10; x += 34 + rnd() * 20) {
      const h = 40 + rnd() * 60, w = 9 + rnd() * 4;
      nearS += rect(x, gy - h, w, h + 4, near);
      nearS += rect(x - 3, gy - h - 4, w + 6, 5, near);
      if (rnd() < 0.5) nearS += `<path d="M${x + w} ${gy - h + 6}q22 -22 44 0v${h - 6}h-44z" fill="${near}"/>`;
      if (rnd() < 0.6) nearS += `<path d="M${x + w + 14} ${gy - 30}a8 8 0 0 1 16 0z" fill="${far}"/>`;
    }
  } else if (style === 'foundry') {
    for (let x = 0; x < W; x += 24 + rnd() * 20) {
      const h = 26 + rnd() * 30;
      farS += rect(x, gy - h, 20 + rnd() * 18, h, far, 0.85);
    }
    for (let x = 6; x < W; x += 46 + rnd() * 28) {
      const w = 34 + rnd() * 24, h = 26 + rnd() * 24;
      nearS += rect(x, gy - h, w, h + 4, near);
      nearS += `<path d="M${x} ${gy - h}l${w * 0.25} -12 ${w * 0.25} 12 ${w * 0.25} -12 ${w * 0.25} 12z" fill="${near}"/>`;
      const cx = x + 8 + rnd() * (w - 16), ch = 34 + rnd() * 40;
      nearS += rect(cx, gy - h - ch, 6, ch + 2, near) + rect(cx - 1.5, gy - h - ch - 3, 9, 4, near);
      extra += `<circle cx="${cx + 3}" cy="${gy - h - ch - 8}" r="${5 + rnd() * 4}" fill="${c1}" opacity=".16"/>`;
    }
    nearS += rect(0, gy - 58, W, 3, near, 0.9) + rect(0, gy - 52, W, 1.4, c1, 0.4);
  } else {
    for (let x = 0; x < W; x += 20 + rnd() * 20) {
      const h = 14 + rnd() * 26;
      farS += rect(x, gy - h, 18 + rnd() * 16, h, far, 0.85);
    }
    for (let x = 8; x < W; x += 34 + rnd() * 24) {
      const w = 22 + rnd() * 28, h = 18 + rnd() * 40;
      nearS += rect(x, gy - h, w, h + 4, near);
      nearS += `<path d="M${x} ${gy - h}h${w}" stroke="${c1}" stroke-width="1.4" opacity=".55"/>`;
    }
    nearS += `<path d="M${W * 0.62} ${gy}l40 -24v24z" fill="${near}"/>`;
  }

  // sun / moon with glow
  const sx = 60 + rnd() * 200, sy = 46 + rnd() * 26, sr = 13 + rnd() * 7;
  const grid = [];
  for (let i = -8; i <= 8; i++) grid.push(`M${160 + i * 6} ${gy}L${160 + i * 46} ${H}`);
  for (let j = 0; j < 5; j++) { const y = gy + 4 + j * j * 2.6 + j * 3; grid.push(`M0 ${y}H${W}`); }

  return `<svg class="map-art" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs>
      <linearGradient id="${gid}-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${skyTop}"/><stop offset=".45" stop-color="${skyMid}"/><stop offset=".75" stop-color="${skyLow}"/><stop offset="1" stop-color="${skyLow}"/></linearGradient>
      <radialGradient id="${gid}-hz" cx=".5" cy=".75" r=".6"><stop offset="0" stop-color="${c1}" stop-opacity=".55"/><stop offset="1" stop-color="${c1}" stop-opacity="0"/></radialGradient>
      <radialGradient id="${gid}-sun"><stop offset="0" stop-color="${c1}" stop-opacity=".95"/><stop offset=".35" stop-color="${c1}" stop-opacity=".45"/><stop offset="1" stop-color="${c1}" stop-opacity="0"/></radialGradient>
      <linearGradient id="${gid}-gnd" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${mixHex(c0, c1, 0.18)}"/><stop offset="1" stop-color="${mixHex(c0, '#000000', 0.78)}"/></linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#${gid}-sky)"/>
    <rect width="${W}" height="${H}" fill="url(#${gid}-hz)"/>
    <circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="${(sr * 3.4).toFixed(1)}" fill="url(#${gid}-sun)"/>
    <circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="${sr.toFixed(1)}" fill="${c1}" opacity=".92"/>
    ${farS}${nearS}${extra}
    <rect y="${gy}" width="${W}" height="${H - gy}" fill="url(#${gid}-gnd)"/>
    <path d="${grid.join('')}" stroke="${c1}" stroke-width=".8" opacity=".28" fill="none"/>
    <rect y="${gy - 0.5}" width="${W}" height="1.2" fill="${c1}" opacity=".5"/>
  </svg>`;
}
