import fs from "fs";
import path from "path";
import { getApi, getKeyring, MCryptFsWriter } from "../chain";
import { assert } from "../utils";
import { UploadOptions } from "./types";
import { submitTEData } from "./submit";
import { writeMetadata } from "./register";

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

  const account = (await getKeyring()).pairs[0];
  const ethAddress = "";

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
        baseCost: BigInt(Number(price) * 10 ** 18),
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
