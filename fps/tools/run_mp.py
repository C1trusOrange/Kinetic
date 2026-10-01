#!/usr/bin/env python3
"""Multi-page headless Chrome harness for KINETIC multiplayer tests (stdlib only).

One headless Chrome and one server (tools/serve.py: static files + the /ws relay, 127.0.0.1 only). Every
page gets its own window (Target.createTarget newWindow:true): a background tab is hidden and never
runs requestAnimationFrame. Console output of every page is streamed with a pN prefix; the harness waits
until each page's condition is true, prints each page's result, takes per-page screenshots and exits 1
on a timeout or any console error / uncaught exception on any page.

Pages come from repeated --page URLs, or --pages N with a --url template. URL placeholders:
    {i} page index   {n} page count   {role} 'host' for page 0 else 'client'   {room} a fresh room code   {port}
Pages can load from an insecure origin like a LAN IP does (--client-origin lan.test maps that name to
127.0.0.1 inside Chrome, so the host page stays on http://127.0.0.1 and the others are http://lan.test).

Examples
  # transport test: 1 host + 3 client pages through the relay (RTT, routing, rejoin, lock, kick, close)
  # plus 1 page for transport edge cases (close while connecting, a drop during a rejoin, refused joins)
  python tools/run_mp.py --nettest

  # two game pages at once (each page's autotest report, merged summary at the end)
  python tools/run_mp.py --pages 2 --url "index.html?autotest=1&map=foundry&bots=2&duration=15&quality=low" --report

  # the game as a LAN friend gets it: insecure origin + only the files `serve.py --lan` gives other machines
  python tools/run_mp.py --pages 2 --url "index.html?autotest=1&map=skyline&bots=2&duration=10&quality=low" --report \\
      --origin lan.test --remote

  # host page first, clients once it is ready
  python tools/run_mp.py --page "tools/nettest.html?role=host&room={room}&clients=1" \\
      --page "tools/nettest.html?role=client&room={room}&i=1" --host-wait "window.__NETTEST__.ready" \\
      --wait "window.__NETTEST__.done" --eval "window.__NETTEST__"

  # multiplayer suites (tools/mp/scenarios/*.js, checked by tools/mp_check.py):
  #   --hide 0:10:5     minimize page 0's window from t = 10 s for 5 s (document.hidden, no rAF, throttled timers);
  #                     WHEN may be 'load': when page 0 first reports window.__NET__.phase === 'loading'
  #   --close 0:30      close page 0 at t = 30 s (the host leaving)
  #   --relay idle_timeout=3,stall_timeout=3   relay option overrides (netserver DEFAULTS keys)
"""
import argparse
import base64
import ipaddress
import json
import os
import queue
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request

TOOLS = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, TOOLS)
from run import CDP, Log, find_chrome, free_port, summarize_report  # noqa: E402
from serve import ROOT, serve_in_background  # noqa: E402
import netserver  # noqa: E402

REPORT_WAIT = 'window.__TEST__ && window.__TEST__.done'
NETTEST_WAIT = 'window.__NETTEST__ && window.__NETTEST__.done'


class PageLog(Log):
    """run.py's console printer with a page prefix."""

    def __init__(self, index, quiet, max_lines):
        super().__init__(quiet, max_lines)
        self.index = index

    def out(self, kind, text):
        super().out(kind, f'p{self.index}: {text}')


