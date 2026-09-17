# AGENTS.md — Palliora Indexer Client (`src/indexer/`)

Context for AI agents integrating or extending the `@palliora.org/chainsdk` indexer module.

---

## 1. What This Module Is

`src/indexer/` is a **typed HTTP client** for the `@statescan/indexer` REST API (read-only, default port `5020`). It ships inside `@palliora.org/chainsdk` and depends only on native `fetch` (Node.js 18+).

**Key exports:**

| Category | Exports |
|---|---|
| Client | `IndexerClient`, `IndexerHttpError`, `IndexerClientOptions` |
| Artefacts | `getArtefacts`, `getArtefact`, `getArtefactAccess`, `getArtefactContracts` |
| storeType UI helpers | `getArtefactsByStoreType`, `getDatasets`, `getModels`, `getAgents`, `getExecutables` |
| Contracts | `getContracts`, `getContract`, `getCompute` |
| Flow (explorer UI) | `getContractFlow`, `getArtefactFlow`, `deriveContractStatus`, `buildContractPhases` |
| Blocks / calls / transfers | `getBlocks`, `getCall`, `getCallMetadata`, `getCallArgs`, `getTransfers` |
| Extrinsics | `getExtrinsics`, `getExtrinsic` |
| Addresses / blobs | `getAddresses`, `getAddress`, `getBlob` |
| Guardians | `getGuardianGroups`, `getGuardianGroup`, `getGuardians`, `getGuardian` |
| Legacy | `getAccess` |

All public symbols are re-exported from the package root via `src/index.ts` → `./indexer`.

---

## 2. Installation

```bash
pnpm add @palliora.org/chainsdk
# or: npm install @palliora.org/chainsdk
```

Requires **Node.js 18+**. Dual-published ESM + CJS.

---

## 3. Step-by-Step Integration

### 3.1 Create a client

```ts
import { IndexerClient } from "@palliora.org/chainsdk";

const client = new IndexerClient({
  baseUrl: "http://localhost:5020", // host only — do NOT append /api
});
```

| Option | Type | Default | Purpose |
|---|---|---|---|
| `baseUrl` | `string` | `"http://localhost:5020"` | Indexer origin |
| `fetch` | `typeof fetch` | `globalThis.fetch` | Inject for tests / proxies |

**Important:** wrapper paths already start with `/api/...`. Passing `baseUrl: "http://host:5020/api"` would become `/api/api/...` and 404. The client strips a trailing `/api` (and trailing slashes) automatically.

### 3.2 Call patterns

Every REST wrapper: **first arg = `IndexerClient`**, then endpoint-specific args.

```ts
import {
  IndexerClient,
  getBlocks,
  getContracts,
  getModels,
  getAgents,
  getExtrinsics,
  getExtrinsic,
  getContractFlow,
  getArtefactFlow,
  getGuardians,
} from "@palliora.org/chainsdk";

const client = new IndexerClient({ baseUrl: "http://localhost:5020" });

// Blocks → { success, data: { blocks, stats } }
const blocks = await getBlocks(client, { page: 0, page_size: 5 });
blocks.data.blocks; // BlockDocument[]
blocks.data.stats;

// Contracts (paginated)
const contracts = await getContracts(client, { page: 0, page_size: 10 });
// contracts.data, contracts.total

// UI categories by storeType
const models = await getModels(client);
const agents = await getAgents(client);

// Extrinsics / transactions
const txs = await getExtrinsics(client, { page: 0, page_size: 25, signed_only: true });
const one = await getExtrinsic(client, "2528092-2");
// or: await getExtrinsic(client, "0xabc...64-char-hex");

// Explorer detail pages
const contractFlow = await getContractFlow(client, "0xcontractId...");
// contractFlow.data = { agreement, compute, status, phases }

const artefactFlow = await getArtefactFlow(client, "0xartefactId...");
// artefactFlow.data = { artefact, access, blobs }

const guardians = await getGuardians(client);
// [{ account, displayName }]
```

### 3.3 Handle errors

