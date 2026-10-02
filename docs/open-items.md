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

Revisit this file at the start of each stage listed in the "Blocks" column.
