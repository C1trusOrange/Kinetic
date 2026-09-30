#!/bin/bash
# usage: d.sh shotmode map [seed-ignored]
cd /c/Users/caleb/Desktop/AiProject/fps
mode=$1; map=$2
for attempt in 1 2 3 4; do
  python tools/run.py "index.html?autotest=1&scenario=tools/out/audit/feel-bots/director.js&map=$map&bots=8&mode=ffa&diff=normal&spectate=1&duration=240&shot=$mode&cam=0,30,0,0,-1.2" --wait "window.__FREEZE" --after 1.5 --timeout 260 --quiet --shot tools/out/audit/feel-bots/dir_${mode}_${map}.png > tools/out/audit/feel-bots/d_${mode}_${map}.txt 2>&1
  if grep -q "ERR_CONNECTION_REFUSED" tools/out/audit/feel-bots/d_${mode}_${map}.txt; then sleep 4; continue; fi
  break
done
echo "exit attempt=$attempt" >> tools/out/audit/feel-bots/d_${mode}_${map}.txt
