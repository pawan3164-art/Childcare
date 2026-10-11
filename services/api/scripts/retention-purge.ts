/**
 * Retention purge job (BRD v2.3 §36.3, OI-17). Runs with the schema-owner database
 * connection (DATABASE_URL): the web API role cannot delete retained records.
 *
 *   npm run retention:purge                 dry run: prints what would be affected, changes nothing
 *   npm run retention:purge -- --execute    performs the purge
 *   npm run retention:purge -- --org <id>   limit to one organisation
 *
 * Schedule weekly (cron) once compliance has confirmed the periods (OI-32). Photos are
 * removed from the bucket using the same S3_* settings as the API.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { RetentionPurger } from '../src/retention/retention-purger';
import { S3ObjectStorage } from '../src/media/storage/s3-object-storage';

async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes('--execute');
  const orgIndex = args.indexOf('--org');
  const orgId = orgIndex >= 0 ? args[orgIndex + 1] : undefined;

  const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
  const storage = process.env.S3_BUCKET
    ? new S3ObjectStorage({
        bucket: process.env.S3_BUCKET,
        region: process.env.S3_REGION ?? 'ap-southeast-2',
        endpoint: process.env.S3_ENDPOINT || undefined,
        forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
        accessKeyId: process.env.S3_ACCESS_KEY_ID || undefined,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || undefined,
      })
    : undefined;

  try {
    const report = await new RetentionPurger(prisma, storage).run(new Date(), { execute, orgId });
    console.log(JSON.stringify({ dryRun: report.dryRun, notAutomated: report.notAutomated, affected: report.results.length }, null, 2));
    for (const r of report.results) console.log(`${report.dryRun ? 'would affect' : 'affected'} ${r.affected} ${r.recordType} for child ${r.childId}`);
    if (report.dryRun) console.log('Dry run only. Add --execute to apply.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
