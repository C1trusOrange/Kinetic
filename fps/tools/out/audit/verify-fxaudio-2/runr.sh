#!/bin/bash
out="$1"; shift
cd /c/Users/caleb/Desktop/AiProject/fps
rm -f "$out.retries"
for i in 1 2 3 4 5; do
  python tools/run.py "$@" > "$out" 2>&1
  if grep -q "ERR_CONNECTION_REFUSED\|Failed to fetch dynamically" "$out"; then echo "retry $i" >> "$out.retries"; sleep 3; continue; fi
  break
done
echo finished >> "$out.retries"
