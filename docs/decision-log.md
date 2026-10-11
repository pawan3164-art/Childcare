# Decision log

One place for every product, scope, architecture and operations decision, newest at the bottom. Each entry says **who decided**, **why**, and **where the detail lives**. Long technical decisions stay in `docs/adr/`; open questions and their working defaults stay in `docs/open-items.md`. When a decision changes, add a new entry that supersedes the old one rather than editing history.

**Status values:** *Decided* (owner confirmed) · *Working default* (a sensible default chosen so work can proceed; to be validated before it matters) · *Superseded*.
**Decider:** *Owner* = the product owner; *Claude (delegated)* = chosen by Claude Code on the owner's explicit instruction to decide.

## Earlier decisions (indexed from existing records)

| ID | Date | Decision | Decider | Status | Detail |
|---|---|---|---|---|---|
| DL-001 | Oct 2026 (ADR undated) | Row-level security for tenant isolation; Prisma as the ORM. | Per ADR | Decided | ADR 0001 |
| DL-002 | Oct 2026 (ADR undated) | Ledger-based billing: append-only entries, immutable invoices, money as integer cents. | Per ADR | Decided | ADR 0002 |
| DL-003 | 2026-10-03 | Load and latency testing with the project's own tooling in local dev. | Per ADR | Decided | ADR 0003 |
| DL-004 | 2026-10-05 | OWNA gap-closure sequence U0 to U5 inside Phase 1; learning documentation moves from Phase 2 into Phase 1, delivered through the family feed (OI-04). | Owner | Decided | Delivery Plan §13, BRD v2.2 §10, §24 |
| DL-005 | 2026-10-05 | Media in private S3-compatible buckets (SeaweedFS locally), uploads through the API with EXIF stripping, 5-minute signed URLs, group-photo consent flag (OI-09). | Owner | Decided | ADR 0004 |
| DL-006 | 2026-10-05 | Digital forms and e-signature built in-house (OI-11). Legal review of the signing method still needed before pilot. | Owner | Decided | ADR 0005 |
| DL-007 | 2026-10-05 | Payment gateway: Fat Zebra primary, Ezidebit fallback, Stripe ruled out because of US data transfer (OI-06). Mock stays default until a merchant account exists. | Owner | Decided | ADR 0006 |
| DL-008 | 2026-10-05 | CCS integration is built against a mock behind an internal interface until registration resolves (OI-05). | Owner | Decided | `docs/open-items.md` |
| DL-009 | 2026-10-05 | Payroll is integrated with existing providers, never built in-platform (OI-19). | Owner | Decided | BRD v2.2 §13B.4, §32 |
| DL-010 | 2026-10-05 | Sleep-check interval is a per-centre setting (OI-20). | Owner | Decided | `docs/open-items.md` |
| DL-011 | 2026-10-05 | Failed checklist items alert every centre admin until the responsible-person log exists (OI-21). | Owner | Decided | `docs/open-items.md` |
| DL-012 | 2026-10-05 | Only the room leader reviews, publishes or returns a room's learning records, never their own (OI-23). | Owner | Decided | `docs/open-items.md` |
| DL-013 | 2026-10-05 | One group-consent flag covers group photos and group learning stories (OI-24). | Owner | Decided | `docs/open-items.md` |

## Pilot hosting and apps (2026-10-09)

