# U4 hardening backlog (next steps)

Written 2026-10-11 when the owner moved on to U5. Stage U4 features are built (health records, calendar, menus, forms with e-signature). These are the follow-ups, in the order recommended. Each links to the open item that holds the detail. Nothing here blocks U5.

## Before real families (pilot gate)

1. ~~**Retention and purge must cover the new tables**~~ **Done 2026-10-12 (DL-045)** for health and forms; the original note follows (OI-41, OI-32, DL-035). `form_signatures`, `form_submissions`, health records, calendar and menu rows are not in the purge job yet. The app role cannot delete signatures or submissions, so purging runs as the maintenance role.
2. **Legal review of the e-signature method** (ADR 0005, OI-40). Required before pilot.
3. **IP and user agent on signed forms are personal data** (OI-40 M3). Decide export and erasure handling, and confirm `TRUST_PROXY_HOPS` is right in production, or the recorded IP is the load balancer's.
4. **Performance fixes from the 2026-10-11 U4 run** (OI-42): speed up bulk form send (about 1.9 s for 100 children) with batched inserts and notification queueing, and paginate `GET /forms/requests` and `GET /forms/my-requests`. Add the U4 baselines and proposed targets to `docs/performance-slas.md`. Results are in `tests/performance/results/`.

## Safety and integrity

5. **Offline sync must respect switched-off modules** (OI-37).
6. **Immunisation status history** (OI-38): a changed status overwrites the old one.
7. **Audit denied and cross-centre write attempts** on health, calendar, menus and forms (OI-38, OI-40 L5). Audit reads of forms lists and the family-side reads as part of the read-access audit.
8. **Integrity hash covers answers only** (OI-40 M1): decide whether to hash an evidence envelope (signer, signature, time, version) or HMAC it.
9. **Database-level centre isolation**: the U4 tables use organisation-only row-level security and have no foreign keys (OI-40 M4, calendar and health reviews). Add a centre predicate and foreign keys across the whole set in one pass.

## Product gaps

10. **Signed-form PDF and evidence export** (OI-41), including the drawn signature.
11. **Form template editing in the portal** (OI-41): editing an existing template's fields is API-only. Add reminders for unsigned forms and a date picker for date answers in the app.
12. **Calendar** (OI-39): recurring events, push notification when an event is added or cancelled, room-specific events in the portal, RSVP.
13. **Menus** (OI-39): copy last week, templates, show the menu in the educator app.
14. **Platform-admin screen for plans** (OI-37), educator app caching of health data (OI-38, OI-22).

## Verification still owed

15. Look at the new screens on a device or emulator: the parent-app forms list, form and signature pad, and the portal Forms page. They are type-checked and the backend is tested, but the touch behaviour and layout have not been seen.
