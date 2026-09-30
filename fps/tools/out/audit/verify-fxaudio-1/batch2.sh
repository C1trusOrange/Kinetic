#!/bin/bash
D=tools/out/audit/verify-fxaudio-1
S="index.html?autotest=1&map=sandbox&bots=1&script=idle"
bash $D/runr.sh $D/o_pillar.txt "$S&scenario=tools/out/audit/verify-fxaudio-1/v1.js&mode=pillar&duration=5" --report --shot $D/pillar.png
bash $D/runr.sh $D/o_pause.txt "$S&scenario=tools/out/audit/verify-fxaudio-1/v3.js&mode=pause&duration=30" --wait "window.__S2DONE__" --eval "window.__TEST__.custom" --timeout 60
bash $D/runr.sh $D/o_end.txt "$S&scenario=tools/out/audit/verify-fxaudio-1/v3.js&mode=end&duration=30" --wait "window.__S2DONE__" --eval "window.__TEST__.custom" --timeout 60
bash $D/runr.sh $D/o_trail.txt "$S&scenario=tools/out/audit/verify-fxaudio-1/v678.js&mode=trail&duration=2" --report
bash $D/runr.sh $D/o_dcap.txt "$S&scenario=tools/out/audit/verify-fxaudio-1/v678.js&mode=decalcap&duration=2" --report
echo alldone > $D/batch2.done
