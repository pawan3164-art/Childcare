-- CreateEnum
CREATE TYPE "AllergySeverity" AS ENUM ('MILD', 'MODERATE', 'SEVERE', 'ANAPHYLAXIS');
CREATE TYPE "ImmunisationSource" AS ENUM ('CERTIFICATE', 'AIR_STATEMENT', 'PARENT_DECLARED');
CREATE TYPE "ImmunisationStatus" AS ENUM ('UNKNOWN', 'UP_TO_DATE', 'CATCH_UP_PLAN', 'MEDICAL_EXEMPTION');

-- CreateTable
CREATE TABLE "child_allergies" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "centre_id" TEXT NOT NULL,
    "child_id" TEXT NOT NULL,
    "allergen" TEXT NOT NULL,
    "severity" "AllergySeverity" NOT NULL,
    "reaction" TEXT,
    "action_plan" TEXT,
    "recorded_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "replaces_id" TEXT,
    "ended_at" TIMESTAMP(3),
    "ended_by_user_id" TEXT,
    "end_reason" TEXT,
    CONSTRAINT "child_allergies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "child_immunisations" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "centre_id" TEXT NOT NULL,
    "child_id" TEXT NOT NULL,
    "vaccine" TEXT NOT NULL,
    "dose_date" DATE NOT NULL,
    "source" "ImmunisationSource" NOT NULL,
    "recorded_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMP(3),
    "voided_by_user_id" TEXT,
    "void_reason" TEXT,
    CONSTRAINT "child_immunisations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "child_immunisation_statuses" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "centre_id" TEXT NOT NULL,
    "child_id" TEXT NOT NULL,
    "status" "ImmunisationStatus" NOT NULL,
    "statement_date" DATE,
    "note" TEXT,
    "updated_by_user_id" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "child_immunisation_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "child_allergies_org_id_idx" ON "child_allergies"("org_id");
CREATE INDEX "child_allergies_centre_id_idx" ON "child_allergies"("centre_id");
CREATE INDEX "child_allergies_child_id_ended_at_idx" ON "child_allergies"("child_id", "ended_at");
CREATE INDEX "child_immunisations_org_id_idx" ON "child_immunisations"("org_id");
CREATE INDEX "child_immunisations_centre_id_idx" ON "child_immunisations"("centre_id");
CREATE INDEX "child_immunisations_child_id_idx" ON "child_immunisations"("child_id");
CREATE UNIQUE INDEX "child_immunisation_statuses_child_id_key" ON "child_immunisation_statuses"("child_id");
CREATE INDEX "child_immunisation_statuses_org_id_idx" ON "child_immunisation_statuses"("org_id");
CREATE INDEX "child_immunisation_statuses_centre_id_idx" ON "child_immunisation_statuses"("centre_id");

-- AddForeignKey
ALTER TABLE "child_allergies" ADD CONSTRAINT "child_allergies_child_id_fkey" FOREIGN KEY ("child_id") REFERENCES "children"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "child_immunisations" ADD CONSTRAINT "child_immunisations_child_id_fkey" FOREIGN KEY ("child_id") REFERENCES "children"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "child_immunisation_statuses" ADD CONSTRAINT "child_immunisation_statuses_child_id_fkey" FOREIGN KEY ("child_id") REFERENCES "children"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Grants: history is never deleted, and only the "end" and "void" columns can change after creation.
GRANT SELECT, INSERT ON child_allergies TO childcare_app;
GRANT UPDATE (ended_at, ended_by_user_id, end_reason) ON child_allergies TO childcare_app;
GRANT SELECT, INSERT ON child_immunisations TO childcare_app;
GRANT UPDATE (voided_at, voided_by_user_id, void_reason) ON child_immunisations TO childcare_app;
GRANT SELECT, INSERT, UPDATE ON child_immunisation_statuses TO childcare_app;

ALTER TABLE child_allergies ENABLE ROW LEVEL SECURITY;
ALTER TABLE child_allergies FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_child_allergies ON child_allergies
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), ''));

ALTER TABLE child_immunisations ENABLE ROW LEVEL SECURITY;
ALTER TABLE child_immunisations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_child_immunisations ON child_immunisations
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), ''));

ALTER TABLE child_immunisation_statuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE child_immunisation_statuses FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_child_immunisation_statuses ON child_immunisation_statuses
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), ''));
