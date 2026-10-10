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
- **Phase 2 (done):** Staff auth, agency-scoped authorization, per-phone
  rate limiting, `elapsedMinutes`, dispatcher `"Mark En Route"` action —
  merged and live.
- **Phase 3 (done, live on Render):** incident service layer
  (`services/incidentService.js`), real PAGASA river feed (pinned TLS,
  `source: "pagasa"|"mock"`), real routing (`GET /api/routes` +
  Mapbox), evidence upload (`POST /api/incidents/:id/evidence`) with
  Firebase Storage download URLs, Firebase RTDB incident storage,
  Firebase Auth cutover (login returns a Firebase ID token via Auth
  REST; `verifyToken()` → `verifyIdToken()`), staff User Management
  API (`GET/POST /api/users`, `PATCH /api/users/:uid`,
  `PATCH /api/users/:uid/status`, `POST /api/users/me/password`), live
  TextBee sends, and the contract test suite (57 cases) wired into CI.
  - Task list: `../Phase 3/saklolo161-backend-phase3-tasks.md`
  - Frozen contract: `../Phase 3/saklolo161-phase3-contracts.md`
  - Auth cutover checklist: `../Phase 3/saklolo161-auth-coordination.md`
  (historical — the coordinated window has landed; see "STOP and Ask").
- **SMS notifications (current policy — start/end only):** the citizen's
  registered `citizenPhone` gets exactly two texts per incident: the
  report confirmation at creation and the resolution text on a genuine
  transition to `Resolved`. Dispatch and intermediate statuses
  (`Dispatched`, `En Route`) send no SMS to anyone; station contact
  stays voice-call. All sends go through the per-incident ordered,
  non-blocking `services/smsQueue.js` (see "Established Patterns").

## API Contract

| Endpoint | Auth | Notes |
|---|---|---|
| `POST /api/incidents` | None — must stay public | Mobile's entry point. Rate-limited per `citizenPhone`. |
| `GET /api/incidents/:id` | None — must stay public | Mobile's status-polling endpoint. **Never move this behind auth** — mobile has no login and never will in this architecture. |
| `GET /api/incidents` | Dispatcher token required | Full list, agency-filtered server-side (`req.user.agency`). Web dashboard only. |
| `POST /api/incidents/dispatch` | Dispatcher token required | Agency-scoped: a FIRE-agency token can't dispatch a MEDICAL incident. |
| `PATCH /api/incidents/:id/status` | Dispatcher token required | Accepts any of `Pending/Dispatched/En Route/Resolved`. Generic — no per-status special-casing needed. Only a genuine transition to `Resolved` sends a citizen SMS (see SMS policy above). |
| `POST /api/auth/login` | None (public, rate-limited) | Staff login via Firebase Auth REST; returns a Firebase ID token + `{ uid, email, agency, role }` from custom claims. The web dashboard signs in with the Firebase client SDK directly; this endpoint remains for compatibility and CI smoke tests. |
| `GET /api/users` | Admin role required | Staff account list (web User Management). |
| `POST /api/users` | Admin role required | Create staff account `{ email, password, agency, role }`. |
| `PATCH /api/users/:uid` | Admin role required | Update email / agency / role. |
| `PATCH /api/users/:uid/status` | Admin role required | Enable / disable an account `{ enabled }`. |
| `POST /api/users/me/password` | Dispatcher token required | Authenticated user changes their own password. |
| `GET /api/weather-river` | None | 10-min server-side cache. Gains UI-ignored `source: "pagasa" | "mock"` in Phase 3. |
| `GET /api/routes` | None — public, rate-limited | Phase 3 (live). Real driving route via Mapbox Directions; straight-line fallback on failure. |
| `POST /api/incidents/:id/evidence` | None — public, rate-limited | Phase 3 (live). Multipart `file` → `{fileId, url, mimeType, sizeKb, uploadedAt}`; `url` is the Firebase Storage download URL (absolute). |
| `POST /api/incidents/:id/evidence-status` | None — public, rate-limited | Additive evidence-progress signal from mobile: `{ evidenceUploading, evidenceExpectedCount, evidenceFailedCount, evidenceAttempt, evidenceAttemptsTotal }`. The two attempt fields are optional non-negative integers (retry-attempt telemetry; both default to 0 on read) and share the endpoint's rate-limit budget with uploads — clients must throttle their own pings. |

**Dispatched incidents expose the responding station at the TOP level:**
`station: { id, name, coords: { lat, lng } }` — not nested under
`dispatch`. `dispatch` still carries `stationId`, `stationName`,
`assignedUnit`, `estimatedTurnout`, `dispatchedAt`, and
`arrivalEtaMinutes`. `evidence: []` is always present (empty when none).

