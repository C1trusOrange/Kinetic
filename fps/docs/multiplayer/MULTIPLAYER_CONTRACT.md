# KINETIC Multiplayer — Implementation Contract (FINAL, wave 2)

Status: FINAL. Supersedes `MULTIPLAYER_CONTRACT.draft.md`. Binding inputs: `scratchpad/mp/ARCH_BRIEF.md` (decisions 1–15) and the
investigation reports `mp-sim-surface.md`, `mp-netcode-feel.md`, `mp-network.md`, `mp-flow-ui.md`, `loadout.md`, `crosshair-ads.md`,
`perf-profile.md`. Every critique of the draft was checked against the code; Appendix C maps each one to its fix, Appendix D lists the
rejected or modified ones with evidence.

All `path:line` citations are relative to `fps/` and refer to the **pre-wave-1 baseline** (commit `c0044ea`). Wave-1 names were
verified in the wave-1 worktrees (`.claude/worktrees/wf_89e90752-166-{1..6}`, WIP commits listed in Appendix A). Wave 1 is merged
before this work starts, so line numbers will have shifted: always re-locate a hook by the quoted code, not by the number.

Conventions (in addition to ARCHITECTURE.md §1): MUST / MUST NOT / SHOULD are binding. "Host" = the browser tab that created the
room (authority). "Client" = a browser tab that joined. "Offline" = no room (today's single player). `net` = `game.net`.
"Net time" = host `performance.now() − t0` in ms (every wire timestamp). Every new public API gets JSDoc. No per-frame allocations
in hot paths (codecs write into reused buffers and objects). Expected network conditions (disconnects, rejected claims, late
packets) use `console.warn` (once per cause and peer), never `console.error` (the harness fails on console errors).

---

## 1. Overview and rules

### 1.1 Architecture in one paragraph

The host's tab runs the complete game exactly as single player does today (bots, projectiles, combat, pickups, modes, storm,
match rules) plus one `RemotePlayer` entity per joined human. Every client runs its own `Player`/`PlayerController`/`Grapple`/
`WeaponSystem` locally, exactly as in single player (zero input latency, no reconciliation), streams its body state to the host at
60 Hz, detects its own hitscan/melee/arc/rail hits against what it renders and sends damage *claims* (with an immediate predicted
hit marker), and sends *actions* for rockets/grenades/cook-offs/Gale blasts which the host executes (the shooter shows predicted
copies). The host's simulation/network tick runs at ≥ 60 Hz even when its renderer is slower (Worker-driven sim frames, §7.1.1)
and streams binary snapshots (60 Hz default, per-client 30 Hz fallback on jittery links) of every entity, projectile, pickup and
mode state, plus reliable JSON events (damage, deaths, spawns, pickups, grants, forces, mode events, mirrored presentation). Clients
render every other entity, every projectile they do not own and every mirrored effect on one "entity timeline" (render time =
host time − an adaptive delay measured from real sample ages); only their own body and their own predicted projectiles live at the
present. The Python relay (wave-1 netinfra) only serves files, allocates room codes and routes packets.

### 1.2 Rules (the brief's decisions, restated as enforceable rules)

| # | Rule |
|---|---|
| R1 | **Listen server.** `net.role ∈ {'offline','host','client'}`. The host tab is authoritative. The relay never parses game packets. Joining: room code, one-click list from `/api/rooms`, or `?join=CODE` / `#join=CODE`. |
| R2 | **Own movement is client-authoritative.** Only the local `Player` instance ever runs `PlayerController`/`Grapple`. The host never simulates a remote human's movement; it applies the client's reported state after light sanity checks (§4.2). No reconciliation, no command replay in phase 1. |
| R3 | **Everything else is host-authoritative**: health, armor, alive, deaths, kills/score, respawn timing and spawn points, spawn protection, shock, pickups, projectiles, explosions, bots, modes, storm, match timer, match end. A client MUST NOT mutate any of these for any entity (including its own player) except by applying a host message. The local player's `alive` changes ONLY through `death`/`spawn` messages, never from a snapshot (§7.3). |
| R4 | **Favor the shooter.** On a client, `Combat.applyDamage` with `attacker === game.player` MUST NOT mutate anything; it queues a damage claim (§5.10) for whitelisted weapons only (`CLAIM_WEAPONS`: pistol, rifle, shotgun, sniper, smg, arc, rail, melee). All other client-side calls to `applyDamage`, `kill`, `radialDamage`, `Combat.update` are no-ops. The host validates claims and applies them with `attacker = RemotePlayer`. |
| R5 | **Host executes projectile/blast actions** (rocket, frag + special grenades incl. death drop, in-hand cook-off, Gale blast) from client action messages sent by the WeaponSystem call sites (§5.11). The shooter shows a predicted rocket/grenade immediately (keyed by `(ownerId, seq)`); predicted copies are visual-only and never enter damage, explosion or detonation code. |
| R6 | **Forces on remote humans** (knockback, launches, Kinetic, storm, Gale shoves) are computed by the host and forwarded to the owning client (`imp`/`lnch`) and applied on receipt; shock and spawn protection arrive in the snapshot's own block. **Exception (C7): the Vortex pull/lift on a human is computed by that human's own client** from the replicated vortex state; the host skips velocity writes for `simLocal === false` entities. Jump pads, Gale self-push and all self-caused movement run locally; the host MUST NOT pad-launch a `RemotePlayer`. Rocket self-knockback is predicted by the shooter from a fire-time impact point (§5.11.4); the host suppresses forwarding only when its explosion matches that point, so it is never applied twice. |
| R7 | **Entities & ids.** Host: local `Player` + `Bot`s + `RemotePlayer`s. Client: local `Player` + one `NetAvatar` per other entity. Ids are `u8` (1..254), assigned by the host per match, used on every wire. No message may create or modify, on a client, an entity whose id equals that client's own id except through the own-player paths. |
| R8 | **Replication.** Snapshots host→client binary `PKT.SNAPSHOT` (0x81, latest-wins), 60 Hz default (`mpSnapHz` 60/30; per-client fallback to 30 Hz on arrival jitter). Client→host state binary `PKT.CSTATE` (0x82, latest-wins, added to wave-1 `protocol.js`), 60 Hz. Reliable JSON batches `PKT.JSON` (0x10) both ways for everything discrete. App ping/pong on wave-1 `PKT.PING`/`PKT.PONG`. Interpolation delay is derived from measured sample ages (§5.15); extrapolation never exceeds one sample interval; snap on teleport/spawn. |
| R9 | **Presentation mirroring** (§6): positional one-shot effects and positional one-shot audio are captured on the machine that produced them (host: its simulation; client: its own weapons) and replayed elsewhere on the entity timeline, muzzle-anchored records rebased to the shooter's avatar; continuous visuals are derived from replicated state; local-only feedback (incl. UI sounds) is never mirrored. |
| R10 | **Flow**: MULTIPLAYER hub → host setup (reuses Match setup) → lobby → load barrier (45 s timeout, host may start without stragglers after 8 s) → begin (roster, spawns) → 3 s countdown with CLICK TO PLAY gate → live → end → host chooses Rematch / Back to lobby; clients follow. Late join / straggler / rejoin spawns wait for the player's `deploy` (≤ 10 s). Host leaving closes the room; accidental host exits are guarded (§7.2.13). |
| R11 | **No pause online.** Esc / pointer-lock loss / hidden tab open a non-pausing match menu (idempotent; Menu's Esc closes it). The host keeps simulating while hidden (Worker clock, render skipped). `timeScale` is never changed online (Javelin hit-stop and end slow-mo become local presentation or no-ops). |
| R12 | **Loadouts.** The host's POOL (wave-1 `match.pool`) travels in the match config; each human resolves its own pick (wave-1 `settings.playerLoadout`) against it locally at every spawn. Only Escalation spawns carry an explicit host-resolved loadout `lo`; the host MUST NOT send `lo` in any other mode (wave-1 `Modes.loadoutFor` would resolve the HOST's pick for a `RemotePlayer`). Bots keep the Bot arsenal. |
| R13 | **Scale.** ≤ 8 humans, ≤ 16 fighters incl. bots. TDM/KOTH auto-balance humans, bots fill team gaps. |
| R14 | **Testability.** Every feature has a headless `tools/run_mp.py` scenario with numeric acceptance criteria (§9), run on loopback AND under the `wifi` impairment profile where timing matters; 0 console errors on every page. |
| R15 | **Offline invariant.** With `net.role === 'offline'` every new hook is a no-op, `FxMirror`/`HostTicker`/`NetEm` are not installed, `game.hitStop` is undefined, `Game.update` runs exactly one sub-step in today's order with today's dt and today's rAF timestamp clock, and the autotest report is unchanged (§9.5). Every `game.net` access in shared modules MUST tolerate `game.net === undefined` (viewer / stub games) and treat it as offline authority. |
| R16 | **Message ordering and gating.** The host flushes each peer's unicast batch before the broadcast batch every frame. A client processes in-match messages and snapshots only after `netBeginMatch` completed for the current epoch (`client.inMatchEpoch === net.epoch`); everything else is dropped. |
| R17 | **Staleness.** Every host-authoritative field that reaches a client both by reliable event and by snapshot carries the event's net time; a snapshot overwrites it only when `snap.tHost > fieldAt` (§7.3). |

### 1.3 Resolution of the brief's open questions

| Open question | Decision (default) |
|---|---|
| Snapshot rate / interpolation delay | **60 Hz default** (`mpSnapHz` 60/30). The host ticks sim+net at ≥ 60 Hz independently of its render rate (§7.1.1), so 60 Hz is reachable on a GPU-bound host. Per client, the host falls back to 30 Hz while that client reports arrival jitter p95 > 12 ms (back to 60 after 10 s < 8 ms). Delay = p95 of the newest sample's age at consumption + ½ interval + 2 ms, raised at once when a late gap is observed (render clock dilates, never runs backwards), decaying 10 ms/s (§5.15). Expected: LAN ≈ 35–45 ms at 60 Hz; Wi-Fi 60–120 ms. Measured costs: relay 13 % of one core at 60 Hz × 2 KB × 8 clients (mp-network); ≈ 32 KB/s per client. |
| Reconnect grace / slot | **One grace constant: 60 s** = wave-1 relay `reserve_timeout` default = `WsRelayTransport` `reconnectWindow` (the transport is constructed with it). The transport owns reconnecting (§7.2.15); the game only rebinds. The `RemotePlayer` is kept (hidden, `alive=false`, not hittable, K/D/tier/team kept), matched by `sid` and the relay token. A page reload within the grace auto-rejoins (boot 16–21 s + map load ≤ 4 s measured, well inside 60 s). After the grace the entity is removed; its row stays in `match.departed`. A silent client (frozen tab, half-open Wi-Fi) is soft-dropped by the host after 2.5 s without state (§4.2). |
| Remote humans' Gale/Kinetic splat | Host-approximated on `RemotePlayer.velocity` = latest raw reported velocity. Measured by the `arsenal` suite (splat event + damage within 250 ms of a wall hit); phase-2 fallback (client-reported splat claim) only if that check fails. |

### 1.4 Clarifications / challenges (with code evidence)

| # | Clarification | Evidence / reason |
|---|---|---|
| C1 | Client→host state uses a **latest-wins** type `PKT.CSTATE = 0x82`. Every packet is a full state; discontinuities are repeated in the teleport bit for 3 packets and also signalled by a `spawnSeq` change. | Wave-1 relay conflates latest-wins per (sender, type) (`protocol.js` header; `netserver.py` docstring), so one client's states never displace another's; conflation only happens while the host socket is backed up (host stall), where only the newest state matters. |
| C2 | Gale self-push is **predicted by the shooter** and suppressed on the host (`galeBlast(..., {selfPush:false})`). | The push is part of Gale movement (gale.js:84-95); forwarding it back would double it and add RTT. |
| C3 | `Bot.js` model code is **copied**, not refactored, into `src/net/Avatar.js` in phase 1. | Bot._updateModel/_getWeaponModel/onDeath (Bot.js:844-893, 229-244, 254-279) are bot-feel critical; zero-risk copy, dedupe later. |
| C4 | `PlayerController`, `Grapple`, `CameraRig`, `rail.updateCharge` need **no** per-entity refactor. | They only run for the local player (R2); the couplings found by mp-sim (`game.weapons.adsAmount` PlayerController.js:480,662; `game.camera` Grapple.js:419-422; rail.js:139-141) are correct for the local instance. Per-entity refactor = phase 2 (§11). |
| C5 | Game-level JSON rides the **binary data plane** (`PKT.JSON`, UTF-8 body). | The relay interprets text frames as its own control plane; peer-to-peer game messages must be routed binary frames. |
| C6 | Movement sounds of **all** avatars (bots too), incl. jump-pad launches, are derived locally, not mirrored. | `Bot._playNear` (Bot.js:535-540) culls by the *host* camera, so mirrored bot footsteps would be missing near far-away bots. |
| C7 | **Challenge to brief decision 6 (Vortex only):** a human's Vortex pull/lift is computed by its own client from the replicated vortex state; crush damage stays on the host. | `_vortexActive` caps the added pull with `maxPullSpeed − vt`, `vt` from `e.velocity` (GrenadeTypes.js:225-229). For a `RemotePlayer` that is the last *reported* velocity, which lags the forwarded impulses by a full loop (RTT + frames + one state interval), so the host keeps adding `accel·boost·dt` after the client hit the cap: ≈ 2 m/s overshoot on LAN, 6–8 m/s on a 200 ms Wi-Fi loop. Movement is client-authoritative (decision 2), so running the same formula on the owner is both simpler and exact. |
| C8 | The host's sim/net tick is decoupled from its render rate: the HostTicker Worker runs sim+net frames without render whenever rAF is slower than ~55 Hz or stalled (§7.1.1). | perf-profile: the default preset renders 18–52 fps on the user's iGPU; with a render-bound tick, snapshots, claims, hit confirmations and client-to-client relay would all be bounded by 20–55 ms frames. |

---

## 2. Module map

Package tags: **[A]** mp-core-A (session/replication/lifecycle), **[B]** mp-core-B (combat/events/mirroring/late join),
**[ars]** mp-arsenal, **[modes]** mp-modes, **[ui]** mp-ui (§10). "A→ui" = created by A, owned by ui afterwards.

### 2.1 New files

| File | Pkg | Purpose |
|---|---|---|
| `src/net/GameProtocol.js` | A (B extends) | JSON kinds, `NET` tuning constants, `CLAIM_WEAPONS`, `TWIN_SOUNDS`, weapon/grenade index tables, JSON sentinels; imports wave-1 `protocol.js` (`PKT`, helpers) and asserts no byte collision. |
| `src/net/NetSession.js` | A (B extends) | `game.net`: role/phase/status, transport adapter (the ONLY file that touches `WsRelayTransport`), lobby model, batching/dispatch, epoch, session generation, plugin install, frame hooks, `stats`. |
| `src/net/NetHost.js` | A (B extends) | Host: roster, lobby, barrier, begin builder, RemotePlayers, state intake, history, snapshots; (B) claims, event broadcast, forces, grants, late attach, deploy gate, kicks. |
| `src/net/NetClient.js` | A (B extends) | Client: welcome/lobby, load/begin, NetAvatars, snapshot decode + interpolation, own block, state packets, match clock; (B) event re-emission, claims + predicted hits, grants, forces, fall backstop, deploy. |
| `src/net/NetClock.js` | A | Host net clock, client offset (ping/pong), conversions, `InterpBuffer` (Hermite), `DelayEstimator` (§5.15). |
| `src/net/NetCodec.js` | A (B adds section 1) | Byte-exact encode/decode of client state (§5.4) and snapshots (§5.5), TLV section registry, quantization (wave-1 helpers). |
| `src/net/NetEm.js` | A | Test-only network impairment shim (latency, jitter, stalls; FIFO per direction = TCP head-of-line), installed only when `?netem=` is present (§9.1). |
| `src/net/NetEvents.js` | B | Registry `{name → toWire/apply}` for game-event replication, id resolution (required/optional ids, departed refs). |
| `src/net/RemotePlayer.js` | A (B extends) | Host entity for a remote human (§4.2). |
| `src/net/NetAvatar.js` | A (B extends) | Client proxy entity (§4.3). |
| `src/net/Avatar.js` | A (B extends) | BotModel driver + derived presentation shared by RemotePlayer and NetAvatar (§4.4); decorator registry. |
| `src/net/AvatarRope.js` | A | Lightweight grapple rope + claw for avatars (no `Grapple.js` change). |
| `src/net/FxMirror.js` | B | Presentation capture/replay (§6). Installed only while online. |
| `src/net/HostTicker.js` | A | Worker-driven tick: hidden tab, rAF stalls, host tick boost, hidden-safe loading yields (§7.1.1). |
| `src/net/Teams.js` | A | Team/color/name planning (`planMatch`, `planLateJoin`, `sanitizeName`, `dedupeName`). |
| `src/net/NetArsenal.js` | A stub → **ars** | `export function install(net) {}` stub created by A; mp-arsenal replaces it. |
| `src/net/NetModes.js` | A stub → **modes** | Stub by A; mp-modes replaces it. |
| `src/net/Rejoin.js` | modes | Rebind policy (`policy.onDrop/onRejoin`), client rejoin record, reload auto-rejoin, bot replacement policy. |
| `src/ui/NetMenu.js` | A minimal → **ui** | MP screens (hub, lobby) and pause/end variants; Menu.js delegates to it. |
| `src/ui/NetHud.js` | ui | Countdown, CLICK TO PLAY / DEPLOY, net status, host banner, system feed lines, predicted hit markers glue. |
| `src/ui/Nameplates.js` | ui | Pooled projected name tags over human avatars. |
| `src/ui/SettingsCode.js` | ui | Settings share code (sensitivity, invertY, FOV, viewBob, name, crosshair via wave-1 `encodeCrosshair`). |
| `tools/mp/lib.js`, `tools/mp/maps/duel.js` | A | Scenario helpers and the flat test arena (§9.1). |
| `tools/mp/scenarios/<suite>.js`, `tools/mp/checks/<suite>.py` | owner of the suite (§9.3) | Scenario + its acceptance check (plugin of `mp_check.py`). |
| `tools/mp_check.py` | A | Loads a run's merged report, runs `tools/mp/checks/<suite>.py`, budgets helpers, exit codes (0 ok, 1 fail, 2 insufficient fps). |
| `tools/mp/fakeclients.py` | B | Python load test: N masked binary WS clients speaking the game protocol (from mp-network `loadtest.py`). |

#### 2.1.1 `src/net/GameProtocol.js` [A]

```js
import { PKT as WPKT, PROTOCOL_VERSION } from './protocol.js';          // wave-1 netinfra
import { WEAPONS, WEAPON_ORDER, GRENADE_ORDER } from '../weapons/WeaponDefs.js';
export const PKT = WPKT;   // INPUT 0x01 (unused, reserved for the phase-2 command stream), PING 0x02, PONG 0x03,
                           // JSON 0x10, EVENT 0x11 (unused), SNAPSHOT 0x81, CSTATE 0x82 (added by A to protocol.js)
// load-time assertion: every PKT value distinct, CSTATE >= LATEST_WINS, JSON/PING/PONG < LATEST_WINS (throws at import)
export const NET = {
  SNAP_HZ: 60, SNAP_HZ_FALLBACK: 30, JITTER_FALLBACK_MS: 12, JITTER_RECOVER_MS: 8, STATE_HZ: 60, DEAD_STATE_HZ: 10,
  HOST_TICK_MS: 16, TICK_COALESCE_MS: 12, RAF_STALL_MS: 120, HOST_BOOST_RAF_MS: 18,
  DT_MAX: 0.25, SUB_STEP_MAX: 0.05, SUBSTEPS_MAX: 5, PLAYER_DT_MAX: 0.1,
  INTERP_MIN_MS: 16, INTERP_MAX_MS: 150, HOST_SMOOTH_MIN_MS: 8, HOST_SMOOTH_MAX_MS: 120,
  DELAY_WINDOW_MS: 2000, DELAY_MARGIN_MS: 2, DELAY_DECAY_MS_PER_S: 10, DELAY_DILATION: 0.5, TELEPORT_HOLD: 3,
  COUNTDOWN_S: 3, LOAD_TIMEOUT_S: 45, FORCE_START_AFTER_S: 8, OUTRO_S: 2.2, DEPLOY_TIMEOUT_S: 10, LATE_SPAWN_PROTECT_S: 3,
  RECONNECT_GRACE_S: 60, LAGGING_MS: 250, SOFT_DROP_MS: 2500, INTERRUPTED_MS: 1000,
  PING_FAST_HZ: 4, PING_FAST_S: 3, PING_HZ: 1, PINGS_BROADCAST_HZ: 1, NQ_HZ: 1,
  HISTORY_S: 1.0, CLAIM_REWIND_MAX_MS: 400, CLAIM_POS_TOL_M: 0.75, CLAIM_TRADE_MS: 30, CLAIM_LATE_MS: 1000,
  ACTION_ORIGIN_TOL_M: 2.5, ACTION_ORIGIN_VEL_K: 0.1, ACTION_BURST: 2, DEATH_DROP_MS: 500,
  PRED_TIMEOUT_S: 1.0, PRED_KNOCK_MATCH_M: 1.0, ADOPT_DIR_DEG: 2, ADOPT_POS_M: 1.5, GRENADE_BLEND_S: 0.15,
  IMPLIED_SPEED_K: 1.5, IMPLIED_SPEED_ADD: 15, IMPLIED_SPEED_CAP: 120, FALL_BACKSTOP_S: 1.5,
  MAX_HUMANS: 8, MAX_FIGHTERS: 16, SCORE_KEYFRAME: 8,
  NEVER: -1,   // JSON sentinel for Infinity / "none" (timeLeft, pickup nextRespawn, respawnAt); JSON.stringify(Infinity) === 'null'
};
export const CLAIM_WEAPONS = new Set(['pistol', 'rifle', 'shotgun', 'sniper', 'smg', 'arc', 'rail', 'melee']);
export const TWIN_SOUNDS = new Set([...WEAPON_ORDER.map(id => WEAPONS[id].sound), 'dry_fire', 'reload_start',
  'reload_insert', 'reload_end', 'pump', 'bolt', 'weapon_switch', 'melee_swing', 'melee_hit', 'grenade_pin',
  'charge_arm', 'grenade_throw', 'arc_end', 'rail_ready']);        // the only non-positional sounds ever captured (§6.3)
export const K = { /* core JSON kinds, §5.7 / §5.8 */ };
export const LOBBY_KINDS = new Set(['hello', 'welcome', 'lobby', 'load', 'pings', 'sys', 'bye', 'ready', 'team', 'pick', 'nq']);
export const WEAPON_INDEX = /* id -> WEAPON_ORDER index + 1 */;  export const WEAPON_BY_INDEX = /* inverse, 0 -> null */;
export const PROJ_KIND = { rocket: 0, frag: 1, vortex: 2, static: 3, kinetic: 4, smoke: 5 };
export const PROJ_STATE = { flight: 0, deploy: 1, active: 2 };
export const toWireTime = v => (Number.isFinite(v) ? Math.round(v) : NET.NEVER);   // and fromWireTime(v) -> v < 0 ? Infinity : v
```
Parallel packages MUST NOT edit this file; their message kinds and constants live in their own modules (`NetArsenal.js`, `NetModes.js`).

#### 2.1.2 `src/net/NetSession.js` [A, B extends]

```js
export class NetSession {
  /** @param {Game} game  constructed at the end of the Game constructor; role 'offline'; no network, no DOM. */
  constructor(game)
  init()          // parse ?join= / #join= deep link -> pendingJoin; read sessionStorage 'kinetic.mp.rejoin';
                  // fetch('/api/build') -> this.build (failures -> ''); install NetEm when ?netem= (test only)
  // ---- read-only state (UI, gameplay gates)
  role            // 'offline' | 'host' | 'client'
  get authority() // role !== 'client'   (true offline and on the host)
  get isHost() ; get isClient() ; get online()
  phase           // 'offline'|'connecting'|'lobby'|'loading'|'playing'|'ended'
  status          // 'ok'|'interrupted'|'reconnecting'|'closed'
  reconnectUntilMs// performance.now() deadline while status === 'reconnecting' (set when the transport enters 'reconnecting')
  epoch           // u8 match epoch (0 in the first lobby)
  sessionGen      // u32, bumped by leave(), net:closed and game.quitToMenu(); async work captured before an await aborts when it changed
  build           // this page's build id from /api/build ('' when unknown)
  room            // { code, urls:[], hostName, cfg, players:[LobbyRow], phase, locked, lan }  (LobbyRow §5.8 'lobby')
  me              // { peer, sid, entityId, cg }   cg = connection generation assigned by the host (welcome.cg)
  ping            // smoothed RTT ms to the host (client) / 0 (host)
  clock           // NetClock
  host / client   // NetHost | NetClient | null
  fx              // FxMirror | null (non-null only while online; B)
  netem           // NetEm | null (tests only)
  stats           // counters copied into report.net by AutoTest (packages add to stats.custom[pkg])
  // ---- actions (UI). Every method is a no-op + console.warn when called in the wrong role/phase.
  async listRooms()                                 // fetch('/api/rooms') -> rooms[] (no socket needed)
  async hostRoom(cfg, { name, public: pub = true, maxPlayers = 8, code = null }) // -> code; installs FxMirror, starts HostTicker
  async joinRoom(code, { name })                    // -> resolves on 'welcome'; rejects {code: 'no-such-room'|'room-full'|'room-locked'|
                                                    //    'version-mismatch'|'build'|'kicked'|'cannot-connect'|'bad-code'|'timeout'}
  leave(reason = 'left')                            // clean leave (client: 'bye' + transport.leave; host: endRoom); sessionGen++
  setReady(on) ; setTeam(team) ; setConfig(cfg) ; setPick(pick)   // lobby (setConfig: host only; setPick: client -> 'pick')
  kick(peer) ; lock(on)                             // host only
  start()                                           // host only; MUST be called synchronously in a click handler (pointer lock)
  forceBegin()                                      // host only, loading phase: begin now; stragglers become late joiners
  rematch() ; toLobby() ; endMatchForAll() ; endRoom()   // host only
  debugDropConnection()                             // tests: transport.debugDrop() (simulated network failure; transport rejoins)
  debugFreeze(ms)                                   // tests: stop draining the inbox and stop sending game packets for ms (half-open link)
  // ---- per-frame hooks called by Game (all no-ops offline)
  beginFrame(raw)        // drain the inbox (NetEm releases first) in arrival order and dispatch; host: barrier, deploy timeouts
  endFrame(raw)          // host: history record, forces, snapshots (per-peer accumulators), JSON flush (unicast batches, then broadcast);
                         // client: state packet (STATE_HZ; DEAD_STATE_HZ while dead), JSON flush; both: stats
  updateRemotes(dt)      // host: RemotePlayer.update; client: NetAvatar interpolation + update; FX replay queue (B)
  simBegin() / simEnd()  // host: FX sim capture window (B); simEnd asserts RemotePlayer velocities unchanged (warn once)
  fxBegin(kind) / fxEnd()// capture windows (§6.2); kind: 'weapons'
  onClearMatch()         // dispose RemotePlayers/NetAvatars before Game._clearMatch clears entities
  onCanvasClick()        // Game's canvas click handler (Game.js:257-262); A: no-op; B: client sendDeploy() while awaitingDeploy
  // ---- messaging API for packages
  on(kind, handler) -> off            // handler(msg, fromPeer)  (host: fromPeer 1..254; client: 0)
  send(msg, to = 'host')              // queue into this frame's batch; to: 'host' | 'all' | peer number
  sendNow(u8, to)                     // bypass batching (PING/PONG only)
  registerSection(id, { encode(w, ctx), decode(r, ctx, len) })   // snapshot TLV sections (§5.5)
  // ---- plugin install: install(net) of NetArsenal.js and NetModes.js is called in hostRoom/joinRoom
}
```
Events emitted on `game.events`: `net:status {status, ping, reconnectUntilMs}`, `net:lobby {room}`, `net:error {code, message}`,
`net:closed {reason}` (`'host-left'|'kicked'|'left'|'failed'|'replaced'|'build'|'reconnect-failed'`), `net:sys {kind:'join'|'leave'|
'drop'|'rejoin'|'team'|'kick', name, color}`, `net:phase {phase}`, `net:countdown {left}` (integer seconds), `hit:predicted
{target, weapon, headshot, ci}` (B, client, §5.10). While autotest is active, `window.__NET__ = {role, phase, code, epoch, entityId}`.

