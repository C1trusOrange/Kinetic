#!/bin/bash
# usage: r.sh name "query" [extra args]  (retries once on server connection failures)
cd /c/Users/caleb/Desktop/AiProject/fps
name=$1; q=$2; shift 2
for attempt in 1 2 3; do
  python tools/run.py "index.html?autotest=1&scenario=tools/out/audit/feel-bots/telemetry.js&$q" --report --timeout 300 --quiet "$@" > tools/out/audit/feel-bots/r_$name.txt 2>&1
  if grep -q "ERR_CONNECTION_REFUSED" tools/out/audit/feel-bots/r_$name.txt; then sleep 3; continue; fi
  break
done
echo "exit attempt=$attempt" >> tools/out/audit/feel-bots/r_$name.txt
