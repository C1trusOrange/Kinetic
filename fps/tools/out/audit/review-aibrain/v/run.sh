#!/bin/bash
# usage: run.sh <outfile> "<url>" [args]
cd /c/Users/caleb/Desktop/AiProject/fps
OUTF="$1"; shift; URL="$1"; shift
for i in 1 2 3 4; do
  OUT=$(timeout 900 python tools/out/audit/review-aibrain/v/run2.py "$URL" --report --timeout 700 "$@" 2>&1)
  if echo "$OUT" | grep -q "ERR_CONNECTION_REFUSED\|Failed to fetch dynamically\|could not connect to headless"; then sleep 3; continue; fi
  echo "$OUT" > "$OUTF"; exit 0
done
echo "$OUT" > "$OUTF"
