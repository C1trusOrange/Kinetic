import json, subprocess, sys, urllib.parse
ROOT = 'C:/Users/caleb/Desktop/AiProject/fps'
def run(query, out, size='1280x720', evalx=None):
    cmd = ['python', 'tools/run.py', 'tools/out/bot-model/dev.html?' + query, '--wait', 'window.__VIEWER_READY__', '--shot', out, '--size', size]
    if evalx: cmd += ['--eval', evalx]
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
    print('\n'.join(l for l in r.stdout.splitlines() if not l.startswith('[run] http')))
    if r.returncode: print(r.stderr[-1500:])

if __name__ == '__main__':
    mode = sys.argv[1]
    if mode == 'cycle':
        pose, n, out = sys.argv[2], int(sys.argv[3]), sys.argv[4]
        extra = sys.argv[5] if len(sys.argv) > 5 else ''
        speed = float(sys.argv[6]) if len(sys.argv) > 6 else 3.5
        cad = (0.9 + 0.16 * min(speed, 9))
        per = 1 / cad
        state = json.loads(sys.argv[7]) if len(sys.argv) > 7 else {}
        bots = [{'pose': pose, 't': round(0.02 + per * i / n, 4), 'yaw': 0, 'state': state} for i in range(n)]
        q = 'bots=' + urllib.parse.quote(json.dumps(bots)) + '&focus=full&az=90&el=2&layout=z&spacing=1.25&dist=%s&fov=30' % (n * 1.25 * 0.95 + 1) + ('&' + extra if extra else '')
        run(q, out)
    else:
        run(sys.argv[2], sys.argv[3], evalx=sys.argv[4] if len(sys.argv) > 4 else None)
