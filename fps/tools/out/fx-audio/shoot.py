#!/usr/bin/env python3
"""Scenario-driven screenshot driver: the page sets window.__SHOT_REQ = 'name' (and freezes time);
we screenshot, then clear the request so the scenario continues."""
import base64, json, os, queue, shutil, sys, time
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import run as R  # noqa: E402

url = sys.argv[1]
outdir = sys.argv[2]
size = sys.argv[3] if len(sys.argv) > 3 else '1280x720'
timeout = float(sys.argv[4]) if len(sys.argv) > 4 else 120
w, h = (int(v) for v in size.split('x'))
os.makedirs(outdir, exist_ok=True)
server, port = R.serve_in_background(0)
proc, profile, ws = R.launch_chrome(w, h, True)
log = R.Log(False, 200)
try:
    cdp = R.CDP(ws)
    cdp.call('Runtime.enable'); cdp.call('Log.enable'); cdp.call('Page.enable')
    cdp.call('Emulation.setDeviceMetricsOverride', {'width': w, 'height': h, 'deviceScaleFactor': 1, 'mobile': False})
    cdp.call('Page.navigate', {'url': f'http://127.0.0.1:{port}/{url}'})
    t0 = time.time()
    done = False
    while time.time() - t0 < timeout:
        while True:
            try: log.handle(cdp.events.get_nowait())
            except queue.Empty: break
        req = cdp.evaluate('window.__SHOT_REQ || null')
        if req:
            if '--dbg' in sys.argv:
                print('[dbg]', cdp.evaluate('(() => { const g = window.__GAME__.effects.glow; const a = []; for (let i = 0; i < Math.min(8, g.count); i++) a.push([+g.data[i*28+6].toFixed(4), +g.data[i*28+7].toFixed(3)]); return JSON.stringify({c: g.count, ts: window.__GAME__.timeScale, a}); })()'))
            data = cdp.call('Page.captureScreenshot', {'format': 'png'}, timeout=60)['data']
            p = os.path.join(outdir, req + '.png')
            open(p, 'wb').write(base64.b64decode(data))
            print('[shoot]', os.path.relpath(p, ROOT))
            cdp.evaluate('window.__SHOT_REQ = null; window.__SHOT_ACK = (window.__SHOT_ACK || 0) + 1')
        if cdp.evaluate('!!(window.__TEST__ && window.__TEST__.done)'):
            done = True
            break
        time.sleep(0.05)
    rep = cdp.evaluate('(() => { const v = window.__TEST__; return v ? JSON.parse(JSON.stringify(v)) : null; })()')
    if rep:
        errs = rep.get('errors') or []
        print('[report] fps', rep.get('fps'), 'errors', len(errs), 'custom', json.dumps(rep.get('custom'), indent=1)[:6000])
        for e in errs[:10]: print('[error]', e[:400])
    print('[shoot] done' if done else '[shoot] TIMEOUT', 'console_errors', len(log.errors))
finally:
    try: proc.kill(); proc.wait(timeout=10)
    except Exception: pass
    shutil.rmtree(profile, ignore_errors=True)
    server.shutdown()
