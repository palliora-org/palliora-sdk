# Running the script suite against a deployment

`run-suite.sh` runs the `scripts/` integration tests against one live deployment —
local, staging, or any host — and writes a pass/fail table. The scripts submit real
extrinsics, so a run spends funds and leaves contracts, agreements and guardian groups
behind on whatever chain it is pointed at.

```bash
PALLIORA_WS=ws://<host>:9947 \
STATIC_RESPONSE_KEY=0x<orchestrator key> \
bash scripts/run-suite.sh
```

## Before the first run

| Check | How | Why it matters |
|---|---|---|
| Endpoint serves guardians | `guardian_guardianList` returns a non-empty list | Empty means guardian selection finds nobody and every compute script fails |
| Signer is funded | `system.account` of the `//Bob` default signer | The fee floor is checked during extrinsic validation; a short account is rejected before it reaches a block |
| Guardians are registered | `staking.guardians` has entries with `compute: true` and `feeThresholds` set | An offer below a guardian's threshold is ignored, not rejected — the agreement never gets included |
| Workers are mapped | `guardian.workerByAccount` has one entry per guardian | Until `setWorker` has run a node cannot resolve its own guardian account and skips every agreement silently |
| Cost-estimation is reachable and on the **same chain** | `GET $COST_ESTIMATOR_URL/health`, then `POST /estimate` returns 202 | A 422 "no guardians available" means it is pointed at a different chain, or at one with no registered guardians |

A `POST /estimate` that returns 202 is the single best smoke test: it exercises the
endpoint, the guardian roster and the auction in one call.

## Environment

| Variable | Required | Notes |
|---|---|---|
| `PALLIORA_WS` | yes | **Must be a node running the guardian protocol.** A validator answers `guardian.guardianList` but always returns an empty list, so guardian selection silently finds nobody. On the standard 7-node layout the guardians are `9947`–`9950`; `9944`–`9946` are validators and will not work. |
| `STATIC_RESPONSE_KEY` | yes | Must equal the key the **orchestrator serving this chain** holds. The access grant is wrapped to its public half, so a mismatch means the grant cannot be unwrapped at all. |
| `COST_ESTIMATOR_URL` | no (`http://localhost:4141`) | Must point at a cost-estimation service configured for the **same chain** as `PALLIORA_WS`. |
| `AUTH_SERVICE_URL` | no (`http://localhost:3000`) | Only `test-store-program-contract` uses it. |
| `TIMEOUT_SECS` | no (`420`) | Per-script cap. Healthy scripts finish well inside it; raise it only if a deployment is genuinely slower, not to paper over a hang. |
| `RESULTS_DIR` | no (`scripts/suite-results`) | |

**Never run a script bare to "just check one thing".** Most of them default
`PALLIORA_WS` to `wss://manas-rpc.palliora.org`, which is **production**. Always pass the
endpoint explicitly.

## Watching a run

`$RESULTS_DIR/CURRENT` holds `<script> <start-epoch>` while a script is running and is
absent when idle, so a watcher can report progress without parsing logs:

```bash
R=scripts/suite-results
while [ ! -f "$R/CURRENT" ] || true; do
  read -r name start < "$R/CURRENT" 2>/dev/null \
    && echo "running $name $(( $(date +%s) - start ))s" \
    || echo idle
  sleep 8
done
```

## Skipping a stuck script

```bash
touch "$RESULTS_DIR/SKIP"
```

The runner kills the running script, records it as `SKIP` — not as a failure — and moves
on. Use this rather than waiting out `TIMEOUT_SECS` when a script is clearly wedged.

## Results

`$RESULTS_DIR/summary.txt` gets one line per script; each script's full output is in
`$RESULTS_DIR/<script>.log`.

```
PASS test-simple-compute 3s
FAIL(exit=1) test-compute-result 0s
SKIP test-encrypted-inference 41s
```

Exit codes are not uniform, so read them before concluding anything:

| Verdict | Meaning |
|---|---|
| `FAIL(exit=1)` | Ordinary assertion failure |
| `FAIL(exit=2)` | A missing precondition — usually a required environment variable |
| `FAIL(exit=3)` | `test-acceptance-race` only: **INCONCLUSIVE**, not a failure. It probes a race whose trigger ordering it may never hit. Its own output says to re-run. |
| `FAIL(exit=124/142/143)` | Hit `TIMEOUT_SECS`, or was killed. Not an assertion failure. |

**An exit code of 0 is not proof the path worked.** `test-subscription-invoke` prints
`results delivered : N` and `missing : …` and exits 0 **even when nothing came back**. For
any script that waits on compute results, confirm delivery in its log rather than trusting
the verdict:

```bash
grep -E "results delivered|missing" "$RESULTS_DIR/test-subscription-invoke.log"
```

## Ordering dependencies the runner handles

Three scripts cannot stand alone, which is why the order in `run-suite.sh` is not
arbitrary:

| Script | Needs | Supplied by |
|---|---|---|
| `test-stored-contract-compute` | a program and an input contract id, as argv | the `PROGRAM_CONTRACT_ID=` / `INPUT_CONTRACT_ID=` lines printed by the two store scripts |
| `test-invoke-existing` | `CONTRACT_ID` of an already-Accepted Subscription | the `Agreement id` printed by `test-subscription-invoke`, which must therefore run first |
| `test-encrypted-access-compute` | `STATIC_RESPONSE_KEY` matching the orchestrator | the environment |

Run them out of order and they fail on a precondition, which looks like a product bug but
is not one.

## Scope

The runner covers 17 scripts. Not included:

| Script | Why |
|---|---|
| `test-run-agent.mjs` | Long-running agent scenario, run on request |
| `test-oracle-quote.mjs` | Focused check that `oracle_quote_id` changes a guardian verdict; useful on its own when debugging the rate-quote oracle |
| `overhead-report.mjs`, `_staging-check.mjs` | Reporting and ad-hoc tools, not tests |
| `fix-esm-import-specifiers.mjs`, `write-cjs-package-json.mjs` | Build helpers |

## Diagnosing a failure

Before blaming the code, separate the three layers — most surprising failures are
environmental:

1. **Did the chain accept the extrinsic?** If a script hangs submitting, the agreement was
   probably never included: guardians ignore offers below their threshold rather than
   rejecting them, so nothing fails loudly. Check the signer's balance and the guardians'
   `feeThresholds`.
2. **Did a guardian dispatch it?** Guardian logs show `dispatch_queue size = N`. A queue
   that stays `0` while invokes are landing on chain means the guardians are not picking
   the work up at all, and nothing downstream will run.
3. **Did the orchestrator receive it?** Its log prints `dispatch request received` with the
   block height. No entry means the request never arrived — an orchestrator that is
   healthy but idle is the signature of a guardian-side stall, not an orchestrator bug.

A failure that reproduces on two independent deployments is a real defect. One that
appears on a single deployment is far more likely to be that deployment's state.
