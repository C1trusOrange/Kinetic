#!/bin/bash
# usage: r.sh <outfile> "<url>" [extra args...]
cd /c/Users/caleb/Desktop/AiProject/fps
OUTF="$1"; shift
URL="$1"; shift
for i in 1 2 3 4 5; do
  OUT=$(timeout 900 python tools/out/audit/verify-aibrain-1/run2.py "$URL" --wait "(window.__TEST__ && window.__TEST__.done) || document.querySelector('.fatal-error') || (window.__ERRORS__ && window.__ERRORS__.length>0)" --report --timeout 800 "$@" 2>&1)
  if echo "$OUT" | grep -q "ERR_CONNECTION_REFUSED\|Failed to fetch dynamically\|could not connect to headless"; then echo "[retry $i]" >&2; sleep 3; continue; fi
  echo "$OUT" > "$OUTF"; echo "saved $OUTF"; exit 0
done
echo "$OUT" > "$OUTF"; echo "FAILED, saved $OUTF"
