#!/bin/bash
# usage: runr.sh <outfile> <url> ; retries up to 4 times on connection-refused
out=$1; url=$2
for a in 1 2 3 4; do
  python tools/run.py "$url" --report --quiet > "$out" 2>&1
  if ! grep -q "ERR_CONNECTION_REFUSED\|result\] null" "$out"; then echo "ok attempt $a"; exit 0; fi
  sleep 3
done
echo "failed"; exit 1
