"""Heap leak check using CDP HeapProfiler.collectGarbage between measurements (imports the project's run.py helpers)."""
import json, os, sys, time, shutil
sys.path.insert(0, r'C:\Users\caleb\Desktop\AiProject\fps\tools')
import run as R
from serve import serve_in_background

def main():
    server, port = serve_in_background(0)
    proc, profile, ws_url = R.launch_chrome(1280, 720, True)
    try:
        cdp = R.CDP(ws_url)
        cdp.call('Runtime.enable'); cdp.call('Page.enable'); cdp.call('HeapProfiler.enable')
        cdp.call('Emulation.setDeviceMetricsOverride', {'width': 1280, 'height': 720, 'deviceScaleFactor': 1, 'mobile': False})
        mode = sys.argv[1] if len(sys.argv) > 1 else 'maps'
        url = f'http://127.0.0.1:{port}/index.html?autotest=1&map=sandbox&bots=3&duration=999&scenario=tools/out/audit/review-core/probe.js&probefile=tools/out/audit/review-core/idle.js'
        cdp.call('Page.navigate', {'url': url})
        t0 = time.time()
        while time.time() - t0 < 90:
            if cdp.evaluate('!!(window.__TEST__ && window.__TEST__.started)') is True: break
            time.sleep(0.3)
        def heap():
            cdp.call('HeapProfiler.collectGarbage', timeout=60)
            time.sleep(0.3)
            cdp.call('HeapProfiler.collectGarbage', timeout=60)
            r = cdp.call('Runtime.getHeapUsage')
            return round(r['usedSize'] / 1048576, 1)
        def js(expr, timeout=120):
            return cdp.evaluate(expr, timeout=timeout)
        res = []
        res.append(('base', heap()))
        if mode == 'maps':
            seq = ['foundry', 'ruins', 'skyline', 'sandbox'] * 3
            for i, m in enumerate(seq):
                js(f"(async()=>{{await window.__GAME__.startMatch({{...window.__GAME__.lastMatchConfig, mapId:'{m}', botCount:3}}); await new Promise(r=>setTimeout(r,600)); return 1;}})()")
                res.append((f'{i}:{m}', heap()))
        elif mode == 'restart':
            for i in range(12):
                js("(async()=>{await window.__GAME__.startMatch({...window.__GAME__.lastMatchConfig}); await new Promise(r=>setTimeout(r,600)); return 1;})()")
                res.append((f'restart{i}', heap()))
        elif mode == 'quality':
            for i in range(6):
                js("(async()=>{const g=window.__GAME__; g.settings.set('quality','medium'); await new Promise(r=>setTimeout(r,300)); g.settings.set('quality','high'); await new Promise(r=>setTimeout(r,300)); return 1;})()")
                res.append((f'q{i}', heap()))
        for k, v in res: print(k, v)
        print(json.dumps(js('window.__ERRORS__')))
    finally:
        try: proc.kill(); proc.wait(timeout=10)
        except Exception: pass
        shutil.rmtree(profile, ignore_errors=True)
        server.shutdown()

main()
