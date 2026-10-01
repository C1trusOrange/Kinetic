#!/usr/bin/env python3
"""Static file server + multiplayer relay for KINETIC.

Serves the project root with correct JavaScript MIME types (the Windows registry sometimes maps
.js to text/plain, which breaks ES modules) and caching disabled, plus the multiplayer relay from
tools/netserver.py on the same port (WebSocket at /ws, JSON at /api/lan, /api/rooms, /api/stats).

    python tools/serve.py [port] [--open [PATH]] [--lan] [--bind ADDR] [--quiet]

    port         default 8000
    --open       open the browser once the server is listening (http://localhost:PORT + PATH)
    --lan        accept connections from the local network too (binds 0.0.0.0) and print the address
                 friends should open. Other machines may only load the game itself (index.html,
                 style.css, src/, vendor/) and use /api/* and /ws; this PC keeps full access.
    --bind ADDR  bind this address instead (default 127.0.0.1, or 0.0.0.0 with --lan); any address other
                 than loopback implies --lan (other machines only get the game files)
    --quiet      do not print room / player events

Only one server can own a port (SO_EXCLUSIVEADDRUSE on Windows): when KINETIC is already running
there this prints 'KINETIC is already running' and, with --open, just opens the browser.
"""
import argparse
import functools
import http.server
import json
import os
import socket
import socketserver
import subprocess
import sys
import threading
import urllib.request
import webbrowser
from urllib.parse import urlsplit

import netserver

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# what other machines may fetch in --lan mode (paths relative to ROOT; directories never list)
PUBLIC_FILES = ('index.html', 'style.css')
PUBLIC_DIRS = ('src', 'vendor')


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.js': 'text/javascript',
        '.mjs': 'text/javascript',
        '.css': 'text/css',
        '.html': 'text/html',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.svg': 'image/svg+xml',
        '.wasm': 'application/wasm',
        '.md': 'text/plain; charset=utf-8',
    }

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, fmt, *args):  # quiet
        pass

    def do_GET(self):
        if self._relay_request():
            return
        if not self._may_serve():
            self.send_error(404)
            return
        super().do_GET()

    def do_HEAD(self):
        if self._relay_request():
            return
        if not self._may_serve():
            self.send_error(404)
            return
        super().do_HEAD()

    def _relay_request(self):
        """Hand /ws and /api/* to the multiplayer relay. True if it answered the request."""
        path = urlsplit(self.path).path
        relay = getattr(self.server, 'relay', None)
        if relay is None or not (path == netserver.WS_PATH or path.startswith('/api/')):
            return False
        relay.handle_http(self, path, trusted=self._trusted())
        return True

    def _trusted(self):
        """This PC (loopback), or a server that only listens on loopback anyway."""
        server = self.server
        return not getattr(server, 'restrict_remote', False) or server.is_trusted(self.client_address[0])

    def _may_serve(self):
        """In --lan mode other machines only get the game itself: no docs, tools, screenshots or listings."""
        if self._trusted():
            return True
        if self.path.split('?', 1)[0].split('#', 1)[0] == '/':
            # '/' serves index.html; without one it would be a directory listing
            return public_path_allowed(os.path.join(self.directory, 'index.html'), self.directory)
        return public_path_allowed(self.translate_path(self.path), self.directory)


def public_path_allowed(fs_path, root=ROOT):
    """True if a file (as resolved by the request handler) may be served to another machine:
    index.html, style.css and regular files under src/ and vendor/. Directories never are."""
    try:
        target = os.path.normcase(os.path.realpath(fs_path))
        rel = os.path.relpath(target, os.path.normcase(os.path.realpath(root)))
    except (OSError, ValueError):
        return False
    parts = rel.split(os.sep)
    if parts[0] in (os.pardir, os.curdir) or not os.path.isfile(target):
        return False
    return parts[0] in PUBLIC_FILES if len(parts) == 1 else parts[0] in PUBLIC_DIRS


class ThreadingServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True
    # Chrome requests ~60 ES modules at once; the default listen backlog (5) overflows under load and Windows then
    # refuses connections (ERR_CONNECTION_REFUSED -> "Failed to fetch dynamically imported module").
    request_queue_size = 256


