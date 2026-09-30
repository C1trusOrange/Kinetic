#!/bin/bash
# Batch of in-game firing screenshots (scratch). Usage: bash batch1.sh
cd /c/Users/caleb/Desktop/AiProject/fps
OUT=tools/out/audit/feel-gunfeel
BASE="index.html?autotest=1&map=gunfeel&mapfile=$OUT/testmap.js&bots=1&god=1&scenario=$OUT/fire.js&duration=90"
run() {
  name=$1; shift
  for attempt in 1 2; do
    python $OUT/run2.py "$BASE&$*" --wait "window.__FROZEN__" --timeout 150 --shot $OUT/$name.png --eval "window.__TEST__.custom" > $OUT/$name.txt 2>&1
    if grep -q "wait=ok" $OUT/$name.txt; then break; fi
  done
  echo "$name: $(grep -E 'done:' $OUT/$name.txt)"
}
run g_rifle_hip_bot     "w=rifle&t=bot&d=14&n=3"
run g_rifle_ads_bot     "w=rifle&t=bot&d=20&n=3&ads=1"
run g_pistol_hip_bot    "w=pistol&t=bot&d=12&n=1"
run g_shotgun_hip_bot   "w=shotgun&t=bot&d=6&n=1"
run g_sniper_scope_bot  "w=sniper&t=bot&d=40&n=1&ads=1"
run g_rifle_hip_metal   "w=rifle&t=metal&pz=-6&n=5"
run g_shotgun_wall      "w=shotgun&t=stone&pz=-10&n=1"
run g_rocket_wall       "w=rocket&t=wall&pz=0&n=1&after=0.12"
run g_rifle_night_bot   "w=rifle&t=bot&d=14&n=3&night=1"
echo ALLDONE
