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
run k_grenade_cook  "w=rifle&t=wall&act=grenade&actAt=1.0"
run k_melee_hit     "w=rifle&t=bot&d=1.7&hp=1000&act=melee&actAt=0.2"
echo ALLDONE
