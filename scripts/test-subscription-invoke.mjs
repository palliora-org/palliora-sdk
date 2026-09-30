/**
 * test-subscription-invoke.mjs
 *
 * Reproduces the staging "subscription session" run locally: one Subscription
 * contract, then repeated `compute.invoke` calls against it.
 *
 * The program is a plaintext Docker image that echoes `/input/*` back, so the
 * result payload shows which input each execution actually ran against.
 *
 * Optional environment variables:
 *   PALLIORA_WS  – WebSocket endpoint (defaults to ws://127.0.0.1:9944)
 *   INVOKES      – number of invoke calls to attempt (defaults to 4)
 *   RESULT_WAIT  – seconds to keep watching for results after the last invoke
 */

import {
  init,
  getApi,
  getKeyring,
  getGuardianAddress,
  createAgreement,
  signAndSend,
  toAtomicPaliAmount,
} from "../dist/index.js";

const PROGRAM_IMAGE = "ujjwalpal/hello-world:test";
const INVOKES = Number(process.env.INVOKES ?? 4);
const RESULT_WAIT = Number(process.env.RESULT_WAIT ?? 90);

const bytes = (s) => Array.from(new TextEncoder().encode(s));
const hexToText = (h) =>
  new TextDecoder().decode(Buffer.from(String(h).replace(/^0x/, ""), "hex"));

const observed = { events: [], results: [] };

function logEvent(blockNumber, section, method, data) {
  observed.events.push({ blockNumber, section, method, data });
  console.log(`  [block ${blockNumber}] ${section}.${method} ${JSON.stringify(data)}`);
}

/** Records every compute event and every compute.result payload from `from` onward. */
async function watchChain(api, agreementId) {
  return api.rpc.chain.subscribeNewHeads(async (header) => {
    const blockNumber = header.number.toNumber();
    const hash = header.hash;
    const [block, events] = await Promise.all([
      api.rpc.chain.getBlock(hash),
      api.query.system.events.at(hash),
    ]);

    for (const { event, phase } of events) {
      if (event.section !== "compute") continue;
      const data = event.data.toJSON();
      if (!JSON.stringify(data).includes(agreementId.slice(2))) continue;
      logEvent(blockNumber, event.section, event.method, data);
    }

    block.block.extrinsics.forEach((ex, index) => {
      if (ex.method.section !== "compute" || ex.method.method !== "result") return;
      const args = ex.method.args;
      const requestId = args[0].toHex();
      const contract = args[1].toJSON();
      const inline = contract?.compute?.input?.inline?.data;
      const payload = inline ? hexToText(inline) : JSON.stringify(contract?.compute?.input);
      const entry = {
        blockNumber,
        index,
        requestId,
        submitor: args[2]?.toString(),
        durationMs: args[3]?.toString(),
        outcome: args[4]?.toString(),
        payload,
      };
      observed.results.push(entry);
      console.log(
        `  [block ${blockNumber}] compute.result requestId=${requestId} outcome=${entry.outcome} payload=${JSON.stringify(payload)}`,
      );
    });
  });
}

async function contractState(api, id) {
  const [contract, deadline, settlement, head] = await Promise.all([
    api.query.compute.contracts(id),
    api.query.compute.contractDeadlines(id),
    api.query.compute.settlementMap(id),
    api.rpc.chain.getHeader(),
  ]);
  return {
    block: head.number.toNumber(),
    contract: contract.toJSON(),
    deadline: deadline.toJSON(),
    settlementPresent: !settlement.isNone,
  };
}

