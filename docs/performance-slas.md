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
