> **Building a compute application? Read [CHAIN-RULES.md](CHAIN-RULES.md) first.**
> This README covers *which function to call*. CHAIN-RULES.md covers what the chain does
> with the call — the fee floor, guardian rate thresholds, contract lifecycles, guardian
> groups, and why a correctly-shaped transaction still gets rejected. None of that is
> visible from the TypeScript signatures.

## What this SDK provides

- API initialization helpers for Palliora.
- Keyring helpers for regular signing keys and encryption-oriented keys.
- Wrapper functions for Palliora-specific RPC calls and extrinsics, especially in `guardian/`, `da/`, `compute/`, and `stake/`.
- **Indexer client** (`src/indexer/`) — typed read-only REST wrappers for `@statescan/indexer` (blocks, contracts, artefacts, extrinsics, transfers, guardians, and UI flow helpers).
- Utility helpers for token formatting.
- Crypto helpers for threshold-encryption-adjacent and hybrid encryption workflows.

## Install

```bash
pnpm add @palliora.org/chainsdk
```

Node.js 18+ is expected.

## Releases

Merging a pull request into `main` publishes a new npm version through GitHub
Actions using npm trusted publishing (OIDC); it does not use an npm token. Add
exactly one of these labels to the merged pull request to select the version:
`patch`, `minor`, `major`, or `version:x.y.z`. The **Publish package to npm**
workflow can also be run manually from `main`, with a patch, minor, major, or
custom version.

Before the first release, configure npm's trusted publisher for
`@palliora.org/chainsdk` with GitHub organization `palliora-org`, repository
`palliora-sdk`, and workflow filename `publish-npm.yml` (not its path). Permit
the trusted publisher to run `npm publish` directly.

## Configuration

The SDK reads no environment variables. Call `init()` once, before any other SDK
function, and pass every value your application needs:

```ts
import { init } from "@palliora.org/chainsdk";

init({
	pallioraWs: "wss://manas-rpc.palliora.org",
	debug: true,
});
```

Where those values come from — `process.env`, `import.meta.env`, a config file, a
secrets manager — is the host application's decision.

| Option | Required | Purpose |
|---|---|---|
| `pallioraWs` | yes | WebSocket endpoint for the chain API connection |
| `pallioraRpcUrl` | yes | RPC endpoint, when it differs from `pallioraWs` |
| `costEstimatorUrl` | yes | Base URL of the cost-estimation service |
| `authServiceUrl` | yes | Base URL of the auth service issuing S3 pre-signed URLs |
| `awsRegion` | yes | AWS region of the artifact storage bucket |
| `awsS3Bucket` | yes | Name of the artifact storage bucket |
| `debug` | no (`false`) | Enables debug logging in wrapper helpers |
| `txWaitFinalization` | no (`false`) | Waits for finalization instead of returning once the tx is in-block |

Required options are required *lazily*: each one throws only when something
actually reads it. An application that never touches off-chain storage does not
need to pass the AWS options, but reading an unset option always throws rather
than silently falling back to a default.

```ts
init({ pallioraWs: "wss://manas-rpc.palliora.org" });
await getApi();          // fine
await uploadContract();  // throws: config "authServiceUrl" is not set
```

`init()` merges on repeat calls, so configuration can be supplied in stages.

## Quick start

The most common flow is:

1. Call `init()` with your configuration.
2. Load or create a signing account from the keyring.
3. Fetch token metadata once.
4. Call the wrapper functions you need.

```ts
import {
	init,
	getKeyring,
	fetchTokenProperties,
	formatBalanceWithTokenProperties,
	getGuardianList,
	submitData,
	newStake,
	transfer,
} from "@palliora.org/chainsdk";

async function main() {
	init({ pallioraWs: "wss://manas-rpc.palliora.org" });

	const keyring = await getKeyring();
    const amount = BigInt("1000000000000000000000"); // 1000 PALI

	// The SDK adds a default //Bob dev account. For real use, add your own signer.
	const account = keyring.addFromUri("//Alice");

    const token = await fetchTokenProperties();
	console.log("Token:", token.symbol, token.decimals);
	console.log(
		"Formatted sample balance:",
		await formatBalanceWithTokenProperties(amount.toString()),
	);

	const guardians = await getGuardianList();
	console.log("Active guardians:", guardians);

	await submitData(account, "hello from chainsdk");
	await newStake(account, amount);
	await transfer(account, amount, "5F3sa2TJAWMqDhXG6jhV4N8ko9qQ7x7T9nM8uA8V2sR8hF4M");
}

main().catch(console.error);
```

