#!/usr/bin/env python3
"""Perf-audit runner (scratch): like tools/run.py but with CDP CPU profiler / heap sampling profiler
and precise memory info. Imports helpers from tools/run.py (read only).

usage: python prun.py "<url>" --cpu out.json --heap out2.json [--size WxH] [--eval expr] [--timeout s]
"""
import argparse, json, os, shutil, subprocess, sys, tempfile, time, queue, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
sys.path.insert(0, TOOLS)
import run as R  # noqa: E402
from serve import serve_in_background  # noqa: E402


def launch(width, height, extra, profile_dir=None):
    port = R.free_port()
    profile = profile_dir or tempfile.mkdtemp(prefix='kinetic-perf-')
    os.makedirs(profile, exist_ok=True)
    args = [
        R.find_chrome(), '--headless=new', f'--remote-debugging-port={port}', f'--user-data-dir={profile}',
        f'--window-size={width},{height}', '--no-first-run', '--no-default-browser-check', '--mute-audio',
        '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--hide-scrollbars',
        '--disable-extensions', '--ignore-gpu-blocklist', '--disable-gpu-watchdog', 'about:blank',
        '--enable-gpu', '--use-angle=default', '--enable-precise-memory-info',
    ] + extra
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
        except Exception:
            time.sleep(0.2)
    if not ws_url:
        proc.kill()
        raise RuntimeError('no chrome')
    return proc, profile, ws_url


def aggregate_cpu(profile, top=90):
    nodes = {n['id']: n for n in profile['nodes']}
    dts = profile['timeDeltas']
    samples = profile['samples']
    selft = {}
    for nid, dt in zip(samples, dts):
        selft[nid] = selft.get(nid, 0) + dt
    byfn = {}
    for nid, t in selft.items():
        cf = nodes[nid]['callFrame']
        key = (cf['functionName'] or '(anon)', cf['url'].split('/')[-1] if cf['url'] else '', cf['lineNumber'] + 1)
        byfn[key] = byfn.get(key, 0) + t
    total = sum(byfn.values()) or 1
    rows = sorted(byfn.items(), key=lambda kv: -kv[1])[:top]
    byfile = {}
    for k, v in byfn.items():
        byfile[k[1] or '(native)'] = byfile.get(k[1] or '(native)', 0) + v
    global LAST_BYFILE
    LAST_BYFILE = sorted(((f, round(v / 1000.0, 1), round(100 * v / total, 1)) for f, v in byfile.items()), key=lambda r: -r[1])[:40]
    return total / 1000.0, [(f'{k[0]} {k[1]}:{k[2]}', round(v / 1000.0, 1), round(100 * v / total, 1)) for k, v in rows]


LAST_BYFILE = []


def aggregate_heap(profile, top=45):
    byfn = {}

    def walk(n):
        cf = n['callFrame']
        key = (cf['functionName'] or '(anon)', cf['url'].split('/')[-1] if cf['url'] else '', cf['lineNumber'] + 1)
        byfn[key] = byfn.get(key, 0) + n.get('selfSize', 0)
        for c in n.get('children', []):
            walk(c)
    walk(profile['head'])
    total = sum(byfn.values()) or 1
    rows = sorted(byfn.items(), key=lambda kv: -kv[1])[:top]
    return total / 1048576.0, [(f'{k[0]} {k[1]}:{k[2]}', round(v / 1024.0, 1), round(100 * v / total, 1)) for k, v in rows]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('url')
    ap.add_argument('--cpu')
    ap.add_argument('--heap', action='store_true')
    ap.add_argument('--size', default='1280x720')
    ap.add_argument('--timeout', type=float, default=120)
    ap.add_argument('--eval', dest='eval_expr')
    ap.add_argument('--start', default='window.__TEST__ && window.__TEST__.started')
    ap.add_argument('--end', default='window.__TEST__ && window.__TEST__.done')
    ap.add_argument('--flags', default='')
    ap.add_argument('--out', default=None)
    ap.add_argument('--profile-dir', default=None)
    a = ap.parse_args()
    w, h = (int(v) for v in a.size.split('x'))
    server, port = serve_in_background(0)
    proc, profile, ws = launch(w, h, a.flags.split() if a.flags else [], a.profile_dir)
    result = {}
    try:
        cdp = R.CDP(ws)
        cdp.call('Runtime.enable'); cdp.call('Log.enable'); cdp.call('Page.enable')
        cdp.call('Emulation.setDeviceMetricsOverride', {'width': w, 'height': h, 'deviceScaleFactor': 1, 'mobile': False})
        errors = []
        def drain():
            while True:
                try:
                    ev = cdp.events.get_nowait()
                except queue.Empty:
                    return
                if ev.get('method') == 'Runtime.consoleAPICalled' and ev['params'].get('type') == 'error':
                    errors.append(' '.join(R.fmt_remote(x) for x in ev['params'].get('args', []))[:300])
                elif ev.get('method') == 'Runtime.exceptionThrown':
                    errors.append(str(ev['params'].get('exceptionDetails', {}).get('text')))
        cdp.call('Page.navigate', {'url': f'http://127.0.0.1:{port}/{a.url.lstrip("/")}'})
        t0 = time.time()
        # wait started
        while time.time() - t0 < a.timeout:
            drain()
            if cdp.evaluate(f'!!({a.start})', timeout=15) is True:
                break
            time.sleep(0.2)
        if a.cpu:
            cdp.call('Profiler.enable'); cdp.call('Profiler.setSamplingInterval', {'interval': 500}); cdp.call('Profiler.start')
        if a.heap:
            cdp.call('HeapProfiler.enable'); cdp.call('HeapProfiler.startSampling', {'samplingInterval': 2048, 'includeObjectsCollectedByMajorGC': True, 'includeObjectsCollectedByMinorGC': True})
        while time.time() - t0 < a.timeout:
            drain()
            if cdp.evaluate(f'!!({a.end})', timeout=15) is True:
                break
            time.sleep(0.25)
        if a.cpu:
            prof = cdp.call('Profiler.stop', timeout=60)['profile']
            tot, rows = aggregate_cpu(prof)
            result['cpu_total_ms'] = round(tot, 1)
            result['cpu_top'] = rows
            result['cpu_by_file'] = LAST_BYFILE
        if a.heap:
            prof = cdp.call('HeapProfiler.stopSampling', timeout=60)['profile']
            tot, rows = aggregate_heap(prof)
            result['alloc_total_mb'] = round(tot, 2)
            result['alloc_top_kb'] = rows
        if a.eval_expr:
            result['eval'] = cdp.evaluate(f'(() => {{ const v = ({a.eval_expr}); return v === undefined ? null : JSON.parse(JSON.stringify(v)); }})()', timeout=30)
        drain()
        result['errors'] = errors[:10]
    finally:
        try:
            proc.kill(); proc.wait(timeout=10)
        except Exception:
            pass
        if not a.profile_dir:
            shutil.rmtree(profile, ignore_errors=True)
        server.shutdown()
    txt = json.dumps(result, indent=1)
    if a.out:
        open(a.out, 'w').write(txt)
    print(txt[:30000])


if __name__ == '__main__':
    main()