**The line that must never move:** `GET /api/incidents/:id` is public
and `GET /api/incidents` is not. Mobile depends on that split staying
exactly where it is — don't refactor these into one parameterized
handler without preserving the auth boundary.

## Hard Rules (do not violate)

1. **Never hardcode station duty phone numbers anywhere outside
   `config/env.js`/`config/stations.js`.** Controllers resolve stations
   by ID through `services/stationService.js` only.
2. **Controllers never import the underlying store or crypto
   library directly.** `stationService.js` and `services/authService.js`
   are the only files that know about `config/stations.js` or the
   Firebase Admin SDK. This is what made the Phase 3 Firebase swap a
   one-file change per concern — preserve it.
3. **This repo does not write frontend code.** If a task seems to need
   a new UI behavior, it needs a new/changed endpoint here that the
   frontend then consumes — flag it rather than reaching into
   `saklolo161-web` or `saklolo161-mobile`.
4. **Incident storage is Firebase RTDB.** The in-memory mock store
   (`data/mockIncidents.js`, `data/mockUsers.js`) remains only as a
   fallback/test path — don't build features against it, and don't
   "fix" test-only mock behavior by adding production persistence
   around it.

## STOP and Ask (shared infrastructure)

Manual actions that mutate the shared infrastructure or need lead-only
secrets are **STOP and ask** moments — never do them silently:

- Setting/rotating env on Render (`MAPBOX_ACCESS_TOKEN`,
  `OPENWEATHER_API_KEY`, `JWT_SECRET`, `FIREBASE_*`,
  `FIREBASE_DATABASE_URL`, `FIREBASE_CREDENTIALS`,
  `TEXTBEE_API_KEY`, `TEXTBEE_DEVICE_ID`).
- Re-provisioning Firebase Auth accounts or changing custom claims
  (`agency`/`role`) — the web dashboard's access depends on them.
- Restarting or redeploying the shared Render instance mid-iteration.

(The Phase 3 Firebase cutover coordinated window has landed — backend
and web both run Firebase Auth now. There is no pending cutover; treat
any fresh auth/storage migration as a new STOP-and-ask item.)

**Lead-only secrets** (never request from another dev): Render env,
Firebase service-account JSON + RTDB URL + Storage rules, TextBee
account + API key. Any dev may set locally: `PAGASA_RIVER_ENDPOINT`,
`PAGASA_RIVER_STATION`, a throwaway `MAPBOX_ACCESS_TOKEN`.

**SMS provider: TextBee** (`services/textbeeService.js`) — SMS is
queued to the connected Android gateway device and sent through that
phone's SIM. HTTP 200 / success = accepted/queued, **not** guaranteed
handset delivery; the Android phone must stay online and SMS-capable.
`TEXTBEE_API_KEY` is a lead-only secret. `sendSms()` never rejects —
SMS failures stay isolated from incident operations. (The legacy
Semaphore env vars remain only for a rollback window.)

**SMS policy is start/end only:** per incident, exactly two citizen
texts — the report confirmation at creation and the resolution text on
a genuine transition to `Resolved`, both to the registered
`citizenPhone`. Dispatch and intermediate statuses send nothing to
anyone; station contact stays voice-call. Sends are ordered per
incident and non-blocking via `services/smsQueue.js` (see
"Established Patterns").

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
  in `VALID_STATUSES` — there's no per-status special-casing and no
  dedicated endpoint per status. Only a genuine transition to
  `Resolved` sends a citizen SMS; every other status (and any repeat
  of the current status) still returns the normal 200 envelope with no
  text. Don't add a dedicated endpoint per status.
- **Ordered, deduplicated citizen SMS:** the two citizen texts (creation
  confirmation, resolution) are queued through
  `services/smsQueue.js` — one FIFO chain per incident, so the
  resolution is only handed to TextBee after the confirmation, and two
  concurrent handlers can't submit out of order.
  `claimAnnouncement(incidentId, status)` records every genuine status
  transition but only the `Resolved` claim sends: a PATCH that doesn't
  actually change the status, or repeats the last announced one
  (double-click, retry, racing duplicate), still returns the normal 200
  envelope but sends nothing. This is a consecutive-duplicate guard
  over the last announced status, not a universal
  one-SMS-per-(incident, status) rule — leaving `Resolved` and coming
  back sends again. Dispatch itself sends nothing and claims nothing.

## Frontend Devs Running This Repo Locally

