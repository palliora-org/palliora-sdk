import { S3Provider } from "./s3";
import { StorageProvider } from "./types";

export class StorageRouter {
  private providers: Map<string, StorageProvider>;
  private defaultProvider: string;

  constructor() {
    this.providers = new Map();
    this.register(new S3Provider());
    this.defaultProvider = "s3";
  }

  public register(provider: StorageProvider) {
    this.providers.set(provider.id, provider);
  }

  public getProvider(id?: string): StorageProvider {
    const targetId = id || this.defaultProvider;
    const provider = this.providers.get(targetId);
    if (!provider) {
      throw new Error(`Storage provider '${targetId}' not found`);
    }
    return provider;
  }
}

export const storageRouter = new StorageRouter();
