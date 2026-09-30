#!/bin/bash
cd /c/Users/caleb/Desktop/AiProject/fps
for i in 1 2; do
  for h in 0 1; do
    bash tools/out/audit/verify-perf-2/run.sh tools/out/audit/verify-perf-2/hb_${h}_$i.txt "tools/out/audit/verify-perf-2/flowfix.html?fix=async&playMs=6000&hidehud=$h" --wait "window.__DONE__" --timeout 150 --eval "JSON.stringify(window.__RES__)"
  done
done
echo ALLDONE > tools/out/audit/verify-perf-2/hb_done.txt
