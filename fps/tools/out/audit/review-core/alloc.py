"""Micro-benchmark heap allocation per call of core hot-path APIs (CDP getHeapUsage before/after, no GC in between)."""
import json, sys, time, shutil
sys.path.insert(0, r'C:\Users\caleb\Desktop\AiProject\fps\tools')
import run as R
from serve import serve_in_background

def main():
    server, port = serve_in_background(0)
    proc, profile, ws_url = R.launch_chrome(1280, 720, True)
    try:
        cdp = R.CDP(ws_url)
        cdp.call('Runtime.enable'); cdp.call('Page.enable'); cdp.call('HeapProfiler.enable')
        url = f'http://127.0.0.1:{port}/index.html?autotest=1&map=sandbox&bots=0&duration=999&scenario=tools/out/audit/review-core/probe.js&probefile=tools/out/audit/review-core/idle.js'
        cdp.call('Page.navigate', {'url': url})
        t0 = time.time()
        while time.time() - t0 < 90:
            if cdp.evaluate('!!(window.__TEST__ && window.__TEST__.started)') is True: break
            time.sleep(0.3)
        time.sleep(1.0)
        cdp.evaluate("""(async()=>{
          const T = await import('three');
          const { Capsule } = await import('three/addons/math/Capsule.js');
          const g = window.__GAME__; const col = g.world.collision;
          const o = new T.Vector3(-20, 1.0, 5), d = new T.Vector3(0, -1, 0);
          const cap = new Capsule(new T.Vector3(-20, 0.45, 5), new T.Vector3(-20, 1.4, 5), 0.4);
          const vel = new T.Vector3(3, -1, 0);
          window.__b = {
            raycastHit: (n) => { for (let i = 0; i < n; i++) col.raycast(o, d, 5); },
            raycastMiss: (n) => { for (let i = 0; i < n; i++) col.raycast(o, new T.Vector3(0,1,0), 0.5); },
            probeGround: (n) => { for (let i = 0; i < n; i++) col.probeGround(cap, 0.5); },
            moveCapsule: (n) => { for (let i = 0; i < n; i++) { cap.start.set(-20, 0.41, 5); cap.end.set(-20, 1.36, 5); vel.set(3, -1, 0); col.moveCapsule(cap, vel, 1/120); } },
            consumeLook: (n) => { for (let i = 0; i < n; i++) g.input.consumeLook(); },
            combatRaycast: (n) => { for (let i = 0; i < n; i++) g.combat.raycast(o, d, 5, null); },
            canSee: (n) => { for (let i = 0; i < n; i++) g.combat.canSee(o, new T.Vector3(-20, 0.2, 5)); },
          };
          return 1; })()""", timeout=60)
        def heap():
            return cdp.call('Runtime.getHeapUsage')['usedSize']
        res = {}
        for name, n in [('raycastHit', 20000), ('raycastMiss', 20000), ('probeGround', 5000), ('moveCapsule', 5000), ('consumeLook', 50000), ('combatRaycast', 20000), ('canSee', 20000)]:
            best = None
            for attempt in range(3):
                h0 = heap()
                cdp.evaluate(f'window.__b.{name}({n})', timeout=60)
                h1 = heap()
                if h1 > h0:
                    per = (h1 - h0) / n
                    best = per if best is None else min(best, per)
            res[name] = round(best, 1) if best is not None else None
        print(json.dumps(res))
    finally:
        try: proc.kill(); proc.wait(timeout=10)
        except Exception: pass
        shutil.rmtree(profile, ignore_errors=True)
        server.shutdown()
main()