Hidden-safe loading yields: `hostRoom`/`joinRoom` call `utils.setHiddenTick(() => ticker.nextTick())`; `leave` clears it (§2.2 utils).

#### 2.1.3 `src/net/NetHost.js` [A, B extends]

```js
export class NetHost {
  constructor(net)
  // lobby
  peers: Map<peer, PeerRec>   // {peer, sid, name, color, team, pref, ready, loaded, progress, vis, ping, jitterP95, lagP95, fps,
                              //  connected, inMatch, entity, snapHz, snapAcc, ubatch}
  kickedSids: Set<string>     // B: per room; hello with a kicked sid -> welcome{err:'kicked'} + kick
  onPeerJoin(info) ; onPeerLeave(info) ; onHello(msg, peer)   // info = wave-1 {peer, name, addr, rejoin} / {peer, reason, reserved}
  broadcastLobby()            // debounced 100 ms; also transport.meta({host, map, mode, players, max, phase, lateJoin, build})
  // match
  async start()               // epoch++, freeze cfg, broadcast 'load', await game.netLoadMatch(cfg)
  checkBarrier()              // hostLoaded && (all loaded || timeout || forced) -> beginMatch()
  beginMatch(peersLoaded)     // Teams.planMatch, entities with ids, spawns, per-peer 'begin' (spawn broadcasts suppressed while building)
  attachLate(peer, entity = null) // B: straggler / late joiner / rejoin; entity = existing RemotePlayer on rebind. NEVER spawns: deploy gate (§7.2.14)
  onDeploy(peer)              // B: first spawn of an attached peer ('deploy' message or DEPLOY_TIMEOUT_S)
  buildBegin(peer) -> msg     // full-state catch-up (§5.8 'begin'); calls onBuildBegin extensions
  onBuildBegin(fn(peer, msg)) // extension hook (modes)
  // runtime
  remotes: Map<peer, RemotePlayer>
  remoteOf(peer) -> RemotePlayer|null
  onState(peer, u8)           // decode PKT.CSTATE -> rp.onState
  history                     // per-entity ring {tMs, x, y, z, h, vx, vy, vz}, recorded in endFrame at netNowMs() from the values the
                              // snapshot encodes (RemotePlayer: netPos) -> same time axis as client render time (HISTORY_S)
  sampleHistory(entity, tMs, out) -> bool
  onClaim(msg, peer)          // B, §5.10
  grant(rp, g)                // B: queue grant into rp's unicast batch, increments rp.grantSeq (§5.13)
  sendForces()                // B: flush rp._pendingImpulse / _pendingLaunch as 'imp' / 'lnch' (+ sources)
  buildSnapshots()            // §5.5, per-client header + shared body, per-peer rate
  endMatchMessage(match)      // deferred to the end of the frame's broadcast batch (§7.2.9)
  policy                      // { onDrop(rp, info), onRejoin(hello, peer) -> bool, onLateJoin(peer, plan) -> plan, onLeave(rp) }
                              // core defaults: remove like a leave / false / plan unchanged / nothing. mp-modes (Rejoin.js)
                              // replaces them; the JSDoc of onRejoin carries the rebind checklist of §7.2.15 (normative).
}
```

#### 2.1.4 `src/net/NetClient.js` [A, B extends]

```js
export class NetClient {
  constructor(net)
  avatars: Map<id, NetAvatar>
  inMatchEpoch                // epoch for which netBeginMatch completed; -1 outside a match (R16)
  awaitingDeploy              // true between a deploy-gated 'begin' and the own 'spawn' (B)
  departed: Map<id, DepartedRef> // B: {id, name, color: THREE.Color, team, isBot, isHuman, alive:false, departed:true}
  refOf(id) -> Entity|DepartedRef|null   // B: optional-id resolution (§5.9)
  onWelcome(msg) ; onLobby(msg) ; onLoad(msg) ; onBegin(msg) ; onRoster(msg) ; onPhase(msg) ; onEnd(msg)
  onSnapshot(u8)              // decode, epoch + inMatchEpoch check, push samples, own block (guards §7.3), sections
  interpDelayMs               // DelayEstimator output (§5.15)
  renderTimeMs()              // clock.hostNowMs() - effective delay (dilated, monotonic)
  lastRenderMs                // render time used by the last updateRemotes (claims use NetAvatar.shownT, §5.10)
  claimDamage(target, info) -> 0      // A: stub (returns 0, sends nothing); B: §5.10
  hooks: { blast(shooter, origin, dir, b, ads) -> {hits, reflected} }   // default {hits:0, reflected:0}; mp-arsenal sets it
  act                         // mp-arsenal installs {rocket(o, d), nade(o, v, f, ty, drop), cook(o, ty)} (§5.11.1); default warn-once no-ops
  onGrant(kind, fn)           // B: grant kinds registry; core registers weapon/ammo/nades/escw
  onBegin(fn(msg))            // extension hook at the end of netBeginMatch on clients (modes: koth zones/state, storm)
  applyLocalSpawn(msg) ; applyDeath(msg) ; applyForces(msg)   // forces are ignored while the local player is dead
  refreshTimes()              // every frame: re-convert own net-time deadlines to local game time (§5.14)
  updateMatchClock(dt)        // client-side m.timeLeft decrement between snapshots; countdown -> live at hostNow >= liveAt
  sendState()                 // PKT.CSTATE at STATE_HZ (DEAD_STATE_HZ while dead)
  sendDeploy()                // B: once per gated begin (pointer lock acquired, canvas click, AutoTest auto-deploy)
}
```

#### 2.1.5 `src/net/NetClock.js` [A]

```js
export class NetClock {
  constructor()
  startHost()                 // t0 = performance.now()
  netNowMs()                  // host: performance.now() - t0 (continuous, not game.time)
  offsetMs                    // client: hostNetMs - clientPerfMs estimate
  onPong(cMs, hMs, recvPerfMs)// min-RTT of the last 8 samples; slew ±2 ms per pong, snap if |Δ| > 250 ms
  hostNowMs()                 // performance.now() + offsetMs
  rttMs, rttP95Ms
  hostGameToNet(game, t)      // host: netNowMs() + (t - game.time) * 1000   (Infinity -> NET.NEVER)
  netToLocalGame(game, ms)    // client: game.time + (ms - hostNowMs()) / 1000 (NET.NEVER / Infinity -> Infinity)
}
export class InterpBuffer {   // ring of 32 samples {t, px,py,pz, vx,vy,vz, yaw, pitch, h}; no allocation after construction
  push(tMs, s) ; reset(position, yaw, tMs) ; newestT
  sample(tMs, out, maxExtrapMs) -> 'interp'|'extrap'|'hold'|'empty'   // Hermite with velocities; out.t = the sample time actually
                                                                       // shown = min(tMs, newest.t + extrapolation used)
}
export class DelayEstimator {  // §5.15; one per client (snapshots) and one per RemotePlayer (states) on the host
  constructor({ minMs, maxMs })
  observe(ageMs)              // per consumer frame: age of the newest sample at consumption
  update(realDtMs, intervalMs)// target = p95(age, 2 s) + interval/2 + margin; late gap -> raise now; decay 10 ms/s; returns effective delay
  lagP95Ms, effectiveMs, targetMs
}
```

#### 2.1.6 `src/net/NetCodec.js` [A]

```js
export function encodeClientState(w, st)      // §5.4 layout into a wave-1 BinaryWriter, returns byte length (62)
export function decodeClientState(r, out)     // fills a reused plain object (wave-1 BinaryReader)
export function beginSnapshotBody(w, ctx)     // entity table + TLV sections (§5.5)
export function writeSnapshotHeader(w, hdr, own)
export function decodeSnapshot(r, ctx, sink)  // sink.entity(rec), sink.own(own), sink.section(id, r, len)
export const Q = { pos, unpos, vel, unvel, yaw, unyaw, pitch, unpitch, h, unh, u8f, unu8f }   // §5.6; wraps wave-1 packCm/packAngle/packPitch/packUnit
```

#### 2.1.7 `src/net/FxMirror.js` [B] — see §6 for semantics

```js
export class FxMirror {
  constructor(game)
  install() ; uninstall()                  // getRailBeams(game) first (no-cost guard), then wrap / restore the §6.3 methods and
                                           // game.events.emit (capture suspended while listeners run)
  open(originId, { twins = false }) ; close()   // capture window (non-nesting)
  anchor                                   // entity id whose muzzle anchors muzzle-origin records (set per bot by BotManager.update)
  group(ownerId, seq, fn)                  // records captured during fn form a tagged group (own-projectile explosions, §6.4)
  suspend() ; resume()                     // nesting counter; no capture while > 0
  take() -> {t, r, g}|null                 // batch captured since the last take (t = capture net time)
  schedule(batch, originId)                // receiver: queue for replay on the entity timeline (§6.4)
  drain()                                  // replay due batches (called from net.updateRemotes)
  replay(records, originId)                // call the ORIGINAL methods; capture suspended during replay
  stats                                    // {captured, replayed, dropped, late}
  log                                      // tests: duplicate detector (§6.6)
}
```

#### 2.1.8 `src/net/HostTicker.js` [A]

```js
export class HostTicker {
  constructor(game)      // Worker from a Blob URL: `let iv;onmessage=e=>{clearInterval(iv);if(e.data>0)iv=setInterval(()=>postMessage(0),e.data)}`
  start(periodMs = NET.HOST_TICK_MS) ; stop()
  nextTick() -> Promise<void>   // resolves on the next Worker message (hidden-safe loading yields)
  // onmessage: resolve nextTick waiters, then game._hostTick() (§7.1.1). Hidden tab measured 56-63 Hz (mp-network bgtest).
}
```

#### 2.1.9 `src/net/Teams.js` [A]

```js
export const HUMAN_COLORS = [0x9fe8ff, 0xffd84a, 0x4dffb8, 0xff6ec7, 0x8f9bff, 0xff9d4d, 0xc8ff4d, 0xd98bff]; // [0] = PLAYER_COLOR
export function sanitizeName(raw)                 // trim, strip [\u0000-\u001f\u007f], collapse spaces, max 16 chars, '' -> 'Player'
export function dedupeName(name, taken)           // case-insensitive; 'Caleb' -> 'Caleb 2', 'Caleb 3', ...
export function planMatch({ mode, humans /* [{peer, name, pref}] host first */, botCount })
  // -> { humans: [{peer, team, color}], botTeams: number[] /* one per bot; [] outside team modes */ }
  // FFA/escalation: team 0 (Game sets team = entity id), colors HUMAN_COLORS[i]
  // TDM/KOTH: each human to the team with fewer humans (tie: fewer total, tie: Blue); a valid pref is honoured when the
  //   team sizes stay within 1; total = humans + botCount; team targets ceil/floor(total/2), the extra slot to the team with
  //   fewer humans; bots fill each team to its target; color TEAM_COLORS[team]
export function planLateJoin({ mode, entities, pref }) -> { team, color, replaceBot /* Bot|null, same team, only if cfg.botFill */ }
```

#### 2.1.10 `src/net/NetEm.js` [A] (test only)

```js
export class NetEm {
  constructor(spec, seed = 1)   // spec: 'lan' | 'wifi' | 'bad' | 'lat:8,jit:12,stall:150-300@5' (ms; stall every N s)
  setProfile(spec)              // scenario may switch profiles mid-run (jitter-step test)
  inbound(from, u8, recvMs)     // queue with releaseAt = max(prevRelease, now + lat + jitter); a stall holds everything
  outbound(sendFn, u8)          // same per direction; latest-wins packets (type >= 0x80) conflate per (route, type) while queued
  poll(nowMs)                   // release due packets in FIFO order, stopping at the first unreleased one (TCP head-of-line)
}
// Profiles: lan = lat 1 ± 1; wifi = lat 8 ± 12 + a 150-300 ms stall every 5 s; bad = lat 30 ± 40 + a 500 ms stall every 5 s.
// Applied on the impaired page to both directions (a Wi-Fi client delays what it sends and what it receives). Seeded (mulberry32).
// poll() runs in beginFrame, endFrame, every HostTicker tick and a 2 ms setInterval while its queues are non-empty.
```

#### 2.1.11 Remaining new modules (API summary)

```js
// src/net/NetEvents.js [B]
export function register(name, { toWire /* (payload, host) -> msg|null */, apply /* (msg, client) -> payload|null */,
                                 required /* msg fields holding required ids */, optional /* msg fields holding optional ids */ })
export function installHost(net)      // subscribe game.events for every registered name (called once in hostRoom)
export function applyOnClient(net, msg) -> boolean   // dispatch by msg.k; false for unknown kinds (warn once)

// src/net/AvatarRope.js [A]
export class AvatarRope {
  constructor(game)                 // thin tube (8 segments, canvas rope texture like Grapple._makeRopeTexture) + small claw; hidden
  show(from, to, { flying, sag }) ; hide() ; dispose()
}

// src/net/NetArsenal.js [ars]   (A ships `export function install(net) {}`)
export function install(net)        // net.on('act'/'actx'), section 2, client.hooks.blast, client.act, predicted projectiles,
                                    // NetEvents 'smoke', Avatar.decorators (arc beam + light, rail charge), client vortex pull
// src/net/NetModes.js [modes]      (A ships the same stub)
export function install(net)        // section 3, NetEvents esc/escf/hill/storm, host.onBuildBegin(koth + storm), client koth state, Rejoin
// src/net/Rejoin.js [modes]         (called from NetModes.install)
export function installRejoin(net)  // replaces net.host.policy.* and adds the client rejoin record / reload auto-rejoin

// src/ui/NetMenu.js [A minimal -> ui]
export class NetMenu {
  constructor(menu) ; html() -> string ; bind()
  onClick(act, el) -> boolean ; onKey(e) -> boolean ; onShow(screen)
  showHub({ join, message } = {}) ; showLobby()
  setupMode                         // 'solo' | 'host' | 'edit'
  createOrApply(cfg)                // host: net.hostRoom(cfg) or net.setConfig(cfg)
  fillPause() ; fillEnd(match) ; loadingActions()   // loadingActions: host 'Start without N' button (ui)
}
// src/ui/NetHud.js [ui]
export class NetHud { constructor(hud) ; init() ; onMatchStart(match) ; update(rdt) ; seedNet({ firstBlood }) }
// src/ui/Nameplates.js [ui]
export class Nameplates { constructor(hud, size = 16) ; update(rdt) ; clear() }
// src/ui/SettingsCode.js [ui]
export function encodeSettings(settings) -> string ; export function decodeSettings(code) -> object|null
```

Session id: `sid` = 16 hex chars from `crypto.getRandomValues` (available in non-secure LAN contexts; `crypto.randomUUID` and
`navigator.clipboard` are NOT, mp-network), stored in `sessionStorage['kinetic.mp.sid']`. Rejoin record:
`sessionStorage['kinetic.mp.rejoin'] = {code, sid, at, build}` (the relay token itself is kept by the wave-1 transport under
`kinetic.net.token.<code>`). The record is deleted on `net:closed` with reason `kicked|replaced|host-left|left|build|reconnect-failed`.

### 2.2 Existing files that change

(✱ = the change is a no-op offline by construction.)

