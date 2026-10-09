# Parent Mobile App (Childcare Family)

React Native / Expo (SDK 57, Expo Router) app for parents and guardians. Child-first: a header shows the selected child (with a switcher for siblings) and every tab follows that child.

## What it does (U3, slice 1)
- **Today**: attendance status, daily timeline (sign in/out, care records, photos) with day navigation, and a banner when announcements need acknowledging.
- **Learning**: the child's published observations and learning stories (EYLF V2.0) with photos.
- **Messages**: centre/room announcements (with "Got it" acknowledgement) and conversations with the child's room.
- **Bills**: explainable balance (fees, subsidy, payments, credits, adjustments). Payments are recorded by the centre; there is no online payment yet.
- **More**: profile and sign out. Absences, casual days and pickup are shown as "Soon" (slice 2, needs new API endpoints and policy decisions).
- Staying signed in across launches (token kept in the device keychain/keystore; web uses localStorage). Staff accounts are rejected: this app is for the PARENT role.

## Develop
```
cd apps/parent-mobile
npm install
npx expo start --web         # needs the API on EXPO_PUBLIC_API_URL (default http://localhost:3000)
npm test                     # unit tests for lib/ (pure logic, no RN runtime)
npm run typecheck
```
Demo parent logins come from `services/api/prisma/seed.ts` (e.g. `parent.nguyen@example.test`, two children).

## Build for phones
`eas.json` bakes in `EXPO_PUBLIC_API_URL=https://api.justforfewtests.in`. Run `eas init` once in this folder (it creates the Expo project and writes its ID into `app.json`), then `eas build --profile preview --platform android|ios`. See `docs/deploy-vps-pilot.md`.

## Notes
- Logic lives in `lib/` and is test-first (`__tests__/`): formatting, ledger explanations, timeline descriptions, feed merging, session persistence, API client.
- Access tokens last 12h on the pilot server because there is no refresh-token flow yet (OI-28).
