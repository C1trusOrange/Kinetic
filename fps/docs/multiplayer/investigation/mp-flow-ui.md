# mp-flow-ui

## Summary
Match flow in KINETIC is one monolithic, local, single-human procedure. Game._startMatch (Game.js:328-415) reads the config from settings or options, names the one human from settings, always puts that human on Blue in team modes with PLAYER_COLOR in FFA, hands out local incremental entity ids (FFA team = entity id), spawns bots that alternate Red/Blue on the assumption of exactly one Blue human (BotManager.js:136-142), writes the config back to settings, and switches to 'playing' as soon as its own warm-up finishes. There is no loading barrier. Winner, results, playerWon, the respawn delay and scoreboard identity are all computed from the local player's point of view (`isPlayer`). Pause freezes the whole simulation, and it is triggered by pointer-lock loss, Esc/P and a hidden tab. `timeScale` is global and is used for the end-of-match slow-motion and, because `game.hitStop` does not exist, for the Javelin hit-stop fallback in WeaponSystem. The loop, boot and match start wait on rAF (`nextFrame`), and the server binds 127.0.0.1 only. Menu, HUD, ModeHUD and Scoreboard have no concept of other humans: remote humans would get the bot icon, "you are Blue" is hard-coded, and the Team tile on the end screen always says Blue. The HUD also computes respawn and shield countdowns from the local `game.time`.

I verified these by reading every file in scope end to end and by running the harness (scratch in tools/out/_claude/mp-flow/):
- **Pause** freezes the simulation completely (0 s of sim in 1.47 s real).
- **Hit-stop** sets global timeScale 0.3 for about 3 frames.
- **End-of-match** runs 2.2 s real at 0.25x, which is about 0.5 s of sim. The end screen then has only Play again and Main menu. A 0-0 FFA is reported as "Victory" for the local player.
- **dt clamp:** 10 frames of 120 ms advanced the sim only 0.5 s in 1.36 s real.
- **Quality switch mid-match** blocks for 866 ms plus a 377 ms frame.
- **Boot to menu** takes 16-21 s. Starting a match from the menu takes 1.86 s on the same map and 3.83 s on a different map.
- **Pointer lock** stays unlocked after a start that was not triggered by a click.
- **Setup panel** already overflows at 1280x720: the time-limit row (604-653 px) sits under the footer.

Multiplayer testing is feasible headlessly, verified with a scratch prototype that did not touch any project file (two_pages.py):
- Two game pages run at once in one headless Chrome, but only when each page is its own window (`Target.createTarget` with `newWindow:true`). As a background tab the hidden page never ran a frame and stayed in 'loading' for 150 s, while its timers and WebSocket still worked.
- The game runs with 0 errors from a non-localhost, insecure origin (`http://lan.test`), which is the same situation as a LAN IP.
- A stdlib-only WebSocket relay grafted onto `serve.Handler` works with Chrome. It needs an HTTP/1.1 101 response and `TCP_NODELAY`: without it, p50/p95 round-trip was 38.6/405 ms; with it, 15.9/207 ms at the same load. Round-trip time is dominated by page frame time (0 bots at low quality: p50 9.3 ms).
- BroadcastChannel also works between the two pages.
- Stdlib LAN-IP detection works on this machine (172.20.5.157).

The recommended design:
- **Server:** the host's browser tab is the authority (a listen server). The Python server is only a relay, room-code registry and LAN-info service. Offline play is treated as "authority with zero peers".
- **Menu:** a new Multiplayer hub (Host / Join). Host setup reuses the setup screen, with a scrollable panel and extra options. A lobby screen shows the room code, the LAN URL, a `?join=CODE` deep link, the player list or team columns, and ready/ping/kick. The join screen takes a name and a 4-letter code.
- **Match:** a loading barrier with a timeout, then a countdown with a "click to play" gate. Esc opens a match menu that does not pause.
- **End:** the host chooses Rematch or Back to lobby; clients follow.
- **Other flows:** late join, token-based reconnect, closing the room when the host leaves, team auto-balance with bots filling the gaps, and host-assigned unique names and colors.

