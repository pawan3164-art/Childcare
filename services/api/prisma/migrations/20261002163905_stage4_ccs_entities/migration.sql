-- CreateEnum
CREATE TYPE "CcsSessionReportStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- CreateTable
CREATE TABLE "ccs_enrolments" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "centre_id" TEXT NOT NULL,
    "child_id" TEXT NOT NULL,
    "ccs_enrolment_ref" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ccs_enrolments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ccs_session_reports" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "centre_id" TEXT NOT NULL,
    "enrolment_id" TEXT NOT NULL,
    "session_date" DATE NOT NULL,
    "hours" DOUBLE PRECISION NOT NULL,
    "attempt_number" INTEGER NOT NULL DEFAULT 1,
    "status" "CcsSessionReportStatus" NOT NULL DEFAULT 'PENDING',
    "confirmed_subsidy_cents" INTEGER,
    "rejection_reason" TEXT,
    "provider_response_ref" TEXT,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "resulting_ledger_entry_id" TEXT,

    CONSTRAINT "ccs_session_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ccs_enrolments_org_id_idx" ON "ccs_enrolments"("org_id");

-- CreateIndex
CREATE INDEX "ccs_enrolments_centre_id_idx" ON "ccs_enrolments"("centre_id");

-- CreateIndex
CREATE INDEX "ccs_enrolments_child_id_idx" ON "ccs_enrolments"("child_id");

-- CreateIndex
CREATE INDEX "ccs_session_reports_org_id_idx" ON "ccs_session_reports"("org_id");

-- CreateIndex
CREATE INDEX "ccs_session_reports_centre_id_idx" ON "ccs_session_reports"("centre_id");

-- CreateIndex
CREATE INDEX "ccs_session_reports_enrolment_id_idx" ON "ccs_session_reports"("enrolment_id");

-- AddForeignKey
ALTER TABLE "ccs_enrolments" ADD CONSTRAINT "ccs_enrolments_child_id_fkey" FOREIGN KEY ("child_id") REFERENCES "children"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ccs_session_reports" ADD CONSTRAINT "ccs_session_reports_enrolment_id_fkey" FOREIGN KEY ("enrolment_id") REFERENCES "ccs_enrolments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-level security for Stage 4 CCS tables (org_id-only tenant boundary —
-- see ADR 0001). ccs_session_reports is append-only like invoices/ledger
-- entries: each submission attempt is a new row, never an edit of a prior
-- rejected/pending one — the full exchange history with Services Australia
-- must stay reconstructable (BRD §15).

GRANT SELECT, INSERT, UPDATE, DELETE ON ccs_enrolments TO childcare_app;
GRANT SELECT, INSERT ON ccs_session_reports TO childcare_app;
GRANT UPDATE (status, confirmed_subsidy_cents, rejection_reason, provider_response_ref, resolved_at, resulting_ledger_entry_id)
  ON ccs_session_reports TO childcare_app;

ALTER TABLE ccs_enrolments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ccs_enrolments FORCE ROW LEVEL SECURITY;
ALTER TABLE ccs_session_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE ccs_session_reports FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_ccs_enrolments ON ccs_enrolments
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), ''));
CREATE POLICY tenant_isolation_ccs_session_reports ON ccs_session_reports
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), ''));
