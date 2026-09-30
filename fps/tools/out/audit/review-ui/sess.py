"""Tiny multi-step headless-Chrome session driver for UI screenshots (scratch tool, reuses tools/run.py)."""
import base64
import json
import os
import queue
import shutil
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..', '..'))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
from run import launch_chrome, CDP, Log  # noqa: E402
import serve as _serve  # noqa: E402
_serve.ThreadingServer.request_queue_size = 256
from serve import serve_in_background  # noqa: E402


class Session:
    def __init__(self, width=1280, height=720, gpu=True):
        self.w, self.h = width, height
        self.server, self.port = serve_in_background(0)
        self.proc, self.profile, ws = launch_chrome(width, height, gpu)
        self.cdp = CDP(ws)
        self.log = Log(False, 300)
        for m in ('Runtime.enable', 'Log.enable', 'Page.enable'):
            self.cdp.call(m)
        self.cdp.call('Emulation.setDeviceMetricsOverride', {'width': width, 'height': height, 'deviceScaleFactor': 1, 'mobile': False})

    def drain(self):
        while True:
            try:
                self.log.handle(self.cdp.events.get_nowait())
            except queue.Empty:
                return

    def goto(self, url, wait="document.readyState==='complete'", timeout=90):
        self.cdp.call('Page.navigate', {'url': f'http://127.0.0.1:{self.port}/{url.lstrip("/")}'}, timeout=150)
        t0 = time.time()
        while time.time() - t0 < timeout:
            self.drain()
            try:
                if self.cdp.evaluate(f'!!({wait})', timeout=15) is True:
                    return True
            except Exception:
                pass
            time.sleep(0.25)
        print('[sess] TIMEOUT waiting for', wait)
        return False

    def js(self, expr, timeout=30):
        v = self.cdp.evaluate(f'(() => {{ const v = ({expr}); return v === undefined ? null : JSON.parse(JSON.stringify(v)); }})()', timeout)
        return v

    def run(self, code, timeout=30):
        """Run statements (async allowed)."""
        return self.cdp.evaluate(f'(async () => {{ {code} }})()', timeout)

    def wait(self, secs):
        end = time.time() + secs
        while time.time() < end:
            self.drain()
            time.sleep(0.05)

    def shot(self, name):
        path = os.path.join(HERE, name)
        data = self.cdp.call('Page.captureScreenshot', {'format': 'png'}, timeout=60)['data']
        with open(path, 'wb') as f:
            f.write(base64.b64decode(data))
        print('[shot]', os.path.relpath(path, ROOT))

    def click(self, sel):
        r = self.js(f"(() => {{ const e = document.querySelector({json.dumps(sel)}); if (!e) return 'missing'; e.click(); return 'ok'; }})()")
        if r != 'ok':
            print('[click]', sel, r)

    def mouse(self, x, y):
        self.cdp.call('Input.dispatchMouseEvent', {'type': 'mouseMoved', 'x': x, 'y': y})

    def hover(self, sel):
        r = self.js(f"(() => {{ const e = document.querySelector({json.dumps(sel)}); if (!e) return null; const b = e.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; }})()")
        if r:
            self.mouse(r[0], r[1])

    def resize(self, w, h):
        self.w, self.h = w, h
        self.cdp.call('Emulation.setDeviceMetricsOverride', {'width': w, 'height': h, 'deviceScaleFactor': 1, 'mobile': False})

    def close(self):
        self.drain()
        print(f'[sess] console errors={len(self.log.errors)} warnings={self.log.warnings}')
        for e in self.log.errors[:10]:
            print('  ERR', e[:400])
        try:
            self.proc.kill()
            self.proc.wait(timeout=10)
        except Exception:
            pass
        shutil.rmtree(self.profile, ignore_errors=True)
        self.server.shutdown()
