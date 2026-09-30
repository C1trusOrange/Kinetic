#!/bin/bash
# usage: retry.sh <outfile> <run.py args...>
out=$1; shift
for i in 1 2 3 4; do
  python tools/run.py "$@" > "$out" 2>&1
  if grep -q "ERR_CONNECTION_REFUSED" "$out"; then sleep 15; else break; fi
done
