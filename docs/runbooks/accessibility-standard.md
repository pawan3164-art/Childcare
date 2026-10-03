# Accessibility Standard

Status: standard defined Stage 5 (Hardening); **no actual audit has been performed**, because no UI exists yet — Stages 0-4 built the backend API only (see `docs/open-items.md` OI-10). This document exists so accessibility is designed in from the first screen built, not retrofitted after a UI exists, per the project's design principles (`/CLAUDE.md`, BRD §29 "Human-in-the-loop," "Explainability").

## Target

**WCAG 2.2 Level AA**, per BRD Appendix C OI-03's recommended default (not yet formally confirmed — see `docs/open-items.md`).

## Where this applies

Three front ends, none built yet:
- Parent mobile app (React Native/Expo)
- Educator mobile/tablet app (React Native/Expo)
- Centre administration web portal (Next.js)

## Checklist to apply once UI work starts (Stage 1 onward for the portal; mobile apps per `/CLAUDE.md` stack)

### Perceivable
- [ ] Text alternatives for all meaningful images (especially child photos in the care-loop UI — alt text should be functional, e.g. "photo from morning tea," not decorative).
- [ ] Color is never the only means of conveying information — directly relevant to the ratio-status traffic-light pattern (green/amber/red) planned for Phase 2 (BRD §13A RAT-013) and the notification-priority color coding (BRD §16): both need a non-color indicator (icon, text label) alongside color.
- [ ] Minimum contrast ratios (4.5:1 normal text, 3:1 large text/UI components).
- [ ] Text resizable to 200% without loss of content/functionality — relevant for educator tablet UI used one-handed in a busy room.

### Operable
- [ ] All functionality available via keyboard (portal web) and via assistive touch/switch access (mobile).
- [ ] No content that flashes more than 3 times/second.
- [ ] Clear focus indicators (portal web).
- [ ] Touch targets sized appropriately for the educator app's "fast by default, minimal interactions" design principle (BRD §29) — accessibility and speed goals align here, not conflict.

### Understandable
- [ ] Consistent navigation and identification across the three front ends sharing a design system (per `/CLAUDE.md` Stage 0 deliverable "shared design system and component library").
- [ ] Error messages are specific and actionable (e.g., billing/payment errors — BRD §15 already requires explainability for financial information; the same clarity standard should extend to form validation errors generally).
- [ ] Reading level appropriate for a broad parent audience, especially for billing explanations (gross/subsidy/gap) and incident/medication notifications where comprehension under stress matters.

### Robust
- [ ] Semantic HTML / proper accessibility tree on native mobile components (not just visually-styled divs).
- [ ] Compatible with screen readers (VoiceOver/TalkBack for mobile, NVDA/JAWS for the portal).

## Process once UI exists

1. Automated checks in CI (e.g., axe-core for the web portal, accessibility inspector for React Native) as part of the quality gates already defined in `/CLAUDE.md`'s Definition of Done.
2. Manual audit with real assistive technology before pilot (Delivery Plan R5 "Accessibility audit against WCAG 2.2 AA; real-device testing on low-cost Android tablets on poor Wi-Fi" — note the explicit pairing of accessibility and real-device/poor-network testing, both targeting the same educator-in-the-field use case).
3. Update this document with actual findings once performed — this version is a target and checklist, not an audit result.
