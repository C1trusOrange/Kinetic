# KINETIC — Architecture & Module Contract

KINETIC is a browser first-person arena shooter: fast movement (sprint, slide, double jump,
wall-running, wall-jumping, mantling, grappling hook, rocket jumping), five weapons with
procedural low-poly models, frag grenades, three hand-built maps plus a training map, and AI
robot bots (free-for-all or team deathmatch).

**Quality bar:** low-poly but high-fidelity — clean silhouettes, bevelled edges, PBR materials
with procedural albedo + normal + roughness maps, good lighting (sun shadows, hemisphere,
environment reflections, emissive + bloom), juicy feedback (recoil, shake, particles, sound).
It must run at 60 fps on a mid-range GPU.

This document is the **contract** between modules. Implement the exact names and signatures
below. Read the already-implemented core files (listed in §3) — they are the source of truth for
anything this document summarises.

---

## 1. Tech & conventions

* **three.js r169**, vendored at `vendor/three`. Import as `import * as THREE from 'three'` and
  addons as `import { X } from 'three/addons/<path>.js'` (e.g. `three/addons/utils/BufferGeometryUtils.js`,
  `three/addons/geometries/RoundedBoxGeometry.js`). No other libraries, no build step, no network,
  **no external assets** — every model, texture and sound is generated in code. The exceptions: music (the
  menu / victory / defeat tracks in `music/`, AudioSystem.playMusic) and the UI typefaces in `fonts/` (Barlow / Barlow
  Condensed woff2, OFL, declared in style.css).
* Plain ES2022 modules, classes, 2-space indent, single quotes, semicolons, JSDoc on public APIs.
  No TypeScript. Relative imports with explicit `.js` extensions.
* **Units:** meters, seconds, radians, m/s. **Y is up.** The camera looks down **-Z**.
* **Yaw/pitch:** yaw 0 looks toward -Z, positive yaw turns left (CCW seen from above).
  `forward = (-sin yaw, 0, -cos yaw)`, `right = (cos yaw, 0, -sin yaw)`; pitch > 0 looks up.
  Camera/objects use Euler order `'YXZ'`: `rotation.set(pitch, yaw, roll)`. Helpers in `src/core/utils.js`.
