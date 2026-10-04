# ADR 0003: Performance test tooling

- Status: Accepted (local-dev scope; revisit when staging exists)
- Date: 2026-10-03

## Context

`docs/performance-slas.md` targets need measuring against authenticated, multi-step, DB-backed flows (login, attendance, group care logging, sync flush, invoice batches, concurrent sessions). Stage 5 used `autocannon` against `GET /health` only. k6 is not installed in this environment. The API's global `ThrottlerGuard` limits each source IP to 600 req/min per route (5/min on `/auth/login`), so a single-IP load generator measures the throttle rather than the server.

## Decision

- Use a small dependency-free Node harness at `tests/performance/` (`lib/harness.js`, `run-api-load.js`). It runs closed-model virtual users, records client-side p50/p90/p95/p99/max and throughput per flow, and writes JSON results to `tests/performance/results/` for trend comparison.
- Spread traffic across loopback source addresses (`127.x.y.z`) using `http.Agent` `localAddress`, so measurements reflect server behaviour as multi-client traffic would see it. Single-IP throttle behaviour is measured as its own explicit scenario.
- Perf runs use an isolated database (`childcare_perf`) seeded with the demo seed plus `tests/performance/seed-perf-data.sql` (100 children, ~90 days of history), and a separate API instance (`NODE_ENV=production` for JSON logs). They never run against a shared dev DB.
- Server-side per-route latency comes from the API's own structured pino logs (`parse-api-log.js`), per the observability standard in `/CLAUDE.md`.
- `autocannon` (`services/api/scripts/load-test-health.js`) remains for the like-for-like `/health` comparison with the Stage 5 baseline.

## Consequences

- No new npm dependency. The scripts are plain Node and can move into CI after Phase 1.
- Single-host results (API, Postgres in Docker Desktop, and the load generator share one machine) are not production-representative. Re-baseline on staging (AWS ap-southeast-2) with k6 or an equivalent distributed tool once it exists. This harness's scenarios can be ported directly.
- Mobile cold/warm start, push delivery latency, and ratio recalculation are outside this harness's scope.
