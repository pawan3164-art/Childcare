# Tests

Written before the feature they validate, per the project's TDD-first rule (see `/CLAUDE.md`).

- `access-control/` — relationship-based permission matrix, cross-family/cross-centre isolation tests.
- `sync/` — offline sync conflict scenarios (airplane mode, multi-device, kill-app).
- `billing-golden-cases/` — fee/discount/absence/subsidy calculation fixtures, written with a childcare billing domain expert in mind before ledger code exists.
- `e2e/` — end-to-end flows across apps + API.
- `performance/` — load/latency scripts validated against `docs/performance-slas.md`.

Run and maintained primarily via the `childcare-test-runner` and `childcare-performance-tester` agents (`.claude/agents/`).
