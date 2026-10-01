#!/usr/bin/env bash
# Runs every multiplayer suite and checks each one (from fps/; ~10 minutes; exit code = number of failed suites).
#   bash tools/mp/run_all.sh                 the Python relay (tools/serve.py, as in the browser version)
#   bash tools/mp/run_all.sh --node-relay    the desktop app's Node relay (desktop/relay.js)
#   bash tools/mp/run_all.sh --node-relay move duel   only these suites
cd "$(dirname "$0")/../.." || exit 99
EXTRA=()
if [ "$1" = "--node-relay" ]; then EXTRA=(--node-relay); shift; fi
ONLY=" $* "
C="autotest=1&quality=low&scenario=tools/mp/scenarios"
fails=0
failed=""
run() {
  local suite=$1; shift
  if [ "$ONLY" != "  " ] && [[ "$ONLY" != *" $suite "* ]]; then return; fi
  mkdir -p "tools/out/mp/$suite"
  python tools/run_mp.py "${EXTRA[@]}" --out "tools/out/mp/$suite/shot" --report --json "tools/out/mp/$suite/report.json" \
    --timeout 200 --size 960x540 --quiet "$@" > "tools/out/mp/$suite/run.log" 2>&1
  if python tools/mp_check.py "tools/out/mp/$suite/report.json" --expect "$suite"; then :; else fails=$((fails + 1)); failed="$failed $suite"; fi
}
run move \
  --page "index.html?$C/move.js&net=host&room={room}&players=3&map=sandbox&bots=2&mode=ffa&duration=30&godall=1" \
  --page "index.html?$C/move.js&net=join&room={room}&name=C1&duration=30" \
  --page "index.html?$C/move.js&net=join&room={room}&name=C2&duration=30"
run smoke \
  --page "index.html?$C/smoke.js&net=host&room={room}&players=3&map=sandbox&bots=2&mode=ffa&time=0.5&duration=120&godall=1" \
  --page "index.html?$C/smoke.js&net=join&room={room}&name=C1&duration=120" \
  --page "index.html?$C/smoke.js&net=join&room={room}&name=C2&duration=120&stall=1"
run hostloop --hide 0:22:5 \
  --page "index.html?$C/hostloop.js&net=host&room={room}&players=2&map=sandbox&bots=2&mode=ffa&duration=120&godall=1" \
  --page "index.html?$C/hostloop.js&net=join&room={room}&name=C1&duration=120"
run session \
  --page "index.html?$C/session.js&net=host&room={room}&players=3&map=sandbox&bots=2&mode=ffa&duration=120&godall=1" \
  --page "index.html?$C/session.js&net=join&room={room}&name=C1&duration=120" \
  --page "index.html?$C/session.js&net=join&room={room}&name=C2&duration=120&freeze=8" \
  --page "index.html?$C/session.js&net=join&room={room}&name=OLD&duration=120&buildOverride=old"
run duel \
  --page "index.html?$C/duel.js&net=host&room={room}&players=2&map=sandbox&bots=0&mode=ffa&duration=26" \
  --page "index.html?$C/duel.js&net=join&room={room}&name=C1&duration=26"
run latejoin \
  --page "index.html?$C/latejoin.js&net=host&room={room}&players=2&map=sandbox&bots=2&mode=ffa&duration=40" \
  --page "index.html?$C/latejoin.js&net=join&room={room}&name=C1&duration=40" \
  --page "index.html?$C/latejoin.js&net=join&room={room}&name=C2&duration=15&latejoin=22"
run arsenal \
  --page "index.html?$C/arsenal.js&net=host&room={room}&players=2&map=sandbox&bots=0&mode=ffa&duration=27" \
  --page "index.html?$C/arsenal.js&net=join&room={room}&name=C1&duration=27"
echo "[run_all] failed suites: $fails$failed"
exit $fails
