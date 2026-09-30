#!/bin/bash
cd /c/Users/caleb/Desktop/AiProject/fps
for w in 0 2 1 0 2 1; do
  n=$(date +%s%N | tail -c 6)
  tools/out/audit/review-perf/run.sh tools/out/audit/review-perf/warm_${w}_$n.txt "index.html?autotest=1&map=foundry&bots=5&duration=20&warm=$w&scenario=tools/out/audit/review-perf/scenario_warm.js" --report --timeout 150 --quiet
done
echo done > tools/out/audit/review-perf/warm_DONE
