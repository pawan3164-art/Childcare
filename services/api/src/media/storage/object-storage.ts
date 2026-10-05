/**
 * Private object storage for media bytes (ADR 0004). Implementations:
 * S3ObjectStorage (AWS S3 in ap-southeast-2 when deployed, MinIO locally) and
 * InMemoryObjectStorage (tests, or local dev with no S3 configured).
 * Nothing here is ever publicly readable; reads go through presigned URLs.
 */
export interface ObjectStorage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** A time-limited GET URL for one object. */
  presignGet(key: string, expiresInSeconds: number): Promise<string>;
  delete(key: string): Promise<void>;
}

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');
