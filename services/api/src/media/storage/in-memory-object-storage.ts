import { ObjectStorage } from './object-storage';

/**
 * Process-local storage for tests, and for local dev when no S3/MinIO is
 * configured. Bytes vanish on restart. Presigned URLs point at a fake host
 * and cannot be fetched; they exist so the URL-issuing path can be tested.
 */
export class InMemoryObjectStorage implements ObjectStorage {
  private readonly objects = new Map<string, { body: Buffer; contentType: string }>();
  lastPresign: { key: string; expiresInSeconds: number } | null = null;

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    this.objects.set(key, { body, contentType });
  }

  async presignGet(key: string, expiresInSeconds: number): Promise<string> {
    if (!this.objects.has(key)) throw new Error(`No object at ${key}`);
    this.lastPresign = { key, expiresInSeconds };
    return `memory://objects/${key}?expires=${expiresInSeconds}`;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  get(key: string) {
    return this.objects.get(key);
  }

  size(): number {
    return this.objects.size;
  }
}
