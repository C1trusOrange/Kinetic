#!/bin/bash
cd /c/Users/caleb/Desktop/AiProject/fps
OUT=tools/out/audit/review-lifecycle/soak
mkdir -p $OUT
: > $OUT/summary.txt
run() {
  name=$1; shift
  python tools/out/audit/review-lifecycle/run2.py "$@" --report --quiet --timeout 260 > $OUT/$name.txt 2>&1
  echo "$name exit=$?" >> $OUT/summary.txt
}
run foundry_tdm15_insane "index.html?autotest=1&map=foundry&bots=15&mode=tdm&duration=100&diff=insane&god=1"
run skyline_ffa15_hard "index.html?autotest=1&map=skyline&bots=15&mode=ffa&duration=100&diff=hard&god=1"
echo ALLDONE >> $OUT/summary.txt
