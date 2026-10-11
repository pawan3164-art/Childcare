-- CreateEnum
CREATE TYPE "DomainStatus" AS ENUM ('PENDING', 'ACTIVE');

-- CreateTable
CREATE TABLE "organisation_brands" (
    "org_id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "primary_color" TEXT NOT NULL,
    "welcome_message" TEXT,
    "philosophy" TEXT,
    "logo_data" BYTEA,
    "logo_content_type" TEXT,
    "logo_version" INTEGER NOT NULL DEFAULT 0,
    "updated_by_user_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organisation_brands_pkey" PRIMARY KEY ("org_id")
);

-- CreateTable
CREATE TABLE "organisation_domains" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "status" "DomainStatus" NOT NULL DEFAULT 'PENDING',
    "verification_token" TEXT NOT NULL,
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organisation_domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organisation_plans" (
    "org_id" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "valid_until" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organisation_plans_pkey" PRIMARY KEY ("org_id")
);

-- CreateTable
CREATE TABLE "centre_module_settings" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "centre_id" TEXT NOT NULL,
    "module_key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "updated_by_user_id" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "centre_module_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organisation_domains_hostname_key" ON "organisation_domains"("hostname");

-- CreateIndex
CREATE INDEX "organisation_domains_org_id_idx" ON "organisation_domains"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "centre_module_settings_centre_id_module_key_key" ON "centre_module_settings"("centre_id", "module_key");

-- CreateIndex
CREATE INDEX "centre_module_settings_org_id_idx" ON "centre_module_settings"("org_id");

-- Brand, domains and plans are read before an organisation is known (public sign-in screens, the
-- certificate check, the plan guard), so like users and sessions they sit outside row-level security;
-- every write is checked against the caller's own organisation in application code.
GRANT SELECT, INSERT, UPDATE ON organisation_brands, organisation_plans TO childcare_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON organisation_domains TO childcare_app;

-- Module settings are ordinary tenant data.
GRANT SELECT, INSERT, UPDATE ON centre_module_settings TO childcare_app;
ALTER TABLE centre_module_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE centre_module_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_centre_module_settings ON centre_module_settings
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), ''));
