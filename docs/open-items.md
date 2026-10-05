# Open Items (from BRD v2.2 Appendix C)

Tracked here so they're resolved deliberately rather than silently defaulted. Working defaults are used until the user confirms otherwise — update this file (not just memory) when a decision is made.

| # | Item | Working default (until confirmed) | Blocks |
|---|---|---|---|
| OI-01 | Performance targets (p95 latency, app start time, concurrent users, invoice-run duration) | See `docs/performance-slas.md` (Delivery Plan defaults: p95 < 500ms) | Stage 0 perf baseline, Stage 5 load test gate |
| OI-02 | RPO and RTO values for disaster recovery | RPO 15 min, RTO 4 hours | Stage 5 DR drill |
| OI-03 | Accessibility standard and conformance level | WCAG 2.2 AA | Stage 5 accessibility audit |
| OI-04 | Whether basic observation capture (EDU-004/005) is needed in Phase 1, given learning workflows are Phase 2 | **Resolved 2026-10-05**: learning moves into Phase 1, delivered through the family feed (stage U2), following OWNA's approach. BRD v2.2 §10, §24 | — |
| OI-05 | CCS registration pathway and timeline; contingency if not achieved before Phase 1 go-live | Open — mock CCS behind internal interface until resolved (user decision) | Stage 4 (real integration) |
| OI-06 | Payment gateway selection (card + BECS direct debit) | **Resolved 2026-10-05**: Fat Zebra primary, Ezidebit fallback, Stripe ruled out (US data transfer). See ADR 0006 | Merchant account + sandbox credentials needed from the business before real integration testing (U5) |
| OI-07 | Validation of ratio and qualification rules per jurisdiction (BRD §13A.2) | Indicative values in BRD table only; must validate against ACECQA calculator | Phase 2 ratio engine |
| OI-08 | Data migration scope and source systems for the post-MVP phase | Deferred — out of scope for MVP | Future phase only |
| OI-09 | Real media storage: file upload (multer/equivalent), EXIF/GPS stripping, private bucket + short-lived signed URLs (BRD §17). Stage 1 implemented and tested the access-control logic (multi-child tag visibility) but treats `storageKey` as an opaque stub — no real file bytes are handled yet. | **Resolved 2026-10-05**: S3-compatible storage behind an `ObjectStorage` interface; AWS S3 ap-southeast-2 when deployed, SeaweedFS S3 gateway locally; `sharp` re-encode strips EXIF/GPS; 5-minute presigned URLs. See ADR 0004 | **Built 2026-10-05** (U1): upload, EXIF/GPS strip, signed view URLs, audit, group-photo consent. Video upload not built yet (needs a transcoding worker) |
| OI-10 | Mobile apps (parent/educator) and the web portal are not yet scaffolded — Stages 0–1 built and tested the backend only, per the Delivery Plan's framing that the hard parts are server-side (sync, authz, ledger) not the screens. | Open | Needed before any UI can be demoed; does not block further backend stages |
| OI-11 | Digital forms and e-signature (PAR-007) not yet implemented — Stage 2 prioritised medication hard-conflict, incident immutability and emergency broadcast per the stage's explicit DoD, which don't name forms. | **Resolved 2026-10-05**: in-house forms engine with immutable signed submissions and signature evidence. Legal review of the signing method still required before pilot. See ADR 0005 | Built in stage U4 |

Stage 2 simplification, not a BRD gap: routine (ROOM/CENTRE-scope) messages don't fan out push notifications yet — only EMERGENCY-scope does, which is the safety-relevant path BRD §16 calls out explicitly.

| # | Item | Working default (until confirmed) | Blocks |
|---|---|---|---|
| OI-12 | Real payment gateway (card + BECS via a PCI-DSS provider, tokenisation) — Stage 3 built `PaymentsService.processWebhook()` against a mocked gateway with full idempotency/ledger correctness, so the integration point is ready, but no real gateway account exists | Gateway selected (see OI-06, ADR 0006). Still open: merchant account and sandbox credentials; the `FatZebraGateway` adapter is unverified against the real sandbox until then | Pilot readiness; stage U5 |
| OI-13 | CCS subsidy calculation is a flat `estimatedSubsidyPercent` per child, not the real hourly-rate-cap/withholding CCS formula — adequate to prove the ledger's estimated-vs-confirmed netting logic, not a real entitlement calculator | Open — real calculation arrives with Stage 4's CCS integration | Stage 4 |

Stage 3 simplification, not a BRD gap: fee schedules are chosen explicitly per booking by an admin (not re-resolved by the child's current age at invoice time) — correct by construction as long as admins create a new booking when a child moves age bands, per ADR 0002.

| # | Item | Working default (until confirmed) | Blocks |
|---|---|---|---|
| OI-14 | Real Services Australia CCS registration, PRODA auth and conformance testing (BIL-005, §21) — Stage 4 built `CcsService` against `MockCcsGateway` behind the `CcsGateway` interface, so the integration point (submit → accept/reject → confirmed ledger entry → resubmission) is built and tested; swapping in a real gateway implementation touches one binding in `ccs.module.ts` | Open — see OI-05 | Pilot readiness, not a Stage 4 blocker |

Stage 4 simplification, not a BRD gap: the mock gateway returns a flat confirmed-subsidy percentage and an arbitrary Sunday-rejection rule, purely to exercise the accept/reject/resubmit pipeline deterministically — not a model of real CCS adjudication rules.

| # | Item | Working default (until confirmed) | Blocks |
|---|---|---|---|
| OI-15 | `childcare_app` DB role/grant provisioning lives in a Prisma migration, not infrastructure-as-code. A real DR drill (performed locally, see `docs/runbooks/disaster-recovery.md`) found that restoring a database backup into a fresh Postgres instance fails 44 GRANT statements because the role doesn't exist there yet — `pg_dump`/`pg_restore` don't carry cluster-level roles. | Open — local workaround (create the role manually, re-run restore) confirmed working | Before any real DR region is provisioned |
| OI-16 | MFA is available (TOTP enrolment) but not enforced for admin/staff roles — a privileged account can still log in with password only. BRD §18 requires MFA "for privileged/admin accounts." | Open | Before pilot |
| OI-17 | No data retention/deletion policy or automated purge job exists (BRD §18). No self-service data export/correction flow for guardians (BRD §18, APP 12/13). | Open | Before pilot; see `docs/runbooks/privacy-impact-assessment.md` §4-5 |
| OI-18 | Read access to child/family/medical/billing records is not audit-logged — only denied access attempts and writes are. Flagged in both the Stage 5 security review and the breach-response runbook as a gap that would limit incident-scope assessment. | Open — deliberate-looking pattern that needs an explicit product decision, not an oversight to silently fix | Before pilot, or explicitly accepted as a risk |
| OI-19 | Payroll providers to integrate with for timesheet export (BRD v2.2 §13B.4). Decision 2026-10-05: integrate with existing payroll providers, do not build payroll. | Open — which providers | Phase 2C/2D (timesheets) |

Stage 5 hardening note: a manual security review (the project's own `childcare-security-reviewer` subagent could not be invoked this session — see commit history) found and fixed session-revocation, auth rate-limiting, and sync/direct-API audit-logging parity gaps. A local DR drill (backup → fresh-instance restore → RLS-scoped query verified) and a local-dev performance baseline were also completed — see `docs/runbooks/` and `docs/performance-slas.md`. Real pen testing, a real DR drill against deployed cloud infrastructure, and a real WCAG audit against built UI all remain outstanding and require infrastructure/UI that doesn't exist yet.

Revisit this file at the start of each stage listed in the "Blocks" column.
