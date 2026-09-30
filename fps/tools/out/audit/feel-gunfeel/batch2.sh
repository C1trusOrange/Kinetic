#!/bin/bash
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
run h_rifle_hitmarker "w=rifle&t=bot&d=14&n=2&after=0.02"
run h_rifle_head      "w=rifle&t=bot&d=14&n=1&head=1&after=0.02"
run h_rifle_kill      "w=pistol&t=bot&d=10&n=1&kill=1&after=0.05"
run h_shotgun_kill    "w=shotgun&t=bot&d=5&n=1&kill=1&after=0.05"
run h_rifle_ads_flash "w=rifle&t=wall&pz=0&n=1&ads=1"
run h_pistol_night    "w=pistol&t=bot&d=12&n=1&night=1"
echo ALLDONE
