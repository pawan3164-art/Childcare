# Next-Gen Childcare Platform

Childcare management + family experience platform for the Australian market (parent app, educator app, centre web portal). Source requirements:

- `Requirement and design/Next_Gen_Childcare_BRD_v2.1.docx` — Business Requirements Document (authoritative scope, priorities, acceptance criteria).
- `Requirement and design/Next_Gen_Childcare_Delivery_Plan.docx` — original delivery plan (team-scale reference; this repo follows the re-sequenced solo/small-team build order below, not its parallel-squad staffing).
- `docs/open-items.md` — BRD Appendix C open items (OI-01..OI-08) and their current working defaults.
- `docs/performance-slas.md` — draft performance targets.

## Execution model

Solo/small-team build with Claude Code as primary implementer. Work proceeds **sequentially through stages** (0 Foundations → 1 Care loop → 2 Family & safety → 3 Money → 4 CCS → 5 Hardening → Phase 2), not as parallel squads. See the approved plan for the full stage breakdown; a condensed version lives in this file so it travels with the code.

## Stack

- **Mobile** (parent + educator apps): React Native / Expo, SQLite-based local DB with a sync layer.
- **Web portal**: Next.js, TypeScript.
- **Backend**: NestJS, modular monolith (single deployable, strict module boundaries: identity/tenancy, care, family/communication, medication/incidents, billing/ledger, ccs-integration, notifications).
- **Database**: PostgreSQL with row-level security (RLS) for tenant isolation. Money amounts stored as integer cents.
- **Media**: Private S3-style buckets, short-lived signed URLs.
- **Async**: Queue-based workers for notifications, media processing, CCS jobs, sync fan-out.
- **Hosting**: AWS ap-southeast-2 (Sydney), DR in ap-southeast-4 (Melbourne). Australian data residency is a hard requirement (BRD §18) — no personal data leaves Australian regions without a documented APP 8 assessment.
- **CCS & payments**: built against **mocked** interfaces first (see below); real sandbox/production credentials swapped in once registration (OI-05) and gateway selection (OI-06) resolve.

## TDD-first rule

**Write the test before the feature it validates exists.** Each build stage starts with the relevant test suite (red), then the implementation (green). Use the `childcare-test-runner` agent for this — it owns both writing tests ahead of code and running the suite on request. Never implement a stage's listed scope before its test suite exists.

## Observability & logging standard (non-negotiable, starts Stage 0)

The platform must be highly monitorable — this is a foundation decision, not an afterthought:

- **Structured JSON logging everywhere** (e.g. `pino` for Node/NestJS), not free text.
- Every log line carries: timestamp, service/module name, correlation/request ID, actor (user id + role where applicable), outcome, duration in ms.
- **Every API endpoint and background job logs entry, exit and duration automatically** via middleware — not opt-in per route.
- **Correlation IDs propagate** mobile app → API → async workers, so one user action is traceable end-to-end (especially across offline-sync and notification pipelines).
- **OpenTelemetry tracing + metrics from day one**; Sentry (or equivalent) on both mobile apps and the API.
- **Privacy guardrail**: never log child PII, payment card data, or full message/photo content. Log identifiers (`child_id`, `centre_id`), not personal content. This is a checked item for `childcare-security-reviewer`.

## Definition of done (every stage)

- Tests green via `childcare-test-runner`.
- No endpoint/background job ships without structured entry/exit/duration logging.
- Sensitive actions write to the append-only audit log.
- No high/critical findings from `childcare-security-reviewer` on touched modules.
- New user-facing flows checked against `docs/performance-slas.md` via `childcare-performance-tester`.

## The three agents (`.claude/agents/`)

All manual-trigger only for now; wired into CI automation after Phase 1 completes.

- **`childcare-test-runner`** — writes tests before features, runs the suite on request.
- **`childcare-security-reviewer`** — RBAC/tenant isolation, audit coverage, PCI scope, secrets, injection. Manual only.
- **`childcare-performance-tester`** — load/latency tests against `docs/performance-slas.md`. Manual only; mandatory at Stage 5 (Hardening).

## Build sequence (condensed — see the approved plan for full detail)

0. **Foundations** — domain model (Org→Centre→Room→Child→Guardian), Postgres+RLS, identity/MFA, central authz, append-only audit log, sync engine skeleton, notification skeleton, logging/tracing wired in before any feature code.
1. **Care loop** — child/family/room mgmt, attendance, group-first care logging, offline-first educator app, photo capture, parent Child-at-a-Glance.
2. **Family & safety** — messaging/emergency broadcast, notification priority/digest/fallback, digital forms, medication (hard-conflict), incidents, pickup mgmt, core reporting. Resolve OI-04 here.
3. **Money** — fee schedules, bookings/absences, invoices (immutable), family ledger, payments (mocked gateway), explainable invoice, reconciliation.
4. **CCS integration** — isolated module, mocked Services Australia responses, source-tagging (estimated vs confirmed), swap to real sandbox once OI-05 resolves.
5. **Hardening** — security review, load testing, DR drill, accessibility audit (WCAG 2.2 AA), PIA. End of stage: wire agents into CI.
6. **Phase 2** — Learning/EYLF, enrolment/waitlist, staff & ratios (§13A), rostering.

## Prompt log

Every user prompt in this project is logged to `All_Prompts.md` automatically via a `UserPromptSubmit` hook (`.claude/hooks/log-prompt.ps1`). Don't disable or bypass this without the user's explicit request.
