# mp-sim-surface

## Summary
Scope: request #1 (multiplayer), the simulation side of a listen-server design. The host's browser runs the authoritative simulation. Remote clients send inputs and predict their own movement. All src/... citations are relative to C:/Users/caleb/Documents/GitHub/Kinetic/fps. The experiments live in C:/Users/caleb/Documents/GitHub/Kinetic/fps/tools/out/_claude/mp-sim/ (no src/ file was edited).

Main result: the movement stack can already run more than one human in the same game, and it is deterministic. Three Player instances ran together in one match. Extra instances p2 and p3 were stepped manually at 120 Hz from command structs. Restoring a snapshot and replaying 480 steps (4 s of sprint, jump, slide, wall-run and landing) reproduced position and velocity exactly, both in the same object and in a different instance (maximum difference 0). A step costs 0.016-0.030 ms (median 0.024), so replaying 12 steps to reconcile after 100 ms of round-trip time costs about 0.3 ms. That makes client-side prediction and reconciliation practical.

The shadow-game experiment shows exactly what a remote human needs. It gave a second Player and a second WeaponSystem an Object.create(game) whose input, player, camera, viewCamera and weapons were its own; nothing else was changed. That entity then fired the rifle and shotgun and threw a grenade: 17 damage events and 257 HP were credited to it, it used its own ammo (rifle 32→20, shotgun 6→4, frag 2→1), the host's ammo stayed untouched, and its aim-down-sights (ADS) state was independent of the host's. So the per-entity refactor is mostly about passing in five fields that are currently global singletons, not rewriting movement or weapon logic.

The blockers are single-human assumptions and presentation leaks, all confirmed at runtime:
- PlayerController reads the host's ADS (game.weapons.adsAmount), so a remote player slowed from 6.2 to 4.464 m/s when the host aimed down sights.
- Player pickups and GrenadeTypes.inventoryOf send items to the host's WeaponSystem (p2 picking up the sniper gave it to the host).
- The grapple hook starts from the host camera (p2's hook left from 0.6 m off the host camera, 67.9 m from p2's own eye).
- A remote player's movement fires global 'player:*' events and non-positional sounds (jump, land, rifle_fire, pump...), so they sound like the host's own.
- Effects.hitSpark skips every entity flagged isPlayer, so remote humans would show no hit sparks.
- Escalation tier changes, the respawn loadout, TDM team/colour, playerWon and the scoreboard 'me' row all assume one human.
- The Javelin hit-stop changes the global game.timeScale, and the host's game pauses on blur or when the mouse is released (game loop is requestAnimationFrame-driven).

Bots cannot be reused for remote humans as a whole. Their rendering (BotModel) can: a BotModel driven by a PlayerController entity rendered correctly. Their firing cannot, because Bot._fire has bot-only rules (difficulty scaling, a synthetic spread formula, random fire-interval jitter).

Lag compensation needs only position and height history, because getHitboxes reads nothing else. In a prototype, 43 of 43 rewound shots hit a bot's pose from 150 ms earlier, versus 1 of 43 without rewind, at about 0.1 ms per rewound raycast.

Measured network budget (8 bots plus the player on Foundry):
- A quantised snapshot is 246 bytes on average (283 max) for 9 entities plus up to 2 projectiles: about 25 bytes per entity, 16-byte header, 17-18 bytes per projectile. That is 4.8 KB/s per client at 20 Hz or 7.2 KB/s at 30 Hz.
- Events run at about 11/s (weapon:fire 7.1, damage 2.6); effects calls at about 36/s.
- Math.random is called about 2600 times per simulated second (77% in Effects, but also bot AI, spawn picking, storm scheduling and weapon spread). A lockstep design is therefore out, and a snapshot model with seeded weapon spread is the right fit.

