#!/bin/bash
cd /c/Users/caleb/Desktop/AiProject/fps
i=0
for cfg in "foundry 21 1 0" "skyline 22 1 0" "ruins 23 1 0" "sandbox 24 1 1"; do
  set -- $cfg
  m=$1; seed=$2; kill=$3; chaos=$4
  tools/out/audit/review-player/runr.sh tools/out/audit/review-player/v_fz_${m}_$seed.txt "index.html?autotest=1&map=$m&bots=0&script=idle&secs=100&seed=$seed&kill=$kill&chaos=$chaos&scenario=tools/out/audit/review-player/fastsim2.js" --timeout 300
done
echo done > tools/out/audit/review-player/fuzzall.done
