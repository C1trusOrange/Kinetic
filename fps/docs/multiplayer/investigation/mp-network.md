# mp-network

## Summary
I built and measured a stdlib-only prototype relay. It serves the game files AND an RFC 6455 WebSocket hub at /ws on the same port as tools/serve.py. The design: 4-letter room codes; the host browser is authoritative peer 0; clients are peers 1..254. The server routes binary packets blindly by a 1-byte header, and packet types >=0x80 are "latest-wins" (a backed-up client gets only the newest snapshot). The code is in C:/Users/caleb/Documents/GitHub/Kinetic/fps/tools/out/_claude/mp-network/ (wsrelay.py + wsloop.py). Test setup: real headless Chrome 155, 1 host tab + 8 client tabs, 30 Hz x 1500 B snapshots, 60 Hz inputs, all on this laptop. Results in calm runs: game round-trip (client -> relay -> host page -> relay -> client) p50 2.3-3.9 ms, p95 4-9 ms, 0 missed ticks. Two server designs were compared. In the thread-per-connection design, each connection has its own reader and writer threads. In the single-threaded selectors loop, the HTTP thread does the handshake and then hands the socket to one loop thread. The loop is clearly better: 10-14% vs 21-24% of one core (8 clients) and 17% vs 44% (15 clients). Time a packet spends inside the relay drops from p50 ~570 us to ~135 us and p99 from 3.3-4.1 ms to 0.7-1.1 ms. The loop also stays clean at 60 Hz x 2 KB, where the threaded relay had p99 53 ms and 145 dropped ticks. Also verified: protocol errors get the right close codes (1002/1009) or a 403 handshake rejection (foreign Origin); fragmentation (Chrome split a 300 KB message into 5 frames); idle pings; slow-client conflation and drop; SO_EXCLUSIVEADDRUSE.

Real game state (foundry, 16 entities, 691 samples) encodes to 430 B per snapshot in a compact binary layout (p95 464, max 529). The same state is 3,014 B as JSON rounded to 2 decimals and 4,434 B as raw JSON. Binary encode costs 10.6 us vs 60.7 us for JSON; decode 1.25 us vs 14 us for JSON.parse. Recommendation: binary DataView for snapshots and inputs, JSON only for lobby/control. That is about 17 KB/s per client at 30 Hz, about 1.1 Mbit/s total for 8 clients. Friends on a LAN load the game from http://LAN-IP:8000, which is a non-secure context. The probe showed they lose crypto.randomUUID/subtle, clipboard, AudioWorklet and service workers, but everything KINETIC uses today still works: pointer lock with unadjustedMovement locked, AudioContext resumed after a click, localStorage (per origin). WebRTC DataChannels also work from http pages (mDNS .local host candidates, no STUN needed). Their ICE+DTLS+SCTP handshake took ~46 ms, but creating the first PeerConnection/offer took ~3.4 s, and there was no latency gain on LAN. So WebRTC is a phase-2 optimisation, not phase 1.

I found two hosting blockers. (1) A hidden host tab freezes the authoritative sim: rAF runs at 0 Hz and main-thread timers at 1 Hz, while a Worker-driven clock keeps ~60 Hz. On top of that, Game.js pauses on visibility change or pointer-lock loss. (2) serve.py's SO_REUSEADDR lets a second server silently bind port 8000 on Windows; SO_EXCLUSIVEADDRUSE fixes it (verified WinError 10048). The host PC is currently on 'Opal_GUEST' Wi-Fi with a Public network profile and has no firewall rule for python.exe. The first --lan bind will therefore trigger the Windows Firewall prompt, and a guest network may block device-to-device traffic entirely. Recommended phase 2 without a rewrite: expose the same server through a tunnel. Options are a cloudflared quick tunnel, or `ssh -R` using Windows' built-in OpenSSH (present on this PC). That gives friends https/wss and a secure context, with no firewall prompt and no protocol change. Later, a WebRTC transport can ride the relay's existing 'signal' message, with the WebSocket relay as a fallback that replaces TURN. Caveat: the machine was 41-100% loaded by other agents during tests (38-54 Chrome processes), so tail latencies are inflated and medians and relay residence times are the reliable numbers. Side note: I once ran chrome.exe --version, which on Windows opened a window in the user's existing Chrome session; all test servers were bound to 127.0.0.1 only, and a leftover test relay process I found was stopped.

