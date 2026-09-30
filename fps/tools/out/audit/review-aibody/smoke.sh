#!/bin/bash
# usage: smoke.sh name "query"
cd /c/Users/caleb/Desktop/AiProject/fps
name=$1; q=$2
timeout 280 python tools/run.py "$q" --report --max-log 400 > tools/out/audit/review-aibody/smoke_$name.txt 2>&1
echo "exit=$?" >> tools/out/audit/review-aibody/smoke_$name.txt
