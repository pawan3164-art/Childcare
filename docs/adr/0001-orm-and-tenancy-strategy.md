# ADR 0001: ORM choice and tenant-isolation strategy

Status: Accepted (Stage 0)

## Context

The Delivery Plan calls for "PostgreSQL with row-level security; org_id and centre_id on every row, enforced by Postgres row-level security" as one of the five hard parts to get right early (see `Requirement and design/Next_Gen_Childcare_Delivery_Plan.docx` §6.2, §10). We needed to pick an ORM and a concrete mechanism for passing tenant context into Postgres RLS policies.

## Decision

- **ORM: Prisma.** Chosen for migration ergonomics (plain SQL migration files we can hand-edit for RLS/roles, which `prisma migrate dev --create-only` supports directly) and strong TypeScript types. TypeORM was the alternative; Prisma's migration file model fit the "write custom SQL into a generated migration" RLS pattern more directly.
- **Tenant context propagation: `set_config` inside a Prisma interactive transaction**, not raw `SET LOCAL` string interpolation. `TenancyService.withTenant()` (`src/common/tenancy/tenancy.service.ts`) wraps every tenant-scoped query in `prisma.$transaction(tx => ...)`, first running `SELECT set_config('app.current_org_id', $1, true)` with a real parameterized query (Prisma's tagged-template `$executeRaw` binds parameters; no string interpolation of untrusted values into SQL).
- **RLS boundary = org_id only.** Centre/room/relationship-level access (an Area Manager spanning multiple centres in one org) is enforced by `AuthorizationService` in application code, not by a second RLS dimension — see the comment in `src/common/tenancy/tenancy.service.ts`. This keeps the DB-enforced boundary simple (the one that must never be wrong — cross-organisation leakage) while keeping the more nuanced, role-dependent boundary (cross-centre within one org) in testable application code.
- **Privilege separation**: migrations run as a superuser-ish schema-owner role (`DATABASE_URL`); the running application connects as a restricted role, `childcare_app` (`DATABASE_APP_URL`), created in the RLS migration with `FORCE ROW LEVEL SECURITY` on every tenant table and `REVOKE UPDATE, DELETE` on `audit_log_entries` specifically — audit-log immutability is enforced by Postgres grants, not just by the absence of an update method in `AuditService`.
- **`users`, `sessions`, `organisations` are NOT row-level-secured.** Authentication resolves an email to a user before any org context is known — there's no tenant to filter by yet at that point in the request. These tables hold no child/family/health/financial data, so excluding them is a narrow, documented tradeoff (see the comment at the top of `prisma/migrations/*_enable_rls/migration.sql`), not an oversight. Every table that holds actual child, family, staffing, audit, sync, or notification data is RLS-protected.

## Consequences

- Every tenant-scoped repository call must go through `TenancyService.withTenant()`. There is no code path to query `children`/`rooms`/etc. directly through `PrismaService` without supplying a tenant context — by construction, not by convention.
- A query issued with no tenant context set returns zero rows rather than erroring or leaking data (verified in `test/access-control/tenant-isolation.spec.ts`).
- Each tenant-scoped operation costs one extra round-trip (the `set_config` calls) inside its transaction. Acceptable at Stage 0 scale; worth revisiting (e.g. connection-pool-level session variables) if it shows up in `childcare-performance-tester` results later.
- Multi-centre Area/Enterprise Manager access (BRD §3) is not yet modeled — `AuthorizationService.canAccessChild` only supports a single-centre `CENTRE_ADMIN`. Flagged as a known gap, not forgotten.
