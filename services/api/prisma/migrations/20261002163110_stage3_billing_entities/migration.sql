-- CreateEnum
CREATE TYPE "FeeType" AS ENUM ('SESSION', 'DAILY');

-- CreateEnum
CREATE TYPE "BookingType" AS ENUM ('PERMANENT', 'CASUAL');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('FEE', 'SUBSIDY_ESTIMATED', 'SUBSIDY_CONFIRMED', 'PAYMENT', 'ADJUSTMENT', 'CREDIT');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "fee_schedules" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "centre_id" TEXT NOT NULL,
    "room_id" TEXT,
    "name" TEXT NOT NULL,
    "fee_type" "FeeType" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "age_band_min_months" INTEGER,
    "age_band_max_months" INTEGER,
    "sibling_discount_percent" INTEGER NOT NULL DEFAULT 0,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fee_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "centre_id" TEXT NOT NULL,
    "child_id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "fee_schedule_id" TEXT NOT NULL,
    "booking_type" "BookingType" NOT NULL,
    "days_of_week" INTEGER[],
    "specific_date" DATE,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "absences" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "centre_id" TEXT NOT NULL,
    "child_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "is_allowable" BOOLEAN NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "absences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ccs_entitlements" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "centre_id" TEXT NOT NULL,
    "child_id" TEXT NOT NULL,
    "estimated_subsidy_percent" INTEGER NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ccs_entitlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "centre_id" TEXT NOT NULL,
    "child_id" TEXT NOT NULL,
    "cycle_start" DATE NOT NULL,
    "cycle_end" DATE NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "centre_id" TEXT NOT NULL,
    "child_id" TEXT NOT NULL,
    "invoice_id" TEXT,
    "entry_type" "LedgerEntryType" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "session_date" DATE,
    "source_fee_entry_id" TEXT,
    "reason_code" TEXT,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_records" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "centre_id" TEXT NOT NULL,
    "child_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'MOCK',
    "provider_payment_id" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "status" "PaymentStatus" NOT NULL,
    "ledger_entry_id" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fee_schedules_org_id_idx" ON "fee_schedules"("org_id");

-- CreateIndex
CREATE INDEX "fee_schedules_centre_id_idx" ON "fee_schedules"("centre_id");

-- CreateIndex
CREATE INDEX "bookings_org_id_idx" ON "bookings"("org_id");

-- CreateIndex
CREATE INDEX "bookings_centre_id_idx" ON "bookings"("centre_id");

-- CreateIndex
CREATE INDEX "bookings_child_id_idx" ON "bookings"("child_id");

-- CreateIndex
CREATE INDEX "absences_org_id_idx" ON "absences"("org_id");

-- CreateIndex
CREATE INDEX "absences_centre_id_idx" ON "absences"("centre_id");

-- CreateIndex
CREATE UNIQUE INDEX "absences_child_id_date_key" ON "absences"("child_id", "date");

-- CreateIndex
CREATE INDEX "ccs_entitlements_org_id_idx" ON "ccs_entitlements"("org_id");

-- CreateIndex
CREATE INDEX "ccs_entitlements_centre_id_idx" ON "ccs_entitlements"("centre_id");

-- CreateIndex
CREATE INDEX "ccs_entitlements_child_id_idx" ON "ccs_entitlements"("child_id");

-- CreateIndex
CREATE INDEX "invoices_org_id_idx" ON "invoices"("org_id");

-- CreateIndex
CREATE INDEX "invoices_centre_id_idx" ON "invoices"("centre_id");

-- CreateIndex
CREATE INDEX "invoices_child_id_idx" ON "invoices"("child_id");

-- CreateIndex
CREATE INDEX "ledger_entries_org_id_idx" ON "ledger_entries"("org_id");

-- CreateIndex
CREATE INDEX "ledger_entries_centre_id_idx" ON "ledger_entries"("centre_id");

-- CreateIndex
CREATE INDEX "ledger_entries_child_id_idx" ON "ledger_entries"("child_id");

-- CreateIndex
CREATE INDEX "ledger_entries_invoice_id_idx" ON "ledger_entries"("invoice_id");

-- CreateIndex
CREATE INDEX "ledger_entries_source_fee_entry_id_idx" ON "ledger_entries"("source_fee_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_records_provider_payment_id_key" ON "payment_records"("provider_payment_id");

-- CreateIndex
CREATE INDEX "payment_records_org_id_idx" ON "payment_records"("org_id");

-- CreateIndex
CREATE INDEX "payment_records_centre_id_idx" ON "payment_records"("centre_id");

-- CreateIndex
CREATE INDEX "payment_records_child_id_idx" ON "payment_records"("child_id");

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_child_id_fkey" FOREIGN KEY ("child_id") REFERENCES "children"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_fee_schedule_id_fkey" FOREIGN KEY ("fee_schedule_id") REFERENCES "fee_schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "absences" ADD CONSTRAINT "absences_child_id_fkey" FOREIGN KEY ("child_id") REFERENCES "children"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ccs_entitlements" ADD CONSTRAINT "ccs_entitlements_child_id_fkey" FOREIGN KEY ("child_id") REFERENCES "children"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_child_id_fkey" FOREIGN KEY ("child_id") REFERENCES "children"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Row-level security for Stage 3 billing tables (org_id-only tenant boundary
-- — see ADR 0001). invoices and ledger_entries are strictly append-only, the
-- same pattern as audit_log_entries: this is the ledger-immutability
-- guarantee the Delivery Plan §6.3 calls for ("issued invoices are
-- immutable; changes are made through credits/adjustments... never
-- overwritten"), enforced by Postgres grants, not just application code.
-- Configuration tables (fee_schedules, bookings, absences, ccs_entitlements)
-- are normal CRUD since they're administrative setup data, not financial facts.

GRANT SELECT, INSERT, UPDATE, DELETE ON fee_schedules, bookings, absences, ccs_entitlements TO childcare_app;

GRANT SELECT, INSERT ON invoices TO childcare_app;
GRANT SELECT, INSERT ON ledger_entries TO childcare_app;
GRANT SELECT, INSERT ON payment_records TO childcare_app;

ALTER TABLE fee_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE fee_schedules FORCE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings FORCE ROW LEVEL SECURITY;
ALTER TABLE absences ENABLE ROW LEVEL SECURITY;
ALTER TABLE absences FORCE ROW LEVEL SECURITY;
ALTER TABLE ccs_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE ccs_entitlements FORCE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;
ALTER TABLE ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_entries FORCE ROW LEVEL SECURITY;
ALTER TABLE payment_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_records FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_fee_schedules ON fee_schedules
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), ''));
CREATE POLICY tenant_isolation_bookings ON bookings
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), ''));
CREATE POLICY tenant_isolation_absences ON absences
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), ''));
CREATE POLICY tenant_isolation_ccs_entitlements ON ccs_entitlements
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), ''));
CREATE POLICY tenant_isolation_invoices ON invoices
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), ''));
CREATE POLICY tenant_isolation_ledger_entries ON ledger_entries
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), ''));
CREATE POLICY tenant_isolation_payment_records ON payment_records
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), ''));
