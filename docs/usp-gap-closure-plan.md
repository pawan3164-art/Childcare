# Competitor USP gap closure: findings and plan

Date: 2026-10-11. Source: seven competitor USPs reviewed against BRD v2.2. Requirements are now in **BRD v2.3** (`Requirement and design/Next_Gen_Childcare_BRD_v2.3.docx`, new §36 plus PAR-015 and other small edits). v2.2 is unchanged.

## 1. Coverage verdict

| # | Competitor USP | In BRD v2.2? | What v2.3 does |
|---|---|---|---|
| 1 | All-in-one (admin, rostering and payroll, programming, portfolios, room logs, parent comms) | **Mostly.** Everything except payroll. Payroll is excluded by decision (§13B.4, §32, OI-19: integrate, never build). | No change of direction. |
| 2 | High customisability (turn features off, custom frameworks and layouts, own policies and philosophy) | **Partial.** Configurable workflows and fee schedules exist. No feature on/off, custom frameworks, templates or branding. | §36.1: CUS-001–006. |
| 3 | Freemium, cost-effective model | **No.** §15 is how centres bill families, not how the platform is packaged and charged. | §36.2: PLT-001–006. Pricing decisions in OI-31. |
| 4 | Real-time compliance: ratios, responsible person, QIP, long-term records | **Mostly.** RAT-001–014, CMP-004, CMP-006, CMP-008 exist (all Phase 2). Gap: no retention schedule, long-term storage or audit pack. | §36.3: RET-001–005. Periods to validate (OI-32). |
| 5 | Family engagement and payments (routines, stories, digital attendance, payments, direct debit) | **Mostly.** Gap: parents signing children in or out digitally. | PAR-015. CCS validity in OI-33. |
| 6 | Multi-site HQ control | **Partial.** Persona and scalability only; "enterprise multi-site" deferred to Phase 3 with no requirements. | §36.4: HQ-001–006. Basic dashboard pulled into Phase 2. |
| 7 | AI parent assistance (24/7, PII redaction, in-country) | **Partial.** §11 has a staff-facing assistant only. | §36.5: AIP-001–007, Phase 3 add-on. Provider and residency in OI-34. |

Two business rules were added to §22: safety- and compliance-critical functions are never withheld by plan or payment status, and switching a feature off keeps its data and audit history.

## 2. Plan

Order is chosen so that nothing is built twice: retention and hardening come before real families; the entitlement mechanism comes before the features it will switch on and off. Every stage follows the TDD rule (tests first via `childcare-test-runner`) and the definition of done in `CLAUDE.md`. Size is relative for a solo build with Claude Code: **S** a few days, **M** one to two weeks, **L** three weeks or more.

