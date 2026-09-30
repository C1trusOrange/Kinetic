import sys, os, json, time, collections
ROOT = r'C:\Users\caleb\Desktop\AiProject\fps'
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import run  # noqa
from serve import serve_in_background

url = sys.argv[1] if len(sys.argv) > 1 else 'index.html?autotest=1&map=foundry&bots=6&duration=40&script=idle&god=1'
secs = float(sys.argv[2]) if len(sys.argv) > 2 else 8.0
pre = sys.argv[3] if len(sys.argv) > 3 else None
server, port = serve_in_background(0)
proc, profile, ws = run.launch_chrome(1280, 720, True)
try:
    cdp = run.CDP(ws)
    cdp.call('Runtime.enable'); cdp.call('Page.enable')
    cdp.call('Emulation.setDeviceMetricsOverride', {'width': 1280, 'height': 720, 'deviceScaleFactor': 1, 'mobile': False})
    cdp.call('Page.navigate', {'url': f'http://127.0.0.1:{port}/{url}'})
    t0 = time.time()
    while time.time() - t0 < 120:
        v = cdp.evaluate('!!(window.__TEST__ && window.__TEST__.started)', timeout=15)
        if v is True: break
        time.sleep(0.5)
    print('started after', round(time.time() - t0, 1), 's')
    time.sleep(2.0)
    if pre:
        print('pre ->', cdp.evaluate(pre))
        time.sleep(1.0)
    cdp.call('Profiler.enable')
    cdp.call('Profiler.setSamplingInterval', {'interval': 200})
    cdp.call('Profiler.start')
    fr0 = cdp.evaluate('window.__TEST__ && window.__TEST__.frames')
    time.sleep(secs)
    fr1 = cdp.evaluate('window.__TEST__ && window.__TEST__.frames')
    prof = cdp.call('Profiler.stop', timeout=60)['profile']
    print('frames during profile', fr0, fr1)
    nodes = {n['id']: n for n in prof['nodes']}
    parent = {}
    for n in prof['nodes']:
        for c in n.get('children', []): parent[c] = n['id']
    samples, deltas = prof['samples'], prof['timeDeltas']
    total = sum(deltas)
    selfT = collections.Counter(); incl = collections.Counter()
    def key(n):
        cf = n['callFrame']; return f"{cf['functionName'] or '(anon)'} {cf['url'].split('/')[-1]}:{cf['lineNumber']}"
    for sid, dt in zip(samples, deltas):
        n = nodes[sid]
        selfT[key(n)] += dt
        seen = set(); cur = sid
        while cur is not None:
            k = key(nodes[cur]); fn = nodes[cur]['callFrame']['functionName']
            if k not in seen:
                incl[k] += dt; seen.add(k)
            cur = parent.get(cur)
    print('total ms', total / 1000)
    nf = max(1, (fr1 or 0) - (fr0 or 0))
    def inc(prefix): return sum(v for k, v in incl.items() if k.startswith(prefix)) / 1000
    print('PER-FRAME ms: frames', nf, 'setProgram', round(inc('setProgram')/nf,3), 'getProgram(renderer)', round(incl.get('getProgram three.module.js:30353',0)/1000/nf,3), 'getProgramCacheKey', round(inc('getProgramCacheKey')/nf,3), 'renderObjects', round(inc('renderObjects')/nf,3), 'Game.render', round(incl.get('render Game.js:712',0)/1000/nf,3))
    print('--- top self')
    for k, v in selfT.most_common(25): print(f'{v/1000:8.1f} ms  {k}')
    print('--- inclusive of interest')
    for name in ['setProgram', 'getProgram', 'getParameters', 'getProgramCacheKey', 'render ', 'renderObjects', 'renderBufferDirect', 'projectObject', 'updateMatrixWorld', 'getUniforms', 'setupLights', 'initMaterial', 'compile']:
        tot = sum(v for k, v in incl.items() if k.startswith(name))
        print(f'{tot/1000:8.1f} ms  {name}')
    print('--- top inclusive')
    for k, v in incl.most_common(40): print(f'{v/1000:8.1f} ms  {k}')
finally:
    try: proc.kill(); proc.wait(timeout=10)
    except Exception: pass
    import shutil; shutil.rmtree(profile, ignore_errors=True)
    server.shutdown()