## Key files
- tools/serve.py: Existing static server: ThreadingMixIn HTTPServer bound to 127.0.0.1 (line 52), allow_reuse_address=True (line 44: silent duplicate bind on Windows), Cache-Control no-store (line 35), request_queue_size 256 (47). Host of the future /ws relay + --lan mode.
- play.bat: Launcher: opens the browser (line 7) BEFORE the server starts (line 10); needs a LAN-host variant.
- src/core/Game.js: Main loop via requestAnimationFrame (286, 721); pauses on pointer-lock loss (248-250), Esc/P (252-255), visibilitychange (271-276); dt clamp Math.min(raw,0.05)*timeScale (733). All must change for an MP host.
- src/core/Input.js: Pointer lock with navigator.userActivation gate + requestPointerLock({unadjustedMovement:true}) (180-203); verified to work from a non-secure origin.
- src/player/Player.js: Fixed 120 Hz movement sub-steps (178-186) with latched press edges (166), grapple updated per frame (173): the basis of the input-command format (one command per 120 Hz step).
- src/core/Settings.js: localStorage settings (43, 59): per-origin, so localhost vs LAN-IP origins keep separate settings.
- tools/run.py: Harness; its stdlib WebSocket client (43-114) is text-only with a per-byte masking loop (80-82); CDP/launch helpers reused by my benches.
- tools/out/_claude/mp-network/wsrelay.py: PROTOTYPE relay: static + /ws + /api/lan + /api/rooms + /api/stats; Hub/Room/handle_control/handle_binary/detach; RFC 6455 reader; thread-per-connection writer with latest-wins slot; lan_ipv4s(); ExclusiveServer (SO_EXCLUSIVEADDRUSE). Flags: --lan --loop --no-nodelay --quiet --switch= --http10.
- tools/out/_claude/mp-network/wsloop.py: PROTOTYPE single-threaded selectors engine (recommended): Loop.adopt(sock, addr) handoff from the HTTP thread, LoopConn (non-blocking send buffer, latest-wins conflation, per-iteration batched flush, stall detection, ping/idle).
- tools/out/_claude/mp-network/netbench.js: Browser bench page (host/client, ws or rtc transport; RTT, one-way, inter-arrival, DC setup timeline).
- tools/out/_claude/mp-network/bench_chrome.py: Runs relay + headless Chrome with 1 host tab + N client windows; results in results/*.json; summarize.py tabulates.
- tools/out/_claude/mp-network/loadtest.py: Python-only multi-process load test incl. --stall (client that never reads); contains a binary masked WS client.
- tools/out/_claude/mp-network/snapsize.js: Autotest scenario: encodes REAL game state at 30 Hz as binary vs JSON, measures sizes and codec cost; includes a concrete binary entity/projectile layout.
- tools/out/_claude/mp-network/probe.html: Secure-context API probe (run via probe_ctx.py; results_probe.json).
- tools/out/_claude/mp-network/bgtest.html: Hidden-tab clock test (rAF vs setInterval vs Worker), run via bgtest.py.

## Findings
### [high] A stdlib WebSocket relay on serve.py's own port works with real Chrome at LAN-class latency
Prototype: the HTTP handler does the RFC 6455 handshake (Sec-WebSocket-Accept = b64(sha1(key+GUID)); checks version 13, Upgrade/Connection tokens and a 16-byte key; declines permessage-deflate). The server unmasks client frames with a big-int XOR (int.from_bytes(data) ^ int.from_bytes(mask*k)), which runs in C instead of the per-byte loop in run.py:80-82. It then routes packets.

Wire contract:
- Text frames = JSON lobby/control.
- Binary frames: byte0 = routing byte. From a client, the server overwrites it with the sender's peer id and forwards to the host. From the host, it is the destination peer id, or 255 for all clients.
- Byte1 = packet type; types >= 0x80 are latest-wins.

Bench: headless Chrome 155, 1 host tab + 8 client windows, 30 Hz x 1500 B snapshots, 60 Hz x 48 B inputs, 10 Hz pings, 15 s runs.
- Game RTT (client -> relay -> host page -> relay -> client) p50 2.3-3.9 ms, p95 4.1-9.1 ms.
- Snapshot one-way p50 2.4-3.3 ms; client input one-way to the host p50 1.5-2.3 ms.
- 435/435 snapshots delivered, 0 missed ticks, in every calm run.
- Relay-only RTT (text ping to the server) p50 1.6-2.4 ms.

Throughput is not a concern: 8 clients x 60 Hz x 2 KB (960 KB/s out of the relay) cost 13% of one core in loop mode.
Evidence: C:/Users/caleb/Documents/GitHub/Kinetic/fps/tools/out/_claude/mp-network/wsrelay.py; C:/Users/caleb/Documents/GitHub/Kinetic/fps/tools/out/_claude/mp-network/results/t30_a.json; C:/Users/caleb/Documents/GitHub/Kinetic/fps/tools/out/_claude/mp-network/results/l30_a.json; C:/Users/caleb/Documents/GitHub/Kinetic/fps/tools/out/_claude/mp-network/results/r2_t30.json; C:/Users/caleb/Documents/GitHub/Kinetic/fps/tools/out/_claude/mp-network/results/r3_lNoNd.json; C:/Users/caleb/Documents/GitHub/Kinetic/fps/tools/out/_claude/mp-network/results/r2_l60.json

### [high] A single-threaded selectors loop beats thread-per-connection on CPU, relay residence, tails and scale
Residence = time a packet spends inside the relay, from reading the frame to sendall() returning.

Thread-per-connection (reader = HTTP handler thread + one writer thread per connection):
- 8 clients: CPU 21-24% of one core, 22 threads, residence p50 553-582 us, p99 3.3-4.1 ms.
- 15 clients: CPU 43.9%, residence p99 12.5 ms, RTT p95 42 ms.
- 60 Hz x 2 KB: CPU 31%, residence p99 52.6 ms, max 198 ms, 145 conflated/missed ticks.

Selectors loop (the HTTP thread does the handshake, then Loop.adopt() hands the socket to one loop thread; sends are non-blocking with a per-connection buffer, one batched flush per loop iteration, and no locks on the send path):
- 8 clients: CPU 10-14%, 5 threads, residence p50 131-140 us, p99 0.71-1.13 ms.
- 15 clients: CPU 17.0%, residence p99 1.2 ms, RTT p95 14 ms.
- 60 Hz x 2 KB: CPU 13.1%, residence p99 0.95 ms, 0 missed ticks.

The Python-only load test agrees (8 clients): loop CPU 14.6% vs threads 21.3%; snapshot one-way p50 0.96 vs 1.15 ms; input p50 0.39 vs 0.55 ms.

The thread design's tails come from GIL hand-offs and thread wake-ups per message. asyncio was not measured; selectors is simpler for adopting a socket accepted by another thread.
Evidence: C:/Users/caleb/Documents/GitHub/Kinetic/fps/tools/out/_claude/mp-network/wsloop.py; C:/Users/caleb/Documents/GitHub/Kinetic/fps/tools/out/_claude/mp-network/results/r2_l15.json; C:/Users/caleb/Documents/GitHub/Kinetic/fps/tools/out/_claude/mp-network/results/r2_t15.json; C:/Users/caleb/Documents/GitHub/Kinetic/fps/tools/out/_claude/mp-network/results/r2_t60.json; C:/Users/caleb/Documents/GitHub/Kinetic/fps/tools/out/_claude/mp-network/results/r2_l60.json; C:/Users/caleb/Documents/GitHub/Kinetic/fps/tools/out/_claude/mp-network/summarize.py

### [medium] Backpressure: latest-wins conflation plus stall detection stop a frozen client from hurting the others
Test: 7 healthy Python clients + 1 client that joins and never reads (a frozen tab or dead Wi-Fi), 30 s, 30 Hz x 1500 B.
- Healthy clients: snapshot p99 ~2 ms, 0 missed ticks, in both relay modes.
- The stalled client's snapshots were conflated 468-599 times (only the newest unsent one is kept, so memory stays bounded), then it was dropped. Threads mode drops it via the socket timeout (20 s) on sendall; loop mode via stall detection (no send progress for 15 s).
- Reliable frames are capped at MAX_BACKLOG 2 MiB, then closed with 1013.

The host's input path is never blocked by a slow client.
Evidence: C:/Users/caleb/Documents/GitHub/Kinetic/fps/tools/out/_claude/mp-network/loadtest.py; C:/Users/caleb/Documents/GitHub/Kinetic/fps/tools/out/_claude/mp-network/wsloop.py

### [medium] RFC 6455 details confirmed against Chrome 155
- Chrome fragments large messages: a 300 KB binary message arrived as 5 frames, so continuation handling is mandatory even though game packets are < 2 KB.
- ws.extensions == '' confirms permessage-deflate was declined (RSV bits must stay 0).
- Browsers answer server pings automatically: an idle page (25 s) stayed open with 5 s pings and a 15 s idle timeout in both modes. JS cannot send pings, so RTT and clock sync need app-level ping packets.
- Chrome accepted even an 'HTTP/1.0 101' status line. Still send HTTP/1.1 for the upgrade only: set self.protocol_version='HTTP/1.1' on the handler instance and keep static serving unchanged.
- Error paths: unmasked client frame -> close 1002; announced 2 MiB payload -> 1009; foreign Origin -> HTTP 403 (CSWSH guard); a fragmented text message with an interleaved ping is reassembled.
- Close: a browser close gives 1000 wasClean=true. When the host leaves, clients get {t:'room-closed'} and code 4000, but wasClean=false, because the prototype shuts the socket without waiting for the client's close echo (polish item).
Evidence: C:/Users/caleb/Documents/GitHub/Kinetic/fps/tools/out/_claude/mp-network/wsprobe.py; C:/Users/caleb/Documents/GitHub/Kinetic/fps/tools/out/_claude/mp-network/closeprobe.py; C:/Users/caleb/Documents/GitHub/Kinetic/fps/tools/out/_claude/mp-network/wsrelay.py

### [high] Real snapshot sizes: binary ~430 B vs JSON 3.0-4.4 KB for 16 entities; binary is also 6-11x cheaper to encode/decode
snapsize.js encoded live foundry state at 30 Hz (player + 15 bots, 691 samples).

Proposed binary layout:
- Header 13 B.
- Per entity 22 B: id u8, flags u16, position i16x3 in cm, velocity i16x3 in cm/s, yaw u16, pitch i16, health u8, armor u8, weapon u8; +6 B grapple anchor while grappling.
- Rockets 13 B each; grenades 15 B each.
- Pickups availability bitmask; match block (time left, team scores, per-entity kills/deaths).
- Events: fire 20 B, damage 5, death 5, explosion 9, pickup 3.

Measured sizes:
- Binary: mean 430 B, p95 464, max 529 (events mean 12.9 B, max 90).
- JSON with 2-decimal rounding and short keys: mean 3,014 B. Raw-float JSON: 4,434 B.

CPU per snapshot:
- Binary encode 10.6 us vs JSON build + stringify 60.7 us.
- Entity-table decode 1.25 us vs JSON.parse 13.95 us, which also creates ~16+ objects per snapshot as GC pressure.

The sample was light on projectiles (rockets <= 1, grenades <= 2 in flight; 0.9 events per tick, max 7).

Bandwidth estimate: add an ~80 B own-player block for prediction and ~50 B of WS/TCP/IP overhead, giving ~560 B per client per snapshot.
- Down, per client: ~17 KB/s (~134 kbit/s) at 30 Hz; x2 at 60 Hz.
- Up, per client: inputs at 60 Hz x ~110 B = ~6.6 KB/s.
- 8 clients: ~134 KB/s (~1.1 Mbit/s) from the host PC. The JSON equivalent would be ~720 KB/s.
Evidence: C:/Users/caleb/Documents/GitHub/Kinetic/fps/tools/out/_claude/mp-network/snapsize.js

### [critical] A hidden host tab freezes the authoritative sim, and Game.js pauses on blur/visibility
bgtest (headless Chrome with default throttling, page holding an open WebSocket):
- Visible: rAF 164 Hz, setInterval(16) 62 Hz, Worker 16 ms clock 62 Hz.
- Hidden (another tab in front): rAF 0 Hz, main-thread setInterval 1 Hz, Worker-posted messages 56-63 Hz.
- An open WebSocket does NOT exempt the page from throttling.
- The first bench run (clients as background tabs) reproduced it: the host's send interval p95 was 1,049 ms.

KINETIC runs its sim from rAF (Game.js:286, 721). It also explicitly pauses:
- on pointer-lock loss (Game.js:248-250);
- on Esc/P (252-255);
- on visibilitychange (271-276).

So with a browser-hosted game, alt-tabbing to a maximized window (occlusion), switching tabs or minimising freezes the match for every client. The dt clamp Math.min(raw, 0.05) (Game.js:733) also turns host frame drops below 20 fps into slow motion for everyone. The fix is to clock host ticks from a Worker when document.hidden and to never pause the sim in MP.
Evidence: C:/Users/caleb/Documents/GitHub/Kinetic/fps/tools/out/_claude/mp-network/bgtest.py; C:/Users/caleb/Documents/GitHub/Kinetic/fps/tools/out/_claude/mp-network/bgtest.html; C:/Users/caleb/Documents/GitHub/Kinetic/fps/src/core/Game.js:248; C:/Users/caleb/Documents/GitHub/Kinetic/fps/src/core/Game.js:252; C:/Users/caleb/Documents/GitHub/Kinetic/fps/src/core/Game.js:271; C:/Users/caleb/Documents/GitHub/Kinetic/fps/src/core/Game.js:286; C:/Users/caleb/Documents/GitHub/Kinetic/fps/src/core/Game.js:721; C:/Users/caleb/Documents/GitHub/Kinetic/fps/src/core/Game.js:733

### [high] LAN friends get a NON-secure context; everything KINETIC uses today still works
Method: probe.html loaded from http://127.0.0.1 and http://localhost (secure) and from http://kinetic.test, mapped to 127.0.0.1 via --host-resolver-rules. The last one is non-secure exactly like http://192.168.x.y, and needs no 0.0.0.0 bind.

Non-secure origin:
- isSecureContext=false.
- Undefined: crypto.randomUUID, crypto.subtle, navigator.clipboard, navigator.mediaDevices, navigator.keyboard, navigator.wakeLock, navigator.serviceWorker, AudioContext.audioWorklet.
- Still available: crypto.getRandomValues, localStorage/sessionStorage, navigator.userActivation, getGamepads, OfflineAudioContext, Worker, WebSocket, RTCPeerConnection.
- After a trusted click: requestPointerLock({unadjustedMovement:true}) resolved and pointerlockchange = locked (headless); AudioContext.resume() -> running.
- performance.now granularity is 0.1 ms everywhere (not cross-origin isolated).

The game's current secure-context-sensitive usage is all fine:
- Input.js:184-187 (userActivation + unadjustedMovement)
- Settings.js:43/59 (localStorage)
- Audio.js:1110, 1175-1176, 1244 (Offline/AudioContext, no AudioWorklet)

navigator.clipboard is unavailable on clients, so a copy-invite button only works for the host on localhost. localStorage is per origin: http://localhost:8000 and http://IP:8000 keep separate settings.
Evidence: C:/Users/caleb/Documents/GitHub/Kinetic/fps/tools/out/_claude/mp-network/probe.html; C:/Users/caleb/Documents/GitHub/Kinetic/fps/tools/out/_claude/mp-network/results_probe.json; C:/Users/caleb/Documents/GitHub/Kinetic/fps/src/core/Input.js:184; C:/Users/caleb/Documents/GitHub/Kinetic/fps/src/core/Settings.js:43; C:/Users/caleb/Documents/GitHub/Kinetic/fps/src/core/Audio.js:1244

### [high] Windows: serve.py's SO_REUSEADDR lets a second server bind port 8000 silently; SO_EXCLUSIVEADDRUSE fixes it
- With allow_reuse_address=True (serve.py:44), a second ThreadingMixIn HTTPServer bound the same 127.0.0.1 port without error.
- In a 40-request test all requests went to the first server, so the second one runs but silently receives nothing.
- For a stateful relay (in-memory rooms), running play.bat twice, or a LAN host alongside a still-open single-player server, gives confusing 'no such room' or unreachable failures.
- Hypothesis, not tested because it needs a 0.0.0.0 bind: a 0.0.0.0 and a 127.0.0.1 listener on the same port may split traffic, with the host on localhost and friends on the LAN IP reaching different processes.
- Fix, verified: allow_reuse_address=False plus setsockopt(SOL_SOCKET, SO_EXCLUSIVEADDRUSE, 1) before bind. The second instance then fails with WinError 10048, which serve.py can turn into 'KINETIC is already running' and just open the browser.
Evidence: C:/Users/caleb/Documents/GitHub/Kinetic/fps/tools/serve.py:44; C:/Users/caleb/Documents/GitHub/Kinetic/fps/tools/out/_claude/mp-network/wsrelay.py

### [high] Host PC network/firewall state: Public guest Wi-Fi, no python.exe firewall rule
Read-only queries showed:
- Get-NetConnectionProfile: Name 'Opal_GUEST', Wi-Fi, NetworkCategory Public (0).
- No Windows Firewall application rule for python. Chrome has 'Google Chrome (mDNS-In)'.
- `python` is the WindowsApps alias; the real interpreter is C:/Users/caleb/AppData/Local/Python/pythoncore-3.14-64/python.exe (Python install-manager layout). The path will change on a 3.15 install, so an app rule would re-prompt.
- The PowerShell profile query takes ~1.4 s from Python, so run it in a background thread.
- LAN IPv4 172.20.5.157, hostname CalebTravel.
- Windows OpenSSH client present (C:/Windows/System32/OpenSSH/ssh.exe); cloudflared, ngrok, tailscale and zerotier are not installed.

Consequences:
- The first --lan bind will show the 'Windows Security Alert' for python.exe (not triggered here, to avoid popping a dialog).
- Known Windows behaviour, not verified here: pressing Cancel creates inbound BLOCK rules with no re-prompt, and on a Public network the Private checkbox alone does not help.
- Guest Wi-Fi commonly isolates clients, which no firewall setting can fix.
Evidence: C:/Users/caleb/Documents/GitHub/Kinetic/fps/play.bat:10; C:/Users/caleb/Documents/GitHub/Kinetic/fps/tools/serve.py:52

### [medium] LAN address discovery works with the stdlib; show the hostname URL as a secondary option
Two methods returned the same address in ~36 ms total:
- UDP connect() to 10.255.255.255 / 192.168.255.255 / 172.31.255.255 / 8.8.8.8 sends no packet but picks the default-route interface: 172.20.5.157.
- socket.gethostbyname_ex(gethostname()): ['172.20.5.157'].

socket.if_nameindex() on Windows only returns names like 'ethernet_0' (useless). Filter out 127.x, 169.254.x and 0.0.0.0, and rank the default-route address first; VPN, Hyper-V and WSL adapters can add extra addresses.

Prototype /api/lan returns {hostname, port, ips, urls:[http://172.20.5.157:PORT/, http://CalebTravel:PORT/], bound} for the host lobby UI. Hostname resolution (NetBIOS/LLMNR/mDNS) is network-dependent (hypothesis: often works between Windows PCs), so the IP stays primary.
Evidence: C:/Users/caleb/Documents/GitHub/Kinetic/fps/tools/out/_claude/mp-network/wsrelay.py

### [medium] WebRTC DataChannels are feasible from http pages but gain nothing on LAN; the first PeerConnection costs ~3.4 s
Setup: unordered, maxRetransmits:0 DataChannels, signalled through the relay's {t:'signal'} message, iceServers [] (no STUN), 8 clients.
- Works from the non-secure kinetic.test origin.
- Host candidates are mDNS-obfuscated (<uuid>.local) on secure and non-secure origins alike; with --disable-features=WebRtcHideLocalIpsWithMdns the raw 172.20.5.157 appears.
- Time to channel open: 2.7-4.6 s. The timeline shows new RTCPeerConnection + createOffer took ~3,420 ms, while ICE checking -> connected -> DTLS -> dc:open took ~46 ms.
- This is a one-time per-page init cost (it can be pre-warmed); it is not mDNS, since raw IPs took 3.2 s too.
- Latency is no better than WS: 1 client RTT p50 1.5 ms; 8 clients p50 ~3.9 ms, p95 ~7.1 ms. Relay CPU falls to 1.6% (signalling only).

Pros: no TCP head-of-line blocking (matters on lossy Wi-Fi and the internet); zero relay CPU; P2P. Cons: signalling state machine, per-peer channels on the host, DTLS/SCTP cost in the browser, and mDNS dependence across machines. The last can be mitigated by having the server rewrite .local candidates to each peer's observed LAN IP, or by a small stdlib STUN responder. Not worth it for phase 1.
Evidence: C:/Users/caleb/Documents/GitHub/Kinetic/fps/tools/out/_claude/mp-network/results/rtc30.json; C:/Users/caleb/Documents/GitHub/Kinetic/fps/tools/out/_claude/mp-network/results/rtc_timeline.json; C:/Users/caleb/Documents/GitHub/Kinetic/fps/tools/out/_claude/mp-network/netbench.js

### [low] TCP_NODELAY had no measurable effect on loopback; keep it on anyway
- The early no-NODELAY Chrome runs had RTT medians of 180-520 ms, but they coincided with 90-100% machine load: a NODELAY run (l30_b) also spiked to p95 757 ms at the same time.
- Re-run at lower load: no-NODELAY RTT p50 2.6 ms (threads) and 2.3 ms (loop), the same as with NODELAY.
- One Python-only loop run without NODELAY showed an input p99 of 53 ms vs 1.7 ms (a possible tail effect).

On real NICs, Nagle combined with Windows delayed ACK (up to 200 ms) is the classic small-message stall. Setting TCP_NODELAY on the server socket costs nothing. Hypothesis, not verified: Chrome already sets it on its own sockets.
Evidence: C:/Users/caleb/Documents/GitHub/Kinetic/fps/tools/out/_claude/mp-network/results/r3_tNoNd.json; C:/Users/caleb/Documents/GitHub/Kinetic/fps/tools/out/_claude/mp-network/results/r3_lNoNd.json; C:/Users/caleb/Documents/GitHub/Kinetic/fps/tools/out/_claude/mp-network/results/l30_b.json

### [low] Serving static files alongside the relay is harmless
- A friend joining mid-match downloads the whole game once: 3.0 MB (77 src modules + three.module.js), which took 0.24 s with 6 parallel fetches.
- During that burst the loop relay's residence max was 8.6 ms (p99 1.1 ms); threads mode max 11.3 ms (p99 3.3 ms).
- Continuous static hammering (58 MB in 15 s) at lower load: loop residence p99 1.27 ms.
- sys.setswitchinterval(0.001) gave no improvement.

Because serve.py sends Cache-Control: no-store (serve.py:35) and friends load the game from the host, every client always runs the host's exact code. No version skew is possible in phase 1 or with tunnels; a protocol version field in join/host messages is still cheap insurance.
Evidence: C:/Users/caleb/Documents/GitHub/Kinetic/fps/tools/out/_claude/mp-network/results/s_lOnce.json; C:/Users/caleb/Documents/GitHub/Kinetic/fps/tools/out/_claude/mp-network/results/s_tOnce.json; C:/Users/caleb/Documents/GitHub/Kinetic/fps/tools/out/_claude/mp-network/results/s_lStatic.json; C:/Users/caleb/Documents/GitHub/Kinetic/fps/tools/serve.py:35

### [medium] The sim is non-deterministic, so use host-authoritative snapshots (not lockstep); the 120 Hz player step suits input commands
- There are 114 Math.random() calls across 20 src files (Effects, BotBrain, spawn picking, spread...). Deterministic lockstep is not viable, so the host must be authoritative, with snapshot interpolation plus client prediction for the local player.
- Player movement already runs fixed 1/120 s sub-steps (Player.js:178-186; MoveConfig.js:10-11 STEP 1/120, MAX_STEPS 10), with press edges latched until a step consumes them (Player.js:166). So one input command per 120 Hz step, with a sequence number, maps 1:1 onto move.in and can be replayed for reconciliation.
- The grapple is updated per rendered frame (Player.js:173), which would need to move into the fixed step for exact prediction. This is sim-integration work, flagged for the netcode owner.
Evidence: C:/Users/caleb/Documents/GitHub/Kinetic/fps/src/player/Player.js:166; C:/Users/caleb/Documents/GitHub/Kinetic/fps/src/player/Player.js:173; C:/Users/caleb/Documents/GitHub/Kinetic/fps/src/player/Player.js:178; C:/Users/caleb/Documents/GitHub/Kinetic/fps/src/player/MoveConfig.js:10

## Recommendations
### Phase-1 server: /ws relay in the same process and port as serve.py, using the selectors-loop engine
Move the prototype into tools/netserver.py and have tools/serve.py mount it.

Endpoints:
- GET /ws (upgrade)
- GET /api/lan (hostname, port, ranked LAN IPv4s + URLs)
- GET /api/rooms (public open rooms)

Connection handling:
- The handshake happens in the ThreadingMixIn handler thread: validate version 13, the key, Upgrade/Connection tokens and Origin netloc == Host (else 403).
- Send 101 with HTTP/1.1 by setting self.protocol_version on the instance, so static serving stays unchanged. Do not echo Sec-WebSocket-Extensions.
- Set TCP_NODELAY, then Loop.adopt(sock, addr). The server skips shutdown_request for handed-off sockets.
- One loop thread (selectors.DefaultSelector + socketpair wakeup) owns every WS socket.
- Per connection: non-blocking send buffer flushed once per loop iteration; latest-wins slot for packet types >= 0x80.
- Limits: MAX_MESSAGE 1 MiB -> 1009; reliable backlog > 2 MiB -> 1013.
- Timers: ping every 5 s, drop after 15 s of silence; drop if no send progress for 15 s.
- Server-initiated close waits up to 1 s for the peer's close echo (the prototype does not, so clients see wasClean=false).

Binding: ExclusiveServer (allow_reuse_address=False + SO_EXCLUSIVEADDRUSE on Windows). Bind 127.0.0.1 by default and 0.0.0.0 with --lan.

Keep Python stdlib only; about 600 lines total based on the prototype (wsrelay.py + wsloop.py). Avoid the prototype's sys.modules aliasing hack by putting Hub/Room/handlers and Loop in one module.
Files: tools/serve.py, tools/netserver.py

### Launch and hosting UX on Windows: keep play.bat, add a LAN-host launcher, guide through the firewall
- play.bat: unchanged semantics (127.0.0.1, no firewall prompt).
- New 'host-lan.bat' (or `play.bat lan`) runs `python tools\serve.py 8000 --lan`.
- serve.py should open the browser itself after a successful bind (webbrowser.open('http://localhost:8000/?mp=host')). This removes play.bat:7's race of opening the browser before the server exists.
- It prints 'You: http://localhost:8000/  Friends: http://<LAN-IP>:8000/ (and http://<HOSTNAME>:8000/)' plus firewall guidance: 'When Windows asks about Python, tick Private networks (and Public if this network is Public) and click Allow; Cancel blocks friends permanently'.
- It warns when Get-NetConnectionProfile reports Public (query in a background thread; ~1.4 s).
- On bind failure (WinError 10048) it prints 'KINETIC is already running' and opens the browser.
- Optional self-elevating allow-lan-firewall.bat: `netsh advfirewall firewall add rule name="KINETIC LAN" dir=in action=allow protocol=TCP localport=8000 profile=private`. A port rule survives Python path changes, since the real exe lives under the versioned pythoncore-3.14-64 folder.
- In --lan mode, serve only index.html, style.css, src/** and vendor/**, and return 404 for directory listings. Otherwise friends can browse ARCHITECTURE.md, tools/ and screenshots.
- The host stays on http://localhost (secure context, same localStorage as single player).
Files: play.bat, host-lan.bat, allow-lan-firewall.bat, tools/serve.py

### Relay wire contract (keep the server protocol-agnostic)
Control plane = JSON text frames.

Client -> server:
- {t:'host', v, name, max, public}
- {t:'join', v, code, name, token?}
- {t:'leave'}
- {t:'kick', peer} (host only)
- {t:'lock', locked} (host only)
- {t:'meta', meta} (host only: map/mode/players shown in the room list)
- {t:'list'}
- {t:'ping', c}
- {t:'signal', to, data} (opaque; for a later WebRTC transport)

Server -> client:
- {t:'hosted', code, peer:0}
- {t:'joined', code, peer, token, room}
- {t:'peer-join', peer, name, addr} and {t:'peer-leave', peer, reason} (to the host)
- {t:'room-closed', reason}
- {t:'rooms', rooms}
- {t:'signal', from, data}
- {t:'pong', c, s}
- {t:'error', reason: no-such-room | room-full | room-locked | already-in-room | bad-message}

Close codes: 1000, 1001 (idle), 1002, 1003, 1007, 1009, 1013 (slow consumer), 4000 (host left), 4001 (kicked).

Data plane = binary frames. Byte0 routing: the client sends 0 and the server rewrites it to the sender id before forwarding to the host; the host sends the destination 1..254 or 255 = all clients. Byte1 = type; >= 0x80 means latest-wins (snapshots). Suggested types: 0x01 INPUT, 0x02 PING, 0x03 PONG, 0x10-0x7F reliable host->client (roster, events, match state), 0x81 SNAPSHOT.

Room codes: 4 letters from BCDFGHJKLMNPQRSTVWXZ (20 consonants, no vowels, so no words and no I/O vs 1/0 confusion) = 160,000 codes. Generate with secrets.choice and re-draw on collision. Accept input case-insensitively with spaces stripped.

Reconnect: the server issues a token (secrets.token_urlsafe) on join; the client keeps it in sessionStorage and rejoins the same peer slot, keeping its score. The token maps to peer id, so a dropped player's slot is reserved.

Phase 2 public rendezvous: 5 letters (3.2M codes) and per-IP join rate limiting.
Files: tools/netserver.py, src/net/protocol.js

### Browser transport layer with a phase-2 seam
Add a small Transport interface: connect(), sendTo(peer, u8), broadcast(u8), onMessage(from, u8), onPeerJoin/onPeerLeave, close().

Phase 1 implementation: WsRelayTransport.
- URL: new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`), so the same code works via tunnels.
- ws.binaryType = 'arraybuffer' (the default 'blob' forces async reads).
- Encode with a reusable ArrayBuffer/DataView; no per-message allocations beyond the send buffer.

Client rules:
- Never use crypto.randomUUID, crypto.subtle or navigator.clipboard (undefined on LAN clients); use server-issued ids/tokens or crypto.getRandomValues.
- Drain all queued messages each frame and only push snapshots into the interpolation buffer; apply the newest reliable state. Stale packets must never be 'replayed like a stack'.
- Send input packets right after sampling input in the frame, capped at 60 Hz.

Later, RtcTransport implements the same interface over DataChannels, signalled via {t:'signal'}. If ICE fails, it falls back to WsRelayTransport, so no TURN server is needed.

Pre-warm one RTCPeerConnection at menu load; the first creation cost ~3.4 s here.
Files: src/net/Transport.js, src/net/WsRelayTransport.js, src/net/protocol.js

### Game protocol numbers (tick, snapshot, input, clock, interpolation, bandwidth)
Rates:
- Host sim on a fixed tick (60 Hz, or reuse the 120 Hz step) with a tick counter.
- Snapshots at 30 Hz by default; 60 Hz is a LAN option that the relay handles at 13% of one core.

Snapshots:
- Unicast per client: one shared encoded body + a per-client header, so the host PC does the fan-out. This also works unchanged over P2P later.
- Header: tick u32, hostTimeMs u32, ackInputSeq u16 for that client, eventAck, and an own-player block (~80 B: f32 pos/vel + movement state + ammo/reserve/grenades) for prediction.
- Body: the layout measured in snapsize.js (22 B per entity +6 B while grappling, 1 cm position and 1 cm/s velocity quantization, u16 yaw, projectiles 13-15 B, pickups bitmask, match block). Measured ~430 B for 16 entities, ~510 B with the own-player block.
- Events (fire/damage/death/explosion/pickup) carry a sequence number and are repeated until acked. On WS this is redundant but keeps the protocol loss-tolerant for DataChannels.

Inputs (client -> host, 60 Hz):
- newestSeq u16, lastSnapshotTick u32 + interp fraction u8 (for hitscan lag compensation: the host rewinds hitboxes, capped at ~200 ms), eventAck.
- The last 4-6 commands, one per 120 Hz step, 8 B each: buttons u16, yaw u16, pitch i16, weapon slot + press edges u8, reserved u8.
- ~60 B payload, ~6.6 KB/s per client with overhead.
- The host queues commands per client and caps the backlog (~100 ms), dropping the oldest, so a burst after a client hitch is not replayed as a 'stack'.

Clock sync:
- App-level PING/PONG via the host (browsers cannot send WS pings): 4 Hz for the first 2 s, then 0.5 Hz.
- Use the minimum-RTT sample of the last 8 for offset = hostTime + RTT/2 - now; slew corrections rather than jumping.
- Snapshot hostTimeMs continuously refines the estimate.

Interpolation delay: adaptive = max(2 x interval, interval + 3 x jitter). Measured 30 Hz inter-arrival p95 41-45 ms and p99 46-51 ms on the loaded box, giving ~70-80 ms at 30 Hz and ~35-45 ms at 60 Hz.

Reconciliation: on ackInputSeq k, compare the predicted state at k with the own-player block. If it is off by more than ~2 cm or a flag differs, reset and replay commands k+1..n through PlayerController.step(1/120); smooth small visual errors over ~100 ms.

Bandwidth (binary): ~17 KB/s down + ~6.6 KB/s up per client at 30 Hz; ~1.1 Mbit/s total for 8 clients (2.2 at 60 Hz). JSON would be ~7x larger and cost ~6x more CPU plus GC churn.
Files: src/net/protocol.js, src/net/Snapshot.js, src/net/HostSession.js, src/net/ClientSession.js

### The MP host must never pause and must keep ticking when hidden
In an MP match, the host (and ideally clients) must not call game.pause() on:
- pointer-lock loss (Game.js:248-250);
- Esc/P (252-255): show an overlay menu instead while the sim keeps running;
- visibilitychange (271-276).

Clock the fixed sim ticks from rAF while visible, and from a dedicated Worker that postMessages every ~16 ms when document.hidden (measured 56-63 Hz while hidden vs rAF 0 Hz and setInterval 1 Hz). Skip render() while hidden.

Replace the variable, clamped dt (Game.js:733) with a fixed-step accumulator for the authoritative sim, so host frame drops do not slow time for everyone.

Show the host a banner: 'You are hosting - keep KINETIC open (minimising is OK)'.
Files: src/core/Game.js, src/net/HostClock.js

### Room codes and a Jackbox-style join flow on LAN
1. Host: double-clicks host-lan.bat -> Multiplayer > Host.
2. The lobby shows the big code (e.g. 'BCDF'), 'Friends: open http://172.20.5.157:8000' (from /api/lan, hostname URL as an alternative), the player list with kick, a lock toggle, match settings (map/mode/loadout) and Start.
3. Friend: opens the URL in Chrome -> Multiplayer > Join. The page lists open rooms on this server (/api/rooms) for one-click join, with a code field for private rooms. Invite links use a hash, http://IP:8000/#join=BCDF, so the code is not sent to the server and a Discord link auto-fills it.
4. Late join: a friend loads the game (~3 MB, measured 0.24 s) and spawns in; tokens let a refresh reclaim the same slot.

The same flow maps to phase 2 by swapping the URL: a tunnel URL, or a stable domain with 'go to play.<domain>, enter BCDF'.
Files: src/ui/Menu.js, src/ui/Lobby.js, tools/netserver.py

### Phase-2 path (codes over the internet) without a rewrite
Option ranking and what each means for the user:

(a) Tunnel - RECOMMENDED FIRST STEP, no protocol change.
- The host runs `cloudflared tunnel --url http://localhost:8000` (one downloadable exe, no account for quick tunnels, random https://*.trycloudflare.com URL, WebSockets supported). No-install alternative: `ssh -R 80:localhost:8000 nokey@localhost.run` with Windows' built-in OpenSSH (present on this PC).
- Friends get https/wss (secure context). The Python server stays on 127.0.0.1: no firewall prompt, no port forwarding, works behind CGNAT.
- Costs: traffic detours via the provider's edge (hypothesis: +10-40 ms RTT regionally); TCP head-of-line blocking; third-party ToS and rate limits; a random URL each session unless a named tunnel with the user's own domain (Cloudflare account + domain) gives a stable Jackbox-style URL.
- The host's upload carries the fan-out: ~1.1 Mbit/s for 8 clients at 30 Hz.

(b) RtcTransport over the same relay.
- Signalling via {t:'signal'} through the tunnel, a public STUN server for server-reflexive candidates, P2P unordered DataChannels for snapshots and inputs.
- Fall back to the WS relay when ICE fails (replaces TURN). Removes head-of-line blocking and the tunnel detour for most pairs.

(c) Tailscale/ZeroTier.
- Zero code change (it becomes a LAN again: 100.x IPs / MagicDNS names), near-direct latency.
- But every friend must install and join; `tailscale serve` can add HTTPS.

(d) Port forwarding (+ optional stdlib UPnP).
- Direct latency, but router configuration, CGNAT failures, a changing public IP, and the Python server exposed to the internet (needs the static allowlist + join rate limits); plain http (non-secure context, which is fine for the game).

(e) Public rendezvous + static client (GitHub Pages) + WebRTC P2P.
- The fullest 'kahoot.it' experience with the sim still on the host PC, but requires a hosted signalling service, TURN or relay fallback, and a client/host version handshake (loses the serve-from-host version guarantee).
Files: tools/serve.py, src/net/RtcTransport.js, src/net/Transport.js

## Risks
- All latency numbers come from one laptop that other agents loaded to 41-100% CPU (38-54 Chrome processes). Medians and relay residence times are reliable; p99 and max values are inflated. A real LAN adds Wi-Fi latency (typically 1-5 ms, with spikes) but removes the contention.
- TCP head-of-line blocking on lossy Wi-Fi was not measurable on loopback. A lost segment stalls the WebSocket stream for a fast-retransmit or RTO interval, which could show as 100-300 ms hitches on poor Wi-Fi (hypothesis). The protocol is designed loss-tolerant so a DataChannel transport can replace WS without a redesign.
- Windows Defender Firewall (known behaviour, not triggered here): the first 0.0.0.0 bind prompts for python.exe. Pressing Cancel creates inbound block rules with no re-prompt. On this PC the active network is Public ('Opal_GUEST'), so a Private-only allowance will not help. Guest Wi-Fi client isolation can block LAN play regardless. The rule is tied to the versioned interpreter path (pythoncore-3.14-64), so a Python upgrade re-prompts.
- The browser-hosted authoritative sim is fragile: tab switching, minimising, occlusion or a pause freezes everyone until the Worker-clock and no-pause changes land. The host's frame drops also affect all clients until the sim uses a fixed-step accumulator.
- The Python relay competes for CPU with the host's own browser: about 10-14% of one core for 8 clients with the selectors loop. The thread-per-connection design doubles that, and its tails collapse under load (residence p99 53 ms, max 198 ms at 60 Hz).
- Exposing serve.py beyond localhost serves the whole fps folder with directory listings (docs, tools, screenshots). For tunnels or port forwarding, it also exposes SimpleHTTPRequestHandler to the internet. An allowlist and join rate limiting are needed before phase 2.
- Phase-2 tunnels depend on third parties (Cloudflare quick tunnels have no SLA and rate limits; localhost.run / ngrok have plan limits and interstitial pages). Random URLs defeat 'type a short code on a well-known site' unless the user owns a domain or a public rendezvous exists.
- A 4-letter code space (160k) is fine on LAN. On a public rendezvous with many rooms it is guessable without rate limiting: 1,000 rooms means a 0.6% hit chance per guess.
- The WebRTC first-PeerConnection init took ~3.4 s here. If P2P is added, pre-warm it at menu load, or joins will feel slow.
- The prototype server does not do a clean close (clients see wasClean=false when the host leaves or they are kicked), and it uses a sys.modules aliasing hack for --loop. Both need fixing when productionising.
- Side effect during investigation: running chrome.exe --version on Windows opened a window in the user's existing Chrome session. One leftover test relay process (127.0.0.1, random port) was found and stopped. No non-loopback sockets were ever bound.

## Open questions
- Phase 2 hosting preference: is it acceptable that the host runs a tunnel through a third party (cloudflared download, or built-in ssh to localhost.run), or would the friends rather install Tailscale, or should the host forward a router port? Does the user own a domain for a stable 'go to play.<domain>, enter ABCD' URL?
- The host PC is currently on 'Opal_GUEST' Wi-Fi with a Public network profile. Is LAN play intended on a home/private network, and is it OK to ship a small elevated helper that adds a firewall rule for TCP 8000 (Private profile)?
- Should LAN rooms be listed automatically for one-click join, or always require the code (privacy on shared networks such as dorms or guest Wi-Fi)?
- Max players per room (8? up to 15?) and whether to offer a 60 Hz snapshot option on LAN. Both are cheap per the measurements, but they set the interpolation delay and host CPU budget.
- Launcher UX: a separate 'host-lan.bat' next to play.bat, or a single play.bat that always binds LAN (which always triggers the firewall prompt, even for solo play)?