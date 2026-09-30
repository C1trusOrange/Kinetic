#!/bin/bash
cd /c/Users/caleb/Desktop/AiProject/fps
D=tools/out/audit/verify-aibrain-1
B="autotest=1&bots=2&duration=1&god=1&script=idle"
$D/r.sh $D/o_wedge_foundry.txt "index.html?$B&map=foundry&scenario=$D/scen_wedge.js"
$D/r.sh $D/o_wedge_ruins.txt "index.html?$B&map=ruins&scenario=$D/scen_wedge.js"
$D/r.sh $D/o_air_foundry.txt "index.html?$B&map=foundry&scenario=$D/scen_air.js"
$D/r.sh $D/o_air_ruins.txt "index.html?$B&map=ruins&scenario=$D/scen_air.js"
for M in foundry ruins skyline sandbox; do
  $D/r.sh $D/o_spots_$M.txt "index.html?$B&map=$M&scenario=$D/scen_spots.js"
done
for F in 60 30 20; do
  $D/r.sh $D/o_stairspec_$F.txt "index.html?$B&map=foundry&scenario=$D/scen_stair.js&sfps=$F&np=2&a=-12.49,5,-4.49&g=-3.5,9.5,-20.5"
done
$D/r.sh $D/o_stair_rand30.txt "index.html?$B&map=foundry&scenario=$D/scen_stair.js&sfps=30&np=16"
$D/r.sh $D/o_search.txt "index.html?$B&map=sandbox&scenario=$D/scen_search.js"
echo ALLDONE
