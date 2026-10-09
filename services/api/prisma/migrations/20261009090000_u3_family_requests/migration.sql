-- CreateEnum
CREATE TYPE "CasualDayRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PickupNominationStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- AlterTable
ALTER TABLE "absences" ADD COLUMN "reported_by_user_id" TEXT;

-- CreateTable
CREATE TABLE "casual_day_requests" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "centre_id" TEXT NOT NULL,
    "child_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "CasualDayRequestStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "requested_by_user_id" TEXT NOT NULL,
    "decided_by_user_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "decline_reason" TEXT,
    "booking_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "casual_day_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pickup_nominations" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "centre_id" TEXT NOT NULL,
    "child_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "person_name" TEXT NOT NULL,
    "person_phone" TEXT,
    "note" TEXT,
    "status" "PickupNominationStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by_user_id" TEXT NOT NULL,
    "verified_by_user_id" TEXT,
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pickup_nominations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "casual_day_requests_org_id_idx" ON "casual_day_requests"("org_id");

-- CreateIndex
CREATE INDEX "casual_day_requests_centre_id_status_idx" ON "casual_day_requests"("centre_id", "status");

-- CreateIndex
CREATE INDEX "casual_day_requests_child_id_date_idx" ON "casual_day_requests"("child_id", "date");

-- CreateIndex
CREATE INDEX "pickup_nominations_org_id_idx" ON "pickup_nominations"("org_id");

-- CreateIndex
CREATE INDEX "pickup_nominations_centre_id_date_idx" ON "pickup_nominations"("centre_id", "date");

-- CreateIndex
CREATE INDEX "pickup_nominations_child_id_date_idx" ON "pickup_nominations"("child_id", "date");

-- One live request per child per day, even under concurrent submits
-- (declined and cancelled requests do not block a new one). Prisma cannot
-- express a partial index, so it lives here only.
CREATE UNIQUE INDEX "casual_day_requests_live_child_date_key" ON "casual_day_requests"("child_id", "date") WHERE "status" IN ('PENDING', 'APPROVED');

-- AddForeignKey
ALTER TABLE "casual_day_requests" ADD CONSTRAINT "casual_day_requests_child_id_fkey" FOREIGN KEY ("child_id") REFERENCES "children"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pickup_nominations" ADD CONSTRAINT "pickup_nominations_child_id_fkey" FOREIGN KEY ("child_id") REFERENCES "children"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Tenant isolation. Requests and nominations change status but are never deleted.
GRANT SELECT, INSERT, UPDATE ON casual_day_requests, pickup_nominations TO childcare_app;
ALTER TABLE casual_day_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE casual_day_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE pickup_nominations ENABLE ROW LEVEL SECURITY;
ALTER TABLE pickup_nominations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_casual_day_requests ON casual_day_requests
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), ''));
CREATE POLICY tenant_isolation_pickup_nominations ON pickup_nominations
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), ''));