| ID | Date | Decision | Decider | Status | Detail |
|---|---|---|---|---|---|
| DL-014 | 2026-10-09 | Host the pilot on a single Hostinger VPS with Docker Compose and Caddy (Option A). Pilot only: no disaster recovery, and the VPS is probably outside Australia, so **demo data only**. | Owner | Decided | `docs/deploy-vps-pilot.md`, `infra/prod/` |
| DL-015 | 2026-10-09 | Domain `justforfewtests.in` with `api.`, `portal.` and `media.` subdomains. `media.` is public HTTPS because presigned photo URLs are bound to that hostname. | Owner | Decided | `docs/deploy-vps-pilot.md` |
| DL-016 | 2026-10-09 | Mobile distribution through EAS internal builds. Android is built; iOS is pending an Apple Developer account (A$149 a year) and registered devices. Pilot users are on both platforms. | Owner | Decided | `docs/deploy-vps-pilot.md` |
| DL-017 | 2026-10-09 | Separate Expo app for parents (`apps/parent-mobile`, id `in.justforfewtests.family`), alongside the educator app (`in.justforfewtests.educator`). Staff accounts are refused by the parent app. | Owner | Decided | `apps/parent-mobile/README.md` |
| DL-018 | 2026-10-09 | Access tokens last 12 hours on the pilot because there is no refresh-token flow. Return to 15 minutes once refresh tokens exist (OI-28). | Claude (delegated) | Working default | `infra/prod/docker-compose.prod.yml`, OI-28 |
| DL-019 | 2026-10-09 | Family requests (OI-29): (a) a parent-reported absence is not allowable until a centre admin confirms, so the fee stands; (b) casual days are requested by a parent and approved or declined by a centre admin, approval creates a normal casual booking; (c) a guardian with pickup rights can nominate someone else for one day (max 3), and staff record an ID check on the day. | Owner (accepted defaults) | Decided | OI-29 |
| DL-020 | 2026-10-09 | Working style: commit locally as work completes; push to GitHub only when asked, with `main` as the default branch (renamed from `master`). | Owner | Decided | git history |

## Competitor USP review (2026-10-11)

| ID | Date | Decision | Decider | Status | Detail |
|---|---|---|---|---|---|
| DL-021 | 2026-10-11 | Adopt BRD v2.3: new §36 (centre configuration, plans and entitlements, retention, multi-site HQ, parent AI assistant) and PAR-015. v2.2 is kept unchanged for history. | Owner | Decided | BRD v2.3, `docs/usp-gap-closure-plan.md` |
| DL-022 | 2026-10-11 | Payroll stays out of scope even though a competitor lists it as a USP (reaffirms DL-009). | Owner | Decided | BRD v2.3 §36.0 |
| DL-023 | 2026-10-11 | Stage order: PR (pilot readiness) first, then U2b, U3b, C0 before U4; U5 grows into a basic multi-site view; Phase 2 starts with ratios and the responsible-person log; AI assistant and subscription billing in Phase 3. | Owner (approved the plan and told Claude to proceed) | Decided | `docs/usp-gap-closure-plan.md` |
| DL-024 | 2026-10-11 | The five open decisions OI-31 to OI-35 are delegated to Claude to decide from Australian market practice and published rules; all are recorded below as working defaults, to be validated before the stage that depends on them. | Owner | Decided | this log |

### Decisions delegated to Claude (OI-31 to OI-35)

