#!/bin/bash
# usage: shot.sh <outname> <query-without-leading-?> [extra run.py args]
cd /c/Users/caleb/Desktop/AiProject/fps
out=$1; q=$2; shift 2
python tools/run.py "tools/out/weapons/harness.html?scenario=tools/out/weapons/pose.js&models=real&$q" --wait "window.__POSE_READY__" --shot tools/out/weapons/$out.png --quiet --timeout 40 "$@" 2>&1 | grep -v "^\[run\] http" | head -${LINES_MAX:-6}
