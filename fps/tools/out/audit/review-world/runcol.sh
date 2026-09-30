#!/bin/bash
# usage: runcol.sh map "[[name,x,z],...]"
cd /c/Users/caleb/Desktop/AiProject/fps
MAP=$1; PTS=$2
EXPR="(window.__PTS__=$PTS, $(tr -d '\n' < tools/out/audit/review-world/col.js))"
python tools/run.py "index.html?autotest=1&map=$MAP&bots=0&duration=2&script=idle" --wait "window.__GAME__ && window.__GAME__.world.def && window.__GAME__.state==='playing'" --eval "$EXPR" 2>&1 | grep -E "result|error" 
