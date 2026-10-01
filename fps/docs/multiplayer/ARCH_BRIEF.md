# KINETIC multiplayer — architecture decisions (orchestrator brief)

Status: DECIDED unless marked open. The contract document must implement these decisions concretely
against the real code; it may challenge a decision only with code evidence and a better alternative.

## Context
- User request: "multiplayer, at first over LAN, then maybe a code based system like Kahoot or Jackbox hosted on the host's PC".
- Wave 1 (being built in parallel right now, merged before multiplayer work starts):
  - `netinfra`: `tools/netserver.py` stdlib WebSocket relay on the static server's port (`/ws`, `/api/lan`, `/api/rooms`),
    4-letter room codes (BCDFGHJKLMNPQRSTVWXZ), host = peer 0, clients 1..254, JSON control plane
    (host/join/leave/kick/lock/meta/list/ping/signal -> hosted/joined/peer-join/peer-leave/room-closed/rooms/pong/error),
    binary data plane (byte0 routing: client->host rewritten to sender id; host -> 1..254 or 255 = all; byte1 = type;
    types >= 0x80 are latest-wins), reconnect tokens, `--lan` bind + `host-lan.bat`; browser `src/net/Transport.js`,
    `src/net/WsRelayTransport.js` (host/join/leave/kick/lock/meta/list, sendToHost/sendTo/broadcast(u8), sendControl(obj),
    callbacks for binary/control/peer join/leave/close), `src/net/protocol.js` (PROTOCOL_VERSION, type constants,
    DataView writer/reader helpers, quantization); `tools/run_mp.py` multi-page headless harness (each page its own window).
  - `loadout`: `src/weapons/Loadout.js` — match POOL {weapons, slots, ammo, grenades} in the match config (host rule, JSON);
    per-player pick in settings `playerLoadout` {weapons, primary}; `resolveLoadout(pool, pick)`;
    `WeaponSystem.onPlayerSpawn(loadout?)` accepts an explicit resolved loadout; `Modes.loadoutFor` uses `!isBot`.
  - `input`: ordered per-frame input event log, actionActive/latestPressed/wheel steps, stale-press policy, aim from this frame's view.
  - `render`: always-composer pipeline, quality presets with pixel budgets + render scale, fence frames-in-flight limiter (`lowLatency`).
  - `hitches`: warmup prewarms programs/models/effects, time-sliced A*, bot shadow proxies, HUD pre-raster.
  - `crosshair`: `src/ui/Crosshair.js`, xh* settings, per-weapon ADS hide/fade/show, crosshair share code.

## Decisions
1. **Topology: listen server.** The host player's browser tab runs the authoritative game (world, bots, projectiles, combat,
   modes, pickups, storm). The Python relay only serves files, allocates room codes and routes packets. Friends open
   `http://HOST-IP:8000` (host runs `host-lan.bat`) and join by room code, by a one-click list of open rooms on that server,
   or by a `?join=CODE` / `#join=CODE` link. Offline single player = "authority with zero peers" and must behave exactly as today.
2. **Movement is client-authoritative for each human's own body.** Each client runs its own Player/PlayerController/Grapple
   locally exactly as in single player (zero input latency, no reconciliation corrections, identical feel) and streams its state
   to the host at 60 Hz. The host trusts it with light sanity checks (friends-on-LAN trust model). Rationale: the investigation
   found the movement stack chaotic (a one-tick divergence flipped grapple outcomes by 13 m; late impulses caused 4-10 m errors
   under reconciliation), and the user is highly sensitive to input feel. The command-stream + reconciliation design from
   mp-netcode-feel.md stays documented as the phase-2 upgrade path (anti-cheat / internet), so keep interfaces compatible.
3. **Everything else is host-authoritative**: health, armor, alive, deaths, kills/score, respawn timing and spawn points, spawn
   protection, pickups, projectiles and explosions, bots, modes (FFA/TDM/KOTH/Escalation), storm, match timer and end.
