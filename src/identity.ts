import assert from "assert";
import { getApi, signAndSend } from "./chain";
import { debugLog } from "./utils/helper";
import type { KeyringPair } from "@polkadot/keyring/types";

export interface IdentityFields {
	display?: string;
}

export async function setIdentity(account: KeyringPair, { display = undefined }: IdentityFields) {
	const api = await getApi();

	assert(api, "API not initialized");

	debugLog(`\nSetting identity for account: ${account.address} as ${display}`);

	const tx = api.tx.identity.setIdentity({display: {Raw: display}});
	const hash = await signAndSend(tx, account);

	debugLog(`Set identity transaction sent with hash: ${hash.hash}`);
}

