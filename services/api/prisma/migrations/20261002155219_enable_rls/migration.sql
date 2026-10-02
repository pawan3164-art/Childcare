-- Row-level security: the DB-enforced tenant boundary is org_id.
--
-- Scope note (documented tradeoff, see /CLAUDE.md and docs/adr):
-- `organisations`, `users` and `sessions` are intentionally NOT row-level-secured.
-- `users` is the identity table (login happens before an org is known — you
-- can't filter "which org does this email belong to" by org_id you don't have
-- yet) and holds no child/family/health/financial data, so excluding it is a
-- deliberate, narrow tradeoff rather than an oversight. Every table that holds
-- actual child, family, staffing, audit, sync or notification data IS
-- RLS-protected below. Centre/room/relationship-level access (e.g. an Area
-- Manager spanning multiple centres in one org) is enforced by
-- AuthorizationService in application code, not by RLS — see
-- src/common/tenancy/tenancy.service.ts.

-- Restricted runtime role: no BYPASSRLS, no UPDATE/DELETE on the audit log.
-- The app connects as this role at request time (DATABASE_APP_URL). Schema
-- migrations continue to run as the schema-owner role (DATABASE_URL), which
-- is a superuser in dev and therefore bypasses RLS by default.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'childcare_app') THEN
    CREATE ROLE childcare_app LOGIN PASSWORD 'childcare_app_dev_only';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE childcare TO childcare_app;
GRANT USAGE ON SCHEMA public TO childcare_app;

-- Base grants: full CRUD on tenant tables except the append-only audit log.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  centres,
  rooms,
  children,
  guardian_child_relationships,
  staff_room_assignments,
  sync_operations,
  notification_queue_items
TO childcare_app;

-- Identity tables: the app needs these for auth, but they are not RLS-protected
-- (see note above). Scope to what the app actually needs.
GRANT SELECT, INSERT, UPDATE ON organisations, users, sessions TO childcare_app;

-- Audit log is append-only at the DB level, not just by convention in code.
GRANT SELECT, INSERT ON audit_log_entries TO childcare_app;
REVOKE UPDATE, DELETE ON audit_log_entries FROM childcare_app;

-- Enable + force RLS (FORCE so even the table owner's queries made through
-- childcare_app are subject to policy — only a BYPASSRLS role or the table
-- owner acting outside FORCE scope skips it).
ALTER TABLE centres ENABLE ROW LEVEL SECURITY;
ALTER TABLE centres FORCE ROW LEVEL SECURITY;
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms FORCE ROW LEVEL SECURITY;
ALTER TABLE children ENABLE ROW LEVEL SECURITY;
ALTER TABLE children FORCE ROW LEVEL SECURITY;
ALTER TABLE guardian_child_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE guardian_child_relationships FORCE ROW LEVEL SECURITY;
ALTER TABLE staff_room_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_room_assignments FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_log_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log_entries FORCE ROW LEVEL SECURITY;
ALTER TABLE sync_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_operations FORCE ROW LEVEL SECURITY;
ALTER TABLE notification_queue_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_queue_items FORCE ROW LEVEL SECURITY;

-- Policy: a row is visible/writable only when its org_id matches the tenant
-- context set for the current transaction via
-- set_config('app.current_org_id', <uuid>, true) (see TenancyService.withTenant).
-- current_setting(..., true) returns NULL (not an error) when unset, and
-- NULL = org_id is never true, so a transaction with no tenant context set
-- sees zero rows rather than erroring or leaking data.
CREATE POLICY tenant_isolation_centres ON centres
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), ''));

CREATE POLICY tenant_isolation_rooms ON rooms
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), ''));

CREATE POLICY tenant_isolation_children ON children
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), ''));

CREATE POLICY tenant_isolation_guardian_child_relationships ON guardian_child_relationships
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), ''));

CREATE POLICY tenant_isolation_staff_room_assignments ON staff_room_assignments
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), ''));

CREATE POLICY tenant_isolation_audit_log_entries ON audit_log_entries
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), ''));

CREATE POLICY tenant_isolation_sync_operations ON sync_operations
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), ''));

CREATE POLICY tenant_isolation_notification_queue_items ON notification_queue_items
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), ''));
