-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CareRecordType" ADD VALUE 'NAPPY';
ALTER TYPE "CareRecordType" ADD VALUE 'SUNSCREEN';
ALTER TYPE "CareRecordType" ADD VALUE 'SLEEP_CHECK';

-- AlterTable
ALTER TABLE "care_records" ADD COLUMN     "details" JSONB;
