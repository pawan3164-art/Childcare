# ADR 0005: Digital forms and e-signature

- Status: Accepted (resolves OI-11; legal review of the signing method still required before pilot)
- Date: 2026-10-05

## Context

PAR-007 requires digital forms with signatures: excursion permission, consent forms, custom centre forms. OWNA offers excursion, incident and custom forms. Options are a third-party e-signature service (DocuSign, Adobe Sign and similar) or an in-house forms engine. Form content is personal information about children, and BRD §18 requires it to stay in Australia.

## Decision

Build the forms engine in-house.

- **Templates** are versioned JSON definitions (field types: text, date, yes/no, choice, child selector, signature). Publishing a template creates an immutable version; edits create a new version.
- **Requests** send a template version to selected guardians for selected children, with an optional due date and reminders through the notification pipeline.
- **Submissions** are immutable once signed. Corrections are a new submission linked to the old one, matching the incident and medication pattern.
- **Signature evidence** captured on each submission: authenticated user ID and guardian relationship, typed full name, drawn signature image (stored through ADR 0004 storage), timestamp, device and IP address, the exact template version, and a SHA-256 hash of the submitted answers. All of it is audit-logged.
- The approach is designed to meet the Electronic Transactions Act 1999 (Cth) tests for electronic signatures: a method that identifies the signer and shows their intention, and that is as reliable as appropriate for the purpose. **This must be confirmed by legal review before pilot**; some documents (for example enrolment agreements with financial terms) may need a stronger method.

## Consequences

- Form data never leaves our Australian infrastructure, and there are no per-envelope fees.
- We own signature evidence and its integrity, so the hash and audit trail must be tested as carefully as the ledger.
- No PDF certification or third-party audit certificate. If a centre or regulator requires one, a provider can be added behind the same submission interface.