class ExclusiveServer(ThreadingServer):
    """ThreadingServer that refuses to share its port and hosts the multiplayer relay (`relay`).

    On Windows SO_REUSEADDR lets a second server bind a port that is already in use, silently: it then
    receives nothing, and with a stateful relay two room tables would exist. SO_EXCLUSIVEADDRUSE makes
    the second bind fail (WinError 10048) instead."""
    allow_reuse_address = False

    def __init__(self, address, handler, restrict_remote=False):
        self.relay = None
        self.restrict_remote = restrict_remote           # --lan: other machines get the game files only
        self.handed_off = set()                          # upgraded sockets now owned by the relay loop
        super().__init__(address, handler)

    def server_bind(self):
        if hasattr(socket, 'SO_EXCLUSIVEADDRUSE'):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        else:
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)   # POSIX: only skips TIME_WAIT
        socketserver.TCPServer.server_bind(self)
        host, port = self.server_address[:2]
        self.server_name = host                          # HTTPServer's getfqdn() can stall for seconds on Windows
        self.server_port = port

    @staticmethod
    def is_trusted(ip):
        return netserver.is_loopback(ip)

    def handle_error(self, request, client_address):
        # a browser that drops a connection mid-response (reload, closed tab) is normal, not a server error
        if isinstance(sys.exc_info()[1], (ConnectionError, TimeoutError)):
            return
        super().handle_error(request, client_address)

    def shutdown_request(self, request):
        if request in self.handed_off:
            self.handed_off.discard(request)
            return
        super().shutdown_request(request)

    def shutdown(self):
        super().shutdown()
        if self.relay is not None:
            self.relay.stop()

    def server_close(self):
        super().server_close()
        if self.relay is not None:
            self.relay.stop()


def make_server(port=0, root=ROOT, *, bind=None, lan=False, log=None, error_log=None, relay_options=None):
    """HTTP server + relay, not started. Binds 127.0.0.1 unless `lan` (0.0.0.0) or `bind` says otherwise;
    `lan` or any non-loopback `bind` restricts what other machines may fetch. `log` / `error_log`: see netserver.Relay.
    Raises OSError when the port is taken."""
    handler = functools.partial(Handler, directory=root)
    address = bind or ('0.0.0.0' if lan else '127.0.0.1')
    srv = ExclusiveServer((address, port), handler, restrict_remote=lan or not netserver.is_loopback(address))
    srv.relay = netserver.Relay(log=log, error_log=error_log, **(relay_options or {}))
    return srv


def serve_in_background(port=0, root=ROOT, **kw):
    """Start a server on a thread. Returns (server, port)."""
    srv = make_server(port, root, **kw)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    return srv, srv.server_address[1]


# ------------------------------------------------------------------------------------------------ command line

def probe_running(port):
    """What already listens on 127.0.0.1:port: /api/lan info for a KINETIC server, {} for an older KINETIC, None otherwise."""
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))   # never ask a system proxy about loopback
    try:
        with opener.open(f'http://127.0.0.1:{port}/api/lan', timeout=2) as r:
            info = json.load(r)
        if isinstance(info, dict) and info.get('app') == 'kinetic':
            return info
    except Exception:  # noqa: BLE001 - anything else on that port is simply not us
        pass
    try:
        with opener.open(f'http://127.0.0.1:{port}/', timeout=2) as r:
            if b'<title>KINETIC</title>' in r.read(4096):
                return {}
    except Exception:  # noqa: BLE001
        pass
    return None


def lan_banner(port, ips, hostname):
    """The lines printed in --lan mode."""
    lines = [f'KINETIC LAN server on port {port}  (close this window or press Ctrl+C to stop)']
    if ips:
        lines.append(f'  You: http://localhost:{port}  Friends: http://{ips[0]}:{port}')
        for ip in ips[1:]:
            lines.append(f'       (other network adapters of this PC: http://{ip}:{port})')
        lines.append(f'       (or by PC name, works on many home networks: http://{hostname}:{port})')
    else:
        lines.append(f'  You: http://localhost:{port}  Friends: (no network address found - is this PC on Wi-Fi or Ethernet?)')
    lines += [
        '  Friends open that address in Chrome or Edge on the same Wi-Fi / network, then join with the room code.',
        '',
        '  Windows Firewall: the first time, Windows asks whether Python may use networks.',
        '  Tick "Private networks" and click "Allow access". If you clicked Cancel (friends cannot connect),',
        '  run allow-lan-firewall.bat once. Guest / hotel Wi-Fi often blocks devices from reaching each other.',
    ]
    return lines