| Stage | Scope | Requirements | Size | Depends on |
|---|---|---|---|---|
| **PR: Pilot readiness** | MFA enforcement for staff and admins; retention schedule, purge job and long-term readability; guardian data access and export; audit of read access to child, medical and billing records; refresh tokens (return access tokens to 15 minutes); security review and performance run on the new modules; VPS redeploy; iOS builds | OI-16, OI-17, OI-18, OI-28; RET-001, RET-002, RET-003, RET-005; PLT-005 | L | OI-32 (retention periods) |
| **U2b: Learning finish** | Educator-app learning screens; guardian responses; room programs; learning frameworks as configuration (EYLF V2.0 and MTOP V2.0 shipped, others addable) | BRD §10; CUS-002 | M | OI-35 |
| **U3b: Parent and educator follow-ups** | Educator-app pickup screen; notifications for new family requests; on-device storage; parent digital sign-in/out | OI-30, OI-22; PAR-015 | M | OI-33 |
| **C0: Configuration and entitlements** | Per-centre feature modules (safety-critical ones locked on); plan and entitlement tables with server-side checks; protected-core rule; branding and philosophy | CUS-001, CUS-004; PLT-001, PLT-002 | M | none; do before U4 so new features are built toggle-aware |
| **U4: Forms, health, calendar** | As planned (ADR 0005), built toggle-aware | BRD §5, PAR-007 | L | C0 |
| **U5: Money and insight** | Fat Zebra adapter (mock stays default until a merchant account exists); owner analytics grown into the basic multi-site view; area-manager role | BIL-006/007; HQ-001, HQ-003, HQ-004 | L | OI-12 |
| **2A: Ratios and responsible person** | Ratio rule engine, live ratio, alerts, ratio audit trail, responsible-person log. First in Phase 2: it is the compliance USP competitors lead with | RAT-001–014, CMP-004, EDU-011/012 | L | OI-07 |
| **2B: Staff, timesheets, rostering** | As planned; payroll by export only | ROS-001–010, BRD §13A | L | 2A |
| **2C: Service compliance and audit packs** | Hazards, maintenance, drills, QIP, policies library, compliance dashboard; audit packs; policies shown to families | CMP-001–009; RET-004; CUS-006 | L | 2A |
| **2D: Enrolment and customisation** | Enquiry CRM, waitlist, enrolment; documentation templates; add-on switching | BRD §12; CUS-003, CUS-005; PLT-003 | L | C0 |
| **3A: Multi-site HQ** | Live ratio and compliance overview across centres; central templates and settings; consolidated reports | HQ-002, HQ-005, HQ-006 | M | 2A, 2C |
| **3B: Parent AI assistant** | Grounded answers from fee schedules, policies and calendar; per-parent scope; PII redaction; Australian-region processing; human handover; per-centre switch | AIP-001–007; PLT-006 | L | C0, 2C, U4 calendar, OI-34 |
| **3C: Subscription billing** | Charge centres by plan and add-ons; usage metering | PLT-004, PLT-006 | M | OI-31 |

### Exit checks worth keeping from §36.6
- A non-critical module can be switched off and vanishes from every app without data loss; a safety-critical one cannot be switched off.
- Ending a trial or a missed payment never blocks sign-in/out, care records, medication, incidents, emergency broadcast or data export.
- A purge run removes only records past retention, skips legal holds, and logs counts and ids only.
- An audit pack's manifest checksums match its files.
- An area manager sees only their centres, and organisation figures equal the sum of the centres.
- The AI assistant never returns another family's data, redacts seeded PII before model calls (checked from captured requests), and hands unanswerable questions to staff.

## 3. Decisions needed

| Open item | Question | Needed before |
|---|---|---|
| OI-31 | Which capabilities are free core and which are paid add-ons? Per-centre or per-child pricing? | PLT-003 (stage 2D) and 3C. The framework in C0 does not need it. |
| OI-32 | Retention periods per record type and jurisdiction. Is seven years right for financial records? | PR (RET-001) |
| OI-33 | Does parent-app sign-in/out with digital confirmation meet CCS attendance-record rules? | U3b (PAR-015) |
| OI-34 | AI provider and hosting inside Australian regions; redaction approach | 3B |
| OI-35 | Frameworks beyond EYLF V2.0 and MTOP V2.0 (state-specific, philosophy-based) | U2b |

Not yet validated: the retention periods, CCS attendance rules and ratio values in the BRD are working assumptions. They must be confirmed by compliance before the stages that depend on them.

## 4. Pending changes as of 2026-10-11

**Uncommitted**
- `apps/parent-mobile/app.json`: Expo project ID written by `eas init`.
- BRD v2.3, this plan, and the open-items, CLAUDE.md and README updates that go with them.
- `All_Prompts.md` (automatic prompt log).

**Done but not live**
- VPS redeploy: `git pull && bash infra/prod/scripts/deploy.sh` applies the family-requests migration, 12-hour tokens and the new API.
- Both Android apps need a new `eas build`. iOS builds are not set up (Apple Developer account and registered devices).

**Reviews not run**
- Security review of the family-requests module and the parent app.
- Performance check of the new endpoints against `docs/performance-slas.md`.

**Documents not updated**
- The Delivery Plan (`Next_Gen_Childcare_Delivery_Plan.docx`) still shows only the U0–U5 sequence. This plan is the working source until it is revised.

**Still open from earlier**
- OI-12 payments mocked; OI-13/14 CCS mocked and unregistered; OI-15 database role in a migration, not infrastructure-as-code; OI-25 dependency advisories; OI-27 portfolio PDF is browser print-to-PDF.
- The VPS is probably outside Australia, so demo data only.
