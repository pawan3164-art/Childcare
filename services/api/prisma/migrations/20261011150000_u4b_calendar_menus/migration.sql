CREATE TYPE "MenuMeal" AS ENUM ('MORNING_TEA', 'LUNCH', 'AFTERNOON_TEA', 'LATE_SNACK');

CREATE TABLE "centre_events" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "centre_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3),
    "all_day" BOOLEAN NOT NULL DEFAULT false,
    "room_id" TEXT,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by_user_id" TEXT,
    "cancel_reason" TEXT,
    CONSTRAINT "centre_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "menu_items" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "centre_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "meal" "MenuMeal" NOT NULL,
    "description" TEXT NOT NULL,
    "allergen_notes" TEXT,
    "updated_by_user_id" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "menu_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "centre_events_org_id_idx" ON "centre_events"("org_id");
CREATE INDEX "centre_events_centre_id_starts_at_idx" ON "centre_events"("centre_id", "starts_at");
CREATE UNIQUE INDEX "menu_items_centre_id_date_meal_key" ON "menu_items"("centre_id", "date", "meal");
CREATE INDEX "menu_items_org_id_idx" ON "menu_items"("org_id");

-- Events are never deleted (cancel instead); menus are information and can be cleared.
GRANT SELECT, INSERT, UPDATE ON centre_events TO childcare_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON menu_items TO childcare_app;

ALTER TABLE centre_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE centre_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_centre_events ON centre_events
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), ''));

ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_menu_items ON menu_items
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), ''));
