-- AlterTable
ALTER TABLE "media_assets" ADD COLUMN     "byte_size" INTEGER,
ADD COLUMN     "content_type" TEXT,
ADD COLUMN     "height" INTEGER,
ADD COLUMN     "width" INTEGER;
