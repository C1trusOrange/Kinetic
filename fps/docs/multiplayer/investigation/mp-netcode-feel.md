# mp-netcode-feel

## Summary
Short answer: client-side prediction with server (host) reconciliation works for KINETIC's movement, but it needs a refactor first. PlayerController is fully deterministic once the whole state is restored and inputs are fed per 120 Hz tick. Probe A restored a full snapshot and replayed the same per-tick inputs: 501 trials × 36 ticks, starting from real ground, air, wall-run, grapple, slide and mantle states, gave 0 bit-level mismatches. A step costs about 16-19 µs once warmed up, so replaying 12 ticks (100 ms) takes 0.21 ms on average (0.7 ms p99). Sending yaw/pitch and the owner's position/velocity as float32 caused no measurable divergence after 36 ticks.

The current integration can't be networked as-is, because input is sampled per rendered frame and several things that affect movement live outside the fixed step: the grapple state machine, a hook origin taken from the camera, the ADS amount read from the local WeaponSystem, sprint cancel, the Static-grenade slow, jump pads, the Vortex pull, and the timeScale effects (Javelin hit-stop, end-of-match slow motion). Running the same input timeline at 30-240 fps ended up to 0.25 m apart for plain movement and 13 m apart for a grapple swing within 3 s. Movement never reads other entities: there is no player-vs-player or player-vs-bot collision, the collision world is built once per map, grapple anchors are always static geometry, and jump pads are static. Outside influences are only writes: knockback, pad launches, the Vortex pull, the Static slow, and death/respawn.

Recommended phase 1:
- **Timing:** 120 Hz sim tick, one input command per tick, sent in 60 Hz packets. The host simulates each client from its commands as they arrive.
- **Owner reconciliation:** each client gets a snapshot of its own full controller + grapple state, marked with the last input the host processed. The client restores it and replays newer inputs with sounds, effects and events turned off.
- **Knockback:** applied by the host and pushed to the victim right away as state at a specific tick. The measured correction jump is 0.1-0.2 m on LAN versus 0.4-0.65 m if it waits for the next 30 Hz snapshot. Applying it on receipt without rewinding is wrong: mean errors of 0.5-1.5 m and up to 10 m.
- **Remote players:** interpolated using the replicated velocity at 30-60 Hz (measured error ≤ ~0.11 m; extrapolating over a lost snapshot errs up to 0.66 m).
- **Hitscan:** the host rewinds targets to exactly what the shooter was seeing, using the exact ray and spread seed the client sends. The ray has to be sent because the game shoots along the shaken, bobbing camera (measured up to 0.31 m and 0.93° off the physics eye/aim).
- **Rockets and grenades:** host-authoritative, with a predicted visual copy for the thrower.

## Key files
- src/player/PlayerController.js: Fixed 120 Hz movement step. Deterministic; 54 persistent state fields (reset() lines 78-124). Reads game.weapons.adsAmount (lines 480, 662) and P.yaw (911, 1082). impulse()/launch() entry points at 206-232.
- src/player/Player.js: Per-frame wiring that is not netcode-ready: reads game.input directly (126-169), latches press edges (165-168), runs grapple per frame (172-173), accumulator (176-187), shock slow per frame (143, 200-212). Sound/event hooks fired from inside the step (322-373). Hard-wired as the one local player (camera, non-positional sounds, hurt handler 375-382).
- src/player/Grapple.js: Hook state machine runs on frame time (281-317). Hook origin and flight time come from the rendered camera (227-241, 419-422). Rope length is fixed at attach (329); arrival lift (363); line-of-sight check every 0.05 s (368-374). Rope forces are applied per tick (393-415).
- src/weapons/WeaponSystem.js: Local-only arsenal. Shots aim from game.camera (1069-1071), random spread (1083), rockets launch from the viewmodel muzzle (1226-1247, 1305-1326), grenades from the camera plus 0.4× player velocity (1510-1527), melee from the camera (1624-1631). Also: ADS amount per frame (903-905), sprint cancel (852, 1611), hit-stop via timeScale (1554, 1580-1596).
- src/core/Combat.js: raycast over all entities' hitboxes (129-168). fireBullet does trace + effects + damage in one call (218-244). applyDamage applies knockback via applyImpulse and skips it for spawn-protected targets (253-279). radialDamage gives the attacker full self-knockback (309-337).
- src/core/Entity.js: Hitboxes are a pure function of position + height (85-94), so rewinding only needs position/height history. Shock and spawn-protection timers use game.time (142-155).
- src/core/Game.js: Main loop: dt capped at 50 ms and multiplied by timeScale (733). Update order (768-786). End-of-match slow motion (467). Respawn and kill plane (550-555, 623-647).
- src/world/World.js: Jump pads checked per frame with game.time cooldowns (45-47, 605-627). Collision built once at load (207) and cleared only on unload (718).
- src/weapons/GrenadeTypes.js: Vortex writes entity velocities directly every frame (201-259). Static shock (352, 363). Kinetic knockback and splat detection (372-396, 447-473).
- src/weapons/Projectiles.js: Rockets fly in a straight line at constant speed with swept raycasts (288-319). Grenade physics is integrated per frame with frame dt (322-418). explode() at 210-239.
- src/weapons/special/gale.js: Cone shove per entity chest position + line of sight (44-73), self push (84-95), projectile reflection (111-167), per-frame wall-splat detection (198-219).
- src/weapons/special/arc.js: Beam tick batching, up to 3 ticks per frame (45-51). Primary hit + chain to nearest hostiles within 6.5 m with line of sight (60-123). Beam visual keyed by shooter id (133-138).
- src/weapons/special/rail.js: Piercing beam: up to 3 entities + 0.9 m of wall (36-109). Client-side charge state machine (138-188).
- src/ai/Bot.js: Reference recipe for rendering another shooter's shots: muzzleFlash, positional sound, tracer from the model muzzle, weapon:fire event (697-816).
- src/ai/BotManager.js: _separate pushes only bots away from the player (207-245), so the player is never moved by other entities.
- tools/out/_claude/netcode/probe.js: Probe A (bit-exact replay + per-field ablation), B (frame-rate dependence of the current code), D (late impulse without rewind), E (shot ray vs physics eye). Results in run1.txt.
- tools/out/_claude/netcode/probe2.js: Step cost by movement state, correction jump size, and input/snapshot quantization tolerance. Results in run2.txt.
- tools/out/_claude/netcode/probe3.js: Remote interpolation/extrapolation error on real 120 Hz trajectories. Results in run3.txt.
- tools/out/_claude/netcode/lib.js: Reusable snapshot/restore, per-tick command application and teleport helpers (a starting point for a serialize/replay regression test).