## Key files
- src/core/Game.js: Owns lifecycle and the loop. Needs a session role, a split match lifecycle (load / begin / countdown / end / lobby), authority gating, host-assigned ids, no pause online, and local-only hitStop and end slow-mo. Key lines: boot 280-309; _startMatch 328-415; endMatch 452-472; pause/resume 483-501; quitToMenu 503-513; addEntity 530-534; respawn and spawn pick 550-581; _onDeath 583-600; getScoreboard 613-621; _updateMatch 623-647; _loop 720-765; update 768-786.
- src/ui/Menu.js: All non-HUD screens. Needs the Multiplayer hub, host setup mode, Lobby and Join screens, the MP match menu, the MP end screen, loading-barrier text, and fixes to the single-human texts (177-182, 209, 624-628, 739-803).
- src/ui/HUD.js: In-match UI; polls game.player, game.weapons, game.match and game.entities. Needs a countdown and click-to-play, network status, nameplates, join/leave lines in the kill feed, host-time conversions (766, 819, 927-931), killer health from the death payload (349), late-join seeding of FIRST BLOOD / lead / match point, and the double-escape fix (431, 884).
- src/ui/ModeHUD.js: Escalation and KOTH widgets. Needs replicated m.koth and m.ladder, and the esc:* / hill:* events forwarded from the host (63-70, 199-207).
- src/ui/Scoreboard.js: Rows use isPlayer for both the 'me' row and the bot icon (20, 25). Needs isLocal, isBot, ping, host and connected, and the change signature (68-72) must include them.
- src/core/AutoTest.js: Harness hooks. Needs net params (host/join/room/name/players/team), a per-page net report, all entities in the report (206), and a clock that does not depend on Game.update continuing (112-146).
- src/core/Settings.js: Persisted host-config defaults and playerName. New MP keys need typed defaults (the load type-check is at 50). Clients must not persist the host's config.
- src/core/Input.js: requestLock skips the request without user activation (184-185), so a network-started match cannot grab pointer lock. Esc is never an activation.
- src/ai/BotManager.js: spawnBots alternates Red/Blue starting with Red for a single Blue human (136-142) and takes colors from the 12-entry BOT_COLORS. Needs a team, name and color plan from the lobby.
- src/weapons/WeaponSystem.js: Javelin hit-stop falls back to the global game.timeScale (1554, 1580-1596). onPlayerSpawn (579-606) is where Modes.loadoutFor, and the spawn loadout from request #2, apply.
- src/core/Modes.js: loadoutFor hook (480-482), escalation weapon switch keyed on isPlayer (82), pickWinner (535-537). Rules run host-side; state is replicated through match.koth and match.ladder.
- src/core/Combat.js: applyDamage returns 0 once match.over is set (256), so an online end-of-match does not need a global slow-mo. kill emits 'death' (299).
- src/core/Audio.js: Loop and muffle gating reads game.state and the private game._endTimer (1534-1542). Must follow the new overlay and outro flags.
- tools/serve.py: Binds 127.0.0.1 (52), threading server with daemon threads. Natural home for a --lan bind, the /mp WebSocket relay and room registry, and /mp/info. run.py reuses serve_in_background (run.py:38, 332), so the harness gets the relay automatically.
- tools/run.py: Single-page CDP harness (launch_chrome 195-224). Its CDP and helper code can be reused by a multi-page runner.
- play.bat: Starts a localhost-only server. Needs a host variant (host.bat or a prompt) that binds the LAN and prints the join URL, plus firewall guidance.
- src/main.js: Boot entry. window.__GAME__ and __ERRORS__ are per page (fine for multi-page tests). Deep link ?join=CODE would be parsed in Game.boot or Menu.
- tools/out/_claude/mp-flow/two_pages.py: Scratch prototype (verified). Stdlib WebSocket relay on serve.Handler (HTTP/1.1 101, TCP_NODELAY, per-connection send lock) plus a runner for two headless windows with an insecure-origin check. Template for tools/run_mp.py and the serve.py relay.
- tools/out/_claude/mp-flow/flow_scenario.js: Scratch scenario that measured the dt clamp, pause freeze, hit-stop and end-of-match timing (writes window.__FLOW__).
- tools/out/_claude/mp-flow/quality_scenario.js: Scratch scenario that measured the mid-match quality-switch stall.

## Findings
### [critical] Pause freezes the whole simulation and is triggered automatically by lock loss, Esc/P and hidden tabs
Game.pause() sets state 'paused'. _loop then only updates audio, so bots, projectiles, the match timer and modes all stop. pause() is called from four places:
- onLockChange(false) (Game.js:248-250): every Esc exits pointer lock;
- keydown Esc/P (252-255);
- visibilitychange hidden (271-276);
- the Menu Esc handler (Menu.js:348) only resumes.

resume() needs a click because Esc is not a user activation (Input.js:175-186). Measured with flow_scenario.js: 0.000 s of sim advance over 1.468 s real while paused.

In multiplayer this must become a match menu that does not pause:
- state stays 'playing';
- set input.enabled=false and call clearAll();
- the entity stays in the world.
The Restart button (Menu.js:297, 408) is host-only, or hidden.
Evidence: src/core/Game.js:245-277; src/core/Game.js:483-501; src/core/Game.js:748-753; src/ui/Menu.js:289-304; src/ui/Menu.js:342-355; src/core/Input.js:175-186; tools/out/_claude/mp-flow/flow_scenario.js -> pause.simAdvanceWhilePaused=0, realAdvance=1.468

### [critical] timeScale is global: end-of-match slow-mo and the Javelin hit-stop slow every system, and long frames dilate sim time
endMatch sets this.timeScale=0.25 and _endTimer=2.2 (Game.js:467-468). Measured: 2.2 s real produced 0.50-0.53 s of sim, then the end screen appears and the sim is frozen.

game.hitStop does not exist (measured hasGameHitStop=false). WeaponSystem._hitStop therefore falls back to g.timeScale=0.3 for 0.12 s real (WeaponSystem.js:1580-1596), triggered by the local player's rail kill (1554). Measured samples: [0.3,0.3,0.3,1,...].

The loop computes dt=min(raw,0.05)*timeScale with raw capped at 0.25 (Game.js:726, 733). Measured: 10 frames of 120 ms gave 1.358 s real but only 0.5 s sim.

Online consequences:
- A host's hit-stop or hitch slows the authoritative world for everyone.
- A client's local timeScale desyncs its own prediction.

Fixes:
- Implement Game.hitStop(scale, s). Online it is presentation-only (never touches timeScale); offline it keeps the current behavior. WeaponSystem already prefers g.hitStop (1582).
- End of match online: skip the global slow-mo. Combat.applyDamage already returns 0 when match.over (Combat.js:256). Keep the 2.2 s banner delay, optionally with a local-only visual slow-mo.
- Audio.js:1537 reads the private game._endTimer.
Evidence: src/core/Game.js:452-472; src/core/Game.js:474-481; src/core/Game.js:720-746; src/weapons/WeaponSystem.js:1554; src/weapons/WeaponSystem.js:1580-1596; src/core/Combat.js:256; src/core/Audio.js:1534-1542; tools/out/_claude/mp-flow/flow_scenario.js -> longFrames {real 1.358, sim 0.5}; hitStop samples; endScreen {realSinceEnd 2.202, simSinceEnd 0.5}

### [critical] _startMatch is a monolithic, single-human, local procedure with no loading barrier
Game._startMatch (328-415) does the following:
- builds cfg from options, falling back to settings (329-339);
- calls requestLock (343);
- calls _clearMatch and awaits nextFrame (348-349);
- loads or resets the world and prepares bots (351-364);
- creates the match object (366-378);
- sets player.name from settings (381) and adds the single local player (382);
- sets the team to TEAM_BLUE in team modes, or its own id in FFA (383), with color PLAYER_COLOR (384);
- spawns bots (386), which alternate RED, BLUE, ... assuming one Blue human (BotManager.js:136-138);
- resets K/D/tier (388-394), calls modes.onMatchStart, and respawns everyone locally (396);
- persists map/mode/bots/difficulty to settings (398-403);
- warms up, then sets state 'playing' immediately (405-414).

