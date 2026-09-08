# Saklolo161 Backend — Project Context

Emergency response system for Marikina City, PH ("SAKLOLO 161"). This
file orients any AI coding agent (opencode, Claude Code, etc.) working
in this repo — the middleware gateway that both the mobile app and web
dashboard consume.

## This Repo

Express.js REST API, deployed on Render (no Docker — Render handles
PaaS containerization). CI via GitHub Actions (`npm ci` → lint → test
on push/PR to `main`; contract tests land in Phase 3 task 6).

## Related Repos (context only — don't assume their contents)

| Repo | Stack | Relationship to this repo |
|---|---|---|
| `saklolo161-mobile` | Expo React Native | Citizen-facing, unauthenticated. Calls `POST /api/incidents`, `GET /api/incidents/:id`, plus Phase 3 `GET /api/routes` and `POST /api/incidents/:id/evidence`. |
| `saklolo161-web` | React 19 + Vite + Tailwind | Dispatcher-facing, authenticated. Calls `GET /api/incidents`, `POST /api/incidents/dispatch`, `PATCH /api/incidents/:id/status`, `GET /api/routes`. (`POST /api/auth/login` is removed in the Phase 3 Firebase cutover.) |

If a task needs you to reason about mobile or web internals, ask for
those files rather than assuming — this repo has been reviewed, they
haven't necessarily been in every session.

## Roadmap Status

- **Phase 1 (done):** Live on Render, ~370 RPS load-tested. Confirmed
  endpoints: `GET /api/weather-river` (10-min cache), `GET /api/incidents`,
  `POST /api/incidents`, `POST /api/incidents/dispatch`,
  `PATCH /api/incidents/:id/status`.
- **Phase 2 (done):** Staff auth (JWT, decoupled from Firebase via
  `services/authService.js`), agency-scoped authorization, per-phone
  rate limiting, `elapsedMinutes` — merged and live.
- **Phase 3 (in progress):**
  - Incident service layer, real PAGASA river feed, real routing
    (`GET /api/routes`), evidence upload, contract tests, then the
    Firebase cutover (RTDB + Auth + Semaphore) as a coordinated window.
  - Task list: `../Phase 3/saklolo161-backend-phase3-tasks.md`
  - Frozen contract to build against: `../Phase 3/saklolo161-phase3-contracts.md`
  - Auth cutover checklist: `../Phase 3/saklolo161-auth-coordination.md`
  See "Phase 3 migration path" below.

## API Contract

| Endpoint | Auth | Notes |
|---|---|---|
| `POST /api/incidents` | None — must stay public | Mobile's entry point. Rate-limited per `citizenPhone`. |
| `GET /api/incidents/:id` | None — must stay public | Mobile's status-polling endpoint. **Never move this behind auth** — mobile has no login and never will in this architecture. |
| `GET /api/incidents` | Dispatcher token required | Full list, agency-filtered server-side (`req.user.agency`). Web dashboard only. |
| `POST /api/incidents/dispatch` | Dispatcher token required | Agency-scoped: a FIRE-agency token can't dispatch a MEDICAL incident. |
| `PATCH /api/incidents/:id/status` | Dispatcher token required | Accepts any of `Pending/Dispatched/En Route/Resolved`. Generic — no per-status special-casing needed. |
| `POST /api/auth/login` | Removed in Phase 3 | Phase 2 JWT login only; replaced by Firebase Auth on the web client in the coordinated cutover. |
| `GET /api/weather-river` | None | 10-min server-side cache. Gains UI-ignored `source: "pagasa" | "mock"` in Phase 3. |
| `GET /api/routes` | None — public, rate-limited | Phase 3. Real driving route via Mapbox Directions; straight-line fallback on failure. |
| `POST /api/incidents/:id/evidence` | None — public, rate-limited | Phase 3. Multipart `file` → Firebase Storage + metadata under `evidence[]`. |

**The line that must never move:** `GET /api/incidents/:id` is public
and `GET /api/incidents` is not. Mobile depends on that split staying
exactly where it is — don't refactor these into one parameterized
handler without preserving the auth boundary.

## Hard Rules (do not violate)

1. **Never hardcode station duty phone numbers anywhere outside
   `config/env.js`/`config/stations.js`.** Controllers resolve stations
   by ID through `services/stationService.js` only.
2. **Controllers never import the underlying store or crypto/JWT
   library directly.** `stationService.js` and (once built)
   `services/authService.js` are the only files that know about
   `config/stations.js` or `bcryptjs`/`jsonwebtoken`. This is what
   makes the Phase 3 Firebase swap a one-file change per concern.
3. **This repo does not write frontend code.** If a task seems to need
   a new UI behavior, it needs a new/changed endpoint here that the
   frontend then consumes — flag it rather than reaching into
   `saklolo161-web` or `saklolo161-mobile`.
