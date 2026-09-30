#!/bin/bash
D=tools/out/audit/verify-fxaudio-1
bash $D/runr.sh $D/o_gren.txt "index.html?autotest=1&map=sandbox&bots=1&scenario=tools/out/audit/verify-fxaudio-1/v1.js&mode=grenade&duration=6&script=idle" --report --shot $D/gren.png
bash $D/runr.sh $D/o_rocket.txt "index.html?autotest=1&map=sandbox&bots=1&scenario=tools/out/audit/verify-fxaudio-1/v1.js&mode=rocket&duration=6&script=idle" --report --shot $D/rocket.png
echo alldone > $D/batch1.done