| File | Functions (baseline lines) | Change | Why | Pkg |
|---|---|---|---|---|
| `src/net/protocol.js` (wave 1) | `PKT` | add `CSTATE: 0x82` (client → host full body state, latest-wins). Nothing else. | C1 | A |
| `src/core/Entity.js` | constructor (12-63) | Add `isLocal=false, isHuman=false, isRemote=false, isProxy=false, simLocal=true, netPeer=-1, netHost=false, ping=0, connected=true, netHold=false`, `authPos = this.position` (same object; `position` is never reassigned). Keep `isPlayer`. | §4.5 | A |
| `src/player/Player.js` | constructor (32-35) | `isLocal = true; isHuman = true;` | §4.5 | A |
| | `update` (125-197) ✱ | After look (141): `const frozen = !!(game.match && game.match.phase === 'countdown');` If frozen: zero `inp.fwd/strafe/wishX/wishZ/wishLen`, `forwardHeld/jumpHeld/crouchHeld/sprintHeld=false`, do not latch jump/crouch presses, skip the grapple toggle (172); fixed steps still run (gravity). | Countdown freeze with free look. | A |
| `src/core/Game.js` | constructor (38-91) | `this.net = new NetSession(this)` after `this.menu` (82); `_byId = new Map()`; `_lastRafMs = 0`, `_lastFrameEndMs = 0`, `_rafIntervalEma = 16.7`, `simHz = 60`, `_matchMenu = false`. `boot` (282) also calls `this.net.init()`; with a valid rejoin record it skips the backdrop map load (the match map is loaded by the rejoin); after `menu.showMain()` (308): `if (this.net.pendingJoin) this.menu.net.showHub({ join: this.net.pendingJoin })`. | Session object; deep link; fast rejoin. | A |
| | `_loop` (720-765) → `_loop` + `_frame(nowMs, render)` + `_hostTick()` ✱ | §7.1.1. Guards around beginFrame / sim / endFrame / render / autotest.frame; `input.endFrame()` always runs. Online: one clock (`performance.now()`), `raw ≥ 0` (never 1/60 substitution), `net.endFrame` BEFORE `render()`. Offline: today's rAF timestamp and order. Wave-1 render's `frameLimiter.shouldSkip()` stays first in `_loop`. | Hidden host, host tick ≥ 60 Hz, network pump. | A |
| | `update` (768-786) ✱ | Sub-step structure of §7.1.2 (host AND client online; n = 1 offline, identical order). Player and weapons once per frame with `dp = min(dt, PLAYER_DT_MAX)` online. | Real time for everyone; hooks. | A |
| | `_bindGlobalEvents` (245-277) ✱ | Online: lock loss (248-250), Esc/P (252-255), visibility (271-276) open the match menu only when `!this._matchMenu` and never pause (§7.4). Canvas click (257-262) also calls `this.net.onCanvasClick()` (deploy). Settings listener (264-269): when `net.isHost && this.match`, defer a `quality` change to `_showEndScreen`/`netReturnToLobby` (866 ms stall measured). | R11 | A |
| | `pause` (483-491) / `resume` (493-501) ✱ | Online: `pause()` → `openMatchMenu()`; `resume()` → `closeMatchMenu()`. | R11 | A |
| | new `openMatchMenu()` / `closeMatchMenu()` / `_updateOverviewCamera(dt)` | §7.4; overview orbit (the `_updateMenu` math, 788-811) while `net.client.awaitingDeploy`. | R11, deploy gate | A |
| | `endMatch` (452-472) ✱ | Always set `m.winnerId` and results with ids. Online host: FFA/Escalation winner = first of the ordered entities (`modes.pickWinner` first for the ladder); if the first two compare equal (tier, kills, deaths) → draw: `winnerId = 0`, `winner = null`. Online: do NOT set `timeScale` (467). Offline unchanged. | R11, per-client results, ties | A |
| | `quitToMenu` (503-513) ✱ | Online: `this.net.leave('left')` first; `net.sessionGen++`; also `player.reset()`, `weapons._resetState()`, `audio.stopAllLoops()` (fixes BACKLOG stale state; harmless offline). | leave flow | A |
| | `restartMatch` (447-449) ✱ | Online host → `this.net.rematch()`; online client → no-op (button hidden). | | A |
| | `_showEndScreen` (474-481) ✱ | Apply a deferred host quality change; online keeps the session. | | A |
| | `_clearMatch` (515-525) ✱ | First line `this.net.onClearMatch()`; add `this._byId.clear()`. | avatar disposal | A |
| | `addEntity(e, id = 0)` (530-534), `removeEntity` (536-539), `getEntityById` (541-543) ✱ | `id` explicit (bump `_nextEntityId` past it); `_byId` Map. | host-assigned ids | A |
| | `respawnEntity` (550-555) | unchanged (NetHost listens to `'spawn'`; the RemotePlayer's spawn protection override comes from `rp.spawnProtectS` when set). | | — |
| | `_onDeath` (583-600) ✱ | `if (!this.net.authority) return;` first; `modes.onDeath(...)` wrapped in try/catch (`console.error`, then continue) so a mode bug cannot stop respawns or the score limit; respawn delay `victim.isBot ? RESPAWN_DELAY.bot : RESPAWN_DELAY.player` (598). | clients never score | A |
| | `getScoreboard` (613-621) ✱ | Rows add `isLocal: e === this.player, isBot, isHuman, ping, host: e.netHost, connected, hold: e.netHold`; keep `isPlayer: !!e.isLocal`. | UI | A |
| | `_updateMatch` (623-647) ✱ | `if (!this.net.authority) { this.net.client.updateMatchClock(dt); return; }`; after the `!m` check `if (m.phase === 'countdown') return;`; kill plane reads `e.authPos.y` (637); respawn skipped while `e.netHold`. | R3, countdown, §4.2 | A |
| | new `netLoadMatch`, `netBeginMatch`, `netApplyMatchEnd`, `netReturnToLobby` | §7.1.3 | lifecycle split | A |
| `src/core/Combat.js` | `applyDamage` (253-279) ✱ | First lines: `const net = this.game.net; if (net && !net.authority) return net.client.claimDamage(target, info);` then `if (match && match.phase === 'countdown') return 0;`. Knockback call becomes `target.applyImpulse(info.knockback, info)` (extra arg ignored by Entity/Player/Bot). | R4, countdown | A |
| | `kill` (282-300) ✱ | Client: return. Host/offline: wrap `target.onDeath(payload)` in `fx.suspend()/resume()` (fx = `this.game.net && this.game.net.fx`). | R3, §6 | A (gate) / B (suspend) |
| | `radialDamage` (309-337), `update` (171-173) ✱ | `if (net && !net.authority) return;` | R3 | A |
| | `blast` (185-187) ✱ | Client: `return net.client.hooks.blast(shooter, origin, dir, b, ads)`. | R5 | A |
| `src/core/Modes.js` | `_setTier` (80-83) ✱ | `if (entity.isLocal) this.game.weapons.setEscalationWeapon(id); else if (typeof entity.setEscalationWeapon === 'function') entity.setEscalationWeapon(id);` (82) | RemotePlayer forwards to its client | A |
| | KOTH presence/zone time, `KothMode.update`, `onMatchStart`, events, `Modes.update` | presence uses `e.authPos`; client presentation mode (§3, §5.8 'hill') | | modes |
| `src/world/World.js` | `_updatePads` (605-628) ✱ | Skip `e.simLocal === false`; while `match.phase === 'countdown'` skip launches (visual decay continues). | R6, countdown | A |
| | `update` (670-677) ✱ | Wrap `this.storm.update(dt)` in `fx.suspend()/resume()` when `game.net && game.net.fx`. | storm derived | B |
| | `yieldFrame` (57-61) ✱ | `yieldHiddenSafe(<today's promise>)` (utils). | hidden client loads | A |
| `src/world/Textures.js` | `yieldFrame` (2363-2368) ✱ | same as World.js | hidden client loads | A |
| `src/world/Pickups.js` | `update` (600-629) ✱ | `const auth = !this.game.net \|\| this.game.net.authority;` respawn + collection only when `auth` and not in the countdown; collection distance from `e.authPos`; `_animate` always. | R3, countdown | A |
| | new `applyNet(bitsU8, count, tHostMs)`, `applyEvent(id, available, nextRespawnNet, atMs)` | snapshot bits applied only if `tHostMs > p.eventAt`; `nextRespawnNet` sentinel `NET.NEVER` → `Infinity`; local `nextRespawn` re-converted per frame (display) | R17 | B |
| `src/fx/Effects.js` | `hitSpark` (450-453) ✱ | `if (entity && entity === this.game.player) return;` instead of `entity.isPlayer`. | sparks on remote humans | B |
| `src/weapons/GrenadeTypes.js` | `inventoryOf` (62-66) ✱ | `if (entity.isLocal) return entity.game.weapons ? entity.game.weapons.nades : null; return entity.nades \|\| null;` | host mirror for RemotePlayer | B |
| | `_vortexActive` (228) ✱ | `e.isHuman && e.onGround ? 3 : 1` | human friction boost | B |
| | `_vortexActive` (214-258), client presentation mode (update 411-419, updateStuck, splats), client vortex pull | host: `simLocal === false` entities get crush damage only (no velocity writes, no lift); client: pull/lift on `game.player` from replicated wells (C7) | C7 | ars |
| `src/weapons/WeaponSystem.js` | `update` (840) ✱ | `if (game.state !== 'playing' \|\| !p.alive \|\| (game.match && game.match.phase === 'countdown'))` → `_idle`. | countdown | A |
| | `_fireRocket` (1246), `_throwGrenade` (1533), `_grenadeCookOff` (1549), `_onDeath` drop (1564) ✱ | `if (game.net && game.net.isClient) game.net.client.act.<rocket\|nade\|cook>(...) else <today's call>` | R5 (call-site interception) | ars |
| | new getters | `beamActive` (→ `this._beamOn`), `beamEnd` (Vector3 kept in `_fireBeam` / `_updateBeam` 1213-1224: `origin + fwd·_beamDist`) | snapshot/state beam | ars |
| `src/weapons/Projectiles.js` | `spawnRocket` (133-154), `spawnGrenade` (161-200), `explode` (210-239), `update` (244-272), `_updateRocket` (288-319), `clear` (434-440) | net ids (`pid`, `ownerSeq`), `predKnockBy/predIp`, client render mode (entity timeline), predicted copies (visual-only integrator), explosion groups (§5.11) | R5 | ars |
| `src/weapons/special/gale.js` | `galeBlast` (37-97), `reflectProjectiles` (111-167) | 7th param `opts = {}`; `opts.selfPush === false` skips 84-95; export `galeSelfPush(game, shooter, origin, dir, b)`; reflection clears `r.predKnockBy = r.predIp = null`. | C2, §5.11.4 | ars |
| `src/ai/Bot.js` | `_fireBeam` (778-800) | store `this.beamEnd`, keep `_beamLastT`; getter `chargeFrac`. | snapshot beam/charge | ars |
| `src/ai/BotManager.js` | `spawnBots` (123-149) ✱ | 4th param `opts = {}`: `opts.teams[i]` overrides the alternation (137), `opts.reservedNames` removed from the shuffled `BOT_NAMES`. | human-aware teams/names | A |
| | `_separate` (207-246) ✱ | Push bots away from every alive `isHuman` entity (not only `game.player`). | R13 | A |
| | `update` (178-204) ✱ | If `match.phase === 'countdown'`: only `bot._updateModel(dt)` per bot. Online host: `net.fx.anchor = bot.id` around each `bot.update(dt)` (B). | countdown, §6.3 | A / B |
| | `_onDamage` (269-274) ✱ | `if (attacker && attacker.isBot && attacker.stats && target !== attacker)` (273): NetAvatar bots have no `stats`; the throw would be logged as console.error on every bot hit on every client. | client listeners use Entity fields only | A |
| | new `removeBot(bot)`, `addBot({team, difficulty})` | late-join replacement | | modes |
| `src/world/Storm.js` | `update` (170-196), `_beginStrike` (250-267), `_fire` (323-350) | Authority-gated scheduling; public `beginStrike(rodIndex, warn)`; clients never schedule strikes. | R3 | modes |
| `src/world/Zones.js` | `load` (260-267) | new `loadList(list)` (zones from the begin message, `nodes: []`). | clients skip nav-based resolve | modes |
| `src/core/Settings.js` | `DEFAULT_SETTINGS` (5-27) | `mpSnapHz: 60, mpMaxPlayers: 8, mpLateJoin: true, mpBotFill: true, mpTeams: 'auto', mpPublic: true, mpLastCode: ''` (typed defaults). | host options | A |
| `src/core/utils.js` | `nextFrame` (127) ✱ | Visible: exactly today (`requestAnimationFrame`). Hidden: `hiddenTick()` (HostTicker message) when registered, else `setTimeout(100)`; when that fires and the page is visible again, wait for rAF (keeps `warmup`'s drawn frame). New `setHiddenTick(fn)` and `yieldHiddenSafe(fallbackFactory)` (hidden + tick registered → tick; else fallback). | hidden tabs must load; warmup unchanged | A |
| `src/ai/BotManager.js` `prepare` | yield (100) ✱ | `await yieldHiddenSafe(() => new Promise(r => setTimeout(r, 0)))` | hidden host loads | A |
| `src/ui/Menu.js` | `init` (135-169), `_mainHTML` (177-182), Esc handler (342-355), `_onClick` (363-419), `_deploy` (457-466), `_go` (470-484), `showPause` (494-499), `showEnd` (502-507), `_fillEnd` (789, 799) | Delegation hooks into `NetMenu` (§8.1); `me = rows.find(r => r.isLocal)`; team tile = local player's team. | UI | A (hooks + minimal) → ui |
| `src/ui/Scoreboard.js` | `rowHTML` (20, 25) ✱ | `r.isLocal` for `me`, `r.isBot` for the bot icon. | UI | A → ui |
| `src/ui/HUD.js` | many | §8.3 | UI | ui |
| `src/ui/ModeHUD.js`, `src/ui/Icons.js`, `style.css` | | §8 | UI | A (minimal style) → ui |
| `src/core/AutoTest.js` | `start` (63-109), `frame` (149-162), `finish` (204-237) | MP params → `_startNet()`; real-time `done` for online runs; `report.net` from `net.stats`; `report.entities` from `game.entities`; auto-deploy. | §9.1 | A → B |
| `tools/serve.py`, `tools/netserver.py` (wave 1) | `/api/build`, `/api/lan` | `/api/build` = hash of current mtimes/sizes of `index.html`, `style.css`, `src/**`, `vendor/**` (cached ≤ 2 s); `/api/lan` adds `build`, `profile` ('Public'\|'Private'\|'DomainAuthenticated'\|null, background PowerShell query, cached), `fwRule` (bool\|null: inbound allow for TCP port or python present, background query), `lanSeen` ({addr, at} of the last non-loopback HTTP request; serve.py handler records it). | build skew, LAN diagnostics | A |
| `tools/run_mp.py` (wave 1) | args | `--hide PAGE:WHEN:DUR` (WHEN = seconds or `load`), `--close PAGE:T` (CDP `Page.close`), `--relay KEY=VALUE` (netserver DEFAULTS override), `--lock PATH` (default `tools/out/mp/.lock` with `--report`; serializes MP suites across packages), `--json` (exists) | §9.1 | A |
| `ARCHITECTURE.md` | §4, §5 events, new §6.12 Multiplayer | contract sync | | A → B (parallel packages report deltas) |

---

## 3. Roles and authority

Gate primitives (and nothing else): `net.authority` (sim mutation allowed), `net.isClient` (client interception), `e.simLocal`
(this machine integrates the entity's movement), `e.isLocal` (the local player), `e.authPos` (authoritative position for rules),
`e.netHold` (no respawn/targeting while a connection or deploy gate holds the entity), `match.phase` (`'countdown'|'live'`
online; undefined offline).

| Subsystem | Offline | Host | Client | Gate / code sites |
|---|---|---|---|---|
| Game loop | today | `_frame` from rAF or HostTicker (hidden, stalled, or rAF < 55 Hz); dt ≤ 0.25 in ≤ 5 sub-steps; no timeScale | `_frame` rAF (+HostTicker when hidden/stalled); same sub-steps; no timeScale | Game.js `_loop/_frame/_hostTick`, `update` (§7.1) |
| Match flow | `startMatch` | `net.start` → `netLoadMatch` → barrier → `NetHost.beginMatch` → `netBeginMatch` | 'load' → `netLoadMatch` → 'loaded' → 'begin' → `netBeginMatch` | §7 |
| Scoring `_onDeath`, `_checkScoreLimit`, `endMatch` | yes | yes | NO (applies death/end messages) | Game.js:583 `if (!net.authority) return` |
| Timer / kill plane / respawns `_updateMatch` | yes | yes (kill plane on `authPos` = RemotePlayer `netPos`) | local clock only; fall backstop (§5.12) | Game.js:623 |
| Pause | pauses | match menu | match menu | Game.js:245-277, 483-501 |
| Player (movement, grapple, camera) | local | local | local | unchanged (R2) |
| WeaponSystem | local | local | local; projectile/blast call sites → actions; damage → claims | WeaponSystem call sites (ars); countdown gate WeaponSystem.js:840 |
| Combat.raycast / canSee / fireBullet | yes | yes | yes (local effects + hit test vs NetAvatars) | — |
| Combat.applyDamage | apply | apply (+claims from clients) | claim if `attacker === game.player` and weapon in `CLAIM_WEAPONS`, else no-op | Combat.js:253 |
| Combat.kill / radialDamage / update(updateShoves) | yes | yes | no-op | Combat.js:171, 282, 309 |
| Combat.blast (Gale) | galeBlast | galeBlast (own) / `galeBlast(...,{selfPush:false})` (remote action) | predict self-push + 'act gale' | Combat.js:185, gale.js |
| Smokes (`combat.smokes`) | yes | yes | from 'smoke' events (overlay only) | ars |
| Projectiles | sim | sim + `pid`, `ownerSeq`, snapshot section 2 | non-owned: render-only on the entity timeline; own: predicted visual copies at the present; never runs `_updateRocket/_updateGrenade` sim, `explode`, `detonate`, `types.detonate`, `types._vortexActive` for replicated or predicted copies | Projectiles.js (ars) |
| GrenadeTypes (vortex/static/kinetic/smoke) | sim | sim; RemotePlayers get crush damage only from a vortex (C7) | presentation (rigs/flight fx from state, zaps from shocked flag, smoke volumes from events); vortex pull/lift on the local player from replicated wells (C7); `_updateSplats` off | GrenadeTypes.js (ars) |
| Special: arc | local fireArc | fireArc (own); remote beam visual derived | fireArc locally → claims; beam derived for others | arc.js unchanged |
| Special: rail | local | fireRail (own) | fireRail locally → claims; RailBeams mirrored; charge glow derived | rail.js unchanged |
| Special: gale | local | own blast; remote actions | predict self push; action | gale.js (ars) |
| Pickups | collect/respawn | collect/respawn (RemotePlayer via `authPos` + inventory mirror); none during the countdown | availability from snapshot + events; grants applied to the local arsenal | Pickups.js:600 |
| Jump pads | all entities | `simLocal` entities (host player, bots); no launches during the countdown | local player only | World.js:614 |
| Storm | yes | schedules strikes, damage; broadcasts `storm` | strikes from events; sheet lightning local cosmetic | Storm.js (modes); capture suspended World.js:675 |
| FFA/TDM scoring | yes | yes | from events (`death.ts`) + score block (guarded) | Game.js |
| Escalation | yes | yes (tiers; `RemotePlayer.setEscalationWeapon` → grant `escw`; `addGrenades(1)` → grant) | ladder from begin; tiers from `esc` events + score block | Modes.js:80-91 (A), events (modes) |
| KOTH | yes | yes (+ snapshot section 3; presence on `authPos`) | `zones.loadList` + `setState` from section; `hill` events | Modes.js / Zones.js (modes) |
| BotManager / Bot | yes | yes | none (bots are NetAvatars); BotManager listeners use Entity fields only | Game.js update gate `net.authority`; BotManager.js:273 |
| Effects | local | local + captured (§6) | local + replayed + own weapons captured | FxMirror (B) |
| Audio | local | positional captured; `TWIN_SOUNDS` twins for the host player | twins for own weapons; replays | FxMirror (B) |
| HUD / ModeHUD / Scoreboard / Menu | local | local | local (driven by re-emitted events and replicated fields) | §8 |
| Settings | local | local (host cfg persisted by the host's menu only) | local; host cfg NEVER written to settings | Game.js:398-403 is offline-only |

Grenade types and special weapons in detail:

| Item | Host (authority) | Client | Code sites |
|---|---|---|---|
| Frag | `Projectiles._updateGrenade` physics, `explode` → `radialDamage` (knockback on RemotePlayers forwarded), `effects.explosion` + `audio 'explosion'` captured | section 2 render (entity timeline); explosion mirrored (`'X'`, `'P'`); own throws = `act nade` + predicted copy | Projectiles.js:161-200, 210-239, 322-418 |
| Vortex | `stick` (145-165), `updateStuck` (170-194), `_vortexActive` pull/lift/crush on host-simulated entities, crush only on RemotePlayers (C7); rockets/grenades bent (262-286), `_vortexCollapse` (309-320) | state `deploy`/`active` → `vortexAcquire`, `vortexStick`, local `vortexTick`, positional `vortex_loop`, `types.wells` (vignette); pull/lift on the local player from the newest vortex state (C7); collapse mirrored (`'VC'`, `'P' vortex_collapse`) | GrenadeTypes.js |
| Static | `_staticBurst` (322-370): damage + knockback + `e.shock()` | burst mirrored (`'SB'`, `'P' shock_hit/static_burst`); own shock from the own block; zaps derived (`_updateShocked` 439-444 over replicated `shockedUntil`) | GrenadeTypes.js |
| Kinetic | `_kineticBlast` (372-396) + `_updateSplats` (447-473) on `RemotePlayer.velocity` (raw) | blast/splat mirrored (`'KB'`, `'SP'`, `'P'`); knockback via `imp` | GrenadeTypes.js |
| Smoke | `_smokePop` (398-407): `combat.addSmoke`, `smokeCloud`, `'smoke'` event | cloud mirrored (`'SC'`); `smoke` event → `combat.addSmoke` (overlay GrenadeFX.js:577-590) | GrenadeTypes.js, Combat.js:75-80 |
| Tempest (arc) | own: `fireArc` (arc.js:60-123) | own: `fireArc` → claims per hit/chain; `lightning`/`arcHit` captured; others' beams: decorator draws `updateBeamVisual(game, avatar, avatar.muzzle(), beamEnd, WEAPONS.arc)` each frame + `arc_loop` + a `flashLight` every 0.08 s | arc.js, WeaponSystem.js:1151-1184, 1213-1224 |
| Javelin (rail) | own: `fireRail` (rail.js:36-109) | own: `fireRail` → claims; `RailBeams.add/rings/impact` captured; others' charge: glow + `rail_charge` loop derived | rail.js, RailBeam.js:112-150 |
| Gale | own: `galeBlast` full; remote: `galeBlast(..., {selfPush:false})` from `act gale`; reflection host-only (gale.js:111-167); splats host-approximated | own: `galeSelfPush` prediction + `act gale`; `effects.galeBlast` captured (muzzle-anchored); shove rings/hit sparks/reflect rings arrive mirrored (origin 0, not dropped by the actor) | gale.js, Combat.js:185-187 |
| Slipstream (smg) | local momentum | local momentum; claims capped with `speedBonus.damage` | smg.js:17-21 |
| Melee | own `_meleeStrike` | own `_meleeStrike` → claim with `kb` (dir × 4.5); twins `melee_swing/melee_hit` | WeaponSystem.js:1624-1664 |

---

## 4. Entity model

### 4.1 Classes per machine

| Machine | Entities in `game.entities` |
|---|---|
| Offline | `Player`, `Bot`… (today) |
| Host | `Player` (host human, id assigned by host), `RemotePlayer` × remote humans, `Bot` × bots |
| Client | `Player` (id = `begin.you`), `NetAvatar` × every other entity (host player, other humans, bots) |

### 4.2 `RemotePlayer extends Entity` (`src/net/RemotePlayer.js`, host only) [A, B extends]

Flags: `isHuman=true, isRemote=true, simLocal=false, isLocal=false, isBot=false, isPlayer=false, netPeer=peer`; `authPos = netPos`.

| Field | Meaning |
|---|---|
| `peer, sid, cg, ping, connected, lagging, softDropped, awaitingDeploy` | relay peer id, client session id, connection generation (u8, bumped per rebind; `welcome.cg`), RTT ms, socket state, > `LAGGING_MS` without state, soft-dropped (> `SOFT_DROP_MS`), deploy gate open |
| `position` | **smoothed render position** (host view): rendering, hitboxes for host-local shooters (host player, bots), bots' targeting |
| `netPos` (= `authPos`) | latest raw reported position: snapshots, claim history, pickups, KOTH presence, kill plane, action-origin checks |
| `velocity` | latest raw reported velocity (bots' lead, splat detection, action-origin extrapolation) |
| `yaw, pitch, height, eyeHeight (= height - 0.14), onGround` | from state |
| `weaponId, weaponChangedAtMs, adsAmount, charge, grappleState, grapplePoint, beamEnd, flags` | from state |
| `inv = {owned:Set, full:Set, nades:{frag,vortex,static,kinetic,smoke}}`, getter `nades → inv.nades`, `mirrorResync` | inventory mirror (§5.13) |
| `spawnSeq (u8), grantSeq (u8), grantAck (u8), lastStateSeq (u16 or -1 = unset), lastStateNetMs, deathNetMs` | sync counters |
| `loadoutPick` | the client's pick from `hello`/`pick` (so any host-side `resolveFor(game, rp)` matches the client; wave-1 `entity.loadoutPick`) |
| `buf: InterpBuffer`, `delay: DelayEstimator` | smoothing (samples stamped with the client's `tHost`) |
| `avatar: Avatar`, getter `model → avatar.model` | rendering |
| `_pendingImpulse (Vector3)`, `_pendingLaunch (Vector3\|null)`, `_impSrc ([[weapon, seq]])`, `_muted (int)` | force forwarding (§5.12) |
| `spawnProtectS` | one-shot spawn-protection override for the next spawn (late join: `LATE_SPAWN_PROTECT_S`) |

| Method | Contract |
|---|---|
| `onState(st, arrivalNetMs)` | Called by NetHost for each decoded `PKT.CSTATE`. Drop if `st.epoch !== net.epoch`, `st.cg !== this.cg` (old connection), or `lastStateSeq >= 0 && seqDelta(st.seq, lastStateSeq) <= 0` (wave-1 `seqDelta`). Then `lastStateSeq = st.seq; lastStateNetMs = arrivalNetMs`; if `softDropped`: restore (`alive = true, softDropped = false`, buffer reset, `teleportHold = TELEPORT_HOLD`); `netHold = awaitingDeploy \|\| !connected` (a stale hold ends). Inventory mirror: if `mirrorResync \|\| st.grantAck === grantSeq` copy owned/full/nades and clear `mirrorResync`. If `st.spawnSeq !== spawnSeq` (pre-spawn packet) or `!alive`: stop here (mirror/ack only). Body: `height` clamped to [1.1, 1.85]; implied speed from the client's own tHost deltas `\|Δpos\| / max(4 ms, ΔtHost)` must be ≤ `IMPLIED_SPEED_K·max(\|v\|,\|v_prev\|) + IMPLIED_SPEED_ADD` and ≤ `IMPLIED_SPEED_CAP` (120 m/s), else warn once and treat the sample as a teleport (buffer reset) — samples are never dropped for speed or for being low (the kill plane must fire). Push `{t: clamp(st.tHost, arrivalNetMs - 500, arrivalNetMs)}`; teleport bit → `buf.reset`. Update `netPos`, `velocity`, flags, weapon, beam, grapple. |
| `update(dt)` | `delay.observe(netNow - buf.newestT)`; `buf.sample(netNow - delay.update(...), out, 1000 / STATE_HZ)` → `position/yaw/pitch/height`; `lagging = netNow - lastStateNetMs > LAGGING_MS`; after `SOFT_DROP_MS` without state: alive → soft drop (`softDropped = true, alive = false, netHold = true`), dead → `netHold = true` only (its respawn waits); the next valid packet clears it (§7.2.15); `avatar.update(dt, this)`. Called from `net.updateRemotes`. |
| `applyImpulse(v, info)` | `if (!this._muted) { this._pendingImpulse.add(v); this._impSrc.push([info && info.weapon, info && info.seq]); }`; velocity untouched. |
| `launch(v)` | `this._pendingLaunch = v.clone(); this.lastLaunchTime = game.time` (never reached by pads). |
| `shock(s)` | `super.shock(s)` (the own block carries `shockedUntil`). |
| `muteForces()` / `unmuteForces()` | counter used by Projectiles for a predicted self-rocket-knock (§5.11.4). Callers check `typeof e.muteForces === 'function'`. |
| `spawn(position, yaw)` | `super.spawn`; if `spawnProtectS` set: `spawnProtectedUntil = game.time + spawnProtectS`, clear it; `spawnSeq = (spawnSeq + 1) & 255`; `netPos/position` = position; `buf.reset`; `avatar.place`; visible; `teleportHold = TELEPORT_HOLD`. |
| `onDeath(info)` | `deathNetMs = netNow`; `avatar.die(this, info)` (gibs + positional `bot_death`, derived; runs inside `fx.suspend`). |
| `giveWeapon(id) / addAmmo(id = null, f = 0.5) / addGrenades(n, type = 'frag') / setEscalationWeapon(id)` | mirror predicate + `net.host.grant(this, …)` (§5.13); unknown weapon/grenade types → `false` (never throw: `_setTier` calls `addGrenades(1)` inside `Game._onDeath`, Modes.js:84-91). |
| `onFire(weaponId, origin, dir)` | `avatar.fireFx(this, weaponId, dir)` (host view). NetHost emits `weapon:fire` for bots' hearing. |
| `dispose()` | avatar/rope/loops disposal; remove from scene. |

### 4.3 `NetAvatar extends Entity` (`src/net/NetAvatar.js`, client only) [A, B extends]

Flags: `isProxy=true, simLocal=false, isLocal=false, isPlayer=false, isBot = row.kind==='bot', isHuman = row.kind==='human', netPeer, netHost`.
A NetAvatar never has Bot internals (`stats`, `brain`, `preset`, `inv`, `_pushX`); shared listeners that run on clients MUST use
Entity fields only (§4.5).

| Field / method | Contract |
|---|---|
| constructor(game, row) | row = roster row `{id, name, team, color, kind, peer, host}`; `avatar = new Avatar(game, {color, team})`; `model` getter. MUST NOT be constructed for `row.id === begin.you` (R7). |
| `buf`, `lifeAt`, `hpAt`, `scoreAt`, `shownT` | InterpBuffer; net ms of the last life event (death/spawn), health event (dmg/pk/death/spawn), score event (death/esc/end); `shownT` = sample time shown by the last `interpolate` (claims, §5.10). |
| `applySnapshot(rec, tHostMs)` | push sample (unless `teleport` → `buf.reset(pos, yaw)`), copy flags, weapon (→ `avatar.setWeapon` on change), grapple/beam/charge; score block only if `tHostMs > scoreAt`; `alive` bit only if `tHostMs > lifeAt` and then silently (soft drop / restore: `avatar.setVisible(alive)`, `buf.reset` on restore, no gibs, no events). |
| `interpolate(renderMs)` | `buf.sample(renderMs, out, 1000 / snapHz)` → `position, velocity, yaw, pitch, height, eyeHeight, onGround`, `shownT = out.t`. Extrapolation ≤ one snapshot interval, then hold. |
| `spawn(position, yaw)` | `super.spawn`; `buf.reset`; `avatar.place`; visible. |
| `onDeath(info)` | `avatar.die(this, info)`. |
| `onFire(weaponId, origin, dir)` | humans only: `avatar.fireFx` (muzzle flash + light + firing pose); bots: no-op (their flash arrives mirrored, §6.5). |
| `update(dt)` | `avatar.update(dt, this)` |
| hitboxes | Entity default from interpolated `position/height` → the local shooter hits what it sees. |
| name tag | drawn by `src/ui/Nameplates.js` (ui) for `isHuman` avatars (and RemotePlayers on the host), §8.3. |

### 4.4 `Avatar` (`src/net/Avatar.js`) [A, B extends]

Copies (C3) the math of `Bot._updateModel` (Bot.js:852-892), `Bot._getWeaponModel` (229-244, `createWeaponModel(id, {view:false, batched:true})` + placeholder), `Bot._muzzlePosition` (684-695), `Bot.onDeath` gibs (259-277).

```js
export class Avatar {
  constructor(game, { color, team })     // BotModel({color, team}), hidden, added to game.scene
  model; bodyYaw
  setWeapon(id) ; place(position, yaw) ; setVisible(v) ; dispose()
  muzzle(e, out) ; hand(e, out)          // muzzle: model.getMuzzleWorldPosition (FX rebase, §6.4); hand: weaponSocket.localToWorld(model._leftOff)
  fireFx(e, weaponId, dir)               // effects.muzzleFlash(muzzle, dir, {scale: clamp(def.flash.size/0.25,0.6,1.8), color: def.flash.color})
                                         // (includes the world flash light); firing pose 0.14 s
  die(e, info)                           // (B) breakApart -> effects.gibs(meshes, {velocity, direction, point}); audio 'bot_death' positional; hide
  update(dt, e)                          // pose + LOD + derived sounds + rope + decorators (below)
  static decorators = []                 // [{ update(avatar, e, dt), stop(avatar) }] — mp-arsenal registers arc beam + rail charge
}
```
Pose state for `BotModel.update` (BotModel.js:1259, keys of DEFAULT_STATE 1005 + `aiming`): `forwardSpeed/strafeSpeed` from `e.velocity`
and `bodyYaw`, `speed` horizontal, `onGround`, `crouch = clamp((1.8 - e.height)/0.65, 0, 1)` (slide → 1), `aimPitch = e.pitch`,
`aimYawOffset = wrapAngle(e.yaw - bodyYaw)`, `firing` (flag or fireFx window), `aiming` (flag), `reloading`, `alive`. Body-yaw rule
as Bot. LOD: skip pose refresh 2 of 3 frames when > 40 m or behind the local camera (`net.camPos/camFwd/frame`, computed once per frame).
No wall-run / slide / grapple poses (BotModel has none): slide → crouch pose, wall-run/grapple/mantle → airborne pose.

Derived presentation inside `Avatar.update` (local, never captured; positional via `audio.play(name, {position})` / `playLoop`):

| Trigger (edge on replicated state) | Output | Avatars |
|---|---|---|
| onGround && !slide, horizontal distance travelled ≥ 2.2 m (2.8 m sprinting) | `footstep` vol 0.5 | all |
| onGround true→false with v.y > 3 | `jump` vol 0.5 | all |
| v.y rises by > 6 m/s between samples within 1.2 m of a jump pad | `jumppad` | all |
| onGround false→true with fall speed > 9 | `land` / `land_hard` (> 16) | all |
| slide flag on / off | `slide` loop (follow position) | humans |
| wallrun flag on / off | `wallrun` loop | humans |
| grappleState idle→flying / →attached / attached→retract | `grapple_fire` / `grapple_attach` / `grapple_release`; rope via `AvatarRope` from `hand()` to hook/anchor | humans |
| mantle flag rising | `mantle` | humans |
| shocked flag | `e.shockedUntil = game.time + 0.2` each snapshot while set (GrenadeSystem `_updateShocked` draws zaps) | all |
| death event | `die()` | all |
| 'fire' event (scheduled on the entity timeline) | `fireFx()` | humans |

### 4.5 Flag semantics and every site that changes

| Class | isPlayer | isLocal | isHuman | isBot | isRemote | isProxy | simLocal | authPos |
|---|---|---|---|---|---|---|---|---|
| Player | true | true | true | false | false | false | true | position |
| Bot | false | false | false | true | false | false | true | position |
| RemotePlayer (host) | false | false | true | false | true | false | false | netPos |
| NetAvatar (client) | false | false | row.kind==='human' | row.kind==='bot' | false | true | false | position |

`isPlayer` stays as a legacy alias of `isLocal` (true only for the `Player` instance). New code MUST use `isLocal` / `isHuman` / `isBot`.
**Rule:** listeners that also run on clients (shared `game.events` subscribers: BotManager, HUD, ModeHUD, Player, WeaponSystem,
AutoTest) may rely only on Entity fields, never on Bot internals (`stats`, `brain`, `preset`, `inv`, `_pushX`) — guard with the
field's presence.

| Site (baseline) | Today | New | Semantics |
|---|---|---|---|
| Game.js:598 respawn delay | `victim.isPlayer` | `!victim.isBot` | human |
| Game.js:617 scoreboard | `isPlayer` | + `isLocal, isBot, isHuman, ping, host, connected, hold` | local / bot / human |
| Game.js:637 kill plane | `e.position.y` | `e.authPos.y` | authoritative position |
| Pickups.js:610-615 collection | `e.position` | `e.authPos` | authoritative position |
| GrenadeTypes.js:64 `inventoryOf` | `entity.isPlayer` | `entity.isLocal` (else `entity.nades`) | local arsenal |
| GrenadeTypes.js:228 vortex boost | `e.isPlayer` | `e.isHuman` | PlayerController friction |
| Modes.js:82 `_setTier` | `entity.isPlayer` | `entity.isLocal`, else `entity.setEscalationWeapon` | local arsenal |
| Modes.js KOTH presence | `e.position` | `e.authPos` | authoritative position (modes) |
| Effects.js:453 `hitSpark` | `entity.isPlayer` | `entity === this.game.player` | local |
| BotManager.js:273 `_onDamage` | `attacker.isBot` → `attacker.stats.damage +=` | `attacker.isBot && attacker.stats && …` | NetAvatar bots have no `stats` |
| Scoreboard.js:20 | `r.isPlayer` | `r.isLocal` | local |
| Scoreboard.js:25 | `r.isPlayer ? '' : bot icon` | `r.isBot ? bot icon : ''` | bot |
| Menu.js:789 | `r.isPlayer` | `r.isLocal` | local |
| Menu.js:799 | `TEAM_NAMES[TEAM_BLUE]` | `TEAM_NAMES[me.team]` | local team |
| BotManager.js:209, 234-244 | `game.player` only | all alive `isHuman` entities | human |
| BotManager.js:136-138 | alternation | `opts.teams[i]` when given | plan |
| Game.js:380-384 | single human Blue / PLAYER_COLOR | offline unchanged; MP path uses `Teams.planMatch` | plan |
| Game.js:461,464 | `this.player` | unchanged (per machine); host also sends `winnerId/winnerTeam` | per client |
| Game.js:553 | `e === this.player` → `onPlayerSpawn` | unchanged; RemotePlayer spawns handled by NetHost 'spawn' listener | local |
| Player.js:291-293, PlayerController.js:480,662, Grapple.js:419-422, rail.js:139-141, WeaponSystem `game.player/input/camera` | — | unchanged (C4) | local |

### 4.6 Ids and the roster

* The host resets `game._nextEntityId = 1` in `NetHost.beginMatch` (offline keeps today's never-reset counter). Order: host player,
  remote humans in peer order, bots. Late joiners / bot replacements take the next id. Ids are `u8` 1..254 (assert).
* Roster row (JSON): `{id, name, team, color /* int */, kind: 'human'|'bot', peer /* 0 host, 1..254 clients, -1 bot */, host: bool}`.
* Full roster in `begin`; deltas in `ros {add:[rows + ent state], rem:[{id, name, color, team, kind}]}`.
* Client guards (R7): a roster row, `spawn`, or snapshot record whose id equals `begin.you` never creates or modifies a NetAvatar
  (own-player paths only); `ros{add}` for an id that already exists is ignored; `ros` rows with `peer === me.peer` are ignored;
  a snapshot record with an id not in the roster is ignored. `ros{rem}` rows go to `client.departed`.
* `Game.getEntityById` is a `Map` lookup (`_byId`), used by every id→object translation.

---

## 5. Wire protocol

### 5.1 Transport usage (wave-1 `WsRelayTransport`, verified)

`NetSession._bindTransport()` is the only code that touches the transport:
`new WsRelayTransport({ version: PROTOCOL_VERSION, reconnect: true, reconnectWindow: NET.RECONNECT_GRACE_S })`.
Surface: `connect()`, `host({name, max, public, code, meta}) → {code, peer:0, max}` (`max` counts the host; errors `bad-code|code-taken|
server-full`), `join(code, name, token?) → {code, peer, token, rejoin, room}` (token defaults to the one remembered for this code in this
tab), `leave()`, `kick(peer, reason)`, `lock(bool)`, `meta(obj)`, `list()`, `sendToHost(u8)`, `sendTo(peer, u8)`, `broadcast(u8)`,
`sendControl(obj)`, `close(code, reason)`, `debugDrop()`; state `'idle'|'connecting'|'open'|'in-room'|'reconnecting'|'closed'`;
callbacks `onMessage(from, u8)`, `onPeerJoin({peer, name, addr, rejoin})`, `onPeerLeave({peer, reason, reserved})` (`reason 'expired'`
ends a reservation), `onControl(msg)`, `onStatus(state, info)`, `onClose({code, reason, text, wasClean})` (`reason` `'room-closed'|
'kicked'|'replaced'|'slow'|'reconnect-failed'|'closed'|…`), `onError({reason, re})`. The send methods fill byte 0 (route).
HTTP: `fetch('/api/lan')` → `{app, relay, hostname, port, lan, bind, ips (default-route first), urls, hostUrl, build, profile, fwRule,
lanSeen}`; `fetch('/api/rooms')` → `{rooms:[{code, name, players, max, locked, meta, v}]}`; `fetch('/api/build')` → `{build}`.
`transport.meta({host, map, mode, players, max, phase, lateJoin, build})` on every lobby change.

Inbound handling: callbacks only push `{from, u8|msg, recvMs}` to `net.inbox` (through `NetEm.inbound` when installed). Exceptions: a
`PKT.PING` on the host is answered immediately with `PKT.PONG`; the client records `recvMs` of a `PKT.PONG` in the callback.
`beginFrame` drains the inbox in order.

### 5.2 Packet types (byte 1, wave-1 `PKT`)

| Type | Name | Direction | Semantics |
|---|---|---|---|
| `0x02` | `PKT.PING` | client → host | body `[seq u32, c f64 (client perf ms), rtt u16]`; 4 Hz for 3 s, then 1 Hz |
| `0x03` | `PKT.PONG` | host → one client | echoes the PING body and appends `h f64` (host net ms) |
| `0x10` | `PKT.JSON` | both | UTF-8 JSON `{e: epoch, m: [msg, ...]}` — one batch per destination per frame |
| `0x81` | `PKT.SNAPSHOT` | host → one client | snapshot, latest-wins |
| `0x82` | `PKT.CSTATE` | client → host | body state, latest-wins (C1), 60 Hz (10 Hz while dead) |

`0x01 PKT.INPUT` is reserved for the phase-2 command stream, `0x11 PKT.EVENT` unused. All multi-byte fields little-endian.
`GameProtocol` asserts at import that all values are distinct.

### 5.3 JSON batches, ordering and gating

* Host: one unicast batch per peer (private messages: `welcome`, `load` for late joiners, `begin`, `grant`, `imp`, `lnch`, `clr`,
  `actx`) and one broadcast batch (route 255). **Flush order in `endFrame`: every peer's unicast batch first, then the broadcast
  batch** (`end` is always the last message of the broadcast batch). This makes `begin` precede any broadcast about the joiner and
  grants precede `pk` (§5.13). Client: one batch to the host.
* Messages that must not reach their originator carry the origin (`fire.e`, `fx.o`); receivers drop messages whose origin is their
  own entity (only client-weapon batches are relayed with `o = rp.id`; host-produced batches carry `o = 0` or the host player id).
* **Epoch**: kinds in `LOBBY_KINDS = {hello, welcome, lobby, load, pings, sys, bye, ready, team, pick, nq}` are accepted in any
  epoch (`load` sets `net.epoch`). On the host every other kind (`prog`, `loaded`, `deploy`, `fire`, `cl`, `fall`, `fx`, `act`)
  requires `batch.e === net.epoch`. On clients `begin` requires `batch.e === net.epoch`; every other in-match kind (`ros`, `phase`,
  `spawn`, `dmg`, `death`, `pk`, `grant`, `imp`, `lnch`, `clr`, `fire`, `fx`, `exp`, `shove`, `splat`, `reflect`, `end`, extension
  kinds) and every snapshot additionally requires `client.inMatchEpoch === net.epoch` (R16), else it is dropped silently (a stale
  `end` must never end a rematch; a loading client must never apply `phase`/`end`/`fx` to a null match).
* Vectors are arrays: positions rounded to 0.01 m, directions/normals to 0.001; times are host net ms (integers). `Infinity` and
  "none" are sent as `NET.NEVER` (`-1`) and mapped back before any conversion (JSON turns `Infinity` into `null`).

### 5.4 Client state `PKT.CSTATE` (byte-exact, 62 bytes)

| Off | Size | Type | Field | Notes |
|---|---|---|---|---|
| 0 | 1 | u8 | route | 0 (relay rewrites to sender) |
| 1 | 1 | u8 | type | `0x82` |
| 2 | 1 | u8 | epoch | |
| 3 | 1 | u8 | spawnSeq | echo of the last applied `spawn.ss` for own entity |
| 4 | 2 | u16 | seq | state sequence (wraps; restarts at 0 per connection generation) |
| 6 | 4 | u32 | tHost | client estimate of host net ms at send (`clock.hostNowMs()`) |
| 10 | 12 | f32×3 | position | feet, meters |
| 22 | 6 | i16×3 | velocity | cm/s (`packCm`) |
| 28 | 2 | u16 | yaw | `packAngle` |
| 30 | 2 | i16 | pitch | `packPitch` |
| 32 | 1 | u8 | height | `Q.h` (0 → 1.15 m, 255 → 1.80 m) |
| 33 | 2 | u16 | flags | b0 teleport (discontinuity; held for `TELEPORT_HOLD` = 3 packets), b1 onGround, b2 crouching, b3 sliding, b4 wallRunning, b5 mantling, b6 sprinting, b7 firing (`game.time - weapons.lastFireTime < 0.15`), b8 reloading, b9 beaming (`weapons.beamActive`), b10 charging, b11 aiming (`adsAmount > 0.5`), b12 switching, b13 throwing, b14 meleeing, b15 wallSideRight |
| 35 | 1 | u8 | flags2 | b0-1 grappleState (0 idle, 1 flying, 2 attached, 3 retract), b2-7 reserved 0 |
| 36 | 1 | u8 | weapon | `WEAPON_INDEX[weapons.currentId]` |
| 37 | 1 | u8 | ads | `packUnit(adsAmount)` |
| 38 | 1 | u8 | charge | `packUnit(chargeAmount)` |
| 39 | 6 | i16×3 | grapplePoint | cm; flying: `grapple.target`, attached: `grapple.anchor`, else 0 |
| 45 | 6 | i16×3 | beamEnd | cm; valid when b9 |
| 51 | 2 | u16 | ownedMask | bit i = `WEAPON_ORDER[i]` owned |
| 53 | 2 | u16 | reserveFullMask | bit i = finite reserve ≥ reserveMax |
| 55 | 5 | u8×5 | nades | counts in `GRENADE_ORDER` |
| 60 | 1 | u8 | grantAck | `s` of the last applied grant (initialised from `begin.grantSeq`) |
| 61 | 1 | u8 | cg | connection generation (`welcome.cg`); the host drops packets of an older connection |

Send rule (`NetClient.sendState` in `endFrame`): in match (`inMatchEpoch === epoch`), at most `STATE_HZ` (every frame when fps < 60).

### 5.5 Snapshot `PKT.SNAPSHOT` (byte-exact)

Per-client header + own block (34 bytes), then a shared body encoded once per snapshot tick.

| Off | Size | Type | Field | Notes |
|---|---|---|---|---|
| 0 | 1 | u8 | route | recipient peer |
| 1 | 1 | u8 | type | `0x81` |
| 2 | 1 | u8 | epoch | |
| 3 | 1 | u8 | flags | b0 scores keyframe, b1 30 Hz fallback active for this peer, b2-7 reserved |
| 4 | 4 | u32 | snapSeq | |
| 8 | 4 | u32 | tHost | host net ms at build (right after the sim step; = history time axis) |
| 12 | 2 | u16 | ackSeq | last `CSTATE.seq` received from this recipient |
| 14 | 2 | u16 | timeLeft | deciseconds; `0xFFFF` = no limit |
| 16 | 2 | u16 | teamScore1 | guarded by `scoreAt` (§7.3) |
| 18 | 2 | u16 | teamScore2 | |
| 20 | 1 | u8 | phase | 0 countdown, 1 live, 2 over; guarded by `phaseAt` |
| 21 | 1 | u8 | ownId | recipient's entity id (0 = none yet) |
| 22 | 1 | u8 | health | ceil; guarded by `ownHpAt` |
| 23 | 1 | u8 | armor | ceil; guarded by `ownHpAt` |
| 24 | 1 | u8 | ownFlags | b0 alive (informational only: never applied, warn on divergence > 1 s), b1 protected, b2 shocked, b3 held (deploy gate / soft drop) |
| 25 | 4 | u32 | protectedUntil | host net ms (0 none); guarded by `ownLifeAt` |
| 29 | 4 | u32 | shockedUntil | host net ms (0 none) |
| 33 | 1 | u8 | N | entity count (all entities, including the recipient's own — decoders skip `id === ownId`) |

Entity record (22 bytes + optional parts):

| Size | Type | Field | Notes |
|---|---|---|---|
| 1 | u8 | id | |
| 2 | u16 | flags | b0 alive, b1 onGround, b2 crouch, b3 slide, b4 wallrun, b5 mantle, b6 sprint, b7 firing, b8 reloading, b9 beaming, b10 charging, b11 aiming, b12 shocked, b13 protected, b14 teleport (held for `TELEPORT_HOLD` snapshots after spawn / teleport / soft-drop restore), b15 lagging |
| 1 | u8 | flags2 | b0-1 grappleState, b2 disconnected, b3 hasScore, b4 held (`netHold`), b5-7 0 |
| 6 | i16×3 | position | cm (RemotePlayer: `netPos`) |
| 6 | i16×3 | velocity | cm/s |
| 2 | u16 | yaw | |
| 2 | i16 | pitch | |
| 1 | u8 | height | `Q.h` |
| 1 | u8 | weapon | index (0 none) |
| 6 | i16×3 | grapplePoint | only if grappleState ≠ 0 |
| 6 | i16×3 | beamEnd | only if b9 |
| 1 | u8 | charge | only if b10 |
| 7 | u16,u16,u8,u16 | kills, deaths, tier, zoneTime (ds) | only if flags2.b3 (keyframe every `SCORE_KEYFRAME` = 8 snapshots, or on change); guarded by `scoreAt` |

Entity field sources on the host:

| Field | host `Player` | `Bot` | `RemotePlayer` |
|---|---|---|---|
| crouch / slide / wallrun / mantle / sprint | `isCrouching` / `isSliding` / `isWallRunning` / `isMantling` / `isSprinting` | `crouch > 0.5` / 0 / 0 / 0 / 0 | packet |
| firing | `game.time - weapons.lastFireTime < 0.15` | `game.time < bot._firingUntil` | packet |
| reloading | `weapons.reloading` | `bot.reloading` | packet |
| aiming | `weapons.adsAmount > 0.5` | `bot.brain.faceAim` | packet |
| beaming / beamEnd | `weapons.beamActive` / `weapons.beamEnd` (ars; `false` until then) | `game.time - bot._beamLastT < 0.1` / `bot.beamEnd` (ars) | packet |
| charging / charge | `weapons.charging` / `weapons.chargeAmount` | `bot.charging` / `bot.chargeFrac` (ars) | packet |
| grapple | `grapple.state` → 0-3, `grappleAnchor`/`grapple.target` | 0 | packet |
| weapon | `weapons.currentId` | `bot.weaponId` | packet |

After the entity table: TLV sections `u8 id, u16 len, bytes[len]`, terminated by `id 0`. Unknown ids are skipped by length.

| Section id | Owner | Content |
|---|---|---|
| 1 | B | pickups: `u8 K` + `ceil(K/8)` bytes availability bitfield (bit j of byte i = pickup `i*8+j`) |
| 2 | ars | projectiles: `u8 P` + P × {`u16 pid`, `u8 kindState` (low nibble `PROJ_KIND`, high nibble `PROJ_STATE`), `u8 owner id`, `u8 ownerSeq` (0 = host-originated), `i16×3 pos cm`, `i16×3 vel cm/s` (rocket: dir × speed), `u8 fuse` (s × 50), [state ≠ flight: `i8×3 normal` (×127)]} |
| 3 | modes | KOTH: `u8 index, u8 phase (0 countdown, 1 live, 2 relocating), u16 left (ds), u8 owner, u8 bits (b0 contested, b1 previewed), u8 progress ×255, u8 presence1, u8 presence2` |
| 4-15 | reserved | |

Size (16 entities, 4 projectiles, 30 pickups, KOTH): header 34 + 16 × 22 + sections ≈ 470 B; score keyframes +112 B every 8th.

Snapshot send rule (`NetHost.buildSnapshots` in `endFrame`): peers with `inMatch && epoch === net.epoch && begin sent`; per-peer
accumulator at `peer.snapHz` (at most one per sim frame). `peer.snapHz = cfg.snapHz`, except 30 while that peer's reported arrival
jitter p95 (`nq.j`) > `JITTER_FALLBACK_MS` (back after 10 s below `JITTER_RECOVER_MS`). Encode the body once per frame, then per peer
`header+own` + body copy → `transport.sendTo`.

### 5.6 Quantization

| Quantity | Wire | Range / precision |
|---|---|---|
| position (snapshot) | i16 cm | ±327.67 m / 1 cm (clamp + warn once) |
| position (client state) | f32 | exact |
| velocity | i16 cm/s | ±327 m/s |
| yaw | u16 (`packAngle`) | 1/65536 turn, 0.0055° |
| pitch | i16 (`packPitch`) | ±π/2 |
| height | u8 | `(h - 1.15) / 0.65 × 255` |
| normal | i8 | × 127 |
| fuse | u8 | s × 50 (≤ 5.1 s) |
| 0..1 amounts | u8 (`packUnit`) | × 255 |
| time | u32 ms host net time | wraps after 49 days |

### 5.7 Messages client → host (JSON kinds)

| k | Fields | When | Host handling |
|---|---|---|---|
| `hello` | `v` PROTOCOL_VERSION, `build`, `name`, `sid`, `rejoin` bool, `pick` | after relay `joined` (and after every transport rejoin) | kicked sid → `welcome{err:'kicked'}` + kick; build mismatch (both non-empty) → `welcome{err:'build'}` + kick; sanitize/dedupe name; `policy.onRejoin` for a reserved slot (modes); `rp.loadoutPick = pick`; reply `welcome`; broadcast `lobby`; `sys join` |
| `bye` | — | clean leave | remove immediately (no grace) |
| `ready` | `on` | lobby | lobby row |
| `team` | `team` 1\|2 | lobby, `cfg.teams === 'pick'` | accept if team sizes stay within 1 |
| `pick` | `pk {weapons, primary}` | pick changed (match menu / lobby) | `rp.loadoutPick` |
| `prog` | `p` 0..1, `vis` 'visible'\|'hidden' | during load, ≤ 4 Hz | lobby row ('in background' when hidden) |
| `loaded` | — | load finished | barrier or `attachLate` |
| `deploy` | — | deploy gate (§7.2.14) | `onDeploy(peer)` |
| `nq` | `j` arrival-jitter p95 ms, `l` lag p95 ms, `fps` | 1 Hz | per-peer snapshot rate (§5.5), lobby/scoreboard |
| `fire` | `w`, `o[3]`, `d[3]`, `t` (capture net ms) | every local `weapon:fire` with shooter = local player | `rp.onFire` (scheduled); emit `weapon:fire {shooter: rp, weapon, origin, direction}` now (AI hearing); broadcast `fire {e: rp.id, w, o, d, t}` |
| `cl` | `ci` u16 claim id, `t` target id, `n` amount, `w` weapon, `h` 0/1, `p[3]`, `d[3]`, `kb[3]?`, `st` (target sample time shown), `ft` (net ms at the shot) | every `applyDamage` intercepted (§5.10) | validate + apply, or `clr` |
| `fall` | — | fall backstop (§5.12) | kill plane for `rp` (credit `lastAttacker` within 6 s) |
| `fx` | `t`, `r` records, `g?` groups | every frame with captured records | schedule replay (owner = rp) + relay `fx {o: rp.id, t, r, g}` in the broadcast batch |
| `act` (ars) | `a` ∈ rocket\|nade\|cook\|gale, `s` seq u16, `t` net ms, `o[3]`, `d[3]` or `v[3]`, `f` fuse, `ty` type, `ads` 0/1, `ip[3]?` predicted self-knock impact, `drop` 0/1 | §5.11 | validate + execute, or `actx` |

### 5.8 Messages host → client

| k | Fields | Scope | Client handling |
|---|---|---|---|
| `welcome` | `peer, sid, you` (entity id or 0), `cg`, `phase, epoch, room, build`, `err?` ('build'\|'kicked'\|'full'\|'in-progress') | unicast | store (`me.cg = cg`); `net:lobby`; `err` → reject `joinRoom` / `net:closed{reason: err}`; if `phase` is loading/playing and late join allowed → expect `load` |
| `lobby` | `room: {code, phase, hostName, cfg, players:[{peer, name, color, team, ready, loaded, progress, vis, ping, host, connected}], epoch, locked, urls, lan}` | broadcast | `net.room = room`; `net:lobby` |
| `load` | `e`, `cfg` | broadcast / unicast (late) | `net.epoch = e`; `client.inMatchEpoch = -1`; `game.netLoadMatch(cfg)`; `prog`/`loaded` |
| `begin` | `e, you, grantSeq, cfg, roster[], match {mapName, timeLeft (s \| -1), startT, teamScores, phase, liveAt, ladder?, firstBlood}, ents[{id, alive, hold, pos, yaw, kills, deaths, streak, tier, zoneTime, ra (\| -1), pu}], pickups[{id, available, nr (\| -1)}], smokes[{p, r, u}], spawn: {p, y, ss, pu, lo?} \| null, deploy: bool, at` + extension fields | unicast | `game.netBeginMatch(msg)` (§7.1.3); `grantAck = grantSeq`; `inMatchEpoch = e` at its end |
| `ros` | `add[] rows + ent state`, `rem[] {id, name, color, team, kind}` | broadcast | create/dispose avatars (guards §4.6); `rem` → `departed` |
| `phase` | `ph` 'countdown'\|'live', `at` | broadcast | `phaseAt = at`; the switch happens at `hostNowMs() >= liveAt` |
| `spawn` | `e, p, y, ss, pu, lo?, at` (`lo` only in Escalation) | broadcast (every entity, bots included; suppressed while `beginMatch` builds) | own: §7.2.7 (ignored if `ss === stateSpawnSeq` already applied); avatar: `spawn(p, y)`, `lifeAt = hpAt = at`; emit `spawn {entity}` |
| `dmg` | `t, a?, n, w, h, p, d, hp, ar, ci?, at` | broadcast | set target `health/armor`, `hpAt = at` (own: `ownHpAt`); emit `damage {target, attacker, amount, weapon, headshot, point, direction, ci}` |
| `death` | `v, a?, w, h, p, d, vd` victim deaths, `ak` attacker kills, `as` attacker streak, `ahp` attacker health, `ra` respawnAt, `ts?` [blue, red] team scores after scoring, `at` | broadcast | `applyDeath` (§7.2.7): `ts` applied (`scoreAt = at`) BEFORE emitting `'death'` |
| `pk` | `p` pickup id, `e` entity id, `g` lastGrant, `nr` nextRespawn (\| -1), `hp, ar`, `at` | broadcast | `pickups.applyEvent`; entity health/armor (`hpAt`); grants for the local collector were applied earlier in this delivery (unicast flushed first); emit `pickup {entity, pickup}` |
| `grant` | `s` seq u8, `kind` weapon\|ammo\|nades\|escw, `w, f, n, ty` | unicast (owner) | §5.13 |
| `imp` | `v[3]`, `src [[weapon, seq?]]` | unicast (owner) | `player.applyImpulse(v)` (tests read `src`) |
| `lnch` | `v[3]` | unicast (owner) | `player.launch(v)` |
| `clr` | `ci`, `why` | unicast (claimant) | count ghost marker (HUD already flashed) |
| `fire` | `e, w, o, d, t` | broadcast (humans only) | drop if `e === me`; schedule `avatar.onFire` at render time ≥ `t`; emit `weapon:fire` |
| `fx` | `o` origin entity id (0 = host sim/action), `t`, `r`, `g?` | broadcast | drop if `o === me`; `fx.schedule(batch, o)` (§6.4) |
| `exp` | `p, r, o?, w, at` | broadcast | emit `explosion {position, radius, owner, weapon}` (listeners only; visuals are mirrored) |
| `shove` / `splat` / `reflect` | ids (required: target/victim; optional: attacker/owner) + `speed` / `damage, drop` / `kind` | broadcast | emit with resolved entities (HUD `reflect` toast) |
| `end` | `reason, winnerId (0 = draw/none), winnerTeam, teamScores, results[rows with ids, WITHOUT isLocal/isPlayer], departed[], at` | broadcast, always last in the frame | `game.netApplyMatchEnd` |
| `sys` | `kind, name, color` | broadcast | `net:sys` |
| `pings` | `p: [[entityId, ms], ...]` | broadcast 1 Hz | entity `ping` |
| extension kinds | `actx`, `smoke` (ars); `esc`, `escf`, `hill`, `storm` (modes) | | §5.9 |

### 5.9 Id translation and event re-emission

`NetEvents.register(name, { toWire, apply, required, optional })`.

* **Host**: NetHost subscribes to `game.events` at session start (after Game's own listeners, so `'death'` sees post-scoring values)
  for every registered event and calls `toWire`; `null` skips (e.g. `weapon:fire` from bots, `weapon:fire` it emitted itself for a
  RemotePlayer, `spawn` while `beginMatch` builds).
* **Client**: ids are resolved per field. **Required** ids (victim, target, spawned entity, pickup id, zone index) → the message is
  dropped (warn once) if unknown. **Optional** ids (attacker, owner, shooter) → `client.refOf(id)`: live entity, else the departed
  ref from `client.departed` (name/color/team kept, so the kill feed can still credit a player who left), else `null`. `apply`
  performs the state mutation the host's emitter performed, then `game.events.emit(name, payload)` so HUD, ModeHUD, WeaponSystem,
  Player and AutoTest listeners work unchanged.

| Event | Wire | Required / optional ids | Client mutation before emit |
|---|---|---|---|
| `damage` | `dmg` | t / a | target `health/armor` (+ `hpAt`) |
| `death` | `death` | v / a | victim `alive=false, health=0, lifeAt`, `onDeath(payload)`, scores (`scoreAt`), `ts`, `respawnAt` (net, re-converted per frame), attacker `health` |
| `spawn` | `spawn` | e / — | spawn / teleport, loadout for the local player |
| `pickup` | `pk` | p, e / — | availability, `nextRespawn`, `lastGrant`, health/armor |
| `weapon:fire` | `fire` | e / — | avatar muzzle flash (scheduled) |
| `explosion` | `exp` | — / o | — |
| `shove`, `splat`, `reflect` | same | target/victim / attacker, owner | — |
| `match:end` | `end` (direct NetHost message, A: sent by `endMatchMessage`, not a NetEvents entry — like `lobby`, `load`, `begin`, `ros`, `phase`, `sys`) | — / winnerId | via `netApplyMatchEnd` |
| `smoke` (ars) | `smoke {p, r, u, o}` | — / o | `combat.addSmoke(p, r, (u - hostNow)/1000)` |
| `esc:tier`, `esc:final` (modes) | `esc {e, tier, delta, w, cause, at}`, `escf {e}` | e / — | entity `tier`, `scoreAt` |
| `hill:*` (modes) | `hill {ev, z (zone index), team, prev, total, n, reason, ts?, at}` | z / — | koth state; `ts` → team scores (`scoreAt`) |
| storm strike (modes) | `storm {rod, warn}` | rod / — | `world.storm.beginStrike(rod, warn)` |
| `player:jump/land/grapple`, `weapon:switch`, `grenade:switch` | never replicated (local only) | | |

### 5.10 Damage claims [B]

Client (`NetClient.claimDamage(target, info)`, called by `Combat.applyDamage`):
1. Return 0 unless `info.attacker === game.player`, `target !== game.player`, `target.isProxy`, `target.alive`, not friendly,
   `match` exists, `!match.over`, `match.phase === 'live'`, local player alive. If `!CLAIM_WEAPONS.has(info.weapon)` → warn once per
   weapon and return 0 (rockets, grenades, explosions, splats are host-decided; a predicted copy must never produce a claim).
2. `ci = ++claimSeq & 0xffff`; queue `cl {ci, t: target.id, n: info.amount, w: info.weapon, h, p, d, kb?: info.knockback,
   st: target.shownT, ft: clock.hostNowMs()}`; emit `'hit:predicted' {target, weapon, headshot, ci}` (the HUD shows the marker and
   plays `hitmarker`/`headshot` in the frame of the shot, no damage number); return 0. Local tracers/sparks already happened in
   `fireBullet`/`fireArc`/`fireRail`/`_meleeStrike`.

Host (`NetHost.onClaim`), in order; any failure → drop, `clr {ci, why}` to the claimant, warn once per (peer, why), count
`stats.claims.rejected[why]`:

| Check | Rule (why) |
|---|---|
| late | `ft ≥ netNow - CLAIM_LATE_MS` (`late`) |
| shooter | `rp.alive`, or `rp` dead with `ft ≤ rp.deathNetMs + CLAIM_TRADE_MS` (shot fired before the death, delayed in transit) (`dead`) |
| target | exists, `alive`, not `rp`, not friendly (applyDamage re-checks protection/god/friendly/match over) (`target`) |
| weapon | `w ∈ CLAIM_WEAPONS`; `w === rp.weaponId` or `rp` switched within 0.5 s (melee always) (`weapon`) |
| amount cap | `n ≤ cap(w, h) × 1.02`: hitscan `damage × (h ? headshotMult : 1) × (smg ? 1 + speedBonus.damage : 1)`; rail `railDamage(def,1) × (h ? headshotMult : 1)`; arc `damage × 3` (tick batching); melee `MELEE.damage` (`amount`) |
| rate | token bucket per (peer, w): refill/s = `fireRate × pellets × (arc ? 1 + beam.chainMax : 1) × (rail ? pierce.entities : 1) × 1.3 + 2`, capacity = refill (absorbs a head-of-line burst of ≤ 1 s); melee 2/s (`rate`) |
| position | `s = sampleHistory(target, clamp(st, netNow - CLAIM_REWIND_MAX_MS, netNow))`; claim point within the target's hitbox volume inflated: horizontal ≤ `0.6 + CLAIM_POS_TOL_M + \|v_h(s)\| × I`, vertical in `[y - 0.4 - \|v_y\|·I, y + h + 0.4 + \|v_y\|·I]`, `I` = that peer's snapshot interval in s (`position`) |
| range | `dist(rp eye at netPos, p) ≤ R(w)`: arc `def.range + def.beam.chainRadius + 1` (chain targets sit up to 6.5 m past a 26 m impact, WeaponDefs.js:286-287, arc.js:84-117); melee 4 m; others `def.range + 3` (`range`) |
| knockback | melee only, `\|kb\| ≤ 6` (`kb`) |

Apply: `host._claimCtx = {rp, ci}`; `combat.applyDamage(target, {amount: n, attacker: rp, weapon: w, headshot: !!h, point, direction,
knockback: kb})`; clear `_claimCtx`. NetEvents `damage.toWire` adds `ci` when the payload's attacker is `_claimCtx.rp`, so the
claimant's HUD takes the damage number from the echo and does not show a second marker. Kill confirm stays authoritative (`death`).

### 5.11 Actions (mp-arsenal)

#### 5.11.1 Client interception (WeaponSystem call sites, never `owner === game.player` inside Projectiles)

| Client call site | Interception (`if (game.net && game.net.isClient)`) | Message |
|---|---|---|
| `WeaponSystem._fireRocket` → `spawnRocket` (1246) | `net.client.act.rocket(o, d)`: predicted copy (`pred=true, seq`), `ip` computed (§5.11.4) | `act {a:'rocket', s, t, o, d, ip?}` |
| `_throwGrenade` → `spawnGrenade` (1533), `_onDeath` drop (1564) | `net.client.act.nade(o, v, f, ty, drop)`: predicted grenade copy | `act {a:'nade', s, t, o, v, f, ty, drop}` |
| `_grenadeCookOff` → `detonate` (1549) | `net.client.act.cook(o, ty)`: no local effect (the host's explosion arrives mirrored with origin 0) | `act {a:'cook', s, t, o, ty}` |
| `_fireBlast` → `combat.blast` (1192) | `hooks.blast`: `galeSelfPush(game, player, origin, dir, b)` locally | `act {a:'gale', s, t, o, d, ads}` |
| `Projectiles.explode`, `Projectiles.detonate`, `GrenadeSystem.detonate` | defensive: return immediately on clients (presentation methods such as `vortexAcquire` still run) | — |

Predicted copies are marked `pred=true` and stepped by a visual-only integrator (rocket: `pos(t) = o + d·speed·(t − t0)`; grenade:
gravity + drag, world bounces via `world.raycast`): it never calls `combat.applyDamage`, `radialDamage`, `explode`, `detonate`,
`types.*`, never emits events and never plays sounds (`grenade_bounce` and explosions arrive mirrored). It may query
`combat.raycast` to stop at a NetAvatar (visual only).

#### 5.11.2 Host validation and execution

Every action runs inside `net.fx.open(0)` … `close()` (origin 0: the actor receives its own blast rings, reflect rings, cook-off
explosion; §6.2). Validation failures → drop + `actx {s, why}` (unicast, the client removes the predicted copy at once) + warn once.

| a | Validation | Execution |
|---|---|---|
| all | epoch; `t ≥ netNow - CLAIM_LATE_MS`; origin `\|o − E\| ≤ ACTION_ORIGIN_TOL_M + \|v\|·ACTION_ORIGIN_VEL_K` where `E` = `netPos + eyeOffset + v·clamp((t − rp.lastStateTHost)/1000, −0.1, 0.25)` (reported velocity extrapolation; the smoothed position is never used here); token bucket per (peer, a), capacity `ACTION_BURST` = 2, refill `fireRate × 1.3` (rocket 1.43/s, gale 1.5/s), nade 3/s (capacity 3), cook 1/s | |
| rocket | rp alive, or dead with `t ≤ deathNetMs + CLAIM_TRADE_MS` | `r = projectiles.spawnRocket({owner: rp, origin: o, direction: d}); r.ownerSeq = s & 255 \|\| 1; r.predKnockBy = ip ? rp : null; r.predIp = ip` |
| nade | alive or (`drop` and `t ≤ deathNetMs + DEATH_DROP_MS`); `ty` valid; `f ∈ [0.05, fuse(ty) + 0.05]`; `\|v\| ≤ throwSpeed(ty) + 3 + 0.4·\|rp.velocity\| + 3`; mirror count > 0 (warn only) | `spawnGrenade({owner: rp, origin: o, velocity: v, fuse: f, type: ty})`, `ownerSeq`; mirror count − 1 |
| cook | alive; `ty` cookable | `projectiles.detonate(ty, o, UP, rp)` |
| gale | alive | `galeBlast(game, rp, o, d, WEAPONS.gale.blast, !!ads, {selfPush: false})` |

#### 5.11.3 Rendering and adoption on clients

* Snapshot section 2 drives a render-only projectile list (reuses the pools of Projectiles). **Non-owned projectiles render on the
  entity timeline** (interpolated at `client.renderTimeMs()`, rockets linearly, grenades Hermite with velocity), so rockets reach
  and burst at the avatars as drawn, and their explosions (mirrored, scheduled at render time) coincide with them. Rocket trail =
  `effects.trail` per frame (derived); grenade beacon/spin/flightTick local.
* Vortex state `deploy`/`active`: on transition from flight → `fx.vortexAcquire(g)` (rig), `fx.vortexStick(g)` when the normal is
  non-zero, `g.center = pos + normal × 0.9`; `active` → hide model, positional `vortex_loop` loop; `fx.vortexTick(g, dt)` per frame;
  add to `types.wells`; on removal → `vortexRelease`, stop loop. Collapse visuals arrive mirrored. The C7 pull on the local player
  uses the NEWEST received vortex state (present), not the render timeline.
* **Own projectiles stay at the present.** The owner hides the host copy with `owner === me && ownerSeq === s & 255` and keeps its
  predicted copy. Adoption is time-aligned: each snapshot compares the host copy at its `tHost` with the predicted copy's position
  at that same host time (the copy keeps a 1 s history of `(tHost, pos)`). Rockets: switch to the host copy (entity timeline) only
  on direction divergence > `ADOPT_DIR_DEG` (Gale reflect, Vortex bend) or aligned position error > `ADOPT_POS_M`; otherwise the
  predicted copy flies to its end. Grenades: the aligned error is blended into the predicted copy as a decaying offset over
  `GRENADE_BLEND_S` (the copy never jumps back along its arc). The predicted copy is removed when its tagged explosion group is
  replayed or dropped (§6.4), on `actx`, when the host copy has been absent for `interpDelay + 100 ms`, or `PRED_TIMEOUT_S` after
  spawn without a host copy.

#### 5.11.4 Predicted self rocket-knock and explosion

At fire time the client casts the straight path against static geometry (`world.raycast(o, d, 6 s × speed)`, deterministic): if
the impact point `ip` lies within `splashRadius + 1` m of the player's chest and no active vortex well lies within `radius + 2` m of
the path, `act` carries `ip` (a knock is predicted). When the predicted copy reaches `ip` without stopping at a NetAvatar first, the
client applies the self knockback of `Combat.radialDamage` for itself (Combat.js:318-331: `knock × (0.35 + 0.65·f)` along
chest-from-center + `knock × 0.25 × f` up, with its LOS test) via `player.applyImpulse`, and plays the explosion locally
(`effects.explosion` + positional `explosion` at `ip`, not captured). If the copy stops at a NetAvatar, nothing is predicted.

Host: on explosion (`_updateRocket` hit or age-out), `mute = r.predKnockBy && r.owner === r.predKnockBy && r.predIp &&
center.distanceTo(r.predIp) ≤ PRED_KNOCK_MATCH_M && typeof r.owner.muteForces === 'function'`; if `mute`, `radialDamage` runs inside
`muteForces()/unmuteForces()` (damage still applies, every other entity's knockback is forwarded). `reflectProjectiles` clears
`predKnockBy/predIp` (a reflected rocket belongs to the reflector). The explosion's fx records are captured inside
`fx.group(rp.id, r.ownerSeq, …)`; the owner drops that group when it predicted the explosion for `s`, else replays it on arrival
(present timeline). Residual accepted edge case: the host rocket stops at an avatar that the client's copy missed (explosion not at
`ip` → no mute → a possible second knock if the owner is also within that explosion's radius).

### 5.12 Forces on remote humans [B; Vortex ars]

| Source (host) | Mechanism | Wire |
|---|---|---|
| `Combat.applyDamage` knockback → `target.applyImpulse(kb, info)` (Combat.js:262-265): explosions, melee claims, gale shove, static, kinetic, storm | `RemotePlayer.applyImpulse` accumulates + source `[info.weapon, info.seq]` | `imp {v, src}` |
| Vortex pull/lift (GrenadeTypes.js:229-251) | NOT on RemotePlayers (C7): the owner's client pulls itself from replicated wells; the host applies crush damage only | — |
| `launch` (none today: pads skip RemotePlayers) | `_pendingLaunch` | `lnch {v}` |
| Static shock `e.shock(s)` (352, 363) | `shockedUntil` in own block | snapshot |
| Spawn protection | own block | snapshot |

`NetHost.sendForces()` in `endFrame`: `lnch` then one `imp` per peer per frame when `|_pendingImpulse| > 1e-4` (then zero it and
its sources); pending forces of a dead, held or disconnected RemotePlayer are dropped. `net.simEnd()` asserts no RemotePlayer
velocity changed inside the sim window (warn once, restore): every force on a remote human must go through `applyImpulse`/`launch`.
Client: `player.applyImpulse(v)` / `player.launch(v)` immediately on receipt when the local player is alive (goes through
`PlayerController.impulse/launch`, PlayerController.js:206-232). No rewind.

**Fall backstop** (client, B): if the local player is alive with `position.y < world.killY` for `FALL_BACKSTOP_S` without a `death`,
send `fall {}` once; the host runs its kill-plane branch for `rp` (credit `lastAttacker` within 6 s, ring-out rule unchanged).
Normally unnecessary: the host kill plane reads `authPos` and samples are never rejected for being low.

### 5.13 Pickups, grants and the inventory mirror [B]

Host `Pickups._apply(p, rp)` calls the RemotePlayer methods; `heal/addArmor` stay Entity defaults (host-authoritative health/armor).

| RemotePlayer method | Predicate (mirror) | Mirror update | Grant |
|---|---|---|---|
| `giveWeapon(id)` | not owned → true; owned & finite `reserveMax` & not in `full` → true; else false; unknown id → false | owned.add; full.delete(id) | `{kind:'weapon', w:id}` |
| `addAmmo(id = null, f = 0.5)` | any owned finite weapon (or `id`) not in `full` → true | — | `{kind:'ammo', w:id, f}` |
| `addGrenades(n, type = 'frag')` | unknown type → false; `nades[type] < GRENADE_TYPES[type].maxCarry` → true | `nades[type] = min(max, +n)` | `{kind:'nades', n, ty:type}` |
| `setEscalationWeapon(id)` | always (unknown id → false) | owned = {pistol, id}; full.clear() | `{kind:'escw', w:id}` |

`grantCrate` (GrenadeTypes.js:73-91) works unchanged through `inventoryOf(rp) → rp.nades` and `rp.addGrenades`.
`NetHost.grant(rp, g)`: `g.s = rp.grantSeq = (rp.grantSeq + 1) & 255`; queued in rp's unicast batch. The mirror ignores packet
inventory fields while `packet.grantAck !== rp.grantSeq` (unless `mirrorResync`). Order: grants sit in the owner's unicast batch,
which is flushed before the broadcast batch carrying `pk` (§5.3), so the collector applies its grants before it sees `pk`.

Client grant registry (`client.onGrant(kind, fn)`), core entries: `weapon` → `weapons.giveWeapon(w)`; `ammo` → `weapons.addAmmo(w || null, f)`;
`nades` → `weapons.addGrenades(n, ty)`; `escw` → `weapons.setEscalationWeapon(w)`. Then `grantAck = s`. Unknown kinds → warn once.

### 5.14 Clock sync and time conversion

* Host net clock: `netNowMs() = performance.now() - t0` (continuous; unaffected by game.time clamps, hitches or hidden tabs).
* Host converts any game-time stamp before sending: `hostGameToNet(t) = netNowMs() + (t - game.time) × 1000` (respawnAt,
  spawnProtectedUntil, shockedUntil, pickup nextRespawn, smoke until, match startTime, liveAt); `Infinity` → `NET.NEVER`.
* Client offset: `PING {c}` → `PONG {c, h}`; `rtt = recv - c`; `sample = h + rtt/2 - recv`; keep 8 samples; target = sample with the
  minimum rtt; first → snap; then slew ±2 ms per pong; |Δ| > 250 ms → snap. `hostNowMs() = performance.now() + offsetMs`.
* **Clients keep host deadlines in net time** and re-convert them every frame in `client.refreshTimes()` (before `player.update`):
  `player.respawnAt`, `player.spawnProtectedUntil`, `player.shockedUntil` (own block), `match.startTime`, `match.liveAt`, pickups'
  `nextRespawn` (display), KOTH `left` (modes): `local = game.time + (netMs - hostNowMs())/1000`, `NET.NEVER` → `Infinity`/`-1`.
  The countdown → live switch compares `hostNowMs() >= liveAtNet` directly. Game time on clients advances at real rate (§7.1.2), so
  single conversions (smokes) stay accurate too.
* `match.timeLeft` on clients: from each snapshot (`timeLeft` ds − elapsed since `tHost`; `0xFFFF` → `Infinity`) and decremented by
  dt in `updateMatchClock`; `begin.match.timeLeft === -1` → `Infinity`.

### 5.15 Interpolation (clients) and smoothing (host)

* Samples: every snapshot pushes one sample per entity at `tHost` (host frame time); every CSTATE pushes one sample at the client's
  send-time estimate. Arrival lag per packet `lag = arrival(host time) − tHost` is recorded (`lagP95` in `report.net`).
* **DelayEstimator** (both sides): each consumer frame observes `age = now(host time) − newest.t` (one-way lag + interval sawtooth +
  frame alignment + clock error). `target = p95(age over DELAY_WINDOW_MS) + ½·interval + DELAY_MARGIN_MS`, clamped to
  `[INTERP_MIN_MS, INTERP_MAX_MS]` (client) or `[HOST_SMOOTH_MIN_MS, HOST_SMOOTH_MAX_MS]` (host). When `age > effective` (a late gap:
  we would extrapolate), `target` is raised at once to `age + ½·interval`. The effective delay chases the target upward at
  `DELAY_DILATION` (render time advances at ≥ 0.5× real time, never backwards) and decays at `DELAY_DECAY_MS_PER_S`.
* Clients: `renderMs = hostNowMs() − effective`. Hermite between the bracketing samples using replicated velocities (probe3: max
  3.3–10.7 cm at 30 Hz); yaw shortest arc; pitch/height linear; flags from the newer sample. `renderMs > newest.t`: extrapolate with
  velocity for at most ONE snapshot interval (16.7 ms at 60 Hz), then hold. Teleport bit / spawn event → reset.
* Host smoothing of RemotePlayers: the same estimator over state ages, extrapolation ≤ one state interval. The host renders and
  hit-tests (host-local shooters) the smoothed `position`; snapshots carry `netPos` (no double delay for other clients).
* Expected delays (60 Hz): LAN one-way 2–10 ms → client delay ≈ 35–45 ms, host smoothing ≈ 15–30 ms; Wi-Fi with 150–300 ms stalls →
  the estimator rises to ≈ 100–150 ms within one stall and decays over ~10 s.

### 5.16 Bandwidth budget (8 clients, 16 fighters)

| Stream | Per client | Host total |
|---|---|---|
| snapshots 60 Hz (30 Hz) | ≈ 32 KB/s incl. WS/TCP overhead (≈ 17 KB/s) down | ≈ 256 KB/s ≈ 2 Mbit/s (≈ 135 KB/s) up |
| JSON events + fx | 3–6 KB/s down | ≈ 40 KB/s |
| client state 60 Hz | 3.7 KB/s up | 30 KB/s down |
| JSON claims/fire/fx | 1–3 KB/s up | — |

---

## 6. Presentation mirroring [B]

### 6.1 Categories

| Category | Rule | Examples |
|---|---|---|
| Captured & mirrored | positional one-shot visuals and positional one-shot sounds produced inside a capture window, outermost call only; non-positional sounds only if in `TWIN_SOUNDS` inside a twin window | impacts, hit sparks, tracers, bot muzzle flashes, explosions, lightning bolts, arc hits, gale blast/rings, rail beams/rings/impacts, grenade bursts, smoke clouds, splats, positional sounds, twins of the local shooter's weapon sounds |
| Derived from replicated state | continuous or per-entity presentation computed on each machine | avatar pose/weapon, footsteps/jump/land/pad launches, slide/wall-run/grapple sounds and rope, arc beam channel + loop + light, rail charge glow + loop, projectile flight/trails/beacons/vortex rigs, shocked zaps, gibs + death sound, human muzzle flash + world flash light on `fire`, pickup availability/pulses, pad flashes, KOTH zone visuals, storm strikes |
| Local only (never mirrored) | camera shake/FOV, viewmodel, non-positional sounds outside `TWIN_SOUNDS` (kill_confirm, hitmarker, tier_up, hill_*, match_end, ringout, hurt, death), hit markers, HUD, grenade trajectory preview, smoke overlay, vortex vignette, `flashLight` calls made directly by WeaponSystem | |

### 6.2 Capture windows

| Machine | Window | Batch origin `o` | Anchor (muzzle rebase) | Twins | Excluded |
|---|---|---|---|---|---|
| host | host player's `weapons.update` — `net.fxBegin('weapons')` … `fxEnd()` in `Game.update` | host player id | host player | yes (`TWIN_SOUNDS` only) | `flashLight` (derived from `fire`) |
| host | `net.simBegin()`…`simEnd()` around bots, combat, projectiles, world, modes (§7.1.2) | 0 | `fx.anchor = bot.id` while BotManager updates that bot, else none | no | sounds `footstep, jump, double_jump, wall_jump, land, land_hard, mantle, bot_death, jumppad` (derived) |
| host | NetHost action execution (§5.11.2) | 0 (the actor receives it) | rp (only muzzle-origin records) | no | — |
| client | own `weapons.update` | own entity id | own player | yes (`TWIN_SOUNDS` only) | `flashLight` (derived from `fire`) |
| suspended (nesting counter) | every `game.events.emit` (listeners: HUD, ModeHUD, Game._onDeath → endMatch, WeaponSystem._onDeath, Player hurt); `Combat.kill → target.onDeath`; `World.update → storm.update`; `FxMirror.replay`; `Avatar` derived presentation | | | | |

Everything else (player.update, updateCamera, RemotePlayer/NetAvatar updates, message replay, effects/audio/hud updates) runs
with capture closed.

### 6.3 Wrapped methods and record formats

`FxMirror.install()` calls `getRailBeams(game)` (no-cost guard; WeaponSystem.init already creates it, WeaponSystem.js:353), then
replaces these instance methods with wrappers (`if (open && depth === 0 && suspend === 0 && allowed(name)) record; depth++; try
{orig} finally {depth--}`) and wraps `game.events.emit` with `suspend++ … suspend--`:

| Target | Method | Record |
|---|---|---|
| `game.effects` | `impact(point, normal, surface)` | `['I', px,py,pz, nx,ny,nz, surface]` |
| | `hitSpark(point, normal, entity)` | `['H', px,py,pz, nx,ny,nz, entityId\|0]` |
| | `tracer(from, to, {color, width})` | `['T', fx,fy,fz, tx,ty,tz, color, width, a]` |
| | `muzzleFlash(position, direction, {scale, color})` | `['M', px,py,pz, dx,dy,dz, scale, color, a]` |
| | `flashLight(position, color, intensity, distance, duration)` | `['L', px,py,pz, colorInt, intensity, distance, duration]` (sim windows only) |
| | `explosion(position, {radius, normal})` | `['X', px,py,pz, radius, nx,ny,nz \| null]` |
| | `dust(position, {amount})` | `['D', px,py,pz, amount]` |
| | `lightning(from, to, o)` | `['B', fx..,tx.., {color, core, width, life, jitter, forks, restrike}]` |
| | `arcHit(point, normal, entity)` | `['A', px..,  nx..\|null, entityId\|0]` |
| | `galeBlast(origin, dir, {range, halfAngle})` | `['G', ox..,dx.., range, halfAngle, a]` |
| | `galeRing(point, normal, {size, white, life})` | `['R', px..,nx.., size, white, life]` |
| `getRailBeams(game)` | `add(from, to, {power})` / `rings(from, dirUnit, length, power)` / `impact(point, normal, power)` | `['RB', …, a]`, `['RR', …]`, `['RI', …]` |
| `game.projectiles.types.fx` (GrenadeFX) | `vortexCollapse(center, R)`, `staticBurst(center, chests, R)`, `kineticBlast(center, R)`, `splat(pos)`, `smokeCloud(center, radius, duration)`, `bolt(from, to, o)` | `['VC',…]`, `['SB', cx,cy,cz, [[x,y,z]…], R]`, `['KB',…]`, `['SP',…]`, `['SC',…]`, `['GB',…]` |
| `game.audio` | `play(name, {position, volume, rate})` with position | `['P', name, x,y,z, volume, rate]` |
| | `play(name, opts)` without position, inside a twin window, `TWIN_SOUNDS.has(name)` | `['S', name, volume, rate]` (anchored to the batch origin) |

`a` = muzzle anchor entity id: set when the record's start point is within 0.35 m of the anchor's muzzle at capture time (host
player / client: `weapons._muzzleWorld(tmp)`, WeaponSystem.js:1305, the point `tracerFrom`/`galeBlast`/`RailBeams.add` use; bot:
`bot.model.getMuzzleWorldPosition(tmp)`), else 0. Not wrapped (derived or local):
`channel, trail, gibs, playLoop`, GrenadeFX `vortexAcquire/vortexRelease/vortexTick/vortexStick/zap/flightTick`, Storm, Sky,
WeaponSystem viewmodel flash. Colors serialize as ints (`new THREE.Color(c).getHex()`). Batch = `{t: capture net time, r: records,
g: [[ownerId, seq, from, to], …]}` (groups from `fx.group`).

### 6.4 Replay rules (no loops, no doubles, one timeline)

1. `replay(records, originId)` sets `suspend++`, calls the stored ORIGINAL functions, then `suspend--`; nothing replayed is ever captured.
2. Nested calls inside a wrapped method are never captured (`depth` > 0): e.g. `impact` → its own `impact_*` sound, `muzzleFlash` →
   its `flashLight`, `hitSpark` → `flashHit` + `impact_robot`, `explosion` → shake. They replay because the outer call replays.
3. Entity ids resolve with `getEntityById`; unknown → `null` (hitSpark still sparks). `hitSpark/arcHit` on the receiver's own player skip sparks (Effects fix).
4. `'S'` twins play `audio.play(name, {position: avatar.muzzle(), volume: 0.9·v, rate})` at the origin entity; skipped if the origin is the receiver.
5. Host relays client batches verbatim (with their `t`) in the broadcast batch as `fx {o: rp.id, t, r, g}`; clients drop `o === me`.
   Host sim/action captures are broadcast as `fx {o: 0, t, r, g}`; the host player's weapon captures as `fx {o: hostId, t, r}` —
   one batch per origin per frame.
6. **Muzzle rebase (mandatory):** records with `a > 0` replay their start point from `avatar.muzzle()` of entity `a` (bots included);
   if `a` is unknown or is the receiver's own player, the captured point is used.
7. **Scheduling:** clients replay a batch when `client.renderTimeMs() ≥ batch.t` (the entity timeline; bursts spread out as
   captured), or immediately if it is older than `INTERP_MAX_MS`. Exception: a group tagged `(me, seq)` (my own projectile) is
   dropped if I predicted that explosion (§5.11.4), else replayed on arrival (present timeline) together with the removal of my
   predicted copy. The host replays a client batch when `netNow − rp.delay.effectiveMs ≥ t` (its own smoothed timeline) and
   relays it immediately. `fire` messages follow the same scheduling.
8. Duplicate detector (tests, §6.6).

### 6.5 Human vs bot presentation (who produces what on a viewer's screen)

| Presentation of shooter S on viewer V ≠ S | S = bot | S = host player | S = client human |
|---|---|---|---|
| fire sound | captured `'P'` (Bot._fire 761) | twin `'S'` | twin `'S'` |
| world muzzle flash + light | captured `'M'` (Bot._fire 763, rebased to the bot's avatar muzzle) | derived from `fire` event | derived from `fire` event |
| tracers / impacts / sparks | captured (tracer rebased) | captured (host weapons window, rebased) | captured by client, relayed (rebased) |
| reload / switch sounds | captured when the host camera is near (Bot._playNear culling) | twins | twins |
| arc beam + light | derived (`beaming` + `bot.beamEnd`) | derived | derived |
| rail charge | glow captured (`chargeGlow`→`muzzleFlash`), loop derived | derived glow + loop | derived glow + loop |
| movement sounds | derived | derived | derived |
| death | derived (gibs + `bot_death`) | derived | derived |

### 6.6 Duplicate detector (tests)

While autotest is active, FxMirror logs every `effects.*` / `audio.play` call on the page as `(name, position rounded to 0.5 m, 50 ms
bucket)`. `report.net.fx.dupes` lists keys seen twice. Suites fail on any duplicate of `explosion` (effect or sound), `X/VC/SB/KB/SC`
records, weapon fire sounds, rail beams or muzzle lights; on `match_end` played more than once per page; and on `kill_confirm` on a
page other than the killer's. Other duplicates (e.g. shotgun pellet impacts) are reported, not failed.

---

## 7. Match lifecycle

### 7.1 Game.js refactor [A]

#### 7.1.1 Frame and host tick

```js
_loop(nowMs) {                        // rAF path
  requestAnimationFrame(this._loop);
  if (this.state === 'playing' && this.frameLimiter && this.frameLimiter.shouldSkip()) return;   // wave-1 render limiter, first
  const t = performance.now();
  if (this._lastRafMs) this._rafIntervalEma = this._rafIntervalEma * 0.9 + (t - this._lastRafMs) * 0.1;
  this._lastRafMs = t;
  this._frame(this.net.online ? t : nowMs, true);   // online: one clock for rAF and Worker frames; offline: today's rAF timestamp
}
_hostTick() {                          // HostTicker message, online only
  const now = performance.now();
  const since = now - this._lastFrameEndMs;
  if (since < NET.TICK_COALESCE_MS) return;                          // ticks queued behind a stall collapse into one frame
  const stalled = document.hidden || now - this._lastRafMs > NET.RAF_STALL_MS;
  const boost = this.net.isHost && this._rafIntervalEma > NET.HOST_BOOST_RAF_MS && since >= NET.HOST_TICK_MS - 1.5;
  if (stalled || boost) this._frame(now, false);                     // sim + net, no render: host tick >= ~60 Hz (C8)
}
_frame(nowMs, render) {               // body of today's _loop (720-765)
  const net = this.net;
  const now = nowMs / 1000;
  let raw = this._lastFrameTime ? now - this._lastFrameTime : 1 / 60;
  this._lastFrameTime = now;
  if (net.online) { if (!(raw >= 0)) raw = 0; } else if (!(raw > 0)) raw = 1 / 60;   // online never invents 16.7 ms
  if (raw > 0.25) raw = 0.25;
  this.realTime += raw;
  this.simHz = this.simHz * 0.93 + (1 / Math.max(raw, 1e-3)) * 0.07;   // every _frame (report.net)
  if (render) {                                                      // render frames only
    this.fps = net.online ? 1000 / this._rafIntervalEma : this.fps * 0.93 + (1 / raw) * 0.07;   // offline: exactly 728
    this.renderer.info.reset();
  }
  this.input.update();
  this._guard(() => net.beginFrame(raw));
  try {
    const dt = net.online ? Math.min(raw, NET.DT_MAX) : Math.min(raw, 0.05) * this.timeScale;   // offline: identical to 733
    /* state switch exactly as today (734-756); 'ended' uses dt */
  } catch (err) { this._reportFrameError(err); }
  this._guard(() => net.endFrame(raw));                              // snapshots / state / JSON leave BEFORE render
  if (render) this._guard(() => this.render());
  if (this.autotest) this._guard(() => this.autotest.frame(raw));
  this.input.endFrame();                                             // always runs: stale edges never leak into the next frame
  this.frame++;
  this._lastFrameEndMs = performance.now();
}
// _guard(fn): try { fn() } catch (err) { this._reportFrameError(err) }
```
Offline trace: raw from the rAF timestamp, beginFrame/endFrame no-ops, render after the state switch, autotest.frame, input.endFrame —
identical to today. The HostTicker is installed only while online (R15).

#### 7.1.2 Update (sub-steps; offline n = 1 and identical order)

```js
update(dt) {
  const net = this.net;
  const n = net.online && dt > NET.SUB_STEP_MAX ? Math.min(NET.SUBSTEPS_MAX, Math.ceil(dt / NET.SUB_STEP_MAX - 1e-9)) : 1;
  const h = dt / n;
  const dp = net.online ? Math.min(dt, NET.PLAYER_DT_MAX) : dt;      // player + weapons: once per frame (edges read once;
                                                                     // Player's 120 Hz accumulator caps a call at 10 steps)
  const counting = !!(this.match && this.match.phase === 'countdown');   // undefined phase offline -> false
  for (let i = 0; i < n; i++) {
    this.time += h;
    if (i === 0) {
      if (this.autotest) this.autotest.update(dt);                   // dt === h offline
      net.client && net.client.refreshTimes();
      if (!this.spectate) {
        this.player.update(dp);                                      // frozen during the countdown (Player.update)
        net.fxBegin('weapons'); this.weapons.update(dp); net.fxEnd();
      }
      net.updateRemotes(dt);                                         // interpolation (time-based) + FX replay queue
    }
    net.simBegin();
    if (net.authority) { this.bots.update(h); this.combat.update(h); }   // bots: model-only during the countdown
    this.projectiles.update(h);
    this.world.update(h);
    if (!counting) this.modes.update(h);                             // KOTH phases start at 'live'
    net.simEnd();
    if (i === n - 1) this.effects.update(dt);
    this._updateMatch(h);                                            // returns early during the countdown (no timer, no respawns)
  }
  this._updateCamera(dt);                                            // online client awaiting deploy: _updateOverviewCamera(dt)
  this.weapons.updateViewModel(dt);
  this.audio.update(dt);
  this.hud.update(dt);
}
```
Offline trace: time, autotest, player, weapons, bots, combat, projectiles, world, modes, effects, `_updateMatch`, camera, viewmodel,
audio, hud — identical to Game.js:769-785 (all net calls are no-ops, `counting` is false, n = 1, dp = dt). Online clients no longer
lose time below 20 fps: the world sub-steps real time and the local player gets up to 100 ms per frame.

#### 7.1.3 New lifecycle methods

| Method | Runs on | Contract |
|---|---|---|
| `async netLoadMatch(cfg)` | host (from `net.start()` inside the Start click, so `input.requestLock()` works) and clients (from `load`) | Captures `epoch = net.epoch` and `gen = net.sessionGen`. `audio.unlock()`; host: `input.requestLock()`; `state='loading'`, `input.enabled=false`, `hud.show(false)`, `menu.showLoading('Loading '+name, 0)`; `_clearMatch()`; `await nextFrame()`; world `load` (onProgress → `net` sends `prog {p, vis}` ≤ 4 Hz) or `reset` when the map is loaded; `_syncViewLighting()`; authority: `await bots.prepare(world)`; `await warmup(true)` (wave-1 prewarm incl. BotModel + `hud.prewarm`; else create one hidden `BotModel` before warmup); **after every await: `if (epoch !== net.epoch \|\| gen !== net.sessionGen) return false`** (leave/kick/host-left while loading must not paint the loading overlay over the hub). Ends with `menu.showLoading('Waiting for players', 1)` (host: `menu.net.loadingActions()`); returns true. MUST NOT write settings. All yields are hidden-safe (§2.2 utils). |
| `netBeginMatch(b)` | clients (full), host (tail only) | **Client**: first `net.onClearMatch()`, `entities.length = 0`, `_byId.clear()`, `projectiles.clear()`, `combat.smokes.length = 0`, `player.reset()` (a same-epoch rejoin arrives with a live match). Then `this.match = {...b.cfg, mapName, timeLeft (−1 → Infinity), teamScores, over:false, reason:null, winner:null, winnerId:0, winnerTeam:0, playerWon:false, results:null, startTime: local(b.match.startT), phase, liveAt, online:true, epoch, ladder, pool}`; `player.name/team/color` from its roster row, `addEntity(player, b.you)`, one `NetAvatar` per other row (never `b.you`), `weapons.onMatchStart()`, apply `ents` (alive, hold, position, K/D/streak/tier/zoneTime, respawnAt), `pickups` (`nr` −1 → Infinity), `smokes`, extension fields; `grantAck = b.grantSeq`; own `spawn` if present (§7.2.7) else `player.alive = false` and `client.awaitingDeploy = b.deploy`; finally `client.inMatchEpoch = b.e`. **Host**: NetHost.beginMatch built `this.match` (same fields), created the entities and spawned everyone; only the tail runs. **Tail (both)**: `hud.onMatchStart(match)`, `menu.hideLoading()`, `menu.hide()`, `hud.show(true)`, `state='playing'`, `input.enabled=true`, `input.capture=true`, `audio.play('match_start')`, `events.emit('match:start', match)`. Countdown: NetSession.endFrame emits `net:countdown` and `hud.announce(String(n), 'GET READY', 'info', 900)` once per whole second until `liveAt`, then `match.phase='live'` and `hud.announce('FIGHT', mapName.toUpperCase(), 'info', 1400)`. |
| `netApplyMatchEnd(msg)` | clients | `m.over=true; reason; winnerId; winnerTeam; teamScores (scoreAt); departed`; `m.results = msg.results.map(r => ({...r, isLocal: r.id === player.id, isPlayer: r.id === player.id}))` (same for departed); `m.winner = client.refOf(winnerId)`; `m.draw = !isTeamMode(mode) && !winnerId`; `playerWon = team mode ? winnerTeam === player.team : winnerId === player.id`; `state='ended'`, `_endTimer = NET.OUTRO_S`, `input.enabled=false`, `audio.play('match_end')`, `events.emit('match:end', m)`. Existing 'ended' branch shows the end screen after the outro (no timeScale). |
| `netReturnToLobby()` | all | `_clearMatch(); player.reset(); player.alive=false; weapons._resetState(); audio.stopAllLoops(); client.inMatchEpoch=-1; state='menu'; input.enabled=false; input.capture=false; input.exitLock(); hud.show(false); menu.net.showLobby()`; apply a deferred quality change. |
| `openMatchMenu()` / `closeMatchMenu()` | online | §7.4 |

### 7.2 Sequences

Notation: H = host tab, R = relay, C = client tab. All JSON on `PKT.JSON` unless marked `[ctl]` (relay control plane).

#### 7.2.1 Host creates a room
1. H Menu: MULTIPLAYER → Host → setup screen in host mode → CREATE ROOM → `net.hostRoom(cfg, {name, public, maxPlayers, code: settings.mpLastCode || null})`.
2. H `[ctl] host{v, name, max, public, code?, meta}` → R `hosted{code, peer:0, max}` (`code-taken` → retry without a code). H:
   `role='host'`, `settings.set('mpLastCode', code)`, `clock.startHost()`, `fx.install()`, `HostTicker.start()`, `setHiddenTick`,
   plugins `install(net)`, NetHost subscribes to game events, `phase='lobby'`, `fetch('/api/lan')` → `room.urls/lan`,
   `transport.meta(...)`, `beforeunload` guard armed when ≥ 1 client (§7.2.13), `net:lobby`.

#### 7.2.2 Client joins
1. C boots from `http://HOST-IP:8000/` (optionally `#join=CODE`), MULTIPLAYER → name + code / room list (`net.listRooms()`) → `net.joinRoom(code, {name})`.
2. C `[ctl] join{v, code, name, token?}` → R `joined{code, peer, token, rejoin, room}` to C, `peer-join{peer, name, addr, rejoin}` to H.
   C writes the rejoin record.
3. C → H `hello{v, build, name, sid, rejoin:false, pick}`; H: kicked-sid check, build check, sanitize/dedupe name, lobby row,
   `welcome` (unicast, with `cg`), `lobby` (broadcast), `sys join`.
4. C: `role='client'`, `fx.install()`, `HostTicker.start()`, `setHiddenTick`, plugins, pings, `nq`, `phase='lobby'` (or late join §7.2.14).
Errors: relay `error{reason}` → `net:error` (`no-such-room|room-full|room-locked|already-in-room|version-mismatch|bad-code|bad-message`);
socket failure → `cannot-connect` (hub shows the LAN checklist, §8.2); `welcome.err='build'` → "The host updated KINETIC — Reload";
`welcome.err='kicked'` → "Removed by the host".

#### 7.2.3 Lobby updates
Clients send `ready/team/pick`; H updates and re-broadcasts `lobby` (debounced 100 ms) and `transport.meta`. H `setConfig(cfg)` →
`lobby`. `pings` 1 Hz; `nq` 1 Hz from clients.

#### 7.2.4 Start and load barrier
1. H START (click) → `net.start()`: `epoch = (epoch+1) & 255`, cfg frozen (+ wave-1 `pool`, `snapHz`), `phase='loading'`, broadcast
   `load{e, cfg}`, `game.netLoadMatch(cfg)` (lock requested in the gesture).
2. C on `load`: `game.netLoadMatch(cfg)`; `prog {p, vis}` ≤ 4 Hz; on completion `loaded`. A hidden client loads at Worker-tick pace
   (hidden-safe yields), not at the 1 Hz of throttled timers.
3. H `checkBarrier()` each frame: `hostLoaded && (every lobby peer loaded || now > start + LOAD_TIMEOUT_S || forced)` →
   `beginMatch(loadedPeers)`. After `FORCE_START_AFTER_S` the host's loading overlay offers "Start without Sam" (`net.forceBegin()`).
   Stragglers become late joiners when their `loaded` arrives. Overlay text: `Waiting for players 2/3 — Sam 62% (in background)`.

#### 7.2.5 Begin, roster, spawns
1. H `NetHost.beginMatch`: `_building = true` (suppresses `spawn` broadcasts); `_nextEntityId=1`; `Teams.planMatch`; host player
   `reset`, name, `addEntity(player, 1)`, team/color; `RemotePlayer` per loaded peer (`addEntity(rp, id)`, `rp.loadoutPick`);
   `bots.spawnBots(n, diff, mode, {teams: plan.botTeams, reservedNames})`; `weapons.onMatchStart()`; zero K/D/streak/tier/zoneTime;
   `modes.onMatchStart(match)`; `respawnEntity(e)` for all; `match.phase='countdown'`, `liveAt = now + COUNTDOWN_S`; per peer
   `begin` (`buildBegin(peer)`, with its own `spawn` block, `deploy:false`) into its unicast batch; `_building = false`;
   broadcast `phase{ph:'countdown', at: liveAt}`; `game.netBeginMatch(null)` (tail only); `phase='playing'`.
2. C `netBeginMatch(begin)` (its `begin` arrives before any broadcast of that frame).
3. Snapshots start at the next `endFrame`.

#### 7.2.6 Countdown and CLICK TO PLAY
* `phase='countdown'` for `COUNTDOWN_S`: players frozen (Player.update), weapons idle (WeaponSystem.js:840), damage off (Combat),
  bots model-only (BotManager), no pad launches and no pickup collection (World/Pickups), match timer and modes not advancing.
* Everybody switches at `liveAt` (clients: `hostNowMs() >= liveAtNet`; a client that stalls for 300 ms during the countdown still goes
  live within 50 ms of the host). H broadcasts `phase{ph:'live', at}` when it switches.
* Pointer lock cannot be requested from a network message (Input.js:184-185): while `state==='playing' && !input.locked`, the HUD
  shows CLICK TO PLAY (ui panel; core keeps the existing hint HUD.js:955-975); the canvas click handler (Game.js:257-262) requests the
  lock. The host does not wait for clicks.

#### 7.2.7 Death and respawn [B]
* H `Combat.kill` → `onDeath` (fx suspended) → `'death'` → Game scoring (modes.onDeath guarded) → NetHost `death` (post-scoring
  values, `ra = hostGameToNet(victim.respawnAt)`, `ahp`, `ts` in team modes).
* C `applyDeath`: apply `ts` (`scoreAt`), then `victim.alive=false`, `health=0`, `lifeAt=at`; local player: `player.onDeath(payload)`
  (death cam, loops), `ownLifeAt = at`, `respawnAtNet = ra`; avatar: `onDeath` (gibs); scores; attacker health; emit `'death'` (HUD
  feed/overlay, match point on the correct team score, WeaponSystem._onDeath → cooked grenade drop → `act nade drop`).
* H `_updateMatch` respawns at `respawnAt` (skipped while `netHold`) → `respawnEntity(rp)` → `rp.spawn` (spawnSeq++) →
  `spawn{e, p, y, ss, pu, lo?}` with `lo = game.modes.isEscalation ? game.modes.escalation.loadoutFor(rp) : undefined` — never in any
  other mode (R12).
* C own spawn: `player.spawn(p, y)`; `spawnProtNet = pu`; `ownLifeAt = ownHpAt = at`; `weapons.onPlayerSpawn(lo \|\| resolveLoadout(match.pool,
  settings.get('playerLoadout')))` (wave-1 names); `stateSpawnSeq = ss`; the next 3 state packets carry `teleport`; `awaitingDeploy =
  false`; emit `'spawn'`. A `spawn` with `ss === stateSpawnSeq` already applied is ignored.

#### 7.2.8 Pickups [B]
Host collects for every alive entity (RemotePlayer via `authPos` and mirror predicates, §5.13; none during the countdown) → grants
(unicast) → `pk` (broadcast) → clients update availability/next respawn (`eventAt`) and emit `'pickup'` (HUD toast on the
collector's machine). Snapshot section 1 re-syncs availability (older-than-event bits ignored).

#### 7.2.9 Match end
H `endMatch(reason)` (inside `'death'` for score limits, or `_updateMatch` for time): results with ids, `winnerId` (0 = FFA draw
online), no timeScale online, `_endTimer = OUTRO_S`. NetHost defers `end` to the end of the frame's broadcast batch (after the
frame's `dmg`/`death`, fixing the BACKLOG banner-overwrite ordering on clients); `results`/`departed` rows are serialized without
`isLocal`/`isPlayer`. Clients `netApplyMatchEnd`. After the outro every machine shows the MP end screen; the host stops simulating
(as today) but keeps the session.

#### 7.2.10 Rematch / back to lobby
H REMATCH → `net.rematch()` = `start()` with the same cfg (new epoch; `world.reset()` fast path, 1.86 s measured). H BACK TO LOBBY →
broadcast `lobby` with `phase='lobby'` → everyone `netReturnToLobby()`. Ready flags reset. END ROOM → `endRoom()` → relay closes the room.

#### 7.2.11 Leave [A basic removal; B departed rows, policies]
C: `bye` then `transport.leave()`; `game.quitToMenu()`; hub. H: on `bye`/`peer-leave(reason 'left')` → `policy.onLeave(rp)` (modes may
re-add a bot), remove the RemotePlayer (`removeEntity`, dispose), keep its row in `match.departed`, `ros{rem:[{id, name, color, team,
kind}]}`, `sys leave`, `lobby`.

#### 7.2.12 Kick [B]
H `net.kick(peer)` → `kickedSids.add(sid)` → `[ctl] kick` → R closes C (4001). C: `net:closed{reason:'kicked'}` → rejoin record deleted
(the wave-1 transport also clears its token) → `quitToMenu` + hub "Removed by the host". H removes immediately (no grace). A reload
of the kicked tab joins as a new peer and its `hello` (same sid) is answered `welcome{err:'kicked'}` + kick.

#### 7.2.13 Host leaves
R `room-closed{reason:'host-left'}` / close 4000 → C `net:closed{reason:'host-left'}` → `quitToMenu()` → hub "The host ended the game"
with a **Rejoin KXQV** button (a deep-link page auto-retries `join` for 60 s, useful when the host re-hosts the same code). Guards
against accidents: while hosting with ≥ 1 client, and as a client during a match, NetSession registers `beforeunload`
(`e.preventDefault(); e.returnValue = ''` — the browser shows its generic prompt); the in-game "Leave match" / "END ROOM" buttons
confirm with explicit text ("End the game for 3 players?", ui). The host re-hosts with `mpLastCode` when it is free. No host migration.

#### 7.2.14 Late join, stragglers, rejoin attach — the deploy gate [B]
1. C joins during `phase ∈ {loading, playing}`; H `welcome{phase, epoch, cg}`; if `cfg.lateJoin` (or the peer was in the lobby at start):
   unicast `load{e, cfg}`; else C waits in the lobby ("You'll join the next match").
2. C loads → `loaded` → H `attachLate(peer, entity = null)`:
   * `plan = policy.onLateJoin(peer, Teams.planLateJoin(...))` (modes: optional bot replacement, `bots.removeBot(bot)` + `ros{rem}`);
   * `RemotePlayer` with the next id (or the rebound entity), `alive = false`, `netHold = true`, `awaitingDeploy = true`,
     `deployDeadline = netNow + DEPLOY_TIMEOUT_S`, `spawnProtectS = LATE_SPAWN_PROTECT_S`;
   * `begin` (full state: roster incl. the joiner, match clock/scores/phase, ents, pickups + next respawns, smokes, extensions incl.
     KOTH state, `firstBlood`, `grantSeq: rp.grantSeq`, `spawn: null`, `deploy: true`) into the peer's unicast batch;
   * `ros{add:[row]}` into the broadcast batch (flushed after the unicast `begin`; the joiner ignores its own row); `sys join`.
3. C `netBeginMatch(begin)`: no own entity alive; overview camera; HUD "CLICK TO DEPLOY" (ui). C sends `deploy` on the first of:
   pointer lock acquired, canvas click, AutoTest auto-deploy (0.5 s), or immediately if `input.locked` (socket-drop rejoin).
4. H `onDeploy(peer)` (or the deadline): `awaitingDeploy = false; netHold = false; respawnEntity(rp)` → `spawn` (broadcast) → C applies
   its own spawn with 3 s of protection. Until then the entity is not alive: not hittable, not targetable, excluded from spawn scoring.

#### 7.2.15 Disconnect and reconnect (transport-owned; rebind policy = modes)
* **Transport**: a client whose socket drops is rejoined by the wave-1 `WsRelayTransport` itself (state `'reconnecting'`, retries
  250 ms–3 s, dead-link detection 5 s + 10 s, `reconnectWindow` = `RECONNECT_GRACE_S`, token in sessionStorage, same peer id). NetSession
  maps `'reconnecting'` → `status='reconnecting'`, `reconnectUntilMs`, input disabled, HUD "CONNECTION LOST — reconnecting (42 s)";
  on `'in-room'` with `{rejoin:true}` it sends `hello{rejoin:true, sid, build}`. Close 4002 (`replaced`: the same token joined from
  another tab, e.g. Chrome "Duplicate tab" copies sessionStorage) is terminal: "This game was opened in another tab"; no auto-rejoin.
  `reconnect-failed` → hub.
* **Host side**: `peer-leave{reserved:true}` → `policy.onDrop(rp, info)` (core default: remove like a leave; modes: keep the slot):
  `rp.connected=false`, `alive=false` silently (no death event, `respawnAt=-1`, `netHold=true`), flags2 `disconnected`, `sys drop`.
  `peer-leave{reason:'expired'}` (relay reservation over) → removal as §7.2.11.
* **Soft drop** (A, silent client: frozen tab, half-open Wi-Fi — the browser keeps answering relay pings, so the relay may never
  notice): an alive RemotePlayer with no CSTATE for `SOFT_DROP_MS` → `softDropped = true`, `alive = false` silently, `netHold = true`
  (not hittable, not targetable, immune), avatar hidden on every machine (snapshot alive bit, no gibs); a dead one only gets
  `netHold = true` (its respawn timer waits). The next valid packet restores it at its reported position (teleport hold), no spawn
  event, no death counted.
* **Rebind** (`hello{rejoin:true}` with a known `sid` for a held entity; `policy.onRejoin` returns true). Normative checklist
  (copied into the JSDoc of `policy.onRejoin`):
  1. `rp.cg = (rp.cg + 1) & 255` (sent in `welcome.cg`; packets of the old connection are dropped);
  2. `rp.lastStateSeq = -1` (the reloaded client restarts `seq` at 0);
  3. `rp.grantSeq = 0; rp.mirrorResync = true` (`begin.grantSeq = 0` → client `grantAck = 0`; the next packet re-seeds the mirror);
  4. drop `_pendingImpulse/_pendingLaunch/_impSrc`; `softDropped = false; connected = true`;
  5. keep id, name, color, team, K/D/streak/tier/zoneTime;
  6. `attachLate(peer, rp)` (deploy gate; the respawn advances `spawnSeq`, which the client echoes);
  7. same epoch and C's world matches → no `load`; else unicast `load`; `sys rejoin`.
* **Reload**: within the grace, boot reads the rejoin record, skips the backdrop map, joins the code (the transport reuses the
  token → same peer) and sends `hello{rejoin:true}`; a build mismatch reloads once (sessionStorage flag) instead of rejoining.

### 7.3 Epoch, generation and staleness guards

* `net.epoch` increments on every `start/rematch`; `netLoadMatch` aborts after any await when the epoch or `net.sessionGen` changed.
* Clients process in-match kinds and snapshots only when `client.inMatchEpoch === net.epoch` (R16); snapshots with another epoch are
  dropped; the host drops CSTATE of another epoch or connection generation.
* Ordering: unicast before broadcast per frame (§5.3); reliable JSON is FIFO per connection; latest-wins snapshots may be overtaken
  by reliable packets at the relay (wave-1 protocol.js), which the `at` guards absorb.
* Field groups and their guards (client; `at` = the event's host net time, snapshot applies only if `snap.tHost > at`):

| Group | Set by events | Snapshot field(s) |
|---|---|---|
| own life | `death`, `spawn` (`ownLifeAt`) | `alive` bit NEVER applied (warning only); `protectedUntil` |
| own health | `dmg`, `pk`, `death`, `spawn` (`ownHpAt`) | `health`, `armor` |
| avatar life | `death`, `spawn` (`lifeAt`) | entity `alive` bit |
| avatar health | `dmg`, `pk`, `death`, `spawn` (`hpAt`) | — (not in snapshots) |
| per-entity score | `death`, `esc`, `end` (`scoreAt`) | kills, deaths, tier, zoneTime |
| team scores | `death.ts`, `hill.ts`, `end` (`scoreAt`) | `teamScore1/2` |
| phase | `phase`, `end` (`phaseAt`) | `phase` |
| pickups | `pk` (`eventAt` per pickup) | section 1 bits |

### 7.4 No pause online, match menu, hidden host, timeScale [A]

| Trigger | Offline | Online |
|---|---|---|
| pointer lock lost (Game.js:248-250) | `pause()` | `if (!_matchMenu && !autotest && !lockUnavailable) openMatchMenu()` |
| Esc/P keydown (252-255) — Game's listener runs before Menu's (registered in the constructor; Menu.init runs later at boot) | `pause()` | `if (_matchMenu) return;` (Menu's handler owns closing) else `if (!input.locked \|\| e.code==='KeyP') { input.exitLock(); openMatchMenu(); }` |
| `visibilitychange` hidden (271-276) | `pause()` | `input.exitLock(); if (!_matchMenu && !autotest) openMatchMenu()`; the sim keeps running (HostTicker) |
| `openMatchMenu()` | — | idempotent: `if (_matchMenu) return; _matchMenu=true; input.enabled=false; input.capture=false; input.clearAll(); menu.showPause()` (MP variant); state stays `'playing'` |
| Resume button / Esc in the menu (Menu.js:348: `if (g.state==='paused') g.resume(); else if (g._matchMenu) g.closeMatchMenu();`) | `resume()` | `closeMatchMenu()`: `_matchMenu=false; input.requestLock()` (a click is a gesture; Esc is not → CLICK TO PLAY), `input.enabled=true; capture=true; menu.hide()` |
| Tab hidden | sim paused | host keeps simulating: HostTicker drives `_frame(now, false)` at ~60 Hz (Worker measured 56-63 Hz hidden vs rAF 0 Hz / setInterval 1 Hz); clients too (keep state/ack flowing) |
| Javelin hit-stop (WeaponSystem.js:1580-1587) | `timeScale` 0.3 | `game.hitStop` is defined only while online (NetSession sets it on host/join, deletes it on leave): `player.rig.punchFov(-3)`; never touches `timeScale` |
| End-of-match slow-mo (Game.js:467) | 0.25 | none (outro timer only) |
| Quality change mid-match | immediate | host: deferred to match end (866 ms stall measured); client: immediate (local) |
| Audio muffle (Audio.js:1534-1542) | on `'paused'` | none (state stays `'playing'`) |

Host banner (ui): "HOSTING · keep KINETIC and its server window open (minimizing is fine)".

---

## 8. UI specification (1280×720 must fit with maximum content; 1920×1080 checked) [ui unless marked]

### 8.1 Menu.js ↔ NetMenu.js hooks [A]
* `init()` (155-156): append `this.net = new NetMenu(this)`; `root.innerHTML += this.net.html()`; after DOM refs: `this.net.bind()`.
* `_mainHTML` (177-182): insert `<button class="k-btn" data-act="mp-hub"><span class="lbl">Multiplayer</span><em>Host or join on your network</em></button>` as the 2nd button (5 buttons fit: 4 span y=330-545, footer y=692).
* `_onClick` (395-417): `if (act.startsWith('mp-') && this.net.onClick(act, t)) return;`.
* Esc handler (347-351): `if (this.net.onKey(e)) return;` and on `'pause'`: `if (g.state === 'paused') g.resume(); else if (g._matchMenu) g.closeMatchMenu();`.
* `_go` (470-484): `this.net.onShow(name)`.
* `_deploy` (457-466): `if (this.net.setupMode !== 'solo') return this.net.createOrApply(this._cfg);`.
* `showPause` / `showEnd`: when `g.net.online` → `this.net.fillPause()` / `this.net.fillEnd(match)` variants.

### 8.2 Screens

| Screen | Layout (720p budget) | A minimal | ui polish |
|---|---|---|---|
| **MULTIPLAYER hub** `data-screen="mp"` | k-head (Back, "MULTIPLAYER / Play with friends on your network") · name row (text input, required, `settings.playerName`) · two k-cut cards 26em×18em: HOST A GAME ("Your PC runs the match; friends on the same network join with a code"; LAN status from `/api/lan`: `lan:false` → "LAN hosting is off — start host-lan.bat"; `profile:'Public'` → "Windows treats this network as Public: allow Python on Public networks or run allow-lan-firewall.bat") and JOIN A GAME (4-letter code input, auto-uppercase, `BCDFGHJKLMNPQRSTVWXZ` filter, JOIN, inline error line, open rooms ≤ 4 rows "Caleb's game · Foundry · FFA · 2/8 · [JOIN]" refreshed 2 s via `net.listRooms()`) · footer: SETTINGS CODE (import/export, `SettingsCode.js`) · messages from `net:closed` ("Removed by the host", "The host ended the game [Rejoin KXQV]", "The host updated KINETIC [Reload]", "This game was opened in another tab") | name, host button, code + join, errors | room list, deep-link prefill, LAN diagnostics, settings code, styling |
| **Host setup** = `data-screen="setup"` with `NetMenu.setupMode='host'\|'edit'` | header "Host a game"; footer Back / CREATE ROOM (edit: APPLY); `.setup-opts` becomes `overflow-y:auto` (fixes the measured 720p overflow); extra compact row: Max players (2-8 seg), Late join (toggle), Bots fill (toggle), Teams (Auto/Pick), Snapshots (60/30) | footer button swap | extra options, bots note "N humans + M bots" (Menu.js:624-628 text fix), mode texts without "you are Blue" (209, 211) |
| **Lobby** `data-screen="lobby"` | k-head (Leave, "LOBBY / Room KXQV · Foundry · Free for all") · grid `22em \| 1fr`, max height 500 px · left k-cut: room code 4.2em letters, "Friends: open **http://172.20.5.157:8000** and enter the code" (ONE canonical URL = `/api/lan.ips[0]`, default route first; the others behind "other addresses"), Copy link (host on localhost only), LAN checklist when `lanSeen` is empty after 20 s ("No other device has reached this PC yet": same network; allow Python on Private and Public or run allow-lan-firewall.bat; guest Wi-Fi isolates devices — use a phone hotspot; wire the host if possible), live line "192.168.1.23 is loading KINETIC…" from `lanSeen`, host performance line "Your PC renders ≈ 41 fps; hosting wants 55+ [Use hosting graphics]" (sets wave-1 `quality:'medium'`, `lowLatency:true`, `renderScale:0.85`), match card (mapArt 100 px, mode, limits, bots, pool summary), Edit rules (host) · right k-cut: FFA rows (chip, name, crown for host, READY ✓ / LOADING 62% / "in background", ping ms, kick ✕ for host) + "+N BOTS (difficulty)"; TDM/KOTH: Blue \| Red columns + "+N bots", SWITCH TEAM when `teams==='pick'` · k-foot: status ("Waiting for host…" / "3/4 ready"), LEAVE ROOM, host START MATCH (force-start allowed) / client READY. Player list `overflow-y:auto`. | code, URL, rows (name/ready/host/ping), Ready/Start/Leave | team columns, kick, edit rules, copy link, diagnostics, fps line |
| **Loading overlay** | `showLoading('Waiting for players 2/3 — Sam 62% (in background)', 1)`; host after `FORCE_START_AFTER_S`: button "Start without Sam" → `net.forceBegin()` | text | button |
| **Match menu** = `'pause'` MP variant | title "MATCH MENU", subtitle "The match keeps running"; Resume (click relocks), Loadout (wave-1 pick editor; `net.setPick`; applies next spawn), Settings (Graphics quality disabled for the host during a match), Controls, Leave match (confirm: client "Leave the match?", host "End the game for 3 players?"); host extra: End match for all, Back to lobby; pz-info: room code, humans + bots, ping, host fps | Resume, Settings, Controls, Leave; Restart hidden | Loadout, host buttons, info |
| **End** MP variant | banner per client (`playerWon` from `winnerId/winnerTeam`; FFA `winnerId 0` → DRAW); stats tile team = local team, `me` = `isLocal` recomputed locally; endinfo "N PLAYERS · M BOTS"; departed rows dimmed; host: REMATCH / BACK TO LOBBY / END ROOM (confirm); client: "Waiting for host…" + LEAVE ROOM, follows host automatically | buttons | stats, departed rows, DRAW banner |

### 8.3 HUD (ui; core only uses `hud.announce`)
* **Countdown**: centered numeral 6em ("3", "2", "1"), then FIGHT via announce; replaces the immediate FIGHT of `onMatchStart` (HUD.js:266) when `match.online`.
* **CLICK TO PLAY / CLICK TO DEPLOY**: panel below the crosshair (k-cut, 1.4em, cyan border) when `state==='playing' && !input.locked && !lockUnavailable && !game._matchMenu`; "CLICK TO DEPLOY" while `net.client.awaitingDeploy` (the death overlay is suppressed then); replaces the small hint (HUD.js:962-965) online.
* **Predicted hit markers**: on `hit:predicted` add the marker + `hitmarker`/`headshot` sound in that frame (no number); on `damage` with `attacker === player` and a `ci` that was predicted, add only the damage number (no second marker/sound); kill marker + `kill_confirm` stay on `death`.
* **Net status** (under `tl-map`, HUD.js:95): "PING 12 MS" (client) / "HOST · 3 PLAYERS" (host); "CONNECTION INTERRUPTED" (red) when no host packet for `INTERRUPTED_MS`; "RECONNECTING — 42 S" from `net:status.reconnectUntilMs`.
* **Nameplates** (`Nameplates.js`): pool of 16 absolutely positioned divs; human avatars only (teammates always within 80 m, enemies only with LOS `combat.canSee(camera, head)` checked at 10 Hz per avatar and within 60 m); projection like ModeHUD `_marker` (ModeHUD.js:251-279); `textContent`; hidden while scoreboard open or dead.
* **Kill feed system lines**: `.kf-row.sys` (italic, cyan, no weapon icon) from `net:sys` ("Sam joined", "Sam left", "Sam lost connection", "Sam is back", "Sam → Red"); departed attackers show their kept name/color.
* **Host clock conversions**: handled by NetClient (`refreshTimes`) — no HUD change needed (HUD.js:927-931, 766, 819).
* **Late-join seeding**: `hud.seedNet({firstBlood})` sets `_firstBlood`; `_leaderId`/`_matchPoint` are computed from scores.
* **Fix**: announce() gets raw names (remove `esc()` at HUD.js:431 and 884; `textContent` already escapes).
* **Host banner** for 6 s at match start when hosting with ≥ 1 client.

### 8.4 Scoreboard (ui; A does the isLocal/isBot fix)
Rows: `me` = `isLocal`; bot icon only when `isBot`; crown after the host's name; PING column (humans ms, bots "BOT"); disconnected or
held rows `.dead` + "(reconnecting)" / "(deploying)". `.sb-row` grid adds `3.2em` for ping; team tables shrink K/D to `3em` so two team
columns fit 58em. `scoreboardSignature` adds `Math.round(ping/10)`, `connected`, `host`, `hold`.

### 8.5 Style and test content
Reuse `.k-screen/.k-head/.k-foot/.k-btn/.k-cut/.seg/.k-text`; add the lobby/hub rules; `.k-menu[data-screen="mp"|"lobby"] .k-scrim` like
setup (style.css:484). No web fonts. Debug param `mpfake=8` fills the lobby, roster, scoreboard and departed lists with synthetic rows
and maximum-length (16-char) names, TDM "+N bots", 16-row end board with departed rows and all host buttons; the ui suite runs its
overflow checks with it on every MP screen. Screenshots at 1280×720 and 1920×1080 for every new screen are part of the ui DoD.

---

## 9. Test plan

### 9.1 Harness

* **run_mp.py** (wave-1 netinfra + A's extensions): one Chrome, one window per page (`Target.createTarget({newWindow:true})`),
  `--page URL` repeated, `{room}` placeholder = a fresh valid code (codes use `BCDFGHJKLMNPQRSTVWXZ` only; never `TEST`), its own
  server on a free port, `--report` waits for every page's `window.__TEST__.done`, `--json` writes every page's result, exits 1 on
  any console error; `--hide PAGE:WHEN:DUR` (`WHEN` = seconds or `load` = when page 0 reports `__NET__.phase === 'loading'`; the page
  becomes `document.hidden` by activating an `about:blank` tab in its window), `--close PAGE:T` (CDP `Page.close`), `--relay
  idle_timeout=3,stall_timeout=3`, `--lock` (default with `--report`: MP suites of all packages run one at a time; stale after 20 min).
* **Defaults**: `quality=low`, `size=1280x720`, ≤ 2 bots unless the suite needs more. If any page's render fps averages < 20, the run
  aborts with exit 2 "insufficient fps" (not a failure; rerun later).
* **AutoTest MP params** (A): `net=host|join`, `room=CODE`, `name=`, `players=N` (host starts when N humans incl. itself are in the
  lobby; clients auto-ready), `team=1|2`, `snaphz=30|60`, `latejoin=S`, `netem=lan|wifi|bad|<spec>`, `deploy=auto|S`, `godall=1`
  (host: god for every human; A suites without combat), `buildOverride=X` (version suite), `mpfake=8` (ui), plus existing
  `map/mapfile/bots/mode/diff/duration/score/time/scenario/quality/god`. `AutoTest.frame` finishes on `duration` of *real* time after
  match start or 5 s after `match:end` (not tied to Game.update).
* **report.net** (A; B/ars/modes add to `net.stats.custom`): `{role, peer, entityId, code, epoch, build, hostFps, simHz,
  snaps:{in, hzEff, lagP95, interpDelayMs:{avg,max,final}}, states:{in|out, hz, lagP95, smoothDelayMs:{avg,max}}, rtt:{p50,p95,n},
  offsetJitterMs, budgets:{oneWayP95, frameMsP95}, claims:{sent, applied, rejected:{why:n}, predicted, ghost}, actions:{sent, executed,
  rejected:{why:n}}, imp:[{t, v, src}], events:{in:{…}, out:{…}}, fx:{captured, replayed, dropped, dupes:[…]}, jumps:{maxM},
  track:{self:[[tHostMs,x,y,z,alive]] @20 Hz, seen:{id:[[renderHostMs,x,y,z]] @20 Hz}}, entities:[{id,name,isBot,isHuman,team,kills,
  deaths,alive}], scores:{teamScores, timeLeft}, hidden:{windows, simAdvance}, custom:{…}}`.
* **NetEm profiles** (§2.1.10): `lan`, `wifi`, `bad`; a scenario may call `net.netem.setProfile()` mid-run.
* **tools/mp_check.py** (A): `python tools/mp_check.py <report.json> --expect <suite>` loads `tools/mp/checks/<suite>.py`
  (`check(pages, ctx) -> list[str]`), with helpers `ctx.budget(pages, k)` = `max(lagP95) + max(smoothDelayMs if a client's movement
  is involved) + k × max(frameMsP95)` over the pages involved. Exit 0 ok, 1 fail, 2 insufficient fps.
* **Test map** `tools/mp/maps/duel.js` (A): flat 60×60 arena, 8 spawns with known coordinates, one 3 m wall and one 10 m grapple
  tower (wall-run + grapple), 2 health packs, 1 rocket pad, 1 ammo crate, 1 jump pad, 1 KOTH zone pair (`zones`), invisible boundary walls.
* **Scenario helpers** `tools/mp/lib.js` (A): `role(game)`, `aimAt(game, target, part)`, `place(game, pos, yaw)`, `strafe(game, t, speed)`,
  `sprintPast/slidePast/grapplePast(game, …)`, `rideJumpPad(game)`, `busyLoop(ms)`, `waitUntil(t, cond)`, `logTrack(game, report)`.

Command template:
```
python tools/run_mp.py --out tools/out/mp/<suite> --report --json tools/out/mp/<suite>/report.json --timeout 240 \
  --page "index.html?autotest=1&net=host&room={room}&players=2&mapfile=tools/mp/maps/duel.js&bots=0&mode=ffa&duration=40&quality=low&scenario=tools/mp/scenarios/<suite>.js" \
  --page "index.html?autotest=1&net=join&room={room}&name=C1&mapfile=tools/mp/maps/duel.js&duration=40&quality=low&scenario=tools/mp/scenarios/<suite>.js"
python tools/mp_check.py tools/out/mp/<suite>/report.json --expect <suite>
```

### 9.2 Scenarios and acceptance criteria

All suites: 0 console errors on every page; only warnings listed in the scenario's `allowWarn`; duplicate detector clean (§6.6);
`snaps.hzEff ≥ 0.9 × min(snapHz, simHz)` on every client. `B(k)` = `ctx.budget(pages, k)`.

| Suite (pages) | Pkg | Script | Acceptance |
|---|---|---|---|
| `move` (host + 2 clients, 2 bots, `godall=1`), variants `lan` and `wifi` (client 1 on `netem=wifi`, step lan→wifi at t = 15 s) | A | each human runs a scripted loop 30 s (sprint, strafe, jump, slide, wall-run, grapple, jump pad) | host view of each client (`seen` vs that client's `self` at the same host ms): p95 ≤ 0.20 m, max ≤ 0.60 m (lan); client view of the host player and of the other client: p95 ≤ 0.15 m, max ≤ 0.8 m (lan, 60 Hz); samples within 0.3 s after spawn/teleport excluded; wifi: no avatar jump > 1.5 m between render frames outside teleports; `interpDelayMs` within 10 % of its final value 3 s after the step; `simHz ≥ 55` on the host |
| `hostloop` (host + 1 client, 2 bots) | A | phase 1 `--hide 0:10:5`; phase 2 host `busyLoop(400)` at t = 25 s; phase 3 client `busyLoop(2000)` at t = 32 s | hidden: host `game.time` advances ≥ 4.5 s in the 5 s window, client receives ≥ 50 snapshots/s averaged, bots move ≥ 5 m; hitch: host `game.time` advances ≤ real time + 20 ms across the stall, ≤ 2 `_frame` calls in the 20 ms after it, client recovers (interp delay back within 5 s); client stall: host soft-drops nobody (2 s < 2.5 s), 0 errors |
| `smoke` (host + 2 clients, `godall=1`, time limit 0.5 min) | A | start → countdown (client 2 busy-loops 300 ms during it) → live → time end → rematch → back to lobby; `--hide 1:load:10` in the first load | all pages begin within 10 s of START; client 2 goes live within 50 ms of the host (host ms); all pages `ended` with identical `winnerId`; each page's end-screen `me` row id == its own entity id; rematch epoch +1 and all pages `playing`; back to lobby: all pages in lobby |
| `session` (host + 1 client + 1 stale-build client) | A | client 3 `buildOverride=old`; client 2 `debugFreeze(4000)` at t = 10 s (`--relay idle_timeout=30`) | stale build page shows `net:closed{reason:'build'}` within 2 s of joining; frozen client soft-dropped on the host within 2.6 s, restored within 0.5 s of resuming, no death counted, avatar hidden then visible on client 1 |
| `duel` (host + 1 client, 0 bots), variants `lan`, `wifi` | B | A: C1 fires 30 rifle shots at the host player strafing at 3 m/s, 15 m; B: host fires 30 at C1; C: sniper headshots 5 each way; D: melee 3 each way; E (fast targets): the target sprints (9.6 m/s), slides (≤ 14), grapples (≤ 24) past the shooter and rides the jump pad while being shot (rifle + arc chain at > 22 m); all phases ≥ 2 s after spawn | claims rejected ≤ 2 % (lan) / ≤ 5 % (wifi); victim `damage` events from that attacker == claims applied; local hits vs applied claims ≥ 95 % (lan); every applied claim echoed with its `ci`; predicted marker in the shot's frame; ghost markers ≤ 2 % (wifi); ≥ 1 `headshot:true` each way; host→client hits: C1 `damage` events == host's local hits on the RemotePlayer; arc chain claims beyond 22.5 m accepted |
| `bots` (host + 1 client, 2 bots) | B | client hunts bots with rifle/shotgun for 30 s | client kills ≥ 1 bot; bots damage the client; client death → `death` on both pages within `B(2)`; respawn at `ra` ± 0.15 s; client position after respawn = host spawn point ± 0.05 m; 0 errors on the client from bot `damage` events |
| `pickups` (host + 1 client) | B | the host shoots C1 for ≥ 40 damage; C1 walks onto the health pack, the weapon pad, then the ammo crate twice | client health +25 within `B(3)` of reaching the pack (host `authPos` time); pack unavailable on both pages; client owns the pad weapon; crate consumed only once while reserves are full; grants applied before `pk` (client log order); `grantAck == grantSeq` at end |
| `latejoin` (host + 1 + 1 late, 2 bots) | B | C2 joins at t = 12 s (auto-deploy 0.5 s) | no entity other than `game.player` has C2's id on C2; C2 alive within 1 s of its `deploy` (≤ 3 s after `loaded`); no damage to C2 before deploy; C2 scoreboard kills/deaths equal host's; `firstBlood` seeded; C1 received `ros{add}` |
| `lifecycle` (host + 2 clients) | B | start, score limit 3, end, rematch, back to lobby, client leaves, kick; host-leave variant: `--close 0:T` | identical `winnerId/winnerTeam`, `playerWon` true on exactly one page (FFA), forced 0-0 FFA shows DRAW on every page; `match_end` once per page; leaver removed on host within 1 s; kicked page shows `net:closed kicked` and a reload of it is refused (`welcome.err:'kicked'`); host close → clients show the hub message within 2 s, 0 errors |
| `arsenal` (host + 1 client, 2 bots), variants `lan`, `wifi` | ars | C1 rocket at a wall 10 m, rocket jump, frag, cook-off in hand, gale shove host player, gale while grappling at the speed cap, vortex near C1 and near the host player, static, kinetic, smoke, gale C1 into the wall | predicted rocket removed/adopted without a backward jump; rocket jump: client `velocity.y > 5` in the frame the copy reaches `ip`, and no `imp` with `src` rocket for that seq; actions while grappling at 24 m/s: 0 rejections; cook-off explosion visible on C1 (origin 0 batch); gale: host player velocity change ≥ 8 m/s, reflect rings visible on the reflector's page; vortex: C1's peak pull speed within ±10 % of the host player's in the same vortex; wall splat on C1: `splat` event + damage within 250 ms; smoke volume present in C1 `combat.smokes`; explosions replayed on the entity timeline (fx `late` count 0 on lan) |
| `modes` (host + 3 clients, 2 bots; TDM then KOTH then Escalation) | modes | 25 s each | teams balanced (\|humans Blue − Red\| ≤ 1, totals equal ±1); team scores equal on all pages at end; MATCH POINT announced on every page that saw it on the host; KOTH section index/phase equal within 0.5 s; `hill` counts equal ±1; Escalation: tier of each human equal on all pages; `escw` grant switches the client's weapon; a remote human's promotion never throws and every victim respawns; storm (Stratos run): strike rod identical on all pages; `grapple, release, fall off Stratos` → death within 1 s of crossing killY |
| `rejoin` (host + 1) | modes | `debugDropConnection()` at 12 s; reload variant (`location.reload()` in the scenario at 20 s) | host shows disconnected within 1 s; client back within 5 s (drop) / 40 s (reload) with the same entity id and kills; after the rejoin the host's `seen` track of the client moves within 1 s; a health pickup works after the rejoin; `grantAck == grantSeq` at the end |
| `ui` (host + 1, `mpfake=8`) | ui | screenshots: hub, lobby (FFA/TDM), host setup at 720p, loading overlay with the force-start button, match menu (host + client), countdown + CLICK TO PLAY, CLICK TO DEPLOY, nameplates, scoreboard, end screens (win/draw) | no element overflows the viewport at 1280×720 (DOM rect checks) with maximum content, screenshots reviewed |

### 9.3 Performance budgets and load test (B, run in `move` + `tools/mp/fakeclients.py`)
Host net overhead (beginFrame + updateRemotes + endFrame) ≤ 1.0 ms/frame p95 with 8 fake clients (fakeclients.py: 8 masked binary WS
clients sending real CSTATE at 60 Hz, `cl` at 10/s, `fx` batches at 10/s); snapshot body encode ≤ 0.1 ms; client decode ≤ 0.05 ms;
client state packet = 62 B; snapshot ≤ 700 B p95 with 16 entities; host `simHz ≥ 55` and `snapHzEff ≥ 0.9 × snapHz` with the perf
config (1280×720, quality low, 2 clients, ≤ 2 bots). `report.net.hostFps/simHz/snapHzEff` are always reported.

### 9.4 Manual checks (once per release, headed Chrome)
Minimize the host for 6 minutes on battery (Chrome intensive throttling): the host tick stays ≥ 55 Hz, clients keep playing.
LAN run with a phone hotspot and a Public-profile Wi-Fi: the lobby diagnostics show the right hints.

### 9.5 Single-player regression (every package, before merge)
1. `python tools/run.py "index.html?autotest=1&map=foundry&bots=5&duration=20" --report` before/after on the same machine: `ok:true`,
   0 errors, identical `player.shots`, identical `player.states` key set, `player.distance` within ±3 %, `events.spawn ≥ 6`, fps avg within ±10 %.
2. Same for `mode=tdm`, `mode=koth`, `mode=escalation`, `map=stratos` (storm), 20 s each: `ok:true`.
3. `--eval "({role: __GAME__.net.role, fx: __GAME__.net.fx, hs: typeof __GAME__.hitStop})"` → `{role:'offline', fx:null, hs:'undefined'}`.
4. `python tools/lint_imports.py` on every touched file; `python tools/run.py --check <new modules>`.
5. Hidden-tab offline: `document.hidden` still pauses offline and loading yields behave as today (no HostTicker offline).

---

## 10. Packages

### 10.1 Order of work
1. **mp-core-A** (serial, first; merged before anything else).
2. **mp-core-B** and **mp-ui** in parallel on top of core-A (disjoint files, §10.2). ui codes against the documented core-B event
   names/fields (`hit:predicted`, `damage.ci`, `net:closed` reasons) and verifies them with `mpfake`/synthetic events until core-B lands.
3. **mp-arsenal** and **mp-modes** in parallel on top of core-B (ui may still be running; still disjoint).
4. Integration: the orchestrator merges, runs the full §9 matrix (lan + wifi), merges ARCHITECTURE.md deltas reported by the parallel packages.

Suite caps (keep each package finishable): core-A 4 suites (`move`, `hostloop`, `smoke`, `session`); core-B 5 suites (`duel`, `bots`,
`pickups`, `latejoin`, `lifecycle`) + fakeclients; ui 1; arsenal 1 (2 profiles); modes 2. Each package also runs §9.5.

### 10.2 File ownership matrix (disjointness)

| Files | A | B | ui | ars | modes |
|---|---|---|---|---|---|
| `src/net/{GameProtocol,NetSession,NetHost,NetClient,RemotePlayer,NetAvatar,Avatar}.js` | create | extend | — | — | — |
| `src/net/{NetClock,NetCodec,NetEm,HostTicker,Teams,AvatarRope}.js` | create | (NetCodec section 1) | — | — | — |
| `src/net/{NetEvents,FxMirror}.js` | — | create | — | — | — |
| `src/net/NetArsenal.js` | stub | — | — | own | — |
| `src/net/{NetModes,Rejoin}.js` | stub | — | — | — | own |
| `src/net/protocol.js` (wave 1) | +CSTATE | — | — | — | — |
| `src/core/{Game,Entity,Settings,utils}.js`, `src/player/Player.js`, `src/world/Textures.js` | own | — | — | — | — |
| `src/core/Combat.js` | gates | claims, kill suspend | — | — | — |
| `src/core/AutoTest.js` | own | extend | — | — | — |
| `src/core/Modes.js` | line 82 | — | — | — | own (rest) |
| `src/world/World.js` | pads, yield | storm suspend | — | — | — |
| `src/world/Pickups.js` | gates | applyNet/applyEvent | — | — | — |
| `src/world/{Storm,Zones}.js` | — | — | — | — | own |
| `src/fx/Effects.js` | — | hitSpark | — | — | — |
| `src/weapons/GrenadeTypes.js` | — | 64, 228 | — | own (rest) | — |
| `src/weapons/WeaponSystem.js` | 840 | — | — | getters + 4 call sites | — |
| `src/weapons/{Projectiles.js,special/gale.js}`, `src/ai/Bot.js` | — | — | — | own | — |
| `src/ai/BotManager.js` | spawn/separate/countdown/_onDamage | fx anchor | — | — | removeBot/addBot |
| `src/ui/{NetMenu,Menu,Scoreboard}.js`, `style.css` | minimal | — | own | — | — |
| `src/ui/{HUD,NetHud,Nameplates,ModeHUD,Icons,SettingsCode}.js` | — | — | own | — | — |
| `tools/{serve,netserver,run_mp,mp_check}.py`, `tools/mp/{lib.js,maps/duel.js}` | own | — | — | — | — |
| `tools/mp/fakeclients.py` | — | own | — | — | — |
| `tools/mp/scenarios/*.js`, `tools/mp/checks/*.py` | move, hostloop, smoke, session | duel, bots, pickups, latejoin, lifecycle | ui | arsenal | modes, rejoin |
| `ARCHITECTURE.md` | MP section | extend | report deltas | report deltas | report deltas |

A file shared between two columns is only ever edited by packages that run serially (A → B → ars/modes); the parallel sets {B, ui} and
{ars, modes, ui} share no file.

### 10.3 mp-core-A (session, replication, lifecycle)
Scope: transport adapter, lobby model, hello/welcome (build check, `cg`), basic leave/drop removal (`removeEntity` + `ros{rem}`;
B adds departed rows and policies), direct messages `lobby/load/begin/ros/phase/sys/end`, ping/pong clock, NetCodec + snapshots/state,
RemotePlayer/NetAvatar/Avatar/AvatarRope (movement, smoothing, soft drop), Teams, HostTicker (hidden, stall, boost, coalescing,
hidden-safe yields), NetEm, Game loop and lifecycle split (`_frame/_hostTick`, sub-steps, guards, endFrame before render, netLoadMatch
with sessionGen, netBeginMatch with clearing, netApplyMatchEnd with local `isLocal`, netReturnToLobby, countdown, match menu, overview
camera, draw rule), authority gates (Combat stubs, `_onDeath`, Pickups, pads, WeaponSystem 840, BotManager countdown/_onDamage), end
message, AutoTest MP, Settings keys, utils/World/Textures/BotManager.prepare yields, minimal NetMenu + Menu hooks + Scoreboard fix +
minimal style, Python tooling (run_mp flags, mp_check loader, /api/build, /api/lan diagnostics + lanSeen), duel map, lib.js, protocol.js
`CSTATE`, ARCHITECTURE.md MP section.
Interim limitations (fixed by later packages): no claims/deaths/pickups over the network (A suites use `godall=1`); no mirrored effects;
client rockets/grenades are local-only visuals; no late join/kick semantics beyond the relay; minimal UI.
Internal order: (1) Entity flags, isLocal sites, `_byId`, `authPos`, Settings keys, hidden-safe yields → §9.5; (2) GameProtocol +
protocol.js, NetClock/InterpBuffer/DelayEstimator, NetCodec round-trip tests (incl. `NET.NEVER` sentinels); (3) NetSession + transport +
lobby + hello/welcome + ping + NetEm + AutoTest MP + run_mp extensions → 2-page smoke; (4) Game loop split + lifecycle + Teams +
RemotePlayer/NetAvatar/Avatar + snapshots/state + gates → `move` (lan, wifi), `smoke`; (5) HostTicker policies → `hostloop`;
(6) soft drop + build check + debugFreeze → `session`; (7) minimal UI + Python tooling; (8) docs.
DoD: its 4 suites pass via `mp_check.py`; §9.5 passes; lint + `--check`; JSDoc; report with deviations and ARCHITECTURE.md deltas.

### 10.4 mp-core-B (combat, events, mirroring, late join)
Scope: NetEvents (dmg/death/spawn/pk/fire/exp/shove/splat/reflect, required/optional ids, departed refs), staleness guards (`at`
fields, own block rules), claims (whitelist, `st/ft`, token buckets, arc range, `ci`, `clr`, `hit:predicted`), forces (`imp` with
sources, `lnch`, `muteForces`, simEnd assertion), fall backstop, pickups/grants/mirror (section 1, `applyNet/applyEvent`, sentinels),
FxMirror (windows, `TWIN_SOUNDS`, emit suspension, no `L` in weapon windows, anchors + rebase, groups, timestamps + render-time
scheduling, duplicate detector), late join/stragglers/deploy gate (`attachLate`, `onDeploy`, `policy.onLateJoin/onLeave` defaults),
leave, kick (`kickedSids`), host-leave handling + `beforeunload` registration, rejoin hooks (`policy.onDrop/onRejoin` defaults, `cg`
bump API), unicast-first flush, BotManager fx anchor, Effects hitSpark, GrenadeTypes 64/228, World storm suspend, fakeclients.py,
perf budgets.
Internal order: (1) NetEvents + id resolution + deaths/respawns + guards → `bots`; (2) claims + predicted hits + fall backstop →
`duel` (lan, wifi, fast targets); (3) forces; (4) pickups/grants → `pickups`; (5) FxMirror + detector (all suites re-run clean);
(6) late join/leave/kick/host leave → `latejoin`, `lifecycle`; (7) fakeclients + §9.3; (8) docs.

### 10.5 mp-ui
Scope: full MP screens and polish (§8): NetMenu (hub + room list + LAN diagnostics + settings code + closed-reason messages; lobby with
canonical URL, checklist, lanSeen line, fps line + hosting graphics button, in-background rows, team columns, kick, edit rules, copy
link; loading overlay force-start; match menu with Loadout pick + explicit confirms; end variant with DRAW and departed rows), Menu.js
text fixes and setup overflow fix, HUD (countdown, CLICK TO PLAY/DEPLOY, predicted markers + `ci` dedupe, net status incl. reconnect
countdown, host banner, system feed lines, nameplates, announce escaping fix, seeding), Scoreboard columns, style.css, Icons,
SettingsCode.js, `mpfake=8`.
Interfaces used: read-only `game.net` state (`role, phase, status, reconnectUntilMs, room, me, ping, isHost, build`), `net:*` events,
`hit:predicted`, `damage.ci`, NetSession actions (`listRooms, hostRoom, joinRoom, leave, setReady, setTeam, setConfig, setPick, kick,
lock, start, forceBegin, rematch, toLobby, endMatchForAll, endRoom`), `game.openMatchMenu/closeMatchMenu`, `game.getScoreboard()` row
fields, entity `isHuman/isBot/isLocal/netHost/ping/connected/netHold`, `net.client.awaitingDeploy`, wave-1 settings (`quality`,
`lowLatency`, `renderScale`) and `encodeCrosshair/decodeCrosshair`.

### 10.6 mp-arsenal
Scope: projectile ids + section 2, client render mode on the entity timeline, WeaponSystem call-site interception + `client.act`,
actions with host validation (extrapolated `netPos`, token buckets, `actx`), predicted copies (visual-only integrator) + time-aligned
adoption, predicted self rocket-knock + explosion with `ip`, `predKnockBy/predIp`, explosion groups, Gale `selfPush` option +
`galeSelfPush` + reflect clearing, client GrenadeTypes presentation (vortex rigs, smoke events → `combat.addSmoke`, zaps; splats host-only),
C7 client vortex pull + host crush-only for `simLocal === false`, avatar decorators (arc beam channel + `arc_loop` + light every 0.08 s;
rail charge glow via `chargeGlow` every 0.15 s + `rail_charge` loop, humans; bots loop only), WeaponSystem `beamActive/beamEnd`, Bot
`beamEnd/chargeFrac`, `client.hooks.blast`.
Interfaces used: `net.on('act')`, `net.send`, `net.registerSection(2, …)`, `net.fx.open/close/group/anchor`, `RemotePlayer.muteForces/
unmuteForces`, `NetEvents.register('smoke', …)`, `Avatar.decorators`, `net.client.hooks.blast`, `net.client.act`, `net.host.remoteOf`,
`net.clock`, `client.renderTimeMs()`, `net.stats.custom.ars`.
Internal order: (1) ids + section 2 + render mode; (2) actions + validation + predicted copies + adoption; (3) rocket knock/explosion
prediction; (4) Gale; (5) GrenadeTypes presentation + C7; (6) decorators + getters; (7) `arsenal` (lan, wifi).

### 10.7 mp-modes
Scope: KOTH (section 3, client presentation state building `match.koth` incl. `zones` with Vector3 `pos`, `Zones.loadList`, `hill`
events with `ts`, presence on `authPos`), Escalation events (`esc` with `at`, `escf`), Storm (`beginStrike(rod, warn)`, authority gating,
`storm` event, clients never schedule strikes; sheet lightning stays local), Rejoin.js (`policy.onDrop/onRejoin` per the §7.2.15
checklist, client rejoin record, reload auto-rejoin, build-mismatch reload, `replaced` terminal), bot replacement on late join /
re-add on leave (`policy.onLateJoin/onLeave`, `BotManager.removeBot/addBot`).
Interfaces used: `net.host.onBuildBegin(fn)`, `net.client.onBegin(fn)`, `net.registerSection(3, …)`, `NetEvents.register`,
`net.host.attachLate`, `Teams.planLateJoin`, `net.host.policy`, `net.status`, `e.authPos`, `net.stats.custom.modes`.

### 10.8 Cross-package rules and promised hooks
* A parallel package MUST NOT edit a file owned by another package (§10.2); if it needs a core change, it uses a hook listed here or
  reports the need (the orchestrator applies it in integration).
* Hooks promised by core (all exist, possibly as no-op defaults, when core-B is merged): `NetSession.on/send/sendNow/registerSection/
  stats/listRooms/forceBegin/setPick`, `NetEvents.register`, `net.fx.open/close/group/anchor/suspend/resume`, `net.host.onBuildBegin`,
  `net.host.attachLate`, `net.host.policy.{onDrop, onRejoin, onLateJoin, onLeave}`, `net.host.grant`, `net.host.remoteOf`,
  `net.client.onBegin`, `net.client.onGrant`, `net.client.hooks.blast`, `net.client.act`, `net.client.renderTimeMs`, `Avatar.decorators`,
  `RemotePlayer.muteForces/unmuteForces`, `Pickups.applyNet/applyEvent`, `game.netLoadMatch/netBeginMatch/netReturnToLobby/
  openMatchMenu/closeMatchMenu`, events `hit:predicted`, `net:*`.
* Definition of done per package: its §9.2 suites pass via `mp_check.py` (lan and, where listed, wifi), §9.5 regression passes, lint +
  `--check` pass, JSDoc on public APIs, final report lists contract deviations and ARCHITECTURE.md deltas.

---

## 11. Risks and phase-2 upgrade path

### 11.1 Risks

| Risk | Mitigation |
|---|---|
| Browser-hosted authority stalls (hitches, GC, shader compiles) freeze everyone | catch-up sub-steps (≤ 0.25 s), Worker tick coalescing, wave-1 warmup/prewarm, deferred quality switch, host banner, `hostloop` suite |
| GPU-bound host (18–52 fps measured at the default preset) | Worker sim frames keep the tick ≥ 60 Hz (C8); lobby fps line + one-click hosting graphics; `simHz`/`snapHzEff` reported and gated |
| Hidden host tab | HostTicker Worker (measured 56–63 Hz hidden); headed 6-minute check (§9.4) |
| Client-authoritative movement = trivially cheatable | LAN friends trust (brief); sanity checks never freeze a legit player; phase-2 command stream |
| Favor the shooter: a victim can be hit up to speed × (shooter's view age + shooter→host one-way + one host frame) behind cover. At 60 Hz on LAN, remote humans are shown ≈ 50–55 ms old (client delay ≈ 40 ms + the target's own one-way ≈ 10–15 ms), bots/host ≈ 40 ms → ≈ 0.7 m at 9.6 m/s, ≈ 1.8 m at the 24 m/s grapple cap. At 30 Hz (Wi-Fi fallback) ≈ 90 ms → ≈ 1.1 m / 2.7 m. The host sees remote humans only its smoothing delay (≈ 15–30 ms) + their one-way late, bots in real time | 60 Hz default, measured-age delays (no fixed floors), `CLAIM_REWIND_MAX_MS` 400, trade window only by shot time |
| Missed id translation misattributes feedback | NetEvents registry is the only emitter on clients; required/optional id rules; `duel` checks counts both ways |
| Double presentation (capture + derive) | §6 tables are normative; `TWIN_SOUNDS` allowlist; emit suspension; duplicate detector in every suite |
| Snapshot/reliable reordering at the relay | `at` guards per field group (§7.3), local life only via events |
| TCP head-of-line stalls on Wi-Fi (100–300 ms) | NetEm `wifi`/`bad` profiles in the suites; delay estimator raises at once; token buckets absorb bursts; claims carry `st/ft`; WebRTC in phase 2 |
| Mixed browser engines | client-authoritative movement is immune (no replay); only presentation differs |
| "My friend can't connect" (firewall, Public profile, guest Wi-Fi isolation) | `/api/lan` `profile/fwRule/lanSeen` + lobby checklist, one canonical URL, hotspot hint; tunnel in phase 2 |
| Version skew (long-lived client tabs after a host update) | build id in `hello`; `welcome{err:'build'}` → reload prompt; `session` suite |
| Accidental host exit ends everyone's game | `beforeunload` guard, explicit confirms, same-code re-host, client "Rejoin KXQV" |
| Per-origin localStorage: joiners lose settings | one canonical URL; settings share code in the hub (phase 1) |
| WeaponSystem/Game regressions | offline invariant R15, §9.5 before every merge |
| Grenade prediction divergence (frame-rate dependent bounce, Projectiles.js:334-376) | time-aligned decaying offset; phase 2 fixed-step grenades |
| Rocket knock mismatch when the host rocket stops at an avatar the client's copy missed | accepted edge case (§5.11.4); `imp.src` makes it measurable |
| Human–human overlap (no player collision) | accepted (as bots vs player today); phase 2 soft push on host → impulse |
| BotModel lacks wall-run/slide/grapple poses | approximations; phase 2 poses |

### 11.2 Phase 2 (keep interfaces compatible)

* **Command stream + reconciliation** (mp-netcode-feel): add `Player.buildCommand/applyCommand`, move grapple update / shock clamp /
  eye lerp into the 120 Hz step, `PlayerController.serialize/deserialize` + silent replay flag; commands ride `PKT.INPUT` (0x01, reserved);
  `CSTATE` stays for presentation; `RemotePlayer` is replaced by `NetPlayer extends Player` driven by commands with the same entity
  interface (position/velocity/flags/`onFire`/inventory), so NetHost/NetAvatar/codecs are unchanged; knockback and the Vortex become
  owner-snapshot corrections instead of `imp`/C7. Claims become host-side rewound ray validation (`Combat.withRewind` over
  `NetHost.history`, exact client ray + spread seed via `mulberry32` in `randomInCone`, utils.js:60-81).
* **WebRTC transport**: `RtcTransport` implementing the same Transport surface, signalled through the relay `signal` message, unordered
  DataChannels for `SNAPSHOT`/`CSTATE`, reliable channel for `JSON`; fallback to WsRelayTransport (replaces TURN); pre-warm the first
  PeerConnection at menu load (~3.4 s measured).
* **Internet play**: expose the unchanged server through a tunnel (`cloudflared tunnel --url http://localhost:8000` or `ssh -R` to
  localhost.run); `WsRelayTransport` already derives `ws:`/`wss:` from `location.protocol`; add the static allowlist and join rate
  limits (netinfra) before exposing; 5-letter codes for a public rendezvous.
* **Anti-cheat**: movement validation against a host PlayerController shadow, LOS checks for claims, ammo/fire-rate authority.

---

## Appendix A — wave-1 names this contract depends on (verified in the worktrees)

| Wave-1 package (WIP commit) | Names used here | If different at merge |
|---|---|---|
| netinfra (`b3ed4f7`) | `src/net/protocol.js`: `PROTOCOL_VERSION`, `PKT {INPUT 0x01, PING 0x02, PONG 0x03, JSON 0x10, EVENT 0x11, SNAPSHOT 0x81}`, `LATEST_WINS`, `CLOSE {ROOM_CLOSED 4000, KICKED 4001, REPLACED 4002, SLOW 1013}`, `BinaryWriter/BinaryReader`, `packCm/packAngle/packPitch/packUnit`, `seqDelta/seqNewer`, `normalizeCode/isValidCode`, `encodeJsonPacket/decodeJsonPacket`; `WsRelayTransport` surface of §5.1 (`reconnectWindow`, `debugDrop`, token `kinetic.net.token.<code>`); relay `reserve_timeout 60`, `idle_timeout 15`, `stall_timeout 15`; `/api/lan {app, relay, hostname, port, lan, bind, ips, urls, hostUrl}`, `/api/rooms`; `tools/run_mp.py` (`--page/--pages/--url/--report/--json/--room/{room}/--origin/--client-origin/--remote/--shots`) | adapt only in `NetSession._bindTransport` / `NetCodec` / run_mp flags |
| loadout (`51ef2a2`) | `match.pool` (`freezePool` in `_startMatch`), settings `loadoutPool` / `playerLoadout`, `resolveLoadout(pool, pick)`, `resolveFor(game, entity)` (reads `entity.loadoutPick ?? settings.playerLoadout`), `sanitizeLoadout`, `escalationLoadout`, `WeaponSystem.onPlayerSpawn(loadout?)`, `Modes.loadoutFor` (Escalation ladder, else `!isBot` → `resolveFor`), `modes.isEscalation`, `spawnLoadout(inv, mode, special)` | use the merged field names in `netBeginMatch` / spawn handling; `lo` stays Escalation-only (R12) |
| input (`5b00c57`) | frame protocol `input.update()` / `input.endFrame()` (with `_inFrame`), stale-press policy, `actionActive`, `latestPressed` | `_frame` keeps update/endFrame once per frame, endFrame unconditional |
| render (`fec0bb2`) | `frameLimiter.shouldSkip()` first in `_loop`; settings `quality: 'auto'\|'low'\|'medium'\|'high'\|'ultra'`, `renderScale`, `lowLatency` | keep the limiter in `_loop` before `_frame`; Worker frames bypass it |
| hitches (`871a7c2`) | `warmup(drawView)` (`_warming` + `nextFrame`), `prewarmObjects()`, `hud.prewarm()`, time-sliced path finding | `netLoadMatch` calls `warmup(true)`; if BotModel is not prewarmed, create one hidden instance first |
| crosshair (`3adf371`) | `src/ui/Crosshair.js` `encodeCrosshair/decodeCrosshair`, xh* settings | SettingsCode embeds the crosshair code |

## Appendix B — glossary
`net time` = host `performance.now() - t0` in ms (all wire timestamps). `local game time` = a machine's `game.time`. `render time` =
`hostNowMs() - effective delay` (client), the "entity timeline". `origin` (fx) = entity whose machine captured a batch (0 = host
sim/action). `anchor` = entity whose avatar muzzle a record replays from. `simLocal` = this machine integrates that entity's movement.
`authPos` = the position rules use. `epoch` = u8 match counter. `sessionGen` = local session generation. `cg` = connection generation of a
remote human. `netHold` = entity held by a connection or deploy gate.

## Appendix C — critique resolution log

CT = code-truth lens, PF = play-feel lens.

| # | Lens / sev. | Problem (short) | Resolution |
|---|---|---|---|
| 1 | CT critical | attachLate order: joiner gets `ros` of itself before `begin`, own spawn lost, ghost avatar; loading clients process `phase`/`end` | Unicast-first flush (§5.3, R16); attachLate never spawns, `begin` has `spawn:null` + deploy gate (§7.2.14); `inMatchEpoch` gate; own-id and duplicate-row guards (§4.6, R7); `latejoin` acceptance |
| 2 | CT high | BotManager `_onDamage` reads `attacker.stats` on NetAvatar bots → console.error | BotManager.js:273 guard (§2.2, §4.5); Entity-fields-only rule for shared listeners |
| 3 | CT high | predicted copies run `_updateRocket`/detonate → claims with `w='rocket'`, phantom cook, local smoke | `CLAIM_WEAPONS` whitelist both sides (R4, §5.10); visual-only integrator (§5.11.1); interception at WeaponSystem call sites (§2.2, §5.11.1) |
| 4 | CT high | host action execution captured with `o = rp.id` → actor never sees its cook-off / gale results | action windows use origin 0 (§6.2, §5.11.2) |
| 5 | CT high | `RemotePlayer.addGrenades(1)` without type throws in `_setTier` → victim never respawns | defaults `type='frag'`, `id=null, f=0.5`, unknown → false (§4.2, §5.13); `modes.onDeath` wrapped in try/catch (§2.2); `modes` suite check |
| 6 | CT high | own block alive/health applied from stale snapshots | local life only via events; own health guarded by `ownHpAt` (R3, R17, §7.3) |
| 7 | CT medium | unknown optional ids drop whole messages | required vs optional ids, departed refs (§5.9) |
| 8 | CT medium | wave-1 `loadoutFor` sends the host's pick as `lo` | `lo` only in Escalation via `modes.escalation.loadoutFor(rp)` (R12, §7.2.7); `rp.loadoutPick` from hello/pick |
| 9 | CT medium | Game's keydown reopens the menu, Menu's 400 ms guard swallows Esc | online handlers skip when `_matchMenu`; idempotent `openMatchMenu`; Menu closes (§7.4, §8.1) |
| 10 | CT medium | UI sounds (kill_confirm, tier, match_end) captured as twins | `TWIN_SOUNDS` allowlist + emit suspension (§6.2, §6.3) |
| 11 | CT medium | arc chain claims rejected by the range check | arc range `def.range + chainRadius + 1` (§5.10) |
| 12 | CT medium | `predKnock` survives reflection; `pk` decided at fire time vs impact | `predKnockBy` + reflect clearing + typeof guard; decision by `act.ip` (see #32, Appendix D) (§5.11.4) |
| 13 | CT medium | end rows keep the host's `isLocal` | rows serialized without flags; recomputed in `netApplyMatchEnd` (§7.1.3, §5.8) |
| 14 | CT medium | 100 ms timer in `nextFrame` breaks visible warmup | timer/tick only when hidden, re-check visibility (§2.2 utils) |
| 15 | CT medium | rejoin keeps `lastStateSeq`/`grantSeq` | `cg` byte 61, seq reset, `grantSeq=0` + `begin.grantSeq`, resync (§5.4, §7.2.15) |
| 16 | CT medium | delay formulas ignore one-way latency | DelayEstimator on measured sample ages, lag p95 reported (§5.15) |
| 17 | CT low | each human shot lights the scene twice | `flashLight` not captured in weapon windows; light derived from `fire`; arc light by decorator (§6.2, §6.5) |
| 18 | CT low | `Infinity` → `null` in JSON | `NET.NEVER` sentinels + codec test (§5.3, §2.1.1) |
| 19 | CT low | pads and pickups active during the countdown | countdown gates in World/Pickups (§2.2, §7.2.6) |
| 20 | CT low | `rt` one frame later than the positions tested | per-target `st = shownT` from the last interpolation (§5.10) |
| 21 | CT low | beginFrame/endFrame outside try; input.endFrame skipped | guarded calls, unconditional `input.endFrame` (§7.1.1) |
| 22 | CT low | `T_CSTATE = 0x02` collides with `PKT.PING` | wave-1 `PKT` table + `CSTATE 0x82`, load-time assertion (§2.1.1, §5.2) |
| 23 | CT low | stale load paints over the hub after leave/kick | `sessionGen` check after every await (§7.1.3) |
| 24 | CT low | team scores arrive after `death` → MATCH POINT missed | `death.ts`, `hill.ts` applied before emit (§5.8, §5.9) |
| 25 | CT low | RailBeams not wrapped (lazy) | Rejected (Appendix D); `getRailBeams` guard kept |
| 26 | PF high | no latency/jitter/stall testing | NetEm shim + profiles, wifi variants, fast-target phases (§2.1.10, §9) |
| 27 | PF high | mp-core too big; parallel packages blocked | core-A / core-B split; ui parallel with core-B (§10) |
| 28 | PF high | 30 Hz default, 50 ms extrapolation, low host smoothing floor | 60 Hz default + per-client jitter fallback; extrapolation ≤ one interval; measured-age delays; §11.1 numbers restated (§1.3, §5.15) (modified, Appendix D) |
| 29 | PF high | host tick = render frame; flush after render | endFrame before render; Worker sim+net frames when rAF < 55 Hz; fps/simHz/snapHz reported and gated; lobby fps line + hosting graphics (§7.1.1, §8.2, §9.3) (modified, Appendix D) |
| 30 | PF high | no hit feedback until the host echo | `hit:predicted` + `ci` echo + `clr`; HUD rules (§5.10, §8.3) |
| 31 | PF high | rejoin freezes the player (seq/ack) | same as #15 + rebind checklist in `policy.onRejoin` JSDoc; `rejoin` suite checks movement, pickups, acks (§7.2.15, §9.2) |
| 32 | PF medium | rocket jump before boom; adoption snaps back; bounce doubled | fire-time `ip`, predicted explosion, groups dropped by the owner, time-aligned adoption, silent predicted copies, `imp.src` (§5.11.3-4, §6.4) |
| 33 | PF medium | action validation on the smoothed position; bursts drop actions | `netPos` extrapolated by velocity + speed tolerance, token buckets, `actx`, `authPos` for pickups/zones/kill plane (§5.11.2, §4.2, §4.5) |
| 34 | PF medium | UI twins, doubled muzzle lights | as #10 and #17 + duplicate detector (§6.6) |
| 35 | PF medium | effects at the present vs avatars in the past | mandatory muzzle rebase; batch timestamps; entity-timeline replay; non-owned projectiles on the entity timeline (§6.4, §5.11.3) (modified, Appendix D) |
| 36 | PF medium | Worker tick bursts after stalls; mixed clocks | coalescing, one clock online, `raw ≥ 0` (§7.1.1); `hostloop` hitch phase |
| 37 | PF medium | claims rejected during stalls; trade window by arrival | `st` (shown sample time), `ft`, velocity-scaled tolerance, `ft`-based trade (§5.10) |
| 38 | PF medium | late-join flush order / self avatar / grant-before-pk contradiction | as #1; grants now precede `pk` (§5.3, §5.13) |
| 39 | PF medium | two reconnect loops; grace mismatch; silent players hittable | transport owns reconnect; one 60 s grace; 4002 terminal; soft drop at 2.5 s (§1.3, §7.2.15) (modified, Appendix D) |
| 40 | PF medium | stale header/score/phase overwrite events | per-group `at` guards (§7.3, R17) |
| 41 | PF medium | clients lose time; deadlines converted once | client sub-steps + `PLAYER_DT_MAX`; per-frame re-conversion, `hostNowMs() >= liveAt` (§7.1.2, §5.14) |
| 42 | PF medium | sanity checks freeze legit fast movement; no client kill plane | tHost-based implied speed vs velocity, never drop, low samples accepted, fall backstop (§4.2, §5.12) (modified, Appendix D) |
| 43 | PF medium | Vortex over-pulls remote humans | C7: client-side pull; host crush only (§1.4, §5.12) |
| 44 | PF medium | end screen shows the host as "you"; ties crown the host | as #13 + online draw rule (§2.2 endMatch, §7.2.9) (modified, Appendix D) |
| 45 | PF medium | one hidden client stalls the start | Worker-tick yields while hidden, `prog.vis`, force start after 8 s, `smoke` hide test (§2.2, §7.2.4) |
| 46 | PF medium | late joiner defenceless before clicking | deploy gate + 3 s protection (§7.2.14) |
| 47 | PF medium | "can't connect" undiagnosable | `/api/lan` `profile/fwRule/lanSeen`, lobby checklist, lanSeen line (§2.2, §8.2) |
| 48 | PF medium | host exits by accident | `beforeunload`, explicit confirms, same-code re-host, client Rejoin (§7.2.13) (modified, Appendix D) |
| 49 | PF medium | stale code in long-lived tabs | build id `/api/build`, `hello.build`, `welcome{err:'build'}`, `session` suite (§5.7, §7.2.2) |
| 50 | PF medium | missing/conflicting interfaces | `listRooms`, `reconnectUntilMs`, PKT bytes, `netBeginMatch` clearing, rebind checklist (§2.1.2, §7.1.3, §7.2.15) (modified, Appendix D) |
| 51 | PF medium | fixed-ms limits flaky at harness fps | budgets `B(k)`, `hzEff ≥ 0.9·min(snapHz, simHz)`, insufficient-fps abort, run lock, low quality ≤ 2 bots (§9.1, §9.2) |
| 52 | PF medium | failure modes without suites | `hostloop` (hidden + hitch), `session` (version + half-open), `lifecycle` host-leave, arsenal splat, fakeclients, detector, manual headed check (§9) |
| 53 | PF low | kicked tab rejoins by reloading | rejoin record deleted on kick; `kickedSids` (§7.2.12) |
| 54 | PF low | settings lost per origin | one canonical URL, settings code in the hub (§8.2) |
| 55 | PF low | ui suite never sees worst-case layouts | `mpfake=8` + overflow checks with maximum content (§8.5, §9.2) |

## Appendix D — rejected and modified critiques

* Rejected critique: #25 (RailBeams not wrapped because `getRailBeams` is lazy) — `WeaponSystem.init` already calls `getRailBeams(this.game)`
  during boot "so Game.warmup compiles its shader" (WeaponSystem.js:353), so `game.railBeams` exists long before `hostRoom/joinRoom`;
  `FxMirror.install()` still calls `getRailBeams(game)` first as a no-cost guard.
* Modified critique: #28 — the per-client 30 Hz fallback is triggered by that client's jitter only, not by host fps < 55: the send
  accumulator already sends at most one snapshot per sim frame, the Worker keeps the host sim ≥ 60 Hz (C8), and forcing 30 Hz on a
  45 Hz tick would produce uneven 22/44 ms spacing.
* Modified critique: #29 — instead of a net-only pump between frames, the host runs full sim+net frames without render from the Worker
  when rAF is slower than 55 Hz: a pumped snapshot would restamp stale sim state (bots would stutter on clients), whereas sim frames
  raise the snapshot rate, claim processing and relay latency together. The fail condition is `snapHzEff ≥ 0.9 × snapHz` in the perf
  config (§9.3) and `≥ 0.9 × min(snapHz, simHz)` elsewhere (reconciles #29 with #51).
* Modified critique: #12 — the `pkn` confirmation at the predicted impact is replaced by #32's fire-time `ip`: a `pkn` sent at impact
  races the host explosion (the host rocket starts one-way later and explodes at about the time `pkn` arrives); `ip` is deterministic
  against static geometry and needs no confirmation. `predKnockBy`, reflect clearing and the `typeof` guard are adopted as proposed.
* Modified critique: #35 — world-only records are also replayed on the entity timeline, not on arrival: non-owned projectiles now
  render on that timeline, so their explosions must too; only groups tagged with the receiver's own projectile replay on arrival.
* Modified critique: #39 — the grace is 60 s (the wave-1 relay `reserve_timeout` default and the transport's `reconnectWindow`), not
  90 s; joining at the very start of boot is not adopted because the measured reload path (boot 16–21 s + load ≤ 4 s) fits in 60 s,
  and a joined-but-booting page would receive `begin` it cannot process; the reload path skips the backdrop map instead.
* Modified critique: #50 — "RECONNECTING (2/15)" becomes a deadline countdown: the wave-1 transport does not expose its attempt
  counter (`_retry` is private), and the deadline is known exactly from `reconnectWindow`.
* Modified critique: #48 — `beforeunload` cannot carry custom text (browsers show a generic prompt); the explicit "End the game for N
  players?" wording is used by the in-game Leave / END ROOM confirms.
* Modified critique: #44 — the FFA draw rule applies online only; offline keeps today's result (R15; the offline 0-0 "Victory" remains a
  BACKLOG item).
* Modified critique: #42 — a sample that fails the implied-speed check is not dropped (which would freeze the avatar) but treated as a
  teleport (buffer reset) with a warning.
* Modified critique: #1 — "the joiner spawns within 3 s" becomes "alive within 1 s of its `deploy`" because of the deploy gate (#46);
  tests auto-deploy after 0.5 s, so the old bound still holds in the suite.
