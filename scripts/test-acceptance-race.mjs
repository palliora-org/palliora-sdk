/**
 * test-acceptance-race.mjs
 *
 * Creates Subscription contracts in a loop and, for each one, records whether
 * the guardian responses landed in an earlier block than the agreement itself
 * and whether the contract still reached `Accepted`.
 *
 * The acceptance bug only shows up in the "response earlier" ordering: the
 * `on_finalize` that recorded the verdict ran before `Contracts[id]` existed,
 * so its mutate was a no-op and the response was then drained. A single run
 * proves nothing because the ordering is a race - this keeps going until it
 * has observed that ordering at least MIN_EARLY times.
 *
 * Environment:
 *   PALLIORA_WS  - defaults to ws://127.0.0.1:9947 (must be a guardian RPC)
 *   ROUNDS       - max contracts to create (default 6)
 *   MIN_EARLY    - stop once this many "response earlier" cases are seen (default 2)
 */

import {
  init,
  getApi,
  getKeyring,
  getGuardianAddress,
  createAgreement,
  toAtomicPaliAmount,
} from "../dist/index.js";

const ROUNDS = Number(process.env.ROUNDS ?? 6);
const MIN_EARLY = Number(process.env.MIN_EARLY ?? 2);
const PROGRAM_IMAGE = "ujjwalpal/hello-world:test";

const bytes = (s) => Array.from(new TextEncoder().encode(s));

/** Block in which `guardian.agreementResponse` for `id` was included, or null. */
async function findResponseBlock(api, id, agreementBlock, lookback = 12) {
  for (let n = agreementBlock; n >= Math.max(1, agreementBlock - lookback); n--) {
    const hash = await api.rpc.chain.getBlockHash(n);
    const events = await api.query.system.events.at(hash);
    const hit = events.some(
      ({ event }) =>
        event.section === "guardian" &&
        event.method === "AgreementResponse" &&
        JSON.stringify(event.data.toJSON()).includes(id.slice(2)),
    );
    if (hit) return n;
  }
  return null;
}

async function main() {
  init({ pallioraWs: process.env.PALLIORA_WS ?? "ws://127.0.0.1:9947", debug: false });

  const api = await getApi();
  const keyring = await getKeyring();
  const signer = keyring.getPairs()[0];
  const guardians = (await getGuardianAddress()).slice(0, 1).map((g) => g.address);
  if (!guardians.length) throw new Error("No guardians on-chain (is this a guardian RPC?)");

  console.log("=".repeat(76));
  console.log("Acceptance-race check");
  console.log("=".repeat(76));
  console.log("Guardian :", guardians[0]);
  console.log("Rounds   :", ROUNDS, `(stop after ${MIN_EARLY} 'response earlier' cases)`);
  console.log();

  const rows = [];
  let early = 0;

  for (let round = 1; round <= ROUNDS && early < MIN_EARLY; round++) {
    const contract = {
      contract_type: "Subscription",
      guardians,
      pre_check: null,
      compute: {
        cipher: "Plaintext",
        computer_indices: guardians.map((_, i) => i),
        fees: toAtomicPaliAmount("1"),
        compute_rate: toAtomicPaliAmount("0.00001"),
        deadline: 0,
        confidentiality: { Trusted: 0 },
        fee_function: null,
        input: { Inline: { data: bytes(`race-round-${round}`) } },
        program: { Inline: { data: bytes(PROGRAM_IMAGE) } },
      },
      post_check: null,
      result_cipher: "Plaintext",
    };

    const created = await createAgreement(contract, signer);
    const id = created.agreementId;
    if (!id) throw new Error("AgreementCreated not emitted");

    // Give on_finalize of the inclusion block a moment to land.
    await new Promise((r) => setTimeout(r, 6000));

    const info = (await api.query.compute.contracts(id)).toJSON();
    const agreements = (await api.query.compute.agreements(id)).toString();
    const respBlock = await findResponseBlock(api, id, created.blockNumber);
    const ordering =
      respBlock === null
        ? "response not found"
        : respBlock < created.blockNumber
          ? `response EARLIER (${respBlock} < ${created.blockNumber})`
          : `same block (${respBlock})`;

    if (respBlock !== null && respBlock < created.blockNumber) early++;

    const row = {
      round,
      id,
      agreementBlock: created.blockNumber,
      respBlock,
      ordering,
      contractStatus: info?.status ?? "<absent>",
      agreementsStatus: agreements,
      consistent: (info?.status ?? "") === agreements,
    };
    rows.push(row);

    console.log(
      `round ${round}: ${ordering}\n` +
        `  Contracts[id].status = ${row.contractStatus} | Agreements[id] = ${row.agreementsStatus} | ` +
        `${row.consistent ? "CONSISTENT" : "MISMATCH"}`,
    );
  }

  console.log();
  console.log("=".repeat(76));
  console.log("SUMMARY");
  console.log("=".repeat(76));
  console.log("| round | ordering | Contracts.status | Agreements | consistent |");
  console.log("|---|---|---|---|---|");
  for (const r of rows) {
    console.log(
      `| ${r.round} | ${r.ordering} | ${r.contractStatus} | ${r.agreementsStatus} | ${r.consistent} |`,
    );
  }

  const earlyRows = rows.filter((r) => r.respBlock !== null && r.respBlock < r.agreementBlock);
  const badEarly = earlyRows.filter((r) => r.contractStatus !== "Accepted");
  const anyMismatch = rows.filter((r) => !r.consistent);

  console.log();
  console.log(`'response earlier' cases observed : ${earlyRows.length}`);
  console.log(`  of those, not Accepted          : ${badEarly.length}`);
  console.log(`status mismatches (any ordering)  : ${anyMismatch.length}`);
  console.log();

  if (earlyRows.length === 0) {
    console.log("INCONCLUSIVE: never hit the 'response earlier' ordering - the bug's");
    console.log("trigger was not exercised. Re-run; it is a race.");
    process.exit(3);
  }
  if (badEarly.length || anyMismatch.length) {
    console.log("FAIL: the acceptance race still drops verdicts.");
    process.exit(1);
  }
  console.log("PASS: every contract reached Accepted, including the 'response earlier' ones.");
  process.exit(0);
}

main().catch((err) => {
  console.error("acceptance race test failed:", err);
  process.exit(2);
});
