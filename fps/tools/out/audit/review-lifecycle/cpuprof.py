"""CPU profile of a gameplay run via CDP Profiler; prints self-time by function and by three.js program-selection family.

usage: python cpuprof.py "<url>" <seconds> [top] [pre-eval JS]
"""
import collections, os, sys, time
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
    cdp.call('Profiler.enable')
    cdp.call('Emulation.setDeviceMetricsOverride', {'width': 1280, 'height': 720, 'deviceScaleFactor': 1, 'mobile': False})
    cdp.call('Page.navigate', {'url': f'http://127.0.0.1:{port}/{url.lstrip("/")}'})
    t0 = time.time()
    while time.time() - t0 < 120:
        if cdp.evaluate('!!(window.__TEST__ && window.__TEST__.started)', timeout=15) is True:
            break
        time.sleep(0.5)
    else:
        print('never started')
        sys.exit(1)
    if pre:
        print('pre-eval:', cdp.evaluate(pre))
    time.sleep(3)
    cdp.call('Profiler.setSamplingInterval', {'interval': 200})
    cdp.call('Profiler.start')
    f0 = cdp.evaluate('window.__GAME__.frame')
    time.sleep(secs)
    f1 = cdp.evaluate('window.__GAME__.frame')
    prof = cdp.call('Profiler.stop', timeout=120)['profile']
    nodes = {n['id']: n for n in prof['nodes']}
    dts = prof['timeDeltas']
    samples = prof['samples']
    selfus = collections.Counter()
    for sid, dt in zip(samples, dts):
        selfus[sid] += dt
    total = sum(selfus.values())
    agg = collections.Counter()
    fam = collections.Counter()
    for nid, us in selfus.items():
        cf = nodes[nid]['callFrame']
        name = cf['functionName'] or '(anon)'
        key = f"{name} @ {os.path.basename(cf['url']) or '?'}:{cf['lineNumber'] + 1}"
        agg[key] += us
    # inclusive time for selected functions
    parent = {}
    for n in prof['nodes']:
        for c in n.get('children', []):
            parent[c] = n['id']
    incl = collections.Counter()
    watch = {'getProgram', 'getParameters', 'getProgramCacheKey', 'getProgramCacheKeyParameters', 'setProgram', 'render', 'renderBufferDirect'}
    for nid, us in selfus.items():
        seen = set()
        cur = nid
        while cur is not None:
            nm = nodes[cur]['callFrame']['functionName']
            if nm in watch and nm not in seen:
                seen.add(nm)
                incl[nm] += us
            cur = parent.get(cur)
    frames = f1 - f0
    print(f'frames {frames}, profiled {total / 1e6:.2f} s, avg {total / 1000 / max(1, frames):.2f} ms/frame (wall incl. idle)')
    print('--- inclusive ms/frame for selected three.js functions')
    for k, v in incl.most_common():
        print(f'{v / 1000 / max(1, frames):8.3f} ms/frame  {k}')
    print('--- self time by function')
    for k, v in agg.most_common(top):
        print(f'{v / 1000 / max(1, frames):8.3f} ms/frame  {k}')
finally:
    try:
        proc.kill()
    except Exception:
        pass
    server.shutdown()
