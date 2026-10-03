# Performance SLAs (draft)

Placeholder targets, owned by `childcare-performance-tester`. These are working defaults, not confirmed requirements — BRD Appendix C item OI-01 is still open. Update this file (not just agent memory) whenever targets change; the agent always reads from here.

| Flow | Target | Source |
|---|---|---|
| Standard API request (p95) | < 500 ms | Delivery Plan working default |
| Standard API request (p99) | < 1000 ms | Derived |
| Attendance check-in / group logging action, end-to-end | < 2 s | BRD §19 |
| Mobile app cold start | < 2 s | Draft |
| Mobile app warm start | < 1 s | Draft |
| Push notification delivery (95th percentile) | < 30 s from send | Draft, ties to BRD §25 99% critical-delivery KPI |
| Offline sync flush, 100 queued operations on reconnect | < 10 s | Draft |
| Ratio recalculation after sign-in/out event (Phase 2) | < 30 s | BRD §13A RAT-005 |
| Invoice batch run (1000 invoices) | < 15 min | Draft |
| Concurrent active sessions per centre-scale deployment | 500 without degradation | Draft |

## Notes

- These numbers assume AWS ap-southeast-2 hosting and are not yet validated against real traffic.
- Revisit once BRD OI-01 is confirmed (see `docs/open-items.md`).
- `childcare-performance-tester` runs load/latency tests against these targets on request, and is mandatory at Stage 5 (Hardening) before pilot.

## Stage 5 local-dev baseline (2026-10-03)

**Not production-representative** — single dev machine, local Postgres, unauthenticated `GET /health` only (no DB query, no auth, no real network latency). k6 isn't installed in this environment; `autocannon` (`services/api/scripts/load-test-health.js`) was used instead for a quick, honest baseline rather than skipping performance checking at this stage entirely. Record a real baseline once staging infrastructure exists.

| Metric | Result |
|---|---|
| p50 latency (within the throttle window) | 23 ms |
| p90 latency | 46 ms |
| p99 latency | 93 ms |
| Max observed | 409 ms (startup/GC outlier) |

All comfortably under the 500ms/1000ms p95/p99 targets above — expected, since this endpoint does no real work. The load test run also surfaced and fixed a real issue before it reached production: the global `ThrottlerGuard` default (initially 100 req/min/IP) throttled the load test itself after ~99 requests. That default was too low for realistic traffic — a centre's staff devices commonly share one outbound IP (office NAT) — and was raised to 600/min/IP (see `app.module.ts`); the tighter 5/min override on `/auth/login` and `/auth/mfa/verify` specifically is unaffected. A load test that does nothing else is still worth running: it already caught this.

**Not yet measured** (needs seeded data, auth flow, and ideally staging infra, not just this local baseline): authenticated endpoint latency under DB load, attendance/group-logging action end-to-end, invoice batch run duration, concurrent session handling, offline sync flush.
