#!/bin/bash
cd /c/Users/caleb/Desktop/AiProject/fps
for m in foundry ruins skyline sandbox; do
  tools/out/audit/review-perf/run.sh tools/out/audit/review-perf/calls_$m.txt "index.html?autotest=1&map=$m&bots=8&duration=34&scenario=tools/out/audit/review-perf/scenario_calls.js" --report --timeout 250 --quiet
done
echo done > tools/out/audit/review-perf/calls_DONE
