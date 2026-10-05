import { Logger, Module } from '@nestjs/common';
import { MediaService } from './media.service';
import { MediaController } from './media.controller';
import { OBJECT_STORAGE, ObjectStorage } from './storage/object-storage';
import { S3ObjectStorage } from './storage/s3-object-storage';
import { InMemoryObjectStorage } from './storage/in-memory-object-storage';

/**
 * ADR 0004: S3-compatible storage when S3_BUCKET is set (MinIO locally, AWS
 * S3 in ap-southeast-2 when deployed). Without it, local dev falls back to
 * process memory with a warning; production refuses to start.
 */
function objectStorageFromEnv(): ObjectStorage {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('S3_BUCKET must be set in production: media cannot be stored in process memory');
    }
    new Logger('MediaModule').warn('S3_BUCKET not set: photos are kept in memory and lost on restart, and view URLs will not load');
    return new InMemoryObjectStorage();
  }
  return new S3ObjectStorage({
    bucket,
    region: process.env.S3_REGION ?? 'ap-southeast-2',
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    accessKeyId: process.env.S3_ACCESS_KEY_ID || undefined,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || undefined,
  });
}

@Module({
  providers: [MediaService, { provide: OBJECT_STORAGE, useFactory: objectStorageFromEnv }],
  controllers: [MediaController],
  exports: [MediaService],
})
export class MediaModule {}
