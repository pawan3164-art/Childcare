-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('PLATFORM_ADMIN', 'ORG_ADMIN', 'CENTRE_ADMIN', 'EDUCATOR', 'PARENT');

-- CreateEnum
CREATE TYPE "RelationshipType" AS ENUM ('PARENT', 'GUARDIAN', 'AUTHORIZED_PICKUP');

-- CreateEnum
CREATE TYPE "AuditOutcome" AS ENUM ('SUCCESS', 'DENIED', 'FAILURE');

-- CreateEnum
CREATE TYPE "SyncOperationType" AS ENUM ('CREATE', 'UPDATE', 'DELETE');

-- CreateEnum
CREATE TYPE "SyncOperationStatus" AS ENUM ('APPLIED', 'CONFLICT', 'REJECTED');

-- CreateEnum
CREATE TYPE "NotificationPriority" AS ENUM ('URGENT', 'ACTION_REQUIRED', 'CHILD_UPDATE', 'GENERAL');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('PUSH', 'SMS', 'EMAIL');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'OPENED', 'ACKNOWLEDGED', 'FAILED');

-- CreateTable
CREATE TABLE "organisations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organisations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "centres" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Australia/Sydney',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "centres_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rooms" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "centre_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "age_band_min_months" INTEGER,
    "age_band_max_months" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "children" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "centre_id" TEXT NOT NULL,
    "room_id" TEXT,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "date_of_birth" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "children_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "org_id" TEXT,
    "centre_id" TEXT,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "mfa_secret" TEXT,
    "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_room_assignments" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "centre_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,

    CONSTRAINT "staff_room_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guardian_child_relationships" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "centre_id" TEXT NOT NULL,
    "guardian_user_id" TEXT NOT NULL,
    "child_id" TEXT NOT NULL,
    "relationship_type" "RelationshipType" NOT NULL,
    "can_view_media" BOOLEAN NOT NULL DEFAULT true,
    "can_view_billing" BOOLEAN NOT NULL DEFAULT false,
    "can_pickup" BOOLEAN NOT NULL DEFAULT false,
    "is_restricted" BOOLEAN NOT NULL DEFAULT false,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guardian_child_relationships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log_entries" (
    "id" TEXT NOT NULL,
    "org_id" TEXT,
    "centre_id" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_user_id" TEXT,
    "actor_role" "UserRole",
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "outcome" "AuditOutcome" NOT NULL,
    "metadata" JSONB,
    "correlation_id" TEXT,

    CONSTRAINT "audit_log_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_operations" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "centre_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "client_operation_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "operation_type" "SyncOperationType" NOT NULL,
    "payload" JSONB NOT NULL,
    "author_user_id" TEXT NOT NULL,
    "client_timestamp" TIMESTAMP(3) NOT NULL,
    "server_timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "SyncOperationStatus" NOT NULL,
    "conflict_reason" TEXT,

    CONSTRAINT "sync_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_queue_items" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "centre_id" TEXT,
    "recipient_user_id" TEXT NOT NULL,
    "priority" "NotificationPriority" NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'QUEUED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "opened_at" TIMESTAMP(3),
    "acknowledged_at" TIMESTAMP(3),

    CONSTRAINT "notification_queue_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "centres_org_id_idx" ON "centres"("org_id");

-- CreateIndex
CREATE INDEX "rooms_org_id_idx" ON "rooms"("org_id");

-- CreateIndex
CREATE INDEX "rooms_centre_id_idx" ON "rooms"("centre_id");

-- CreateIndex
CREATE INDEX "children_org_id_idx" ON "children"("org_id");

-- CreateIndex
CREATE INDEX "children_centre_id_idx" ON "children"("centre_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_org_id_idx" ON "users"("org_id");

-- CreateIndex
CREATE INDEX "users_centre_id_idx" ON "users"("centre_id");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "staff_room_assignments_org_id_idx" ON "staff_room_assignments"("org_id");

-- CreateIndex
CREATE INDEX "staff_room_assignments_centre_id_idx" ON "staff_room_assignments"("centre_id");

-- CreateIndex
CREATE INDEX "guardian_child_relationships_org_id_idx" ON "guardian_child_relationships"("org_id");

-- CreateIndex
CREATE INDEX "guardian_child_relationships_centre_id_idx" ON "guardian_child_relationships"("centre_id");

-- CreateIndex
CREATE INDEX "guardian_child_relationships_child_id_idx" ON "guardian_child_relationships"("child_id");

-- CreateIndex
CREATE UNIQUE INDEX "guardian_child_relationships_guardian_user_id_child_id_key" ON "guardian_child_relationships"("guardian_user_id", "child_id");

-- CreateIndex
CREATE INDEX "audit_log_entries_org_id_idx" ON "audit_log_entries"("org_id");

-- CreateIndex
CREATE INDEX "audit_log_entries_centre_id_idx" ON "audit_log_entries"("centre_id");

-- CreateIndex
CREATE INDEX "audit_log_entries_entity_type_entity_id_idx" ON "audit_log_entries"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_log_entries_actor_user_id_idx" ON "audit_log_entries"("actor_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "sync_operations_idempotency_key_key" ON "sync_operations"("idempotency_key");

-- CreateIndex
CREATE INDEX "sync_operations_org_id_idx" ON "sync_operations"("org_id");

-- CreateIndex
CREATE INDEX "sync_operations_centre_id_idx" ON "sync_operations"("centre_id");

-- CreateIndex
CREATE INDEX "sync_operations_entity_type_entity_id_idx" ON "sync_operations"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "notification_queue_items_org_id_idx" ON "notification_queue_items"("org_id");

-- CreateIndex
CREATE INDEX "notification_queue_items_recipient_user_id_idx" ON "notification_queue_items"("recipient_user_id");

-- CreateIndex
CREATE INDEX "notification_queue_items_status_idx" ON "notification_queue_items"("status");

-- AddForeignKey
ALTER TABLE "centres" ADD CONSTRAINT "centres_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_centre_id_fkey" FOREIGN KEY ("centre_id") REFERENCES "centres"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "children" ADD CONSTRAINT "children_centre_id_fkey" FOREIGN KEY ("centre_id") REFERENCES "centres"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "children" ADD CONSTRAINT "children_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organisations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_room_assignments" ADD CONSTRAINT "staff_room_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardian_child_relationships" ADD CONSTRAINT "guardian_child_relationships_guardian_user_id_fkey" FOREIGN KEY ("guardian_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardian_child_relationships" ADD CONSTRAINT "guardian_child_relationships_child_id_fkey" FOREIGN KEY ("child_id") REFERENCES "children"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
