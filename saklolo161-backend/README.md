# Saklolo 161 — Middleware Gateway

Node.js/Express middleware gateway for the **Saklolo 161 Emergency Response System**, a capstone SOA project for Marikina City. This service sits between the React Native mobile app, the React Web Dashboard, Firebase, and external APIs (Mapbox Geocoding/Directions, TextBee SMS, PAGASA river feed).

**Status:** live on Render against Firebase RTDB + Firebase Auth, with live TextBee SMS and a 57-case contract test suite in CI (`npm test`). The in-memory mock store remains only as a code fallback/test path.

---

## 1. Project Structure

```
saklolo161-backend/
├── config/
│   ├── env.js              # Centralized env var loader
│   ├── corsOptions.js      # Allowed origins for mobile/web dev servers
│   ├── firebase.js         # Firebase Admin init (RTDB + Auth, one bootstrap)
│   ├── stations.js         # Static station fallback + phone-number config
│   └── pagasa-ca.pem       # Pinned TLS cert for the PAGASA feed
├── controllers/
│   ├── incidentController.js
│   ├── dispatchController.js
│   ├── authController.js
│   ├── userController.js
│   ├── evidenceController.js
│   ├── routingController.js
│   └── weatherController.js
├── routes/
│   ├── incidentRoutes.js
│   ├── authRoutes.js
│   ├── userRoutes.js
│   ├── weatherRoutes.js
│   └── routingRoutes.js
├── services/
│   ├── incidentService.js  # RTDB with mock fallback (never import the store directly)
│   ├── authService.js      # Firebase Auth REST login + verifyIdToken
│   ├── userService.js      # Staff account admin (Firebase Auth)
│   ├── stationService.js   # Station lookup (RTDB /stations, static fallback)
│   ├── mapboxService.js    # Reverse geocoding
│   ├── routingService.js   # Driving directions (GET /api/routes)
│   ├── riverService.js     # PAGASA feed with mock degradation
│   ├── evidenceService.js  # Firebase Storage uploads
│   ├── smsQueue.js         # Per-incident ordered, non-blocking SMS queue
│   ├── passwordPolicy.js   # Staff password rules
│   └── textbeeService.js   # SMS notifications (TextBee gateway, never rejects)
├── middlewares/
│   ├── validateIncident.js # Field validation for POST /api/incidents
│   ├── verifyAuth.js       # Bearer-token auth + agency scoping
│   ├── requireAdmin.js     # Admin-role gate for /api/users
│   ├── rateLimitIncidents.js / rateLimitPublic.js
│   └── errorHandler.js     # 404 + centralized error handling
├── data/
│   └── mockIncidents.js    # In-memory fallback store (test path only)
├── test/
│   └── contract.test.mjs   # 57-case contract suite (CI)
├── scripts/                # Provisioning / seed / maintenance scripts
├── server.js                # Entry point
├── .env.example
├── .gitignore
└── package.json
```

---

## 2. Getting Started

```bash
# 1. Install dependencies
npm install

# 2. Copy the environment template and fill in real values later
cp .env.example .env

# 3. Start the mock server (auto-restarts on file changes)
npm run dev
```

Server runs at **http://localhost:5000** by default. Visit `http://localhost:5000/` for a health check.

> Local runs need real Firebase credentials (service-account file +
> database URL + web API key per `.env.example`) — the server refuses
> to start without them.

### SMS provider (TextBee)

SMS notifications go through **TextBee**
(`services/textbeeService.js`, `POST /api/v1/gateway/send-sms`),
queued per incident via `services/smsQueue.js` (ordered, non-blocking,
never rejects):

- **Start/end-only policy:** each incident sends exactly two citizen
  texts, both to the registered `citizenPhone` — the report
  confirmation at creation and the resolution text on a genuine
  transition to `Resolved`. Dispatch and intermediate statuses
  (`Dispatched`, `En Route`) send no SMS to anyone; station contact
  stays voice-call.

- TextBee **queues** each message to the connected Android device; the phone's
  SIM sends it. An HTTP 200 / `success` result means **accepted/queued — not
  guaranteed handset delivery**.
- The **Android gateway phone must remain online and SMS-capable**; if it is
  offline (or no device is enabled), sends fail — safely: `sendSms()` never
  rejects, and an SMS failure never blocks or rolls back an incident operation.
- `TEXTBEE_API_KEY` is a **lead-only secret** (set in Render env / local `.env`
  only — never committed, logged, or shared). `TEXTBEE_DEVICE_ID` is optional;
  leave it empty to use TextBee's default device.

---

## 3. Incident Data Contract

This is the **shared schema** everyone builds against — mobile forms, dashboard tables, and Firebase records should all match this shape:

