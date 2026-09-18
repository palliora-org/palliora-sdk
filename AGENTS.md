# palliora-sdk

TypeScript SDK (`@palliora.org/chainsdk`) for the Palliora chain. This is the only
repository an application developer writes code against.

## Read this first

**[CHAIN-RULES.md](CHAIN-RULES.md)** — the behavioural rules of the chain: fees, contract
types, guardian groups, result submission, error causes. The README tells you which
function to call; CHAIN-RULES.md tells you what the chain does with it and why a
well-formed call still gets rejected. Read it before writing compute code. It also ships
in the npm package, so it is present in `node_modules/@palliora.org/chainsdk/`.

Do not infer chain semantics from TypeScript signatures alone — the fee floor, the
guardian rate thresholds and the two-transaction group protocol are invisible from them.

## Layout

| Path | Contents |
|---|---|
| `src/chain/` | API singleton, `signAndSend`, type registrations (`spec.ts`), block/extrinsic helpers |
| `src/compute/` | `compute.agreement` wrappers, fee estimation (`fees.ts`), inference and data contracts |
| `src/guardian/` | Guardian list, join, and group creation/reconstruction |
| `src/da/` | Data availability: submit, upload, register |
| `src/storage/` | Off-chain artifact storage: provider router and S3 pre-signed upload flow |
| `src/stake/`, `src/token/`, `src/validator/`, `src/account/` | Staking, transfers, validator and identity operations |
| `src/crypto/` | Hybrid and threshold encryption helpers |
| `src/costEstimation/` | Client for the offchain cost-estimation / rate-quote oracle |
| `scripts/` | Manual end-to-end test scripts against a live chain — useful as worked examples, but not all are current |
| `demos/sealed-bid-auction/` | Complete worked application: guardian group, encrypted inputs, compute, result |

## Facts that are easy to get wrong

- `src/chain/spec.ts` is the manual type registry. When a chain type changes, it must be
  updated by hand — it is the most likely thing to be stale. See CHAIN-RULES.md §6.
- Amounts in `Fee` are *human* PALI strings; everything read from the chain is atomic.
- `getGuardianParticipants()` disconnects the shared API in its `finally` block.
- `getApi()` can return undefined; assert before use.

## Working here

```bash
pnpm install
pnpm build          # tsup
pnpm lint           # eslint
npx tsc --noEmit    # typecheck
```

There is no test suite. `scripts/*.mjs` are run manually against a chain and are the
closest thing to integration coverage.

## Related repositories

- [`palliora`](https://github.com/palliora-org/palliora) — the chain. Authoritative for
  every rule in CHAIN-RULES.md.
- `compute-core` — orchestrator and result relay. Node-operator infrastructure; executes
  the jobs this SDK requests and submits their results.
