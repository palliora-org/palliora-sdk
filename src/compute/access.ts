import type { KeyringPair } from "@polkadot/keyring/types";
import { createAgreement, buildFee, buildComputeMetadata } from "../compute";
import { encrypt, gen_stretched_key, testCrypt } from "../crypto";
import { assert, hexToUint8Array, type Hex } from "../utils";
import type { Fee } from "../chain/types";
import type { GuardianGroupInfo } from "../da/types";
import type { ComputeMetadataInput } from "./agreement";

/** A 12-byte all-zero nonce. Result ciphers carry one only as a placeholder — see below. */
const PLACEHOLDER_NONCE = new Array(12).fill(0);

/**
 * Strips a leading `0x`.
 *
 * `GuardianGroupInfo` carries `0x`-prefixed hex, because its fields come from `.toHex()` on
 * decoded extrinsic args. Both `testCrypt` and {@link hexToUint8Array} want the prefix gone:
 * the former validates against `/^[0-9A-Fa-f]*$/` and rejects the `x`, the latter parses from
 * index 0 and would read the prefix as data.
 */
function bareHex(hex: string): Hex {
  return (hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex) as Hex;
}

/**
 * A `ThresholdHybrid` cipher and the ciphertext it describes.
 *
 * `sharedKey` is the symmetric key the payload was encrypted under. It is returned for tests
 * and for a publisher that wants to keep its own copy; it is never put on chain, and the
 * guardian set reconstructs it from `cipher` when a contract asks them to.
 */
export interface ThresholdEncryption {
  cipher: Record<string, unknown>;
  input: { Inline: { data: number[] } };
  sharedKey: Uint8Array;
}

/**
 * Encrypts `payload` to a guardian group under `ThresholdHybrid`/`SilentThreshold`.
 *
 * The group's aggregate key encapsulates a fresh symmetric key, which encrypts the payload
 * with ChaCha20-Poly1305. What goes on chain is the encapsulation (`tdParams`), the group's
 * public keys (`pkBytes`), its KZG parameters (`tauParams`), and the nonce — everything the
 * guardian set needs to reconstruct the key, and nothing that identifies it on its own.
 */
export function encryptToGuardianGroup(
  guardianInfo: GuardianGroupInfo,
  payload: string | Uint8Array,
): ThresholdEncryption {
  const bytes =
    typeof payload === "string" ? new TextEncoder().encode(payload) : payload;

  const { encoded: tdParams, ikm } = testCrypt(
    bareHex(guardianInfo.tauParams),
    bareHex(guardianInfo.aggKey),
  );
  const sharedKey = gen_stretched_key(hexToUint8Array(bareHex(ikm)));
  const { ciphertext, nonce } = encrypt(bytes, sharedKey);

  return {
    cipher: {
      ThresholdHybrid: {
        thresholdParams: {
          SilentThreshold: {
            tdParams: Array.from(hexToUint8Array(bareHex(tdParams))),
            pkBytes: Array.from(hexToUint8Array(bareHex(guardianInfo.groupPk))),
            tauParams: Array.from(hexToUint8Array(bareHex(guardianInfo.tauParams))),
          },
        },
        symmetricParams: { ChaCha20Poly1305: { nonce: Array.from(nonce) } },
      },
    },
    input: { Inline: { data: Array.from(ciphertext) } },
    sharedKey,
  };
}

export interface EncryptedDataContractParams {
  /** Payload to encrypt and register. Strings are UTF-8 encoded. */
  data: string | Uint8Array;
  /** Guardian group whose aggregate key the payload is encrypted to. */
  guardianInfo: GuardianGroupInfo;
  /**
   * Guardian account IDs to name in the contract. Must be the group's own guardians: the
   * threshold round that later reconstructs the key runs over this list.
   */
  guardians: string[];
  /** Usage price charged to a contract that references this one. */
  fee: Fee;
  /** Describes the registered artifact. `groupId` defaults to the group's own id. */
  metadata?: ComputeMetadataInput;
  /** Block number deadline. Defaults to 0 (no deadline). */
  deadline?: number;
  /** Trusted guardian index in the guardians list. Defaults to 0. */
  trustIndex?: number;
}

/**
 * Registers a threshold-encrypted payload as a `Dormant` contract.
 *
 * The encrypted counterpart of {@link dataContract}: the artifact still lives in
 * `compute.input`, but as ciphertext, and `compute.cipher` carries the parameters that let the
 * guardian set — and only the guardian set — reconstruct the key.
 *
 * `agreement` records `blake2_256(tdParams ++ tauParams ++ pkBytes)` for this contract. That
 * commitment is what a later {@link accessContract} is checked against, so the parameters
 * written here are the ones an access request has to restate.
 *
 * Returns the usual receipt plus the `cipher` to restate and the `sharedKey`, so a caller
 * holding both can verify a grant end-to-end.
 */
