#!/bin/bash
cd /c/Users/caleb/Desktop/AiProject/fps
for s in 1 2 3; do
  python tools/run.py "index.html?autotest=1&map=sandbox&bots=6&diff=insane&script=idle&seed=$s&scenario=tools/out/audit/review-weapons/fuzz.js&duration=60" --report --timeout 300 > tools/out/audit/review-weapons/fuzz_s$s.txt 2>&1
done
