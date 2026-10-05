-- CreateTable
CREATE TABLE "checklist_templates" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "centre_id" TEXT NOT NULL,
    "room_id" TEXT,
    "name" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checklist_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_completions" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "centre_id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "template_name" TEXT NOT NULL,
    "results" JSONB NOT NULL,
    "failed_count" INTEGER NOT NULL,
    "completed_by_user_id" TEXT NOT NULL,
    "completed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checklist_completions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "checklist_templates_org_id_idx" ON "checklist_templates"("org_id");

-- CreateIndex
CREATE INDEX "checklist_templates_centre_id_active_idx" ON "checklist_templates"("centre_id", "active");

-- CreateIndex
CREATE INDEX "checklist_completions_org_id_idx" ON "checklist_completions"("org_id");

-- CreateIndex
CREATE INDEX "checklist_completions_room_id_completed_at_idx" ON "checklist_completions"("room_id", "completed_at");

-- AddForeignKey
ALTER TABLE "checklist_completions" ADD CONSTRAINT "checklist_completions_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "checklist_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Tenant isolation. Templates can only be archived (active flag);
-- completions are append-only for the app role (CMP-009).
GRANT SELECT, INSERT ON checklist_templates TO childcare_app;
GRANT UPDATE (active) ON checklist_templates TO childcare_app;
GRANT SELECT, INSERT ON checklist_completions TO childcare_app;
ALTER TABLE checklist_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE checklist_templates FORCE ROW LEVEL SECURITY;
ALTER TABLE checklist_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE checklist_completions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_checklist_templates ON checklist_templates
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), ''));
CREATE POLICY tenant_isolation_checklist_completions ON checklist_completions
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), ''));