async function main() {
  init({
    pallioraWs: process.env.PALLIORA_WS ?? "ws://127.0.0.1:9944",
    debug: false,
  });

  const api = await getApi();
  if (!api) throw new Error("Api not initialized");

  const keyring = await getKeyring();
  const signer = keyring.getPairs()[0];
  if (!signer) throw new Error("No signer account in keyring");

  const guardians = (await getGuardianAddress()).slice(0, 1).map((g) => g.address);
  if (!guardians.length) throw new Error("No guardians available on-chain");

  const deadlineDuration = (await api.query.compute.contractDeadlineDuration()).toString();
  const msPerBlock = api.consts.compute?.millisecondsPerBlock?.toString() ?? "?";
  const { data: balance } = await api.query.system.account(signer.address);

  console.log("=".repeat(78));
  console.log("Subscription + repeated invoke — local run");
  console.log("=".repeat(78));
  console.log("Endpoint                 :", process.env.PALLIORA_WS ?? "ws://127.0.0.1:9944");
  console.log("Signer                   :", signer.address);
  console.log("Free balance             :", balance.free.toString());
  console.log("Guardian                 :", guardians[0]);
  console.log("contractDeadlineDuration :", deadlineDuration, "blocks");
  console.log("MillisecondsPerBlock     :", msPerBlock);
  console.log("Program                  :", PROGRAM_IMAGE);
  console.log("Invokes planned          :", INVOKES);
  console.log();

  const cipher = "Plaintext";
  const contract = {
    contract_type: "Subscription",
    guardians,
    pre_check: null,
    compute: {
      cipher,
      computer_indices: guardians.map((_, i) => i),
      fees: toAtomicPaliAmount("2"),
      compute_rate: toAtomicPaliAmount("0.00001"),
      deadline: 0,
      confidentiality: { Trusted: 0 },
      fee_function: null,
      input: { Inline: { data: bytes("turn-0-initial") } },
      program: { Inline: { data: bytes(PROGRAM_IMAGE) } },
    },
    post_check: null,
    result_cipher: cipher,
  };

  console.log("--- creating Subscription contract ---");
  const created = await createAgreement(contract, signer);
  const agreementId = created.agreementId;
  if (!agreementId) throw new Error("AgreementCreated was not emitted");
  console.log("Agreement id :", agreementId);
  console.log("Block        :", created.blockNumber, "| tx", created.hash);

  const afterCreate = await contractState(api, agreementId);
  console.log("State after create:", JSON.stringify(afterCreate));
  console.log(
    `Deadline is block ${afterCreate.deadline} (created at ${afterCreate.contract?.originBlock}) ` +
      `-> ${Number(afterCreate.deadline) - Number(afterCreate.contract?.originBlock)} blocks of headroom`,
  );
  console.log();

  // `Contracts[id].status` only flips to Accepted in the on_finalize that drains this
  // agreement's guardian responses. If those were drained in a block before the agreement
  // itself was included, the mutate was a no-op and the contract stays Pending forever --
  // in which case every invoke fails the status guard, so bail out rather than mis-report.
  let accepted = false;
  for (let i = 0; i < 20; i++) {
    const st = await contractState(api, agreementId);
    if (st.contract?.status === "Accepted") {
      accepted = true;
      console.log(`Contract reached Accepted at block ${st.block}`);
      break;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  if (!accepted) {
    const agreements = await api.query.compute.agreements(agreementId);
    console.log();
    console.log("ABORT: contract never reached Accepted.");
    console.log(`  Contracts[id].status = ${(await contractState(api, agreementId)).contract?.status}`);
    console.log(`  Agreements[id]       = ${agreements.toString()}`);
    console.log("  A mismatch here means the guardian responses were processed before the");
    console.log("  agreement extrinsic was included, so Contracts::mutate found no entry.");
    process.exit(2);
  }
  console.log();

  const unsub = await watchChain(api, agreementId);

  const rows = [];
  for (let turn = 1; turn <= INVOKES; turn++) {
    const input = `turn-${turn}-of-session`;
    console.log(`--- invoke ${turn} (input: ${input}) ---`);

    const tx = api.tx.compute.invoke(
      Array.from(Buffer.from(agreementId.replace(/^0x/, ""), "hex")),
      guardians,
      cipher,
      { Inline: { data: bytes(input) } },
    );

    let row = { turn, input, submitted: false, error: null, blockNumber: null, sessionId: null };
    try {
      const sent = await signAndSend(tx, signer);
      row.submitted = true;
      row.blockNumber = sent.blockNumber;
      // Session-based runtimes address the eventual result to the session, not the contract.
      const invoked = sent.tx_result.events.find(
        ({ event }) => event.section === "compute" && event.method === "ComputeInvoked",
      );
      const invokedData = invoked?.event?.data?.toJSON();
      row.sessionId = Array.isArray(invokedData) ? invokedData[0] : invokedData?.sessionId ?? null;
      console.log(`  submitted in block ${sent.blockNumber} (tx ${sent.hash})`);
      console.log(`  sessionId: ${row.sessionId}`);
    } catch (err) {
      row.error = String(err?.message ?? err);
      console.log(`  FAILED: ${row.error}`);
    }

    const state = await contractState(api, agreementId);
    row.status = state.contract?.status ?? "<absent>";
    row.settlementPresent = state.settlementPresent;
    row.deadline = state.deadline;
    console.log(`  state now: ${JSON.stringify(state)}`);
    rows.push(row);
    console.log();

    await new Promise((r) => setTimeout(r, 6000));
  }

  console.log(`--- watching ${RESULT_WAIT}s for compute results ---`);
  await new Promise((r) => setTimeout(r, RESULT_WAIT * 1000));
  unsub();

  const final = await contractState(api, agreementId);

  console.log();
  console.log("=".repeat(78));
  console.log("SUMMARY");
  console.log("=".repeat(78));
  console.log("Agreement id:", agreementId);
  console.log();
  console.log("| invoke | submitted | block | sessionId | contract status | settlement | error |");
  console.log("|---|---|---|---|---|---|---|");
  for (const r of rows) {
    const sid = r.sessionId ? `${r.sessionId.slice(0, 12)}…` : "-";
    console.log(
      `| ${r.turn} | ${r.submitted} | ${r.blockNumber ?? "-"} | ${sid} | ${r.status} | ${r.settlementPresent} | ${r.error ?? "-"} |`,
    );
  }

  const owner = (requestId) => {
    if (requestId === agreementId) return "contract (creation-time execution)";
    const hit = rows.find((r) => r.sessionId === requestId);
    return hit ? `invoke ${hit.turn}` : "UNMATCHED";
  };
  console.log();
  console.log(`executions expected: ${rows.length + 1} (1 agreement + ${rows.length} invokes)`);
  const delivered = new Set(observed.results.map((r) => r.requestId));
  const missing = [
    ...(delivered.has(agreementId) ? [] : ["contract (creation-time execution)"]),
    ...rows.filter((r) => r.sessionId && !delivered.has(r.sessionId)).map((r) => `invoke ${r.turn}`),
  ];
  console.log(`results delivered  : ${observed.results.length}`);
  console.log(`missing            : ${missing.length ? missing.join(", ") : "none"}`);
  console.log();
  console.log(`compute.result extrinsics observed: ${observed.results.length}`);
  console.log("| block | requestId | belongs to | outcome | payload |");
  console.log("|---|---|---|---|---|");
  for (const r of observed.results) {
    console.log(
      `| ${r.blockNumber} | ${r.requestId.slice(0, 12)}… | ${owner(r.requestId)} | ${r.outcome} | ${JSON.stringify(r.payload)} |`,
    );
  }
  console.log();
  console.log("compute events for this contract:");
  for (const e of observed.events) {
    console.log(`  block ${e.blockNumber}: ${e.section}.${e.method} ${JSON.stringify(e.data)}`);
  }
  console.log();
  console.log("Final state:", JSON.stringify(final));

  process.exit(0);
}

main().catch((err) => {
  console.error("subscription invoke test failed:", err);
  process.exit(1);
});
