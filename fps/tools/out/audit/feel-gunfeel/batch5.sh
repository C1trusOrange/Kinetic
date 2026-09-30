#!/bin/bash
cd /c/Users/caleb/Desktop/AiProject/fps
OUT=tools/out/audit/feel-gunfeel
BASE="index.html?autotest=1&map=gunfeel&mapfile=$OUT/testmap.js&bots=1&god=1&scenario=$OUT/fire.js&duration=90&t=wall"
run() {
  name=$1; shift
  for attempt in 1 2; do
    python $OUT/run2.py "$BASE&$*" --wait "window.__FROZEN__" --timeout 150 --shot $OUT/$name.png --eval "window.__TEST__.custom" > $OUT/$name.txt 2>&1
    if grep -q "wait=ok" $OUT/$name.txt; then break; fi
  done
  echo "$name: $(grep -E 'done:' $OUT/$name.txt)"
}
run r_rifle_35   "w=rifle&reloadAt=0.35"
run r_rifle_55   "w=rifle&reloadAt=0.55"
run r_shotgun_40 "w=shotgun&reloadAt=0.4"
run r_pistol_35  "w=pistol&reloadAt=0.35"
echo ALLDONE
