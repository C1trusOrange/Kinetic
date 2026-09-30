#!/bin/bash
cd /c/Users/caleb/Desktop/AiProject/fps
for c in h i j k l h i j k l; do
  n=$(date +%s%N | tail -c 6)
  python tools/run.py "index.html?autotest=1&map=foundry&bots=5&duration=4&warm=1&css=$c&scenario=tools/out/audit/review-perf/frames/scenario.js" --report --quiet > tools/out/audit/review-perf/frames/css2_${c}_$n.txt 2>&1
done
echo done > tools/out/audit/review-perf/frames/css2_DONE
