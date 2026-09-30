#!/bin/bash
# usage: rr.sh <outfile> "<url>" [args]
cd /c/Users/caleb/Desktop/AiProject/fps
OUTF="$1"; shift; URL="$1"; shift
for i in 1 2 3 4 5; do
  OUT=$(timeout 900 python tools/run.py "$URL" --report "$@" 2>&1)
  if echo "$OUT" | grep -q "ERR_CONNECTION_REFUSED\|Failed to fetch dynamically\|could not connect to headless"; then sleep 5; continue; fi
  echo "$OUT" > "$OUTF"; exit 0
done
echo "$OUT" > "$OUTF"
