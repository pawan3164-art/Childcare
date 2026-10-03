# Data Breach Response Runbook (Notifiable Data Breaches)

Status: drafted Stage 5 (Hardening). Not yet rehearsed as a live tabletop exercise with the full team (there is no team yet — solo/small-team build, per `/CLAUDE.md`). This is the procedure to rehearse once a centre pilot is imminent, and a starting point for the independent legal review the Delivery Plan §9 calls for before pilot.

This follows the shape of Australia's Notifiable Data Breaches (NDB) scheme under the Privacy Act, administered by the OAIC — BRD §33 names the OAIC as a reference source. **This is not legal advice**; independent legal review is required before relying on this runbook in a real incident (Delivery Plan §9).

## What counts as a notifiable breach here

Given the data this platform holds (children's personal information, health/medical information for medication and incidents, family contact details, billing/payment references, CCS-related data), almost any unauthorized access, loss, or disclosure of child or family records is likely to qualify as an "eligible data breach" under the NDB scheme if it's likely to result in serious harm. Examples specific to this system:

- Cross-tenant data exposure (an RLS or authorization bug exposing one organisation's children to another).
- Unauthorized access to medication/incident records (health information — a sensitive information category with a lower threshold for "serious harm").
- Exposure of the `childcare_app` database credentials or JWT signing secret.
- A compromised admin account used to export child/family records in bulk.
- Loss of a backup containing production data without encryption.

## Immediate response (first 24-72 hours)

1. **Contain**: the specific action depends on the breach. For a compromised credential: rotate it immediately (`JWT_SECRET`, database passwords, any API keys) — this invalidates all existing sessions, which is a Stage 5 capability now that session revocation is wired up (`AuthService.logout`, checked in `JwtStrategy`; see the Stage 5 security fixes commit). For a code-level access-control bug: deploy a fix or, if a fix isn't immediately possible, disable the affected endpoint/feature.
2. **Assess scope** using the audit log (`audit_log_entries` — append-only, see ADR 0001): what was accessed, by whom, when, and for which organisations/children. The `correlationId` on log entries and the `AuditService.record` calls throughout the codebase (child access denials, billing mutations, medication, incidents, CCS submissions — see the Stage 5 security review) are the primary forensic source. **Known gap**: read access to child/billing/medical records is not currently audit-logged, only denials and writes — see `docs/open-items.md`. If a breach involves unauthorized *reads*, the audit log may not show the full scope, which is itself a reason to prioritize closing that gap before pilot.
3. **Determine if it's an "eligible data breach"**: likely to result in serious harm, and remediation hasn't prevented that harm. Given the sensitivity of children's health/safety data, default to treating it as eligible unless legal advice says otherwise.

## Assessment and notification (within 30 days of becoming aware, per the NDB scheme)

4. Complete a reasonable and expeditious assessment (the NDB scheme requires this within 30 days if the nature of the breach isn't immediately clear).
5. If eligible: notify the OAIC and affected individuals (parents/guardians, and potentially staff) as soon as practicable, with:
   - What happened and when.
   - What information was involved.
   - What the organisation is doing in response.
   - What affected individuals should do.
6. For incidents affecting a specific centre, notify that centre's director/responsible person per BRD §13A.6's existing acknowledgement pattern — the incident/notification infrastructure already built (`IncidentsService`, `NotificationsService`, URGENT priority) is the natural channel, though a data breach is not itself an "Incident" record in the current domain model (child-safety incidents and data-breach incidents are different things — don't conflate them operationally).

## Post-incident

7. Root-cause analysis: for an access-control bug, this means identifying why the test suite (`test/access-control/*.spec.ts`) didn't catch it, and adding a regression test before closing the incident — consistent with the project's TDD-first rule (`/CLAUDE.md`).
8. Update this runbook and `docs/open-items.md` with anything learned.
9. If the breach involved a third-party processor (payment gateway, future CCS integration, hosting provider), coordinate with them per BRD §18's requirement that third-party processors outside Australia require a documented APP 8 assessment.

## What's already built that helps here

- Append-only, tamper-resistant audit log (DB-level: no UPDATE/DELETE grant for `childcare_app` on `audit_log_entries`).
- Session revocation (Stage 5 fix) — can immediately invalidate a compromised session without waiting for JWT expiry.
- Row-level security as a second containment layer — even a buggy query can't cross the org boundary.
- Structured logging with correlation IDs for tracing a specific request chain.

## What's not built yet (don't assume these exist during a real incident)

- No automated breach/anomaly detection (e.g., alerting on unusual bulk-read patterns).
- No read-access audit logging (see above).
- No incident-response contact list / escalation chain (needs real people once the team exists).
- No cyber insurance or legal counsel engagement process defined.