Both the web and mobile devs should clone and run this repo locally
for day-to-day Phase 2 iteration, rather than pointing only at the
live Render URL. Clone/pull only — no push access needed, and this
doesn't conflict with Hard Rule 3 ("this repo does not write frontend
code"); running someone else's service locally to test against isn't
touching this repo's code.

Why it matters more than usual right now:

1. **The live instance is shared, not private.** Auth, agency-scoped
   filtering, rate limiting, routing, evidence, and User Management are
   all live on Render — but every dev sharing it eats cold-start
   latency and shares the per-phone rate-limit quota during rapid
   iteration.
2. **Render's free tier cold-starts** add latency every dev sharing
   the live instance eats during rapid iteration, not just first load.
3. **One backend, one dataset per instance.** Test incidents, test
   accounts, and dispatch actions from different devs collide in the
   same pot when sharing one backend — local or live. The live Render
   instance uses Firebase RTDB/Auth, so its data survives restarts.
   Local runs need real Firebase credentials too (a service-account
   file per `.env.example` — the server refuses to start without them,
   and the in-memory mock store is only a code fallback/test path, not
   a supported dev mode).
4. **The per-phone rate limiter (1.5) is shared** across every client
   hitting the same live instance — local backend gives each dev their
   own quota.

Quick start for them: `git clone`, `npm install`, `cp .env.example
.env` — then fill in real Firebase credentials (service-account file
+ database URL + web API key; the server will not start without them).
`npm run dev` → `localhost:5000`. Web
points `VITE_API_BASE_URL` at it; mobile points
`EXPO_PUBLIC_API_BASE_URL` at the machine's LAN IP (not `localhost`)
since a phone in Expo Go is a separate device on the network —
`config/corsOptions.js` already whitelists local network IPs for
exactly this.

A local backend also gives each dev their own per-phone rate-limit
quota and a private dataset to iterate against, instead of colliding
with other testers on the live instance.

## Known Gaps

- **Evidence media fallback when Storage is unconfigured.** Uploads
  normally go to Firebase Storage with absolute download URLs; when
  Firebase isn't configured the metadata is stored in-memory with a
  placeholder URL (still 200, client flow intact). Don't rely on that
  fallback for anything beyond local smoke testing.
- **The PAGASA feed TLS pin** (`config/pagasa-ca.pem`) could break if
  DOST-PAGASA rotates its certificate chain — regenerate it with
  `node scripts/refresh-pagasa-ca.js` when `source` flips to `mock`.
- `dispatchController.js`'s station/incident category match is a
  direct string comparison after normalization — confirm case handling
  stays consistent if new categories are ever added.
- The web dashboard's `"Mark En Route"` action is the only trigger for
  `"En Route"`; no GPS/telemetry detection exists yet
  (held — needs a responder client to generate telemetry).
- **Contract-suite load vs. live Firebase Auth.** The suite logs in
  dozens of times per run against the real Auth REST API; rapid
  repeat runs have throttled into transient 401s/timeouts in
  `loginAs`-dependent tests. Space full-suite runs a few minutes
  apart; a lone failure in an untouched auth-adjacent test with a
  green re-run is flakes, not product.
- `mapboxService.reverseGeocode` has no fetch timeout (robustness gap,
  out of scope of the SMS work).

## Post-Phase-3 Backlog (QA hardening — do NOT start until Task 5's window passes)

Recorded from the river-feed QA audit (flood-warning product). All items
are **additive, client-contract-safe** (`source`-style: new fields clients
ignore). Revisit after the Firebase/TextBee cutover window.

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

## Phase 3 Migration Path (completed — reference only)

| Layer | Before | After (current) |
|---|---|---|
| Incident storage | `data/mockIncidents.js` in-memory | Firebase RTDB (`incidentService.js` branches on `getDb()`) |
| Station storage | `config/stations.js` static | Firebase RTDB `/stations` node (`stationService.js` already branched — no code change needed) |
| User storage | `data/mockUsers.js` in-memory | Firebase Auth user records (`userService.js` / `authService.js`) |
| Token verification | `authService.verifyToken()` checked JWT | `admin.auth().verifyIdToken()` (Firebase ID token) |
| Login | Issued JWT against mock users | Firebase Auth REST `signInWithPassword`, returns Firebase ID token |
| Everything that calls `authService.verifyToken()` | — | **Unchanged** |

`config/firebase.js` holds the single shared SDK bootstrap for the
database and auth surfaces. Any future auth/storage migration is a new
STOP-and-ask item — do not treat this table as a live plan.