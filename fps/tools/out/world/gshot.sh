#!/bin/bash
cd /c/Users/caleb/Desktop/AiProject/fps
name=$1; cam=$2
python tools/run.py "tools/viewer.html?kind=map&id=../../../tools/out/world/gallery&cam=$cam&markers=0" --wait "window.__VIEWER_READY__" --shot tools/out/world/$name.png --quiet > tools/out/world/$name.log 2>&1