```ts
import { IndexerHttpError } from "@palliora.org/chainsdk";

try {
  await getArtefact(client, "missing");
} catch (err) {
  if (err instanceof IndexerHttpError) {
    // err.statusCode, err.message
  }
}
```

Non-JSON error bodies (plain `Not Found`) are also wrapped as `IndexerHttpError`.

---

## 4. Complete Function Reference

### Artefacts

```ts
getArtefacts(client, query?: { artefactType?, storeType? })
→ Promise<SuccessResponse<ArtefactDocument[]>>

// Client-side filter (preferred — indexer may ignore storeType query param)
getArtefactsByStoreType(client, storeType: StoreType)
getDatasets(client)       // "Dataset"
getModels(client)         // "Model"
getAgents(client)         // "Agent"
getExecutables(client)    // "Executable"
→ Promise<SuccessResponse<ArtefactDocument[]>>

getArtefact(client, id: string)
→ Promise<SuccessResponse<ArtefactDocument>>

getArtefactAccess(client, id, query?: { blockHeight?, extrinsicIndex?, retriver? })
getArtefactContracts(client, id, query?: { blockHeight?, extrinsicIndex?, retriver? })
→ Promise<SuccessResponse<unknown[]>>
```

`StoreType = "Dataset" | "Model" | "Agent" | "Executable" | "Other"`.

### Contracts + compute + flow

```ts
getContracts(client, query?: { page?, page_size? })
→ Promise<PaginatedResponse<ContractDocument>>

getContract(client, id) → Promise<SuccessResponse<ContractDocument>>
getCompute(client, id)  → Promise<SuccessResponse<ComputeDocument>>

// Assembles agreement + compute for explorer UI
getContractFlow(client, id)
→ Promise<SuccessResponse<ContractFlow>>
// ContractFlow = { agreement, compute, status, phases }
// status: "PENDING" | "ACCEPTED" | "PROCESSING" | "COMPLETED"
// phases: 4 ContractFlowPhase objects (agreement → compute → execution → fees)
// Missing compute (404) → compute: null, status PENDING/ACCEPTED

deriveContractStatus(agreement, compute)  // pure
buildContractPhases(agreement, compute)   // pure → ContractFlowPhase[]
```

### Artefact flow

```ts
getArtefactFlow(client, id, accessQuery?)
→ Promise<SuccessResponse<ArtefactFlow>>
// { artefact, access, blobs }
// access 404 → []; blob 404s skipped; blob heights taken from artefact.blobRefs
```

### Blocks

```ts
getBlocks(client, query?: { page?, page_size? })
→ Promise<SuccessResponse<BlocksData>>
// BlocksData = { blocks: BlockDocument[], stats?: Record<string, unknown> }
// BlockDocument uses height/hash/time (not indexer.blockHeight)
```

### Calls

```ts
getCall(client, { blockHeight, extrinsicIndex })           // both required
getCallMetadata(client, { blockHeight, extrinsicIndex })   // both required
getCallArgs(client, { metadataHash })                      // required
```

### Transfers

```ts
getTransfers(client, query?: { page?, page_size? })
→ Promise<SuccessResponse<TransferDocument[]>>
```

### Extrinsics

```ts
getExtrinsics(client, query?: {
  page?: number;          // default 0
  page_size?: number;     // default 10, max 100
  signed_only?: boolean | "true" | "false";
})
→ Promise<PaginatedResponse<ExtrinsicDocument>>
// boolean signed_only is serialized as "true"/"false" for the indexer

getExtrinsic(client, indexOrHash: string)
→ Promise<SuccessResponse<ExtrinsicDocument>>
// indexOrHash: "blockHeight-extrinsicIndex" OR "0x" + 64 hex chars
// Errors: 400 invalid format, 404 not found
```

### Addresses

```ts
getAddresses(client) → Promise<AddressDocument[]>              // raw array
getAddress(client, address) → Promise<DataOnlyResponse<AddressDocument>>  // { data } only
```

### Blobs

