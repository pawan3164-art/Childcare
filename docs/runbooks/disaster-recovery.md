# Disaster Recovery Runbook

Status: drafted and locally drilled 2026-10-03 (Stage 5 hardening). This is a **local proof-of-mechanics drill**, not a production DR test — no AWS infrastructure is deployed yet (ap-southeast-2 Sydney / ap-southeast-4 Melbourne per BRD §18, Delivery Plan §5). Re-run this drill for real once staging/production exist, and update the RPO/RTO numbers below from measurement, not estimate.

## Targets (BRD Appendix C OI-02 — still TBC; working defaults per `docs/open-items.md`)

- **RPO**: 15 minutes
- **RTO**: 4 hours

## What was actually drilled locally

1. `pg_dump -F c` of the dev database from inside the running Postgres container.
2. Copied the dump out to the host filesystem (simulating durable off-instance backup storage — S3 in production).
3. Stood up a completely fresh Postgres container (simulating a DR-region restore target with nothing on it).
4. Ran `pg_restore --no-owner` against the fresh instance.
5. Verified: table data restored correctly (spot-checked row counts), and all 27 Row-Level Security policies restored correctly as part of the schema.

## Finding from the drill (real, not hypothetical)

**The restore failed 44 `GRANT ... TO childcare_app` statements** with `role "childcare_app" does not exist`. `pg_dump`/`pg_restore` operate on a single database and do not include cluster-level roles — those come from `pg_dumpall --globals-only` or, in our case, from the Prisma migration that runs `CREATE ROLE childcare_app ...` (see `prisma/migrations/20261002155219_enable_rls/migration.sql`).

**Why this matters**: a DR restore that only replays the database dump produces a cluster where the application's own runtime role doesn't exist — the app cannot connect at all (`DATABASE_APP_URL` authentication fails) even though every table and every RLS policy restored perfectly. The failure mode is "RLS and data are fine, but nothing can query them," which is a worse debugging experience under incident pressure than a clean failure.

**The fix, drilled and confirmed working**: create the `childcare_app` role manually, then re-run `pg_restore` a second time (idempotent — it skips objects that already exist and this time succeeds on the `GRANT` statements). After that, the restricted role was confirmed to connect and RLS was confirmed to correctly scope a query to one organisation's data, not all of it.

**The real fix for production** (tracked as OI-15, not yet implemented): role/user provisioning for the database should move out of the Prisma migration and into infrastructure-as-code (Terraform), applied when the DR region's RDS instance is provisioned — *before* any backup is ever restored into it — the same way the primary region's role already needs to exist before the app's first deploy. The current migration-based role creation is fine for local dev convenience but is not how a real DR region should get its role.

## Recovery procedure (as it stands today — update once OI-15 lands)

1. Identify the most recent backup (production: automated snapshot/continuous backup per the chosen RDS configuration — not yet set up, see `docs/open-items.md` OI-10/future infra work).
2. Restore into a fresh Postgres instance in the DR region.
3. **Before the application connects**: ensure the `childcare_app` role exists with the correct grants. Until OI-15 is implemented, this means running the `enable_rls` and subsequent stage migrations' role/grant statements manually if they weren't captured in a globals dump.
4. Point `DATABASE_APP_URL` (and the migration-owner `DATABASE_URL`) at the restored instance.
5. Smoke-test: confirm `GET /health` responds, confirm a tenant-scoped query returns only that tenant's rows (the exact check performed in this drill).
6. Measure actual time elapsed against the 4-hour RTO target and actual data-loss window against the 15-minute RPO target; record both here after a real drill.

## Open items surfaced

- **OI-15** (new): move `childcare_app` role/grant provisioning from the Prisma migration into Terraform/IaC, so a DR region's database role exists independent of replaying application migration history. Added to `docs/open-items.md`.
- Real RPO/RTO measurement requires actual cloud infrastructure (OI-02, still TBC).
- Backup storage location/retention/encryption policy not yet defined — needs to be set when AWS infrastructure is provisioned.