class Page:
    def __init__(self, index, url, cdp, log):
        self.index = index
        self.url = url
        self.cdp = cdp
        self.log = log
        self.done_at = None

    def setup(self, width, height):
        for domain in ('Runtime.enable', 'Log.enable', 'Page.enable'):
            self.cdp.call(domain)
        self.cdp.call('Emulation.setDeviceMetricsOverride', {'width': width, 'height': height, 'deviceScaleFactor': 1,
                                                             'mobile': False})

    def drain(self):
        while True:
            try:
                self.log.handle(self.cdp.events.get_nowait())
            except queue.Empty:
                return

    def check(self, expr):
        try:
            return self.cdp.evaluate(f'!!({expr})', timeout=15) is True
        except Exception as e:  # noqa: BLE001
            self.log.out('warning', f'wait poll failed: {e}')
            return False

    def value(self, expr):
        """`expr` as JSON (a Promise is awaited first)."""
        return self.cdp.evaluate(f'(async () => {{ const v = await ({expr}); return v === undefined ? null : '
                                 f'JSON.parse(JSON.stringify(v)); }})()', timeout=30)

    def screenshot(self, path):
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        data = self.cdp.call('Page.captureScreenshot', {'format': 'png'}, timeout=60)['data']
        with open(path, 'wb') as f:
            f.write(base64.b64decode(data))
        print(f'[run_mp] screenshot p{self.index} -> {os.path.relpath(path, ROOT)}')


def launch_browser(width, height, gpu, extra):
    """Headless Chrome; returns (proc, profile dir, debugging port, browser ws url, first page target id)."""
    port = free_port()
    profile = tempfile.mkdtemp(prefix='kinetic-mp-')
    args = [
        find_chrome(), '--headless=new', f'--remote-debugging-port={port}', f'--user-data-dir={profile}',
        f'--window-size={width},{height}', '--no-first-run', '--no-default-browser-check', '--mute-audio',
        '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--hide-scrollbars',
        '--disable-extensions', '--ignore-gpu-blocklist', '--disable-gpu-watchdog', *extra,
    ]
    args += ['--enable-gpu', '--use-angle=default'] if gpu else ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    args.append('about:blank')
    proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    browser_ws = first = None
    deadline = time.time() + 20
    while time.time() < deadline and not (browser_ws and first):
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{port}/json/version', timeout=2) as r:
                browser_ws = json.load(r)['webSocketDebuggerUrl']
            with urllib.request.urlopen(f'http://127.0.0.1:{port}/json/list', timeout=2) as r:
                first = next((t['id'] for t in json.load(r) if t.get('type') == 'page'), None)
        except Exception:  # noqa: BLE001
            time.sleep(0.2)
    if not (browser_ws and first):
        proc.kill()
        shutil.rmtree(profile, ignore_errors=True)
        raise RuntimeError('could not connect to headless Chrome')
    return proc, profile, port, browser_ws, first


def fill(template, values):
    for k, v in values.items():
        template = template.replace('{' + k + '}', str(v))
    return template