The multiplayer version must split this into:
- load (all peers, reporting progress);
- a barrier (host waits for 'loaded' acks, with a timeout);
- begin (host builds the roster with net ids, teams, colors and spawns; clients build entities from the roster);
- a countdown;
- live.
Clients must not persist the host's config. quitToMenu only sets player.alive=false (505) without resetting the grapple, weapons or loops (BACKLOG core-quit-to-menu-stale-player-state).
Evidence: src/core/Game.js:318-415; src/core/Game.js:503-525; src/ai/BotManager.js:123-149; BACKLOG.md:79-80

### [high] Network-triggered match starts cannot acquire pointer lock; clients need a click-to-play gate
Input.requestLock returns early when navigator.userActivation.isActive is false (Input.js:184-185). A host 'start' or 'load' message is not a user gesture, so clients enter the match unlocked. Measured: input.locked=false after a programmatic startMatch in both the same-map and different-map runs.

The existing pieces partly cover this, but not prominently:
- the HUD 'CLICK TO CAPTURE MOUSE' hint appears after 0.6 s unlocked (HUD.js:955-975);
- the canvas click handler relocks (Game.js:257-262).

Design: during the countdown show a prominent 'CLICK TO PLAY' panel. Resume from the MP match menu must also be a click, because Esc is excluded from user activation. Audio unlock is fine because lobby clicks already call audio.unlock (Menu.js:328).
Evidence: src/core/Input.js:174-203; src/core/Game.js:257-262; src/core/Game.js:343; src/ui/HUD.js:955-975; measured: {startMatchMs 1856 / 3832, locked:false}

### [high] rAF-only waits: a hidden tab never loads or simulates, which would freeze a hosted match for everyone
nextFrame() is pure requestAnimationFrame (utils.js:127). It is awaited by boot (Game.js:297), _startMatch (349) and warmup (438), and the loop itself is rAF (286, 721). World.js and Textures.js yields fall back to setTimeout(40).

Verified with two_pages.py --window 0: when the second page was created as a background tab, the other page became visibilityState 'hidden'. It stayed at state 'loading', frame 0, for 150 s, while its setInterval and WebSocket traffic kept working (213 pings, p50 5.7 ms).

Consequences online:
- A host who alt-tabs or minimizes stops the authoritative simulation for all clients. In headed Chrome, background timers are also throttled to about 1 Hz; this is known platform behavior, not measured here.
- A hidden client cannot finish loading, so the barrier must time out and that client late-joins.

Requirements:
- The host needs a fallback scheduler when document.hidden. A tick driven by a Worker timer is the likely candidate (hypothesis: to be verified in headed Chrome).
- Load paths must not await rAF-only promises while hidden.
- The host should be warned.
Evidence: src/core/utils.js:127; src/core/Game.js:286; src/core/Game.js:297; src/core/Game.js:349; src/core/Game.js:438; src/core/Game.js:721; src/world/World.js:56-61; tools/out/_claude/mp-flow/two_pages.py --window 0 -> A {vis:'hidden', frame:0, state:'loading'} after 150 s; relay still worked

### [high] Winner, results and scoreboard identity are computed from the local player's perspective, and FFA ties resolve to entities[0]
endMatch computes:
- m.playerWon = winnerTeam === this.player.team (461), or winner === this.player (464);
- the FFA winner as a stable sort of this.entities, so ties go to whichever entity is first (463). Measured: a 0-0 FFA gives winner 'Player' and a 'VICTORY — You won with 0 kills' screen (end_screen.png).

On different peers the entity order differs, so every peer would crown itself. The host must compute and broadcast winnerId and winnerTeam, results order and draw. Each client derives playerWon locally.

Other isPlayer uses:
- getScoreboard sets isPlayer (617); Scoreboard uses it for the 'me' row and shows a bot icon on every non-isPlayer row (Scoreboard.js:20, 25), so remote humans would be shown as bots;
- the respawn delay uses victim.isPlayer (598), so remote humans would get the bot delay;
- Menu._fillEnd uses me = rows.find(r => r.isPlayer) (789) and a hard-coded Blue team tile (799).

endMatch also runs synchronously inside the 'death' listener (599 → 602-610), which is the BACKLOG banner-overwrite bug. Online, the host must broadcast the death before the match end.
Evidence: src/core/Game.js:452-472; src/core/Game.js:583-621; src/ui/Scoreboard.js:18-29; src/ui/Menu.js:754-803; tools/out/_claude/mp-flow/end_screen.png; flow_scenario endMatch {playerWon:true, winner:'Player', results all 0/0}; BACKLOG.md:71-72,95-98

### [high] Menu has no multiplayer entry, hard-codes single-human texts, and the setup panel already overflows
Current screens:
- Main nav is Play / Quick play / Settings / Controls (Menu.js:177-182).
- Mode cards say 'Blue vs Red, you are Blue' (209, 211).
- The bots note says 'You + N on Blue · M on Red' (624-628).
- Deploy calls startMatch directly (457-466).
- Pause has Resume / Restart / Settings / Controls / Quit (289-304).
- End has Play again → restartMatch and Main menu → quitToMenu (306-321, 408-411); measured buttons ['again:Play again','menu:Main menu'].
- _fillPause shows 'Bots' and the local kills (739-752); _fillEnd shows endinfo 'N BOTS' (786).
- _setCfg writes settings on every change (583-591).

Measured at 1280x720: the setup options panel's time-limit row sits at 604-653 px under the Back/Deploy footer (menu_setup.png; BACKLOG notes the same). Adding host options (max players, late join, team mode, spawn loadout) requires a scrollable .setup-opts (style.css:572 has no overflow) or tabs.

The main menu has vertical room for one more button: 4 buttons span y=330-545 and the footer is at y=692.
Evidence: src/ui/Menu.js:171-231; src/ui/Menu.js:289-321; src/ui/Menu.js:398-417; src/ui/Menu.js:457-466; src/ui/Menu.js:583-632; src/ui/Menu.js:739-803; style.css:553; style.css:572; tools/out/_claude/mp-flow/menu_main.png; tools/out/_claude/mp-flow/menu_setup.png