## Findings
### [critical] PlayerController is bit-exact deterministic and cheap to replay when the full state is restored and inputs are applied per tick
Probe A built 501 real mid-movement states (ground 195, air 210, wallrun 28, grapple 32, mantle 19, slide 17) on the ptest map. For each: snapshot all numeric and Vector3 fields of PlayerController (54), Grapple (20) and Player (43); run 36 random per-tick input commands (grapple.update also per tick); restore; run again. Result: 0 of 501 trials differed at the bit level (exactMismatch=0). Cost after JIT warm-up, µs per step (mean / p99): ground 17.8 / 42, air 15.9 / 33, wallrun 17.3 / 44, grapple 18.9 / 36, slide 17.9 / 33, mantle 10.6 / 28, max 97. A 12-tick (100 ms) replay costs 0.21 ms mean, 0.7 ms p99, 1.2 ms max. Quantization: yaw/pitch sent as float32 → 0 divergence after 36 ticks (<5e-5 m); yaw as 16-bit → max 0.3 mm; 0.01° steps → 1 of 501 over 1 cm. Owner position/velocity as float32 → 0 divergence; mm / cm-per-s quantization → 124 of 501 over 1 mm, 5 over 1 cm, max 0.44 m (near ledges). Movement code uses no Math.random. The only randomness is cosmetic: Player.js:211 (shock aim jitter, which ends up in yaw/pitch and therefore in the command), Player.js:441 (footsteps), CameraRig.js:73,84. Caveat: Math.sin/cos/atan2/exp/pow/hypot are implementation-defined, so Chrome vs Safari/Firefox may differ in the last bits. Host authority plus reconciliation absorbs that; lockstep would not.
Evidence: tools/out/_claude/netcode/probe.js (experimentA); tools/out/_claude/netcode/run1.txt: custom.A.exactMismatch=0, trials=501, ticksPerTrial=36; tools/out/_claude/netcode/run2.txt: stepCost_us, replay12ticks_ms {mean 0.2093, p99 0.7, max 1.2}, commandQuantization_after36ticks_m, snapshotQuantization_after36ticks_m; src/player/PlayerController.js:237-268 (step)

