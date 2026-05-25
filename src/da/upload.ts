import fs from "fs";
import path from "path";
import bs58 from "bs58";
import { getApi, getKeyring, MCryptFsWriter } from "../chain";
import { assert } from "../utils";
import { toAtomicPaliAmount } from "../utils/token";
import { UploadOptions } from "./types";
import { submitTEData, submitTEDataWithCipher } from "./submit";
import { registerDataAgreement, writeMetadata } from "./register";

export async function uploadData(options: UploadOptions) {
  const { name, description, price, type, guardianGroupInfo, ref, filePath } =
    options;

  assert(
    guardianGroupInfo.guardians &&
      guardianGroupInfo.tauParams &&
      guardianGroupInfo.aggKey &&
      guardianGroupInfo.groupPk,
    "Guardian group info is missing required properties",
  );
  console.log("Guardian group info:", guardianGroupInfo);

  const account = (await getKeyring()).pairs[0];
  const atomicPrice = toAtomicPaliAmount(price);

  if (filePath) {
    throw new Error("uploadData: file path upload is not implemented");
  } else {
    const storeType =
      type === "model" ? "Model" : type === "agent" ? "Agent" : "Dataset";
    const { ref: dataRef, cipher } = await submitTEDataWithCipher(
      account,
      ref || "",
      guardianGroupInfo.guardians,
      guardianGroupInfo.tauParams,
      guardianGroupInfo.aggKey,
      guardianGroupInfo.groupPk,
    );
    await registerDataAgreement(account, {
      ref: dataRef,
      guardians: guardianGroupInfo.guardians,
      fees: atomicPrice,
      cipher,
      metadata: {
        name,
        description,
        storeType,
        groupId: guardianGroupInfo.groupId,
      },
    });
  }
}

/**
 * Legacy upload: uses submitTEData (returns only OnChainRef) and registers
 * the agreement with Plaintext cipher and no ComputePayload opts.
 * Kept for backward compatibility with callers that do not need cipher
 * parameters surfaced in the on-chain agreement.
 */
export async function uploadDataLegacy(options: Omit<UploadOptions, "opts">) {
  const { name, description, price, type, guardianGroupInfo, ref, filePath } =
    options;

  assert(
    guardianGroupInfo.guardians &&
      guardianGroupInfo.tauParams &&
      guardianGroupInfo.aggKey &&
      guardianGroupInfo.groupPk,
    "Guardian group info is missing required properties",
  );

  const account = (await getKeyring()).pairs[0];
  const ethAddress = "";
  const atomicPrice = toAtomicPaliAmount(price);

  if (type === "dataset" && filePath) {
    const fileContent = fs.readFileSync(filePath);
    const selectedFile = new File([fileContent], path.basename(filePath), {
      type: "application/octet-stream",
      lastModified: Date.now(),
    });

    const msCryptFsWriter = new MCryptFsWriter(
      {
        file: selectedFile,
        fileName: selectedFile.name,
        filePath: "",
        description,
        baseCost: atomicPrice,
        ownerL2Address: ethAddress,
        guardianInfo: guardianGroupInfo,
      },
      500,
      await getApi(),
      account,
    );

    await msCryptFsWriter.writeFile();
  } else {
    const dataRef = await submitTEData(
      account,
      ref || "",
      guardianGroupInfo.guardians,
      guardianGroupInfo.tauParams,
      guardianGroupInfo.aggKey,
      guardianGroupInfo.groupPk,
    );

    const dtype = type === "model" ? 1 : type === "agent" ? 2 : 0;
    await writeMetadata(
      account,
      name,
      description,
      dataRef,
      BigInt(Number(price) * 10 ** 18),
      dtype,
      ethAddress,
      guardianGroupInfo.groupId,
    );
  }
}
