#!/bin/bash
D=tools/out/audit/verify-fxaudio-1
S="index.html?autotest=1&map=sandbox&bots=1&script=idle"
bash $D/runr.sh $D/o_pause2.txt "$S&scenario=tools/out/audit/verify-fxaudio-1/v3.js&mode=pause2&duration=30" --wait "window.__S2DONE__" --eval "window.__TEST__.custom" --timeout 60
bash $D/runr.sh $D/o_nat.txt "index.html?autotest=1&map=foundry&bots=7&diff=insane&god=1&scenario=tools/out/audit/verify-fxaudio-1/v678.js&mode=natural&duration=70" --report --timeout 200
echo alldone > $D/batch3.done
