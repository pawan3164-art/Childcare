-- CreateTable
CREATE TABLE "direct_threads" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "centre_id" TEXT NOT NULL,
    "child_id" TEXT NOT NULL,
    "guardian_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "guardian_last_read_at" TIMESTAMP(3),
    "staff_last_read_at" TIMESTAMP(3),

    CONSTRAINT "direct_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "direct_messages" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "author_user_id" TEXT NOT NULL,
    "from_staff" BOOLEAN NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "direct_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "direct_threads_org_id_idx" ON "direct_threads"("org_id");

-- CreateIndex
CREATE INDEX "direct_threads_centre_id_last_message_at_idx" ON "direct_threads"("centre_id", "last_message_at");

-- CreateIndex
CREATE UNIQUE INDEX "direct_threads_child_id_guardian_user_id_key" ON "direct_threads"("child_id", "guardian_user_id");

-- CreateIndex
CREATE INDEX "direct_messages_org_id_idx" ON "direct_messages"("org_id");

-- CreateIndex
CREATE INDEX "direct_messages_thread_id_created_at_idx" ON "direct_messages"("thread_id", "created_at");

-- AddForeignKey
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "direct_threads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Tenant isolation. Messages are append-only for the app role; threads only
-- update their timestamps.
GRANT SELECT, INSERT ON direct_threads TO childcare_app;
GRANT UPDATE (last_message_at, guardian_last_read_at, staff_last_read_at) ON direct_threads TO childcare_app;
GRANT SELECT, INSERT ON direct_messages TO childcare_app;
ALTER TABLE direct_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE direct_threads FORCE ROW LEVEL SECURITY;
ALTER TABLE direct_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE direct_messages FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_direct_threads ON direct_threads
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), ''));
CREATE POLICY tenant_isolation_direct_messages ON direct_messages
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), ''));
