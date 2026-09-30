#!/bin/bash
# usage: shots.sh name "cam" [extra query]
cd /c/Users/caleb/Desktop/AiProject/fps
name=$1; cam=$2; extra=$3; id=${ID:-sandbox}
python tools/run.py "tools/viewer.html?kind=map&id=$id&cam=$cam&markers=0$extra" --wait "window.__VIEWER_READY__" --shot tools/out/world/$name.png --quiet > tools/out/world/$name.log 2>&1
