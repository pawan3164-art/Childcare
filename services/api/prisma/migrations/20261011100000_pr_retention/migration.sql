-- AlterTable
ALTER TABLE "children" ADD COLUMN "departed_on" DATE,
ADD COLUMN "legal_hold" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "legal_hold_reason" TEXT,
ADD COLUMN "anonymised_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "centre_retention_overrides" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "centre_id" TEXT NOT NULL,
    "record_type" TEXT NOT NULL,
    "years" INTEGER NOT NULL,
    "updated_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "centre_retention_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "centre_retention_overrides_centre_id_record_type_key" ON "centre_retention_overrides"("centre_id", "record_type");

-- CreateIndex
CREATE INDEX "centre_retention_overrides_org_id_idx" ON "centre_retention_overrides"("org_id");

-- Tenant isolation. The web API role can set a longer period but never delete the row's history in bulk.
GRANT SELECT, INSERT, UPDATE ON centre_retention_overrides TO childcare_app;
ALTER TABLE centre_retention_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE centre_retention_overrides FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_centre_retention_overrides ON centre_retention_overrides
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), ''));
