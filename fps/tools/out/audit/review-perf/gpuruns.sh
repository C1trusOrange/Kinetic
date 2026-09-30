#!/bin/bash
cd /c/Users/caleb/Desktop/AiProject/fps
run() { # name url extra...
  n=$1; u=$2; shift 2
  tools/out/audit/review-perf/run.sh tools/out/audit/review-perf/gpu_$n.txt "$u" --report --timeout 200 --quiet "$@"
}
run foundry_b0 "index.html?autotest=1&map=foundry&bots=0&duration=25&scenario=tools/out/audit/review-perf/scenario_gpu.js" --size 1920x1080
run foundry_b8_med "index.html?autotest=1&map=foundry&bots=8&duration=25&quality=medium&scenario=tools/out/audit/review-perf/scenario_gpu.js" --size 1920x1080
run skyline_b8 "index.html?autotest=1&map=skyline&bots=8&duration=25&scenario=tools/out/audit/review-perf/scenario_gpu.js" --size 1920x1080
run sandbox_b8 "index.html?autotest=1&map=sandbox&bots=8&duration=25&scenario=tools/out/audit/review-perf/scenario_gpu.js" --size 1920x1080
run foundry_b8_b "index.html?autotest=1&map=foundry&bots=8&duration=25&scenario=tools/out/audit/review-perf/scenario_gpu.js" --size 1920x1080
echo done > tools/out/audit/review-perf/gpu_DONE
