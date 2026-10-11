CREATE TYPE "PaymentAttemptStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

CREATE TABLE "payment_attempts" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "centre_id" TEXT NOT NULL,
    "child_id" TEXT NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "status" "PaymentAttemptStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT NOT NULL,
    "provider_payment_id" TEXT,
    "amount_cents" INTEGER NOT NULL,
    "payment_record_id" TEXT,
    "message" TEXT,
    "card_brand" TEXT,
    "card_last4" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payment_attempts_org_id_idempotency_key_key" ON "payment_attempts"("org_id", "idempotency_key");
CREATE INDEX "payment_attempts_child_id_idx" ON "payment_attempts"("child_id");

-- Attempts are a record of what was charged: they can be completed but never deleted.
GRANT SELECT, INSERT, UPDATE ON payment_attempts TO childcare_app;

ALTER TABLE payment_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_attempts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_payment_attempts ON payment_attempts
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), ''));
