#!/bin/bash
# usage: shot.sh name "extra query" ; e.g. shot.sh top "cam=0,75,0,0,-1.5708"
cd /c/Users/caleb/Desktop/AiProject/fps
python tools/run.py "tools/viewer.html?kind=map&id=foundry&$2" --wait "window.__VIEWER_READY__" --shot tools/out/foundry/$1.png --eval "JSON.stringify({w:window.__VIEWER_INFO__.warnings,nav:window.__VIEWER_INFO__.nav&&{n:window.__VIEWER_INFO__.nav.nodes,tr:window.__VIEWER_INFO__.nav.traps,lc:window.__VIEWER_INFO__.nav.largestComponent},tris:window.__VIEWER_INFO__.renderTriangles,calls:window.__VIEWER_INFO__.renderCalls,fps:window.__VIEWER_INFO__.fps})" 2>&1 | grep -v "^\[run\]"
