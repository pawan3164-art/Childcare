# U0 visual review (2026-10-05)

First in-browser review of every portal and educator-app screen, covering admin, educator and parent roles at phone (390×844), tablet (820×1180) and desktop (1280×800). Screens were captured with headless Microsoft Edge (`tests/visual/shoot.js`) because the Claude in Chrome extension was not connected. Run it again after any UI change:

```
cd tests/visual && npm install && node shoot.js        # all screens
node shoot.js edu                                         # educator app only
```

## Found and fixed

| # | Where | Problem | Fix |
|---|---|---|---|
| 1 | API: Child at a Glance, children list | A child signed in on a previous day and never signed out showed as **"Signed in" today** on the parent card, dashboard count, children list, attendance page and educator roster. Status came from the latest event ever, not today's. "Today" was also the server's day, which would be wrong on a UTC server. | Status now uses today's events in the **centre's timezone** (`startOfCentreDay`, DST-tested). New `previousDayNotSignedOut` flag shown as a warning badge to staff and a neutral note to parents. The children list also went from one query per child to two per centre (the known GET /children N+1 query). Tests: `test/care-loop/centre-day.spec.ts`, `child-glance.spec.ts`, `test/centre-admin/children-list-today.spec.ts`. |
| 2 | Portal, tablet | The permanent 240px sidebar squeezed content at 820px, so names wrapped onto two lines. | Sidebar collapses to the drawer below 1024px (`lg`) instead of 768px. |
| 3 | Portal care logging, phone | The exception-note input ran off-screen. | Child rows wrap; the note goes on its own line on phones. |
| 4 | Portal billing | Zero deductions showed as "- $0.00". | `formatDeduction`: "$0.00" when zero, "−$12.50" otherwise. |
| 5 | Portal and educator login | Demo passwords were shown in every build. | Shown only in development builds. |
| 6 | Educator app login | Enter in the password field did nothing; double taps could submit twice. | Enter submits; repeat submits are ignored. |
| 7 | Educator app tab bar | Labels were clipped on phones; emoji icons rendered inconsistently. | Vector icons (Ionicons); explicit bar height and label line height. |
| 8 | Educator app care log | Emoji activity icons; activity chips and child rows used `onTouchEnd` on plain views (no keyboard or screen-reader support); browser-default purple checkboxes. | Vector icons; `Pressable` with radio/checkbox roles and states; brand-coloured checkboxes. |
| 9 | Educator app roster | Status badges stretched across the row; no indication of which room was shown. | Badges hug their text; a room heading with child count appears when there is one room. |
| 10 | Educator app, tablet | Content and the login form stretched across the full width. | Screens cap content at 760px; the login form at 420px. |

## Not fixed yet (carried into later stages)

- **The portal and educator app look like different products.** The portal follows the OS dark/light setting; the educator app is light only, with its own tokens. A shared token set belongs with the parent app in U3, which will share the educator app's components.
- **Child-first parent navigation.** The parent view is the admin portal with fewer menu items. This is addressed by the parent app (U3).
- **The "Family ledger" page doesn't name the child or family** it belongs to.
- **WCAG 2.2 AA:** only spot fixes so far (roles and states above). A full audit is still a Stage 5 item that needs a real screen-reader pass.
- **Dev tooling:** Expo's file watcher does not pick up edits on this machine; restart `expo start --clear` after changes. A long-running Next.js dev server also degraded (compile workers crashed) and needed a restart.
