-- CreateEnum
CREATE TYPE "LearningRecordKind" AS ENUM ('OBSERVATION', 'LEARNING_STORY');

-- CreateEnum
CREATE TYPE "LearningRecordStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'PUBLISHED');

-- CreateTable
CREATE TABLE "learning_records" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "centre_id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "kind" "LearningRecordKind" NOT NULL,
    "status" "LearningRecordStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "observation" TEXT NOT NULL,
    "interpretation" TEXT,
    "outcomes" TEXT[],
    "reflection" TEXT,
    "next_steps" TEXT,
    "author_user_id" TEXT NOT NULL,
    "reviewed_by_user_id" TEXT,
    "published_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "learning_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_record_children" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "learning_record_id" TEXT NOT NULL,
    "child_id" TEXT NOT NULL,

    CONSTRAINT "learning_record_children_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_record_media" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "learning_record_id" TEXT NOT NULL,
    "media_asset_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "learning_record_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_record_events" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "learning_record_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "note" TEXT,
    "snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learning_record_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "learning_records_org_id_idx" ON "learning_records"("org_id");

-- CreateIndex
CREATE INDEX "learning_records_centre_id_status_published_at_idx" ON "learning_records"("centre_id", "status", "published_at");

-- CreateIndex
CREATE INDEX "learning_records_room_id_created_at_idx" ON "learning_records"("room_id", "created_at");

-- CreateIndex
CREATE INDEX "learning_record_children_org_id_idx" ON "learning_record_children"("org_id");

-- CreateIndex
CREATE INDEX "learning_record_children_child_id_idx" ON "learning_record_children"("child_id");

-- CreateIndex
CREATE UNIQUE INDEX "learning_record_children_learning_record_id_child_id_key" ON "learning_record_children"("learning_record_id", "child_id");

-- CreateIndex
CREATE INDEX "learning_record_media_org_id_idx" ON "learning_record_media"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "learning_record_media_learning_record_id_media_asset_id_key" ON "learning_record_media"("learning_record_id", "media_asset_id");

-- CreateIndex
CREATE INDEX "learning_record_events_org_id_idx" ON "learning_record_events"("org_id");

-- CreateIndex
CREATE INDEX "learning_record_events_learning_record_id_created_at_idx" ON "learning_record_events"("learning_record_id", "created_at");

-- AddForeignKey
ALTER TABLE "learning_record_children" ADD CONSTRAINT "learning_record_children_learning_record_id_fkey" FOREIGN KEY ("learning_record_id") REFERENCES "learning_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_record_media" ADD CONSTRAINT "learning_record_media_learning_record_id_fkey" FOREIGN KEY ("learning_record_id") REFERENCES "learning_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_record_events" ADD CONSTRAINT "learning_record_events_learning_record_id_fkey" FOREIGN KEY ("learning_record_id") REFERENCES "learning_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Tenant isolation. Records are never deleted (drafts and published alike);
-- tags and attached media are replaced while a record is a draft; the event
-- history is append-only.
GRANT SELECT, INSERT, UPDATE ON learning_records TO childcare_app;
GRANT SELECT, INSERT, DELETE ON learning_record_children TO childcare_app;
GRANT SELECT, INSERT, DELETE ON learning_record_media TO childcare_app;
GRANT SELECT, INSERT ON learning_record_events TO childcare_app;
ALTER TABLE learning_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_records FORCE ROW LEVEL SECURITY;
ALTER TABLE learning_record_children ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_record_children FORCE ROW LEVEL SECURITY;
ALTER TABLE learning_record_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_record_media FORCE ROW LEVEL SECURITY;
ALTER TABLE learning_record_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_record_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_learning_records ON learning_records
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), ''));
CREATE POLICY tenant_isolation_learning_record_children ON learning_record_children
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), ''));
CREATE POLICY tenant_isolation_learning_record_media ON learning_record_media
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), ''));
CREATE POLICY tenant_isolation_learning_record_events ON learning_record_events
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), ''));
