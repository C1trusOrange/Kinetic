#!/usr/bin/env python3
"""Static file server for KINETIC.

Serves the project root with correct JavaScript MIME types (the Windows registry sometimes maps
.js to text/plain, which breaks ES modules) and caching disabled.

    python tools/serve.py [port]        # default 8000
"""
import functools
import http.server
import os
import socketserver
import sys
import threading

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


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


class ThreadingServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True
    # Chrome requests ~60 ES modules at once; the default listen backlog (5) overflows under load and Windows then
    # refuses connections (ERR_CONNECTION_REFUSED -> "Failed to fetch dynamically imported module").
    request_queue_size = 256


def make_server(port=0, root=ROOT):
    handler = functools.partial(Handler, directory=root)
    return ThreadingServer(('127.0.0.1', port), handler)


def serve_in_background(port=0, root=ROOT):
    """Start a server on a thread. Returns (server, port)."""
    srv = make_server(port, root)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    return srv, srv.server_address[1]


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    srv = make_server(port)
    print(f'KINETIC running at http://localhost:{port}/  (Ctrl+C to stop)')
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