def nettest_pages(clients, dur):
    """1 host page, `clients` client pages (the first rejoins after a drop, the second tries a locked room,
    the last of 3+ is kicked) and one page for transport edge cases in private rooms of its own."""
    pages = [f'tools/nettest.html?role=host&room={{room}}&clients={clients}&dur={dur:g}&hz=30']
    for i in range(1, clients + 1):
        flags = ('&drop=1' if i == 1 else '') + ('&locktest=1' if i == 2 else '') + ('&kick=1' if i == clients and clients >= 3 else '')
        pages.append(f'tools/nettest.html?role=client&room={{room}}&clients={clients}&i={i}{flags}')
    pages.append('tools/nettest.html?role=edge')
    return pages


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--page', action='append', default=[], help='page URL relative to the project root (repeat)')
    ap.add_argument('--pages', type=int, default=0, help='number of pages built from --url')
    ap.add_argument('--url', help='URL template for --pages')
    ap.add_argument('--host-wait', help='JS expression that must be true on page 0 before the other pages open')
    ap.add_argument('--wait', help='JS expression; wait until it is truthy on every page')
    ap.add_argument('--eval', dest='eval_expr', help='JS expression printed (as JSON) for every page at the end')
    ap.add_argument('--report', action='store_true', help='wait for window.__TEST__.done on every page and print the autotest reports')
    ap.add_argument('--timeout', type=float, default=120, help='max seconds for all pages (default 120)')
    ap.add_argument('--after', type=float, default=0.0, help='extra seconds to keep running after every page is done')
    ap.add_argument('--stagger', type=float, default=0.2, help='seconds between opening pages (default 0.2)')
    ap.add_argument('--size', default='960x540', help='viewport of every page (default 960x540)')
    ap.add_argument('--origin', default='127.0.0.1', help='host name of page 0 (and of all pages without --client-origin)')
    ap.add_argument('--client-origin', help='host name of pages 1..n-1, e.g. lan.test: an insecure origin like a LAN IP')
    ap.add_argument('--remote', action='store_true',
                    help='serve every page the way `serve.py --lan` serves another machine: only index.html, style.css, '
                         'src/, vendor/, /api/* and /ws (game pages only: tools/ pages and scenario= files are refused)')
    ap.add_argument('--room', help='room code for {room} (default: a fresh random code)')
    ap.add_argument('--shots', help='comma separated seconds (after the first navigation) for screenshots of every page')
    ap.add_argument('--shot', help='screenshot of every page at the end (PATH gets a _pN suffix)')
    ap.add_argument('--out', default=os.path.join(ROOT, 'tools', 'out', 'mp'), help='prefix for --shots files')
    ap.add_argument('--json', dest='json_out', help='write every page\'s result to this JSON file')
    ap.add_argument('--cpu', action='store_true', help='SwiftShader software rendering instead of the GPU')
    ap.add_argument('--quiet', action='store_true', help='only print warnings / errors from the pages')
    ap.add_argument('--max-log', type=int, default=400)
    ap.add_argument('--nettest', nargs='?', type=int, const=3, metavar='CLIENTS',
                    help='preset: the transport test with 1 host + CLIENTS (default 3) client pages + 1 edge-case page')
    ap.add_argument('--dur', type=float, default=8, help='--nettest: seconds of traffic (default 8)')
    ap.add_argument('--hide', action='append', default=[], metavar='PAGE:WHEN:DUR',
                    help="minimize a page's window at WHEN (seconds after the first navigation, or 'load') for DUR s (repeat)")
    ap.add_argument('--close', action='append', default=[], metavar='PAGE:T', help='close a page at T seconds (repeat)')
    ap.add_argument('--relay', action='append', default=[], metavar='KEY=VALUE[,KEY=VALUE]',
                    help='relay option overrides (netserver DEFAULTS), e.g. idle_timeout=3')
    ap.add_argument('--node-relay', action='store_true',
                    help="multiplayer pages use the desktop app's Node relay (desktop/relay.js, started on a free loopback "
                         "port) instead of the Python one: game pages with net= get &server=127.0.0.1:<port>")
    args = ap.parse_args()
    relay_options = {}
    for spec in args.relay:
        for part in spec.split(','):
            if not part.strip():
                continue
            k, _, v = part.partition('=')
            k = k.strip()
            if k not in netserver.DEFAULTS:
                ap.error(f'--relay: unknown option {k!r} (known: {", ".join(netserver.DEFAULTS)})')
            relay_options[k] = type(netserver.DEFAULTS[k])(float(v)) if isinstance(netserver.DEFAULTS[k], (int, float)) else v
    hides = []
    for spec in args.hide:
        try:
            pg, when, dur = spec.split(':')
            hides.append({'page': int(pg), 'when': when, 'dur': float(dur), 'at': None, 'until': None, 'done': False})
        except ValueError:
            ap.error(f'--hide {spec!r}: expected PAGE:WHEN:DUR')
    closes = []
    for spec in args.close:
        try:
            pg, t = spec.split(':')
            closes.append({'page': int(pg), 't': float(t), 'done': False})
        except ValueError:
            ap.error(f'--close {spec!r}: expected PAGE:T')

    templates = list(args.page)
    if args.nettest:
        templates = nettest_pages(max(1, args.nettest), args.dur)
        args.host_wait = args.host_wait or 'window.__NETTEST__ && window.__NETTEST__.ready'
        args.wait = args.wait or NETTEST_WAIT
        args.eval_expr = args.eval_expr or 'window.__NETTEST__'
        args.client_origin = args.client_origin or 'lan.test'
        if args.size == '960x540':
            args.size = '480x270'
    elif args.pages:
        if not args.url:
            ap.error('--pages needs --url')
        templates += [args.url] * args.pages
    if not templates:
        ap.error('no pages: use --page URL (repeat), --pages N --url TEMPLATE or --nettest')
    wait = args.wait or (REPORT_WAIT if args.report else "document.readyState === 'complete'")
    eval_expr = args.eval_expr or ('window.__TEST__' if args.report else None)
    width, height = (int(v) for v in args.size.lower().split('x'))
    n = len(templates)
    room = netserver.normalize_code(args.room) if args.room else netserver.new_code()

    origins = [args.origin] + [args.client_origin or args.origin] * (n - 1)
    names = sorted({o for o in origins if o not in ('localhost',) and not _is_ip(o)})
    extra = [f'--host-resolver-rules={",".join(f"MAP {o} 127.0.0.1" for o in names)}'] if names else []

    server, port = serve_in_background(0, lan=args.remote, bind='127.0.0.1', relay_options=relay_options)   # never 0.0.0.0
    node_relay = node_port = None
    if args.node_relay:
        node_relay, node_port = start_node_relay(port, origins, relay_options)
        print(f'[run_mp] node relay on 127.0.0.1:{node_port}')
    if args.remote:
        server.is_trusted = lambda ip: False                 # treat the loopback pages as other machines
    proc = profile = None
    pages = []
    ok_wait = [False] * n
    code = 1
    results = []
    try:
        proc, profile, dbg, browser_ws, first = launch_browser(width, height, not args.cpu, extra)
        browser = CDP(browser_ws)
        urls = []
        for i, tpl in enumerate(templates):
            rel = fill(tpl, {'i': i, 'n': n, 'role': 'host' if i == 0 else 'client', 'room': room, 'port': port,
                             'server': f'127.0.0.1:{node_port}' if node_port else ''})
            if node_port and 'net=' in rel and 'server=' not in rel:
                rel += ('&' if '?' in rel else '?') + f'server=127.0.0.1:{node_port}'
            urls.append(f'http://{origins[i]}:{port}/{rel.lstrip("/")}')
        t0 = time.time()
        deadline = t0 + args.timeout
        shots = sorted(float(s) for s in args.shots.split(',')) if args.shots else []

        def window_state(page, state):
            try:
                w = browser.call('Browser.getWindowForTarget', {'targetId': page.target})
                browser.call('Browser.setWindowBounds', {'windowId': w['windowId'], 'bounds': {'windowState': state}})
                print(f'[run_mp] p{page.index} window {state} at {time.time() - t0:.1f} s')
            except Exception as err:  # noqa: BLE001
                page.log.out('error', f'[run_mp] could not set window state {state}: {err}')

        def schedule():
            el = time.time() - t0
            for h in hides:
                if h['done'] or h['page'] >= len(pages):
                    continue
                pg = pages[h['page']]
                if h['at'] is None:
                    if h['when'] == 'load':
                        if pages and pages[0].check("window.__NET__ && window.__NET__.phase === 'loading'"):
                            h['at'] = el
                    else:
                        h['at'] = float(h['when'])
                if h['at'] is not None and h['until'] is None and el >= h['at']:
                    window_state(pg, 'minimized')
                    h['until'] = el + h['dur']
                elif h['until'] is not None and el >= h['until']:
                    window_state(pg, 'normal')
                    h['done'] = True
            for c in closes:
                if not c['done'] and c['page'] < len(pages) and el >= c['t']:
                    c['done'] = True
                    pg = pages[c['page']]
                    try:
                        browser.call('Target.closeTarget', {'targetId': pg.target})
                        pg.closed = True
                        ok_wait[pg.index] = True
                        print(f'[run_mp] p{pg.index} closed at {el:.1f} s')
                    except Exception as err:  # noqa: BLE001
                        pg.log.out('error', f'[run_mp] could not close p{pg.index}: {err}')

        def pump():
            for p in pages:
                if not getattr(p, 'closed', False):
                    p.drain()
            schedule()
            el = time.time() - t0
            while shots and el >= shots[0]:
                s = shots.pop(0)
                for p in pages:
                    if not getattr(p, 'closed', False):
                        p.screenshot(f'{args.out}_p{p.index}_{s:g}s.png')

        for i, url in enumerate(urls):
            target = first if i == 0 else browser.call('Target.createTarget', {
                'url': 'about:blank', 'newWindow': True, 'width': width, 'height': height})['targetId']
            page = Page(i, url, CDP(f'ws://127.0.0.1:{dbg}/devtools/page/{target}'), PageLog(i, args.quiet, args.max_log))
            page.target = target
            page.setup(width, height)
            print(f'[run_mp] p{i} {url}')
            page.cdp.call('Page.navigate', {'url': url})
            pages.append(page)
            if i == 0 and args.host_wait and n > 1:
                while time.time() < deadline and not page.check(args.host_wait):
                    pump()
                    time.sleep(0.1)
            elif args.stagger:
                t_end = time.time() + args.stagger
                while time.time() < t_end:
                    pump()
                    time.sleep(0.05)

        last_poll = 0
        while time.time() < deadline and not all(ok_wait):
            pump()
            if time.time() - last_poll > 0.25:
                last_poll = time.time()
                for p in pages:
                    if getattr(p, 'closed', False):
                        continue
                    if not ok_wait[p.index] and p.check(wait):
                        ok_wait[p.index] = True
                        p.done_at = round(time.time() - t0, 2)
            time.sleep(0.05)
        for p in pages:
            if not ok_wait[p.index]:
                p.log.out('error', f'[run_mp] timed out after {args.timeout:g}s waiting for: {wait}')
        t_end = time.time() + args.after
        while time.time() < t_end:
            pump()
            time.sleep(0.05)
        pump()
        for h in hides:                                  # never leave a window minimized
            if h['until'] is not None and not h['done'] and h['page'] < len(pages):
                window_state(pages[h['page']], 'normal')
        live = [p for p in pages if not getattr(p, 'closed', False)]
        for s in shots:                                  # shots scheduled past the end
            for p in live:
                p.screenshot(f'{args.out}_p{p.index}_{s:g}s.png')
        if args.shot:
            root, ext = os.path.splitext(args.shot)
            for p in live:
                p.screenshot(f'{root}_p{p.index}{ext or ".png"}')
        for p in pages:
            if getattr(p, 'closed', False):
                results.append({'page': p.index, 'url': p.url, 'waitOk': True, 'doneAt': None, 'closed': True,
                                'consoleErrors': list(p.log.errors), 'warnings': p.log.warnings, 'result': None})
                continue
            val = None
            if eval_expr:
                val = p.value(eval_expr)
                if args.report:
                    val = summarize_report(val)
                print(f'[result p{p.index}] ' + json.dumps(val, indent=1)[:60000])
            p.drain()
            results.append({'page': p.index, 'url': p.url, 'waitOk': ok_wait[p.index], 'doneAt': p.done_at,
                            'consoleErrors': list(p.log.errors), 'warnings': p.log.warnings, 'result': val})
        if args.nettest and results and isinstance(results[0]['result'], dict):
            _print_nettest(results)
        elif args.report:
            _print_reports(results)
        errors = [len(p.log.errors) for p in pages]
        code = 0 if all(ok_wait) and not any(errors) else 1
        print(f'[run_mp] done: pages={n} wait={",".join("ok" if w else "TIMEOUT" for w in ok_wait)} '
              f'console_errors={",".join(map(str, errors))} warnings={",".join(str(p.log.warnings) for p in pages)}')
    finally:
        if proc is not None:
            try:
                proc.kill()
                proc.wait(timeout=10)
            except Exception:  # noqa: BLE001
                pass
        if profile:
            shutil.rmtree(profile, ignore_errors=True)
        server.shutdown()
        server.server_close()
        if node_relay is not None:
            try:
                node_relay.stdin.close()   # EOF stops the relay
                node_relay.wait(timeout=5)
            except Exception:  # noqa: BLE001
                node_relay.kill()
    if args.json_out:
        os.makedirs(os.path.dirname(os.path.abspath(args.json_out)), exist_ok=True)
        with open(args.json_out, 'w', encoding='utf-8') as f:
            json.dump({'ok': code == 0, 'room': room, 'pages': results}, f, indent=1)
    sys.exit(code)


