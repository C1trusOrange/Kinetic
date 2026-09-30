#!/bin/bash
cd /c/Users/caleb/Desktop/AiProject/fps
D=tools/out/audit/verify-aibrain-1
B="autotest=1&bots=2&duration=1&god=1&script=idle"
for M in foundry ruins skyline sandbox; do
  $D/r.sh $D/o_nearwall_$M.txt "index.html?$B&map=$M&scenario=$D/scen_nearwall.js"
done
for M in foundry ruins; do
  $D/r.sh $D/o_snipe_$M.txt "index.html?$B&map=$M&scenario=$D/scen_snipe.js"
done
echo ALLDONE
