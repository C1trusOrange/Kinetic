#!/bin/bash
cd /c/Users/caleb/Desktop/AiProject/fps
JOB=$1; URL=${2:-index.html}
python tools/run.py "$URL" --wait "$(tr '\n' ' ' < tools/out/audit/verify-world-1/$JOB)" --eval "JSON.stringify(window.__JOB__)" --timeout 150 --quiet 2>&1