### [high] HUD and ModeHUD read host-owned state against the local clock and keep local-only match flags
Values that would use the client's own clock instead of the host's:
- respawn countdown p.respawnAt - g.time, with the bar scaled to RESPAWN_DELAY.player (HUD.js:927-931);
- spawn shield p.spawnProtectedUntil - g.time (766);
- elapsed clock g.time - m.startTime (819; Menu.js:750).
All are in the host's time base, so the host should send durations or a clock offset.

'KILLER HEALTH' reads attacker.health (349), so remote health must be replicated or included in the death payload.

FIRST BLOOD (330, 337), lead changes (879-887) and match point (892-899) are HUD-local flags that a late joiner would get wrong; seed them from the snapshot.

ModeHUD needs:
- m.koth {phase, index, left, owner, contested, progress, previewed} and m.ladder (199-208);
- the events esc:tier, esc:final, hill:move/relocate/preview/capture/contested/score (63-70) forwarded from the host.

HUD events that must be delivered with the local entity reference:
- damage (298, 305), death (313), spawn (356), pickup (385), reflect (414), match:end (423);
- weapon:switch, grenade:switch and player:grapple are local-only.

Names are safe (esc()/textContent everywhere). However, two announce() calls pass esc()'d names into textContent (431, 884), so a name like 'A&B' would show as '&AMP;' in banners.
Evidence: src/ui/HUD.js:295-361; src/ui/HUD.js:384-435; src/ui/HUD.js:456-463; src/ui/HUD.js:762-769; src/ui/HUD.js:802-935; src/ui/ModeHUD.js:60-75; src/ui/ModeHUD.js:119-208

### [medium] Entity ids are local and incremental, and FFA team equals entity id
addEntity assigns e.id = this._nextEntityId++ (Game.js:530-534), and the counter is never reset (measured nextEntityId 7 after a 5-bot match). FFA teams are the entity id for the player (383) and for bots (BotManager.js:140).

Online, the host must assign every networked id and send it, and peers must add entities with that id. Suggested: addEntity(e, id?), bumping _nextEntityId past it.

getEntityById (541-543) is a linear find, which is fine at 16 entities.

pickSpawnPoint uses Math.random and canSee against every entity (558-581), so it is host-only. respawnEntity calls weapons.onPlayerSpawn only for this.player (553); a client applies its own spawn locally from the host's position and yaw.
Evidence: src/core/Game.js:529-581; src/ai/BotManager.js:132-146; flow_scenario entities ids 1..6, nextEntityId 7

### [medium] Settings persistence and per-origin storage
Settings side effects:
- _startMatch persists map, mode, bots and difficulty unless running under autotest (Game.js:398-403).
- Menu._setCfg persists every setup change (Menu.js:583-591).
A client that applies the host's config through these paths would overwrite its own solo defaults.

localStorage is per origin (key 'kinetic.settings.v1', Settings.js:3). Joiners who open http://<host-ip>:8000 get default sensitivity, FOV and name, not their localhost settings. In the two-page harness, both pages share one profile and origin, and therefore one settings key; tests should pass name= and avoid settings writes.

Settings.load accepts only keys whose typeof matches DEFAULT_SETTINGS (50), so new MP keys need typed defaults. The playerName 'applies instantly' mismatch is already in BACKLOG.
Evidence: src/core/Settings.js:3-27; src/core/Settings.js:43-75; src/core/Game.js:398-403; src/ui/Menu.js:583-591; BACKLOG.md:139-140

### [medium] A mid-match graphics quality switch stalls the main thread for over a second
settings.set('quality','low') during a match blocked synchronously for 866 ms (setQuality traverses materials and rebuilds the composer), then the next frames took 377 ms (shader recompile). Switching back to high took 13 ms plus a 132 ms frame (quality_scenario.js).

On a host this freezes the authoritative simulation for all clients; on a client it pauses its input stream. Online, disable or defer the Graphics quality control during a match for the host (for example, apply it at the next match) and warn clients. The call path is Game.js:264-266 → setQuality 657-670 → warmup 427-445.
Evidence: src/core/Game.js:264-266; src/core/Game.js:657-670; tools/out/_claude/mp-flow/quality_scenario.js -> setCallMs 866, afterLow worst 377 ms

### [high] Headless multiplayer testing is feasible, with specific requirements
two_pages.py launches one headless Chrome, creates the second page with Target.createTarget({url, newWindow:true}), serves the project with a stdlib WebSocket relay subclassing serve.Handler, and maps lan.test to 127.0.0.1 so the origin is insecure. Results:
- Both pages were visible, both reached 'playing', 0 console errors, isSecureContext=false. No secure-context-only APIs are used in src (grep found none), so LAN-IP origins work.
- FPS with the GPU shared: about 26 per page at high quality; 42 at low with 3 bots; 86 at low with 0 bots.
- Relay round-trip (2 hops through Python) with TCP_NODELAY: min 1.3 ms, p50 15.9, p95 207, max 401 at 26 fps. At low quality with 3 bots: p50 16.2, p95 45. With 0 bots: p50 9.3, p95 24.4.
- Without TCP_NODELAY: p50 38.6, p95 404.8, max 883.4. The server must set TCP_NODELAY.
- The relay adds under 1 ms; latency is dominated by the frame boundary on each hop (onmessage runs between frames).
- The 101 status line must be HTTP/1.1; SimpleHTTPRequestHandler defaults to HTTP/1.0, so the prototype sets protocol_version per request.
- BroadcastChannel between the two pages works and could serve as a server-free loopback transport for protocol unit tests.
- A background-tab second page does not work (see the rAF finding).
Evidence: tools/out/_claude/mp-flow/two_pages.py; run: --nodelay 1 --window 1 -> fps 25.9/25.7, rtt p50 15.9 p95 207.1, secure:false, errors 0; run: --nodelay 0 -> p50 38.6 p95 404.8 max 883.4; run: --quality low -> fps 41.4/42.5, p50 16.2 p95 45.1; run: --quality low --bots 0 -> fps 87.3/84.8, p50 9.3 p95 24.4; run: --window 0 -> hidden page never left 'loading'

### [medium] Server is localhost-only; LAN-IP detection with the stdlib works
make_server binds '127.0.0.1' (serve.py:52), so LAN clients cannot connect. The harness imports serve_in_background (run.py:38, 332), so a relay added to serve.Handler is available to tests with no extra plumbing, and tests keep binding 127.0.0.1.

