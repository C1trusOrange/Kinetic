#!/bin/bash
# usage: shots.sh name "x,y,z,yaw,pitch" [name "cam"]...   (extra query via $Q, e.g. Q="&nav=1")
cd /c/Users/caleb/Desktop/AiProject/fps
while [ $# -gt 1 ]; do
  n="$1"; c="$2"; shift 2
  python tools/run.py "tools/viewer.html?kind=map&id=ruins&markers=0$Q&cam=$c" --wait "window.__VIEWER_READY__" --shot tools/out/ruins/$n.png > tools/out/ruins/$n.log 2>&1 &
done
wait
