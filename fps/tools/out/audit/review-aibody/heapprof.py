#!/usr/bin/env python3
"""Sampling heap profile of a KINETIC autotest run (allocation sites, including already-collected objects)."""
import json, os, sys, time, shutil, collections
ROOT = r'C:\Users\caleb\Desktop\AiProject\fps'
sys.path.insert(0, os.path.join(ROOT, 'tools'))
from run import CDP, launch_chrome, serve_in_background  # noqa: E402

url = sys.argv[1]
warm = float(sys.argv[2]) if len(sys.argv) > 2 else 4.0
dur = float(sys.argv[3]) if len(sys.argv) > 3 else 10.0
filt = sys.argv[4] if len(sys.argv) > 4 else 'src/'

server, port = serve_in_background(0)
proc, profile, ws_url = launch_chrome(1280, 720, True)
try:
    cdp = CDP(ws_url)
    cdp.call('Runtime.enable')
    cdp.call('Page.enable')
    cdp.call('HeapProfiler.enable')
    cdp.call('Emulation.setDeviceMetricsOverride', {'width': 1280, 'height': 720, 'deviceScaleFactor': 1, 'mobile': False})
    cdp.call('Page.navigate', {'url': f'http://127.0.0.1:{port}/{url}'})
    t0 = time.time()
    while time.time() - t0 < 200:
        v = cdp.evaluate('window.__TEST__ && window.__TEST__.started && window.__TEST__.t > %f' % warm)
        if v is True:
            break
        time.sleep(0.3)
    frames0 = cdp.evaluate('window.__TEST__.frames')
    cdp.call('HeapProfiler.startSampling', {
        'samplingInterval': 128,
        'includeObjectsCollectedByMajorGC': True,
        'includeObjectsCollectedByMinorGC': True,
    })
    time.sleep(dur)
    frames1 = cdp.evaluate('window.__TEST__.frames')
    prof = cdp.call('HeapProfiler.stopSampling', timeout=60)['profile']
    print('frames', frames0, frames1)
    agg = collections.Counter()
    tot = 0

    def walk(n):
        global tot
        cf = n['callFrame']
        key = (cf['functionName'] or '(anon)', cf['url'].split('127.0.0.1:%d/' % port)[-1], cf['lineNumber'] + 1)
        agg[key] += n['selfSize']
        tot += n['selfSize']
        for c in n.get('children', []):
            walk(c)
    sys.setrecursionlimit(100000)
    walk(prof['head'])
    print('total sampled bytes:', tot)
    per_frame = (frames1 - frames0) or 1
    rows = [(k, v) for k, v in agg.most_common() if filt in k[1]]
    for (fn, u, ln), v in rows[:60]:
        print(f'{v/per_frame:9.1f} B/frame  {fn:32s} {u}:{ln}')
    print('--- all (non-filtered) top 15')
    for (fn, u, ln), v in agg.most_common(15):
        print(f'{v/per_frame:9.1f} B/frame  {fn:32s} {u}:{ln}')
finally:
    try:
        proc.kill(); proc.wait(timeout=10)
    except Exception:
        pass
    shutil.rmtree(profile, ignore_errors=True)
    server.shutdown()
