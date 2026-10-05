# ADR 0006: Payment gateway

- Status: Accepted, pending merchant onboarding (resolves OI-06 and the selection part of OI-12)
- Date: 2026-10-05

## Context

BIL-006 to BIL-008 and PAR-014 need card and BECS direct-debit payments with tokenisation, scheduled debits, retries and receipts. Card data must stay out of our systems (PCI SAQ-A). Stage 3 built `PaymentsService.processWebhook()` against a mocked gateway, with idempotency and ledger correctness tested. BRD §18 requires personal data to stay in Australia unless an APP 8 assessment is documented.

Options considered:

- **Stripe.** Best developer experience and self-serve test keys. Its Australian BECS Direct Debit service agreement states that personal information is transferred to the United States. That needs an APP 8 assessment, which goes against this project's default.
- **Fat Zebra.** Australian gateway, PCI-DSS Level 1, hosted payment page and JavaScript/React/iFrame hosted fields (removes card data from our scope), card tokenisation, customers with a `card`, `card_token` or `bank_account` payment method.
- **Ezidebit (Global Payments).** Australian, long-established in direct debit and BPAY, with existing use in childcare.
- **Westpac PayWay.** Bank-owned option, considered but not assessed in depth.

## Decision

- **Fat Zebra** is the primary gateway. **Ezidebit** is the fallback if Fat Zebra's direct-debit support does not meet our needs.
- Integrate through the existing payment gateway interface. Add a `FatZebraGateway` implementation next to the mock; choosing between them is a configuration value, and the mock stays the default.
- Card capture uses Fat Zebra's hosted fields, so card numbers never reach our API. We store only tokens and display data (brand, last four digits, expiry).
- Webhooks go through the existing idempotent `processWebhook()` path, with signature verification added.

## Must confirm during merchant onboarding

1. BECS direct debit through the API (bank-account customers and scheduled debits), including the direct-debit request (DDR) agreement flow.
2. Where cardholder and bank-account data is stored and processed (Australia only, or an APP 8 assessment is needed).
3. Webhook signing scheme, sandbox base URL and test credentials.

## What is real and what is not

A Fat Zebra merchant account and sandbox credentials have to come from the business; Claude Code cannot create them. Until they exist, the adapter is built against Fat Zebra's published API documentation and tested with recorded request/response fixtures. **It is not verified against the real sandbox**, and the mocked gateway remains the default.
