#!/bin/bash
cd /c/Users/caleb/Desktop/AiProject/fps
D=tools/out/audit/verify-aibrain-1
U="index.html?autotest=1&map=foundry&bots=2&duration=1&god=1&script=idle&scenario=$D/scen_pad.js"
$D/r.sh $D/o_padall_foundry.txt "$U"
$D/r.sh $D/o_padall_foundry_p1.txt "$U&patch=1"
$D/r.sh $D/o_padall_foundry_p2.txt "$U&patch=2"
echo ALLDONE
