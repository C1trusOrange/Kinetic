#!/bin/bash
cd /c/Users/caleb/Desktop/AiProject/fps
D=tools/out/audit/verify-aibrain-1
for M in ruins foundry skyline; do
  $D/r.sh $D/o_nat_$M.txt "index.html?autotest=1&map=$M&bots=8&duration=1&god=1&script=idle&scenario=$D/scen_nat.js&secs=300&sfps=30"
done
$D/r.sh $D/o_jump_foundry.txt "index.html?autotest=1&map=foundry&bots=2&duration=1&god=1&script=idle&scenario=$D/scen_jump.js"
$D/r.sh $D/o_jump_ruins.txt "index.html?autotest=1&map=ruins&bots=2&duration=1&god=1&script=idle&scenario=$D/scen_jump.js"
$D/r.sh $D/o_jump_skyline.txt "index.html?autotest=1&map=skyline&bots=2&duration=1&god=1&script=idle&scenario=$D/scen_jump.js"
echo ALLDONE