```ts
getBlob(client, id: number)  // id = block height
→ Promise<SuccessResponse<BlobDocument>>
```

### Guardians

```ts
getGuardianGroups(client, query?: { guardian?: string })
→ Promise<SuccessResponse<GuardianGroupDocument[]>>
// each group: guardians: string[], guardianNames: (string|null)[]

getGuardianGroup(client, id: string)
→ Promise<SuccessResponse<GuardianGroupDocument>>

// Derived helpers (no dedicated /api/guardians route)
getGuardians(client)
→ Promise<SuccessResponse<GuardianDocument[]>>  // unique { account, displayName }

getGuardian(client, account: string)
→ Promise<SuccessResponse<GuardianDocument>>
// groups 404 → empty / displayName null
```

### Access (legacy)

```ts
getAccess(client, query?: { blockHeight?, extrinsicIndex?, retriver? })
→ Promise<AccessResponse<AccessDocument>>
// Deprecated — use getArtefactAccess
```

---

## 5. Response Shape Reference

| Type | Shape | Used by |
|---|---|---|
| `SuccessResponse<T>` | `{ success: true, data: T }` | Most endpoints |
| `PaginatedResponse<T>` | `{ success: true, data: T[], total: number }` | `getContracts`, `getExtrinsics` |
| `SuccessResponse<BlocksData>` | `{ success: true, data: { blocks, stats } }` | `getBlocks` |
| `AccessResponse<T>` | `{ success: true, data: T[], message: string }` | `getAccess` |
| `DataOnlyResponse<T>` | `{ data: T }` | `getAddress` |
| Raw `T[]` | plain array | `getAddresses` |
| `IndexerHttpError` | thrown | any non-2xx |

---

## 6. Common Document Shapes

### `IndexerMeta`

```ts
interface IndexerMeta {
  blockHeight: number;
  blockHash: string;
  blockTime: number;       // ms
  extrinsicIndex: number;
  eventIndex: number;
}
```

### `ArtefactDocument`

```ts
interface ArtefactDocument {
  contractId: string;
  creator: string;
  owner: string;
  storeType: StoreType | string | null;  // Dataset | Model | Agent | Executable | Other
  contractType: string;
  groupId: string | null;
  name?: string | null;
  description?: string | null;
  blobRefs?: Array<[number, number] | unknown>;
  indexer: IndexerMeta;
}
```

### `ContractFlow` / `ArtefactFlow`

```ts
interface ContractFlow {
  agreement: ContractDocument;
  compute: ComputeDocument | null;
  status: "PENDING" | "ACCEPTED" | "PROCESSING" | "COMPLETED";
  phases: ContractFlowPhase[]; // phase-1 … phase-4
}

interface ArtefactFlow {
  artefact: ArtefactDocument;
  access: unknown[];
  blobs: BlobDocument[];
}
```

### `ExtrinsicDocument`

```ts
interface ExtrinsicDocument {
  indexer: { blockHeight: number; extrinsicIndex: number; /* … */ };
  hash: string;
  isSigned: boolean;
}
```

### `GuardianDocument`

```ts
interface GuardianDocument {
  account: string;
  displayName: string | null;
}
```

---

## 7. Patterns for UI / Agents

### Explorer dashboard

```ts
const [blocks, contracts, transfers, models, agents, txs] = await Promise.all([
  getBlocks(client, { page: 0, page_size: 10 }),
  getContracts(client, { page: 0, page_size: 10 }),
  getTransfers(client, { page: 0, page_size: 10 }),
  getModels(client),
  getAgents(client),
  getExtrinsics(client, { page: 0, page_size: 10, signed_only: true }),
]);

blocks.data.blocks;
contracts.total;
models.data;
txs.data;
```

### Category tabs (storeType)

```ts
const tabs = {
  datasets: await getDatasets(client),
  models: await getModels(client),
  agents: await getAgents(client),
  executables: await getExecutables(client),
};
```

### Contract detail page

