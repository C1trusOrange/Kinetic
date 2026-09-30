#!/bin/bash
# usage: runr.sh <outfile> <url> [extra run.py args]   (retries up to 5x on timeout / chrome launch failure)
out="$1"; url="$2"; shift 2
for i in 1 2 3 4 5; do
  python tools/run.py "$url" --report "$@" > "$out" 2>&1
  if ! grep -q -E "wait=TIMEOUT|could not connect to headless" "$out"; then break; fi
  echo "retry $i" >&2
  sleep 3
done