| ID | Item | Decision | Reasoning and sources | Validate before |
|---|---|---|---|---|
| DL-025 | **OI-31** Pricing and packaging | **Family app always free to parents.** Centres get a **free Core** (attendance and sign-in/out, daily care records, family feed and messaging, announcements and emergency broadcast, basic forms, basic reports, full data export). Paid, **per enrolled child per month**, as add-ons: Billing and CCS, Learning and programming, Rostering and ratios, Compliance suite, Multi-site HQ, AI assistant. Safety- and compliance-critical functions are never gated (BRD §22). **No price points are set**; they need a commercial decision. | Australian competitors price per child and keep the family app free: Storypark has a free family plan and a per-child education plan; OWNA lists child-care-management pricing per child. Prices change, so none are copied here. Sources: [Software Advice, Storypark](https://www.softwareadvice.com.au/software/471316/Storypark), [OWNA vs Storypark](https://www.owna.com.au/storypark-alternative/), [Capterra AU comparison](https://www.capterra.com.au/compare/152602/209399/storypark/vs/owna). | Stage 2D (add-ons) and 3C (billing); not needed for C0 |
| DL-026 | **OI-32** Retention periods | The effective period for a record is the **longest applicable minimum**, held as configuration (RET-001). Defaults: child attendance, enrolment, medication and assessment records **7 years** (the Family Assistance Law period for CCS records; the National Regulations minimum is 3 years after the child's last attendance); **incident, injury, trauma and illness records until the child turns 25**; record of a child's death 7 years from the death; billing, ledger and CCS records **7 years**; staff and audit-log records **7 years** (conservative; the staff period was not verified); learning portfolios 7 years with a family export on exit. Legal hold suspends purging. | Education and Care Services National Regulations, regulation 183, as summarised by [Meridian Lawyers](https://www.meridianlawyers.com.au/wp-content/uploads/2017/06/Child-care-insights-How-long-retain-records-KDO-May17.pdf) and [ACECQA](https://www.acecqa.gov.au/node/1111966). The 7-year CCS attendance period comes from the Department of Education's record-keeping guidance, read through a search summary; the page itself timed out when opened, so confirm it directly. | Stage PR (RET-001); compliance sign-off |
| DL-027 | **OI-33** Parent digital sign-in/out | **Allow it (PAR-015) as a centre option, not a requirement.** Each event records the person, time and method (QR or PIN, with confirmation), and is kept as an attendance record for 7 years. Session reports still send drop-off and pick-up times. | Providers must report drop-off and pick-up times with weekly CCS session reports, but are not obliged to run an electronic sign-in system; PIN-based sign-in by the parent or authorised person is common practice. Sources: [The Sector](https://thesector.com.au/2018/11/16/aca-nsw-issues-warning-about-digital-sign-in), [Australian Childcare Alliance](https://australianchildcarealliance.org.au/blog/186-reporting-attendance-data-the-deadline-is-coming). | Stage U3b; confirm with the Department of Education before real CCS submission |
| DL-028 | **OI-34** AI assistant hosting | **Claude on Amazon Bedrock in Sydney, with cross-region inference restricted to the Australian pair (Sydney and Melbourne).** PII is redacted by the platform before any call; prompts and answers are not used for training; conversation logs follow RET-001. An APP 8 assessment is still written even though processing stays in Australia. | Bedrock offers Claude models in Sydney, and Australian cross-region inference routes only between ap-southeast-2 and ap-southeast-4. Sources: [AWS community post](https://community.aws/content/2epdA81TYzTxdhGVnrmKnGETLqu/bedrock-in-sydney-ga---live-from-aws-sydney-summit), [Bedrock cross-region inference for Australia](https://aihub.hkuspace.hku.hk/2025/10/31/introducing-amazon-bedrock-cross-region-inference-for-claude-sonnet-4-5-and-haiku-4-5-in-japan-and-australia/). Model availability changes; check the current model list when stage 3B starts. | Stage 3B |
| DL-029 | **OI-35** Learning frameworks beyond EYLF and MTOP | Ship **EYLF V2.0 and MTOP V2.0** (done), then add **VEYLDF** (Victoria) and the **Queensland Kindergarten Learning Guideline** as the first optional frameworks, plus a **custom outcome set** a centre can define. Each record keeps the framework version it was written against. Other states on request. | State frameworks are used alongside EYLF by kindergarten programs in those states. This one rests on general knowledge of the sector, not a source checked in this session. | Stage U2b; confirm the framework list with a centre director |

## Pending actions only the owner can do

These cannot be done by Claude because they need credentials or accounts Claude does not hold.

| Action | Why it is the owner's | Status |
|---|---|---|
| Redeploy the VPS (`git pull && bash infra/prod/scripts/deploy.sh`) | Needs SSH access to the VPS | Open |
| Rebuild both Android apps (`eas build --profile preview --platform android`; `eas init` once for the parent app) | Needs the owner's Expo login | Open |
| iOS builds | Needs an Apple Developer account and registered devices | Open |
| Real payment merchant account (OI-12) and CCS registration (OI-05/14) | Business registrations | Open |