### [critical] The current Player.update path depends on frame rate and has inputs outside the fixed step, so the host could not reproduce a client's movement as-is
Probe B ran the same input timeline at 30/60/90/144/240 fps. Final positions after 3 s differed by up to 0.25 m for plain movement (60 vs 144 fps: 0.09 m), 0.13 m for wall-runs (0.015 m) and 13.08 m for a grapple swing (60 vs 144 fps). Jump timing snaps to frame boundaries (1.033 s at 30 fps vs 1.000 s at 60 fps), and grapple attach times differ (0.567 / 0.583 / 0.600 / 0.590 / 0.588 s). Causes:
(a) Input is read once per frame and shared by that frame's sub-steps; press edges are held until a step consumes them (Player.js:146-169).
(b) Grapple toggle/update runs per rendered frame (Player.js:172-173). Flight, attach, the 20 Hz line-of-sight check, the 3 s timeout, the 2.2 m arrival (with a velocity.y lift) and the cooldown all accumulate frame dt (Grapple.js:281-317, 351-375).
(c) Hook origin and flight time come from the rendered camera (Grapple.js:227-241, 419-422), so render state leaks into the simulation, and rope length is frozen at the attach frame (Grapple.js:329).
(d) The step reads the global game.weapons.adsAmount (PlayerController.js:480, 662), which is updated per frame (WeaponSystem.js:903-905). On a host simulating a remote player it would read the host's own ADS.
(e) WeaponSystem cancels sprint per frame (WeaponSystem.js:852, 1611 → Player.cancelSprint, Player.js:285-289).
(f) The Static-shock slow uses frame dt (Player.js:143, 200-212).
(g) Jump pads are checked per frame with game.time cooldowns (World.js:605-627).
(h) The Vortex pull writes velocities per frame (GrenadeTypes.js:214-259).
(i) Simulation dt is min(raw, 0.05) × timeScale (Game.js:733), with Javelin hit-stop (WeaponSystem.js:1554, 1580-1596) and end-of-match slow motion (Game.js:467).
Evidence: tools/out/_claude/netcode/run1.txt: custom.B.grapple.d60vs144=13.0773, move.maxPairwiseFinalPosDiff=0.2502, wallrun=0.13; src/player/Player.js:146-187; src/player/Grapple.js:221-250,281-317,419-422; src/player/PlayerController.js:480,662; src/weapons/WeaponSystem.js:852,903-905; src/world/World.js:605-627; src/weapons/GrenadeTypes.js:214-259; src/core/Game.js:733

### [high] Movement reads no other entity and the world is static; outside influences are only writes into the controller
No collision between players or between players and bots: BotManager._separate pushes only bots away from the player (BotManager.js:207-245), and the controller collides only with world.collision. The collision octree is built once per map load (World.js:207) and cleared only on unload (World.js:718); nothing moves at runtime. The grapple raycasts only static geometry (Grapple.js:226), so there are no anchors on moving objects. Jump pads are static data and read only the entity's own feet position (World.js:517, 614-617). Outside writes:
- Combat.applyDamage knockback → Player.applyImpulse → PlayerController.impulse (Combat.js:262-265; PlayerController.js:221-232). This also clears grounded/coyote, sets snapBlockUntil and airTime, and ends wall-runs.
- launch() from pads (PlayerController.js:206-218).
- Gale self push through shooter.applyImpulse (gale.js:84-95).
- Direct Vortex velocity writes plus lift impulses every 0.3 s (GrenadeTypes.js:226-251).
- Static shock (GrenadeTypes.js:352, 363).
- Death velocity (Player.js:316) and respawn via place().
Knockback is ignored while a target is spawn-protected unless it is self-inflicted (Combat.js:262); rocket self-knockback is full strength (Combat.js:331).
Evidence: src/ai/BotManager.js:207-245; src/world/World.js:207,517,605-627,718; src/player/Grapple.js:226; src/core/Combat.js:262-265,331; src/player/PlayerController.js:206-232; src/weapons/special/gale.js:84-95; src/weapons/GrenadeTypes.js:226-251,352

### [high] State required in the owner's reconciliation snapshot (ranked by per-field ablation)
Ablation: restore everything, replace one field with its value from a different state, run 36 ticks, count divergence over 1 mm. Rate = diverged / times the value actually differed:
- capsule 96% (mean error 30.8 m)
- mantling 100%
- wallRunning 95%
- velocity 94%
- grounded 87%
- grapple.state 61%
- wallCoyote 50%
- airJumps 43%
- sliding 38%
- jumpBuffer 35%
- coyote 26%
- snapBlockUntil 19%
- mantleT and mantleDur 13%
- lastSlideBoost 11%
- t 8%
- grapple.ropeLength 8% (max 27 m)
- grapple.anchor 8%
- wallRunTime 8%
- lockUntil 7%
- wallJumps 7%
- mantleTo 4% (max 46 m)
- lockD 4%
- grapple.flightTime, grapple.time, grapple.willHit 3-4%
- scanTick 3% (≤ 9 cm)
- height 2%
- also mattered: _crouchWas, lastWallN, mantleCooldown, airTime, wallPlaneD, grapple.target, grapple.cooldown, crouched
No effect in the sample: prevPosition, stepOffset, stepCount, eyeHeight, speed and is* flags (recomputed in _finish), yaw/pitch (supplied by the command), sprinting/sprintIntent (recomputed each step), wallN (re-blended each step), _safe/_netTick (safety net only), mantleWhy, grapple visuals (hook, origin, flightDir, wave, _clock).
Fields that mattered only rarely should still be sent: they gate edge cases (the 0.3 s crouchPressedAt slide window, refreshUsed, wallRunsThisAir ≤ 3).
Minimal owner block: capsule.start + crouched (the capsule end follows), velocity, groundNormal, grounded, t (or tick), every timer, counter and flag in PlayerController.reset() (lines 78-124), wall-run geometry (wallN x/z, lastWallN, lockN, lockD, wallPlaneD, runSign, wallSide), mantle from/to/dir/height, safety net (_safe, _safeValid, _safeCrouched), and grapple state/anchor/normal/target/willHit/flightTime/time/ropeLength/retractT/cooldown/cooldownTotal/losTimer/_losClock. Plus host-owned entity fields: alive, health, armor, shockedUntil, spawnProtectedUntil, pad cooldown / lastLaunchTime. These are all game.time-based today (Entity.js:142-155; World.js:618-621) and must become host ticks. Fully populated that is about 110 numbers (≈ 440 B as float32); typically 150-250 B with the mantle/wall-run/grapple sections sent only when active.
Evidence: tools/out/_claude/netcode/run1.txt: custom.A.ablation, custom.A.neverMattered, custom.A.moveFields/grappleFields/playerFields; src/player/PlayerController.js:78-124; src/player/PlayerController.js:244-245 (_crouchWas edge), 312-313 (_netTick), 951-952 (scanTick 60 Hz parity); src/core/Entity.js:142-155

