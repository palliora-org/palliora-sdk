import { waitReady } from "@polkadot/wasm-crypto";
import { AccountSourceType, CryptoType } from "./types";
import { Keyring } from "@polkadot/api";
import { hexToU8a } from "@polkadot/util";
import { ed25519PairFromSecret, secp256k1PairFromSeed } from "@polkadot/util-crypto";
import type { KeyringPair } from "@polkadot/keyring/types";

/**
 * Creates a Substrate account from a private key, seed, or mnemonic.
 * @param input - The input string (private key hex, seed hex, or mnemonic phrase).
 * @param type - The type of input: 'privateKey', 'seed', or 'mnemonic'.
 * @param cryptoType - The crypto type: 'sr25519' | 'ed25519' | 'ecdsa' (default: 'sr25519').
 * @returns The keypair object.
 */
export async function createAccount(
  input: string,
  type: AccountSourceType,
  name: string = "default",
  cryptoType: CryptoType = CryptoType.SR25519
): Promise<KeyringPair> {
  await waitReady();
  const keyring = new Keyring({ type: cryptoType });

  switch (type) {
    case AccountSourceType.PRIVATE_KEY: {
      const pair = pairFromPrivateKeyHex(input, cryptoType);
      return keyring.addFromPair(pair, { name }, cryptoType);
    }
    case AccountSourceType.SEED: {
      const seed = hexToU8a(input);

      if (seed.length !== 32) {
        throw new Error(
          `Invalid ${cryptoType} seed length. Expected 32 bytes, got ${seed.length}`
        );
      }

      return keyring.addFromSeed(seed, { name }, cryptoType);
    }
    case AccountSourceType.MNEMONIC:
      // format: <mnemonic or mini-secret>[//hard-derivation][/soft-derivation][///password]
      // refer docs: https://polkadot.js.org/docs/keyring/start/suri/
      return keyring.createFromUri(input, { name }, cryptoType);
    case AccountSourceType.ADDRESS:
      const account = keyring.addFromAddress(
        input,
        { name },
        null,
        cryptoType
      );
      return account;
    default:
      throw new Error("Invalid input type");
  }
}

export function pairFromPrivateKeyHex(privateKeyHex: string, cryptoType: CryptoType) {
  const privateKey = hexToU8a(privateKeyHex);

  switch (cryptoType) {
    case CryptoType.ED25519:
      if (privateKey.length !== 64) {
        throw new Error(
          `Invalid ed25519 private key length. Expected 64 bytes, got ${privateKey.length}`
        );
      }
      return ed25519PairFromSecret(privateKey);
    case CryptoType.ECDSA:
      if (privateKey.length !== 32) {
        throw new Error(
          `Invalid ecdsa private key length. Expected 32 bytes, got ${privateKey.length}`
        );
      }
      return secp256k1PairFromSeed(privateKey);
    case CryptoType.SR25519:
      if (privateKey.length !== 96) {
        throw new Error(
          `Invalid sr25519 private key length. Expected 96 bytes (secret+public), got ${privateKey.length}`
        );
      }
      return {
        secretKey: privateKey.slice(0, 64),
        publicKey: privateKey.slice(64, 96),
      };
    default:
      throw new Error(`Unsupported crypto type: ${cryptoType}`);
  }
}
