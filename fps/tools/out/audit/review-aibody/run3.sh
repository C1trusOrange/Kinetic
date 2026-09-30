#!/bin/bash
cd /c/Users/caleb/Desktop/AiProject/fps
for m in foundry ruins skyline; do
  timeout 300 python tools/run.py "index.html?autotest=1&map=$m&bots=12&diff=hard&duration=70&god=1&script=idle&scenario=tools/out/audit/review-aibody/deaths.js" --report --timeout 280 --max-log 60 > tools/out/audit/review-aibody/deaths_$m.txt 2>&1
done
