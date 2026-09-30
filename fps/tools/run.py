#!/usr/bin/env python3
"""Headless Chrome harness for KINETIC (no dependencies beyond the Python stdlib).

Serves the project on a random port, opens a page in headless Chrome over the DevTools
protocol, streams console output / exceptions, waits for a condition, takes screenshots and
prints the result of an expression.

Examples
  # full gameplay smoke test (20 s scripted run) + report + screenshots at 5 s and 15 s
  python tools/run.py "index.html?autotest=1&map=foundry&bots=5&duration=20" --report --shots 5,15 --out tools/out/foundry

  # module syntax / import check
  python tools/run.py --check src/world/World.js,src/world/Textures.js

  # model / map viewer screenshots
  python tools/run.py "tools/viewer.html?kind=weapon&id=rifle" --wait "window.__VIEWER_READY__" --shot tools/out/rifle.png
  python tools/run.py "tools/viewer.html?kind=map&id=foundry&preview=1" --wait "window.__VIEWER_READY__" --shot tools/out/map.png --eval "window.__VIEWER_INFO__"

Exit code: 0 when the wait condition was met and no console errors / uncaught exceptions
occurred, 1 otherwise.
"""
import argparse
import base64
import json
import os
import queue
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from serve import serve_in_background, ROOT  # noqa: E402

# ----------------------------------------------------------------------------- websocket


class WebSocket:
    def __init__(self, url):
        assert url.startswith('ws://'), url
        rest = url[5:]
        hostport, path = rest.split('/', 1)
        host, port = hostport.rsplit(':', 1)
        self.sock = socket.create_connection((host, int(port)), timeout=30)
        self.sock.settimeout(None)
        key = base64.b64encode(os.urandom(16)).decode()
        req = (f'GET /{path} HTTP/1.1\r\nHost: {hostport}\r\nUpgrade: websocket\r\n'
               f'Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n')
        self.sock.sendall(req.encode())
        buf = b''
        while b'\r\n\r\n' not in buf:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise RuntimeError('websocket handshake failed')
            buf += chunk
        head, self.buf = buf.split(b'\r\n\r\n', 1)
        if b' 101' not in head.split(b'\r\n')[0]:
            raise RuntimeError('websocket handshake rejected: ' + head.decode(errors='replace'))
        self.send_lock = threading.Lock()

    def send(self, text):
        data = text.encode('utf-8')
        hdr = bytearray([0x81])
        n = len(data)
        if n < 126:
            hdr.append(0x80 | n)
        elif n < 65536:
            hdr.append(0x80 | 126)
            hdr += struct.pack('>H', n)
        else:
            hdr.append(0x80 | 127)
            hdr += struct.pack('>Q', n)
        mask = os.urandom(4)
        hdr += mask
        masked = bytearray(data)
        for i in range(n):
            masked[i] ^= mask[i & 3]
        with self.send_lock:
            self.sock.sendall(bytes(hdr) + bytes(masked))

    def _read(self, n):
        while len(self.buf) < n:
            chunk = self.sock.recv(max(1 << 16, n - len(self.buf)))
            if not chunk:
                raise ConnectionError('websocket closed')
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def recv(self):
        parts = []
        while True:
            b0, b1 = self._read(2)
            fin, op = b0 & 0x80, b0 & 0x0F
            n = b1 & 0x7F
            if n == 126:
                n = struct.unpack('>H', self._read(2))[0]
            elif n == 127:
                n = struct.unpack('>Q', self._read(8))[0]
            if b1 & 0x80:
                self._read(4)
            payload = self._read(n)
            if op == 8:
                raise ConnectionError('websocket closed by peer')
            if op in (9, 10):
                continue
            parts.append(payload)
            if fin:
                return b''.join(parts).decode('utf-8', errors='replace')


class CDP:
    def __init__(self, ws_url):
        self.ws = WebSocket(ws_url)
        self.next_id = 0
        self.results = {}
        self.cv = threading.Condition()
        self.events = queue.Queue()
        threading.Thread(target=self._reader, daemon=True).start()

    def _reader(self):
        try:
            while True:
                msg = json.loads(self.ws.recv())
                if 'id' in msg:
                    with self.cv:
                        self.results[msg['id']] = msg
                        self.cv.notify_all()
                else:
                    self.events.put(msg)
        except Exception as e:  # noqa: BLE001
            self.events.put({'method': '__closed__', 'params': {'error': str(e)}})

    def call(self, method, params=None, timeout=30):
        with self.cv:
            self.next_id += 1
            mid = self.next_id
        self.ws.send(json.dumps({'id': mid, 'method': method, 'params': params or {}}))
        deadline = time.time() + timeout
        with self.cv:
            while mid not in self.results:
                rem = deadline - time.time()
                if rem <= 0:
                    raise TimeoutError(f'CDP call timed out: {method}')
                self.cv.wait(rem)
            msg = self.results.pop(mid)
        if 'error' in msg:
            raise RuntimeError(f"{method} failed: {msg['error']}")
        return msg.get('result', {})

    def evaluate(self, expr, timeout=30):
        r = self.call('Runtime.evaluate', {
            'expression': expr, 'returnByValue': True, 'awaitPromise': True,
        }, timeout)
        if 'exceptionDetails' in r:
            d = r['exceptionDetails']
            desc = (d.get('exception') or {}).get('description') or d.get('text')
            return {'__eval_error__': desc}
        return (r.get('result') or {}).get('value')


