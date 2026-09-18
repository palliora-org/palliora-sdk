export interface StorageProvider {
  /** Unique identifier for the storage backend (e.g., 's3', 'ipfs') */
  readonly id: string;
  
  /** Generates the deterministic URL where the file will be stored */
  getDeterministicUrl(hash: string): string;
  
  /** 
   * Fetches the authorized upload URL (e.g., a Pre-signed URL) from the Auth Service 
   * after the on-chain agreement has been created.
   */
  getUploadUrl(
    txHash: string,
    fileHash: string,
    blockNumber: number,
    expectedUrl: string,
  ): Promise<string>;
  
  /** Uploads the raw bytes to the authorized URL */
  upload(url: string, data: Uint8Array): Promise<void>;
}
