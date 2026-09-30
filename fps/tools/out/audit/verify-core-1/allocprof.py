import json, sys, time, shutil, collections
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
        url = f'http://127.0.0.1:{port}/index.html?autotest=1&map=foundry&bots=8&duration=999&script=full'
        cdp.call('Page.navigate', {'url': url})
        t0 = time.time()
        while time.time() - t0 < 90:
            if cdp.evaluate('!!(window.__TEST__ && window.__TEST__.started)') is True: break
            time.sleep(0.3)
        time.sleep(3.0)
        f0 = cdp.evaluate('window.__GAME__.frame')
        cdp.call('HeapProfiler.startSampling', {'samplingInterval': 512, 'includeObjectsCollectedByMajorGC': True, 'includeObjectsCollectedByMinorGC': True})
        t1 = time.time()
        time.sleep(10.0)
        prof = cdp.call('HeapProfiler.stopSampling', timeout=60)['profile']
        dt = time.time() - t1
        f1 = cdp.evaluate('window.__GAME__.frame')
        tot = 0
        by = collections.Counter()
        def walk(n):
            nonlocal tot
            cf = n['callFrame']
            s = n['selfSize']
            tot += s
            by[(cf['functionName'] or '(anon)', cf['url'].split('/')[-1], cf['lineNumber'] + 1)] += s
            for c in n.get('children', []): walk(c)
        walk(prof['head'])
        print('seconds', round(dt, 1), 'frames', f1 - f0, 'total MB', round(tot / 1048576, 2), 'MB/s', round(tot / 1048576 / dt, 2))
        for (fn, url, line), s in by.most_common(40):
            print(f'{s/1024:9.1f} KB  {s/tot*100:5.1f}%  {fn} {url}:{line}')
        # aggregate by file
        byfile = collections.Counter()
        for (fn, url, line), s in by.items(): byfile[url] += s
        print('--- by file')
        for url, s in byfile.most_common(15): print(f'{s/1024:9.1f} KB {s/tot*100:5.1f}% {url}')
    finally:
        try: proc.kill(); proc.wait(timeout=10)
        except Exception: pass
        shutil.rmtree(profile, ignore_errors=True)
        server.shutdown()
main()
