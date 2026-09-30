#!/usr/bin/env python3
"""Run a scenario through tools/run.py and print report.custom compactly (one key per line). Retries on harness failures."""
import json, subprocess, sys, os, time

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', '..'))


def run_once(url, extra):
    cmd = [sys.executable, os.path.join(ROOT, 'tools', 'run.py'), url, '--report', '--quiet'] + extra
    p = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace')
    out = p.stdout
    i = out.rfind('[result] {')
    if i < 0:
        return None, out, p.stderr
    body = out[i + len('[result]'):]
    start = body.find('{')
    depth = 0
    end = start
    for k in range(start, len(body)):
        ch = body[k]
        if ch == '{': depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                end = k + 1
                break
    return json.loads(body[start:end]), out, body[end:]


def main():
    url = sys.argv[1]
    extra = sys.argv[2:]
    rep = None
    for attempt in range(3):
        rep, out, tail = run_once(url, extra)
        if rep is not None:
            break
        print('attempt', attempt, 'failed:', out[-300:].replace('\n', ' | '))
        time.sleep(4)
    if rep is None:
        sys.exit(1)
    errs = rep.get('errors') or []
    print('fps', rep.get('fps'), 'errors', len(errs), [e[:200] for e in errs[:2]], 't', rep.get('t'))
    for k, v in (rep.get('custom') or {}).items():
        print(k, json.dumps(v, separators=(',', ':')))
    for line in tail.splitlines():
        if line.strip():
            print(line.strip()[:400])


main()
