import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ObjectStorage } from './object-storage';

export interface S3StorageConfig {
  bucket: string;
  region: string;
  /** Set for MinIO or another S3-compatible endpoint; omit for AWS. */
  endpoint?: string;
  /** MinIO needs path-style URLs (http://host:9000/bucket/key). */
  forcePathStyle?: boolean;
  accessKeyId?: string;
  secretAccessKey?: string;
}

/**
 * S3-compatible storage: AWS S3 (ap-southeast-2, SSE-KMS, Block Public
 * Access) when deployed, MinIO in local dev. Without explicit keys the AWS
 * default credential chain is used (instance/task role in AWS).
 */
export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;

  constructor(private readonly config: S3StorageConfig) {
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      credentials:
        config.accessKeyId && config.secretAccessKey
          ? { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
          : undefined,
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.config.bucket, Key: key, Body: body, ContentType: contentType }));
  }

  presignGet(key: string, expiresInSeconds: number): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.config.bucket, Key: key }), { expiresIn: expiresInSeconds });
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
  }
}
