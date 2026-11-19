#!/bin/bash
# Runs the scripts/ integration suite against one deployment.
#
#   PALLIORA_WS=ws://<host>:9947 bash scripts/run-suite.sh
#
# PALLIORA_WS must name a node running the guardian protocol: guardian.guardianList
# is answered but always empty on a validator, so guardian selection silently finds
# nobody and every compute script fails as though no guardian were registered.
#
# Results land in RESULTS_DIR (default ./suite-results):
#   summary.txt   one "<verdict> <script> <seconds>" line per script
#   <script>.log  that script's full output
#   CURRENT       "<script> <start-epoch>" while one is running, absent when idle
#
# Touch $RESULTS_DIR/SKIP to abandon the running script and move to the next one;
# it is recorded as SKIP, not as a failure.
set -u

PALLIORA_WS="${PALLIORA_WS:?set PALLIORA_WS to a guardian node, e.g. ws://127.0.0.1:9947}"
COST_ESTIMATOR_URL="${COST_ESTIMATOR_URL:-http://localhost:4141}"
AUTH_SERVICE_URL="${AUTH_SERVICE_URL:-http://localhost:3000}"
# Must equal the orchestrator's own key: the access grant is wrapped to its public
# half, so a mismatch means the grant cannot be unwrapped at all.
STATIC_RESPONSE_KEY="${STATIC_RESPONSE_KEY:?set STATIC_RESPONSE_KEY to the orchestrator key}"
TIMEOUT_SECS="${TIMEOUT_SECS:-420}"
RESULTS_DIR="${RESULTS_DIR:-$(cd "$(dirname "$0")" && pwd)/suite-results}"
export PALLIORA_WS COST_ESTIMATOR_URL AUTH_SERVICE_URL STATIC_RESPONSE_KEY

cd "$(dirname "$0")/.."
mkdir -p "$RESULTS_DIR"
: > "$RESULTS_DIR/summary.txt"
rm -f "$RESULTS_DIR/SKIP" "$RESULTS_DIR/CURRENT"

run() {
  local s=$1; shift
  local start; start=$(date +%s)
  echo "$s $start" > "$RESULTS_DIR/CURRENT"

  perl -e 'alarm shift; exec @ARGV' "$TIMEOUT_SECS" node "scripts/$s.mjs" "$@" \
    > "$RESULTS_DIR/$s.log" 2>&1 &
  local pid=$!

  local skipped=0
  while kill -0 "$pid" 2>/dev/null; do
    if [ -f "$RESULTS_DIR/SKIP" ]; then
      rm -f "$RESULTS_DIR/SKIP"
      pkill -P "$pid" 2>/dev/null
      kill -TERM "$pid" 2>/dev/null
      skipped=1
      break
    fi
    sleep 1
  done
  wait "$pid" 2>/dev/null
  local code=$?

  local dur=$(( $(date +%s) - start ))
  local v
  if   [ "$skipped" -eq 1 ]; then v="SKIP"
  elif [ "$code" -eq 0 ];    then v="PASS"
  else                            v="FAIL(exit=$code)"
  fi
  echo "$v $s ${dur}s" | tee -a "$RESULTS_DIR/summary.txt"
  rm -f "$RESULTS_DIR/CURRENT"
}

run test-da-bulk-submit
run test-simple-compute
run test-compute-result
run test-store-data-contract
run test-store-program-contract
run test-stored-program-compute

# Dereferencing a stored contract needs the two ids the store scripts printed.
PROG=$(grep -h '^PROGRAM_CONTRACT_ID=' "$RESULTS_DIR/test-store-program-contract.log" 2>/dev/null | tail -1 | cut -d= -f2)
INPUT=$(grep -h '^INPUT_CONTRACT_ID='  "$RESULTS_DIR/test-store-data-contract.log"    2>/dev/null | tail -1 | cut -d= -f2)
echo "contract ids: program=${PROG:-<none>} input=${INPUT:-<none>}"
run test-stored-contract-compute "$PROG" "$INPUT"

run test-stored-access-compute
run test-encrypted-access-compute
run test-inference
run test-encrypted-inference
run test-encrypted-inference-session
run test-confirmed-auction-inference
run test-acceptance-race

# invoke-existing needs an already-Accepted Subscription, which subscription-invoke
# creates — so it has to run first and hand its agreement id over.
run test-subscription-invoke
SUB=$(grep -E '^Agreement id' "$RESULTS_DIR/test-subscription-invoke.log" 2>/dev/null | grep -oE '0x[0-9a-f]{64}' | head -1)
echo "subscription contract: ${SUB:-<none>}"
if [ -n "$SUB" ]; then
  export CONTRACT_ID="$SUB"
  run test-invoke-existing
  unset CONTRACT_ID
else
  echo "SKIP test-invoke-existing (no subscription contract id)" | tee -a "$RESULTS_DIR/summary.txt"
fi

run temp-test-payout
echo "ALL-DONE"
