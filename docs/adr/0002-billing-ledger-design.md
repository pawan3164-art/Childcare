# ADR 0002: Billing ledger design

Status: Accepted (Stage 3)

## Context

Delivery Plan §6.3 names the money ledger as one of the five hard parts to get right early: "fees, estimated subsidy, confirmed subsidy, gap, payments and adjustments are separate entries, never overwritten," backed by a golden-case test suite. BRD §22 requires issued invoices to be immutable, with corrections only via credits/adjustments.

## Decision

- **`LedgerEntry` is the single source of truth.** `Invoice` is an immutable header (cycle dates, issuedAt) with no stored totals — every total (gross, subsidy, gap, paid, balance) is derived by summing `LedgerEntry` rows at read time (`LedgerService.getBreakdown`). This makes "never overwritten" structural rather than a convention to remember.
- **Sign convention**: `FEE` and `ADJUSTMENT` are stored positive (increase balance owed); `SUBSIDY_ESTIMATED`, `SUBSIDY_CONFIRMED`, `PAYMENT` and `CREDIT` are stored negative (reduce it). `CREDIT` always forces the sign regardless of what's passed in — a credit cannot accidentally increase a balance.
- **Estimated vs. confirmed netting**: a subsidy entry carries `sourceFeeEntryId` pointing at the specific `FEE` entry it offsets. `LedgerService.computeBreakdown` groups subsidy entries by that pointer and prefers `SUBSIDY_CONFIRMED` over `SUBSIDY_ESTIMATED` for the same fee — both entries exist in the ledger (nothing is overwritten when Stage 4's CCS integration confirms an amount), but only one counts toward the balance. Verified in `test/billing/invoice-and-ledger.spec.ts`.
- **DB-level immutability, not just application code**: `invoices` and `ledger_entries` have no UPDATE/DELETE grant for the `childcare_app` role at all (see the Stage 3 RLS migration) — the same pattern used for `audit_log_entries`.
- **Payment idempotency**: `PaymentRecord.providerPaymentId` is unique; `PaymentsService.processWebhook` catches the case where a webhook is replayed and returns the existing record without creating a second `PAYMENT` ledger entry — mirrors the `SyncService` idempotency pattern from Stage 0/1 (same underlying problem: at-least-once delivery from an external system must not double-apply).
- **Fee schedule resolution is booking-time, not invoice-time.** A `Booking` references a specific `FeeSchedule` chosen when the booking is created, rather than `FeeCalculationService` re-resolving "the right schedule for this child's current age" on every invoice run. This is simpler and correct as long as an admin creates a new booking (with a new schedule) when a child moves age bands — the schema doesn't prevent an admin from leaving a stale schedule in place, so this is a process dependency, not a system guarantee. Flagged, not silently assumed away.
- **CCS subsidy is a flat percentage (`CcsEntitlement.estimatedSubsidyPercent`), not the real Services Australia formula** (which involves hourly rate caps, activity test hours, withholding, etc.). This is intentionally a stand-in just good enough to exercise the ledger's estimated/confirmed netting logic — the real calculation is Stage 4 scope once CCS integration begins (OI-13).

## Consequences

- Every money question ("what does this family owe," "what was this invoice for") is answered by querying `ledger_entries`, never by trusting a cached field — removes an entire class of "the UI shows a different number than the ledger" bugs.
- Adding Stage 4's `SUBSIDY_CONFIRMED` entries requires no schema change and no migration of existing data — the netting logic already handles it.
- `FeeCalculationService` is pure enough (no side effects, deterministic given its inputs) to golden-case test directly against a real Postgres fixture without going through the full `BillingService` invoice-generation path — see `test/billing/fee-calculation-golden-cases.spec.ts`.
