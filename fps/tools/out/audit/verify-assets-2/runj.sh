#!/bin/bash
# usage: runj.sh <url> <outfile>
cd /c/Users/caleb/Desktop/AiProject/fps
for i in 1 2 3; do
  python tools/run.py "$1" --report > "$2" 2>&1
  if grep -q '^\[result\]' "$2" && ! grep -q 'ERR_CONNECTION_REFUSED' "$2"; then exit 0; fi
  sleep 3
done
exit 1