# ----------------------------------------------------------------------------- chrome


def find_chrome():
    cands = [
        os.environ.get('CHROME_PATH'),
        r'C:\Program Files\Google\Chrome\Application\chrome.exe',
        r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
        os.path.expandvars(r'%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe'),
        r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
        r'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
        '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ]
    for c in cands:
        if c and os.path.exists(c):
            return c
    raise FileNotFoundError('Chrome not found (set CHROME_PATH)')


def free_port():
    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    p = s.getsockname()[1]
    s.close()
    return p


def launch_chrome(width, height, gpu):
    port = free_port()
    profile = tempfile.mkdtemp(prefix='kinetic-chrome-')
    args = [
        find_chrome(), '--headless=new', f'--remote-debugging-port={port}', f'--user-data-dir={profile}',
        f'--window-size={width},{height}', '--no-first-run', '--no-default-browser-check', '--mute-audio',
        '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--hide-scrollbars',
        '--disable-extensions', '--ignore-gpu-blocklist', '--disable-gpu-watchdog', 'about:blank',
    ]
    if gpu:
        args += ['--enable-gpu', '--use-angle=default']
    else:
        args += ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    ws_url = None
    deadline = time.time() + 20
    while time.time() < deadline and ws_url is None:
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{port}/json/list', timeout=2) as r:
                for t in json.load(r):
                    if t.get('type') == 'page' and t.get('webSocketDebuggerUrl'):
                        ws_url = t['webSocketDebuggerUrl']
                        break
        except Exception:  # noqa: BLE001
            time.sleep(0.2)
    if not ws_url:
        proc.kill()
        raise RuntimeError('could not connect to headless Chrome')
    return proc, profile, ws_url


# ----------------------------------------------------------------------------- output


def fmt_remote(arg):
    if 'value' in arg:
        v = arg['value']
        return v if isinstance(v, str) else json.dumps(v)
    if arg.get('description'):
        return arg['description']
    return arg.get('type', '?')


class Log:
    def __init__(self, quiet, max_lines):
        self.quiet = quiet
        self.max_lines = max_lines
        self.lines = 0
        self.errors = []
        self.warnings = 0

    def out(self, kind, text):
        is_err = kind in ('error', 'exception', 'assert')
        if is_err:
            self.errors.append(text)
        if kind == 'warning':
            self.warnings += 1
        if self.quiet and not is_err and kind != 'warning':
            return
        if self.lines >= self.max_lines:
            if self.lines == self.max_lines:
                print('... (further console output suppressed)')
                self.lines += 1
            return
        self.lines += 1
        text = text if len(text) < 2500 else text[:2500] + ' ...[truncated]'
        print(f'[{kind}] {text}')

    def handle(self, ev):
        m, p = ev.get('method'), ev.get('params', {})
        if m == 'Runtime.consoleAPICalled':
            kind = p.get('type', 'log')
            kind = {'warning': 'warning', 'error': 'error', 'assert': 'assert'}.get(kind, 'log' if kind != 'info' else 'info')
            self.out(kind, ' '.join(fmt_remote(a) for a in p.get('args', [])))
        elif m == 'Runtime.exceptionThrown':
            d = p.get('exceptionDetails', {})
            desc = (d.get('exception') or {}).get('description') or d.get('text', 'exception')
            loc = f" ({d.get('url', '')}:{d.get('lineNumber', 0) + 1}:{d.get('columnNumber', 0) + 1})" if d.get('url') else ''
            self.out('exception', desc + loc)
        elif m == 'Log.entryAdded':
            e = p.get('entry', {})
            lvl = e.get('level', 'info')
            text = e.get('text', '') + (f" [{e.get('url')}]" if e.get('url') else '')
            # Chrome reports its own benign GPU warnings here; keep errors only
            if lvl == 'error' and 'favicon.ico' not in text:
                self.out('error', text)
            elif lvl == 'warning' and not self.quiet:
                self.out('warning', text)
        elif m == '__closed__':
            self.out('exception', 'DevTools connection closed: ' + p.get('error', ''))


def summarize_report(rep):
    if not isinstance(rep, dict):
        return rep
    out = dict(rep)
    errs = out.get('errors') or []
    out['errorCount'] = len(errs)
    out['errors'] = [e if len(e) < 600 else e[:600] + '...' for e in errs[:25]]
    return out


# ----------------------------------------------------------------------------- main


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('url', nargs='?', default='index.html', help='path relative to the project root (query allowed)')
    ap.add_argument('--wait', help='JS expression; wait until truthy')
    ap.add_argument('--timeout', type=float, default=90, help='max seconds to wait (default 90)')
    ap.add_argument('--after', type=float, default=0.0, help='extra seconds to keep running after the wait')
    ap.add_argument('--shot', help='screenshot path taken at the end')
    ap.add_argument('--shots', help='comma separated seconds (after navigation) for extra screenshots')
    ap.add_argument('--out', default=os.path.join(ROOT, 'tools', 'out', 'shot'), help='prefix for --shots files')
    ap.add_argument('--eval', dest='eval_expr', help='JS expression printed (as JSON) at the end')
    ap.add_argument('--report', action='store_true', help='wait for window.__TEST__.done and print the autotest report')
    ap.add_argument('--check', help='comma separated module paths to import-check via tools/check.html')
    ap.add_argument('--size', default='1280x720')
    ap.add_argument('--cpu', action='store_true', help='use SwiftShader software rendering instead of the GPU')
    ap.add_argument('--quiet', action='store_true', help='only print warnings / errors from the page')
    ap.add_argument('--max-log', type=int, default=250)
    args = ap.parse_args()

    width, height = (int(v) for v in args.size.lower().split('x'))
    url = args.url
    wait = args.wait
    eval_expr = args.eval_expr
    if args.check:
        url = 'tools/check.html?m=' + ','.join(m.strip().lstrip('/').replace('\\', '/') for m in args.check.split(',') if m.strip())
        wait = wait or 'window.__CHECK__ && window.__CHECK__.done'
        eval_expr = eval_expr or 'window.__CHECK__'
    if args.report:
        wait = wait or 'window.__TEST__ && window.__TEST__.done'
        eval_expr = eval_expr or 'window.__TEST__'
    wait = wait or "document.readyState === 'complete'"

    server, port = serve_in_background(0)
    proc, profile, ws_url = launch_chrome(width, height, not args.cpu)
    log = Log(args.quiet, args.max_log)
    ok_wait = False
    code = 1
    try:
        cdp = CDP(ws_url)
        cdp.call('Runtime.enable')
        cdp.call('Log.enable')
        cdp.call('Page.enable')
        cdp.call('Emulation.setDeviceMetricsOverride', {'width': width, 'height': height, 'deviceScaleFactor': 1, 'mobile': False})
        full = f'http://127.0.0.1:{port}/{url.lstrip("/")}'
        print(f'[run] {full}')
        cdp.call('Page.navigate', {'url': full})
        t0 = time.time()
        shots = sorted(float(s) for s in args.shots.split(',')) if args.shots else []
        os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)

        def drain():
            while True:
                try:
                    log.handle(cdp.events.get_nowait())
                except queue.Empty:
                    return

        def screenshot(path):
            os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
            data = cdp.call('Page.captureScreenshot', {'format': 'png'}, timeout=60)['data']
            with open(path, 'wb') as f:
                f.write(base64.b64decode(data))
            print(f'[run] screenshot -> {os.path.relpath(path, ROOT)}')

        last_poll = 0
        deadline = t0 + args.timeout
        while time.time() < deadline:
            drain()
            el = time.time() - t0
            while shots and el >= shots[0]:
                screenshot(f'{args.out}_{shots.pop(0):g}s.png')
            if time.time() - last_poll > 0.25:
                last_poll = time.time()
                try:
                    v = cdp.evaluate(f'!!({wait})', timeout=15)
                except Exception as e:  # noqa: BLE001
                    v = None
                    log.out('warning', f'wait poll failed: {e}')
                if v is True:
                    ok_wait = True
                    break
            time.sleep(0.05)
        if not ok_wait:
            log.out('error', f'[run] timed out after {args.timeout:g}s waiting for: {wait}')
        end = time.time() + args.after
        while time.time() < end:
            drain()
            el = time.time() - t0
            while shots and el >= shots[0]:
                screenshot(f'{args.out}_{shots.pop(0):g}s.png')
            time.sleep(0.05)
        drain()
        for s in shots:  # shots scheduled past the end
            screenshot(f'{args.out}_{s:g}s.png')
        if args.shot:
            screenshot(args.shot)
        if eval_expr:
            val = cdp.evaluate(f'(() => {{ const v = ({eval_expr}); return v === undefined ? null : JSON.parse(JSON.stringify(v)); }})()', timeout=30)
            if args.report:
                val = summarize_report(val)
            print('[result] ' + json.dumps(val, indent=1)[:60000])
        drain()
        code = 0 if ok_wait and not log.errors else 1
        print(f'[run] done: wait={"ok" if ok_wait else "TIMEOUT"} console_errors={len(log.errors)} warnings={log.warnings}')
    finally:
        try:
            proc.kill()
            proc.wait(timeout=10)
        except Exception:  # noqa: BLE001
            pass
        shutil.rmtree(profile, ignore_errors=True)
        server.shutdown()
    sys.exit(code)


if __name__ == '__main__':
    main()