### [high] Replaying for reconciliation re-fires sounds, effects and events; Player is hard-wired as the local player
The step calls Player hooks that play non-positional sounds, add camera trauma and FOV punches, spawn dust, emit 'player:jump' / 'player:land', and start/stop the slide and wall-run loops (Player.js:322-373). Grapple fire/release/attach/miss play audio and emit 'player:grapple' (Grapple.js:247-248, 267-268, 274, 297, 333-337). Measured: 501 replays of 36 ticks re-emitted 588 player:jump, 42 player:land and 189 player:grapple events. Listeners: WeaponSystem.js:329 (viewmodel land kick) and HUD.js:225 (grapple ring). Reusing Player for remote humans on the host would also: read game.input (Player.js:126-173), write game.camera (updateCamera, Player.js:233-237), play a non-positional 'hurt' on the host for every remote player's damage (Player.js:375-382), and play the remote player's footsteps, jumps and grapple sounds as if they were the host's own (Player.js:322-443; Grapple.js:247).
Evidence: tools/out/_claude/netcode/run1.txt: custom.A.eventsDuringReplay {jump:588, land:42, grapple:189}; src/player/Player.js:322-382,425-443; src/player/Grapple.js:247-248,267-268,297,333-337; src/weapons/WeaponSystem.js:329; src/ui/HUD.js:225

### [high] Shots aim along the rendered, shaken camera and use Math.random spread, so the host cannot rebuild a shot from yaw/pitch
_fire takes its origin and direction from game.camera (WeaponSystem.js:1069-1071). The camera is interpolated position + stepOffset + bob + landing dip + mantle lift + shake, and its pitch adds shake, landY×0.35, mantle pitch and hurt pitch (CameraRig.js:153-168). Measured at 22 shots in the built-in script: camera vs physics eye 0.12 m mean / 0.27 p95 / 0.31 m max; camera forward vs yaw/pitch 0.31° mean / 0.76° p95 / 0.93° max. 0.93° is 0.65 m at 40 m, more than the 0.24 m head radius. Worst case by code: about 2° after a hard landing, 5.7° mid-mantle. Other launch points: rockets start at a projection of the viewmodel muzzle (WeaponSystem.js:1226-1247, 1305-1326); grenades at camera + offsets with velocity = aim × throwSpeed + up 3 + 0.4 × player velocity (WeaponSystem.js:1510-1527); melee casts 5 rays from the camera (1624-1664). Spread uses randomInCone with Math.random, 3 draws per pellet (utils.js:60-70; WeaponSystem.js:1083, 1128, 1159, 1231). A seeded generator (mulberry32) already exists (utils.js:73-81).
Evidence: tools/out/_claude/netcode/run1.txt: custom.E {cameraToPhysicsEye_m max 0.3138, cameraFwdVsYawPitch_deg max 0.9272}; src/weapons/WeaponSystem.js:1069-1071,1083,1226-1247,1305-1326,1510-1527,1624-1631; src/player/CameraRig.js:153-168; src/core/utils.js:60-81

### [high] Host knockback on a predicted player: correction size grows linearly with delivery delay; applying it on receipt without rewind is much worse
Probe D2 measured the correction jump when the client restores the host state exactly, d ticks after the host applied the impulse:
- Rocket mid-falloff (11 m/s horizontal + 5 up): 0.095 m at 8 ms, 0.19 m at 17 ms, 0.37 m at 33 ms, 0.54 m at 50 ms, 1.02 m at 100 ms.
- Close Gale shove (21 + 4.5): 0.17 / 0.34 / 0.65 / 0.96 / 1.81 m.
- Melee (4.5): 0.035 / 0.069 / 0.136 / 0.20 / 0.375 m.
That is roughly horizontal Δv × delay. Probe D applied the same impulse d ticks late with no rewind: mean 0.16 m at 8 ms, 0.49 m at 25 ms, 0.95 m at 50 ms, 1.46 m at 100 ms, with worst cases of 4.5-10 m (a ledge, grapple or wall-run outcome flips). impulse() also changes discrete state (ungrounds, sets snapBlockUntil, ends wall-runs: PlayerController.js:221-232), so sending full owner state is safer than sending only the vector. The game already has a camera-offset smoother that can hide corrections: stepOffset, decaying at STEP_SMOOTH 16/s (Player.js:62-63, 190-192; PlayerController._hideJump 736-744).
Evidence: tools/out/_claude/netcode/run2.txt: custom.reconcilePop_m; tools/out/_claude/netcode/run1.txt: custom.D.byDelayTicks; src/player/PlayerController.js:221-232,736-744; src/player/Player.js:190-192

