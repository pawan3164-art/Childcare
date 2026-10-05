// Local dev: create the private media bucket in the S3-compatible store from
// infra/docker-compose.dev.yml if it doesn't exist yet. Safe to re-run.
// Usage: npm run storage:init
require('dotenv').config();
const { S3Client, HeadBucketCommand, CreateBucketCommand } = require('@aws-sdk/client-s3');

(async () => {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) {
    console.log('S3_BUCKET is not set; photos will be kept in memory. Nothing to do.');
    return;
  }
  const client = new S3Client({
    region: process.env.S3_REGION || 'ap-southeast-2',
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    credentials: process.env.S3_ACCESS_KEY_ID
      ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY }
      : undefined,
  });
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    console.log(`Bucket ${bucket} already exists.`);
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    console.log(`Created bucket ${bucket}.`);
  }
})().catch((err) => {
  console.error(`Could not reach object storage at ${process.env.S3_ENDPOINT}: ${err.message}`);
  process.exit(1);
});