## Key files
- src/core/Entity.js: Base of Player/Bot: the replicated fields (id, team, alive, health, armor, position, velocity, yaw, pitch, height, eyeHeight, onGround, kills/deaths/streak/tier/zoneTime, respawnAt, spawnProtectedUntil, shockedUntil). getHitboxes reads only position+height, so lag compensation needs only that history. isPlayer/isBot are the only role flags; nothing separates 'local' from 'human'.
- src/core/Game.js: Frame loop (requestAnimationFrame, variable dt ≤ 0.05), match flow, entity registry (ids reassigned each match), respawn and loadout (only for game.player), team/colour for a single human, playerWon, pause on blur/mouse release, timeScale. Where NetPlayers must be updated (after lines 772-773) and snapshots sent.
- src/player/Player.js: Local human = Entity + fixed 120 Hz stepping, but reads game.input/settings for look and buttons, runs grapple/shock/eye-height updates per frame outside the fixed step, routes pickups to game.weapons, and plays non-positional sounds plus global 'player:*' events.
- src/player/PlayerController.js: Movement physics. Instance-safe and deterministic (verified). Its only outside couplings are game.weapons.adsAmount (lines 480, 662), game.world.collision, the owner's presentation callbacks and prevPosition/stepOffset. Its full state (33 numbers, 13 booleans, 11 vectors + capsule) is the reconciliation snapshot.
- src/player/Grapple.js: Grapple state machine + rope visuals. The hook origin comes from game.camera (_handWorld 419-422); update runs per frame; sounds are non-positional and 'player:grapple' events carry no entity.
- src/player/CameraRig.js: Presentation only (writes game.camera). Needed only for the local player; updateDead writes P.yaw/pitch.
- src/weapons/WeaponSystem.js: Singleton arsenal for game.player, with logic and viewmodel interleaved. About 30 game.player, 5 game.input and 8 game.camera references are the per-entity refactor surface. Aims from the camera, plays non-positional sounds, and _hitStop changes the global timeScale.
- src/weapons/special/rail.js: fireRail is shooter-parameterised (reusable); updateCharge reads game.input/game.player (139-141).
- src/weapons/special/arc.js: fireArc/beamCadence are shooter-parameterised; the beam visual is keyed by shooter id (supports several beams).
- src/weapons/special/gale.js: galeBlast/reflect/shove are shooter-parameterised. Reflection reassigns projectile owner/direction/speed; shove and splat state lives on entities (_shove/_shovedBy); updateShoves is called from Combat.update.
- src/weapons/special/smg.js: Pure momentum helpers (reusable per entity).
- src/weapons/Projectiles.js: Pooled rockets/grenades with no network ids. Rockets fly straight; grenades bounce off the world and entities; explode() calls radialDamage + effects + 'explosion'. Needs ids plus a client render-only mode.
- src/weapons/GrenadeTypes.js: inventoryOf routes isPlayer entities to game.weapons (64). Vortex/static/kinetic/smoke simulation (host-only) plus effects. Random loadout/crate specials.
- src/core/Combat.js: Authoritative damage: raycast (entities via getHitboxes), fireBullet, applyDamage, kill, radialDamage, smokes. The place for rewind history (withRewind) and for 'host only' checks.
- src/core/Modes.js: Escalation (_setTier routes isPlayer to game.weapons, line 82) and King of the Hill state (match.koth) that must be replicated.
- src/ai/Bot.js: Bot entity. _updateModel/_getWeaponModel/onDeath gibs can be reused as an 'Avatar' for any remote entity; _fire uses bot-only rules (not reusable for humans).
- src/ai/BotManager.js: Bot spawning (team alternation assumes one human on Blue), separation only against game.player (209, 234-244), hearing/damage hooks (generic).
- src/ai/BotModel.js: Fully decoupled rendering driven by a state object. Verified rendering a PlayerController entity. No wall-run/slide/grapple poses.
- src/world/Pickups.js: Stable pickup ids; update mixes collection/respawn (simulation) with _animate (visuals).
- src/world/World.js: update = sky + storm + pickups + jump pads (launch is simulation, pad flash is a visual).
- src/world/Storm.js: Random strike scheduling + radialDamage inside world.update. Must become host-driven strike events.
- src/fx/Effects.js: hitSpark skips all isPlayer entities (453); explosion shake uses game.player (local, fine).
- src/ui/HUD.js: Event-driven, compares against game.player and reads game.weapons. Works unchanged on each machine if the client maps entity ids to local objects before emitting events.
- tools/out/_claude/mp-sim/motor.js: Experiment: two extra motors, snapshot/replay determinism, host-ADS / inventory / grapple-origin couplings, event/sound leaks (output motor_run.txt; motor_bench.js / motor_bench_run.txt for timing).
- tools/out/_claude/mp-sim/shadow.js: Experiment: a per-entity Player + WeaponSystem driven by a stand-in input through an Object.create(game) with its own input/player/camera/viewCamera/weapons (output shadow_run.txt).
- tools/out/_claude/mp-sim/match.js: Experiment: event/effects/sound rates, quantised snapshot size, Math.random attribution, lag-compensation prototype (output match_run.txt).
- tools/out/_claude/mp-sim/avatar.js: Experiment: BotModel avatar driven from a PlayerController entity (screenshot avatar_end.png).

## Findings
### [critical] PlayerController is instance-safe and deterministic: client prediction and reconciliation are practical
Experiment motor.js: two extra Player instances (p2, p3) were added with game.addEntity and spawned, then stepped manually at M.STEP = 1/120 s from command structs. Each step filled P.move.in (wishX/Z, fwd, strafe, jumpFresh, crouchFresh, sprintHeld), ran grapple.update(STEP), then move.step(STEP), all without game.input. p2 ran, jumped, went airborne, wall-ran and landed on Foundry independently of the host.

Snapshot S0 of Player + controller + Grapple fields, 480 recorded steps, then restore S0 and replay:
- maxAbsDiffSameObject = 0
- maxAbsDiffOtherInstance = 0 (restored into p3)
Module-level scratch vectors do not leak state between instances. Final state after 480 steps: pos (-22.5518, 0, -43.6), vel (-6.4918, 0, 0).

Cost (motor_bench.js, 10 replays of 480 steps): 0.0156 / 0.024 / 0.0298 ms per step (min / median / max). That is about 2.9 ms per second per remote player on the host, and a 12-step reconciliation replay (100 ms round trip) costs about 0.29 ms.

Fields in the full motor state:
- Player: 35 numbers, 13 booleans, 4 vectors (many are presentation or score fields).
- Controller: 33 numbers, 13 booleans, 11 vectors + capsule: t, grounded, airTime, coyote, jumpBuffer, airJumps, wallJumps, wallRunsThisAir, refreshUsed, snapBlockUntil, landSuppressUntil, crouched, sliding, slideTime, lastSlideBoost, crouchPressedAt, lastLandT, sprinting, sprintIntent, _crouchWas, sprintLockUntil, wallRunning, wallRunTime, wallLost, noFwd, awayT, runSign, lockUntil, lockD, wallCoyote, wallSide, wallPlaneD, scanTick, mantling, mantleT, mantleDur, mantleCooldown, mantleHeight, stepCount, _netTick, _netForce, _safe*, groundNormal, wallN, lastWallN, lockN, mantleFrom/To/Dir.
- Grapple: 12 numbers, 1 boolean, 6 vectors + state string.
The controller keeps its own clock (this.t) and has no Math.random.

Caveat: bit-exactness is verified within one Chrome process only. Math.sin, cos, exp, atan2 and hypot are not guaranteed to be identical across browsers.
Evidence: tools/out/_claude/mp-sim/motor_run.txt (replay.maxAbsDiff*=0, stateFields); tools/out/_claude/mp-sim/motor_bench_run.txt:314-319 (bench); src/player/PlayerController.js:39-75 (constructor, in-struct); src/player/PlayerController.js:78-124 (reset = state list); src/player/PlayerController.js:237-268 (step); src/player/Player.js:176-187 (fixed-step loop)

### [critical] Movement + arsenal for a remote human need exactly five per-entity fields: input, player, camera, viewCamera, weapons
Experiment shadow.js built shadow = Object.create(game) with its own input (a stand-in exposing action, actionPressed, actionReleased, wheel, and consumeLook returning 0), player = p2, camera = cam2, viewCamera = vc2 and weapons = ws2. It then created p2 = new Player(shadow) and ws2 = new WeaponSystem(shadow) with ws2.init() and setVisible(false). No src/ change was made.

