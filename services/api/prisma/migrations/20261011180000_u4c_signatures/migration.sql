CREATE TABLE "form_signatures" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "centre_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "guardian_user_id" TEXT NOT NULL,
    "strokes" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "form_signatures_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "form_signatures_org_id_idx" ON "form_signatures"("org_id");
CREATE INDEX "form_signatures_request_id_idx" ON "form_signatures"("request_id");

-- Insert-only: a captured signature is evidence and is never changed or removed by the application.
GRANT SELECT, INSERT ON form_signatures TO childcare_app;

ALTER TABLE form_signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_signatures FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_form_signatures ON form_signatures
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), ''));