def start_node_relay(serve_port, origins, relay_options):
    """Start desktop/relay.js on a free loopback port for the pages at http://<origin>:<serve_port>; returns (proc, port)."""
    cmd = ['node', os.path.join(ROOT, 'desktop', 'relay.js'), '--loopback', '--port', '0', '--quiet',
           '--max-conns-per-ip', '0', '--join-rate', '0', '--control-rate', '0']
    for o in sorted(set(origins)):
        cmd += ['--allow-origin', f'http://{o}:{serve_port}']
    for k, v in relay_options.items():
        cmd += ['--' + k.replace('_', '-'), str(v)]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                            cwd=ROOT)
    deadline = time.time() + 15
    while time.time() < deadline:
        line = proc.stdout.readline()
        if not line:
            break
        if 'ready on' in line and 'port' in line:
            port = int(line.rsplit('port', 1)[1].split()[0])
            return proc, port
    proc.kill()
    raise SystemExit('[run_mp] the Node relay did not start')


def _is_ip(host):
    try:
        ipaddress.ip_address(host)
        return True
    except ValueError:
        return False


def _print_reports(results):
    """One merged line per page for --report (autotest reports)."""
    print('[run_mp] merged autotest reports:')
    for r in results:
        rep = r['result']
        if not isinstance(rep, dict):
            print(f"  p{r['page']}: no report ({rep!r})")
            continue
        fps = rep.get('fps') or {}
        pl = rep.get('player') or {}
        print(f"  p{r['page']}: ok={rep.get('ok')} map={rep.get('map')} t={rep.get('t')} s fps avg={fps.get('avg')} "
              f"min={fps.get('min')} page_errors={rep.get('errorCount', len(rep.get('errors') or []))} "
              f"console_errors={len(r['consoleErrors'])} player k/d={pl.get('kills')}/{pl.get('deaths')} "
              f"bots={len(rep.get('bots') or [])} done_at={r['doneAt']} s")
    oks = [isinstance(r['result'], dict) and r['result'].get('ok') is True for r in results]
    print(f"[run_mp] reports ok: {sum(oks)}/{len(oks)}")


