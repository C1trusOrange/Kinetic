# Multiplayer design (not yet integrated)

Status (2026-09-30): the LAN relay server and browser transport exist (`tools/netserver.py`, `tools/serve.py --lan`,
`host-lan.bat`, `src/net/{Transport,WsRelayTransport,protocol}.js`, tests in `tools/test_netserver.py`, multi-page harness
`tools/run_mp.py`). The **game integration** (lobby UI, replication, remote players, damage claims, ...) has NOT been built yet.

- `ARCH_BRIEF.md` - the architecture decisions (listen server in the host's tab, client-authoritative own movement,
  host-authoritative combat/score/pickups/projectiles, room codes, phase-2 path to internet play).
- `MULTIPLAYER_CONTRACT.md` - the full implementation contract (APIs, wire protocol, authority table, lifecycle, UI, test
  plan, package split mp-core-A -> mp-core-B + mp-ui -> mp-arsenal + mp-modes). It was checked against the code by two
  critics; `path:line` citations refer to the pre-wave-1 baseline (commit c0044ea), so re-locate hooks by the quoted code.
- `investigation/` - the code investigations the contract is based on (sync surface, netcode feel, transport, flow/UI).

The contract's Appendix A lists the wave-1 names it depends on; re-check them against the merged code before starting.
