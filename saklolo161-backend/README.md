# Saklolo 161 — Middleware Gateway (Phase 1)

Node.js/Express middleware gateway for the **Saklolo 161 Emergency Response System**, a capstone SOA project for Marikina City. This service sits between the React Native mobile app, the React Web Dashboard, Firebase, and external APIs (Mapbox Geocoding, Semaphore SMS, Firebase Cloud Messaging).

**Phase 1 status:** Mock mode. Endpoints return realistic fake data so all 5 developers can build UI/logic in parallel without waiting on live Firebase, Mapbox, or Semaphore credentials.

---

## 1. Project Structure

```
saklolo161-backend/
├── config/
│   ├── env.js              # Centralized env var loader
│   ├── corsOptions.js      # Allowed origins for mobile/web dev servers
│   └── firebase.js         # Firebase Admin init (stubbed for Phase 1)
├── controllers/
│   └── incidentController.js
├── routes/
│   └── incidentRoutes.js
├── services/
│   ├── mapboxService.js    # Reverse geocoding (mocked)
│   └── semaphoreService.js # SMS notifications (mocked)
├── middlewares/
│   ├── validateIncident.js # Field validation for POST /api/incidents
│   └── errorHandler.js     # 404 + centralized error handling
├── data/
│   └── mockIncidents.js    # In-memory mock "database" (Phase 1 only)
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

> No real Mapbox/Semaphore/Firebase credentials are needed to run Phase 1 — everything runs in mock mode out of the box.

---

## 3. Incident Data Contract

This is the **shared schema** everyone builds against — mobile forms, dashboard tables, and Firebase records should all match this shape:

```json
{
  "incidentId": "INC-YYYYMMDD-XXXX",
  "citizenPhone": "string",
  "category": "Medical" | "Fire" | "Flood",
  "location": {
    "latitude": number,
    "longitude": number,
    "address": "string"
  },
  "status": "Pending" | "Dispatched" | "Resolved",
  "notes": "string",
  "timestamp": "ISO String"
}
```

---

## 4. API Endpoints

### `POST /api/incidents`
Creates a new incident report. Validates required fields, mock reverse-geocodes the address, and (mock) sends an SMS confirmation.

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
Returns all incidents — 5 seeded mock records across Marikina barangays, plus anything created during the current server session.

```bash
curl http://localhost:5000/api/incidents
```

### `GET /api/incidents/:id`
Returns a single incident by ID.

```bash
curl http://localhost:5000/api/incidents/INC-20250811-0001
```

### `PATCH /api/incidents/:id/status`
Updates an incident's status (`Pending` → `Dispatched` → `Resolved`) and (mock) sends an SMS status update.

```bash
curl -X PATCH http://localhost:5000/api/incidents/INC-20250811-0001/status \
  -H "Content-Type: application/json" \
  -d '{ "status": "Dispatched" }'
```

> ⚠️ Data resets every time the server restarts — it's an in-memory array (`data/mockIncidents.js`), not a real database yet.

---

## 5. Team Assignments

| Role | Developer Focus | Primary Files |
|---|---|---|
| **Lead Programmer** | Owns the middleware gateway, API contract, and integration between all 5 developers' work. Reviews PRs, keeps `server.js` and shared schema consistent. | `server.js`, `/routes`, `/controllers`, this README |
| **Mobile UI Developer** | Builds the React Native citizen-facing screens (incident report form, status tracker) against the endpoints above. | Consumes `POST /api/incidents`, `GET /api/incidents/:id` |
| **Mobile GPS/Mapbox Developer** | Wires up real GPS capture in the app and replaces the mocked `mapboxService.js` with live Mapbox Geocoding calls. | `services/mapboxService.js` |
| **Admin Web Dashboard Developer** | Builds the React web dashboard for dispatchers to view/manage incidents and update statuses. | Consumes `GET /api/incidents`, `PATCH /api/incidents/:id/status` |
| **Database/Notification Engine Developer** | Replaces the in-memory mock store with real Firebase Realtime Database calls, wires up Firebase Cloud Messaging, and implements the real Semaphore SMS integration. | `config/firebase.js`, `services/semaphoreService.js`, `data/mockIncidents.js` |

### Suggested Phase 2 handoff notes
- Every mock section in the code is clearly commented with `MOCK MODE` and includes the real implementation, commented out, right above it — just uncomment and fill in credentials.
- Once Firebase is wired up, swap the calls in `controllers/incidentController.js` from `mockIncidents.*` to `db.ref('incidents').*`.
- Update `config/corsOptions.js` if your dev server runs on a different port than the defaults listed there.

---

## 6. Environment Variables

See `.env.example` for the full list: `PORT`, `MAPBOX_ACCESS_TOKEN`, `SEMAPHORE_API_KEY`, `FIREBASE_CREDENTIALS`, `FIREBASE_DATABASE_URL`. Never commit your actual `.env` file — it's already in `.gitignore`.