```json
{
  "incidentId": "INC-YYYYMMDD-XXXX",
  "citizenPhone": "string",
  "category": "Medical" | "Fire" | "Flood" | "Crime",
  "location": {
    "latitude": number,
    "longitude": number,
    "address": "string"
  },
  "status": "Pending" | "Dispatched" | "En Route" | "Resolved",
  "station": { "id": "string", "name": "string", "coords": { "lat": number, "lng": number } },
  "dispatch": { "stationId": "string", "assignedUnit": "string", "...": "..." },
  "evidence": [],
  "notes": "string",
  "timestamp": "ISO String"
}
```

(`station`/`dispatch` appear once dispatched; `evidence` is always present.)

---

## 4. API Endpoints

### `POST /api/incidents`
Creates a new incident report. Validates required fields, reverse-geocodes the address, persists to Firebase RTDB, and queues a confirmation SMS to the citizen.

```bash
curl -X POST http://localhost:5000/api/incidents \
  -H "Content-Type: application/json" \
  -d '{
    "citizenPhone": "+639171234567",
    "category": "Fire",
    "location": { "latitude": 14.65, "longitude": 121.10 },
    "notes": "Smoke coming from a nearby house"
  }'
```
Returns `201 Created` with the full incident object (including generated `incidentId` and mocked `address`).

### `GET /api/incidents`
Returns all incidents the caller's agency may see (dispatcher token required, agency-filtered server-side).

```bash
curl http://localhost:5000/api/incidents
```

### `GET /api/incidents/:id`
Returns a single incident by ID.

```bash
curl http://localhost:5000/api/incidents/INC-20250811-0001
```

### `PATCH /api/incidents/:id/status`
Updates an incident's status (`Pending` → `Dispatched` → `En Route` → `Resolved`). Only a genuine transition to `Resolved` queues a citizen SMS; every other transition still returns 200 with no text.

### `POST /api/incidents/dispatch`
Assigns a station + unit (dispatcher token, agency-scoped). Persists the `dispatch`/`station` blocks and computes a driving ETA. Sends no SMS.

### `POST /api/auth/login`
Staff login via Firebase Auth REST. Returns a Firebase ID token plus `{ uid, email, agency, role }`.

### Staff User Management (`/api/users`, admin role required)
`GET /` list, `POST /` create, `PATCH /:uid` update, `PATCH /:uid/status` enable/disable, plus `POST /me/password` for self-service password change.

### `GET /api/routes`, `GET /api/weather-river`, evidence endpoints
Driving directions (Mapbox, straight-line fallback), PAGASA river data (`source: "pagasa" | "mock"`), and evidence upload (`POST /api/incidents/:id/evidence`, multipart `file`) with Firebase Storage URLs — all public and rate-limited. See `AGENTS.md` for the full contract table.

```bash
curl -X PATCH http://localhost:5000/api/incidents/INC-20250811-0001/status \
  -H "Content-Type: application/json" \
  -d '{ "status": "Dispatched" }'
```

> ⚠️ The in-memory mock store is a fallback/test path only — live data lives in Firebase RTDB and survives restarts.

---

## 5. Team Assignments

| Area | Focus | Primary Files |
|---|---|---|
| **Middleware gateway** | Owns the API contract and integration between all clients' work. Reviews PRs, keeps `server.js` and shared schema consistent. | `server.js`, `/routes`, `/controllers`, this README |
| **Mobile client** | Citizen-facing report form and status tracker against the public endpoints. | Consumes `POST /api/incidents`, `GET /api/incidents/:id` |
| **Web dashboard** | Dispatcher incident queue, dispatch, status updates, User Management. | Consumes `GET /api/incidents`, `POST /api/incidents/dispatch`, `PATCH /api/incidents/:id/status`, `/api/users` |
| **Data/notifications** | Firebase RTDB/Auth, Storage uploads, TextBee SMS integration. | `config/firebase.js`, `services/*`, `data/mockIncidents.js` |

- New endpoints follow the `{ success, message, data }` shape (see `incidentController.js`).
- Controllers never touch the store, stations config, or Firebase SDK directly — see `AGENTS.md` Hard Rules.
- Update `config/corsOptions.js` if your dev server runs on a different port than the defaults listed there.

---

## 6. Environment Variables

See `.env.example` for the full list: `PORT`, `MAPBOX_ACCESS_TOKEN`, `TEXTBEE_API_KEY`, `TEXTBEE_DEVICE_ID`, `FIREBASE_CREDENTIALS` / `FIREBASE_CREDENTIALS_JSON`, `FIREBASE_DATABASE_URL`, `FIREBASE_WEB_API_KEY`, station duty phones, and the legacy `JWT_SECRET` (no longer used — kept for backward compatibility). Never commit your actual `.env` file — it's already in `.gitignore`. (`TEXTBEE_API_KEY` and Firebase credentials are lead-only secrets — never paste real values into docs, code, or commits.)
