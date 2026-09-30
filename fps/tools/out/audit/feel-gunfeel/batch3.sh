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
run i_rifle_hit_hip    "w=rifle&t=bot&d=14&n=2&hp=1000"
run i_rifle_head_hip   "w=rifle&t=bot&d=10&n=1&head=1&hp=1000"
run i_rifle_ads_flash  "w=rifle&t=wall&pz=0&n=1&ads=1"
run i_pistol_ads_flash "w=pistol&t=wall&pz=0&n=1&ads=1"
run i_pistol_hip_flash "w=pistol&t=wall&pz=0&n=1"
run i_rifle_hip_flash  "w=rifle&t=wall&pz=0&n=2"
run i_sniper_hip       "w=sniper&t=wall&pz=0&n=1"
echo ALLDONE
