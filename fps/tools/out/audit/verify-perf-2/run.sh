#!/bin/bash
# usage: run.sh outfile [run.py args...] ; retries on infrastructure flakes
out=$1; shift
for i in 1 2 3 4; do
  python tools/run.py "$@" > "$out" 2>&1
  if ! grep -q "ERR_CONNECTION_REFUSED\|could not connect to headless Chrome\|Traceback\|Failed to fetch dynamically" "$out"; then break; fi
  echo "retry $i" >&2
done