LAN IP: socket.gethostbyname_ex(gethostname()) and the UDP-connect route trick both returned 172.20.5.157 on this machine without opening a listener. Machines with VPN, WSL or Hyper-V adapters will have several addresses, so list all non-loopback IPv4 addresses and highlight the default-route one.

Binding 0.0.0.0 was deliberately not tested, to avoid a Windows Firewall prompt on this machine. On first bind Windows asks to allow python.exe, and 'Public' network profiles block inbound connections.

SimpleHTTPRequestHandler serves directory listings of the whole fps/ tree (tools/, docs), so keep LAN binding opt-in.

play.bat always runs a localhost server and opens localhost.
Evidence: tools/serve.py:43-60; tools/run.py:38; tools/run.py:332-333; play.bat:1-13; python stdlib probe -> gethostbyname_ex ['172.20.5.157'], udp-route 172.20.5.157

### [medium] Load-time numbers for sizing the loading barrier and the lobby
Measured on this machine (GPU, headless):
- boot to main menu: 16.3-20.7 s (texture generation);
- autotest boot to 'playing': 24.7 s;
- startMatch from the menu on the same map as the backdrop (world.reset path): 1.86 s;
- startMatch on a different map: 3.83 s.

Implications:
- A barrier timeout of about 30-45 s is safe.
- Preloading the lobby's selected map as every client's menu backdrop (Game._updateMenu already orbits world.def.previewCamera) makes Start about 2 s for everyone.
- Joiners who open the host URL pay the full 16-21 s first boot before they see the Join screen.
Evidence: menu_main run -> boot 16316 ms; flow_scenario -> bootToPlayingMs 24693; startMatch runs -> foundry 1856 ms, skyline 3832 ms; src/core/Game.js:351-356; src/core/Game.js:788-811

### [medium] AutoTest cannot drive a multiplayer run as-is
Current behavior:
- AutoTest.start calls g.startMatch directly with URL params (94-102).
- Its clock and done flag only advance inside Game.update (Game.js:770 → AutoTest.js:112-146). Once the end screen is up, update stops and the report never finishes; the scratch scenario needed its own rAF watcher and window.__FLOW__.
- finish() reports g.bots.list only (206-216).
- run.py drives a single page (launch_chrome 195-224).

Multiplayer needs:
- params net=host|join&room=CODE&name=&players=N&team=;
- the host waits for N humans, then starts;
- report.net {role, clientId, rtt, msgs, reconnects};
- all entities in the report;
- a done condition not tied to Game.update;
- a runner that opens N windows (newWindow:true), defaults to quality=low, waits for every page's __TEST__.done, merges reports, and fails on any page's console error.
Evidence: src/core/AutoTest.js:63-146; src/core/AutoTest.js:204-237; src/core/Game.js:288-292; src/core/Game.js:768-771; tools/run.py:195-224

### [low] Other isPlayer and single-player couplings outside the flow files (for the sim/netcode owner)
- Modes._setTier forwards the escalation weapon only to entity.isPlayer, otherwise to entity.setEscalationWeapon (Modes.js:82). A remote-human class on the host must implement it and forward it to its client.
- GrenadeTypes inventory lookup (GrenadeTypes.js:64) and the vortex ground-pull boost (228) are keyed on isPlayer.
- Effects.hitSpark skips sparks on isPlayer (Effects.js:453).
- BotManager._separate pushes bots away from game.player only (BotManager.js:234-244).
- Storm lightning damage runs whenever game.state === 'playing' (Storm.js:333) and pickups are resolved in world.update. Both must be host-only.

Recommendation: keep isPlayer meaning 'the local player' to avoid touching about 90 references, and add isHuman (local or remote) and isRemote.
Evidence: src/core/Modes.js:79-88; src/weapons/GrenadeTypes.js:64; src/weapons/GrenadeTypes.js:228; src/fx/Effects.js:453; src/ai/BotManager.js:234-244; src/world/Storm.js:333

## Recommendations
### User-facing flow spec (Host / Join / Lobby / Match / End / edge cases)
**Main menu:** PLAY (solo, unchanged setup), MULTIPLAYER (new), QUICK PLAY, SETTINGS, CONTROLS. Deep link http://<host-ip>:8000/?join=KXQV opens Join with the code filled in.