## API and keystore initialization

Use these when you want a broader integration and may combine SDK wrappers with direct RPC calls.

### Default initialization

```ts
import { init, getApi, getKeyring } from "@palliora.org/chainsdk";

init({ pallioraWs: "wss://manas-rpc.palliora.org" });

const api = await getApi();
const keyring = await getKeyring();

const signer = keyring.addFromUri("//Alice");
```

- `init(options)` configures the SDK. Nothing else works until it has run.
- `getApi()` returns the shared `ApiPromise` instance. It throws if `init()` was
  never called or was called without `pallioraWs`.
- `getKeyring()` returns the shared `sr25519` keyring for signing. It needs no
  configuration.

## Wrapper calls

The wrappers can be called directly once the API is initialized. Transaction wrappers expect a signer account. Read-only RPC wrappers only need the API connection.

### Guardian

```ts
import {
	getGuardianList,
	createGuardianGroup,
	joinGuardian,
} from "@palliora.org/chainsdk";

const guardians = await getGuardianList();

await createGuardianGroup(account, guardians.slice(0, 3));

await joinGuardian(account, {
	standard: true,
	verifier: true,
	compute: "trusted,tee",
	// Minimum rate to take work at, in atomic units. A single amount prices every
	// compute type above; pass a record to price them separately. Omit to accept
	// any rate.
	fee: { trusted: 1_000_000_000_000_000_000n, tee: 2_500_000_000_000_000_000n },
});
```

Main guardian exports:

- `getGuardianList()`
- `createGuardianGroup(account, selectedGuardians)`
- `joinGuardian(account, prefs)`

### Data availability

```ts
import { submitData } from "@palliora.org/chainsdk";

await submitData(account, "payload to store on Palliora DA");
```

Main DA export:

- `submitData(account, data)`

### Compute

Before offering a fee, check the floor the chain enforces — see
[CHAIN-RULES.md §2](CHAIN-RULES.md) for what the components mean.

```ts
import {
	createAgreement,
	estimateMinFee,
	buildFee,
	fromAtomicPaliAmount,
	getGuardianList,
} from "@palliora.org/chainsdk";

const guardians = (await getGuardianList()).slice(0, 3);
const computeRate = "0.000000001";

// The smallest `fees` this contract may offer. Offer more to buy more compute time.
const { minFee } = await estimateMinFee({ computeRate });

await createAgreement(
	{
		contractType: "Active",
		guardians,
		compute: {
			cipher: "Plaintext",
			computerIndices: guardians.map((_, i) => i),
			...buildFee({ amount: fromAtomicPaliAmount(minFee), computeRate }),
			deadline: 0,
			confidentiality: { Trusted: 0 },
			feeFunction: null,
			input: { Inline: { data: [...new TextEncoder().encode("hello")] } },
			program: { NativeExecute: "Inference" },
		},
		resultCipher: "Plaintext",
	},
	account,
);
```

Main compute exports:

- `createAgreement(contract, account, oracleQuoteId?)`
- `invokeAgreement(agreementId, input, account, opts?)` — `Subscription` contracts only
- `estimateMinFee({ computeRate, inputContractId? })` — the fee floor plus its breakdown
- `getFeeParams()` — the four live chain parameters the floor derives from
- `inferenceCompute`, `simpleCompute`, `dataContract`, `encryptedInferenceCompute`

### Stake

