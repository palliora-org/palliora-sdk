import { AUTH_SERVICE_URL, AWS_REGION, AWS_S3_BUCKET } from "../config";
import { StorageProvider } from "./types";

export class S3Provider implements StorageProvider {
  public readonly id = "s3";

  getDeterministicUrl(hash: string): string {
    return `https://${AWS_S3_BUCKET}.s3.${AWS_REGION}.amazonaws.com/Contracts/${hash}`;
  }

  async getUploadUrl(
    txHash: string,
    fileHash: string,
    blockNumber: number,
    expectedUrl: string,
  ): Promise<string> {
    const response = await fetch(`${AUTH_SERVICE_URL}/api/s3/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ txHash, fileHash, blockNumber, url: expectedUrl })
    });

    if (!response.ok) {
      let errorMessage = response.statusText;
      try {
        const errData = await response.json();
        if (errData.error) errorMessage = errData.error;
      } catch {
        // Ignore json parse error
      }
      throw new Error(`Auth Service failed: ${errorMessage}`);
    }

    const { presignedUrl } = await response.json();
    if (!presignedUrl) {
        throw new Error("No presignedUrl returned from Auth Service");
    }
    return presignedUrl;
  }

  async upload(url: string, data: Uint8Array): Promise<void> {
    const response = await fetch(url, {
      method: "PUT",
      body: data as unknown as BodyInit
    });

    if (!response.ok) {
      throw new Error(`Storage Upload failed: ${response.statusText}`);
    }
  }
}