def _print_nettest(results):
    host = results[0]['result']
    rtt, one = host.get('rtt') or {}, host.get('oneWay') or {}
    print(f"[nettest] game RTT (client -> relay -> host page -> relay -> client): n={rtt.get('n')} "
          f"p50={rtt.get('p50')} ms p95={rtt.get('p95')} ms p99={rtt.get('p99')} ms max={rtt.get('max')} ms")
    print(f"[nettest] snapshot one-way host -> client: p50={one.get('p50')} ms p95={one.get('p95')} ms "
          f"({(host.get('snapshots') or {}).get('sent')} x {(host.get('snapshots') or {}).get('bytes')} B at "
          f"{(host.get('snapshots') or {}).get('hz')} Hz)")
    for c in host.get('clients') or []:
        print(f"[nettest]   peer {c['peer']} ({c['name']}, secure={c['secure']}): rtt p50={c['rtt'].get('p50')} "
              f"p95={c['rtt'].get('p95')} ms, snapshots {c['snaps']} (missed {c['missed']}), inputs {c['inputs']}, "
              f"unicasts {c['uni']}{', rejoined' if c.get('rejoined') else ''}")
    for r in results:
        if isinstance(r['result'], dict) and r['result'].get('role') == 'edge':
            print(f"[nettest] edge cases (p{r['page']}): {json.dumps(r['result'].get('edge'))}")
    fails = [f for r in results if isinstance(r['result'], dict) for f in r['result'].get('failures', [])]
    print(f'[nettest] checks: {"all passed" if not fails else f"{len(fails)} FAILED"}')


if __name__ == '__main__':
    main()
