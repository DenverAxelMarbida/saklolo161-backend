# Saklolo161 Backend — Project Context

Emergency response system for Marikina City, PH ("SAKLOLO 161"). This
file orients any AI coding agent (opencode, Claude Code, etc.) working
in this repo — the middleware gateway that both the mobile app and web
dashboard consume.

## This Repo

Express.js REST API, deployed on Render (no Docker — Render handles
PaaS containerization). CI via GitHub Actions (`npm ci` → lint →
`npm test` contract suite on push/PR to `main`).

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
- **Phase 3 (in progress):** Done and **live on Render** (verified
  2026-09-08): incident service layer (`services/incidentService.js`),
  real PAGASA river feed (pinned TLS, `source: "pagasa"|"mock"`),
  real routing (`GET /api/routes` + Mapbox), evidence upload
  (`POST /api/incidents/:id/evidence`), and the 15-case contract test
  suite wired into CI. **Held as a coordinated window:** the Firebase
  cutover (RTDB + Auth) and Semaphore-led inter-agency sends (task 5).
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
| `GET /api/routes` | None — public, rate-limited | Phase 3 (live). Real driving route via Mapbox Directions; straight-line fallback on failure. |
| `POST /api/incidents/:id/evidence` | None — public, rate-limited | Phase 3 (live). Multipart `file` → `{fileId, url, mimeType, sizeKb, uploadedAt}`; `url` is `""` until the Firebase Storage cutover. |

**Dispatched incidents expose the responding station at the TOP level:**
`station: { id, name, coords: { lat, lng } }` — not nested under
`dispatch`. `dispatch` still carries `stationId`, `assignment`, and the
SMS payload fields. `evidence: []` is always present (empty when none).

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

## STOP and Ask (phase-3 coordination)

Manual actions that mutate the shared infrastructure or need lead-only
secrets are **STOP and ask** moments — never do them silently:

- Setting/rotating env on Render (`MAPBOX_ACCESS_TOKEN`,
  `OPENWEATHER_API_KEY`, `JWT_SECRET`, and the held `FIREBASE_*`,
  `FIREBASE_DATABASE_URL`, `FIREBASE_CREDENTIALS`, `SEMAPHORE_API_KEY`).
- Enabling Firebase/Semaphore (Task 5 window only).
- Restarting or redeploying the shared Render instance mid-iteration.

**Lead-only secrets** (never request from another dev): Render env,
Firebase service-account JSON + RTDB URL + Storage rules, Semaphore
account + API key. Any dev may set locally: `PAGASA_RIVER_ENDPOINT`,
`PAGASA_RIVER_STATION`, a throwaway `MAPBOX_ACCESS_TOKEN`.

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

- **Evidence `url` is `""` until the Firebase Storage cutover** —
  uploads store real metadata (`fileId`, `mimeType`, `sizeKb`) in memory
  but the URL field is a placeholder. Clients must treat a truthy `url`
  as optional; don't force-render it.
- **The PAGASA feed TLS pin** (`config/pagasa-ca.pem`) could break if
  DOST-PAGASA rotates its certificate chain — regenerate it with
  `node scripts/refresh-pagasa-ca.js` when `source` flips to `mock`.
- `dispatchController.js`'s station/incident category match is a
  direct string comparison after normalization — confirm case handling
  stays consistent if new categories are ever added.
- The web dashboard's `"Mark En Route"` action (Phase 2 §2.6) is now the
  only trigger for `"En Route"`; no GPS/telemetry detection exists yet
  (held — needs a responder client to generate telemetry).
- Task 5 (Firebase RTDB + Auth + Semaphore) is deliberately NOT shipped —
  it is a coordinated window with the web `auth.js` swap. `authService.js`
  still issues JWTs against `data/mockUsers.js`.

## Post-Phase-3 Backlog (QA hardening — do NOT start until Task 5's window passes)

Recorded from the river-feed QA audit (flood-warning product). All items
are **additive, client-contract-safe** (`source`-style: new fields clients
ignore). Revisit after the Firebase/Semaphore cutover window.

1. **`degraded: true` on mock mode** — alongside `source: "mock"` in
   `GET /api/weather-river` so degradation is machine-visible to ops (a
   `source` field clients are told to ignore is not enough to monitor).
2. **Freshness surface** — `timestamp` in the payload is the API's own
   response time, not the feed's data time; a frozen PAGASA reading still
   reports `source: "pagasa"` indefinitely. Add `observedAt`/
   `dataAgeMinutes` OR a soft staleness check (e.g., `wl === wl1h ===
   wl2h` on repeated fetches → flag stale). This is the one real safety
   hole for a flood-warning product.
3. **Unit-test the pure logic** — `toMeters` (`(*)` stripping, null) and
   `classifyRiver` (exact-threshold edges: obs == alert, == alarm, ==
   critical; null thresholds) are untested; the contract suite only
   asserts response shape. Export them and cover the boundaries in CI.

Also relevant to the same backlog (previously noted): a river **trend**
signal (`rising/steady/falling` from `wl` vs `wl30m/wl1h/wl2h`) is cheap
to add but only worth it when a client genuinely needs early-warning
behavior. Slot it behind these three.

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