/**
 * Standalone test: submit a compute.result extrinsic directly to the chain.
 * Run with: npx tsx scripts/test-compute-result.ts
 * Requires .env with PRIVATE_KEY and PALLIORA_WS set.
 */
import 'dotenv/config';
import { CryptoType, getApi, getGuardianAddress, getKeyring, pairFromPrivateKeyHex, signAndSend } from '../dist/index.js';

// ── Hardcoded test inputs ─────────────────────────────────────────────────────

const REQUEST_ID = '0x3733d79aeb651bda1de96ed3ea0b1cf2d849c240d332bf5d7bf58310de3fe901';

// Simulated compute result bytes (arbitrary payload)
const RESULT_BYTES = [1, 2, 3, 4, 5, 6, 7, 8];

// The on-chain account that originally submitted the request
const SUBMITOR = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty'; // Alice (replace with real submitor)

// ── Chain opts (mirrors index.ts worker) ─────────────────────────────────────

const OPTS = {
  compute: {
    verification: 0,
    da_type: 8,
    compute: 0,
    fee: { compute: 0, guardian: 0, verifier: 0 },
  },
  nonce: 0, // will be updated from chain before signing
};

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🔌 Connecting to chain...');
  const API = await getApi();

  console.log('🔑 Initialising keyring...');
  const keyring = await getKeyring();
  const signer = keyring.getPairs()[0];
  console.log('   Signing account:', signer.address);

  // Fetch current on-chain nonce
  const accountInfo = (await API.query.system.account(signer.address)).toJSON();
  OPTS.nonce = accountInfo.nonce;
  console.log('   On-chain nonce:', OPTS.nonce);

  // Fetch guardians (same as production path)
  console.log('👥 Fetching guardian list...');
  const guardians = (await getGuardianAddress()).slice(0, 3).map((g) => g.address);
  console.log('   Guardians:', guardians);

  // Build contract identical to the worker in index.ts
  const computeStep = {
    cipher: 'Plaintext',
    computer_indices: guardians.map((_, i) => i),
    fees: 200,
    deadline: 0,
    confidentiality: {
      Trusted: {
        trust_index: 0,
      },
    },
    fee_function: null,
    input: {
      Inline: {
        data: RESULT_BYTES,
      },
    },
    program: null,
  };

  const contract = {
    contract_type: 'Dormant',
    guardians: guardians.slice(0, 3),
    pre_check: null,
    compute: computeStep,
    post_check: null,
    result_cipher: 'Plaintext',
  };

  console.log('\n📋 Submitting compute.result extrinsic');
  console.log('   request_id :', REQUEST_ID);
  console.log('   submitor   :', SUBMITOR);
  console.log('   result     :', RESULT_BYTES);
  console.log('   opts       :', JSON.stringify(OPTS));
  console.log('   contract   :', JSON.stringify(contract, null, 2));

  const request = API.tx.compute.result(REQUEST_ID, contract, SUBMITOR);

  console.log('\n📤 Signing and submitting transaction...');
  const unsub = await request.signAndSend(signer, async (result) => {
    console.log('   Status:', result.status.type);
    console.log('   Block hash:', result.toHuman() || 'N/A');

    if (result.status.isInBlock) {
      console.log('   ✓ In block:', result.status.asInBlock.toHex());
    }

    if (result.status.isFinalized) {
      console.log('   ✓ Finalized:', result.status.asFinalized.toHex());
      
      if (result.dispatchError) {
        console.error('   ❌ Dispatch error:', result.dispatchError.toHuman());
      } else {
        console.log('   ✅ Transaction successful!');
      }

      unsub();
      process.exit(result.dispatchError ? 1 : 0);
    }
  });

  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});
