import json, sys, urllib.parse
sys.path.insert(0, 'tools/out/bot-model')
from shot import run
# usage: seq.py out pose t1,t2,... [extra query] [state json] [yaw]
out, pose, ts = sys.argv[1], sys.argv[2], [float(x) for x in sys.argv[3].split(',')]
extra = sys.argv[4] if len(sys.argv) > 4 else ''
state = json.loads(sys.argv[5]) if len(sys.argv) > 5 else {}
yaw = float(sys.argv[6]) if len(sys.argv) > 6 else 2.6
bots = [{'pose': pose, 't': t, 'yaw': yaw, 'state': state} for t in ts]
n = len(ts)
q = 'bots=' + urllib.parse.quote(json.dumps(bots)) + '&focus=full&spacing=1.4&dist=%s&fov=30' % (max(4.0, n * 1.4 * 0.9 + 1)) + ('&' + extra if extra else '')
run(q, out)
