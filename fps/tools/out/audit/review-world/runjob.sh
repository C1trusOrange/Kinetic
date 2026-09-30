#!/bin/bash
# usage: runjob.sh job.js [url]   (job runs in menu state on index.html)
cd /c/Users/caleb/Desktop/AiProject/fps
JOB=$1; URL=${2:-index.html}
python tools/run.py "$URL" --wait "$(tr '\n' ' ' < tools/out/audit/review-world/$JOB)" --eval "JSON.stringify(window.__JOB__)" --timeout 150 --quiet 2>&1
