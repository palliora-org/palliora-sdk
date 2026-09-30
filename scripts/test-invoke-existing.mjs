/**
 * test-invoke-existing.mjs
 *
 * Fires repeated `compute.invoke` calls at an already-Accepted Subscription
 * contract and reports which of them came back with a result.
 *
 * Split out from test-subscription-invoke.mjs so a run does not depend on
 * winning the agreement-acceptance race: the contract already exists.
 *
 * Environment:
 *   CONTRACT_ID  - required, the Subscription contract to invoke
 *   PALLIORA_WS  - WebSocket endpoint (defaults to ws://127.0.0.1:9947)
 *   INVOKES      - number of invokes to attempt (defaults to 4)
 *   GAP_MS       - delay between invokes (defaults to 3000; below the compute
 *                  round-trip on purpose, so invokes land while a job is in
 *                  flight -- that is the window this test exercises)
 *   RESULT_WAIT  - seconds to keep watching after the last invoke
 */

import {
  init,
  getApi,
  getKeyring,
  getGuardianAddress,
  signAndSend,
} from "../dist/index.js";

const CONTRACT_ID = process.env.CONTRACT_ID;
const INVOKES = Number(process.env.INVOKES ?? 4);
const GAP_MS = Number(process.env.GAP_MS ?? 3000);
const RESULT_WAIT = Number(process.env.RESULT_WAIT ?? 120);

const bytes = (s) => Array.from(new TextEncoder().encode(s));
const hexToText = (h) =>
  new TextDecoder().decode(Buffer.from(String(h).replace(/^0x/, ""), "hex"));

const results = [];

async function watchChain(api) {
  return api.rpc.chain.subscribeNewHeads(async (header) => {
    const blockNumber = header.number.toNumber();
    const block = await api.rpc.chain.getBlock(header.hash);

    block.block.extrinsics.forEach((ex) => {
      if (ex.method.section !== "compute" || ex.method.method !== "result") return;
      const args = ex.method.args;
      const contract = args[1].toJSON();
      const inline = contract?.compute?.input?.inline?.data;
      const entry = {
        blockNumber,
        requestId: args[0].toHex(),
        outcome: args[4]?.toString(),
        payload: inline ? hexToText(inline) : "<non-inline>",
      };
      results.push(entry);
      console.log(
        `  [block ${blockNumber}] result requestId=${entry.requestId.slice(0, 14)}… ` +
          `outcome=${entry.outcome} payload=${JSON.stringify(entry.payload)}`,
      );
    });
  });
}

async function main() {
  if (!CONTRACT_ID) throw new Error("CONTRACT_ID is required");

  init({ pallioraWs: process.env.PALLIORA_WS ?? "ws://127.0.0.1:9947", debug: false });

  const api = await getApi();
  if (!api) throw new Error("Api not initialized");

  const keyring = await getKeyring();
  const signer = keyring.getPairs()[0];
  const guardians = (await getGuardianAddress()).slice(0, 1).map((g) => g.address);
  if (!guardians.length) throw new Error("No guardians available on-chain");

  const info = (await api.query.compute.contracts(CONTRACT_ID)).toJSON();
  const settlement = await api.query.compute.settlementMap(CONTRACT_ID);
  const deadline = (await api.query.compute.contractDeadlines(CONTRACT_ID)).toJSON();
  const head = (await api.rpc.chain.getHeader()).number.toNumber();

  console.log("=".repeat(78));
  console.log("Repeated invoke against an existing Subscription");
  console.log("=".repeat(78));
  console.log("Contract   :", CONTRACT_ID);
  console.log("State      :", JSON.stringify(info));
  console.log("Deadline   :", deadline, "| head:", head);
  console.log("Settlement :", settlement.isNone ? "ABSENT" : "present");
  console.log("Guardian   :", guardians[0]);
  console.log("Invokes    :", INVOKES, `(gap ${GAP_MS}ms)`);
  console.log();

  if (info?.status !== "Accepted") {
    throw new Error(`contract is ${info?.status}, not Accepted - nothing to test`);
  }
  if (settlement.isNone) throw new Error("settlement record is gone - contract was settled");
  // An expired contract does not fail the invoke: the pallet settles it in place and
  // returns Ok, so the extrinsic looks successful while no session is ever opened.
  // Catch that here rather than reading it as a delivery failure.
  if (deadline === null || head > Number(deadline)) {
    throw new Error(
      `contract deadline ${deadline} passed (head ${head}) - the next invoke would settle it; a new agreement is needed`,
    );
  }
  console.log(`Deadline headroom: ${Number(deadline) - head} blocks`);
  console.log();

  const unsub = await watchChain(api);

  const rows = [];
  for (let turn = 1; turn <= INVOKES; turn++) {
    const input = `fix2-turn-${turn}`;
    const tx = api.tx.compute.invoke(
      Array.from(Buffer.from(CONTRACT_ID.replace(/^0x/, ""), "hex")),
      guardians,
      "Plaintext",
      { Inline: { data: bytes(input) } },
    );

    const row = { turn, input, sessionId: null, blockNumber: null, error: null };
    try {
      const sent = await signAndSend(tx, signer);
      row.blockNumber = sent.blockNumber;
      const invoked = sent.tx_result.events.find(
        ({ event }) => event.section === "compute" && event.method === "ComputeInvoked",
      );
      const data = invoked?.event?.data?.toJSON();
      row.sessionId = Array.isArray(data) ? data[0] : data?.sessionId ?? null;
      console.log(
        `invoke ${turn} (${input}) -> block ${sent.blockNumber}, session ${row.sessionId?.slice(0, 14)}…`,
      );
    } catch (err) {
      row.error = String(err?.message ?? err);
      console.log(`invoke ${turn} FAILED: ${row.error}`);
    }
    rows.push(row);
    await new Promise((r) => setTimeout(r, GAP_MS));
  }

  console.log();
  console.log(`watching ${RESULT_WAIT}s for results...`);
  await new Promise((r) => setTimeout(r, RESULT_WAIT * 1000));
  unsub();

  const delivered = new Set(results.map((r) => r.requestId));
  const missing = rows.filter((r) => r.sessionId && !delivered.has(r.sessionId));

  console.log();
  console.log("=".repeat(78));
  console.log("SUMMARY");
  console.log("=".repeat(78));
  console.log("| invoke | block | sessionId | result |");
  console.log("|---|---|---|---|");
  for (const r of rows) {
    const hit = results.find((x) => x.requestId === r.sessionId);
    console.log(
      `| ${r.turn} | ${r.blockNumber ?? "-"} | ${r.sessionId?.slice(0, 14) ?? "-"}… | ` +
        `${hit ? `block ${hit.blockNumber}: ${JSON.stringify(hit.payload)}` : "MISSING"} |`,
    );
  }
  console.log();
  console.log(`invokes submitted : ${rows.filter((r) => r.sessionId).length}/${INVOKES}`);
  console.log(`results delivered : ${rows.filter((r) => delivered.has(r.sessionId)).length}`);
  console.log(`missing           : ${missing.length ? missing.map((r) => `invoke ${r.turn}`).join(", ") : "none"}`);
  console.log();
  console.log("Final:", JSON.stringify((await api.query.compute.contracts(CONTRACT_ID)).toJSON()));

  process.exit(missing.length ? 1 : 0);
}

main().catch((err) => {
  console.error("invoke test failed:", err);
  process.exit(2);
});