4. **Mock data (`data/mockIncidents.js`, `data/mockUsers.js` once
   built) resets on server restart.** This is a known, accepted Phase 2
   trade-off — don't "fix" it by adding persistence ahead of the Phase
   3 Firebase migration.

## Established Patterns

- **Service abstraction layer:** `dispatchController.js` never touches
  `config/stations.js` directly — only `services/stationService.js`.
  Any new external dependency (auth, future SMS/routing providers)
  should follow this same shape: one service file other code depends
  on, never the underlying library/config directly.
- **Response shape:** `{ success, message, data }` (or `{ success,
  message, errors }` on validation failure) — see
  `incidentController.js` for the convention. New endpoints should
  match this rather than inventing a new shape.
- **Generic status updates:** `updateIncidentStatus` accepts any value
  in `VALID_STATUSES` and fires the same SMS-notification code path
  regardless of which one — there's no per-status special-casing.
  Don't add a dedicated endpoint per status; the generic one already
  covers `"En Route"`, etc.

## Frontend Devs Running This Repo Locally

Both the web and mobile devs should clone and run this repo locally
for day-to-day Phase 2 iteration, rather than pointing only at the
live Render URL. Clone/pull only — no push access needed, and this
doesn't conflict with Hard Rule 3 ("this repo does not write frontend
code"); running someone else's service locally to test against isn't
touching this repo's code.

Why it matters more than usual right now:

1. **Unreleased work isn't on Render yet.** `authService.login()`,
   agency-scoped filtering, rate limiting, and `markEnRoute` support
   all get built here before they're deployed — there's nothing to
   test the paired frontend changes against remotely until they land.
2. **Render's free tier cold-starts** add latency every dev sharing
   the live instance eats during rapid iteration, not just first load.
3. **`data/mockIncidents.js` and `data/mockUsers.js` are one shared,
   resettable in-memory array on the live instance.** Test incidents,
   test accounts, and dispatch actions from different devs collide in
   the same pot, and a Render restart wipes everyone's test data at
   once.
4. **The per-phone rate limiter (1.5) is shared** across every client
   hitting the same live instance — local backend gives each dev their
   own quota.

Quick start for them: `git clone`, `npm install`, `cp .env.example
.env` (documented local-dev fallbacks already cover `JWT_SECRET` etc.
— no real secrets needed), `npm run dev` → `localhost:5000`. Web
points `VITE_API_BASE_URL` at it; mobile points
`EXPO_PUBLIC_API_BASE_URL` at the machine's LAN IP (not `localhost`)
since a phone in Expo Go is a separate device on the network —
`config/corsOptions.js` already whitelists local network IPs for
exactly this.

This is also how the web dev tests steps 1.3/1.4 (route protection)
together with the matching web auth changes (2.1/2.2) before the
coordinated deploy mentioned above, instead of either side being
half-broken against a mismatched remote instance.

## Known Gaps

- **Incidents have no service layer yet** — `incidentController.js` and
  `dispatchController.js` import `data/mockIncidents.js` directly.
  Phase 3 task 1 adds `services/incidentService.js` (getDb() branch) so
  the Firebase store swap stays a contained change. This is the biggest
  remaining seam.
- River level in `GET /api/weather-river` is hardcoded mock until the
  PAGASA feed ships (Phase 3 task 2).
- No test suite — Phase 3 task 6 adds contract tests wired into CI.
- `dispatchController.js`'s station/incident category match is a
  direct string comparison after normalization — confirm case handling
  stays consistent if new categories are ever added.
- The web dashboard's `"Mark En Route"` action (Phase 2 §2.6) is now the
  only trigger for `"En Route"`; no GPS/telemetry detection exists yet
  (held — needs a responder client to generate telemetry).

## Phase 3 Migration Path

| Layer | Phase 2 | Phase 3 | Files touched |
|---|---|---|---|
| Incident storage | `data/mockIncidents.js` in-memory | Firebase RTDB | `incidentController.js`'s data calls |
| Station storage | `config/stations.js` static, `stationService.js` already Firebase-ready | Firebase RTDB `/stations` node | None — `stationService.js` already branches on `getDb()` |
| User storage | `data/mockUsers.js` in-memory | Firebase Auth user records | `authService.js` internals only |
| Token verification | `authService.verifyToken()` checks JWT | `admin.auth().verifyIdToken()` | `authService.js` only |
| Everything that calls `authService.verifyToken()` | — | **Unchanged** | None |

Uncomment the real `admin.initializeApp(...)` block in
`config/firebase.js` once, for both the database and auth surfaces
together — they share one SDK bootstrap. See
`../Phase 3/saklolo161-auth-coordination.md` for the full cutover
checklist (re-provisioning accounts, the scheduled forced re-login,
what to verify before/after) before running this migration — it is a
scheduled window paired with the web dev's `auth.js` swap, never a
silent deploy.