* **Positions of entities are FEET positions** (bottom of the collision capsule).
* **Gravity** `GRAVITY = 24` m/s² (constants.js). Humanoid capsule radius 0.4, height 1.8 (crouch 1.15).
* **Colors:** hex numbers or `'#rrggbb'` strings. Renderer uses sRGB output + AgX tone mapping (Game.js: exposure x
  TONE_EXPOSURE 1.45 on top of the map's, then a light saturation grade in KineticOutputPass), so albedo colors are sRGB
  and lights are physically based (point light intensity in candela,
  decay 2 — typical 20–80 for a lamp; directional 1.5–3.5).
* **No per-frame allocations in hot paths** — reuse module-level scratch `Vector3`s, pools.
* **Never change the number of lights at runtime** (it recompiles every shader → stutter). Use
  fixed pools and set intensity to 0 when idle.
* Errors must surface: don't swallow exceptions silently; use `console.error` for real problems and
  `console.warn` (once) for recoverable ones. The test harness fails on console errors.
* Shared/cached materials & geometries must not be disposed by consumers.

## 2. Running & testing

* Play: `play.bat` (or `python tools/serve.py 8000`) → http://localhost:8000
* Desktop build (Electron, `desktop/main.js`; needs Node.js): `npm install` once, then `npm start` to run it
  (F11 fullscreen, F12 DevTools) and `npm run package` for `dist/KINETIC-win32-x64.zip`, the copy to hand to
  friends (unzip, run `KINETIC.exe`). It serves `index.html`, `style.css`, `src/`, `vendor/`, `music/` and `fonts/` over
  `kinetic://game/`; nothing else is packaged, and the package keeps only the vendor files the game imports.
* Music: the game plays `music/*.ogg` (Opus 128 kbps). After replacing a `.wav` master, re-encode it with the bundled
  ffmpeg: `node_modules/ffmpeg-static/ffmpeg.exe -i music/kinetic_menu.wav -c:a libopus -b:a 128k music/kinetic_menu.ogg`.
* Headless harness (Chrome + GPU, stdlib-only Python):
  * Import check: `python tools/run.py --check src/world/World.js,src/world/Textures.js`
  * Static linter (imports/exports/THREE members): `python tools/lint_imports.py [paths]`
  * Gameplay smoke test (scripted player, bots, 20 s):
    `python tools/run.py "index.html?autotest=1&map=foundry&bots=5&duration=20" --report --shots 4,12 --out tools/out/foundry`
    Params: `map, bots, mode=ffa|tdm, diff, duration, god=1, script=full|idle, spectate=1 (chase-cam a bot), cam=x,y,z,yaw,pitch, quality`,
    `mapfile=tools/out/<you>/testmap.js` (custom test map module — default export is a map definition),
    `scenario=tools/out/<you>/scenario.js` (custom scripted test: `export function drive(t, dt, game, report)`, optional `setup(game, report)` / `finish(game, report)`;
    drive virtual input with `game.input.setVirtual(action, bool)` / `game.input.addLook(dx, dy)`; put your measurements in `report.custom`, printed by `--report`).
  * Asset viewer screenshots (only imports the module under review):
    * `tools/viewer.html?kind=weapons` (all world models) · `&id=rifle&yaw=0.6`
    * `tools/viewer.html?kind=viewmodel&id=rifle` · `&ads=1` (green crosshair checks sight alignment)
    * `tools/viewer.html?kind=bots&pose=idle,walk,run,aim,air,crouch&t=0.35&weapon=rifle`
    * `tools/viewer.html?kind=materials` · `&names=brick,metal_panel`
    * `tools/viewer.html?kind=map&id=foundry&preview=1` · `&overview=1` · `&cam=x,y,z,yaw,pitch` · `&nav=1`
    * e.g. `python tools/run.py "tools/viewer.html?kind=bots" --wait "window.__VIEWER_READY__" --shot tools/out/bots.png --eval "window.__VIEWER_INFO__"`
  * Look at screenshots with the Read tool (PNG) and iterate until they look good.
  * Put scratch output in `tools/out/` (git-ignored scratch space).

## 3. Files & ownership

Each build agent owns specific files and must not edit files it does not own (if the contract
seems wrong, code defensively and report it).

| Owner | Files |
|---|---|
| core (done — read, don't edit) | `index.html`, `src/main.js`, `src/core/{Game,Input,Events,Settings,Entity,Combat,AutoTest,constants,utils,procgen}.js`, `src/world/Collision.js`, `src/world/maps/index.js`, `tools/*` |
| textures | `src/world/Textures.js` |
| world | `src/world/{World,MapBuilder,Pickups,NavGraph,Sky}.js`, `src/world/maps/sandbox.js` |
| player | `src/player/*.js` (at least `Player.js`) |
| weapon-models | `src/weapons/WeaponModels.js` (+ optional `src/weapons/models/*.js`) |
| weapons | `src/weapons/{WeaponDefs,WeaponSystem,Projectiles}.js` |
| bot-model | `src/ai/BotModel.js` |
| ai | `src/ai/{Bot,BotBrain,BotManager}.js` (+ optional `src/ai/*.js` helpers except BotModel) |
| fx-audio | `src/fx/*.js` (at least `Effects.js`), `src/core/Audio.js` |
| ui | `src/ui/*.js` (at least `HUD.js`, `Menu.js`), `style.css` (extend; keep the base rules) |
| map agents | `src/world/maps/foundry.js`, `skyline.js`, `ruins.js` (one each) |

## 4. The `game` object

Every subsystem receives `game` (see `src/core/Game.js`). Available fields:

`renderer, scene, camera` (world camera — only Player.updateCamera / Game write it),
`viewScene, viewCamera` (viewmodel layer; its camera copies the world camera's world transform each frame, fixed vertical FOV 50; **parent the viewmodel to `game.viewCamera`**),
`events, settings, input, audio, combat, effects, world, projectiles, player, weapons, bots, hud, menu`,
`entities` (alive + dead entities of the match: player + bots), `match`, `time` (sim seconds), `state`,
`quality` (preset from constants.QUALITY_PRESETS), `maps` (registry array), `uiRoot` (DOM root for UI), `params`, `fps`,
methods `getBaseFov()` (vertical degrees from the FOV setting), `addEntity(e)`, `removeEntity(e)`, `getEnemiesOf(e)`,
`getEntityById(id)`, `startMatch(opts)`, `restartMatch()`, `pause()`, `resume()`, `quitToMenu()`, `getScoreboard()`,
`lastMatchConfig`.

`game.state`: `'boot' | 'loading' | 'menu' | 'playing' | 'paused' | 'ended'`. Input is disabled
(`input.enabled=false`) outside `'playing'`.

`game.match` (null outside a match): `{ mapId, mapName, mode:'ffa'|'tdm', botCount, difficulty, scoreLimit, timeLimit (min),
timeLeft (s, Infinity if none), teamScores:{1,2}, over, reason, winner (entity, FFA), winnerTeam (TDM), playerWon, results (scoreboard rows), startTime }`.

### Lifecycle

1. `new X(game)` for every subsystem. **Constructors must not call other subsystems** (they may not exist yet). They may add persistent objects to `game.scene` / `game.viewScene` / `game.uiRoot`.
2. `await x.init()` (optional) in order: audio, effects, world, projectiles, player, weapons, bots, hud, menu. Other subsystems exist now.
3. Menu backdrop: `world.load(def)`; state `'menu'` (Game orbits the camera around `def.previewCamera`; calls `world.update`, `effects.update`, `audio.update`).
4. `game.startMatch()`: `bots.clear(); projectiles.clear(); effects.clear()` → `world.load(def)` (or `world.reset()` same map) →
   `bots.prepare(world)` → `player.reset()` → `game.addEntity(player)` → `bots.spawnBots(count, difficulty, mode)` →
   `weapons.onMatchStart()` → for each entity `game.respawnEntity(e)` which calls `e.spawn(position, yaw)` and, for the player,
   `weapons.onPlayerSpawn()` → `hud.onMatchStart(match)` → state `'playing'`.
5. Deaths: `Combat.kill` → `victim.onDeath(info)` → `'death'` event → Game scores and sets `victim.respawnAt`; Game respawns later.
6. Kill plane: entities below `world.killY` are killed by Game (`weapon: 'fall'`).

### Frame order (Game.update, dt ≤ 0.05 s scaled by timeScale)

1. `autotest.update` 2. `player.update(dt)` 3. `weapons.update(dt)` 4. `bots.update(dt)` 5. `projectiles.update(dt)`
6. `world.update(dt)` 7. `effects.update(dt)` 8. match timer / respawns / kill plane 9. `player.updateCamera(dt)` then viewCamera sync
10. `weapons.updateViewModel(dt)` 11. `audio.update(dt)` 12. `hud.update(dt)`. Then render (world → clear depth → viewmodel; bloom when enabled).

Online (§6.12) the loop is `Game._frame(nowMs, render)`: input, `net.beginFrame` (received packets), the state's update, `net.endFrame`
(packets out, before the render), render (rAF frames only), autotest, `input.endFrame`. dt is real time (≤ 0.25 s, never scaled):
frames over 50 ms run steps 4–8 in up to 5 equal sub-steps (player and weapons once, ≤ 100 ms). `net.updateRemotes` follows step 3,
bots and combat run only where `net.authority` (offline / host). The HostTicker Worker runs extra `_frame(now, false)` (no render)
while the tab is hidden or rAF stalls, and on a host rendering below ~55 Hz. Offline everything is exactly the order above.

## 5. Core APIs (implemented)

* **Events** (`game.events`): `on(name, fn) → off`, `once`, `off`, `emit(name, payload)`.
* **Input** (`game.input`): actions `forward back left right jump crouch sprint fire ads reload grenade grapple melee weapon1..weapon9 lastWeapon scoreboard` (the key of a weapon is its `slot`);
  `action(name)` held, `actionPressed(name)`, `actionReleased(name)`, `consumeLook() → {x, y}` raw mouse counts
  (**only Player calls this**; radians = counts × `BASE_LOOK_SPEED` (0.0022) × `settings.sensitivity` × `player.lookScale`; +x turns right → yaw decreases; +y looks down unless `invertY`), `wheel` (+1 next / -1 prev this frame),
  `locked`, `enabled`. Bindings: WASD, Space, C crouch/slide, Shift sprint, LMB fire, RMB ADS, R, G grenade (hold to cook), E / mouse4 grapple, V/F melee, 1–9 (by slot), Q last weapon, Tab scores.
* **Settings** (`game.settings`): `get(k)`, `set(k, v)`, `onChange(fn)`; keys in `DEFAULT_SETTINGS` (sensitivity, invertY, fov (horizontal deg), viewBob, showFps, quality, masterVolume, playerName, map, mode, bots, difficulty, scoreLimit, timeLimit, glow (0..1 bloom amount, default 0.65), brightness (0.7..1.3 exposure multiplier), botArsenal (per-weapon bot spawn frequency, see `ai/BotConfig.js`)).
* **Entity** (`src/core/Entity.js`) — base of Player and Bot. Fields: `id, name, team, isPlayer, isBot, color (THREE.Color), alive, health, maxHealth, armor, maxArmor, god, position, velocity, yaw, pitch, radius, height, eyeHeight, onGround, kills, deaths, streak, respawnAt, spawnProtectedUntil, lastAttacker, lastDamageTime, lastLaunchTime`.
  Methods: `getEyePosition(out)`, `getChestPosition(out)`, `getAimDirection(out)`, `getHitboxes()` (head sphere / body capsule / legs capsule, derived from position+height), `takeDamage(info)` (armor absorbs 60%), `heal(n)`, `addArmor(n)`, `applyImpulse(v)`, `launch(v)`, `giveWeapon(id)`, `addAmmo(id|null, fraction)`, `addGrenades(n)` (→ bool consumed), `isProtected()`, `spawn(position, yaw)`, `onDeath(info)`, `update(dt)`.
* **Combat** (`game.combat`): `raycast(origin, dir, maxDist, ignore) → {distance, point, normal, entity, part, surface}|null`,
  `canSee(a, b)`, `fireBullet({shooter, origin, direction, damage, weapon, range, headshotMult, falloff:{start,end,min}, tracerFrom, tracerColor}) → hit|null`
  (does damage, `effects.impact`/`effects.hitSpark`, `effects.tracer`), `applyDamage(target, {amount, attacker, weapon, headshot, point, direction, knockback})`,
  `kill(target, info)`, `radialDamage(center, {radius, damage, attacker, weapon, knockback, selfScale})` (LOS-checked, falloff, knockback — full knockback on self for rocket jumps).
* **CollisionWorld** (`src/world/Collision.js`, instance at `world.collision`): `addTriangle(a,b,c,surface,blocks)`, `addGeometry(geometry, matrix, surface, blocks)`, `build()`,
  `raycast(origin, dir, maxDist, mask = BLOCK_MOVE) → {distance, point, normal, surface, triangle}|null` (front faces only),
  `blocks` / `mask`: `BLOCK_MOVE` (bodies), `BLOCK_SHOTS` (bullets, projectiles, sight), `BLOCK_ALL` (default). A railing is a
  movement-only thin wall plus shot-only posts and rails, so shots and sight pass through its gaps; capsule, inside and
  `rayBlocked` queries see BLOCK_MOVE triangles only,
  `resolveCapsule(capsule)` (push out; returns reused contacts), `capsuleIntersect(capsule)`, `sphereIntersect(sphere)`,
  `moveCapsule(capsule, velocity, dt, {groundMinY}) → {onGround, groundNormal, hitWall, wallNormal, hitCeiling}` (sub-stepped move-and-slide; mutates capsule & velocity),
  `probeGround(capsule, maxDrop) → {distance, point, normal}|null`. Capsules are `three/addons/math/Capsule.js` with `start` = lower sphere center, `end` = upper sphere center.
  Inside-a-solid queries (a capsule that is completely inside a closed solid gets no push-out - both sphere centres are behind every face plane - and front-face raycasts pass out of it, so `resolveCapsule`/`raycast` cannot see it): `isInside(point)` / `isInsideXYZ(x, y, z)` (double-sided nearest-hit facing over 8 skewed rays; allocation free), `capsuleInside(capsule)` (either sphere centre inside), `rayBlocked(ox, oy, oz, dx, dy, dz, maxDist)` (allocation-free front-face clearance ray). `build()` pads the octree bounds on the MAX side too (three's Octree only pads min and dropped triangles lying exactly on the +x/+y/+z faces of the bounds: measured 12 / 8 / 16 / 12 triangles missing on foundry / skyline / ruins / sandbox). `resolveCapsule` / `capsuleIntersect` use an own allocation-free capsule-triangle test (`capsuleTri`) instead of three's `Octree.triangleCapsuleIntersect`: three's edge contact derives one closest-point parameter from the unclamped other one, so an edge that is nearly (not exactly) parallel to the capsule axis - the long edges of a slightly tapered pole or pillar against a vertical capsule - reports no contact and the player walks through the pole.
* **procgen** (`src/core/procgen.js`) texture toolkit: `TileNoise` (tileable `perlin`, `fbm`, `ridged`, `worley`), `Field` (wrapping float field: `apply, addNoise, rect (bevels), circle (domes), line, blur, normalize, clamp01, combine, sample, toCanvas(colorFn), toGrayCanvas(), toNormalCanvas(strength)`),
  `makeCanvas, makeCanvasFrom(w,h,fn), canvasTexture(canvas, {srgb, repeat}), buildTextureSet({size, albedo, height, roughness, metalness, emissive, normalStrength})`, `hexToRgb, colorRamp, mix, scale, getNoise(seed), noiseField(size, freq, octaves, seed)`, `setMaxAnisotropy`.
* **utils**: `clamp lerp damp approach smoothstep wrapAngle angleDiff yawFromDirection directionFromYawPitch forwardFromYaw rightFromYaw randomInCone randRange randInt pick chance mulberry32 vec3 toColor disposeObject Pool nextFrame TAU DEG`.
* **constants**: `GRAVITY, HUMANOID, TEAM_BLUE(1), TEAM_RED(2), TEAM_COLORS, TEAM_NAMES, BOT_COLORS, PLAYER_COLOR, BOT_NAMES, WEAPON_IDS, DIFFICULTIES, MODES, RESPAWN_DELAY, SPAWN_PROTECTION, QUALITY_PRESETS` (quality fields: `pixelRatio, shadows, shadowMapSize, bloom, msaa, maxDecals, particleScale`).

### Events catalog

| Event | Payload | Emitted by |
|---|---|---|
| `damage` | `{target, attacker, amount, weapon, headshot, point, direction}` | Combat |
| `death` | `{victim, attacker, weapon, headshot, point, direction}` | Combat |
| `spawn` | `{entity}` | Game |
| `pickup` | `{entity, pickup}` | Pickups |
| `ammo:kill` | `{entity, victim, grants: [{weapon, amount}]}` — the player's kill reward: ~0.3 mag of each weapon the victim carried that the player owns | WeaponSystem |
| `weapon:fire` | `{shooter, weapon, origin, direction}` — once per trigger pull (not per pellet), player AND bots; the Tempest beam emits it at most every 0.5 s while held | WeaponSystem, Bot |
| `weapon:switch` | `{shooter, weapon}` | WeaponSystem |
| `explosion` | `{position, radius, owner, weapon}` | Projectiles |
| `shove` | `{target, attacker, weapon, speed}` — a Gale blast shoved an entity | special/gale.js |
| `splat` | `{victim, attacker, damage, drop}` — a shoved entity hit a wall (damage weapon `'splat'`) | special/gale.js |
| `reflect` | `{owner, kind: 'rocket'\|'grenade'}` — Gale reflected a projectile (owner = the new owner) | special/gale.js |
| `player:jump` | `{type: 'ground'\|'double'\|'wall'\|'slide'}` | Player |
| `player:land` | `{speed}` (downward impact speed m/s) | Player |
| `player:grapple` | `{state: 'fire'\|'attach'\|'release'\|'miss'}` | Player |
| `match:start` / `match:end` | `match` | Game |
| `game:pause` / `game:resume` / `game:menu` | — | Game |
| `hit:predicted` | `{target, weapon, headshot, ci}` — online client: its own hit, before the host confirms (HUD marker) | NetClient |
| `net:status` / `net:lobby` / `net:phase` / `net:closed` / `net:sys` / `net:countdown` | see §6.12 | NetSession, NetHost, NetClient |
| `quality` / `resize` | preset / `{width, height}` | Game |

Weapon ids used in damage/death payloads: `pistol rifle shotgun sniper rocket smg arc rail gale grenade melee fall explosion splat ringout`.

**Tempest / Gale (content drop).** `WEAPONS.arc` (`kind:'beam'`, slot 7, 24 ticks/s while the trigger is held, chain-lightning to 2 more targets) and `WEAPONS.gale` (`kind:'blast'`, slot 9, cone shove + reflect + self push). Shared routines: `weapons/special/arc.js` `fireArc(game, shooter, {origin, dir, muzzle, def, dmgScale})` and `weapons/special/gale.js` `galeBlast(...)` (= `combat.blast(shooter, origin, dir, def.blast, ads)`), `reflectProjectiles`, wall-splat tracking (`Combat.update(dt)` after `bots.update`). `Combat.applyDamage` ignores knockback on spawn-protected entities unless attacker === target. FX: `effects.channel(key, from, to, opts)` (continuous beam, re-call each tick/frame), `effects.lightning(from, to, opts)` (one-shot bolt), `effects.arcHit`, `effects.galeBlast`, `effects.galeRing` (all in `fx/Beams.js`).

---

## 6. Module contracts

### 6.1 Textures — `src/world/Textures.js`

```js
export const MATERIAL_NAMES;                 // string[] of every name below
export function initTextures(renderer);      // once; calls procgen.setMaxAnisotropy(renderer.capabilities.getMaxAnisotropy())
export function getMaterial(name);           // cached shared THREE.MeshStandardMaterial; unknown → console.warn once + 'dev_grid'
export function getMaterialInfo(name);       // { surface, scale /* meters per texture repeat */, emissive: bool }
export async function preloadMaterials(names, onProgress /* (fraction) */); // generate, yielding between materials
```

Required names (surface in brackets):
`concrete`, `concrete_dark`, `concrete_floor` (large slabs + seams), `asphalt` (with faded lines not needed), `plaster` [concrete];
`brick`, `brick_dark`, `tiles_white`, `stone_blocks`, `stone_tiles`, `sandstone`, `sandstone_dark` (carved blocks), `marble`, `rock` [stone];
`metal_panel` (riveted steel panels), `metal_dark`, `metal_rust`, `metal_grate` (floor grating), `metal_corrugated`, `metal_painted_yellow` (safety yellow, chipped),
`container_red`, `container_blue`, `container_green`, `container_yellow`, `container_white`, `container_orange` (corrugated shipping-container paint with rust/dirt streaks, vertical ribs along U), `hazard` (yellow/black stripes, worn), `rubber`, `gold` (temple accents) [metal];
`crate` (wooden crate: planks + frame), `wood_planks` [wood];
`sand`, `dirt`, `grass`, `roof_gravel` [sand/dirt/grass];
`glass_window` (building facade grid of windows, some lit via emissiveMap — warm/cool, looks great at dusk) [glass], `water` (dark, low roughness, ripple normal) [glass];
`neon_blue`, `neon_pink`, `neon_orange`, `neon_green`, `neon_amber`, `neon_warm`, `neon_steel`, `light_panel` (white) [energy] — emissive, soft diffused glow (players found the original values blinding): keep `emissiveIntensity` ≈ 1.0–1.6 and let the wide, low-strength bloom create the halo;
`dev_grid` (fallback: orange/gray 1 m grid) [concrete];
`sign_*` [energy] — Skyline signage typeset on canvas in the UI fonts (`sign_hotel`, `sign_lounge`, `sign_noodle`,
`sign_meridian`, `sign_crown`, `sign_market`, `sign_parking`, ads `sign_ad_halcyon|nova|vanta` + `_wide`); use them on
a `panel` with `fit: true`.

Detail softening: every non-emissive albedo is pulled 30 % toward its mean colour after generation (`SOFTEN_DEFAULT`,
per-material `SOFTEN_OVERRIDE`) and normal maps are flattened to `NORMAL_SCALE` 0.72, so surfaces read calm instead of
noisy; glare control raises every roughness to at least 0.36 and caps metalness at 0.66 (no mirror-like sheets).

Requirements: seamless tiling (use `Field`/`TileNoise` which wrap); map + normalMap + roughnessMap for all non-emissive materials (metalnessMap where useful); `scale` chosen so features read at real size (bricks ≈ 0.25×0.07 m, panels ≈ 1–2 m, containers ≈ 2.5 m); 512² for large surfaces, 256² for small/simple; ≈ ≤ 120 ms average generation per material (share cached noise fields via `noiseField`). Rich detail: grime at the bottom of panels/bricks is not possible in tiling textures — use varied noise, edge wear on bevels, cracks, stains, subtle hue variation per brick/tile/plank, specular variation. Look at `tools/viewer.html?kind=materials` screenshots and iterate.

### 6.2 World — `src/world/World.js` (+ MapBuilder, Pickups, NavGraph, Sky)

```js
export class World {
  constructor(game)
  async init()                        // initTextures(game.renderer), environment/PMREM helpers
  async load(def, { onProgress } = {})// build the map definition (replaces any previous map)
  reset()                             // same map, new match: pickups & jump pads reset
  unload()
  update(dt)                          // pickups (bob/spin, collection, respawn), jump pads, animated props
  applyQuality(q)                     // sun.castShadow = q.shadows; shadow map size = q.shadowMapSize
  raycast(origin, dir, maxDist)       // = collision.raycast(..., BLOCK_SHOTS): what shots and sight hit (Combat depends on it)
  // fields
  def, mapId, collision /* CollisionWorld */, bounds /* THREE.Box3 */, killY,
  spawnPoints /* [{position: Vector3 (feet), yaw}] */,
  pickups /* Pickups */, nav /* NavGraph */, jumpPads /* [{position, radius, velocity}] */,
  lighting /* { sunDirection (unit, toward sun), sunColor, sunIntensity, hemiSky, hemiGround, hemiIntensity, envIntensity, exposure, bloom:{strength,radius,threshold} } */,
  warnings /* string[] validation messages */
}
```

* `load` sets `scene.background` (sky), `scene.environment` (PMREM of the sky so reflections match), `scene.environmentIntensity`, `scene.fog`; adds a shadow-casting directional sun whose orthographic shadow camera covers `bounds` (tune bias/normalBias — no acne, no peter-panning), a hemisphere light, ≤ 4 point lights from `def.lights`, and the sky (gradient dome with sun disc, optional stars/clouds — `Sky.js`).
* Everything map-owned goes in one `THREE.Group` that `unload()` removes and disposes (not shared materials).
* **MapBuilder** converts `def.solids` into geometry **merged per material** (`BufferGeometryUtils.mergeGeometries`) with **world-space box-projected UVs** scaled by `getMaterialInfo(name).scale` (so textures are continuous across adjacent pieces and never stretched), correct outward normals, `castShadow`/`receiveShadow` (emissive and `shadow:false` pieces don't cast). Collision triangles for `collide !== false` pieces are added to `world.collision` with the material's surface type. `visible:false` pieces are collision-only.
* Must work in the viewer with a mock game (`renderer, scene, camera, events, settings, quality, time, entities:[]`, and no-op `audio/effects/hud`). Don't touch `game.player/bots/weapons` in `load`.
* Validate and push to `warnings` (and `console.warn` once per map): spawns inside solids / without floor, pickups not on a floor, unknown solid types / materials. "Inside a solid" is decided with `CollisionWorld.capsuleInside` / `isInsideXYZ` (a capsule buried in a closed solid gets no push-out, so a penetration-depth test cannot see it); this also covers pickups, jump pads and a strided sample of nav nodes. A spawn buried in a solid is relocated at load to the first free standing spot above it (so neither the player nor a bot spawns inside geometry and walks around in it) and reported; `PlayerController.place()` additionally lifts any capsule that is placed inside a solid (teleports) and first pushes out one that merely overlaps or sits exactly on a wall face.
* **Pickups** (`world.pickups`): `list: [{id, type:'health'|'armor'|'ammo'|'grenades'|'weapon', weapon, amount, position, available, respawnTime, nextRespawn}]`, `nearest(type, position, {weapon, availableOnly=true}) → pickup|null`, `update(dt)`, `reset()`.
  Collected when an alive entity's feet are within 1.3 m horizontally and 1.6 m vertically. Apply with `entity.heal(amount)` / `addArmor(amount)` / `addAmmo(null, 0.5)` / `addGrenades(amount)` / `giveWeapon(weapon)` — consume only if it returns true. Emit `'pickup'`, play `'pickup_health'|'pickup_armor'|'pickup_ammo'|'pickup_grenade'|'pickup_weapon'` at the position. Defaults: health 25 (small) / 50 (large) respawn 20 s; armor 50 respawn 25 s; ammo respawn 15 s; grenades 2 respawn 20 s; weapon respawn 25 s.
  Visuals: floating, spinning, emissive-accented low-poly props (medkit with cross, armor shard/vest, ammo box, grenade crate) on a small glowing base ring; weapon pads show `createWeaponModel(id, {view:false})` — **load WeaponModels with a dynamic `import('../weapons/WeaponModels.js')` wrapped in try/catch and fall back to a placeholder**, so the map viewer works even if that module is broken. Unavailable pickups hide the prop (base ring stays, dimmed).
* **Jump pads**: from `def.jumpPads` `{pos, target:[x,y,z], apex=3}` (compute the ballistic launch velocity with GRAVITY so the arc peaks `apex` m above the higher end and lands on `target`) or `{pos, velocity:[...]}`. Launch any alive entity whose feet are within 1.1 m horizontally and 0.7 m vertically of the pad, at most once per 0.5 s, via `entity.launch(velocity)`; play `'jumppad'`. Visual: glowing ring + chevrons.
* **NavGraph** (`world.nav`, built at load, cached per map id, ≤ ~500 ms): walkable multi-level graph for bots.
  API: `nodes: [{id, position (feet), links:[{to, cost, type:'walk'|'drop'|'jump'}]}]`, `nearestNode(pos, maxDist=6)`,
  `findPath(from, to) → Vector3[]|null` (A*, waypoints after the start ending near `to`, string-pulled with clearance checks),
  `randomNode(filter?)`, `randomPointNear(pos, radius)`, `isConnected(a, b)`, `debugObject()` (THREE.Object3D showing nodes/links), `stats: {nodes, links, components, largestComponent, buildMs, removedInside, removedSample}`. `NavGraph.build(tris, bounds, {inside})` takes the point-in-solid test (`CollisionWorld.isInsideXYZ`): column depth counting cannot see nodes inside solids with missing faces (e.g. a pillar shaft without a bottom cap), those nodes are dropped (`stats.removedInside`).
  Suggested build: 1 m grid over bounds; per column cast rays downward through every floor (`collision.raycast`, front faces only, so rays pass up out of solids); a node where the hit normal.y ≥ 0.7 and a standing capsule (r 0.35) fits; 8-neighbour `walk` links when |Δy| ≤ 0.6 with ground under the midpoint and no wall between; `jump` links up ≤ 1.1 m between adjacent cells; `drop` links from ledges to floors 1–6 m below within 2.5 m horizontally. Bots cannot grapple or wall-run.
* `src/world/maps/sandbox.js` — "Proving Grounds": a compact, clean training arena (dev_grid/concrete) that exercises every feature: long wall-run walls, a grapple tower, ramps, stairs, platforms, a jump pad, a few pickups, 8+ spawns.

### 6.3 Map format (`src/world/maps/<id>.js`, `export default { ... }`)

```js
export default {
  id: 'foundry', name: 'Foundry', subtitle: 'Industrial yard · Night',
  description: 'One or two sentences for the menu.',
  colors: ['#1d2b4a', '#ff9a3c'],           // menu card gradient
  bounds: { min: [-50, -2, -50], max: [50, 36, 50] },  // play volume (shadow camera, nav grid, menu camera)
  killY: -20,
  previewCamera: { pos: [38, 22, 38], lookAt: [0, 3, 0] },  // menu backdrop & map card
  theme: {
    sky: { top: '#0a1024', horizon: '#3b2f55', bottom: '#120f1a', sunColor: '#ffd9a0', sunSize: 1, stars: true, clouds: 0.25 },
    sun: { dir: [-0.5, 0.7, 0.35], color: '#ffe2b8', intensity: 2.2 },     // dir points TOWARD the sun
    hemi: { sky: '#8aa0ff', ground: '#2c2218', intensity: 0.6 },
    fog: { color: '#1a1830', near: 40, far: 190 },  // or { color, density: 0.012 }
    exposure: 1.0, envIntensity: 0.6,
    bloom: { strength: 2.4, radius: 0.8, threshold: 0.7, knee: 0.3 },  // strength = value at 100 % Glow (scaled by the glow setting); night maps ~0.4 threshold, day maps ~0.7
  },
  solids: [ /* see below */ ],
  lights: [ { pos: [0, 8, 0], color: '#ffae5c', intensity: 40, distance: 30 } ],   // ≤ 4, no shadows
  spawns: [ { pos: [x, y, z], yaw: 0 } /* or lookAt: [x,y,z] */ ],                  // y = floor height; 14–18
  pickups: [ { type: 'health', pos: [x, y, z], amount: 50 }, { type: 'weapon', weapon: 'rocket', pos } ],
  jumpPads: [ { pos: [x, y, z], target: [x, y, z], apex: 3 } ],
};
```

**Solids.** Common optional fields: `mat` (material name, default `'concrete'`), `rot` (yaw radians about the solid's center), `collide` (default true), `visible` (default true; false = invisible collision), `shadow` (cast shadow, default true).

| type | fields | notes |
|---|---|---|
| `box` | `pos` (center) + `size:[w,h,d]`, **or** `min`/`max` corners | optional `top` / `bottom` material for the ±Y faces (roofs, floors on walls) |
| `wall` | `from:[x,z]`, `to:[x,z]`, `y0` (base, default 0), `height`, `thickness` (0.5) | box between two points, any angle |
| `ramp` | `pos` (bbox center), `size:[w,h,d]`, `dir:'+x'\|'-x'\|'+z'\|'-z'` = direction the ramp rises toward | solid wedge; keep slope ≤ 32° |
| `stairs` | as `ramp` + `steps` (default ≈ h/0.22) | visual steps, collision is a smooth ramp |
| `cylinder` | `pos` (center), `radius`, `height`, `sides` (12), `radiusTop` | |
| `pillar` | `pos` (center), `radius`, `height`, `sides` (8) | column with base + capital |
| `arch` | `pos` (bbox center), `size:[w,h,d]`, `thickness` (1), `lintel` (1), `rot` | two piers + beam |
| `container` | `pos` (center), `rot`, `color:'red'\|'blue'\|'green'\|'yellow'\|'white'\|'orange'`, `size` (default `[2.44, 2.6, 6.06]`, long axis local Z) | detailed shipping container (frame, door bars) |
| `crate` | `pos` (center), `size` (number or `[w,h,d]`, default 1.2) | |
| `railing` | `from:[x,y,z]`, `to:[x,y,z]` (y = walking surface), `height` (1.05) | posts + rails; collision = thin wall |
| `catwalk` | `from:[x,y,z]`, `to:[x,y,z]` (axis-aligned, y = walking surface), `width` (2.5), `railings:'both'\|'left'\|'right'\|'none'`, `thickness` (0.2) | grate deck + railings + support details |
| `panel` | `pos` (center), `size:[w,h]`, `rot` (faces +Z before rotation), `fit` | thin sign / neon / light panel; `collide:false`, `shadow:false` by default; `fit:true` maps the material onto the face exactly once (the `sign_*` materials) |

**Map design rules.** Player: radius 0.4, height 1.8, jump ≈ 1.3 m (+ double jump ≈ 2.4 m), sprint 9.5 m/s, slide, wall-run ≈ 1.7 s along walls ≥ 3 m tall, grapple range 45 m, rocket jumps. Bots walk, jump ≤ 1.1 m, drop down, **cannot grapple or wall-run** — every area bots should reach needs ramps/stairs.
Doorways ≥ 1.8 m wide × 2.6 m tall; corridors ≥ 2.5 m; ramps/stairs ≤ 32°, ≥ 2.5 m wide; floors ≥ 0.4 m thick, walls ≥ 0.3 m.
Design for movement: 3 height tiers (ground, ~4–5 m, ~9–12 m), long flat walls beside gaps/pits for wall-running, overhead beams/rooftops for grappling, jump pads, sightlines broken by cover, loops (no dead ends), 14–18 spawns spread over all tiers, 3–4 health, 2 armor, 3–4 ammo, 2 grenade crates, 1 rocket pad, 1–2 sniper pads, optional shotgun pad.
Enclose the arena with tall boundary walls or buildings plus invisible walls (`visible:false`) up to `bounds.max.y` so nobody escapes by grapple/rocket-jump. Keep ≤ ~700 solids, ≤ 60k rendered triangles. Add rich detail: trims, pipes, beams, barrels (`cylinder`), crates, emissive signage/light strips, railings, and material variety.

### 6.4 Player — `src/player/Player.js` (+ e.g. `PlayerController.js`, `Grapple.js`, `CameraRig.js`)

```js
export class Player extends Entity {       // isPlayer = true
  constructor(game)
  init()
  reset()                   // new match: clear movement/ability state (Game sets name/team/color)
  spawn(position, yaw)      // super.spawn(...) + reset movement state, grapple, camera effects
  update(dt)                // look from input.consumeLook(), movement physics at fixed 120 Hz sub-steps, abilities, sounds, events
  updateCamera(dt)          // writes game.camera position/rotation(order YXZ)/fov (+bob, roll, shake, landing dip, recoil); death cam when dead
  // state read by weapons / HUD / tests (keep updated every frame):
  speed /* horizontal m/s */, onGround, isSprinting, isCrouching, isSliding, isWallRunning, wallRunSide /* -1 wall on left, 1 right, 0 */,
  isGrappling, isMantling, grappleCharge /* 0..1, 1 = ready */, grappleAnchor /* Vector3|null */, landImpact /* 0..1 decaying */,
  // written by WeaponSystem every frame:
  lookScale = 1, fovMultiplier = 1,
  addRecoil(pitch, yaw)     // radians; kicks the aim (pitch up) with partial recovery
  addShake(amount)          // 0..1 camera trauma (explosions, landing)
  cancelSprint()
  giveWeapon(id) / addAmmo(id, fraction) / addGrenades(n)   // delegate to game.weapons.* (for pickups)
  onDeath(info)             // death cam (look at killer), stop loops
  launch(v)                 // jump pads: set velocity, leave ground, suppress ground snap ~0.3 s
}
```

Movement feel (starting values — tune by playtesting with the autotest + your own scripted scenarios):
* Quake-style acceleration: ground accel 11, friction 7 (stop speed 3), walk 6.2, sprint 9.6 (forward only; Shift held), crouch 3.2; air accel 2 with air-strafe wishspeed cap ~1.2 + mild air control. Gravity 24, terminal 55 m/s.
* Jump 8.0 m/s (coyote 0.12 s, buffer 0.12 s); **double jump** 7.4 m/s once per airtime (redirects some horizontal velocity toward input), refreshed by landing, wall-run, grapple.
* **Slide**: crouch while moving ≥ 6.5 m/s on ground → +2.5 m/s boost (1.2 s boost cooldown, cap 14), low friction (~0.9), accelerates down slopes, weak steering; ends below 3.5 m/s; jumping keeps momentum (slide-hop).
* **Wall-run**: airborne + holding forward + horizontal speed ≥ 4.5 + near-vertical wall beside you (side/diagonal rays from chest, reach ≈ radius + 0.45) + ≥ 1 m above ground. Run along the wall tangent at ≥ 10.5 m/s (cap 13), reduced gravity ramping from ~0.2 to 1 over 1.7 s, camera roll ~14° away from the wall. Exit: timeout, wall ends, steer away, crouch, landing. **Wall-jump**: jump → tangent speed kept + wallNormal × 7.5 + up 8.2. Can't re-run the same wall for 0.5 s unless grounded.
* **Mantle**: moving into a ledge whose top is 0.6–2.3 m above the feet with room for the capsule → smooth 0.28 s climb onto it, then keep ~4 m/s forward. A ledge is only accepted when it is reachable from open air: the ledge-top probe must not be behind the wall face continuing upward (stacked solids, roof parapets, boundary walls with an invisible extension have a hidden seam between the layers), the landing capsule must not be inside a solid, and the path up the wall and forward over the ledge (0.1–1.7 m above it) must be free.
* **Safety net**: after movement the controller checks (60 Hz) that neither sphere centre of the capsule is inside a solid (`CollisionWorld.capsuleInside`); if so it restores the last clear position, drops the velocity into the solid and aborts mantle / wall-run / grapple. It must never fire in normal play: `player.move.rescueCount` / `rescueLog`, mirrored into `report.custom.rescues` by the autotest.
* **Grapple** (E): ray from the camera, range 45 m against world geometry. Visual hook flies (≈110 m/s) then attaches; pull toward the anchor (~38 m/s²) with 0.5× gravity, speed cap 24, rope-length constraint (pendulum swing, rope shortens as you approach). Release: press again, jump (detach + up boost 5 + refresh double jump), within 2.2 m, after 3 s, or anchor out of sight. Cooldown 3.5 s (0.8 s after a miss) via `grappleCharge`. Render a rope (thin cylinder or camera-facing ribbon) from the left-hand area to a small claw hook at the anchor. Events `player:grapple`.
* Crouch (C hold): capsule 1.15 m, smooth eye lerp, blocked from standing under ceilings.
* Ground snap (≤ 0.35 m via `probeGround`) when grounded and not jumping/launched; ramps must feel solid.
* Camera: head bob (setting `viewBob`), strafe roll ~1.5°, wall-run roll, landing dip ∝ impact, FOV = `game.getBaseFov()` × `fovMultiplier` + sprint (+5) / slide (+8) / grapple (+10) / high speed (up to +8) kicks (smoothed), shake = trauma² × smooth noise, recoil offsets.
* Sounds (`game.audio`): `footstep` (by distance travelled, faster when sprinting), `jump`, `double_jump`, `land` / `land_hard`, `slide` (loop), `wallrun` (loop), `wall_jump`, `mantle`, `grapple_fire`, `grapple_attach`, `grapple_reel` (loop), `grapple_release`, `hurt` (on damage), `death`.
* The player's hitboxes come from Entity (uses `this.height`).

### 6.5 Weapons — `src/weapons/WeaponDefs.js`, `WeaponSystem.js`, `Projectiles.js`

**WeaponDefs.js**

```js
export const WEAPON_ORDER = [...];   // = constants.WEAPON_IDS, ascending slot order (never index by position: use WEAPONS[id].slot)
export const WEAPONS = { pistol: {...}, rifle: {...}, shotgun: {...}, sniper: {...}, rocket: {...} };
export const GRENADE = { damage: 120, radius: 6.5, fuse: 2.6, throwSpeed: 19, knockback: 14, maxCarry: 4, start: 2, cookable: true };
export const MELEE = { damage: 55, range: 2.2, cooldown: 0.65 };
export function weaponName(id);   // display name for any weapon id incl. 'grenade' 'melee' 'fall' 'explosion'
```

Each weapon def: `{ id, name, slot, kind:'hitscan'|'projectile', auto, damage, headshotMult, pellets, fireRate /* shots/s */, magSize, reserveMax, reserveStart, reloadTime, reloadMode:'mag'|'shell', spread:{hip, ads, moving, air, perShot, max, recovery} /* radians half-angle; recovery per second */, recoil:{pitch, yaw, adsScale}, falloff:{start, end, min}|null, range, adsZoom /* fov multiplier */, adsSensitivity, adsTime, equipTime, tracerColor, sound /* fire sound name */, projectile:{speed, splashRadius, splashDamage, knockback, selfScale}|null, bot:{minRange, maxRange, preferredRange, burst, burstPause, aimTime} }`.
Suggested: pistol (semi, 28 dmg, 12 mag, infinite reserve), rifle "AR-7 Pulse" (auto 11/s, 17 dmg, 32 mag, holo sight), shotgun "Breacher 12" (pump 1.25/s, 12 × 9 pellets, shell reload), sniper "Longbow" (bolt, 95 dmg, ×2.5 head, scoped `adsZoom` ≈ 0.28), rocket "Hammer" (projectile 42 m/s, direct 105 + splash 95 r 4.8, knockback 15, self ×0.35).

**Special weapons (Slipstream `smg` slot 6, Javelin `rail` slot 8).** Their mechanics live in `src/weapons/special/`:
`smg.js` (momentum: horizontal speed scales damage / spread / fire rate through `def.speedBonus`; view-model LED gauge) and `rail.js` (hold-to-charge state machine
`updateCharge`, piercing beam `fireRail` used by the player AND bots, view-model charge glow). The beam ribbons and shock rings are `src/fx/RailBeam.js`
(`getRailBeams(game)`). WeaponSystem exposes `momentum`, `charging` and `chargeAmount` for the HUD (momentum meter, `CHARGING` / `READY` ring, rail crosshair).
A Javelin kill triggers a 0.12 s slow-motion (`game.hitStop(scale, seconds)` when the game provides it, else a `game.timeScale` fallback inside WeaponSystem).

**WeaponSystem.js** — the local player's arsenal and first-person viewmodel.

```js
export class WeaponSystem {
  constructor(game)          // create viewRoot group; add it as a child of game.viewCamera
  async init()               // build view models via createWeaponModel(id, {view:true}) for every weapon
  onMatchStart()
  onPlayerSpawn()            // default loadout: pistol, rifle, shotgun (full reserveStart) + GRENADE.start grenades; select rifle
  update(dt)                 // only when game.state === 'playing' && player.alive: fire/ADS/reload/switch (1-5, wheel, Q)/grenade cook+throw/melee
  updateViewModel(dt)        // position/animate the viewmodel in viewCamera space (hip/ADS from model.hip, model.sight, model.adsDistance)
  giveWeapon(id) → bool      // new weapon (auto-switch) or refill reserve; false if nothing changed
  addAmmo(id|null, fraction) → bool   // null = all owned weapons; fraction of reserveMax
  addGrenades(n) → bool
  setVisible(bool)
  // HUD state:
  currentId, current /* def */, ammo /* in mag */, reserve, reloading, reloadProgress /* 0..1 */, adsAmount /* 0..1 */,
  scoped /* sniper fully zoomed: HUD shows scope overlay, viewmodel hidden */, spreadAngle /* current radians */,
  grenades, maxGrenades, cooking, cookProgress /* 0..1 of fuse */, owned /* ids in slot order */, lastFireTime
}
```

Rules: hitscan fire = `combat.fireBullet` per pellet from the **camera position** along camera forward + `randomInCone(spread)`, `tracerFrom` = viewmodel muzzle world position; emit `weapon:fire` once per shot; `player.addRecoil(...)`; `game.audio.play(def.sound)`; viewmodel muzzle flash (sprite/emissive mesh + small point light that exists permanently in `viewScene`, intensity 0 when idle) and `effects.flashLight(worldPos, ...)` for world lighting. Sprinting blocks firing — pressing fire calls `player.cancelSprint()`. Set `player.lookScale` (`adsSensitivity` when aiming) and `player.fovMultiplier` (lerp to `adsZoom`) every frame. Rockets: `projectiles.spawnRocket({owner, origin, direction})` aimed at the crosshair target point (raycast from the eye) from a point just in front of the eye. Grenades: hold `grenade` to pull pin & cook (fuse counts from pin pull; show a trajectory arc line in the world scene), release to throw `velocity = aim × throwSpeed + up × 3 + 0.4 × player.velocity`; cooking past the fuse explodes in hand (`projectiles.explode`). Melee: `combat.raycast` 2.2 m → `applyDamage` (weapon `'melee'`) or world impact; bash animation.
Viewmodel animation must feel great: smoothed sway from look input, walk/sprint bob tied to player speed, sprint pose (lowered/tilted), slide & wall-run tilt, landing kick (`player:land`), jump lift, recoil kick (back + up + slight random roll) with spring recovery, reload animations using `model.parts` (mag drop/insert, pump, bolt, shell insert, slide release), equip/unequip dip, ADS lerp over `adsTime`, grenade throw with the left hand (grenade model), melee bash, dry-fire click. Sounds: `dry_fire`, `reload_start`, `reload_insert`, `reload_end`, `pump`, `bolt`, `weapon_switch`, `melee_swing`, `melee_hit`, `grenade_pin`, `grenade_throw`.

**Projectiles.js**

```js
export class Projectiles {
  constructor(game)
  init()
  spawnRocket({ owner, origin, direction, speed?, damage?, splashDamage?, radius? })
  spawnGrenade({ owner, origin, velocity, fuse })
  explode(position, { owner, weapon /* 'rocket'|'grenade' */, radius, damage, knockback, normal })
      // combat.radialDamage + effects.explosion + audio 'explosion' + emit 'explosion'
  update(dt)
  clear()
  grenades   // active grenades [{position, velocity, fuse, owner}] (AI avoidance)
}
```

Rockets: model from `createRocketModel()`, constant speed, swept collision each step with `combat.raycast(prev, dir, stepLen, owner)` (direct hit on an entity = direct damage then explosion), `effects.trail(pos, {type:'rocket'})` every frame, positional loop sound optional, explode on world hit or after 6 s. Grenades: `createGrenadeModel()`, gravity, swept raycast collision with reflection (restitution ~0.45, friction on bounce, rolling stops), `grenade_bounce` sound (throttled), spin, `effects.trail(pos, {type:'grenade'})` subtle, explode when fuse ≤ 0. Explosion center offset 0.15 m along the surface normal. Pool meshes.

### 6.6 WeaponModels — `src/weapons/WeaponModels.js`

```js
export function createWeaponModel(id, { view = false } = {}) → {
  root,          // THREE.Group. Origin = right-hand grip point. Bore axis along -Z, +Y up, real-world meters.
  muzzle,        // Object3D at the barrel tip
  sight,         // Object3D on the sight line; looking from it along -Z passes through the front sight / reticle center
  ejectPort,     // Object3D (optional) for shell ejection
  hip,           // view only: THREE.Vector3 root position in camera space for hip fire, e.g. (0.17, -0.2, -0.42)
  adsDistance,   // view only: eye → sight distance when aiming (≈ 0.12–0.3)
  parts,         // { mag, slide, bolt, pump, trigger, leftHand, rightHand, leftArm, rightArm, ... } animatable sub-objects (pivots at joints)
}
export function createGrenadeModel() → THREE.Group   // ~0.1 m frag grenade, origin at center
export function createRocketModel() → THREE.Group    // ~0.6 m rocket, nose toward -Z, origin at center, emissive exhaust glow at the tail
```

* `view: true` models include **first-person arms**: sleeves + armored gloves, right hand on the grip, left hand on the handguard/pump (both hands on the pistol grip), forearms running back toward the lower screen corners and far enough (z ≈ +0.3 in root space) that no cut end is visible at hip or ADS. `view: false` (bots, pickups) has no arms and ≤ 1200 tris; view models ≤ 4000 tris including arms.
* Distinct near-future sci-fi silhouettes, low-poly with chamfers (bevelled boxes, low-segment cylinders, `RoundedBoxGeometry` sparingly), shared procedural materials built with `procgen` (gunmetal with edge wear & fine scratches, grainy polymer, wood for the shotgun, per-weapon accent paint, emissive details: red-dot/holo reticle, glowing energy cell, scope lens tint, rocket warning lights). Pistol "P-9 Viper", rifle "AR-7 Pulse", shotgun "Breacher 12" (pump), sniper "Longbow" (large scope, bolt), rocket launcher "Hammer" (shoulder tube).
* Cache geometries/materials; each call returns a new object tree (bots each hold one).

### 6.7 BotModel — `src/ai/BotModel.js`

```js
export class BotModel {
  constructor({ color, team })   // color: number|THREE.Color accent (visor, shoulder plates, lights)
  root                           // Group; origin at feet center; faces -Z; ≈1.8 m tall; add to game.scene
  eye                            // Object3D at eye height (~1.66 m)
  weaponSocket                   // Object3D in the right hand; weapon root attaches with -Z along the aim direction
  setWeapon(weaponModel)         // result of createWeaponModel(id, {view:false}); replaces previous; stores this.weapon
  getMuzzleWorldPosition(out)    // world position of the held weapon's muzzle (fallback: in front of the chest)
  update(dt, state)              // procedural animation; state = { forwardSpeed, strafeSpeed, speed, onGround, crouch (0..1), aimPitch, aimYawOffset, firing, reloading, alive }
  flashHit()                     // brief bright emissive flash when damaged
  setVisible(visible)
  breakApart() → THREE.Mesh[]    // world-transformed clones of the body pieces for death gibs (not added to any parent; share geometry/material)
  dispose()                      // per-instance resources only
}
```

Look: sleek low-poly combat robot — angular helmet with a glowing visor strip in the accent color, armored chest plate, glowing power core in the back, segmented limbs with dark joints, accent-painted shoulder plates, stencilled unit number, painted-metal procedural texture with panel lines and wear. 1500–3000 tris, ≤ 25 meshes (merge static pieces per bone). Animation: walk/run cycle driven by forward/strafe speed (legs swing, arms counter-swing when not aiming, body bob), idle breathing, weapon held two-handed along the aim with pitch applied at the torso/arms, `aimYawOffset` twist, crouch pose, airborne pose, recoil on `firing`, reload gesture, head following aim.

### 6.8 AI — `src/ai/Bot.js`, `BotBrain.js`, `BotManager.js`

```js
export class BotManager {
  constructor(game)
  init()
  async prepare(world)                          // world.nav exists; precompute map-specific data (cover/snipe spots)
  spawnBots(count, difficulty, mode) → Bot[]    // create, game.addEntity(bot); FFA: bot.team = bot.id, color BOT_COLORS[i]; TDM: teams alternate 2,1,2,1…, TEAM_COLORS; unique BOT_NAMES
  clear()                                       // remove models from scene, game.removeEntity each bot
  update(dt)                                    // all bots: think, move, animate; push overlapping bots apart (bots only)
  get list()                                    // Bot[]
}
export class Bot extends Entity {               // isBot = true
  difficulty, weaponId, ammo, reserve, grenades, model /* BotModel */, brain /* BotBrain */
  spawn(position, yaw)                          // super.spawn; pick a primary weapon (weighted random over all 5), refill, reset brain, show model
  update(dt)                                    // brain → intent; capsule physics via world.collision.moveCapsule (gravity, accel, friction, jumps, ground snap); aim smoothing; firing; model.update
  onDeath(info)                                 // effects.gibs(model.breakApart(), {...}); audio 'bot_death'; hide model
  giveWeapon(id) / addAmmo(id, f) / addGrenades(n)   // pickups
}
```

* Firing uses the same `WEAPONS` defs: `combat.fireBullet` per pellet (origin = bot eye, `tracerFrom` = model muzzle), rockets/grenades via `projectiles`, `effects.muzzleFlash(muzzlePos, dir)`, positional `audio.play(def.sound, {position})`, emit `weapon:fire`, magazines & reloads.
* Brain: perception (vision cone by difficulty, LOS via `combat.canSee` from eye to target head/chest, max 80 m; hearing `weapon:fire` / `explosion` within ~40 m reveals the source; short memory of last-known positions), target selection (distance, visibility, who hurt me, low health), states `roam` (nav to random nodes weighted toward pickups), `engage` (strafe/circle-strafe, keep weapon-preferred range, jump/crouch occasionally, lead projectiles, grenade when target hides nearby), `chase` (last known position), `retreat` (low health → nearest health pickup or away), `collect` (weapon pads/ammo/armor when nearby & safe). Stuck detection (repath / jump / sidestep). Flee live grenades within ~5 m. Bots fight each other in FFA.
* Human-like aim: reaction delay, smoothed turn rate, tracking lag on moving targets, error that shrinks while tracking and grows when the bot or target moves, recoil. Difficulty presets `easy | normal | hard | insane` (reaction ≈ 0.7/0.45/0.3/0.18 s, aim error, turn speed, FOV, strafing, grenade use). Normal should be a fair fight for an average player.
* `brain.state` is a string (reported by the autotest).

### 6.9 Effects — `src/fx/Effects.js`

```js
export class Effects {
  constructor(game), init(), update(dt), clear()
  impact(point, normal, surface)            // world hit: sparks (metal) / dust (concrete, stone, sand, dirt) / splinters (wood) / energy sparks + bullet-hole decal (pooled, quality.maxDecals) + throttled 'impact_<surface>' sound
  hitSpark(point, normal, entity)           // robot hit: bright sparks + oil/smoke puff; call entity.model?.flashHit?.()
  tracer(from, to, { color })               // bright streak, 0.05–0.1 s
  muzzleFlash(position, direction, { scale = 1, color })  // world-space flash + pooled light (bots)
  flashLight(position, color, intensity, distance, duration) // pooled point light (fixed pool of 4, never add/remove lights)
  explosion(position, { radius = 5, normal })  // fireball, smoke, sparks, debris, shockwave ring, scorch decal, light; camera shake via game.player.addShake by distance (guard if no player)
  trail(position, { type: 'rocket' | 'grenade' })  // emit trail particles (called each frame)
  gibs(meshes, { velocity, direction, point })     // bot debris: add to scene, simple physics (gravity, bounce via world.raycast), sparks/smoke, fade & remove after ~4 s; never dispose shared geometry/materials
  dust(position, { amount = 1 })            // landing / slide dust
}
```

GPU-friendly: pooled particles (e.g. one `THREE.Points` per blend mode with a custom soft-sprite shader or instanced billboards), canvas-generated sprite textures, decals as pooled quads with polygonOffset aligned to the normal. Scale counts by `quality.particleScale`. ≤ ~3000 particles.

### 6.10 Audio — `src/core/Audio.js`

```js
export class AudioSystem {
  constructor(game), async init()
  unlock()                                        // create/resume the AudioContext (called from user gestures; idempotent)
  play(name, { position = null, volume = 1, rate = 1 } = {})     // one-shot; position → 3D spatialised
  playLoop(name, { volume = 1, rate = 1, position = null } = {}) → { setVolume(v), setRate(r), setPosition(v3), stop() }
  update(dt)                                      // AudioListener pose from game.camera
  setMasterVolume(v), setMusicVolume(v)
  playMusic(name, { loop = true, fadeIn = 0.8 })  // 'menu' | 'victory' | 'defeat' (MUSIC_TRACKS, music/*), crossfades
  stopMusic(fade = 0.8), preloadMusic(names)
}
```

All sounds synthesised with WebAudio (noise/oscillators, filters, envelopes, distortion), pre-rendered into buffers at init (OfflineAudioContext, 2–3 variations each), voice limit ~32, distance attenuation. Must never throw if audio is unavailable (headless tests) — degrade to no-op. Unknown names → `console.warn` once.
Required names: `pistol_fire rifle_fire shotgun_fire sniper_fire rocket_fire dry_fire reload_start reload_insert reload_end pump bolt weapon_switch melee_swing melee_hit grenade_pin grenade_throw grenade_bounce explosion impact_metal impact_concrete impact_stone impact_wood impact_dirt impact_sand impact_glass impact_grass impact_energy impact_robot hitmarker headshot kill_confirm hurt death bot_death footstep jump double_jump land land_hard wall_jump mantle slide wallrun grapple_fire grapple_attach grapple_reel grapple_release jumppad pickup_health pickup_armor pickup_ammo pickup_weapon pickup_grenade ui_hover ui_click match_start match_end spawn`
(`slide`, `wallrun`, `grapple_reel` are loops.)

### 6.11 UI — `src/ui/HUD.js`, `src/ui/Menu.js`, `style.css`

```js
export class HUD {
  constructor(game)        // build DOM inside game.uiRoot
  init()
  show(visible)
  onMatchStart(match)
  update(dt)               // poll game.player / game.weapons / game.match; hold Tab (input.action('scoreboard')) for the scoreboard
}
export class Menu {
  constructor(game), init()
  showMain()               // title + Play (map cards from game.maps, mode, bots 0–15, difficulty, score & time limits) + Settings + Controls
  showPause()              // Resume (game.resume()), Restart (game.restartMatch()), Settings, Quit (game.quitToMenu())
  showEnd(match)           // winner, full scoreboard, Play again, Main menu
  showLoading(text, progress)   // progress 0..1
  hideLoading()
  hide()
}
```

* Start matches by calling `game.startMatch({mapId, mode, botCount, difficulty, scoreLimit, timeLimit})` **directly inside the click handler** (pointer lock needs the user gesture). Settings write `game.settings.set(k, v)` (sensitivity, invertY, fov, viewBob, showFps, quality, masterVolume, playerName). Play `ui_hover`/`ui_click` sounds (call `game.audio.unlock()` on first click).
* HUD: dynamic crosshair (gap from `weapons.spreadAngle`: px = tan(spread)/tan(vfov/2) × innerHeight/2; hidden when scoped), hit markers (white; red on kill; headshot variant) from `damage`/`death` events where `attacker === game.player`, health & armor bars (low-health vignette/pulse), ammo `mag / reserve` (∞ for pistol), weapon name + slot strip (up to 9 slots generated from `WEAPON_IDS`, key label = `slot`, owned/selected; Slipstream momentum meter, Javelin charge ring), grenade count, grapple charge ring, reload progress, speedometer, match timer, score / leader (FFA) or team scores (TDM), kill feed (top-right, names in entity colors, weapon names via `weaponName`), directional damage indicators, sniper scope overlay when `weapons.scoped`, death overlay ("Eliminated by X", respawn countdown from `player.respawnAt - game.time`), announcements (Double Kill, Multi Kill, Killing Spree, Headshot, First Blood, "Match point"), scoreboard (Tab), pickup toasts, subtle speed-lines vignette at high speed, spawn-protection indicator, FPS counter when `settings.showFps`, pointer-lock hint when `input.lockUnavailable`.
* Style: sleek sci-fi — dark translucent panels, cyan accent `#3de0ff`, warm secondary `#ff9a3c`, angled corners (clip-path), uppercase condensed headings (bundled `Barlow` / `Barlow Condensed` from `fonts/`, system fonts as fallback). Menus over the live 3D backdrop. Responsive down to 1280×720. All interactive elements `pointer-events: auto`.

### 6.12 Multiplayer — `src/net/`, `src/ui/NetMenu.js`, `desktop/relay.js`

Listen server: the host's game is the authority (bots, combat, health, scores, pickups, projectiles, modes); every
human simulates its own movement exactly as in single player (no input latency) and streams it; a relay only allocates
4-letter room codes and routes packets. Full design: `docs/multiplayer/MULTIPLAYER_CONTRACT.md` (deviations: §6.12.5).

**Relay.** Desktop app: `desktop/relay.js` (Node, no dependencies) runs in the Electron main process when a player
hosts, on TCP 27500 of every interface; the page reaches it through `window.kineticDesktop.startServer/stopServer/
serverStatus` (`desktop/preload.js`). It serves no files: `/ws`, `/api/rooms`, `/api/lan`; accepts Origin
`kinetic://game`; per-IP connection cap, host/join rate limit, handshake timeout. Browser version: `tools/netserver.py`
mounted by `tools/serve.py` (`host-lan.bat`), plus `/api/build`. Same wire protocol (`src/net/protocol.js`).

**Modules.** `NetSession` = `game.net` (role `'offline'|'host'|'client'`, phase, the transport, per-frame JSON batches,
clock, `on/send/sendNow/registerSection/onEnd`); `NetHost` (lobby, load barrier, match build, RemotePlayers, CSTATE
intake, snapshots, claims, grants, forces, late join / deploy gate); `NetClient` (welcome / load / begin, NetAvatars,
snapshot decode + interpolation, own block, CSTATE, pings, claims, grants, impulses); `NetCodec` (byte layouts);
`NetClock` (net time, `InterpBuffer` Hermite ring, `DelayEstimator`); `RemotePlayer` (host: a joined human; renders the
smoothed `position`, rules use `authPos` = latest report); `NetAvatar` (client: every other fighter); `Avatar` (the robot
body + derived presentation: pose, footsteps, loops, rope; `Avatar.decorators`); `NetEvents` (game-event replication:
dmg/death/spawn/pk/exp/shove/splat/reflect + snapshot section 1, pickups); `FxMirror` (one-shot effects / positional
sounds captured in windows and replayed on the entity timeline); `NetArsenal` (projectile ids + section 2, client
actions rocket/nade/cook/gale executed by the host, predicted own rockets, client vortex pull, Tempest beam decorator);
`NetModes` (stub); `HostTicker` (Worker tick); `Teams`; `NetEm` (test network impairment, `?netem=`); `ui/NetMenu`
(hub, lobby, online pause / end variants); `ui/Nameplates` (tags over other humans: teammates within 80 m, enemies only
in sight within 60 m). Storm (Stratos): the host picks every strike and sends `storm {rod, warn}`; clients run that
strike locally (warning, bolt, no damage) and never pick their own; storm effects are not mirrored.

**Entity flags.** `isLocal` (the Player), `isHuman`, `isBot`, `isRemote` (RemotePlayer), `isProxy` (NetAvatar),
`simLocal` (this machine moves it), `authPos`, `netPeer`, `netHost`, `ping`, `connected`, `netHold`. `isPlayer` stays an
alias of `isLocal`. Listeners that also run on clients use Entity fields only (a NetAvatar has no Bot internals).

**Gates.** `net.authority` (false on clients): Combat `applyDamage` (a client's own hits become claims) / `kill` /
`radialDamage` / `update`, Game `_onDeath` scoring, `_updateMatch` (clients: match clock only), Pickups respawn +
collection, bots. `match.phase === 'countdown'` (online only): frozen movement input, idle weapons, no damage, bots
model-only, no pad launches, no pickups. No pause online: Esc / lost lock / hidden tab open the match menu
(`openMatchMenu`), `timeScale` never changes (Javelin hit-stop = `game.hitStop`, FOV punch only).

**Wire.** Binary `CSTATE` client → host (62 B, 60 Hz; 10 Hz while dead), `SNAPSHOT` host → each client (60 Hz, 30 Hz
fallback while that client's lag spread stays > 12 ms; header + own block + shared body: entities, sections 1 pickups /
2 projectiles), `PING`/`PONG` (clock offset), reliable `JSON` batches `{e: epoch, m: [...]}` (unicast batches flushed
before the broadcast one). Lobby kinds work in any epoch; in-match kinds and snapshots only after `netBeginMatch` of the
current epoch. Event fields carry `at` (host net ms); snapshots never override a newer event.

**Timelines.** Clients show other fighters, their projectiles and replayed effects at `hostNow − delay` (measured from
sample ages: ≈ 30–45 ms on a LAN at 60 Hz); the host smooths remote humans the same way (≈ 10–30 ms) and hit-tests that
view. Hitscan / melee / beam hits are decided by the shooter on what it saw (favor the shooter) and validated by the host
against snapshot history (position, range, rate, amount, weapon).

**Flow.** Main menu → Multiplayer hub (name; host; join by address + code or the room list) → host setup (Match setup,
Create room) → lobby (code, address for friends, players, ready, Start) → everyone loads (barrier, 45 s timeout) → begin
(countdown 3 s, CLICK TO PLAY for pointer lock) → match → end (host: Rematch / Back to lobby / Close room; clients follow).
Late joiners load, see an overview, and spawn with 3 s protection on their first click (deploy gate, ≤ 10 s). A client
whose link goes silent for 2.5 s is held out of play (no death) until it reports again. Host leaving closes the room.

**Tests.** `python tools/run_mp.py ... --report --json <out>` (one headless window per page; `--node-relay` uses
desktop/relay.js; `--hide P:T:D` minimizes a window, `--close P:T`, `--relay k=v`), `python tools/mp_check.py <out>
--expect <suite>`, all suites: `bash tools/mp/run_all.sh [--node-relay]` (move, smoke, hostloop, session, duel,
latejoin, arsenal). Unit tests: `python tools/run.py tools/mp/unit.html --wait "window.__UNIT__ && window.__UNIT__.done"
--eval window.__UNIT__`. Relay: `python tools/test_relay_node.py`, `python tools/test_netserver.py`.

#### 6.12.5 Deviations from the contract (so far)

* Desktop hosting (not in the contract): the Node relay in the app, joining by host address + room code.
* Snapshot jitter = spread (p95 − p5) of one-way lag, not inter-arrival jitter (the host's own frame timing is not network
  jitter); the 30 Hz fallback needs two reports in a row; local stalls (a long frame of this page) never raise the
  interpolation delay or count as lag.
* A joined human's snapshot state is its report evaluated at the snapshot's time (≤ one report interval of extrapolation),
  not the raw report stamped with the build time.
* Teleport detection allows 0.75 m beyond the implied-speed rule (step-ups, mantles).
* Not built yet: the rest of mp-modes (King of the Hill zones / scores and Escalation tier events on clients, rejoin
  keeping the slot; storm strikes are done), most mp-ui polish (net status, team columns, kick button, settings code,
  host performance hints), predicted own grenades, Javelin charge glow on avatars.

---

## 7. Budgets & definition of done

* 60 fps with 8 bots on a mid GPU at 1080p (high quality). Static map geometry merged by material (≤ ~40 draw calls), ≤ 60k map triangles, collision ≤ 20k triangles; bots ≤ 3k tris; view models ≤ 4k tris; ≤ 4 map point lights + 4 pooled effect lights + 1 viewmodel flash light (fixed count).
* **Done means:** every owned file exists and implements this contract exactly; `python tools/lint_imports.py <your files>` passes; `python tools/run.py --check <your files>` loads without errors; visual work reviewed via screenshots and iterated; JSDoc on public methods. Final report: what you built, how you verified it, known limitations, any contract deviations or requests.