def _network_profile_warning():
    """Warn when Windows treats the current network as Public (inbound connections blocked). Background thread."""
    if os.name != 'nt':
        return
    try:
        out = subprocess.run(
            ['powershell', '-NoProfile', '-NonInteractive', '-Command',
             'Get-NetConnectionProfile | ForEach-Object { $_.Name + "|" + $_.NetworkCategory }'],
            capture_output=True, text=True, timeout=15, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)).stdout
    except (OSError, subprocess.SubprocessError):
        return
    public = [line.rsplit('|', 1)[0] for line in out.splitlines() if line.strip().endswith('|Public')]
    if public:
        print(f'  ! Windows treats your network "{", ".join(public)}" as Public, which blocks friends from connecting.\n'
              '    On a network you trust (home), switch it to Private: Settings > Network & internet > Wi-Fi\n'
              '    (or Ethernet) > your network > Network profile type > Private network.', flush=True)


def _already_running(args, info, open_path):
    """KINETIC already owns the port (`info` from probe_running): explain, open it with --open. Exit code."""
    if args.lan and not info.get('lan'):
        print(f'KINETIC is already running on port {args.port}, but only for this PC (single player).\n'
              'Close that KINETIC window (play.bat) and start host-lan.bat again to host for your network.', flush=True)
        return 1
    print(f'KINETIC is already running at http://localhost:{args.port}/ (in another window).', flush=True)
    if args.open is not None:
        print('Opening it in your browser...', flush=True)
        webbrowser.open(f'http://localhost:{args.port}{open_path}')
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description='KINETIC static server + multiplayer relay')
    ap.add_argument('port', nargs='?', type=int, default=8000)
    ap.add_argument('--open', nargs='?', const='/', default=None, metavar='PATH',
                    help='open the browser at http://localhost:PORT/PATH once the server is up')
    ap.add_argument('--lan', action='store_true', help='let other machines on the local network join (binds 0.0.0.0)')
    ap.add_argument('--bind', help='address to bind (default 127.0.0.1, or 0.0.0.0 with --lan)')
    ap.add_argument('--quiet', action='store_true', help='do not print room / player events')
    args = ap.parse_args(argv)
    open_path = '/' + (args.open or '').lstrip('/')
    bind = args.bind or ('0.0.0.0' if args.lan else '127.0.0.1')
    args.lan = args.lan or not netserver.is_loopback(bind)   # --bind <LAN address> = LAN mode (banner, file policy)

    if args.port and not netserver.is_loopback(bind):
        # Ask the port before binding: a wildcard (or LAN address) bind may succeed next to a server that holds
        # 127.0.0.1:PORT, and then this PC's browser would reach that server while friends reach this one.
        info = probe_running(args.port)
        if info is not None:
            return _already_running(args, info, open_path)
    try:
        # console output from the relay goes through its own thread: a console window with selected text
        # (QuickEdit) blocks writes, and the relay loop must never wait for that
        srv = make_server(args.port, bind=bind, lan=args.lan,
                          log=None if args.quiet else netserver.ConsoleLog(prefix_time=True),
                          error_log=netserver.ConsoleLog(sys.stderr, prefix_time=True))
    except OSError as err:
        info = probe_running(args.port)
        if info is None:
            if isinstance(err, PermissionError):             # WinError 10013
                why = ('Windows does not allow this port right now: another program holds it, or it lies in a range\n'
                       'Windows reserves (Hyper-V, WSL, Docker; list them: netsh interface ipv4 show excludedportrange '
                       'protocol=tcp).')
            else:
                why = 'Another program is using that port. Close it, or use another port.'
            print(f'Could not start KINETIC on port {args.port}: {err}\n{why}\n'
                  f'Another port: python tools\\serve.py {args.port + 1}', flush=True)
            return 1
        return _already_running(args, info, open_path)

    host, port = srv.server_address[:2]
    if args.lan:
        for line in lan_banner(port, netserver.lan_ipv4s(), socket.gethostname()):
            print(line, flush=True)
        if netserver.is_loopback(host):
            print(f'  (bound to {host} only: other machines cannot connect)', flush=True)
        else:
            threading.Thread(target=_network_profile_warning, daemon=True).start()
    else:
        print(f'KINETIC running at http://localhost:{port}/  (Ctrl+C to stop)', flush=True)
    if args.open is not None:
        webbrowser.open(f'http://localhost:{port}{open_path}')   # the socket already listens: no race
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
