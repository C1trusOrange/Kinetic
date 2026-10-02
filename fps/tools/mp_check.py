#!/usr/bin/env python3
"""Acceptance checks for multiplayer test runs (stdlib only).

    python tools/run_mp.py ... --report --json tools/out/mp/move/report.json
    python tools/mp_check.py tools/out/mp/move/report.json --expect move

Loads the run's per-page results (run_mp.py --json), applies the common checks (every page finished, no console
errors) and the suite's own checks from tools/mp/checks/<suite>.py (`check(pages, ctx) -> list of failure strings`).
Exit code: 0 ok, 1 failed, 2 inconclusive (a page rendered below 20 fps on average: rerun on a less busy machine).
"""
import argparse
import importlib.util
import json
import os
import sys

TOOLS = os.path.dirname(os.path.abspath(__file__))
MIN_FPS = 20


def say(text):
    """print() that survives a console that cannot show every character (Windows: cp1252)."""
    enc = sys.stdout.encoding or 'utf-8'
    print(str(text).encode(enc, 'replace').decode(enc))


class Ctx:
    """Helpers handed to suite checks."""

    def __init__(self, data, args):
        self.data = data
        self.args = args
        self.lines = []

    def log(self, text):
        self.lines.append(text)
        say('  ' + text)

    @staticmethod
    def report(page):
        return page.get('result') or {}

    @staticmethod
    def net(page):
        return (page.get('result') or {}).get('net') or {}

    def role(self, page):
        return self.net(page).get('role')

    def pages_with_role(self, pages, role):
        return [p for p in pages if self.role(p) == role]

    @staticmethod
    def percentile(values, q):
        if not values:
            return 0.0
        s = sorted(values)
        return s[min(len(s) - 1, max(0, int(len(s) * q)))]


def load_suite(name):
    path = os.path.join(TOOLS, 'mp', 'checks', f'{name}.py')
    if not os.path.isfile(path):
        raise SystemExit(f'[mp_check] no checks for suite {name!r} ({path})')
    spec = importlib.util.spec_from_file_location(f'mp_checks_{name}', path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('report', help='run_mp.py --json output')
    ap.add_argument('--expect', required=True, help='suite name (tools/mp/checks/<suite>.py)')
    ap.add_argument('--allow-errors', action='store_true', help='do not fail on console errors')
    args = ap.parse_args(argv)
    with open(args.report, encoding='utf-8') as f:
        data = json.load(f)
    pages = data.get('pages') or []
    ctx = Ctx(data, args)
    fails = []
    print(f'[mp_check] {args.expect}: {len(pages)} page(s), room {data.get("room")}')
    low = []
    for p in pages:
        rep = ctx.report(p)
        if not p.get('waitOk'):
            fails.append(f'p{p["page"]}: did not finish (timeout)')
        if p.get('consoleErrors') and not args.allow_errors:
            fails.append(f'p{p["page"]}: {len(p["consoleErrors"])} console error(s), first: {p["consoleErrors"][0][:300]}')
        fps = (rep.get('fps') or {}).get('avg') or 0
        if rep.get('done') and fps and fps < MIN_FPS:
            low.append(f'p{p["page"]} {fps} fps')
    suite = load_suite(args.expect)
    try:
        fails += list(suite.check(pages, ctx) or [])
    except Exception as err:  # noqa: BLE001 - a broken check is a failure, with the reason
        fails.append(f'check raised {type(err).__name__}: {err}')
    if low and fails:
        print(f'[mp_check] INCONCLUSIVE: insufficient fps ({", ".join(low)}); failures: {len(fails)}')
        for f_ in fails:
            say('  - ' + f_)
        return 2
    if fails:
        print(f'[mp_check] FAIL ({len(fails)}):')
        for f_ in fails:
            say('  - ' + f_)
        return 1
    print('[mp_check] OK')
    return 0


if __name__ == '__main__':
    sys.exit(main())