### [medium] Remote players: interpolating with the replicated velocity is accurate at 30-60 Hz; extrapolation is not
Probe 3 resampled real 120 Hz trajectories (wall-run/wall-jump, grapple peaking at 27.2 m/s, slide-hop, a simulated rocket jump at 26.9 m/s, random inputs). Linear interpolation max error: 5-15 cm at 30 Hz, 3-10 cm at 60 Hz. Hermite interpolation using the replicated velocity: max 3.3-10.7 cm at 30 Hz (p99 ≤ 7.6 cm), 1.6-11 cm at 60 Hz. Extrapolating across one lost snapshot: up to 0.36-0.66 m at 30 Hz and 0.18-0.39 m at 60 Hz. Because remote players are shown behind the host's present, hitting what you see needs rewinding: at 9.6 m/s a 100 ms interpolation delay puts the target 0.96 m behind its host position (2.5× the 0.38 m body radius); at the 24 m/s grapple cap, 2.4 m. The same number is how far behind cover a victim can still be hit.
Evidence: tools/out/_claude/netcode/run3.txt; tools/out/_claude/netcode/probe3.js; src/core/Entity.js:85-94 (hitbox radii 0.24 head / 0.38 body / 0.3 legs)

### [medium] Rewinding hitboxes is simple here, and the existing weapon routines can be reused under a rewind
Entity.getHitboxes is computed only from position + height (Entity.js:85-94), so a per-entity ring buffer of (x, y, z, height) per host tick, or per sent snapshot, is enough (about 1 s × 120 × 16 entities ≈ 1.9k entries). Combat.raycast walks game.entities and their hitboxes (Combat.js:129-168). So the host can rewind by writing the historic position/height into every other entity, running the unchanged routine, then restoring. That covers fireBullet, fireArc (arc.js:60-123, chain = nearest hostiles within 6.5 m with line of sight), fireRail (rail.js:36-109, up to 3 entities + 0.9 m wall), galeBlast (gale.js:37-97, cone on chest points + line of sight) and melee (WeaponSystem.js:1624-1664). Combat.fireBullet does trace, effects and applyDamage in one call (Combat.js:218-244), so it needs splitting into a trace-only prediction path for clients and an apply path on the host.
Evidence: src/core/Entity.js:85-94; src/core/Combat.js:129-168,218-244; src/weapons/special/arc.js:60-123; src/weapons/special/rail.js:36-109; src/weapons/special/gale.js:37-97

### [medium] Projectiles: rockets are trivially predictable; grenade physics depends on frame rate; special grenades act on players continuously
Rockets move at a constant 42 m/s in a straight line with a swept raycast against world and entities each frame, and explode on impact or after 6 s (Projectiles.js:288-319). Only Gale reflection (gale.js:133-147) and Vortex (GrenadeTypes.js:277-286) bend them, so a spawn event {origin, dir, speed, tick} lets any client extrapolate exactly. Grenades integrate gravity, drag and bounces with variable frame dt (Projectiles.js:334-376) plus random spin axes (192, 373), so host and client copies drift and need corrections. Explosions go through explode() → radialDamage (Projectiles.js:210-239; Combat.js:309-337). Special grenades affect players over time on the host: Vortex (3.4 s, 26 m/s² pull ×3 on the ground, max pull speed 14 m/s, lift impulses every 0.3 s, crush damage every 0.25 s), Static shock 1.1 s, Kinetic knockback 20 with splat tracking. The SMG damage/rate bonus uses the shooter's horizontal speed at fire time (smg.js:17-21; WeaponSystem.js:848), which the host knows from its own simulation of that player.
Evidence: src/weapons/Projectiles.js:133-154,161-200,210-239,288-319,322-418; src/weapons/GrenadeTypes.js:201-286,322-396; src/weapons/WeaponDefs.js:341-370 (GRENADE_TYPES tuning); src/weapons/special/smg.js:17-21

### [medium] Every gameplay timer runs on per-machine game.time, which is capped and scaled
game.time advances by min(raw, 0.05) × timeScale per frame (Game.js:733). Weapon cooldowns (`now = game.time`, WeaponSystem.js:844), spawn protection, shock (Entity.js:142-155), pad cooldowns (World.js:618-620), gale shove/splat windows (gale.js:182-188) and recoil (Player.js:249, 267) all compare against it. Two machines' game.time values drift apart after any hitch longer than 50 ms, or hit-stop / slow motion, so none of these can be sent as absolute times. Replicated timers must be host ticks (or remaining durations), and a separate uncapped net tick clock is needed.
Evidence: src/core/Game.js:467,733; src/core/Entity.js:142-155; src/world/World.js:618-620; src/weapons/WeaponSystem.js:844,1580-1596

