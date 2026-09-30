#!/bin/bash
# usage: run.sh <probe.js> [extra url params (no leading &)] [extra run.py args]
cd /c/Users/caleb/Desktop/AiProject/fps
P=$1; shift
Q="$1"; shift
for attempt in 1 2 3; do
  OUT=$(python tools/run.py "index.html?autotest=1&$Q&map=sandbox&bots=0&duration=999&scenario=tools/out/audit/verify-core-1/probe.js&probefile=tools/out/audit/verify-core-1/$P" --report --quiet "$@" 2>&1)
  if echo "$OUT" | grep -q "ERR_CONNECTION_REFUSED\|could not connect to headless"; then sleep 3; continue; fi
  break
done
echo "$OUT" | python -c "
import sys
s=sys.stdin.read()
i=s.find('\"custom\"')
j=s.find('[run] done')
print(s[i:j] if i>=0 else s[-3000:])
print(s[j:])
"
