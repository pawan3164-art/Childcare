-- AlterTable
ALTER TABLE "children" ADD COLUMN     "group_photo_consent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "group_photo_consent_updated_at" TIMESTAMP(3),
ADD COLUMN     "group_photo_consent_updated_by" TEXT;
