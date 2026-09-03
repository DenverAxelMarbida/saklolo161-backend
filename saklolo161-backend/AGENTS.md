# Saklolo161 Backend — Project Context

Emergency response system for Marikina City, PH ("SAKLOLO 161"). This
file orients any AI coding agent (opencode, Claude Code, etc.) working
in this repo — the middleware gateway that both the mobile app and web
dashboard consume.

## This Repo

Express.js REST API, deployed on Render (no Docker — Render handles
PaaS containerization). CI via GitHub Actions (`npm ci` on push/PR to
`main`).

## Related Repos (context only — don't assume their contents)

| Repo | Stack | Relationship to this repo |
|---|---|---|
| `saklolo161-mobile` | Expo React Native | Citizen-facing, unauthenticated. Calls only `POST /api/incidents` and `GET /api/incidents/:id`. |
| `saklolo161-web` | React 19 + Vite + Tailwind | Dispatcher-facing, authenticated. Calls `GET /api/incidents`, `POST /api/incidents/dispatch`, `PATCH /api/incidents/:id/status`, `POST /api/auth/login`. |

If a task needs you to reason about mobile or web internals, ask for
those files rather than assuming — this repo has been reviewed, they
haven't necessarily been in every session.

## Roadmap Status

- **Phase 1 (done):** Live on Render, ~370 RPS load-tested. Confirmed
  endpoints: `GET /api/weather-river` (10-min cache), `GET /api/incidents`,
  `POST /api/incidents`, `POST /api/incidents/dispatch`,
  `PATCH /api/incidents/:id/status`.
- **Phase 2 (in progress):** Staff auth (JWT-based, decoupled from
  Firebase — see `services/authService.js` once built), agency-scoped
  authorization, rate limiting on the public incident-creation endpoint.
  Full step-by-step task list: `saklolo161-backend-phase2-tasks.md`.
- **Phase 3 (next):** Firebase Realtime Database (`asia-southeast1`)
  replaces the in-memory mock stores; Firebase Auth replaces the JWT
  layer; Semaphore SMS goes live. See "Phase 3 migration path" below.

## API Contract

| Endpoint | Auth (once Phase 2 ships) | Notes |
|---|---|---|
| `POST /api/incidents` | None — must stay public | Mobile's entry point. Rate-limited per `citizenPhone`. |
| `GET /api/incidents/:id` | None — must stay public | Mobile's status-polling endpoint. **Never move this behind auth** — mobile has no login and never will in this architecture. |
| `GET /api/incidents` | Dispatcher JWT required | Full list, agency-filtered server-side (`req.user.agency`). Web dashboard only. |
| `POST /api/incidents/dispatch` | Dispatcher JWT required | Agency-scoped: a FIRE-agency token can't dispatch a MEDICAL incident. |
| `PATCH /api/incidents/:id/status` | Dispatcher JWT required | Accepts any of `Pending/Dispatched/En Route/Resolved`. Generic — no per-status special-casing needed. |
| `POST /api/auth/login` | None (this *is* the login) | New in Phase 2. |
| `GET /api/weather-river` | None | 10-min server-side cache. |

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

- No current trigger sets an incident to `"En Route"` from any client
  yet — the endpoint supports it, nothing calls it. (Being added on
  the web dashboard side as a manual dispatcher action — see
  `saklolo161-web-phase2-tasks.md` §2.6. No backend change needed.)
- `dispatchController.js`'s station/incident category match is a
  direct string comparison after normalization — confirm case handling
  stays consistent if new categories are ever added.

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
`saklolo161-auth-implementation-plan-v2.md` for the full cutover
checklist (re-provisioning accounts, the scheduled forced re-login,
what to verify before/after) before running this migration.