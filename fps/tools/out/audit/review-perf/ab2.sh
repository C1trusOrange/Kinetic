#!/bin/bash
cd /c/Users/caleb/Desktop/AiProject/fps
for w in 2 1 2; do
  n=$(date +%s%N | tail -c 6)
  tools/out/audit/review-perf/run.sh tools/out/audit/review-perf/warmB_${w}_$n.txt "index.html?autotest=1&map=foundry&bots=5&duration=20&warm=$w&scenario=tools/out/audit/review-perf/scenario_warm.js" --report --timeout 200 --quiet
done
echo done > tools/out/audit/review-perf/warmB_DONE