## Recommendations
### Refactor 1 (prerequisite): drive movement from a per-tick input command
Add Player.applyCommand(cmd) that does, per 120 Hz tick:
- set yaw/pitch from cmd.yaw/cmd.pitch (float32 values, which the client also uses in its own simulation);
- compute the wish vector (logic from Player.js:146-163) and set held/pressed flags from the command (no press latching carried across ticks);
- apply sprint cancel from cmd flags (fire held, ADS pressed, melee started), replacing the per-frame calls at WeaponSystem.js:852/1611;
- pass cmd.ads (quantized to 1/255 and used by the client too) into the controller instead of game.weapons.adsAmount (PlayerController.js:480, 662);
- process the grapple press and a tick-based grapple update (the probe did exactly this and was bit-exact), then move.step(STEP);
- run the jump-pad check and Static-shock slow inside the tick, with per-player cooldowns counted in ticks.
Move Grapple.update and the attached rules (Grapple.js:281-375) to fixed dt, and derive the hook origin from simulation state (eye + HAND_OFFSET rotated by yaw/pitch) instead of game.camera (Grapple.js:227, 419-422). The rope can still be drawn from the camera-space hand. The local client keeps its frame loop, but its command generator emits one command per tick. Keep the per-frame paths for bots.
Files: src/player/Player.js, src/player/PlayerController.js, src/player/Grapple.js, src/world/World.js, src/weapons/WeaponSystem.js, src/core/Entity.js

### Refactor 2: explicit serialize/restore for the owner state, and silent replay
Add PlayerController.serialize/deserialize and Grapple.serialize/deserialize covering the fields listed in the reconciliation-state finding, plus entity net fields (shockedUntil, spawnProtectedUntil, pad cooldown as ticks; health/armor/alive). Send position and velocity as float32 (probe2: 0 divergence). Derive scanTick and _netTick from command-tick parity, or send them. Add a `replaying` flag that suppresses the Player hooks (Player.js:322-373), Grapple audio/events/effects (Grapple.js:247-337) and _rescue logging during replays. After a replay, reconcile the looping sounds (slide, wall-run, grapple reel) against the final state. Put any correction delta into a render-only offset like stepOffset, decaying over about 60-100 ms, and move prevPosition along with it. Make probe A (tools/out/_claude/netcode/probe.js, experimentA) a regression test: deserialize(serialize(state)) then replay must stay bit-exact, which catches new fields someone forgets to serialize.
Files: src/player/PlayerController.js, src/player/Grapple.js, src/player/Player.js

### Phase-1 netcode that should feel good on LAN
Structure: listen server in the host's browser tab; clients load the game from the host.
- **Inputs:** 120 Hz sim tick with one command per tick: tick u32, buttons u16 (fwd, back, left, right, jump, crouch, sprint, fire, ads, reload, grenade, grapple, melee + press-edge bits), yaw f32, pitch f32, ads u8, weapon/slot u8, fire sequence. About 16 B each, sent 2 per packet at 60 Hz with the previous 2-4 repeated if the transport is unreliable: ~6 KB/s up.
- **Host simulation:** step each remote player's controller once per received command (Quake/Source style, no lockstep). Cap at ~125 commands/s. Never drop simulation time on the host.
- **Snapshots:** 60 Hz on wired LAN (30 Hz is acceptable). Remote entity block ≈ 36-44 B: pos f32×3, vel i16×3, yaw/pitch, height u8, flag bits (ground, crouch, slide, wall-run side, grapple state, mantle, sprint, firing, beaming, charging, shocked, alive, teleported), weapon, charge u8, and the grapple anchor / beam end only when active. Plus the owner block (full state, ack = last processed command) and reliable events. About 40-70 KB/s down per client.
- **Push immediately:** whenever the host applies an impulse, launch, shock, death or respawn to a remote player, push that player's owner snapshot at once instead of waiting for the next scheduled snapshot.
- **Client reconciliation:** restore + silently replay unacknowledged commands on every owner snapshot (0.05-0.2 ms for 3-12 ticks).
- **Remote display:** Hermite interpolation with velocity at render time = latest host tick − 2.5 snapshot intervals (≈ 40 ms at 60 Hz, ≈ 85-100 ms at 30 Hz or on Wi-Fi). No extrapolation beyond one interval (errors reach 0.66 m); snap on the teleport flag.
- **Time:** a net tick clock separate from game.time; hit-stop and end-of-match slow motion become visual-only in multiplayer (WeaponSystem.js:1580-1596, Game.js:467).
- **Costs:** host CPU ≈ 18 µs × 120 ≈ 2.2 ms per second per remote player.
Files: src/core/Game.js, src/player/Player.js, src/weapons/WeaponSystem.js, src/core/Combat.js

