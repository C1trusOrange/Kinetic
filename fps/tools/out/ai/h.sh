#!/bin/bash
# usage: h.sh "query" [jsExpr]
cd /c/Users/caleb/Desktop/AiProject/fps
EXPR=${2:-"(()=>{const h=window.__H__;return [h.perf,h.deaths,h.effects,h.explosions,h.rockets,h.grenades,h.pickups,h.spots,h.table,h.killLog,h.errors,h.crash]})()"}
python tools/run.py "tools/out/ai/harness.html?$1&mockweapons=1${MOCKBOT}" --wait "window.__H__ && window.__H__.done" --eval "$EXPR" --timeout 250 2>&1 | grep -v "^\[run\] http"
