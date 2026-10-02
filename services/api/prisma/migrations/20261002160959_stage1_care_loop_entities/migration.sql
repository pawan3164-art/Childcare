-- CreateEnum
CREATE TYPE "AttendanceEventType" AS ENUM ('SIGN_IN', 'SIGN_OUT');

-- CreateEnum
CREATE TYPE "AttendanceMethod" AS ENUM ('KIOSK', 'QR', 'PIN', 'EDUCATOR');

-- CreateEnum
CREATE TYPE "CareRecordType" AS ENUM ('MEAL', 'SLEEP', 'TOILETING', 'BOTTLE', 'ACTIVITY');

-- CreateTable
CREATE TABLE "attendance_events" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "centre_id" TEXT NOT NULL,
    "child_id" TEXT NOT NULL,
    "event_type" "AttendanceEventType" NOT NULL,
    "method" "AttendanceMethod" NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "recorded_by_user_id" TEXT,
    "is_correction" BOOLEAN NOT NULL DEFAULT false,
    "corrected_event_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "care_records" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "centre_id" TEXT NOT NULL,
    "child_id" TEXT NOT NULL,
    "type" "CareRecordType" NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "group_event_id" TEXT NOT NULL,
    "recorded_by_user_id" TEXT NOT NULL,
    "is_correction" BOOLEAN NOT NULL DEFAULT false,
    "corrected_record_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "care_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_assets" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "centre_id" TEXT NOT NULL,
    "room_id" TEXT,
    "storage_key" TEXT NOT NULL,
    "captured_by_user_id" TEXT NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_asset_child_tags" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "media_asset_id" TEXT NOT NULL,
    "child_id" TEXT NOT NULL,

    CONSTRAINT "media_asset_child_tags_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attendance_events_org_id_idx" ON "attendance_events"("org_id");

-- CreateIndex
CREATE INDEX "attendance_events_centre_id_idx" ON "attendance_events"("centre_id");

-- CreateIndex
CREATE INDEX "attendance_events_child_id_timestamp_idx" ON "attendance_events"("child_id", "timestamp");

-- CreateIndex
CREATE INDEX "care_records_org_id_idx" ON "care_records"("org_id");

-- CreateIndex
CREATE INDEX "care_records_centre_id_idx" ON "care_records"("centre_id");

-- CreateIndex
CREATE INDEX "care_records_child_id_timestamp_idx" ON "care_records"("child_id", "timestamp");

-- CreateIndex
CREATE INDEX "care_records_group_event_id_idx" ON "care_records"("group_event_id");

-- CreateIndex
CREATE INDEX "media_assets_org_id_idx" ON "media_assets"("org_id");

-- CreateIndex
CREATE INDEX "media_assets_centre_id_idx" ON "media_assets"("centre_id");

-- CreateIndex
CREATE INDEX "media_asset_child_tags_org_id_idx" ON "media_asset_child_tags"("org_id");

-- CreateIndex
CREATE INDEX "media_asset_child_tags_child_id_idx" ON "media_asset_child_tags"("child_id");

-- CreateIndex
CREATE UNIQUE INDEX "media_asset_child_tags_media_asset_id_child_id_key" ON "media_asset_child_tags"("media_asset_id", "child_id");

-- AddForeignKey
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_child_id_fkey" FOREIGN KEY ("child_id") REFERENCES "children"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care_records" ADD CONSTRAINT "care_records_child_id_fkey" FOREIGN KEY ("child_id") REFERENCES "children"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_asset_child_tags" ADD CONSTRAINT "media_asset_child_tags_media_asset_id_fkey" FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_asset_child_tags" ADD CONSTRAINT "media_asset_child_tags_child_id_fkey" FOREIGN KEY ("child_id") REFERENCES "children"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-level security for Stage 1 tables (same org_id-only tenant boundary as
-- the enable_rls migration; see ADR 0001 and src/common/tenancy/tenancy.service.ts).
--
-- attendance_events and care_records are append-only by domain design
-- (Delivery Plan §6.1: corrections are new rows, not edits of history) —
-- enforced at the DB level, the same way audit_log_entries is, not just by
-- the absence of an update path in the service layer.
GRANT SELECT, INSERT ON attendance_events, care_records TO childcare_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON media_assets, media_asset_child_tags TO childcare_app;

ALTER TABLE attendance_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_events FORCE ROW LEVEL SECURITY;
ALTER TABLE care_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE care_records FORCE ROW LEVEL SECURITY;
ALTER TABLE media_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_assets FORCE ROW LEVEL SECURITY;
ALTER TABLE media_asset_child_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_asset_child_tags FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_attendance_events ON attendance_events
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), ''));

CREATE POLICY tenant_isolation_care_records ON care_records
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), ''));

CREATE POLICY tenant_isolation_media_assets ON media_assets
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), ''));

CREATE POLICY tenant_isolation_media_asset_child_tags ON media_asset_child_tags
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), ''));