### Hit detection per weapon: host re-traces the client's exact ray against targets rewound to what the shooter saw
General scheme. The shooter's client sends {cmdTick, weapon, seq, origin f32×3, dir f32×3, spreadSeed, renderTick as a float} and predicts its own effects and hitmarker right away. The host rewinds every other entity's position/height to renderTick using the same snapshot data and interpolation function the client used, so the result matches exactly. It then runs the existing routine with effects muted, restores positions, and applies damage and knockback. Validation: origin within 0.6 m of the host's eye position for that player at cmdTick (measured camera offset up to 0.31 m; step-up offset up to 0.5 m); line of sight from the host's eye to the origin; fire rate ≥ 1/fireRate − 1 frame (fire timing is frame-quantized, WeaponSystem.js:1064); ammo/ownership from a lightweight per-player weapon state on the host; power ≤ held ticks / (0.7 s × 120) for the Javelin; cook time from the pin-pull tick.
- **Pistol, rifle, sniper, SMG (one hitscan ray):** use the scheme as-is. The host computes falloff, headshot and SMG momentum from its own speed for that player. The sniper (100 dmg, ×2.5 headshot) depends most on exact rewind.
- **Shotgun:** seeded spread; the host regenerates the 9 pellets from (dir, spreadAngle, seed) with mulberry32 in place of Math.random.
- **Tempest (arc):** 24 ticks/s. The client sends tick messages (batched per packet, n ≤ 3 per message as in beamCadence). The host does the primary ray and chain selection at rewound positions (fireArc unchanged). Remote viewers get beaming state + beam end in snapshots and chain lightning events.
- **Javelin (rail):** the charge state machine stays on the client; the host tracks the charge-start tick. fireRail runs rewound (pierce and wall thickness are deterministic against the static world). charging/chargeAmount goes in snapshots so the victim sees the warning glow.
- **Gale:** the host runs galeBlast at rewound positions (cone on chest points). The shooter predicts its own self-push in its command tick and the host applies the same impulse in the same command (gale.js:84-95). Reflection is host-only because projectiles belong to the host.
- **Melee:** 5 rays rewound, plus the 0.13 s swing delay.
- **Rockets and grenades:** host-authoritative, no rewind. The thrower spawns a predicted visual copy keyed by (clientId, seq). The host spawns the real one when it processes the fire command, with the client's origin/dir or velocity validated (rocket origin within ~1 m of the eye; grenade |v| ≤ throwSpeed + 3 + 0.4 × player speed + ε). Other clients start rockets from a spawn event and extrapolate them in a straight line; grenades are simulated locally and corrected from snapshots (≤ 10 live, about 28 B each). Explosions, detonations, Vortex deploy/collapse, Static bursts and smoke are reliable host events.
Files: src/core/Combat.js, src/weapons/WeaponSystem.js, src/weapons/special/arc.js, src/weapons/special/rail.js, src/weapons/special/gale.js, src/weapons/Projectiles.js, src/core/utils.js

### Knockback, launches and fields on a predicted player
- **Self-caused and world-caused, predicted by the client in its tick:** jump pads (static data, tick cooldown), Gale self-push, grapple arrival lift, mantle and jumps. They need no correction because host and client apply them in the same command.
- **Caused by others (explosions, rockets including your own rocket jump in phase 1, kinetic/vortex collapse, gale shove, melee, storm lightning):** the host applies them to its copy of the player between command k and k+1, then pushes the owner snapshot immediately. Send full state, not just the vector, because impulse() changes grounded, snapBlockUntil and wall-run state. The client rewinds to k, replays, and smooths the jump through the render offset. Measured jump: 0.1-0.2 m at LAN delivery delays (1-2 ticks) versus 0.37-0.65 m when waiting up to 4 ticks (a 30 Hz snapshot). Never apply an impulse on receipt without rewinding (0.5-1.5 m mean errors, up to 10 m).
- **Replicated state:** spawnProtectedUntil as a tick (it decides whether knockback applies, Combat.js:262) and shockedUntil as a tick (its slow runs inside the tick).
- **Vortex:** phase 1 accepts corrections at 60 Hz. Phase 2: replicate {center, startTick, duration} and apply the same pull formula inside both simulations' ticks for human players, with lift impulses every 36 ticks.
- **Death and respawn:** a reliable event {tick, position, yaw}. Both sides call place(), which is deterministic; the client clears its command history.
Files: src/player/PlayerController.js, src/player/Player.js, src/core/Combat.js, src/weapons/GrenadeTypes.js, src/world/World.js

