# Palliora chain rules

The behavioural rules of the Palliora chain, for anyone — human or agent — building an
application on `@palliora.org/chainsdk`.

The SDK README documents *which function to call*. This document covers *what the chain
does with the call*: what it charges, what it reserves, who has to agree, and why a
correctly-shaped transaction still gets rejected. These rules are not visible from the
SDK's TypeScript signatures, which is why they are written down separately.

Source citations point into [`palliora-org/palliora`](https://github.com/palliora-org/palliora)
(the chain) and this SDK. Line numbers drift; the function and type names are the stable
anchors. When this document and the pallet disagree, the pallet is right.

---

## 1. Orientation: which repository owns which fact

| Repository | Owns | You need it when |
|---|---|---|
| [`palliora`](https://github.com/palliora-org/palliora) | The chain. `pallets/compute` (agreements, fees, settlement), `pallets/dactr` (DA + guardian groups), `runtime` (constants), `guardian` (threshold crypto service) | Deciding what the chain will accept or charge |
| [`palliora-sdk`](https://github.com/palliora-org/chainsdk) | TypeScript wrappers, type registrations (`src/chain/spec.ts`), crypto helpers | Writing application code |
| `compute-core` | `orchestrator` (executes jobs), `result_relay` (submits `compute.result`), `docker_gateway` | Running a compute node, or understanding how a result reaches the chain |
| [`palliora-core`](https://github.com/palliora-org/palliora-core) | Kate commitments, DA primitives shared by the chain | Working on DA internals — rarely needed by applications |

**An application developer only ever signs transactions from `palliora-sdk`.** The
orchestrator and result relay are node-operator infrastructure: you do not call them,
but the fees you offer pay them, and the results you wait for come from them.

---

## 2. The money model

This is the single most common source of failure, so it comes first.

### 2.1 Two gates, not one

An `Active` or `Subscription` agreement must pass **two independent checks**. They test
different fields, they are enforced in different places, and passing one tells you nothing
about the other.

| | Gate 1 — the chain's fee floor | Gate 2 — the guardians' rate threshold |
|---|---|---|
| **Tests** | `compute.fees` (the absolute amount) | `compute.computeRate` (the per-ms rate) |
| **Against** | A formula over live chain parameters | Each guardian's own declared minimum |
| **Enforced by** | `CheckCompute` signed extension, at validation | Guardians' offchain workers, before inclusion |
| **Enforced in** | [`pallets/compute/src/lib.rs`](https://github.com/palliora-org/palliora/blob/main/pallets/compute/src/lib.rs) — `ensure_min_free_balance` | [`pallets/compute/src/offchain.rs`](https://github.com/palliora-org/palliora/blob/main/pallets/compute/src/offchain.rs) — `decide` |
| **Failure looks like** | Transaction rejected: `InsufficientFreeBalance` | Transaction included, then `AgreementFailed` event |
| **Failure timing** | Immediate, at submission | After all guardians respond — or never, if one is offline |

**How Gate 2 actually plays out.** `CheckCompute` gives a `compute.agreement` transaction a
`requires` tag *per named guardian*, satisfied only when that guardian submits its
`agreement_response`. Until all of them have, your transaction sits in the node's **future
queue** — not rejected, not included, no error. Guardians read that same future queue to
decide (`accept_agreements` in `offchain.rs`), which is what lets them judge an agreement
before it is ever in a block.

The consequences are worth stating explicitly, because the failure is silent:

- If a named guardian is offline or never responds, the agreement **never gets included and
  never errors**. A hanging `signAndSend` is the expected symptom.
- If every guardian responds and any one rejected, the transaction *is* included, and
  `compute.agreement` emits `AgreementFailed` and returns without reserving anything.
- So name guardians you have reason to believe are live — from `getGuardianList()` or the
  current era's `guardian.guardians` — and treat a stalled agreement as a guardian
  availability problem, not a fee problem.

A generous `fees` does not buy you past Gate 2, and a generous `computeRate` does not by
itself satisfy Gate 1 — though it does *raise* Gate 1, because `computeRate` is one of the
floor's four components. Raising the rate to satisfy guardians raises the minimum `fees`
you must also offer.

`Dormant` contracts are exempt from both gates. They reserve nothing, so they may offer
any `fees`, including zero.

### 2.2 Gate 1: the fee floor

`fees` must be at least the sum of four components, and the signer must actually hold
that much free balance:

```
result_fee              = MaxDaStorageSize × ProviderStorageRate
input_fee               = usage_price of the input contract   (0 if no ContractId input)
threshold_decryption_fee = ThresholdDecryptionFee              (flat)
offered_component       = computeRate × MillisecondsPerBlock   (one block of compute)

min_fees = result_fee + input_fee + threshold_decryption_fee + offered_component
```

Defined once in `pallet_compute::Pallet::fee_components` and used from three places —
`ensure_min_free_balance` at validation, the guardian offchain worker, and `compute.result`
at settlement — specifically so the three cannot drift apart.

**Do not hard-code these numbers.** The first three parameters are root-settable at
runtime (`compute.setMaxDaStorageSize`, `setProviderStorageRate`,
`setThresholdDecryptionFee`). A stale copy fails silently, as an
`InsufficientFreeBalance` you cannot explain. Query them:

```ts
import { estimateMinFee, getFeeParams, fromAtomicPaliAmount } from "@palliora.org/chainsdk";

const floor = await estimateMinFee({ computeRate: "0.000000001" });
console.log(fromAtomicPaliAmount(floor.minFee));      // smallest acceptable `fees`
console.log(floor.resultFee, floor.offeredComponent); // the breakdown, in atomic units

const params = await getFeeParams(); // the four raw chain values
```

`estimateMinFee` mirrors `fee_components` exactly. Offer at least `minFee`; offer more to
buy more compute time.

Worked example, at the genesis parameters (`MaxDaStorageSize` 10485760,
`ProviderStorageRate` 1e9, `ThresholdDecryptionFee` 1e15, block time 500ms, 18 decimals):

```
result_fee               = 10485760 × 1e9 = 1.048576e16   ≈ 0.0105 PALI
threshold_decryption_fee = 1e15                            = 0.001  PALI
offered_component        = computeRate × 500
min_fees (no input contract, rate 0) ≈ 0.0115 PALI
```

Verify against the live chain rather than trusting these figures — they are genesis
values for one network, not constants.

### 2.3 How much compute your fee buys

Beyond the floor, `fees` is a *budget*. Compute is billed at `computeRate` per millisecond
of actual execution, settled when the result lands:

```
compute_fee   = computeRate × compute_duration_ms
budget_for_compute = fees − result_fee − input_fee − threshold_decryption_fee
max_duration_ms    = budget_for_compute ÷ computeRate
```

Anything unspent is returned to you when the contract settles.

### 2.4 Gate 2: guardian rate thresholds

Every guardian declares a minimum rate it will take work at, **per compute type**:

```rust
pub enum ComputeType { Trusted, Tee, Mpc, Fhe, Zkp }
pub type FeeThresholds = BoundedVec<(ComputeType, u128), ConstU32<8>>;
```

A compute type absent from a guardian's list carries **no threshold and reads as zero** —
that guardian accepts any rate for it. The compute type is not something you set directly;
it is derived from your contract's `confidentiality` field:

| `confidentiality` in your contract | `ComputeType` the threshold is looked up under |
|---|---|
| `{ Trusted: <index> }` | `Trusted` |
| `"TEE"` | `Tee` |
| `"SMPC"` | `Mpc` |
| `"FHE"` | `Fhe` |

Each guardian named in `contract.guardians` independently decides. If **any** of them
rejects, the agreement fails — `compute.agreement` emits `AgreementFailed` and returns
without reserving anything. Choosing a confidentiality level therefore changes the price
floor you must clear, because it changes which threshold applies.

A guardian may instead be pointed at an **oracle quote**: pass an `oracle_quote_id` to
`compute.agreement`, and guardians price against the oracle's quoted rate rather than
their own threshold. If the oracle is unreachable, times out (500ms), or does not know the
quote ID, each guardian silently falls back to its own threshold — so an oracle quote is a
hint, never a guarantee.

### 2.5 Who gets paid, and when

At `compute.result`, the reserved deposit is split:

| Recipient | Amount |
|---|---|
| Owner of the input contract | `input_fee` (only when input is a `ContractId`) |
| The contract's guardians | `threshold_decryption_fee`, split equally — **only when there is more than one guardian** |
| The result submitter | `result_fee + (computeRate × compute_duration_ms)` |
| You, the contract owner | Everything still reserved, refunded at settlement |

The guardian split divides by `max(guardian_count, 3)`, so a 2-guardian contract leaves a
third share reserved, which returns to you at settlement rather than being paid out.

---

## 3. The `Contract` object

`compute.agreement` takes exactly one structured argument, and you build it by hand. The
SDK types it loosely (`compute: Record<string, unknown>`, `preCheck?: unknown`,
`resultCipher: unknown`), so TypeScript will not catch a wrong shape — the chain will,
usually as an opaque decode failure. This section is the field reference.

Two conventions apply throughout, and both bite:

- **Field names are camelCase**, not the Rust snake_case. `computeRate`, not
  `compute_rate`; `resultCipher`, not `result_cipher`. The names come from the manual type
  registry in `src/chain/spec.ts`.
- **Omitted fields do not error.** `Option` fields default to `None`, and missing struct
  members default to zero. Passing `{ Url: { url } }` without `size` silently sends
  `size: 0`. Be explicit about anything that matters.

### 3.1 Shape at a glance

```ts
{
  contractType: "Dormant" | "Active" | "Subscription",
  guardians: string[],              // account IDs; indices referenced below
  preCheck: null,                   // Option<ComputeInfo> — input verification
  compute: {                        // ComputeInfo — the primary step
    cipher: "Plaintext",            // how `input` is encrypted
    computerIndices: [0, 1, 2],     // which of `guardians` execute this step
    fees: "10000000000000000",      // atomic units; see §2.2 for the floor
    computeRate: "1000000000",      // atomic units, per millisecond
    deadline: 0,                    // block number; 0 = none
    confidentiality: { Trusted: 0 },// selects the ComputeType priced in §2.4
    feeFunction: null,              // Option<u8>
    programEnv: null,               // Option<Vec<u8>> — env vars for the program
    input: { Inline: { data: [] } },// DAInput — the data
    program: { NativeExecute: "Inference" }, // DAInput — the code
    metadata: null,                 // Option<ComputeMetadata>
  },
  postCheck: null,                  // Option<ComputeInfo> — result verification
  resultCipher: "Plaintext",        // how the result is encrypted back to you
  currencyId: "Native",
}
```

`buildFee({ amount, computeRate })` fills in `fees` and `computeRate` from human PALI
strings — prefer it over writing atomic units by hand.

### 3.2 `Contract` fields

| Field | Type | Notes |
|---|---|---|
| `contractType` | enum | Governs reservation, settlement and invocability. See §3.6 |
| `guardians` | `Vec<AccountId>` | The participant set. Every index elsewhere in the contract points into **this list, in this order** |
| `preCheck` | `Option<ComputeInfo>` | Input verification step. `null` to skip |
| `compute` | `ComputeInfo` | The primary step. Required — this is what gets billed |
| `postCheck` | `Option<ComputeInfo>` | Result verification step. `null` to skip |
| `resultCipher` | `CipherSuite` | Encryption applied to the result on its way back to you |
| `currencyId` | enum | `"Native"` \| `"USDC"` \| `{ ForeignAsset: n }`. The deposit is reserved in, and settlement paid from, this currency. `createAgreement` defaults it to `"Native"` |

`guardians` is validated by `CheckCompute` before the contract is ever decoded by the
pallet, with three separate rules — each a distinct rejection code:

| Rule | Rejected as |
|---|---|
| Must be non-empty, unless `compute.program` is `"Null"` | `Custom(149)` |
| Entries must be unique — no duplicates | `Custom(145)` |
| Every entry must be a registered, staked guardian | `Custom(148)` |

### 3.3 `ComputeInfo` fields

The same struct is used for `preCheck`, `compute` and `postCheck`. **Only `compute` is
billed** — fee fields on the check steps are not what settlement reads.

| Field | Type | Notes |
|---|---|---|
| `cipher` | `CipherSuite` | How `input` is encrypted. `"Plaintext"` when it is not |
| `computerIndices` | `Vec<u32>` | Indices into `Contract.guardians` that execute this step. Usually all of them: `guardians.map((_, i) => i)` |
| `fees` | `u128` | Total offered, atomic units. Must clear the floor (§2.2) for `Active`/`Subscription` |
| `computeRate` | `u128` | Atomic units **per millisecond**. Must be non-zero except on `Dormant`. Weighed against guardian thresholds (§2.4) |
| `deadline` | `u64` | Block number by which the step must complete. `0` means no deadline — and is not the same as the contract-level deadline (§3.6) |
| `confidentiality` | enum | `{ Trusted: <index into guardians> }`, or `"TEE"` / `"FHE"` / `"SMPC"`. Determines which guardian threshold prices the offer |
| `feeFunction` | `Option<u8>` | Dynamic fee function selector. `null` in every current SDK helper |
| `programEnv` | `Option<Vec<u8>>` | Environment for program execution. Omitted by all SDK helpers — set it explicitly if you need it |
| `input` | `DAInput` | Where the data comes from |
| `program` | `DAInput` | Where the code comes from. Same type as `input` |
| `metadata` | `Option<ComputeMetadata>` | `{ name, description, storeType, groupId }`. `groupId` links the entry to a guardian group (§4.3). Used when registering datasets/models via `Dormant` contracts |

### 3.4 `DAInput` — how `input` and `program` are located

One enum serves both fields, which is why `program` can be a URL, a container image
reference, or a built-in. Variants:

| Variant | Shape | Use |
|---|---|---|
| `"Null"` | — | Nothing. On `program`, this is the one case where `guardians` may be empty |
| `Inline` | `{ data: number[] }` | Bytes carried in the extrinsic. Simplest, but counts against block size |
| `ChainTransaction` | `{ blockNumber, extrinsicIndex }` | Points at data already submitted on-chain |
| `ContractId` | `{ id: [u8; 32] }` | References another contract. **This is what triggers `input_fee`** — the referenced contract's owner is paid its `usage_price` (§2.5) |
| `Ipfs` | `{ cid: number[], size: u64 }` | Content-addressed pointer |
| `Url` | `{ url: number[], size: u64, hash: Option<number[]> }` | Remote fetch. `url` is UTF-8 bytes, not a string |
| `NativeExecute` | `"Inference"` \| `"ContractAccess"` | Built-in programs. `"Inference"` routes to the orchestrator's Ollama path |
| `NativeData` | `"DaFalse"` \| `"DaTrue"` | Built-in static data flags |

`Subscription` contracts are intended to take a `ContractId` input on each invocation —
that is how a subscription references the dataset it runs against.

### 3.5 `CipherSuite` and confidentiality — two different things

These are easy to conflate, and they are unrelated:

- **`cipher` / `resultCipher`** are about *encryption of bytes*: `"Plaintext"`,
  `{ ThresholdHybrid: {...} }` (needs a guardian group, §4.3), or
  `{ AsymmetricHybrid: {...} }`. Use the `encryptedInference*` helpers rather than
  assembling these by hand — the parameter structs are large and order-sensitive.
- **`confidentiality`** is about *where execution happens*: `Trusted`, `TEE`, `FHE`,
  `SMPC`. It carries no key material. It selects which guardian fee threshold applies
  (§2.4), so it is also a pricing decision.

A `"Plaintext"` contract with `{ Trusted: 0 }` is the normal starting point: unencrypted
data, executed by the guardian at index 0.

### 3.6 Contract types and lifecycle

`ContractType` decides nearly everything about how a contract behaves.

| | `Dormant` | `Active` | `Subscription` |
|---|---|---|---|
| Reserves a deposit | No | Yes, `fees` | Yes, `fees` (upfront budget) |
| `computeRate` required non-zero | No | **Yes** (`ZeroComputeRate`) | **Yes** |
| Subject to the fee floor | No | Yes | Yes |
| Subject to guardian thresholds | No | Yes | Yes |
| `compute.invoke` allowed | No | No | **Yes** |
| Settles on | Never (registration only) | First result | Budget exhausted, or deadline |
| `usage_price` set to | `fees` | 0 | 0 |

**`Dormant`** registers something — a dataset, a model, a program, a set of terms — without
buying execution. Its `fees` becomes its `usage_price`: the amount another contract pays
its owner when referencing it via `DAInput::ContractId`. This is how you charge for data
you publish.

**`Active`** is one job. It reserves, runs, settles on the first result.

**`Subscription`** is a long-lived funded contract. `compute.agreement` reserves the whole
budget; each `compute.invoke` runs one job against it and stamps `invocation_block`.
`compute.result` bills that invocation but leaves the contract open. It settles when the
remaining reserve drops below one block of compute (`BudgetExhausted`) or the deadline
passes (`DeadlineReached`) — and, importantly, `invoke` **settles and returns `Ok`** in
both cases rather than erroring. A successful `invoke` is not proof that a job started;
check for a `ComputeInvoked` event, and treat `ContractSettled` as the terminal signal.

Every contract also gets a deadline at creation: `current_block + ContractDeadlineDuration`
(14400 blocks at genesis), independent of the `deadline` field inside `ComputeInfo`.

### 3.7 Contract IDs are derived, not returned

```
contract_id = blake2_256(signer_account_id ++ signer_nonce)
```

using the nonce the `agreement` call is applied with. `createAgreement` reads the ID off
the `AgreementCreated` event, which is the reliable way to get it. Note the consequence:
the ID depends on the nonce, so a resubmitted or reordered transaction produces a
different contract.

Read a contract back with `api.query.compute.contracts(contractId)` — status, owner,
`origin_block`, `invocation_block`, `usage_price`, `contract_type`.

---

## 4. Guardians

### 4.1 Listing guardians

```ts
const guardians = await getGuardianList();          // custom RPC: guardian.guardianList
const detail    = await getGuardianParticipants();  // current + upcoming, with prefs and stake
```

`getGuardianParticipants` reads `guardian.guardians` (active this era) and
`guardian.nextGuardians` (active next era). The guardian set rotates per era, so a
long-lived contract should name guardians present in both.

> `getGuardianParticipants` calls `disconnectApi()` in its `finally` block. It tears down
> the shared API connection on the way out — call it before other SDK work, not between
> two transactions.

### 4.2 Joining as a guardian

`joinGuardian(account, prefs)` submits `staking.guard` with a `GuardianPrefs`. Note that
the chain now expects `fee_thresholds` as a list of `(ComputeType, rate)` pairs, one per
compute type — see §6, this is currently mis-registered in the SDK.

### 4.3 Guardian groups — and why they are hard to find

**A guardian group has no on-chain storage.** Neither `dataAvailability.daccGuardianGroup`
nor `daccGuardianGroupInfo` writes anything; both only emit a `DaccGuardianGroup` event.
This single fact explains every difficulty around groups, so it is worth stating plainly:
there is no `api.query` that returns a group, and no way to enumerate groups from state.

What you get instead:

- **The group ID is derivable.** `group_id = blake2_256(concat(SCALE-encoded guardian
  account IDs, in order))`. Order matters — the same guardians in a different order are a
  different group.
- **The crypto parameters are not derivable.** `group_pk`, `tau_params` and `agg_key` come
  from the guardian network's distributed key generation and exist only as arguments to
  the `daccGuardianGroupInfo` extrinsic. To obtain them you must read that extrinsic back
  out of its block.

So there are exactly two supported ways to get a `GuardianGroupInfo`:

```ts
// 1. Create a group and watch for the follow-up extrinsic (needs 3 guardians exactly)
const info = await createGuardianGroupAndWatch(account, guardians);

// 2. Reconstruct one you created earlier, from the block+index you recorded at the time
const info = await getGuardianGroupInfo(
  { blockNumber, index },  // the daccGuardianGroup creation extrinsic
  undefined,               // optional: the daccGuardianGroupInfo extrinsic; scanned for if omitted
);
```

**Persist `{ blockNumber, index }` when you create a group.** It is the only handle that
lets you recover the group later. Losing it means scanning the chain, or creating a new
group. (The `sealed-bid-auction` demo stores exactly this in a `.group.json` file.)

Group creation is a **two-transaction protocol**: your `daccGuardianGroup` call registers
the intent, and the guardian network responds with a separate `daccGuardianGroupInfo`
transaction carrying the computed parameters, typically a few blocks later. `maxBlocks`
(default 20) bounds how long the SDK waits.

To *list* groups, index `DaccGuardianGroup` events or `daccGuardianGroupInfo` extrinsics
from block history yourself, and keep your own record. There is no chain-side index.

You only need a group for **threshold-encrypted** work (`encryptedInference*`, encrypted
DA uploads). Plaintext and trusted compute need a guardian *list*, not a group.

---

## 5. Compute results

Applications submit agreements; **node operators submit results.** If you are building an
app, this section is about what to wait for, not what to call.

`compute.result(request_id, contract, submitor, compute_duration_ms, execution_outcome)`
is submitted by `result_relay` after the orchestrator finishes a job. The SDK deliberately
ships no wrapper for it.

The rules that make results fail:

- **`compute_duration_ms` is bounded.** It must not exceed
  `(elapsed_blocks + 4) × MillisecondsPerBlock`, measured from `invocation_block` (or
  `origin_block` for non-subscriptions). Overstating duration fails with
  `ComputeDurationTooLarge`. A very fast chain (500ms blocks) makes this bound tight.
- **The contract must exist.** `request_id` is the contract ID; an unknown one is
  `AgreementNotFound`.
- **The `contract` argument must be re-supplied in full**, matching the original.
- **`CheckCompute` gates the extrinsic.** `compute.result` is one of a small allowlist of
  calls permitted to carry a non-default `ComputePayload` (§7); anything else carrying one
  is rejected as `ForbiddenCompute`.

To observe a result as an application, watch for these events on your contract ID:

| Event | Meaning |
|---|---|
| `compute.ComputeResult(request_id)` | A result landed |
| `compute.ExecutionSuccess` / `ExecutionFailed` / `ExecutionTerminated` | How the job ended |
| `compute.ExecutionFullSettlement` / `ExecutionPartialSettlement` | How the budget resolved |
| `compute.ContractSettled { refunded, reason }` | Contract closed, funds returned |
| `compute.SubmitorFeePaid` / `InputFeePaid` / `DecryptionFeePaid` | Who was paid |

`ComputeResult` and `ExecutionFailed` can both fire for the same request: a job that ran
and failed still consumed compute and still pays out.

---

## 6. Known drift — read before debugging

Verified against the current `dev` branches at the time of writing. These are real
inconsistencies between the repositories, not documentation gaps.

1. **`joinGuardian`'s fee threshold is silently discarded.** `src/chain/spec.ts` declares
   `GuardianPrefs.feeThreshold: "u128"`, but extrinsic arguments are encoded from
   *metadata*, not from `spec.ts` — `api.tx.staking.guard` resolves `prefs` through the
   metadata lookup id. On the deployed runtime that type has no threshold field at all, so
   the value is **dropped without any error**; on the `dev` branch it is
   `fee_thresholds: BoundedVec<(ComputeType, u128), 8>`, which the SDK cannot express.
   Either way, a threshold passed to `joinGuardian` today does not reach the chain. Fix
   `spec.ts` and `GuardianJoinPrefs` together, against the runtime you actually target.

   The general rule this illustrates: **entries in `spec.ts` that duplicate a metadata type
   are inert** — metadata wins for everything it describes. Only types reached by *name*
   (custom RPCs in `API_RPC`, signed extensions in `API_EXTENSIONS`) are load-bearing.

2. **`MillisecondsPerBlock` is not in metadata.** It is a plain `Get<u64>` on
   `pallet_compute::Config`, not a `#[pallet::constant]`, so `api.consts.compute` does not
   expose it. `getFeeParams()` reads `babe.expectedBlockTime` instead — the runtime wires
   both to the same `MILLISECS_PER_BLOCK`. Adding `#[pallet::constant]` would make this
   exact rather than inferred.

3. **The orchestrator assumes 6000ms blocks.** `computeMaxRunningTimeSecs` in
   `orchestrator/src/chain.ts` hard-codes `blockTimeMs = 6000`, while the runtime's
   `MILLISECS_PER_BLOCK` is `500`. Treat its running-time estimates as unreliable.

4. **`scripts/test-compute-result.mjs` is stale.** It calls `compute.result` with three
   arguments; the extrinsic now takes five.

5. **`StoreType` variant indices disagree.** The chain defines five variants
   (`Dataset, Model, Agent, Executable, Other`); `spec.ts` registers four, omitting
   `Executable`. So `storeType: "Other"` encodes as index 3 and the chain reads it back as
   `Executable`. Only affects callers passing `"Other"` — `uploadData` maps to
   `Dataset`/`Model`/`Agent`, which are unaffected.

6. **`ComputeInfo` has fields the SDK helpers omit.** `program_env` and `metadata` exist
   on the chain struct but are not set by `simpleCompute`, `inferenceCompute` or
   `dataContract`. Supply them explicitly if you need them.

---

## 7. The `ComputePayload` signer option

Several SDK calls pass an `opts` object into `signAndSend` that is neither a normal
extrinsic argument nor a standard signer option:

```ts
{ compute: { daType: 1, verification: 0, compute: 1 } }
```

This is `ComputePayload`, extra data carried by the `CheckCompute` **signed extension** —
it travels with the transaction and is validated before dispatch. `CheckCompute` requires
it to be *default/empty* for every call except an allowlist: `dataAvailability.submitData`,
`compute.agreement`, `compute.result`, `compute.invoke`, and
`guardSession.agreementResponse`. Attaching a non-default payload to any other call is
rejected as `ForbiddenCompute`.

| Field | Meaning |
|---|---|
| `daType` | `0` none, `1` DA, `4` compute request |
| `compute` | `0` dormant, `1` active |
| `verification` | Verification mode |
| `agreement` | 32-byte guardian peer keys (base58-decode the peer ID, drop the first 6 bytes) |

The SDK sets this for you in `createAgreement`, `submitData` and the encrypted-inference
helpers. You need to construct one by hand only when calling `api.tx` directly.

---

## 8. Failure reference

| Symptom | Cause |
|---|---|
| `InsufficientFreeBalance` | `fees` below the floor (§2.2), or free balance below `fees`. Call `estimateMinFee`. |
| `ZeroComputeRate` | `computeRate` is 0 on an `Active`/`Subscription` contract. Only `Dormant` may be 0. |
| `AgreementFailed` event, nothing reserved | A guardian rejected the offer — `computeRate` under its threshold (§2.4). |
| `ForbiddenCompute` | Non-default `ComputePayload` on a call not in the allowlist (§7). |
| `Invalid: Custom(149)` | `guardians` is empty while `compute.program` is not `"Null"` (§3.2). |
| `Invalid: Custom(145)` | Duplicate entries in `guardians` (§3.2). |
| `Invalid: Custom(148)` | A named guardian is not registered/staked (§3.2). |
| Opaque decode failure on `agreement` | Wrong field shape — snake_case keys, or a missing enum payload (§3). |
| `ComputeDurationTooLarge` | Reported duration exceeds `(elapsed_blocks + 4) × block_ms` (§5). |
| `InvalidContractType` | `invoke` called on a non-`Subscription` contract. |
| `ContractSettled` | Contract already settled — budget exhausted or deadline passed. |
| `AgreementNotFound` | Unknown contract ID, or a `Subscription` with no settlement record. |
| `ContractExpired` | Past the contract deadline. |
| `invoke` returns Ok but nothing runs | Deadline or budget check settled the contract instead (§3.6). |
| `compute.agreement` hangs, never included, no error | A named guardian has not submitted its `agreement_response`; the tx is parked in the future queue (§2.1). |
| Group info cannot be found | No on-chain storage for groups; you need the creation block+index (§4.3). |
| API disconnects mid-flow | `getGuardianParticipants` disconnects the shared API on exit (§4.1). |

---

## 9. Conventions

- **Amounts.** PALI has 18 decimals. `Fee.amount` and `Fee.computeRate` take *human* PALI
  values (`"1.5"`); `buildFee` converts via `toAtomicPaliAmount`. Everything read back off
  the chain is in atomic units — convert with `fromAtomicPaliAmount`.
- **`computeRate` is per millisecond**, not per block or per second.
- **`deadline: 0` means no deadline.**
- **`computerIndices`** indexes into `contract.guardians`, as does `Trusted { trust_index }`.
- **Finality.** `signAndSend` resolves at in-block by default; set
  `TX_WAIT_FINALIZATION=true` to wait for finalization.
- **Currency.** `currencyId` defaults to `"Native"`; the deposit is reserved in and settled
  from that currency.
