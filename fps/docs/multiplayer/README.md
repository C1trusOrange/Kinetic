# Multiplayer

Status (2026-10-01, branch `feature/multiplayer`): playable. Built: session + lobby, replication of movement (60 Hz
snapshots, interpolation, smoothing), match lifecycle (countdown, end, rematch, back to lobby), combat (favor-the-shooter
damage claims, deaths, respawns, pickups and grants, knockback), mirrored effects, late join, frozen-link handling,
rockets / grenades / Gale from clients executed by the host, replicated projectiles, and hosting from the desktop app
(`desktop/relay.js`) or on an online server (`server/README.md`: a VPS such as Hostinger, host key, optional HTTPS),
name tags, storm strikes driven by the host. Not built yet: the rest of mp-modes (King of the
Hill / Escalation events on clients, rejoin keeping the slot) and most of the mp-ui polish. Overview and test commands: `ARCHITECTURE.md` section 6.12.

- `ARCH_BRIEF.md` - the architecture decisions (listen server in the host's tab, client-authoritative own movement,
  host-authoritative combat/score/pickups/projectiles, room codes, phase-2 path to internet play).
- `MULTIPLAYER_CONTRACT.md` - the full implementation contract (APIs, wire protocol, authority table, lifecycle, UI, test
  plan, package split). `path:line` citations refer to the pre-wave-1 baseline (commit c0044ea); the deviations taken
  while building it are listed in `ARCHITECTURE.md` 6.12.5.
- `investigation/` - the code investigations the contract is based on (sync surface, netcode feel, transport, flow/UI).