```ts
const { data: flow } = await getContractFlow(client, contractId);
// Render flow.status + flow.phases[{ title, status, description, json, active, complete, pending }]
```

### Artefact / dataset detail page

```ts
const { data } = await getArtefactFlow(client, artefactId);
// data.artefact, data.access, data.blobs
```

### Transaction lookup

```ts
const list = await getExtrinsics(client, { page: 0, page_size: 1, signed_only: true });
const { blockHeight, extrinsicIndex } = list.data[0].indexer;
await getExtrinsic(client, `${blockHeight}-${extrinsicIndex}`);
await getExtrinsic(client, list.data[0].hash);
```

### Combine with chain SDK

```ts
import { IndexerClient, getContract, getBalance } from "@palliora.org/chainsdk";

const client = new IndexerClient({ baseUrl: "http://localhost:5020" });
const { data: contract } = await getContract(client, id);
const balance = await getBalance(contract.creator!);
```

---

## 8. Testing

### Unit tests (mocked fetch)

```bash
pnpm test
pnpm test:indexer
```

Inject `fetch` via `IndexerClient({ fetch: mockFetch })`. Mock responses should implement both `.text()` and `.json()` (client reads `.text()` then `JSON.parse`).

### Integration tests (live server)

```bash
pnpm test:integration
# optional: INDEXER_URL=http://localhost:5020 pnpm test:integration
```

Requires indexer running. Tests tolerate empty collections / undeployed routes by catching `IndexerHttpError` where appropriate.

---

## 9. Key Implementation Details

1. **GET-only, no auth.** Public read API.
2. **`baseUrl` is the origin.** Do not include `/api`. Trailing `/api` is stripped.
3. **Pagination:** `page` (0-indexed) + `page_size` (snake_case). Used by contracts, blocks, transfers, extrinsics.
4. **`getBlocks` shape:** `{ data: { blocks, stats } }` — not a bare array.
5. **`storeType` helpers** filter client-side after `GET /api/artefacts` (server query may be ignored).
6. **Extrinsic IDs:** `"height-index"` or `0x` + 64 hex. Invalid → 400; missing → 404.
7. **Non-standard envelopes:** `getAddresses` = raw array; `getAddress` = `{ data }` without `success`.
8. **Flow helpers** tolerate missing compute/access/blobs (404 → null / [] / skip).
9. **`getGuardians` / `getGuardian`** are derived from guardian-groups; there is no `/api/guardians` route.
10. **Errors:** always `IndexerHttpError` with `.statusCode` and `.message`.
11. **Path params** are `encodeURIComponent`-encoded.
12. **No I/O on construct** — each call is one (or more) HTTP requests.

---

## 10. Source Layout

```
src/indexer/
├── index.ts         # Public barrel
├── client.ts        # IndexerClient, IndexerHttpError
├── types.ts         # All shared types
├── artefacts.ts     # artefacts + storeType helpers
├── contracts.ts     # getContracts, getContract, getCompute
├── flow.ts          # getContractFlow, getArtefactFlow, derive/build helpers
├── blocks.ts
├── calls.ts
├── transfers.ts
├── extrinsics.ts
├── addresses.ts
├── blobs.ts
├── guardians.ts     # groups + getGuardians / getGuardian
├── access.ts        # legacy
├── README.md        # Human overview
└── AGENTS.md        # This file
```

Tests live under `test/indexer/` (`*.test.ts` + `integration.test.ts`).

---

## 11. Adding a New Endpoint

1. Add document + query types in `types.ts`.
2. Add `src/indexer/<domain>.ts` with `async function ...(client: IndexerClient, ...)`.
3. Re-export from `src/indexer/index.ts`.
4. Add unit tests in `test/indexer/` (use `mockClient` from `helpers.ts`).
5. Add/extend integration coverage in `test/indexer/integration.test.ts`.
6. Update `README.md` + this `AGENTS.md`.

For **UI-only aggregations** (like `getContractFlow` or `getModels`), prefer a helper in the SDK that composes existing endpoints rather than requiring a new indexer route.
