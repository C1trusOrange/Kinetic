#!/usr/bin/env python3
"""usage: seq.py <kind> [times] [cam] -> tools/out/fx-audio/seq_<kind>.png (montage of scenario-driven frames)"""
import os, subprocess, sys, shutil
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
kind = sys.argv[1] if len(sys.argv) > 1 else 'ground'
times = sys.argv[2] if len(sys.argv) > 2 else '0.06,0.16,0.35,0.7,1.3,2.6'
cam = sys.argv[3] if len(sys.argv) > 3 else '0,1.8,27,0,0.0'
extra = sys.argv[4] if len(sys.argv) > 4 else ''
out = os.path.join(ROOT, 'tools', 'out', 'fx-audio', 'seq_' + kind)
shutil.rmtree(out, ignore_errors=True)
os.makedirs(out)
py = sys.executable
url = f'tools/out/fx-audio/fxlab.html?duration=30&cam={cam}&scenario=tools/out/fx-audio/fx_seq.js&kind={kind}&times={times}{extra}'
r = subprocess.run([py, os.path.join(ROOT, 'tools/out/fx-audio/shoot.py'), url, out, '1280x720', '90'], capture_output=True, text=True, cwd=ROOT)
print('\n'.join(l for l in r.stdout.splitlines() if l.startswith(('[shoot] done', '[shoot] TIMEOUT', '[error]', '[report]'))))
n = len(times.split(','))
names = ','.join('e%d' % i for i in range(n))
cols = 3
w = 1920
r = subprocess.run([py, os.path.join(ROOT, 'tools/run.py'), f'tools/out/fx-audio/montage.html?dir=tools/out/fx-audio/seq_{kind}&names={names}&cols={cols}&scale=0.5',
                    '--wait', 'window.__READY__', '--shot', f'tools/out/fx-audio/seq_{kind}.png', '--size', f'{w}x{360 * ((n + cols - 1) // cols)}', '--quiet'],
                   capture_output=True, text=True, cwd=ROOT)
print([l for l in r.stdout.splitlines() if 'error' in l.lower()])
