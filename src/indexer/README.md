# Indexer Client — `src/indexer/`

A fully typed TypeScript wrapper for the **@statescan/indexer** REST API, providing programmatic access to on-chain indexed data from the Palliora network.

## What it does

The indexer server is a read-only Koa REST API (default port `5020`) that serves blockchain data from MongoDB. This module wraps those GET endpoints into typed async functions you can call from any JavaScript/TypeScript app.

You get:

- **`IndexerClient`** — configurable HTTP client (base URL, custom fetch)
- **REST wrappers** — one function per indexer endpoint
- **UI helpers** — `storeType` filters, contract/artefact flow assemblers, guardian identity helpers
- **TypeScript types** — queries, documents, and response envelopes
- **`IndexerHttpError`** — structured errors with HTTP status codes

## Install

Ships as part of `@palliora.org/chainsdk`:

```bash
pnpm add @palliora.org/chainsdk
```

No extra dependencies — uses native `fetch` (Node.js 18+).

## Quick start

```ts
import {
  IndexerClient,
  getBlocks,
  getContracts,
  getModels,
  getAgents,
  getExtrinsics,
  getContractFlow,
} from "@palliora.org/chainsdk";

const client = new IndexerClient({ baseUrl: "http://localhost:5020" });

// Latest blocks — response is { blocks, stats }
const { data: blocksData } = await getBlocks(client, { page: 0, page_size: 5 });
console.log(blocksData.blocks[0]?.height, blocksData.stats);

// Paginated contracts
const { data: contracts, total } = await getContracts(client, { page: 0, page_size: 10 });
console.log(`${total} contracts`);

// UI category tabs (filter by storeType)
const { data: models } = await getModels(client);
const { data: agents } = await getAgents(client);

// Signed transactions
const { data: txs } = await getExtrinsics(client, { page: 0, page_size: 25, signed_only: true });

// Contract detail lifecycle for the explorer
const { data: flow } = await getContractFlow(client, contracts[0].contractId);
console.log(flow.status, flow.phases.map((p) => p.title));
```

## Configuration

### `IndexerClient`

| Option | Type | Default | Description |
|---|---|---|---|
| `baseUrl` | `string` | `http://localhost:5020` | Indexer host only — **do not** append `/api` |
| `fetch` | `typeof fetch` | `globalThis.fetch` | Custom fetch (tests / polyfills) |

```ts
const client = new IndexerClient(); // http://localhost:5020
const client = new IndexerClient({ baseUrl: "https://indexer.palliora.org" });
```

> Paths already include `/api/...`. If you pass `baseUrl: ".../api"`, the client strips the trailing `/api` so you do not hit `/api/api/...` (404).

## Complete API reference

Every function takes an `IndexerClient` as the first argument.

### Artefacts + storeType helpers

| Function | Endpoint / behavior | Returns |
|---|---|---|
| `getArtefacts(client, query?)` | `GET /api/artefacts` | `SuccessResponse<ArtefactDocument[]>` |
| `getArtefactsByStoreType(client, storeType)` | fetch all + client filter | `SuccessResponse<ArtefactDocument[]>` |
| `getDatasets(client)` | `storeType === "Dataset"` | `SuccessResponse<ArtefactDocument[]>` |
| `getModels(client)` | `storeType === "Model"` | `SuccessResponse<ArtefactDocument[]>` |
| `getAgents(client)` | `storeType === "Agent"` | `SuccessResponse<ArtefactDocument[]>` |
| `getExecutables(client)` | `storeType === "Executable"` | `SuccessResponse<ArtefactDocument[]>` |
| `getArtefact(client, id)` | `GET /api/artefact/:id` | `SuccessResponse<ArtefactDocument>` |
| `getArtefactAccess(client, id, query?)` | `GET /api/artefact/:id/access` | `SuccessResponse<unknown[]>` |
| `getArtefactContracts(client, id, query?)` | `GET /api/artefact/:id/contracts` | `SuccessResponse<unknown[]>` |

`StoreType` values: `"Dataset" | "Model" | "Agent" | "Executable" | "Other"`.

```ts
const { data: models } = await getModels(client);
const { data: other } = await getArtefactsByStoreType(client, "Other");
```

### Contracts + flow

| Function | Endpoint / behavior | Returns |
|---|---|---|
| `getContracts(client, query?)` | `GET /api/contracts` | `PaginatedResponse<ContractDocument>` |
| `getContract(client, id)` | `GET /api/contract/:id` | `SuccessResponse<ContractDocument>` |
| `getCompute(client, id)` | `GET /api/compute/:id` | `SuccessResponse<ComputeDocument>` |
| `getContractFlow(client, id)` | contract + compute + phases | `SuccessResponse<ContractFlow>` |
| `deriveContractStatus(agreement, compute)` | pure helper | `"PENDING" \| "ACCEPTED" \| "PROCESSING" \| "COMPLETED" \| "—"` |
| `buildContractPhases(agreement, compute)` | pure helper | `ContractFlowPhase[]` |

```ts
const { data: flow } = await getContractFlow(client, "0xabc...");
// flow.agreement, flow.compute, flow.status, flow.phases (4 UI phases)
```

### Artefact flow

| Function | Behavior | Returns |
|---|---|---|
| `getArtefactFlow(client, id, accessQuery?)` | artefact + access + blobs | `SuccessResponse<ArtefactFlow>` |

Missing access (`404`) becomes `[]`. Missing blobs are skipped.

### Blocks

