#!/bin/bash
cd /c/Users/caleb/Desktop/AiProject/fps
rm -f tools/out/audit/review-perf/frames/css3_DONE
for c in m n o p q m n o p q; do
  n=$(date +%s%N | tail -c 6)
  python tools/run.py "index.html?autotest=1&map=foundry&bots=5&duration=3&warm=1&css=$c&scenario=tools/out/audit/review-perf/frames/scenario.js" --report --quiet > tools/out/audit/review-perf/frames/css3_${c}_$n.txt 2>&1
done
echo done > tools/out/audit/review-perf/frames/css3_DONE
