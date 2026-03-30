export interface OnChainRef {
  blockNumber: number;
  index: number;
}

export interface GuardianGroupInfo {
  groupId: string;
  guardians: any[];
  tauParams: string;
  aggKey: string;
  groupPk: string;
}

export interface UploadOptions {
  name: string;
  description: string;
  price: string;
  type: "model" | "dataset" | "agent";
  guardianGroupInfo: GuardianGroupInfo;
  ref?: string;
  filePath?: string;
}