### Showing other players' shots, beams, explosions and sounds
Use Bot._fire (Bot.js:697-816) as the model. Add a RemotePlayer entity: interpolated from snapshots, rendered with BotModel (update() needs forwardSpeed/strafeSpeed from the replicated velocity, onGround, crouch from height, aimPitch/aimYawOffset, firing, reloading, alive) plus its own grapple rope drawn from the model's hand to the replicated anchor. Do not subclass the local Player hooks.
- **Fire event** {shooterId, weapon, seq, origin, dir, seed, ends:[point, normal, surface or entityId] (≤ 3 tracers for the shotgun), hot} → effects.muzzleFlash at BotModel.getMuzzleWorldPosition, audio.play(def.sound, {position}), effects.tracer from the muzzle to each end, and effects.impact / hitSpark.
- **Beam state (arc)** → updateBeamVisual(game, avatar, muzzle, end, def) every frame (the channel is keyed by shooter id, arc.js:135). Chain events → effects.lightning + arcHit.
- **Rail** → getRailBeams(game).add / rings / impact, and chargeGlow while charging.
- **Gale** → effects.galeBlast; shove/splat/reflect events → galeRing.
- **Explosion** → effects.explosion (its camera shake is local).
- **Damage/death** → hitmarkers for the attacker, hurt/flinch/indicators for the victim, model flashHit, and gibs on death.
- **Movement sounds for avatars:** positional sounds from state changes (jump/land from onGround edges, slide/wall-run loops from flags, grapple fire/attach from grapple state).
- The shooter's own client renders its effects at fire time; the host does not echo its own fire events back.
- On the host, remote players' shots must still emit 'weapon:fire' so bots hear them.
Files: src/ai/BotModel.js, src/fx/Effects.js, src/fx/RailBeam.js, src/weapons/special/arc.js

### What can wait until phase 2 or later
- Predicting your own rocket's explosion and self-knockback (a straight line against the static world is deterministic).
- Predicting the Vortex field on yourself.
- Fixed-step grenade integration (replace per-frame dt in Projectiles.js:334-376) so grenade copies track the host.
- Unreliable transport with command redundancy (WebRTC) and a host input buffer with client clock nudging, needed for Wi-Fi/Internet or code-join over the internet.
- Delta/quantized snapshots and interest management.
- Anti-cheat beyond basic validation.
- Fast-forwarding projectiles by the shooter's latency.
- Wall-run, slide and grapple poses for avatars (BotModel has none).
- Predicted pickups.
- Killcam, spectating, reconnect/join mid-match (needs a full-state snapshot).
Files: src/weapons/Projectiles.js, src/weapons/GrenadeTypes.js, src/ai/BotModel.js

## Risks
- Grapple, ledge and wall-run outcomes are chaotic: a one-tick difference flipped outcomes by up to 13 m in probe B, and a late impulse caused 4-10 m errors in probe D. Anything that affects movement but is not both replicated and ticked identically (ADS amount, sprint cancel, Vortex, shock, pads, grapple timers, camera-based hook origin) will show up as large, frequent corrections.
- Math.sin/cos/atan2/exp/pow/hypot differ between browser engines, so mixed Chrome/Firefox/Safari clients will mispredict slightly. Reconciliation fixes it, but test mixed browsers, and do not rely on lockstep or deterministic grenades across browsers.
- Player, WeaponSystem and CameraRig assume a single local player (game.input, game.camera, non-positional sounds, player:* events). Reusing them for remote humans on the host would cause wrong sounds, events and HUD/viewmodel reactions unless a separate RemotePlayer or input-source abstraction is built.
- Game dt is capped at 50 ms and multiplied by timeScale (Game.js:733). If the net simulation keeps running on that clock, hitches and hit-stop/slow motion pause or stretch a client's command stream and desync all game.time timestamps. A separate net tick clock is required.
- With a WebSocket (TCP) relay, occasional head-of-line stalls on Wi-Fi deliver commands in bursts. The host catches up, but other clients see hitches in that player unless the interpolation buffer is at least 100 ms.
- Rewinding to what the shooter saw means victims can be hit up to speed × (interpolation delay + RTT/2) behind cover: about 0.5 m at 9.6 m/s with 50 ms, up to 2.4 m for a 24 m/s grappler at 100 ms. Shorter interpolation delay (60 Hz snapshots) limits this.
- Probe E sampled only 22 shots from the scripted run (little camera trauma). By code, landing dip, mantle pitch and hurt flinch can push the aim ray 2-6° off yaw/pitch for a moment, which is another reason to send the exact ray rather than rebuild it on the host.
- Trusting client-supplied rays and seeds is fine for a friends-on-LAN or party-code setup, but not against deliberate cheating.

## Open questions
- Should the authoritative simulation run in the host player's own browser tab (a listen server; the practical choice, since the game depends on WebGL and the DOM) with a small local process only relaying messages and serving files, or is a separate headless host wanted?
- Target network: wired LAN only (default to 60 Hz snapshots and ~40-50 ms interpolation) or Wi-Fi/Internet party codes too (default to 30 Hz / 100 ms, and consider WebRTC unreliable channels)?
- Trust model: are friendly sessions enough to trust client rays, seeds and ammo with light validation, or is stricter server-side checking needed?
- Should bots stay in multiplayer matches (simulated on the host and replicated like remote players), and should Escalation, King of the Hill and the Stratos storm be supported in phase 1?
- Is it acceptable that rocket-jump self-knockback is not predicted in phase 1 (about 10-40 ms late on LAN, smoothed), or must rocket jumps feel instant from day one (then predict your own rocket's world impact)?