"""Sampling heap profile (all allocations, incl. garbage) of a gameplay run via CDP HeapProfiler.

usage: python prof.py "<url>" <seconds> [top]
"""
import json, os, sys, time, collections
HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
sys.path.insert(0, TOOLS)
import serve
serve.ThreadingServer.request_queue_size = 512
import run  # noqa: E402

url = sys.argv[1]
secs = float(sys.argv[2])
top = int(sys.argv[3]) if len(sys.argv) > 3 else 40
pre = sys.argv[4] if len(sys.argv) > 4 else None

server, port = serve.serve_in_background(0)
proc, profile, ws_url = run.launch_chrome(1280, 720, True)
try:
    cdp = run.CDP(ws_url)
    cdp.call('Runtime.enable')
    cdp.call('Page.enable')
    cdp.call('HeapProfiler.enable')
    cdp.call('Emulation.setDeviceMetricsOverride', {'width': 1280, 'height': 720, 'deviceScaleFactor': 1, 'mobile': False})
    cdp.call('Page.navigate', {'url': f'http://127.0.0.1:{port}/{url.lstrip("/")}'})
    t0 = time.time()
    while time.time() - t0 < 120:
        v = cdp.evaluate('!!(window.__TEST__ && window.__TEST__.started)', timeout=15)
        if v is True:
            break
        time.sleep(0.5)
    else:
        print('never started')
        sys.exit(1)
    if pre:
        print('pre-eval:', cdp.evaluate(pre))
    time.sleep(3)
    cdp.call('HeapProfiler.startSampling', {
        'samplingInterval': 4096, 'includeObjectsCollectedByMajorGC': True, 'includeObjectsCollectedByMinorGC': True})
    f0 = cdp.evaluate('window.__GAME__.frame')
    time.sleep(secs)
    f1 = cdp.evaluate('window.__GAME__.frame')
    prof = cdp.call('HeapProfiler.stopSampling', timeout=120)['profile']
    frames = f1 - f0
    agg = collections.Counter()
    aggFile = collections.Counter()

    def walk(n):
        cf = n['callFrame']
        key = f"{cf['functionName'] or '(anon)'} @ {os.path.basename(cf['url']) or '?'}:{cf['lineNumber'] + 1}"
        agg[key] += n.get('selfSize', 0)
        aggFile[os.path.basename(cf['url']) or '(native)'] += n.get('selfSize', 0)
        for c in n.get('children', []):
            walk(c)
    walk(prof['head'])
    total = sum(agg.values())
    print(f'frames sampled: {frames}, total sampled alloc: {total / 1024:.0f} KB, per frame: {total / 1024 / max(1, frames):.1f} KB')
    print('--- by file')
    for k, v in aggFile.most_common(25):
        print(f'{v / 1024 / max(1, frames):8.1f} KB/frame  {k}')
    print('--- by function')
    for k, v in agg.most_common(top):
        print(f'{v / 1024 / max(1, frames):8.1f} KB/frame  {k}')
finally:
    try:
        proc.kill()
    except Exception:
        pass
    server.shutdown()