```ts
import {
	newStake,
	addStake,
	reduceStake,
	payoutStake,
	removeStake,
	withdrawStake,
	tokenToBigint,
} from "@palliora.org/chainsdk";

const amount = tokenToBigint(100);

await newStake(account, amount, "Staked");
await addStake(account, amount);
await reduceStake(account, tokenToBigint(25));
await payoutStake(account, [123, 124]);
await removeStake(account);
await withdrawStake(account);
```

Main stake exports:

- `newStake(account, amount, rewardDestination?)`
- `addStake(account, amount)`
- `reduceStake(account, amount)`
- `removeStake(account)`
- `withdrawStake(account)`
- `payoutStake(account, eras)`
- `joinIdleStaker(account, prefs)`

### Token

```ts
import { fundAccount, transfer, tokenToBigint } from "@palliora.org/chainsdk";

await fundAccount(account, tokenToBigint(50));
await transfer(account, tokenToBigint(10), "5F3sa2TJAWMqDhXG6jhV4N8ko9qQ7x7T9nM8uA8V2sR8hF4M");
```

Main token exports:

- `fundAccount(account, amount, address?)`
- `transfer(account, amount, address)`

## Useful helpers

### Chain helpers

- `signAndSend(tx, account)`
- `getGuardianAddress()`
- `setIdentity(account, { display })`
- `joinValidator(account, commission)`

### Utility helpers

- `tokenToBigint(value)`
- `hexToUint8Array(hex)`
- `decodeField(base64, expectedLength?)`
- `generateRandomBytes(length?)`

### Crypto helpers

The crypto module contains small helper functions for hybrid encryption flows and lower-level threshold-encryption-related work.

```ts
import {
	gen_shared_key,
	gen_stretched_key,
	encrypt,
	decrypt,
} from "@palliora.org/chainsdk";

const shared = gen_shared_key(mySecretKeyBytes, peerPublicKeyBytes);
const key = gen_stretched_key(shared);

const message = new TextEncoder().encode("hello");
const sealed = encrypt(message, key);
const opened = decrypt(sealed.ciphertext, key, sealed.nonce);
```

Main crypto exports:

- `gen_shared_key(key, pk)`
- `gen_stretched_key(input)`
- `encrypt(plaintext, key)`
- `decrypt(ciphertext, key, nonce)`
- `generateRandomBytes(length?)`

## Indexer (read-only chain data)

For explorer/UI reads against the `@statescan/indexer` REST API (default `http://localhost:5020`):

```ts
import {
  IndexerClient,
  getBlocks,
  getModels,
  getAgents,
  getExtrinsics,
  getResults,
  getContractFlow,
  getArtefactContracts,
} from "@palliora.org/chainsdk";

const client = new IndexerClient({ baseUrl: "http://localhost:5020" });
// Do not put /api in baseUrl — paths already include /api/...

const { data: blocks } = await getBlocks(client, { page: 0, page_size: 5 });
console.log(blocks.blocks, blocks.stats);

const { data: models } = await getModels(client);   // storeType === "Model"
const { data: agents } = await getAgents(client);   // storeType === "Agent"

const { data: txs } = await getExtrinsics(client, { signed_only: true });
const { data: results } = await getResults(client, { contractId: "0x..." });
const { data: flow } = await getContractFlow(client, "0xcontractId...");
// flow.computes, flow.results, flow.phases (phase-1 … phase-5)

const { data: usages } = await getArtefactContracts(client, "0xartefactId...");
```

Full API, response shapes, and agent integration notes:

- [`src/indexer/README.md`](src/indexer/README.md) — overview + complete function tables
- [`src/indexer/AGENTS.md`](src/indexer/AGENTS.md) — detailed integration guide for AI agents

```bash
pnpm test                 # unit tests
pnpm test:integration     # live HTTP against local indexer
```

## Choosing between raw API and wrappers

Use the wrappers when:

- You want the simplest way to call Palliora-specific RPCs or extrinsics.
- The SDK already exposes some of the operations.

Use `getApi()` and the keyring helpers when:

- You need custom query logic beyond the shipped wrappers.
- You want to mix Palliora wrappers with direct RPC calls.
- Most transaction helpers expect an `account` compatible with RPC `signAndSend`.