**MULTIPLAYER hub:** a name field (settings.playerName, required) and two cards. HOST A GAME: 'Your PC runs the match; friends on your network join with a code'. JOIN A GAME: a 4-letter code box. If the page was served by a host with exactly one open room, list it ('Caleb's game · Foundry FFA · 2/8') so no typing is needed.

**HOST SETUP:** the existing Match setup screen in host mode, with the options panel made scrollable or split into tabs (Rules | Bots | Loadout). Added options: Max players (2-8 humans, 16 entities total), Bots fill (count and difficulty, arsenal), Spawn loadout (request #2), Late join on/off, Teams (auto-balance / free choice). Footer: Back / CREATE ROOM.

**LOBBY (host):**
- Header: big room code 'KXQV', plus 'Join at http://172.20.5.157:8000' (all LAN URLs from /mp/info) with Copy link. The host is on localhost, a secure context, so the clipboard works.
- Left: match card (map art, mode, limits, loadout summary) with Edit (reopens host setup; changes broadcast live).
- Right: player list for FFA, or Blue/Red columns for team modes. Each row: color chip, name, HOST crown, READY check, ping ms; per-team '+N bots'. Host actions: move to other team, kick, shuffle.
- Footer: Leave room / START MATCH, labelled '3/4 ready'; the host may force start.

**LOBBY (client):** the same view read-only, with Switch team (if allowed, no stacking), READY toggle and Leave. Status line: 'Waiting for host'.

**START:**
1. Every peer shows the loading overlay 'Loading Foundry', then 'Waiting for players 2/3 — Sam 62%'.
2. The host waits for 'loaded' acks, with a timeout of about 30-45 s; stragglers become late joiners.
3. The host spawns everyone and sends the roster.
4. A 3-2-1 countdown on the HUD, with players frozen and damage off. Clients see 'CLICK TO PLAY' until pointer lock is acquired.
5. 'FIGHT'.

**MATCH:** Esc, P or a hidden tab opens the MATCH MENU, which does not pause and shows 'The match keeps running'. Buttons: Resume (a click, which relocks), Settings (Graphics quality disabled for the host mid-match), Controls, Leave match (confirm). The host also gets End match for all / Back to lobby. The scoreboard gains ping, a host crown, and a bot icon only on bots.

**END:** the VICTORY/DEFEAT banner (per-client perspective from the host's winnerId/winnerTeam), then the end screen after about 2.2 s. Host: REMATCH (same config; everyone reloads on the fast world.reset path), BACK TO LOBBY, END ROOM. Clients: 'Waiting for host…' and LEAVE ROOM, then they follow the host's choice automatically. Back to lobby keeps the world as the backdrop and resets ready flags.

**LATE JOIN:** the Join screen shows 'Match in progress · Foundry · 6:12 left'.
- With late join on: JOIN MATCH, load, then the host assigns a team (fewest humans, replacing a bot from that team if bots are filling), sends a full snapshot (entities with ids/names/colors/teams/K-D/tier/alive/respawn-in, timeLeft, teamScores, koth/ladder, pickups, first-blood flag), and spawns the player with spawn protection. Everyone's feed shows 'Sam joined'.
- With late join off: the player waits in the lobby ('You'll join the next match').

**DISCONNECT / RECONNECT:**
- Client side: 'CONNECTION LOST — reconnecting (2/5)', world frozen, input off. It retries for about 30 s with a token (sessionStorage 'kinetic.mp.<code>.token', which also survives a page reload). The host restores the same entity (id, K/D, team) and resends the snapshot.
- Host side: the feed shows 'Sam lost connection', the body despawns, and the scoreboard row greys out '(reconnecting)'. After the grace period: 'Sam left' (keep the row in results).

**HOST LEAVING:** the server sees the host socket close and broadcasts roomClosed{reason:'host-left'}. Clients show 'The host ended the game' and return to the MP hub. Optionally the server keeps the lobby about 30 s for a host reload; the match itself is lost.

**TEAMS (TDM/KOTH):** auto-balance on join (fewest humans, tie → fewest total). Switching is allowed only if it does not make the other team larger. Bots fill so team totals are equal; an odd bot goes to the team with fewer humans.

**NAMES / COLORS:** the host sanitizes names (trim, strip control characters, max 16, non-empty) and dedupes them against humans and BOT_NAMES ('Caleb 2'). In FFA the host assigns each human a unique color from a human palette distinct from BOT_COLORS (at least 16 colors total). Team modes use team colors.

**KILL FEED:** remote names and colors come from the entity objects. Add system lines for joined/left/disconnected/switched team. Own kills stay highlighted with attacker === game.player.
Files: src/ui/Menu.js, src/ui/HUD.js, src/ui/Scoreboard.js, src/core/Game.js, style.css, src/ui/Icons.js, src/ui/dom.js

### Session layer and roles; offline as 'authority with zero peers'
Add game.net (new src/net/Session.js plus src/net/Protocol.js holding PROTOCOL_VERSION and message types):
- role: 'offline' | 'host' | 'client';
- phase: 'offline' | 'connecting' | 'lobby' | 'loading' | 'countdown' | 'playing' | 'ended';
- room {code, you, hostId, players[{id, name, team, color, ready, loaded, ping, isHost, connected}], config, urls};
- API: host(config), join(code, name), leave(), setConfig(), setTeam(), setReady(), start(), kick(), send(to, type, payload).
It emits 'net:status', 'net:lobby', 'net:player' on game.events.

Game gains isOnline and isAuthority (= role !== 'client'), and all rule code gates on isAuthority. Keep isPlayer meaning 'local player'; add isHuman and isRemote.

Lobby state (names, teams, ready, config) lives in the host page and is broadcast by the host. Python only allocates codes, tracks membership and relays.

Lobby and lifecycle messages:
- hello {v, build, name, token?} → welcome {clientId, token} or reject {reason: version|full|not-found|kicked|in-progress};
- create {config};
- join {code, name, token?};
- lobby {room};
- setTeam, setReady, setConfig, kick;
- load {epoch, config};
- loaded {epoch, progress};
- begin {epoch, roster, countdown};
- matchEnd {epoch, reason, winnerId, winnerTeam, results};
- toLobby, rematch;
- playerLeft {id, reason}, roomClosed {reason};
- ping / pong.
Every in-match message carries epoch, so stale messages from a previous load are dropped (Game already guards re-entry with _starting at 319-325).
Files: src/core/Game.js, src/net/Session.js (new), src/net/Protocol.js (new), src/main.js, ARCHITECTURE.md

### Split the Game match lifecycle and gate authority
New lifecycle:
- Keep startMatch(options) as the offline and autotest wrapper.
- loadMatch(cfg, epoch): runs on all peers. Covers world load/reset, bots.prepare and warmup, with progress fed to net. Use a hidden-safe yield instead of the rAF-only nextFrame (utils.js:127) during MP loads.
- beginMatch(roster): the host creates humans (local plus RemotePlayer entities) and bots with host-assigned ids (addEntity(e, id)), teams and colors, then respawns everyone. Clients build the same entities from the roster.
- A countdown phase (match.phase 'countdown' | 'live' | 'over'); damage is off until live.
- applyMatchEnd(payload) on clients.
- returnToLobby(): _clearMatch plus player.reset(), weapons._resetState() and audio.stopAllLoops(). This also fixes the BACKLOG quit-to-menu leftovers.

New match fields: epoch, roomCode, humans, loadout, lateJoin, phase, winnerId. playerWon is computed locally.

Host-only work: pickSpawnPoint, _onDeath scoring (use !isBot for the player respawn delay), _checkScoreLimit (end after the death broadcast), _updateMatch (timer, kill plane, respawns), modes.update, bots.update, pickups, Storm strikes.

getScoreboard rows add isLocal, isBot, isHuman, ping, host, connected. The host decides FFA ties (draw or deterministic tiebreak) and the results order.

Do not persist host config into client settings (Game.js:398-403).
Files: src/core/Game.js, src/ai/BotManager.js, src/core/Modes.js, src/player/Player.js, src/core/constants.js

### Replace pause with a match menu online; make hit-stop and end slow-mo local; harden the host loop
**Match menu:** online, route lock-loss, Esc/P and visibilitychange (Game.js:245-277) to openMatchMenu(): state stays 'playing', input.enabled=false, capture=false, clearAll(), menu.showMatchMenu(). Resume is a click that calls requestLock. Offline pause is unchanged. Optional host-controlled 'pause for everyone' only if the user wants it.

**Hit-stop:** implement Game.hitStop(scale, s). Offline it keeps today's global behavior; online it is presentation-only (camera, viewmodel, audio pitch, effects) or a no-op. WeaponSystem already calls g.hitStop when present (WeaponSystem.js:1582).

**End of match online:** do not set timeScale (Combat already blocks damage when match.over). Keep a 2.2 s outro timer for the banner and expose a public game.outro flag for Audio.js:1537 instead of the private _endTimer.

**Host loop:** use a fixed-step authority tick (for example 60 Hz, bounded catch-up) instead of dt dilation for the online host (measured: 1.36 s real → 0.5 s sim under long frames). Add a fallback scheduler when document.hidden (Worker-posted ticks; verify throttling behavior in headed Chrome). Show the host a 'keep this tab visible' warning. Disable or defer the Graphics quality change mid-match for the host (measured 866 ms + 377 ms stall).
Files: src/core/Game.js, src/ui/Menu.js, src/weapons/WeaponSystem.js, src/core/Audio.js

### Menu screens and texts for multiplayer
New screens:
- _mpHTML: hub with name field and Host/Join cards.
- _lobbyHTML: code, URLs with copy and deep link, match card with Edit, player list or team columns with ready/ping/host/kick/switch, footer Start/Ready/Leave. Fill it on 'net:lobby' without clobbering a focused input.
- _joinHTML: name, a 4-letter code (auto-uppercase), and error states: not found / full / in progress / version mismatch / renamed / cannot connect (firewall hint).

Existing screens:
- Setup screen in host mode: scrollable .setup-opts (style.css:572), MP options, and 'Create room' / 'Apply' in the footer.
- Pause screen: an MP variant 'Match menu' with no Restart for clients, host End match / Back to lobby, and pz-info showing the room code and humans+bots.
- End screen: MP variant — host Rematch / Back to lobby / End room; clients 'Waiting for host' / Leave room.
- Loading overlay: barrier text 'Waiting for players 2/3'.

Text fixes:
- Mode descriptions without 'you are Blue' (209, 211).
- Bots note counts humans (624-628).
- _fillEnd uses me = rows.find(r => r.isLocal), the local player's team name instead of TEAM_BLUE (799), and 'N PLAYERS · M BOTS' (786).

_origin must support 'lobby' and 'mpmenu' so Settings and Controls return to the right screen. Keydown: Enter submits Join and toggles Ready; Esc in the lobby does nothing (or asks to confirm leaving).
Files: src/ui/Menu.js, style.css, src/ui/Icons.js, src/ui/dom.js

### HUD, ModeHUD and Scoreboard changes
HUD:
- Countdown and a prominent CLICK TO PLAY gate; announce 'FIGHT' at the end of the countdown instead of onMatchStart (HUD.js:266).
- Network status under the map info: ping, 'CONNECTION INTERRUPTED' after 1 s without host messages, 'RECONNECTING'.
- Nameplates for remote humans (pooled projected DOM like ModeHUD._marker), for enemies in view and teammates in team modes.
- Kill-feed system lines (joined / left / disconnected / team switch).
- Respawn and shield countdowns from host-sent durations or a clock offset (927-931, 766). The elapsed clock comes from the host's match time (819).
- Killer health from the death payload (349).
- Seed _firstBlood, _leaderId and _matchPoint from the join snapshot.
- Fix the double-escaped names in announce() (431, 884).

ModeHUD: consume the replicated m.koth and m.ladder, and the forwarded esc:* / hill:* events.

Scoreboard: use isLocal for the 'me' row, show the bot icon only when isBot, add ping and host crown columns and a disconnected style, and include them in scoreboardSignature.

Event contract the netcode layer must re-emit on clients with resolved entity references:
- damage (local attacker or target), death (all), spawn (local), pickup (local), reflect (local), match:end;
- esc:tier, esc:final, hill:move, hill:relocate, hill:preview, hill:capture, hill:contested, hill:score;
- weapon:fire and explosion for remote FX and audio.
Files: src/ui/HUD.js, src/ui/ModeHUD.js, src/ui/Scoreboard.js, style.css

### Server: opt-in LAN bind, /mp relay and room registry, /mp/info; host launcher
serve.py:
- --lan binds 0.0.0.0 (the default stays 127.0.0.1) and prints every non-loopback IPv4 URL (gethostbyname_ex plus the UDP-route trick, both verified).
- Handler.do_GET upgrades /mp to WebSocket, following the verified prototype in two_pages.py:
  - HTTP/1.1 101 status line;
  - TCP_NODELAY (measured p50 38.6 → 15.9 ms, p95 405 → 207 ms);
  - a per-connection send lock;
  - masked-frame parsing, ping/pong;
  - a size limit;
  - heartbeat timeout of about 15 s.
- Room registry: 4-letter codes from 'BCDFGHJKLMNPQRSTVWXZ', a host connection, clients {id, name, token, conn}, 'to' routing (host | all | id), join and leave notifications, and roomClosed when the host drops.
- /mp/info JSON: {lan, urls, port, version, rooms}. The Host screen can then warn 'LAN hosting is off — run host.bat'.

Launchers: add host.bat (or a play.bat prompt) that runs serve.py 8000 --lan and prints 'Friends join at http://<ip>:8000 (allow Python through Windows Firewall; set the network to Private)'.

Phase 2 (Jackbox-like, keeps each player's settings): each player runs their own play.bat. The local server resolves a room code through LAN UDP broadcast discovery, and the page opens a cross-origin WebSocket to the host (WebSocket is not subject to CORS; validate Origin). The handshake carries a build or protocol hash so version mismatches are rejected.
Files: tools/serve.py, play.bat, host.bat (new), index.html

### Multiplayer harness
AutoTest:
- params net=host|join, room=TEST (the host requests a fixed code), name=, players=N (the host auto-starts when N humans have joined), team=;
- report.net {role, clientId, rtt p50/p95, msgs in/out, reconnects};
- report all entities with isBot/isHuman;
- a done flag that does not depend on Game.update running (the end screen stops update).

New tools/run_mp.py (reusing run.py's CDP helpers and serve_in_background, which will include the relay):
- one Chrome;
- each page created with Target.createTarget({url, newWindow:true}) — required, because a background tab never runs rAF;
- setDeviceMetricsOverride per page;
- quality=low by default (about 42 fps per page with 3 bots vs about 26 at high);
- waits for every page's __TEST__.done, merges and prints the reports, takes screenshots per page, and exits 1 on any page's console error.
Pages share localStorage in one profile, so use URL params rather than settings.

Optionally, a BroadcastChannel loopback transport (verified working between the pages) for protocol unit tests without the server.
Files: src/core/AutoTest.js, tools/run_mp.py (new), tools/run.py, ARCHITECTURE.md

### Settings additions and per-origin mitigation
New keys with typed defaults: mpMaxPlayers (8), mpLateJoin (true), mpTeams ('auto'), mpLastCode (''), mpLastHost (''). Keep the reconnect token in sessionStorage per room.

The spawn-loadout config (request #2) should be a sanitized object, like botArsenal, and included in the MP config broadcast. It applies through Modes.loadoutFor and WeaponSystem.onPlayerSpawn (WeaponSystem.js:579-606).

Clients never write the host's match config to their own settings.

Optional: a 'settings code' export/import so joiners on the host's origin can bring sensitivity, FOV and name (localStorage is per origin).
Files: src/core/Settings.js, src/ui/Menu.js, src/core/Game.js

### Preload the lobby map to make Start fast
When the host picks or changes the map in the lobby (debounced about 2 s), every peer loads it as the menu backdrop with a small inline 'Preparing Skyline…' indicator instead of the full-screen overlay. Start then takes the world.reset fast path: measured 1.86 s vs 3.83 s for a different map. Clients report preload progress in the lobby rows.
Files: src/core/Game.js, src/ui/Menu.js

## Risks
- The host's browser tab is the authority. Minimizing it or switching tabs stops rAF: verified headless, a hidden page never ran a frame. Chrome also throttles background timers (known behavior, not measured here). Every client's match freezes unless a hidden-tab fallback tick is built; that the Worker-timer fallback avoids throttling is unverified.
- Any host main-thread stall hitches all players: shader compiles, a quality switch (measured 866 ms blocking call plus a 377 ms frame), GC, and first-use effects. BACKLOG notes 200-700 ms gaps early in a match.
- Joiners who open the host's LAN URL are on a different origin, so their localStorage settings (sensitivity, FOV, name) do not carry over. The two-page harness pages share one settings key.
- Windows Firewall prompts on the first 0.0.0.0 bind of python.exe, and 'Public' network profiles block inbound connections. Guest or hotel Wi-Fi often isolates clients, which also breaks Phase-2 UDP discovery.
- Binding the LAN exposes SimpleHTTPRequestHandler directory listings of the whole fps/ tree (tools/, docs, scratch output). Keep it opt-in.
- Pointer lock cannot be granted from network events (Input.js:184-185), and Esc never grants activation. Without an explicit click-to-play gate, clients start unable to aim.
- Without TCP_NODELAY on server sockets, Nagle plus delayed ACK caused p95 405 ms and max 883 ms relay round-trips (measured).
- Latency is dominated by page frame time because messages are handled between frames (measured p50 9-16 ms on localhost). Drain the network queue once per frame and send right after the sim step.
- FFA ties and results order depend on each peer's entity order. Unless the host sends winnerId and results, every peer can crown itself (measured: a 0-0 FFA gives 'Victory' for the local player).
- endMatch fires inside the 'death' listener. If the host replicates that order, clients show the winning-kill callout over the VICTORY banner (existing BACKLOG bug).
- Late joiners' HUD flags (FIRST BLOOD, lead, match point) and host-clock times (respawnAt, spawnProtectedUntil, m.startTime) will be wrong unless they are seeded from the snapshot or converted.
- In the headless harness both pages share one GPU: about 26 fps each at high quality. Use quality=low for MP tests, and do not read harness fps as production numbers.
- Version mismatch between host and joiners becomes possible once players run their own copies (Phase 2 join-by-code). A protocol or build hash check is needed.
- Scope creep: remote-human entities, prediction and snapshot design belong to the sim/netcode work. The flow and UI plan above depends on that layer exposing isHuman, isRemote, clientId, ping and connected, and re-emitting the listed events with resolved entity references.

## Open questions
- Joining model for LAN phase 1: (A) friends open the host's URL (http://<host-ip>:8000, or the ?join=CODE deep link) and type the room code. This is simplest, but their saved settings do not carry over. (B) Everyone runs their own play.bat and joins by code through LAN discovery, Jackbox-style. This keeps settings but needs the same game version plus firewall and UDP setup. Is A-then-B the right order?
- For play beyond the LAN (the 'Kahoot/Jackbox code' idea): is port-forwarding on the host's router or a VPN like Tailscale or ZeroTier acceptable? Those work with design A unchanged. Or should a relay or rendezvous service be built, which cannot live only on the host's PC?
- Should the host be able to pause the match for everyone? This is technically easy with a host-authoritative design. Or is there no pause at all in multiplayer?
- When the host leaves: end the match for everyone and return them to the menu (simple), or keep the lobby alive for about 30 s so the host can reload? The match in progress is lost either way.
- Late join: on by default? Should a late joiner replace a filler bot on their team, and should bots fill empty slots in multiplayer at all?
- Teams in TDM/KOTH: auto-balance only, or may players pick their team (with anti-stacking)? Maximum number of human players: 8 is suggested, with 16 total fighters including bots.
- Is it acceptable that the host plays from the same browser tab that runs the match, which must stay visible? Or would the user rather run a separate 'dedicated host' window (for example a spectate page) on the host PC for robustness?