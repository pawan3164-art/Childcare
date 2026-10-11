-- Multi-site HQ (BRD v2.3 HQ-001, HQ-003, HQ-004): an area manager sees a defined subset of an organisation's centres.
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'AREA_MANAGER';

ALTER TABLE "centres" ADD COLUMN "licensed_capacity" INTEGER;

CREATE TABLE "area_manager_centres" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "centre_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "area_manager_centres_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "area_manager_centres_user_id_centre_id_key" ON "area_manager_centres"("user_id", "centre_id");
CREATE INDEX "area_manager_centres_org_id_idx" ON "area_manager_centres"("org_id");

-- An assignment is added or removed, never edited.
GRANT SELECT, INSERT, DELETE ON area_manager_centres TO childcare_app;

ALTER TABLE area_manager_centres ENABLE ROW LEVEL SECURITY;
ALTER TABLE area_manager_centres FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_area_manager_centres ON area_manager_centres
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), ''));