| Function | Endpoint | Returns |
|---|---|---|
| `getBlocks(client, query?)` | `GET /api/blocks` | `SuccessResponse<BlocksData>` |

```ts
const { data } = await getBlocks(client, { page: 0, page_size: 5 });
// data.blocks: BlockDocument[]
// data.stats: chain stats object
```

### Calls

| Function | Endpoint | Returns |
|---|---|---|
| `getCall(client, query)` | `GET /api/call` | `SuccessResponse<CallDocument>` |
| `getCallMetadata(client, query)` | `GET /api/call-metadata` | `SuccessResponse<CallMetadataDocument>` |
| `getCallArgs(client, query)` | `GET /api/call-args` | `SuccessResponse<CallArgsDocument>` |

`getCall` / `getCallMetadata` require `blockHeight` + `extrinsicIndex`.  
`getCallArgs` requires `metadataHash`.

### Transfers

| Function | Endpoint | Returns |
|---|---|---|
| `getTransfers(client, query?)` | `GET /api/transfers` | `SuccessResponse<TransferDocument[]>` |

### Extrinsics (transactions)

| Function | Endpoint | Returns |
|---|---|---|
| `getExtrinsics(client, query?)` | `GET /api/extrinsics` | `PaginatedResponse<ExtrinsicDocument>` |
| `getExtrinsic(client, indexOrHash)` | `GET /api/extrinsic/:indexOrHash` | `SuccessResponse<ExtrinsicDocument>` |

```ts
// page default 0, page_size default 10 (max 100)
const { data, total } = await getExtrinsics(client, {
  page: 0,
  page_size: 25,
  signed_only: true,
});

// By height-index or tx hash
await getExtrinsic(client, "2528092-2");
await getExtrinsic(client, "0x8699070554e60992...");
```

Errors: `400` invalid id format, `404` not found.  
Indexer excludes `nonce`, `_id`, `tip`, `signature` from responses.

### Addresses

| Function | Endpoint | Returns |
|---|---|---|
| `getAddresses(client)` | `GET /api/addresses` | `AddressDocument[]` (raw array) |
| `getAddress(client, address)` | `GET /api/address/:address` | `DataOnlyResponse<AddressDocument>` |

### Blobs

| Function | Endpoint | Returns |
|---|---|---|
| `getBlob(client, id)` | `GET /api/blob/:id` | `SuccessResponse<BlobDocument>` |

`:id` is a block height (integer).

### Guardians

| Function | Endpoint / behavior | Returns |
|---|---|---|
| `getGuardianGroups(client, query?)` | `GET /api/guardian-groups` | `SuccessResponse<GuardianGroupDocument[]>` |
| `getGuardianGroup(client, id)` | `GET /api/guardian-group/:id` | `SuccessResponse<GuardianGroupDocument>` |
| `getGuardians(client)` | derived from groups (unique accounts) | `SuccessResponse<GuardianDocument[]>` |
| `getGuardian(client, account)` | groups filtered by guardian | `SuccessResponse<GuardianDocument>` |

```ts
const { data: groups } = await getGuardianGroups(client);
// group.guardians: string[]
// group.guardianNames: (string | null)[]  — parallel identity names

const { data: guardians } = await getGuardians(client);
// [{ account, displayName }]

const { data: one } = await getGuardian(client, "5F...");
```

### Access (legacy)

| Function | Endpoint | Returns |
|---|---|---|
| `getAccess(client, query?)` | `GET /api/access` | `AccessResponse<AccessDocument>` |

Deprecated — prefer `getArtefactAccess`.

## Error handling

```ts
import { IndexerHttpError } from "@palliora.org/chainsdk";

try {
  await getArtefact(client, "nonexistent");
} catch (err) {
  if (err instanceof IndexerHttpError) {
    console.error(`HTTP ${err.statusCode}: ${err.message}`);
  }
}
```

## Response shapes

| Shape | Type | Used by |
|---|---|---|
| `{ success: true, data: T }` | `SuccessResponse<T>` | Most endpoints |
| `{ success: true, data: T[], total }` | `PaginatedResponse<T>` | `getContracts`, `getExtrinsics` |
| `{ success: true, data: T[], message }` | `AccessResponse<T>` | `getAccess` |
| `{ success: true, data: { blocks, stats } }` | `SuccessResponse<BlocksData>` | `getBlocks` |
| Raw array | `T[]` | `getAddresses` |
| `{ data: T }` | `DataOnlyResponse<T>` | `getAddress` |

## Testing

```bash
pnpm test                 # unit tests (mocked fetch)
pnpm test:integration     # live HTTP against INDEXER_URL or localhost:5020
pnpm test:indexer         # unit tests under test/indexer/
```

## File structure

```
src/indexer/
├── index.ts        # Barrel re-exports
├── client.ts       # IndexerClient + IndexerHttpError
├── types.ts        # Shared types
├── artefacts.ts    # artefacts + storeType helpers
├── contracts.ts    # contracts + compute
├── flow.ts         # getContractFlow, getArtefactFlow, phase helpers
├── blocks.ts       # getBlocks
├── calls.ts        # getCall, getCallMetadata, getCallArgs
├── transfers.ts    # getTransfers
├── extrinsics.ts   # getExtrinsics, getExtrinsic
├── addresses.ts    # getAddresses, getAddress
├── blobs.ts        # getBlob
├── guardians.ts    # groups + getGuardians / getGuardian
├── access.ts       # legacy getAccess
├── README.md
└── AGENTS.md
```
