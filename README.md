# Next-Gen Childcare Platform

Childcare management + family experience platform for the Australian market (parent app, educator app, centre web portal). See `CLAUDE.md` for the full stack, conventions, and build-sequence summary; see `docs/open-items.md` for tracked gaps and decisions still open.

## Current status (as of 2026-10-05)

**Backend (`services/api`)** — Stages 0 through 5 of the build plan are complete and tested (70 tests passing):
- Stage 0: tenancy/RLS, auth + MFA, audit log, sync engine, notifications skeleton
- Stage 1: attendance, group-first care logging, media visibility rules
- Stage 2: medication hard-conflict handling, incidents, messaging, pickup authorization
- Stage 3: billing ledger (fees, invoices, subsidy netting, idempotent payments)
- Stage 4: CCS integration (mocked gateway, confirmed-subsidy netting, resubmission)
- Stage 5: security review + fixes, DR drill, PIA, breach runbook, perf baseline, CI
- U0 (UX foundation) done; U1 (family feed & routines) in progress on branch `owna-gap-closure`: real photo storage + group-photo consent (ADR 0004), photo posts, per-child family feed and daily timeline, direct parent<->room messages, announcement list with acknowledgement counts, routine records (nappy, sunscreen, sleep checks with safe-sleep flagging and due/overdue status), room checklists (BRD v2.2 CMP-003: per-room or centre-wide, completable offline via sync, failures alert centre admins).
- U2 (learning in the feed) in progress: observations and learning stories linked to EYLF V2.0, auto-saved drafts (also via offline sync), review by someone other than the author, then published to the family feed and child portfolio; versioned amendments and full history. Still to come in U2: educator-app learning screens, guardian responses, room programs.
- Plus: admin/list endpoints (`/children`, `/rooms`, `/users`, `/incidents`, `/medication/administrations`, `/guardian-relationships`) and a seed script, added to support the UI below

**Frontend**
- `apps/portal-web` — Next.js 16 + React 19 + Tailwind v4 centre admin portal. Login, dashboard, children (with daily timeline and family feed), attendance, group care logging (incl. routines and a "sleeping now" panel), room checklists (complete, history, admin setup), learning (drafts, review queue, editor with EYLF outcome picker, portfolio with print-to-PDF), messages and announcements, photo sharing, billing, medication, incidents. Covers all three roles (admin, educator, parent). Unsent messages and captions auto-save as drafts in the browser and are cleared on sign-out.
- `apps/educator-mobile` — Expo + Expo Router educator app. Login, room roster with attendance, group care logging (incl. routines), Checks tab (sleep checks due, room checklists through an offline outbox), photo sharing, family conversations, profile. Drafts persist on web; on native they last only until the app restarts (no on-device storage yet). Testable via `expo start --web` (no simulator needed).
- `apps/parent-mobile` — **not started**. The portal's parent-role view covers the same functionality in a browser for now.

**Not built / mocked** (tracked in `docs/open-items.md`): real payment gateway (OI-12; Fat Zebra chosen, needs a merchant account), real CCS/Services Australia registration (OI-14), digital forms (OI-11; design decided in ADR 0005), data retention/export flows (OI-17), MFA enforcement for admins (OI-16).

**Custom agents** (`.claude/agents/`): `childcare-test-runner`, `childcare-security-reviewer`, `childcare-performance-tester` exist but need a **fresh Claude Code session** to become selectable — the agent registry is scanned once at session startup, before these files existed. Start a new session in this directory and they should be available; verify with `/agents`. They are manual-trigger only (not wired into CI automation yet) — ask for one by name when you want it to run.

## Local development

Prerequisites: Node 24+, Docker Desktop running.

**1. Database and photo storage** (start once, stays up):
```
cd infra && docker compose -f docker-compose.dev.yml up -d
```

**2. API** (new terminal):
```
cd services/api
npm install                # first time only
npm run prisma:migrate     # first time only, or after a schema change
npm run prisma:seed        # resets + seeds demo data; safe to re-run anytime
npm run storage:init       # first time only: creates the private photo bucket
node -r ts-node/register -r tsconfig-paths/register src/main.ts
```
Confirm at http://localhost:3000/health. Run the test suite with `npm test`.

**3. Portal** (new terminal):
```
cd apps/portal-web
npm install                # first time only
npm run dev
```
Open http://localhost:3001.

**4. Educator app** (new terminal):
```
cd apps/educator-mobile
npm install                # first time only
npx expo start --web
```
Opens a browser automatically (usually :8081 or :19006).

### Demo accounts

All use password `Password123!`:

| Role | Email | Try it on |
|---|---|---|
| Centre admin | `admin@sunshine.test` | Portal — everything, including generating invoices |
| Educator | `educator.joeys@sunshine.test` | Portal or educator app — attendance, group care logging |
| Parent (2 kids) | `parent.nguyen@example.test` | Portal — Child-at-a-Glance, billing, incidents |

### Suggested walkthrough

Sign in as the educator → sign a child in on Attendance/Roster → log a group meal → switch to admin → generate an invoice for that child → log in as the parent → see the attendance, care record and bill all reflected.

**Known gap**: the portal/educator-app UI was verified by checking every screen's data contract against the live API (curl) and confirming clean builds, but has not had a visual in-browser click-through by Claude (the Chrome extension wasn't connected when it was built) — watch for CSS/layout issues that approach wouldn't catch.

## Next steps

Decided 2026-10-05 after an OWNA competitor gap analysis (Delivery Plan §13, BRD v2.2): build stages **U0 → U1 → U2 → U3 → U4 → U5** in order, then Phase 2. See `CLAUDE.md` for what each stage covers.

Also outstanding:
- Pilot blockers in `docs/open-items.md`: OI-14 CCS registration, OI-16 MFA enforcement, OI-17 retention/export, OI-18 read-access audit.
- Once a fresh session confirms the custom agents work, run `childcare-security-reviewer` and `childcare-performance-tester` against the current build — they haven't been run via the actual agent yet (Stage 5's review was done manually because the agent registry wasn't available).
