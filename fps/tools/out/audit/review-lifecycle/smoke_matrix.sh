#!/bin/bash
cd /c/Users/caleb/Desktop/AiProject/fps
OUT=tools/out/audit/review-lifecycle/smoke
mkdir -p $OUT
run() {
  name=$1; shift
  python tools/out/audit/review-lifecycle/run2.py "$@" --report --quiet --timeout 150 > $OUT/$name.txt 2>&1
  echo "$name exit=$?" >> $OUT/summary.txt
}
: > $OUT/summary.txt
run foundry_tdm15 "index.html?autotest=1&map=foundry&bots=15&mode=tdm&duration=25&diff=hard"
run ruins_ffa0 "index.html?autotest=1&map=ruins&bots=0&mode=ffa&duration=15"
run skyline_ffa15 "index.html?autotest=1&map=skyline&bots=15&mode=ffa&duration=25&diff=insane"
run sandbox_tdm0 "index.html?autotest=1&map=sandbox&bots=0&mode=tdm&duration=15"
run ruins_tdm15_god "index.html?autotest=1&map=ruins&bots=15&mode=tdm&duration=25&god=1"
echo ALLDONE >> $OUT/summary.txt
