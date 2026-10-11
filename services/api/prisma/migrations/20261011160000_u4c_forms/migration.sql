CREATE TYPE "FormRequestStatus" AS ENUM ('PENDING', 'SIGNED', 'CANCELLED');

CREATE TABLE "form_templates" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "centre_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "fields" JSONB NOT NULL,
    "latest_version" INTEGER,
    "dirty" BOOLEAN NOT NULL DEFAULT true,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "form_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "form_template_versions" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "centre_id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "fields" JSONB NOT NULL,
    "published_by_user_id" TEXT NOT NULL,
    "published_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "form_template_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "form_requests" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "centre_id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "template_version" INTEGER NOT NULL,
    "child_id" TEXT NOT NULL,
    "guardian_user_id" TEXT NOT NULL,
    "due_date" DATE,
    "status" "FormRequestStatus" NOT NULL DEFAULT 'PENDING',
    "supersedes_submission_id" TEXT,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by_user_id" TEXT,
    CONSTRAINT "form_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "form_submissions" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "centre_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "template_version" INTEGER NOT NULL,
    "child_id" TEXT NOT NULL,
    "guardian_user_id" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "answers_hash" TEXT NOT NULL,
    "signer_typed_name" TEXT,
    "signature_image_ref" TEXT,
    "consent_given" BOOLEAN NOT NULL DEFAULT false,
    "signed_at" TIMESTAMP(3) NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,
    "supersedes_submission_id" TEXT,
    CONSTRAINT "form_submissions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "form_templates_org_id_idx" ON "form_templates"("org_id");
CREATE INDEX "form_templates_centre_id_idx" ON "form_templates"("centre_id");
CREATE UNIQUE INDEX "form_template_versions_template_id_version_key" ON "form_template_versions"("template_id", "version");
CREATE INDEX "form_template_versions_org_id_idx" ON "form_template_versions"("org_id");
CREATE INDEX "form_requests_org_id_idx" ON "form_requests"("org_id");
CREATE INDEX "form_requests_centre_id_status_idx" ON "form_requests"("centre_id", "status");
CREATE INDEX "form_requests_guardian_user_id_status_idx" ON "form_requests"("guardian_user_id", "status");
CREATE UNIQUE INDEX "form_submissions_request_id_key" ON "form_submissions"("request_id");
CREATE INDEX "form_submissions_org_id_idx" ON "form_submissions"("org_id");
CREATE INDEX "form_submissions_centre_id_child_id_idx" ON "form_submissions"("centre_id", "child_id");

-- Templates and requests change state; signed evidence and published versions never do.
GRANT SELECT, INSERT, UPDATE ON form_templates TO childcare_app;
GRANT SELECT, INSERT, UPDATE ON form_requests TO childcare_app;
GRANT SELECT, INSERT ON form_template_versions TO childcare_app;
GRANT SELECT, INSERT ON form_submissions TO childcare_app;
REVOKE UPDATE, DELETE ON form_template_versions FROM childcare_app;
REVOKE UPDATE, DELETE ON form_submissions FROM childcare_app;

CREATE FUNCTION forms_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable (% blocked)', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER form_submissions_immutable BEFORE UPDATE OR DELETE ON form_submissions
  FOR EACH ROW EXECUTE FUNCTION forms_immutable();
CREATE TRIGGER form_template_versions_immutable BEFORE UPDATE OR DELETE ON form_template_versions
  FOR EACH ROW EXECUTE FUNCTION forms_immutable();

ALTER TABLE form_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_templates FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_form_templates ON form_templates
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), ''));

ALTER TABLE form_template_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_template_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_form_template_versions ON form_template_versions
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), ''));

ALTER TABLE form_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_form_requests ON form_requests
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), ''));

ALTER TABLE form_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_submissions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_form_submissions ON form_submissions
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), ''));