export async function encryptedDataContract(
  params: EncryptedDataContractParams,
  account: KeyringPair,
) {
  assert(params.guardians.length > 0, "encryptedDataContract requires at least one guardian");

  const encrypted = encryptToGuardianGroup(params.guardianInfo, params.data);

  const contract = {
    contractType: "Dormant" as const,
    guardians: params.guardians,
    preCheck: null,
    compute: {
      cipher: encrypted.cipher,
      computerIndices: params.guardians.map((_, i) => i),
      ...buildFee(params.fee),
      deadline: params.deadline ?? 0,
      confidentiality: { Trusted: params.trustIndex ?? 0 },
      feeFunction: null,
      input: encrypted.input,
      program: { NativeData: "DaFalse" },
      metadata: buildComputeMetadata(
        params.metadata && {
          groupId: params.guardianInfo.groupId,
          ...params.metadata,
        },
      ),
    },
    postCheck: null,
    // The contract registers an artifact; it runs nothing and returns nothing.
    resultCipher: "Plaintext",
  };

  const receipt = await createAgreement(contract, account);
  return { ...receipt, cipher: encrypted.cipher, sharedKey: encrypted.sharedKey };
}

export interface AccessContractParams {
  /** Contract whose key is being requested. Must be an encrypted `Dormant` contract. */
  dataContractId: string;
  /**
   * That contract's `compute.cipher`, restated verbatim.
   *
   * Guardians run partial decryption over the cipher of the contract in front of them, never
   * over the one it references, so this is how the request reaches the right key. `agreement`
   * rejects a restatement that does not match the referenced contract's commitment.
   */
  cipher: Record<string, unknown>;
  /**
   * Ed25519 public key the granted key is wrapped to, as raw bytes.
   *
   * This becomes `resultCipher`, so the key travels back encrypted rather than in the clear.
   * The node that has to open it later must hold the matching private half.
   */
  recipientPublicKey: Uint8Array;
  /** Guardian account IDs — the group that holds shares for `cipher`. */
  guardians: string[];
  /**
   * Fee offered. The floor includes the referenced contract's usage price, so quote it with
   * `estimateMinFee({ computeRate, inputContractId: dataContractId })`.
   */
  fee: Fee;
  /** Describes the request. `storeType` is `"Other"`: a grant registers no artifact. */
  metadata?: ComputeMetadataInput;
  /** Block number deadline. Defaults to 0 (no deadline). */
  deadline?: number;
  /** Trusted guardian index in the guardians list. Defaults to 0. */
  trustIndex?: number;
}

/**
 * Requests access to a threshold-encrypted `Dormant` contract.
 *
 * Submits an `Active` contract whose program is the built-in
 * `{ NativeExecute: "ContractAccess" }`. Nothing executes: the guardians run their ordinary
 * threshold round over the restated cipher, hand the resulting key to their orchestrator, and
 * the orchestrator submits it as the result — wrapped to `recipientPublicKey`.
 *
 * The result of this contract is the grant. Point a later contract at it with
 * {@link buildAccessGrantEnv} to have that contract's encrypted input opened.
 */
export async function accessContract(params: AccessContractParams, account: KeyringPair) {
  assert(!!params.dataContractId, "accessContract requires a dataContractId");
  assert(
    params.recipientPublicKey.length === 32,
    `recipientPublicKey must be 32 bytes, got ${params.recipientPublicKey.length}`,
  );
  assert(params.guardians.length > 0, "accessContract requires at least one guardian");

  const contract = {
    contractType: "Active" as const,
    guardians: params.guardians,
    preCheck: null,
    compute: {
      cipher: params.cipher,
      computerIndices: params.guardians.map((_, i) => i),
      ...buildFee(params.fee),
      deadline: params.deadline ?? 0,
      confidentiality: { Trusted: params.trustIndex ?? 0 },
      feeFunction: null,
      programEnv: null,
      input: { ContractId: { id: params.dataContractId } },
      program: { NativeExecute: "ContractAccess" },
      metadata: buildComputeMetadata(params.metadata),
    },
    postCheck: null,
    resultCipher: {
      AsymmetricHybrid: {
        asymmetricParams: {
          Ed25519: {
            recipientPublicKey: Array.from(params.recipientPublicKey),
            ephemeralPublicKey: null,
            kdf: "HkdfSha256",
            salt: null,
            info: null,
          },
        },
        // A placeholder: the orchestrator picks a fresh nonce when it encrypts, and
        // `result_relay` patches that nonce into the cipher it submits with the result.
        symmetricParams: { ChaCha20Poly1305: { nonce: PLACEHOLDER_NONCE } },
      },
    },
  };

  return createAgreement(contract, account);
}

export interface AccessGrantRef {
  /** Contract id of the `accessContract` whose result carries the key. */
  contractId: string;
  /** Block holding that contract's `compute.result`. Lets the node skip a block scan. */
  blockNumber?: number;
  /** Index of that extrinsic within `blockNumber`. */
  extrinsicIndex?: number;
}

/**
 * Encodes a grant pointer for `compute.programEnv`.
 *
 * `programEnv` is free-form bytes on chain, and this is the shape the orchestrator looks for
 * when it finds an encrypted `ContractId` input it has no key for. Supplying `blockNumber` and
 * `extrinsicIndex` — which a requester that watched the grant land already knows — addresses
 * the result directly instead of making the node scan for it.
 */
export function buildAccessGrantEnv(ref: AccessGrantRef): number[] {
  assert(!!ref.contractId, "buildAccessGrantEnv requires a contractId");

  const payload = JSON.stringify({
    accessGrant: {
      contractId: ref.contractId,
      ...(ref.blockNumber !== undefined ? { blockNumber: ref.blockNumber } : {}),
      ...(ref.extrinsicIndex !== undefined ? { extrinsicIndex: ref.extrinsicIndex } : {}),
    },
  });

  return Array.from(new TextEncoder().encode(payload));
}
