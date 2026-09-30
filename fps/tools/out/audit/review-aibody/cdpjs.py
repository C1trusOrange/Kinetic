#!/usr/bin/env python3
"""Open a KINETIC page, wait for a condition, evaluate an async JS file, print JSON + console errors.
usage: cdpjs.py <url> <js file> [wait expr] [screenshot prefix]"""
import json, os, sys, time, shutil, queue, base64
ROOT = r'C:\Users\caleb\Desktop\AiProject\fps'
sys.path.insert(0, os.path.join(ROOT, 'tools'))
from run import CDP, launch_chrome, serve_in_background  # noqa: E402

url = sys.argv[1]
jsfile = sys.argv[2]
wait = sys.argv[3] if len(sys.argv) > 3 else 'window.__TEST__ && window.__TEST__.started'
shot = sys.argv[4] if len(sys.argv) > 4 else None
size = (1280, 720)

server, port = serve_in_background(0)
proc, profile, ws_url = launch_chrome(size[0], size[1], True)
errors = []


def drain(cdp):
    while True:
        try:
            ev = cdp.events.get_nowait()
        except queue.Empty:
            return
        m = ev.get('method')
        p = ev.get('params', {})
        if m == 'Runtime.consoleAPICalled' and p.get('type') in ('error', 'warning', 'log'):
            txt = ' '.join(str(a.get('value', a.get('description', ''))) for a in p.get('args', []))
            if p.get('type') == 'error':
                errors.append(txt[:500])
            print(f"[console.{p.get('type')}] {txt[:400]}")
        elif m == 'Runtime.exceptionThrown':
            d = p.get('exceptionDetails', {})
            errors.append(str(d.get('exception', {}).get('description', d.get('text')))[:500])
            print('[exception]', errors[-1])


try:
    cdp = CDP(ws_url)
    cdp.call('Runtime.enable')
    cdp.call('Page.enable')
    cdp.call('Emulation.setDeviceMetricsOverride', {'width': size[0], 'height': size[1], 'deviceScaleFactor': 1, 'mobile': False})
    cdp.call('Page.navigate', {'url': f'http://127.0.0.1:{port}/{url}'})
    t0 = time.time()
    ok = False
    while time.time() - t0 < 240:
        drain(cdp)
        v = cdp.evaluate('!!(' + wait + ')')
        if v is True:
            ok = True
            break
        time.sleep(0.3)
    print('wait ok:', ok, 'elapsed %.1f' % (time.time() - t0))
    src = open(jsfile, encoding='utf-8').read()
    res = cdp.evaluate('(async () => {' + src + '})()', timeout=280)
    drain(cdp)
    print('[result]', json.dumps(res, indent=1)[:20000])
    if shot:
        data = cdp.call('Page.captureScreenshot', {'format': 'png'}, timeout=60)['data']
        open(shot, 'wb').write(base64.b64decode(data))
        print('[shot]', shot)
    print('errors:', len(errors))
finally:
    try:
        proc.kill(); proc.wait(timeout=10)
    except Exception:
        pass
    shutil.rmtree(profile, ignore_errors=True)
    server.shutdown()
