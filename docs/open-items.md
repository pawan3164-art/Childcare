# Open Items (from BRD v2.1 Appendix C)

Tracked here so they're resolved deliberately rather than silently defaulted. Working defaults are used until the user confirms otherwise — update this file (not just memory) when a decision is made.

| # | Item | Working default (until confirmed) | Blocks |
|---|---|---|---|
| OI-01 | Performance targets (p95 latency, app start time, concurrent users, invoice-run duration) | See `docs/performance-slas.md` (Delivery Plan defaults: p95 < 500ms) | Stage 0 perf baseline, Stage 5 load test gate |
| OI-02 | RPO and RTO values for disaster recovery | RPO 15 min, RTO 4 hours | Stage 5 DR drill |
| OI-03 | Accessibility standard and conformance level | WCAG 2.2 AA | Stage 5 accessibility audit |
| OI-04 | Whether basic observation capture (EDU-004/005) is needed in Phase 1, given learning workflows are Phase 2 | Open — decide before/at Stage 2 | Stage 2 scope |
| OI-05 | CCS registration pathway and timeline; contingency if not achieved before Phase 1 go-live | Open — mock CCS behind internal interface until resolved (user decision) | Stage 4 (real integration) |
| OI-06 | Payment gateway selection (card + BECS direct debit) | Open — mock gateway behind internal interface until resolved | Stage 3/4 (real integration) |
| OI-07 | Validation of ratio and qualification rules per jurisdiction (BRD §13A.2) | Indicative values in BRD table only; must validate against ACECQA calculator | Phase 2 ratio engine |
| OI-08 | Data migration scope and source systems for the post-MVP phase | Deferred — out of scope for MVP | Future phase only |
| OI-09 | Real media storage: file upload (multer/equivalent), EXIF/GPS stripping, private bucket + short-lived signed URLs (BRD §17). Stage 1 implemented and tested the access-control logic (multi-child tag visibility) but treats `storageKey` as an opaque stub — no real file bytes are handled yet. | Open — needs an object storage choice (local dev vs S3-compatible) before building | Pilot readiness; not a Stage 1 blocker since the permission logic is what carried the risk |
| OI-10 | Mobile apps (parent/educator) and the web portal are not yet scaffolded — Stages 0–1 built and tested the backend only, per the Delivery Plan's framing that the hard parts are server-side (sync, authz, ledger) not the screens. | Open | Needed before any UI can be demoed; does not block further backend stages |
| OI-11 | Digital forms and e-signature (PAR-007) not yet implemented — Stage 2 prioritised medication hard-conflict, incident immutability and emergency broadcast per the stage's explicit DoD, which don't name forms. | Open | Not a Stage 2 blocker; revisit before Phase 1 feature-complete |

Stage 2 simplification, not a BRD gap: routine (ROOM/CENTRE-scope) messages don't fan out push notifications yet — only EMERGENCY-scope does, which is the safety-relevant path BRD §16 calls out explicitly.

| # | Item | Working default (until confirmed) | Blocks |
|---|---|---|---|
| OI-12 | Real payment gateway (card + BECS via a PCI-DSS provider, tokenisation) — Stage 3 built `PaymentsService.processWebhook()` against a mocked gateway with full idempotency/ledger correctness, so the integration point is ready, but no real gateway account exists | Open — see OI-06 | Pilot readiness, not a Stage 3 blocker |
| OI-13 | CCS subsidy calculation is a flat `estimatedSubsidyPercent` per child, not the real hourly-rate-cap/withholding CCS formula — adequate to prove the ledger's estimated-vs-confirmed netting logic, not a real entitlement calculator | Open — real calculation arrives with Stage 4's CCS integration | Stage 4 |

Stage 3 simplification, not a BRD gap: fee schedules are chosen explicitly per booking by an admin (not re-resolved by the child's current age at invoice time) — correct by construction as long as admins create a new booking when a child moves age bands, per ADR 0002.

Revisit this file at the start of each stage listed in the "Blocks" column.