Each frame: set the input's buttons, set p2.yaw/pitch as absolute aim angles, then call p2.update(dt), p2.updateCamera(dt) (the CameraRig wrote cam2, 81.5 m away from the host camera), copy cam2 into vc2, ws2.update(dt) and ws2.updateViewModel(dt).

Results:
- 12 rifle shots, switch to shotgun (weapon:switch shooter = p2), 2 shotgun shots, grenade cooked and thrown (projectile owner = p2).
- 14 weapon:fire events with shooter = p2; 17 damage events credited to p2 (257 HP: rifle 2, shotgun 14 pellets, grenade 1).
- ws2 ammo: rifle 32→20, shotgun 6→4, frag 2→1. Host arsenal untouched (rifle 32, shotgun 6).
- ADS: ws2.adsAmount = 1 with the host at 0; p2.fovMultiplier = 0.9 with the host at 1.
- Per-entity weapons also fixes the ADS and inventory couplings, because Player/PlayerController reach game.weapons through this.game.

The prototype trick is fragile, because writes to game.X from inside the shadow land on the shadow (for example _hitStop's g.timeScale or railBeams creation). Production should pass these five as explicit constructor options.
Evidence: tools/out/_claude/mp-sim/shadow.js; tools/out/_claude/mp-sim/shadow_run.txt (setup, adsWhileHeld, result); src/weapons/WeaponSystem.js:838,845,1027,1059-1060,1512-1513,1626-1627 (game.player/game.input/game.camera uses); src/weapons/special/rail.js:139-141

### [high] The host's ADS slows every other human (PlayerController reads the singleton game.weapons.adsAmount)
PlayerController.js:480 (_updateSprint) and :662 (_groundStep) both do: const ads = this.game.weapons ? (this.game.weapons.adsAmount || 0) : 0.

Measured (motor.js, ADS phase): p2's maximum walk speed was 6.2 m/s with the host firing from the hip and 4.464 m/s (= 6.2 × (1 - 0.28)) while the host was in ADS (hostAdsAmount = 1). Sprint gating (ads < 0.4) is also affected.

Fix: read this.p.adsAmount (a per-entity field). The owner's WeaponSystem already writes p.lookScale and p.fovMultiplier each update (WeaponSystem.js:914-915) and can write p.adsAmount next to them.
Evidence: src/player/PlayerController.js:480; src/player/PlayerController.js:662; src/weapons/WeaponSystem.js:903-915; tools/out/_claude/mp-sim/motor_run.txt adsCoupling {6.2 → 4.464}

### [high] Pickups and inventory of any isPlayer entity go to the host's WeaponSystem
- Player.js:291-293: giveWeapon, addAmmo and addGrenades all delegate to this.game.weapons.
- GrenadeTypes.js:64: if (entity.isPlayer) return entity.game.weapons ? entity.game.weapons.nades : null (used by grantCrate for the HUD grant and special-grenade room checks).
- Modes.js:82: if (entity.isPlayer) this.game.weapons.setEscalationWeapon(id).
- Game.js:553: if (e === this.player) this.weapons.onPlayerSpawn(), so only the local player gets a spawn loadout.

Measured: p2.giveWeapon('sniper') returned true and flipped the host's game.weapons.inv.sniper.owned from false to true; inventoryOf(p2) === game.weapons.nades.

Related to request #2: onPlayerSpawn (WeaponSystem.js:579-607) hard-codes pistol + rifle + shotgun with the rifle selected. The per-entity refactor and the spawn-loadout setting both touch this method.
Evidence: src/player/Player.js:291-293; src/weapons/GrenadeTypes.js:62-66; src/weapons/GrenadeTypes.js:73-91; src/core/Modes.js:74-92; src/core/Game.js:550-555; src/weapons/WeaponSystem.js:579-607; tools/out/_claude/mp-sim/motor_run.txt inventoryCoupling

### [high] The grapple hook's origin comes from the host camera; grapple, shock slow and eye height run per frame, outside the fixed step
Grapple._handWorld (Grapple.js:419-422) is HAND_OFFSET.applyQuaternion(game.camera.quaternion).add(game.camera.position). fire() uses it as the hook origin (227-228), and flightTime = distance(origin, target) / 110 m/s (238-241) decides when the hook attaches.

Measured: p2's hook origin was 0.6 m from the host camera and 67.9 m from p2's own eye. The anchor itself comes from P.getEyePosition/getAimDirection (224-226), so it is correct.

Three simulation-affecting updates in Player.update run per frame with variable dt instead of inside the fixed 120 Hz loop:
- grapple.update(dt) (Player.js:173): hook flight, attach, release rules, cooldown.
- the _shockEffects ground-speed clamp (199-212).
- the eyeHeight lerp (193-194), which changes getEyePosition: shot origin, grapple aim, radialDamage line-of-sight tests.
Host and client would diverge unless these move into the step. The motor experiment ran grapple.update(STEP) inside the step and replayed exactly.
Evidence: src/player/Grapple.js:221-250; src/player/Grapple.js:281-317; src/player/Grapple.js:419-422; src/player/Player.js:143; src/player/Player.js:172-173; src/player/Player.js:193-194; src/player/Player.js:199-212; tools/out/_claude/mp-sim/motor_run.txt grappleOrigin

### [high] Remote players' actions would sound and look like the host's own (presentation leaks in shared paths)
Player presentation hooks are called from the controller for any instance:
- _onJump / _onLand play non-positional 'jump', 'double_jump', 'wall_jump', 'land' and emit global 'player:jump' / 'player:land' with no entity field (Player.js:322-341).
- _onDamage plays a non-positional 'hurt' (377); onDeath plays 'death' (314); _footsteps (425-443) and the slide/wall-run loops (386-423) are non-positional.
- Grapple sounds are non-positional (247, 267, 333, 342); its 'player:grapple' events carry no entity (248, 268, 274, 297, 335).
- WeaponSystem plays every weapon sound non-positional (for example 1017, 1043, 1096, 1166-1167, 1194, 1337, 1365, 1388, 1395, 1412, 1420, 1472, 1534, 1612, 1653).
- Listeners that assume the local player: WeaponSystem 'player:land' → viewmodel kick (329, 1668-1673) and HUD 'player:grapple' → miss shake (225, 437-445).
- Effects.hitSpark:453 (if (entity && entity.isPlayer) return) would suppress hit sparks on every remote human.

Measured (motor.js, p2 steps only): events player:jump ×3 and player:land ×2; sounds jump, wall_jump and land, all non-positional. shadow.js: rifle_fire ×12, shotgun_fire ×2, pump ×2, weapon_switch, grenade_pin and grenade_throw, all non-positional.
Evidence: src/player/Player.js:308-382; src/player/Player.js:386-443; src/player/Grapple.js:247-342; src/weapons/WeaponSystem.js:329-330; src/weapons/WeaponSystem.js:1668-1673; src/ui/HUD.js:225,437-445; src/fx/Effects.js:450-453; tools/out/_claude/mp-sim/motor_run.txt leaksDuringP2Steps; tools/out/_claude/mp-sim/shadow_run.txt result.sounds

### [high] Complete inventory of single-human assumptions (grep for game.player / isPlayer / .player / game.weapons / game.camera, read end-to-end)
Simulation-affecting (must change):
- Game.js:77,380-384 (one Player; TDM team always TEAM_BLUE; colour PLAYER_COLOR); 461,464 (m.playerWon vs this.player); 553 (loadout only for this.player); 772-773 (only this.player/this.weapons updated); 505 (quitToMenu).
- BotManager.js:209,234-244 (bots separated only from game.player).
- BotManager.js:136-142 (team alternation assumes one human on Blue).
- Player.js:291-293; PlayerController.js:480,662; GrenadeTypes.js:64; Modes.js:82; rail.js:139-141.
- WeaponSystem.js: about 30 game.player sites (581,603,660,805,838,925,1018,1027,1059,1129,1153,1189,1217,1222,1228,1462,1513,1533,1549,1554-1556,1560,1611,1626,1656,1662,1682); game.input 845,943,1026,1453,1602; camera-based aim or origin 1060,1070-1071,1220-1221,1307-1325,1512-1523,1541-1543,1561,1627-1631.
- Grapple.js:419-422.
- WeaponSystem._hitStop 1580-1596 (global game.timeScale).
- Game pause on mouse release / blur 248-250, 271-276, 483-491; loop requestAnimationFrame 721.

Semantics to split (isPlayer currently means 'human', 'local' or 'owns the WeaponSystem'):
- Game.js:598 (respawn delay: human, OK); GrenadeTypes.js:228 (vortex boost: PlayerController physics = human, OK).
- Effects.js:453, Game.js:617 → Scoreboard.js:20 ('me'), Scoreboard.js:25 (bot icon), Menu.js:789 (end stats row): these mean local.

Presentation-only (correct as the local player on each machine; keep):
- HUD.js:296,314,356,364,385,414,475,493,541,677,688; ModeHUD.js:120,136,168,191; Menu.js:742; GrenadeFX.js:596,650; GrenadeTypes.js:434; Effects.js:727-734; Storm.js:344-348; CameraRig (writes game.camera); Bot._playNear:535-540 and BotManager.update:185-189 (camera for audibility / animation detail level).

Only two game.entities assumptions exist; everything else iterates entities generically (Combat, Pickups, pads, Modes, BotBrain targeting at 923/1817, HUD rank at 855-863).
Evidence: src/core/Game.js:77,248-250,271-276,380-384,461-464,483-491,505,553,598,617,721,772-773,823,863; src/ai/BotManager.js:136-142,207-246; src/weapons/WeaponSystem.js:581-1682; src/ui/Scoreboard.js:20,25; src/ui/Menu.js:789; src/fx/Effects.js:453

### [high] Lag compensation needs only position+height history; a rewind wrapper around Combat.raycast works
Entity.getHitboxes (Entity.js:85-94) derives the head sphere and the body and leg capsules from this.position and this.height only. Combat.raycast (129-168) does a broad phase on e.position/e.height and then calls e.getHitboxes().

Prototype (match.js): a per-entity ring buffer of 90 samples {t, x, y, z, h, alive} recorded every frame. Every 0.5 s it picks a moving bot, aims a ray at its chest from 150 ms earlier, and compares raycasts without and with a temporary rewind (set every entity's position and height from history, raycast, restore).
- 43 trials: 1 hit without rewind (the bot had moved 0.58-1.35 m), 43 of 43 hits with rewind (body).
- 0.1 ms per rewound query (9 entities, naive linear history search).

Apply the rewind to hitscan fireBullet (218-244), fireRail (rail.js:36-109, pierce loop), fireArc (arc.js:60-123; its chain uses present chest positions) and melee (WeaponSystem 1624-1664) for remote shooters. Explosions, gale and projectiles simulate in the present and need no rewind.
Evidence: src/core/Entity.js:85-94; src/core/Combat.js:129-168; src/core/Combat.js:218-244; tools/out/_claude/mp-sim/match.js (record/sampleAt/lag block); tools/out/_claude/mp-sim/match_run.txt lagComp {trials:43, hitNow:1, hitRewind:43, rewindMs:0.1}

### [medium] Bot rendering can be reused for remote humans; bot firing cannot
BotModel (BotModel.js:1036-1259) is decoupled: its constructor takes {color, team, number, phase}, and update(dt, state) takes a plain state {forwardSpeed, strafeSpeed, speed, onGround, crouch, aimPitch, aimYawOffset, firing, aiming, reloading, alive}. It has setWeapon, getMuzzleWorldPosition, flashHit and breakApart.

Experiment avatar.js drove a BotModel from a PlayerController entity (strafe, jump, crouch) using the Bot._updateModel formulas. The screenshot shows a cyan robot holding a rifle, and the host's HUD listed it as 'RIVAL REMOTE2'.

To reuse (extract into a shared Avatar helper):
- body-yaw smoothing + level-of-detail animation: Bot._updateModel 844-893
- weapon model cache: _getWeaponModel 229-244
- death gibs: onDeath 254-279
Effects.hitSpark → entity.model.flashHit() works automatically once the entity has .model (451). BotModel has no wall-run, slide, grapple or mantle poses (bots cannot do those).

Not reusable: Bot._fire (697-775) applies bot rules. It uses preset.damageScale/spreadScale (703, 713), a synthetic spread formula (708-712) instead of WeaponSystem._updateSpread (1435-1447: ADS, moving, air, crouch, bloom), random interval jitter ×0.96-1.14 (768, 812), brain.kick recoil (773), no fire buffer, cycle/pump lock, ADS zoom or melee. It also moves with its own variable-dt locomotion (404-500). Remote humans must use the player's WeaponSystem rules and the PlayerController.

The shared low-level routines are already shooter-parameterised: combat.fireBullet, fireRail, fireArc, galeBlast, projectiles.spawnRocket/spawnGrenade and the smg helpers.
Evidence: src/ai/BotModel.js:1036-1123,1141-1184,1259; src/ai/Bot.js:229-244,254-279,404-500,697-775,844-893; tools/out/_claude/mp-sim/avatar.js; tools/out/_claude/mp-sim/avatar_end.png; src/fx/Effects.js:451

### [medium] Measured replication budget: about 25 B per entity per snapshot, about 11 events/s, about 36 effects calls/s
match.js: Foundry, FFA, 8 bots + the scripted player, 25 simulated seconds; a quantised binary snapshot encoded every frame.

Per-entity layout (~25 B, +6 B while grappling): id u16, flags u16 (alive, onGround, crouch, slide, wallrun, grapple, mantle, reloading, charging, shocked, protected), position 3×i16 at 1 cm, velocity 3×i16 at 1 cm/s, yaw u16, pitch i16, height u8, health u8, armor u8, weapon u8, team u8.
Header: 16 B. Projectiles: 17-18 B each.

Result: 246 B average and 283 B maximum per snapshot, 9 entities, at most 2 projectiles, 0 quantisation overflows. That is 4.81 KB/s per client at 20 Hz and 7.22 KB/s at 30 Hz. Estimate for 16 entities with extra fields (body yaw, fire/ADS/beam flags, beam end point, score bytes): about 30-35 B each, about 0.55 KB per snapshot, about 16 KB/s per client at 30 Hz.

Events per second:
- weapon:fire 7.08, damage 2.6, death 0.32, spawn 0.32, weapon:switch 0.28, pickup 0.2, explosion 0.16, player:jump/land 0.16, player:grapple 0.12, smoke 0.08.
- Effects calls: flashLight 7.6, tracer 7.28, trail 6.08 (per frame per projectile, derive on the client), muzzleFlash 5.92, impact 5.36, hitSpark 3, dust 0.6, gibs 0.32, explosion 0.12.
- Sounds: 19/s positional + 3.3/s non-positional (all non-positional ones were the local player's).
- Projectile spawns: rocket 0.08/s, grenade 0.24/s.

Owner-only block (estimate): ack sequence + motor state (~110-120 numbers, about 450 B as float32 raw, about 50-100 B delta-encoded) + arsenal (~70 B).
Evidence: tools/out/_claude/mp-sim/match.js (encodeSnapshot); tools/out/_claude/mp-sim/match_run.txt snapshot/eventsPerSec/fxCallsPerSec/soundsPerSec

### [medium] Randomness is pervasive (lockstep impossible); list of simulation-relevant random sites
Math.random was wrapped during the match run: 2613 calls per simulated second. Share by file (1/16 of stack frames sampled): Effects.js 77.4%, BotBrain 8.4%, GrenadeFX 3.5%, BotConfig 3.3%, Audio 2.3%, Bot 1.9%, ModelKit 1%, WeaponSystem 0.8%, BotModel 0.7%, Game 0.2%, Projectiles 0.1%, Player 0.1%.

Sites whose result the host and client must agree on (make them host-authoritative and replicate, or seed them):
- Player weapon spread via randomInCone (utils.js:60-70): WeaponSystem.js:1083, 1128, 1159, 1231. Seed per (ownerId, shotSeq) so predicted tracers match host pellets.
- Recoil randRange/_recoilBias (1066, 1103-1104, 1180, 1198): only affects the client's own view angles, which are sent in commands, so no sync needed.
- Host-only (replicate the outcome): GrenadeTypes.spawnLoadout:29 (random special), grantCrate:85, Game.pickSpawnPoint:574, Storm scheduling and rod pick (42, 153-154, 201, 220-222, 231, 319), Zones.zonePoint:43, Modes:342,352, BotManager:72,128,225, Bot:728-783 (spread, interval jitter, kicks), BotBrain/BotConfig AI.
- Presentation-only (fine to stay unsynced): CameraRig:73,84; Player:211 (shock view jitter, client aim); Player:441; Projectiles:148,192-193,373,399; WeaponSystem:1096,1194,1256-1257,1268,1270,1297-1299,1388; Storm bolt shape 404-428; Effects/GrenadeFX/Particles/Audio.

Time dependencies: game.time is read in Entity (spawn protection 154/170, shock 143-150, lastDamageTime 108, lastLaunchTime 134), Combat smokes (76, 84-85, 95), gale timers (184, 188, 202), Pickups respawn (603, 620), World pad cooldown (619-621), WeaponSystem now (844), Bot (16 references), BotBrain/BotNav, and the HUD respawn countdown (927). Clients therefore need game.time slaved to an estimated server clock. BotNav's path budget uses performance.now (host-only). timeScale is written only by endMatch (Game.js:467) and _hitStop (WeaponSystem.js:1584).
Evidence: tools/out/_claude/mp-sim/match_run.txt mathRandom; src/core/utils.js:19-22,60-70; src/weapons/WeaponSystem.js:1066,1083,1103-1104,1128,1159,1231; src/weapons/GrenadeTypes.js:29,85; src/core/Game.js:574; src/world/Storm.js:42,153-154,201,319

### [medium] World and projectile simulation is interleaved with visuals and has no network identity
World:
- Pickups.update (600-629) runs respawn and collection (610-626: _apply → e.heal / addArmor / addAmmo / grantCrate / giveWeapon, then 'pickup' event + sound) and then _animate (visuals). Pickups already have stable ids (448); replicate an availability bitfield + nextRespawn + pickup event {entityId, pickupId, lastGrant}.
- World.update (670-677) = sky + storm + pickups + pads. _updatePads (605-628) launches any entity (e.launch) with a per-entity WeakMap cooldown (618-621) and pad flash; the client should predict only its own launch.
- Storm.update (170-196) schedules strikes with Math.random and applies combat.radialDamage in _fire (333-336) whenever game.state === 'playing', which is also true on clients. It needs strike events {rodIndex, warn}.

Projectiles:
- Pooled objects with no id (93-124); spawnRocket 133-154, spawnGrenade 161-200.
- Rockets fly straight but Vortex bends them (GrenadeTypes.js:277-286) and Gale reassigns owner/direction/speed (gale.js:139-142, 154-160).
- Grenade bounces raycast against entities too (Projectiles.js:345), so grenades need continuous state in snapshots. Explosions and special detonations should be events.
- The client's smoke overlay reads combat.smokes (GrenadeFX.js:577-590), so smoke volumes must be replicated.
Evidence: src/world/Pickups.js:447-469,600-640; src/world/World.js:605-628,670-677; src/world/Storm.js:170-196,250-267,323-350; src/weapons/Projectiles.js:93-200,244-272,288-418; src/weapons/special/gale.js:111-167; src/weapons/GrenadeTypes.js:201-287,398-407; src/fx/GrenadeFX.js:577-590

### [medium] Events carry live object references (or no entity at all), so the client needs an id-to-object translation layer
Every payload passes object references: damage {target, attacker}, death {victim, attacker}, spawn {entity}, pickup {entity, pickup}, weapon:fire / weapon:switch {shooter}, explosion {owner}, shove / splat / reflect, esc:tier {entity}, hill:* {zone}. player:jump / land / grapple carry no entity.

Consumers: HUD (217-226), ModeHUD (63-71), Game (246), BotManager (46-48), Player (86), WeaponSystem (329-330), AutoTest (65-80). Most compare against game.player.

If the client resolves ids to its local objects (its own Player plus proxy entities) before calling game.events.emit, the HUD, kill feed, hit markers, damage indicators, toasts and mode HUD work unchanged. Events without an entity need an entity field added, and their listeners need to filter by it.
Evidence: src/core/Combat.js:273-276,286-299; src/ui/HUD.js:217-226,295-445; src/ui/ModeHUD.js:63-71; src/ai/BotManager.js:44-49; src/core/Events.js:30-40

### [medium] WeaponSystem aims and launches from game.camera (view bob, shake and landing dip included), so the host must receive the client's actual shot ray
_fire sets _eye = cam.position and _fwd = camera forward (1070-1071). _muzzleWorld projects the viewmodel muzzle through viewCamera into the world camera (1305-1326); tracers and rocket origins use it. The following are also camera-based:
- _grenadeLaunch (1510-1527): origin, fwd/right/up, + 0.4 × p.velocity.
- _grenadeCookOff (1539-1550), the death drop (1561), _meleeStrike's 5 rays (1627-1645), _updateBeam (1219-1222), the throw preview (2189).

The camera includes landing dip (CameraRig landY, clamped -0.4..0.15 m), bob, shake (±0.012 rad × trauma²) and step offsets (CameraRig.js:158-168). A host that fires from eye + yaw/pitch will disagree with the client's crosshair by a few centimetres in position and up to about 0.7° while shaking.

On the host, a remote player needs an aim frame: rewound eye + the command's angles, plus the client-sent camera offset and exact direction, clamped. Spread must be seeded so the client's predicted tracers and hit sparks match the host's pellets.
Evidence: src/weapons/WeaponSystem.js:1057-1122; src/weapons/WeaponSystem.js:1226-1247; src/weapons/WeaponSystem.js:1305-1326; src/weapons/WeaponSystem.js:1510-1550; src/weapons/WeaponSystem.js:1624-1664; src/player/CameraRig.js:119-168

### [medium] No join/leave lifecycle: Player, Grapple and WeaponSystem have no dispose; the host simulation stops when the tab is hidden
Lifecycle:
- Player.init adds a rope/claw group per instance to game.scene (Grapple.js:72-107, scene.add at 106) and subscribes to 'damage' (Player.js:86, handle kept in _offDamage but never released).
- The WeaponSystem constructor attaches viewRoot to viewCamera, adds preview meshes to the scene and registers 'player:land' / 'death' listeners (320-330, 501-524).
- None of these classes has dispose(), so NetPlayers created on join leak scene objects and listeners on leave.
- Game.addEntity reassigns ids every match, including the local player's (530-534); getEntityById is a linear find (541-543).

Host loop:
- Game._loop is driven by requestAnimationFrame (721), which does not run in hidden tabs.
- The game pauses the whole simulation when the mouse is released (248-250), on visibilitychange (271-276) and from pause() (483-491).
- endMatch slows the whole simulation to 0.25× (467).
- A host who alt-tabs or opens the menu would freeze every client.
Evidence: src/player/Grapple.js:72-107; src/player/Player.js:80-87; src/weapons/WeaponSystem.js:320-330,501-524; src/core/Game.js:248-250,271-276,483-491,530-543,720-765

## Recommendations
### Phase 0 (no networking yet, low risk): separate human, local and owner semantics on Entity and fix the misattributed isPlayer uses
Entity changes:
- Keep isPlayer = 'human with PlayerController physics' (true for Player and the future NetPlayer).
- Add isLocal (true only for game.player on each machine), netOwner (connection id, 0 = host), adsAmount = 0 (written by the owner's WeaponSystem next to lookScale/fovMultiplier at WeaponSystem.js:914-915), and weapons (a per-entity WeaponSystem reference; null for bots).

Then fix:
- PlayerController.js:480,662 → this.p.adsAmount.
- Player.js:291-293 → this.weapons.
- GrenadeTypes.inventoryOf:64 → entity.weapons ? entity.weapons.nades : entity.nades.
- Modes.js:82 → entity.weapons ? entity.weapons.setEscalationWeapon(id) : entity.setEscalationWeapon(id).
- Game.respawnEntity:553 → if (e.weapons) e.weapons.onPlayerSpawn().
- Effects.hitSpark:453 → entity === this.game.player.
- Game.getScoreboard:617 adds isLocal; Scoreboard.js:20 and Menu.js:789 use isLocal; Scoreboard.js:25 keeps isPlayer for the bot icon.
- BotManager._separate:209,234-244 loops over every alive isPlayer entity.

Verify: the autotest report (shots, states, player metrics) is identical before and after.
Files: src/core/Entity.js, src/player/PlayerController.js, src/player/Player.js, src/weapons/GrenadeTypes.js, src/core/Modes.js, src/core/Game.js, src/fx/Effects.js, src/ui/Scoreboard.js, src/ui/Menu.js, src/ai/BotManager.js, src/weapons/WeaponSystem.js

### Phase 1 (medium risk): per-entity context for Player and WeaponSystem, made explicit (production form of the shadow.js experiment)
Constructors:
- new Player(game, {input = game.input, camera = game.camera, weapons})
- new WeaponSystem(game, {owner, input = game.input, camera = game.camera, viewCamera = game.viewCamera, view = true})

WeaponSystem changes (all mechanical):
- game.player → this.owner (~30 sites).
- game.input → this.input (845, 943, 1026, 1453, 1602; plus rail.js:139-141 → ws.input / ws.owner).
- game.time → this.now (a per-owner command clock: host timers then follow the client's command stream, not the host frame).
- Camera-based aim → this._aimFrame(outEye, outFwd, outRight, outUp): the camera for the view instance, eye + yaw/pitch + client ray for remote owners.
- Sounds through this._sfx(name, opts): non-positional for the local owner, positional at the owner otherwise.
- view:false skips viewRoot, flash, casings, preview and throwArm, and guards _viewKick, _ejectCasing, _setArmModel, _selectVisual and updateViewModel.
- Constructor listeners (329-330) filter by owner.
- _hitStop (1580-1596) becomes a local-only visual when networked; it must never write game.timeScale.
- Add dispose().

Make onPlayerSpawn(loadout) take the spawn-loadout configuration (request #2) in the same change.

Verify: the full autotest script and viewmodel viewer screenshots are unchanged; a scenario reproduces shadow.js without the shadow object.
Files: src/weapons/WeaponSystem.js, src/weapons/special/rail.js, src/player/Player.js, src/core/Game.js

### Phase 1b (medium risk): make Player command-driven and move all simulation onto the fixed step
Split Player.update (Player.js:125-197) into two parts.

buildCommand(dt), local only: reads game.input and look deltas and produces a command:
- seq u32, dt
- yaw / pitch after local recoil
- held bitmask (forward, back, left, right, jump, crouch, sprint, fire, ads, grenade, grapple)
- pressed / released bitmasks (jump, crouch, fire, ads, reload, grenade, grenadeNext, grapple, melee, lastWeapon, weapon1-9)
- wheel
- optional shot ray (camera offset from eye in mm plus a direction) and shotSeq
- viewTime (the server time the client was rendering)

applyCommand(cmd) is used by the local player, the client's prediction and the host's NetPlayer. Inside the 120 Hz loop it runs grapple.update(STEP), the _shockEffects speed clamp and the eyeHeight lerp.

Also:
- Add getMotorState(out) / setMotorState(s) over the measured field list (motor.js SKIP sets show what to exclude).
- Grapple._handWorld (419-422): the simulation origin comes from getEyePosition + HAND_OFFSET rotated by the aim; the local rope's visual start stays camera-based.
- Emit 'player:jump' / 'land' / 'grapple' with {entity}; gate presentation hooks (_onJump, _onLand, _onDamage, onDeath, _footsteps, _updateLoops, Grapple sounds) with isLocal, and use positional sounds otherwise.

A 'command input' object exposing action, actionPressed, actionReleased, wheel and consumeLook()→0 lets the host feed commands through the unchanged WeaponSystem logic (proven by the stand-in input in shadow.js).
Files: src/player/Player.js, src/player/Grapple.js, src/player/PlayerController.js, src/net/CommandInput.js (new)

### Phase 2 (host side): NetPlayer entity, Avatar extraction and lag compensation
src/net/NetPlayer.js extends Player:
- isPlayer = true, isLocal = false; owns a WeaponSystem({owner: this, view: false}), a CommandInput and an Avatar.
- update(dt) drains the command queue in sequence order: set yaw/pitch, applyCommand, then weapons.update(cmd.dt) inside combat.withRewind(this, cmd.viewTime, …).
- Cap the backlog (drop commands older than ~150 ms, repeat the last command with edges cleared when starved) so late bursts are not replayed.
- Called from Game.update right after this.weapons.update (Game.js:772-773); dispose() on leave.

Avatar (src/ai/Avatar.js): extract Bot._updateModel (844-893), _getWeaponModel (229-244) and the onDeath gibs (254-279). Bot, NetPlayer (host view of remote humans) and client proxies all use it. Approximate slide (crouch pose) and wall-run / grapple (air pose); split Grapple's rope/claw into a reusable GrappleRope so remote grapples draw from the avatar's hand.

Combat:
- recordHistory() once per host frame: ring buffer per entity of {t, x, y, z, h, alive}, about 1 s.
- withRewind(shooter, t, fn): clamp t to at most 250 ms back, swap position/height for every other entity, run fn, restore.
- Prototype numbers: 43/43 vs 1/43 hits, 0.1 ms per query.
Files: src/net/NetPlayer.js (new), src/ai/Avatar.js (new), src/ai/Bot.js, src/core/Combat.js, src/player/Grapple.js, src/core/Game.js

### Phase 2b (medium risk): a single host-authority flag gating all simulation mutations; client proxies and a render-only mode
Add game.net = {role: 'offline' | 'host' | 'client', authority}. When !authority:
- Combat.applyDamage / kill / radialDamage / blast knockback (253-337) and gale updateShoves / splat do nothing (hit sparks on proxies stay as predicted feedback).
- Pickups.update skips collection and respawn (610-626) but keeps _animate.
- World._updatePads launches only the local player (prediction).
- Storm skips scheduling and damage (186-196, 333-336) and plays strike events.
- Game.update skips bots.update, combat.update, modes.update and _updateMatch.
- Projectiles runs a render-only mode from snapshot state (ids assigned in spawnRocket / spawnGrenade).
- GrenadeTypes simulation (vortex pull, splats) is off; its effects are driven by events.

Client entities: game.entities holds the local predicted Player plus ProxyEntity objects (Entity subclass + Avatar; position interpolated about 100 ms behind from snapshots; derived footsteps, jump/land, slide/wall-run loops and rope). Keep game.time slaved to the estimated server clock so spawn protection, shock, respawn countdown, smoke expiry and pickup respawn pulses keep working.
Files: src/core/Game.js, src/core/Combat.js, src/weapons/special/gale.js, src/world/Pickups.js, src/world/World.js, src/world/Storm.js, src/weapons/Projectiles.js, src/weapons/GrenadeTypes.js, src/net/ProxyEntity.js (new)

### Phase 3: protocol shape (continuous state vs events) with the measured sizes
Unreliable snapshot, 20-30 Hz, host → client:
- Header: tick, server time, timeLeft, team scores.
- Per entity (~25-35 B): id, flags, position, velocity, yaw, pitch, height, health, armor, weapon, team, grapple anchor while attached, body yaw / faceAim, beam end point while firing the Tempest, score bytes.
- Projectiles (~18 B each, id-tagged): rocket position + direction×speed; grenade position, velocity, fuse, state.
- Pickups availability bitfield; KOTH state (index, phase, left, owner, contested, progress, presence).
- Owner block: ack seq + motor state + arsenal (inventory, grenades, grenadeType, gState / cookTime, reload / switch / cycle timers, nextFireAt, adsAmount, charge).

Reliable events, host → client, entity ids resolved to local objects before game.events.emit: match:start / end (winner id / winnerTeam; playerWon computed per client), roster (id, name, team, colour, isPlayer, owner), spawn (teleport), death, damage, pickup {pickupId, lastGrant}, weapon:fire {shooter, weapon, origin, dir, shotSeq, tracer end points}, weapon:switch, explosion {pos, radius, owner, weapon, normal}, projectile spawn / despawn / redirect, vortex / static / kinetic / smoke effects (smoke also feeds client combat.smokes), storm strike, shove / splat / reflect, esc:tier / esc:final, hill:*.

Client → host, unreliable: command packets with the last 3-4 commands for redundancy. About 20 B per command at 60-144 Hz, a few KB/s.

Randomness: add an rng parameter to utils.randomInCone and seed spread per (ownerId, shotSeq) with mulberry32 (already in utils.js).
Files: src/net/Snapshot.js (new), src/net/NetHost.js (new), src/net/NetClient.js (new), src/core/utils.js, src/weapons/WeaponSystem.js, src/weapons/Projectiles.js, src/core/Game.js

### Game flow changes for more than one human
- _startMatch (Game.js:380-386) builds a roster of humans. TDM / KOTH: balance teams with the bots (BotManager.spawnBots alternates starting on Red and assumes one human on Blue; 136-142). FFA: distinct colours (only one PLAYER_COLOR exists).
- endMatch (452-472): include winner id / winnerTeam; playerWon is computed per client.
- When networked, pause() / visibilitychange / mouse-release pause (248-250, 271-276, 483-491) must stop only local input and UI, never the host simulation.
- The host loop needs a fallback when the tab is hidden (requestAnimationFrame at 721 does not run).
- _clearMatch / quitToMenu remove and dispose NetPlayers.
- getEntityById becomes a Map.
- Clients may skip NavGraph.build (World.js:238-243, 100-500 ms) since only the host runs bots.
Files: src/core/Game.js, src/ai/BotManager.js, src/core/constants.js, src/world/World.js

## Risks
- WeaponSystem.js is 2252 lines with logic and viewmodel presentation interleaved (the _viewKick / flash / casings / springs calls sit inside the fire, reload and grenade paths). Parameterising it per entity risks regressing single-player gun feel. Diff the autotest reports and viewer screenshots before and after, and land Phase 0/1 before any networking.
- The host runs in a browser tab: Game._loop is requestAnimationFrame-driven (Game.js:721), and the game pauses on mouse release and blur (248-250, 271-276). A host who alt-tabs or opens the menu freezes every client unless the networked host loop moves to a timer or worker and pausing becomes local-only.
- Replaying a backlog of queued commands on the host is exactly the 'inputs played back like a stack' symptom from request #4. NetPlayer must cap and drop stale commands (and slow or speed up the client to compensate) instead of executing late bursts.
- Determinism is bit-exact only within one browser build (verified 0 difference). Math.sin, cos, exp, atan2 and hypot precision is implementation-defined, so mixed Chrome/Firefox LAN parties need reconciliation with an error threshold and visual smoothing, not an assumption of exactness.
- Forces the client cannot predict (rocket and grenade knockback including your own rocket jumps, Gale shoves, Vortex pull, Static shock slow, other players' pad launches) arrive about one round trip late and cause visible corrections. Small on LAN; noticeable on the internet join-code version unless the shooter's own projectiles are predicted.
- Moving grapple.update, the shock clamp and the eye-height lerp into the 120 Hz step slightly changes single-player timing (grapple attach quantised to 1/120 s).
- Events carry live object references, and three event types carry no entity. A missed translation in the net layer silently misattributes hit markers, toasts or viewmodel kicks to the local player. Every remaining non-positional audio.play or game.player.addShake in a shared path makes remote actions sound or feel local.
- There is no human-to-human collision (capsules collide only with the world; bots are only softly pushed away from game.player), so humans can overlap each other. Adding collision would hurt prediction.
- Entity ids are reassigned every match (Game.js:530-534, including the local player's), so the roster must be re-announced per match; Player, Grapple and WeaponSystem also have no dispose, so join/leave will leak scene objects and listeners until one is added.
- Host frame hitches (BACKLOG: bot path requests spike to 16-31 ms) delay snapshots and command processing for every client.

## Open questions
- Should remote human players be drawn with the existing robot BotModel (recoloured, no wall-run/slide/grapple poses in v1), or does the user want a distinct player model?
- Hit registration: is host-authoritative with lag compensation ('what you saw is what you hit', favouring the shooter) acceptable? And should shots come from the camera crosshair ray (current single-player behaviour, client sends the ray) or from eye plus aim angles for everyone?
- When the host alt-tabs or opens the pause menu, should the match keep running for everyone (needs a non-requestAnimationFrame host loop), or pause for all players?
- Team modes with several humans: auto-balance humans across Blue/Red with bots filling the gaps, or let players pick teams? Should bots fill up to a fixed total player count?