4. **Hits are detected on the shooter's machine against what it sees ("favor the shooter")** for hitscan (pistol, rifle, shotgun
   pellets, sniper, smg), melee, the Tempest (arc) beam + chain, and the Javelin (rail) pierce. Mechanism: on a client,
   `Combat.applyDamage` with `attacker === game.player` does not mutate anything and instead sends a damage CLAIM
   {targetId, amount, weapon, headshot, point, direction, knockback, ...} to the host; the host validates (both alive, target
   not protected, plausible distance vs the target's recent position history, range, rate limits) and applies it with
   `attacker = RemotePlayer`. All other client-side mutations are gated by an authority flag.
5. **Host executes projectile and blast actions from client action messages**: rockets, frag + special grenades (incl. cook time
   and in-hand explosions), and Gale blasts (shove + projectile reflection) are spawned/run by the host from the client's
   origin/direction/velocity/fuse. The shooter's client shows a predicted visual copy immediately (rocket/grenade) keyed by
   (clientId, seq) and adopts the host's copy when it arrives.
6. **Forces on remote humans** computed by the host (explosions, Gale shoves, Vortex pull, Kinetic, knockback, storm, pad-free
   launches) are forwarded to the owning client as impulse / launch / shock messages applied on receipt. Jump pads and all
   self-caused movement run locally on each client for its own player (the host never launches a RemotePlayer via pads).
   Self-knockback from the client's own rocket may be predicted locally if it can be done without double application.
7. **Entities & ids.** Host: local Player + Bots + one `RemotePlayer` per remote human. Client: local Player + one proxy
   (`NetAvatar`) for every other entity (host's player, bots, other humans). Ids are assigned by the host and used everywhere.
   Proxies render with BotModel (recoloured, name tag) driven by replicated state (velocity -> walk/run, onGround, crouch,
   aim pitch, firing, reload, alive); remote humans on the host are smoothed with a small delay and hit-tested at the rendered
   position ("what you see is what you hit" for the host player too).
8. **Replication.** Host -> client snapshots (binary, 30 Hz default, 60 Hz LAN option; latest-wins packet type) with all entities,
   projectiles, pickups availability and match state, plus the recipient's own block (health, armor, alive, protection, shock).
   Client -> host state packets (binary, 60 Hz): pos/vel/yaw/pitch/height/movement flags/weapon/ADS/firing/beaming + beam end/
   charging + charge/grapple anchor/inventory summary. Reliable JSON events both ways for everything discrete (roster, spawn,
   death, damage, claims, actions, pickups/grants, impulses, match start/end, mode events). Clients convert host timestamps
   (respawnAt, spawnProtectedUntil, shockedUntil, pickup respawns, timers) to their own clock via an offset estimate.
   Clients interpolate proxies ~2-2.5 snapshot intervals behind with velocity (Hermite); no extrapolation beyond one interval;
   snap on teleport/spawn.
9. **Presentation mirroring.** The host captures positional effects and positional audio produced by its simulation (bots, host
   player, projectiles, explosions, storm, modes) and broadcasts them; each client captures the effects/positional audio produced
   by its own local weapons and sends them to the host, which renders them and rebroadcasts to the others. Continuous visuals
   (beams, grapple ropes, projectile trails, charge glows) are derived from replicated state instead of mirrored per frame.
   Local-only feedback (camera shake, viewmodel, non-positional sounds, hit markers) is never mirrored.
10. **Flow.** Main menu gets MULTIPLAYER (Host / Join). Host setup = match setup (map, mode, bots, limits, bot arsenal, weapon
    pool) + lobby (big room code, LAN URL(s), player list / team columns, ready, kick, start). Start -> every peer loads the map
    (barrier with timeout) -> host spawns everyone -> short countdown with a CLICK TO PLAY pointer-lock gate -> fight. Late join
    supported. End -> results -> host picks Rematch / Back to lobby; clients follow. Host leaving closes the room.
11. **No pause online.** Esc / pointer-lock loss / hidden tab opens a non-pausing match menu. The host keeps simulating while its
    tab is hidden (Worker-driven clock, render skipped). `timeScale` effects (Javelin hit-stop, end-of-match slow motion) become
    local presentation only (never global) online.
12. **Loadouts.** The host's POOL travels in the match config; each player resolves its own `playerLoadout` against it locally
    and can change it between lives (Esc menu / lobby). Bots keep the Bot arsenal.
13. **Scale.** Up to 8 humans, 16 fighters total incl. bots; bots fill; TDM/KOTH auto-balance humans with bots filling gaps.
14. **Testability.** Every step must be testable headlessly: `tools/run_mp.py` with host + N client pages, AutoTest MP params
    (e.g. net=host|join, room=TEST, players=N), scripted scenarios, per-page reports, 0 console errors.
15. **Single player must not regress** (same autotest metrics, same feel). Offline code paths stay as they are.

## Open (contract should propose defaults)
- Snapshot rate default (30 vs 60 Hz) and interpolation delay on Wi-Fi.
- Reconnect grace period and slot reservation.
- Whether remote humans' splat (Gale wall-splat) damage is host-approximated or client-reported in phase 1.
