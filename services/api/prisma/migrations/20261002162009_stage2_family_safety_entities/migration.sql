-- CreateEnum
CREATE TYPE "AdministrationStatus" AS ENUM ('CONFIRMED', 'PENDING_REVIEW', 'REJECTED');

-- CreateEnum
CREATE TYPE "IncidentSeverity" AS ENUM ('MINOR', 'MODERATE', 'SERIOUS');

-- CreateEnum
CREATE TYPE "IncidentReviewStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'REVIEWED');

-- CreateEnum
CREATE TYPE "MessageScope" AS ENUM ('ROOM', 'CENTRE', 'EMERGENCY');

-- CreateTable
CREATE TABLE "medication_authorizations" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "centre_id" TEXT NOT NULL,
    "child_id" TEXT NOT NULL,
    "medication_name" TEXT NOT NULL,
    "dosage_instructions" TEXT NOT NULL,
    "authorized_by_guardian_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "medication_authorizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medication_administrations" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "centre_id" TEXT NOT NULL,
    "authorization_id" TEXT NOT NULL,
    "administered_by_user_id" TEXT NOT NULL,
    "administered_at" TIMESTAMP(3) NOT NULL,
    "dosage_given" TEXT NOT NULL,
    "notes" TEXT,
    "status" "AdministrationStatus" NOT NULL DEFAULT 'CONFIRMED',
    "reviewed_by_user_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "medication_administrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "centre_id" TEXT NOT NULL,
    "child_id" TEXT NOT NULL,
    "severity" "IncidentSeverity" NOT NULL,
    "description" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "reported_by_user_id" TEXT NOT NULL,
    "review_status" "IncidentReviewStatus" NOT NULL DEFAULT 'OPEN',
    "reviewed_by_user_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "review_notes" TEXT,
    "corrected_incident_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incident_acknowledgements" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "incident_id" TEXT NOT NULL,
    "guardian_user_id" TEXT NOT NULL,
    "acknowledged_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incident_acknowledgements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "centre_id" TEXT NOT NULL,
    "room_id" TEXT,
    "scope" "MessageScope" NOT NULL,
    "author_user_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_acknowledgements" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "acknowledged_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_acknowledgements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "medication_authorizations_org_id_idx" ON "medication_authorizations"("org_id");

-- CreateIndex
CREATE INDEX "medication_authorizations_centre_id_idx" ON "medication_authorizations"("centre_id");

-- CreateIndex
CREATE INDEX "medication_authorizations_child_id_idx" ON "medication_authorizations"("child_id");

-- CreateIndex
CREATE INDEX "medication_administrations_org_id_idx" ON "medication_administrations"("org_id");

-- CreateIndex
CREATE INDEX "medication_administrations_centre_id_idx" ON "medication_administrations"("centre_id");

-- CreateIndex
CREATE INDEX "medication_administrations_authorization_id_administered_at_idx" ON "medication_administrations"("authorization_id", "administered_at");

-- CreateIndex
CREATE INDEX "incidents_org_id_idx" ON "incidents"("org_id");

-- CreateIndex
CREATE INDEX "incidents_centre_id_idx" ON "incidents"("centre_id");

-- CreateIndex
CREATE INDEX "incidents_child_id_idx" ON "incidents"("child_id");

-- CreateIndex
CREATE INDEX "incident_acknowledgements_org_id_idx" ON "incident_acknowledgements"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "incident_acknowledgements_incident_id_guardian_user_id_key" ON "incident_acknowledgements"("incident_id", "guardian_user_id");

-- CreateIndex
CREATE INDEX "messages_org_id_idx" ON "messages"("org_id");

-- CreateIndex
CREATE INDEX "messages_centre_id_idx" ON "messages"("centre_id");

-- CreateIndex
CREATE INDEX "message_acknowledgements_org_id_idx" ON "message_acknowledgements"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "message_acknowledgements_message_id_user_id_key" ON "message_acknowledgements"("message_id", "user_id");

-- AddForeignKey
ALTER TABLE "medication_authorizations" ADD CONSTRAINT "medication_authorizations_child_id_fkey" FOREIGN KEY ("child_id") REFERENCES "children"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_administrations" ADD CONSTRAINT "medication_administrations_authorization_id_fkey" FOREIGN KEY ("authorization_id") REFERENCES "medication_authorizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_child_id_fkey" FOREIGN KEY ("child_id") REFERENCES "children"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_acknowledgements" ADD CONSTRAINT "incident_acknowledgements_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_acknowledgements" ADD CONSTRAINT "message_acknowledgements_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-level security for Stage 2 tables (org_id-only tenant boundary — see
-- ADR 0001). Two different immutability patterns are used here, matching
-- what each entity actually needs:
--
-- 1. Pure append-only (no UPDATE at all): medication_authorizations content
--    rows aside, messages and acknowledgement tables never need editing —
--    a correction is a new message/ack, not an edit of history.
-- 2. Fact immutable, review metadata mutable: medication_administrations and
--    incidents. The event FACT (who/what/when) must never change once
--    recorded, but a reviewer's decision is legitimately appended after the
--    fact. Column-level GRANT UPDATE restricts this precisely — the core
--    fields have no UPDATE grant at all, only the review columns do.

GRANT SELECT, INSERT, UPDATE, DELETE ON medication_authorizations TO childcare_app;

GRANT SELECT, INSERT ON medication_administrations TO childcare_app;
GRANT UPDATE (status, reviewed_by_user_id, reviewed_at) ON medication_administrations TO childcare_app;

GRANT SELECT, INSERT ON incidents TO childcare_app;
GRANT UPDATE (review_status, reviewed_by_user_id, reviewed_at, review_notes) ON incidents TO childcare_app;

GRANT SELECT, INSERT ON incident_acknowledgements TO childcare_app;
GRANT SELECT, INSERT ON messages TO childcare_app;
GRANT SELECT, INSERT ON message_acknowledgements TO childcare_app;

ALTER TABLE medication_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE medication_authorizations FORCE ROW LEVEL SECURITY;
ALTER TABLE medication_administrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE medication_administrations FORCE ROW LEVEL SECURITY;
ALTER TABLE incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE incidents FORCE ROW LEVEL SECURITY;
ALTER TABLE incident_acknowledgements ENABLE ROW LEVEL SECURITY;
ALTER TABLE incident_acknowledgements FORCE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages FORCE ROW LEVEL SECURITY;
ALTER TABLE message_acknowledgements ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_acknowledgements FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_medication_authorizations ON medication_authorizations
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), ''));

CREATE POLICY tenant_isolation_medication_administrations ON medication_administrations
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), ''));

CREATE POLICY tenant_isolation_incidents ON incidents
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), ''));

CREATE POLICY tenant_isolation_incident_acknowledgements ON incident_acknowledgements
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), ''));

CREATE POLICY tenant_isolation_messages ON messages
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), ''));

CREATE POLICY tenant_isolation_message_acknowledgements ON message_acknowledgements
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), ''));
