#!/bin/bash
# usage: r.sh <outfile> "<url>" [extra args...]  -- retries when module fetch fails; writes output to outfile
cd /c/Users/caleb/Desktop/AiProject/fps
OUTF="$1"; shift
URL="$1"; shift
for i in 1 2 3 4; do
  OUT=$(timeout 500 python tools/run.py "$URL" --wait "(window.__TEST__ && window.__TEST__.done) || document.querySelector('.fatal-error') || (window.__ERRORS__ && window.__ERRORS__.length>0)" --timeout 400 "$@" 2>&1)
  if echo "$OUT" | grep -q "ERR_CONNECTION_REFUSED\|Failed to fetch dynamically"; then echo "[retry $i]"; sleep 2; continue; fi
  echo "$OUT" > "$OUTF"; echo "saved $OUTF ($(wc -l < $OUTF) lines)"; exit 0
done
echo "$OUT" > "$OUTF"; echo "FAILED, saved $OUTF"
