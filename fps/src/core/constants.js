// Shared tuning constants and identifiers. Keep this file dependency-free except for three.

/** World gravity (m/s^2). Deliberately higher than Earth for a snappy movement shooter. */
export const GRAVITY = 24;

/** Player / humanoid collision capsule dimensions (meters). */
export const HUMANOID = {
  radius: 0.4,
  height: 1.8,        // standing capsule height (feet to top of head)
  crouchHeight: 1.15, // crouched / sliding capsule height
  eyeFromTop: 0.14,   // eye is this far below the top of the capsule
};

/** Team ids used in team deathmatch. In FFA every entity's team equals its entity id. */
export const TEAM_BLUE = 1;
export const TEAM_RED = 2;
export const TEAM_COLORS = { 1: 0x3d9bff, 2: 0xff4a3d };
export const TEAM_NAMES = { 1: 'Blue', 2: 'Red' };

/** Accent colors for bots in FFA (one per bot, cycled). */
export const BOT_COLORS = [
  0xff4a3d, 0xffb020, 0x6ee05a, 0xb45cff, 0xff5fb0, 0x2ee6d6,
  0xf2f2f2, 0xff7a1a, 0x5a7dff, 0xd4ff3a, 0xc9895f, 0x7affc4,
];

export const PLAYER_COLOR = 0x9fe8ff;

export const BOT_NAMES = [
  'Sprocket', 'Voltage', 'Glitch', 'Rivet', 'Cog', 'Nimbus', 'Axle', 'Piston',
  'Relay', 'Tesla', 'Byte', 'Servo', 'Gasket', 'Diode', 'Flux', 'Torque',
];

/**
 * Weapon ids in ascending slot order (single source of truth for WEAPON_ORDER / HUD / pickups). The key number of a weapon is
 * its `slot` field (WeaponDefs.WEAPONS[id].slot), NOT its index: slots may have gaps until every weapon exists.
 */
export const WEAPON_IDS = ['pistol', 'rifle', 'shotgun', 'sniper', 'rocket', 'smg', 'arc', 'rail', 'gale'];

/** Bot difficulty ids. */
export const DIFFICULTIES = ['easy', 'normal', 'hard', 'insane'];

/** Game modes: free-for-all, team deathmatch, Escalation (gun-game ladder, FFA), King of the Hill (teams). */
export const MODES = ['ffa', 'tdm', 'escalation', 'koth'];

/** Modes played as Blue vs Red (team ids, team colours, team score UI). */
export const isTeamMode = m => m === 'tdm' || m === 'koth';

/**
 * Escalation weapon ladder (tier 0 first). Filtered at runtime to ids that exist in WEAPONS
 * (src/core/Modes.js), so it works before / after the extra weapons are merged in.
 */
export const ESCALATION_LADDER = ['pistol', 'smg', 'shotgun', 'rifle', 'arc', 'sniper', 'rocket', 'rail'];

/** King of the Hill tuning (seconds / metres). */
export const HILL = {
  firstDelay: 8,     // match start -> first zone goes live
  duration: 45,      // a zone stays live this long
  gap: 5,            // 'relocating' pause between two zones
  warn: 8,           // the next zone is previewed this long before the live one expires
  tick: 3.0,         // seconds of uncontested holding per team point
  killBonus: 1,      // extra team point for a kill whose victim stood in the live zone
  radius: 7, halfUp: 3.2, halfDown: 1.2,
};

/** Respawn delay in seconds. */
export const RESPAWN_DELAY = { player: 3.0, bot: 2.5 };

/** Seconds of damage immunity after spawning (broken early by firing). */
export const SPAWN_PROTECTION = 1.5;

/**
 * Graphics quality presets (selected by settings.quality; 'auto' picks one from the GPU, see core/GraphicsQuality.js).
 * Render resolution: pixel ratio min(devicePixelRatio, maxPixelRatio), lowered so the drawing buffer holds at most
 * maxMegapixels million pixels (0 = no budget), then scaled by the 'renderScale' setting.
 * msaa = samples of the composer's HDR target (the canvas itself is never multisampled); bloom = UnrealBloom pass.
 * 'ultra' is the former 'high' (native resolution up to DPR 1.5, 4x MSAA) for strong GPUs.
 */
export const QUALITY_PRESETS = {
  low: { name: 'low', maxPixelRatio: 0.75, maxMegapixels: 1.2, shadows: false, shadowMapSize: 1024, bloom: false, msaa: 0, maxDecals: 40, particleScale: 0.5 },
  medium: { name: 'medium', maxPixelRatio: 1, maxMegapixels: 1.7, shadows: true, shadowMapSize: 1024, bloom: true, msaa: 0, maxDecals: 80, particleScale: 0.8 },
  high: { name: 'high', maxPixelRatio: 1.5, maxMegapixels: 2.1, shadows: true, shadowMapSize: 2048, bloom: true, msaa: 2, maxDecals: 150, particleScale: 1.0 },
  ultra: { name: 'ultra', maxPixelRatio: 1.5, maxMegapixels: 0, shadows: true, shadowMapSize: 2048, bloom: true, msaa: 4, maxDecals: 150, particleScale: 1.0 },
};
