# Doctor Tracker — API

> REST API for **Doctor Tracker**: online doctor appointments for patients across Bangladesh, a consulting workspace for doctors, and a roster-and-analytics portal for administrators.
> Frontend repository: [doctor-tracker-frontend](https://github.com/sadatnuman/doctor-tracker-frontend)

| | |
|---|---|
| **Live API** | _added after deployment_ — health check at `/api/health` |
| **Live app** | _added after deployment_ |

**Demo accounts** (created by `npm run seed`; every role signs in through the same endpoint):

| Role | Email | Password |
|---|---|---|
| Administrator | `admin@doctortracker.com` | `Admin@12345` |
| Doctor | `doctor@doctortracker.com` | `Doctor@12345` |
| Patient | `patient@doctortracker.com` | `Patient@12345` |

---

## Description

Hospitals juggle rosters of doctors and hundreds of patients across spreadsheets, and patients still queue in waiting rooms to get a slot. **Doctor Tracker** connects the three sides: **patients** find a doctor, pick a live time slot and confirm it by paying (card, bKash or Nagad — simulated); **doctors** run their weekly schedule and see paid bookings and their patient list; **administrators** manage the roster, every patient record and live analytics. This repository is the **standalone Express + MongoDB REST API** behind it — role-based, validated, index-backed, with a payment hold that can never double-book a slot.

## Tech stack

| Concern | Choice |
|---|---|
| Runtime / framework | Node.js 22, **Express 5** (native async error handling) |
| Language | TypeScript (strict) |
| Database | **MongoDB Atlas** via Mongoose 9 |
| Validation | **Zod 4** schemas for body, query and params |
| Auth | Short-lived **JWT access token** + **rotating refresh token** (hashed, reuse-detected), both httpOnly cookies; bcrypt |
| Access control | Roles `admin` / `doctor` / `patient`, route guards + row-level ownership checks |
| Security | helmet, CORS allow-list, CSRF origin check, rate limits, operator-injection stripping, image sniffing |
| Testing | Vitest + Supertest + mongodb-memory-server (42 tests) |

## Setup guide

**Prerequisites:** Node.js ≥ 20 and a MongoDB connection string (a free [MongoDB Atlas](https://www.mongodb.com/atlas) M0 cluster works).

```bash
# 1. Clone and install
git clone https://github.com/sadatnuman/doctor-tracker-backend.git
cd doctor-tracker-backend
npm install

# 2. Configure environment
cp .env.example .env
#    → set MONGODB_URI (include the database name, e.g. .../doctor-tracker?retryWrites=true)
#    → set JWT_SECRET to a long random string (must match the frontend's JWT_SECRET)
#      e.g.  node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

# 3. Demo data: 3 demo accounts, 60 doctors (all can sign in), ~3,100 patient records,
#    120 patient accounts with ~170 paid bookings — all names and hospitals fictional, Bangladeshi
npm run seed            # or: npm run seed -- --accounts   (refresh the admin account only)

# 4. Run
npm run dev             # http://localhost:4000  (watch mode)
```

### Environment variables

See [`.env.example`](./.env.example). The server validates its environment on boot and exits with a clear message if anything is missing.

| Variable | Required | Description |
|---|---|---|
| `MONGODB_URI` | ✅ | MongoDB connection string including the database name |
| `JWT_SECRET` | ✅ | ≥ 32 chars; shared with the frontend so its proxy can verify sessions |
| `ACCESS_TOKEN_TTL` | | Access-token lifetime (default `15m`) |
| `REFRESH_TOKEN_TTL_DAYS` | | Refresh-token lifetime (default `7`) |
| `CLIENT_ORIGIN` | | Comma-separated allowed browser origins (CORS + CSRF check) |
| `COOKIE_SECURE` | | `true` in production (HTTPS) |
| `CLINIC_TIMEZONE` | | Timezone of doctors' schedules (default `Asia/Dhaka`) |
| `PAYMENT_HOLD_MINUTES` | | How long an unpaid booking holds its slot (default `5`) |
| `SEED_*_EMAIL` / `SEED_*_PASSWORD` | | Demo accounts for `admin`, `doctor`, `patient` |

<details>
<summary><b>Troubleshooting:</b> <code>querySrv ECONNREFUSED _mongodb._tcp…</code></summary>

Some local networks, VPNs or secure-DNS tools block the DNS **SRV** lookup that `mongodb+srv://` strings need. Use Atlas's standard connection string instead (Atlas → Connect → Drivers → toggle **"Legacy URI String"**), or build it from the cluster's records:

```bash
nslookup -type=SRV _mongodb._tcp.<cluster>.mongodb.net   # host list
nslookup -type=TXT <cluster>.mongodb.net                 # replicaSet + authSource
```

```
MONGODB_URI=mongodb://USER:PASS@host-00:27017,host-01:27017,host-02:27017/doctor-tracker?tls=true&replicaSet=<name>&authSource=admin&retryWrites=true&w=majority
```

Cloud hosts like Render resolve SRV records normally, so production can keep the `mongodb+srv://` form.
</details>

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start with hot reload (tsx) |
| `npm run build` / `npm start` | Compile to `dist/` and run it |
| `npm test` | Integration tests against an in-memory MongoDB |
| `npm run typecheck` | Strict type check |
| `npm run seed` | Demo accounts + realistic Bangladeshi demo data |
| `npm run explain` | Print the query plan of every list/search/filter query (proves index usage) |

## System architecture

```mermaid
flowchart LR
    B[Browser] -->|HTTPS, same-origin /api/*| N[Next.js on Vercel<br/>proxy.ts + rewrites]
    N -->|REST + session cookies| A[Express API on Render]
    A -->|Mongoose, pooled| M[(MongoDB Atlas)]
    A -. every 30 s .-> S[Hold sweeper:<br/>expire unpaid bookings]
```

Every request passes through the same pipeline:

`helmet → CORS → compression → JSON (100 kB) → cookies → operator sanitizer → CSRF origin check → rate limit → authenticate (JWT) → requireRole(...) → [requireDoctorScope] → zod validate → controller → service (row-level scope) → MongoDB` — and any error lands in one handler that returns a consistent shape.

👉 Request lifecycle, data model, every index and its query plan, the session and booking state machines, security model and scaling notes are in **[ARCHITECTURE.md](./ARCHITECTURE.md)**.

## Roles and access

| Capability | Visitor | Patient | Doctor | Admin |
|---|:-:|:-:|:-:|:-:|
| Browse doctors, fees and live slots | ✅ | ✅ | ✅ | ✅ |
| Register (patients only) / sign in | ✅ | — | — | — |
| Book a slot, pay, cancel own booking | — | ✅ | — | — |
| See own bookings & receipts | — | ✅ | — | — |
| Manage own schedule | — | — | ✅ | ✅ (any doctor) |
| See bookings for own schedule, mark completed | — | — | ✅ | ✅ (all) |
| Own patient list (add / edit / remove) | — | — | ✅ | ✅ (any doctor) |
| Roster, doctor logins, all patients, analytics | — | — | — | ✅ |
| Profile picture, password, sign out everywhere | — | ✅ | ✅ | ✅ |

Ownership is enforced in the data layer too: a doctor querying another doctor's patients gets 403, and an appointment id that isn't yours returns 404 (ids can't be probed).

## API reference

All endpoints live under `/api` and return JSON. Success: `{ data, meta? }`. Error: `{ error: { code, message, details? } }`.

**Public**

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Liveness + DB status |
| `GET` | `/public/doctors` | Directory (no contact details) — `page, limit, search, specialization, hospital, sort` |
| `GET` | `/public/doctors/:id` | Public profile: specialty, hospital, fee, bio, schedule, photo |
| `GET` | `/public/doctors/:id/slots` | Live availability — `from=YYYY-MM-DD, days≤14` (never cached) |
| `GET` | `/meta/filters` | Specializations, hospitals and enum values |
| `GET` | `/avatars/:userId` | Profile picture (versioned URL, cached for a year) |

**Auth & profile** (one login for every role)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/auth/register` | Patient sign-up (role is never taken from the client) |
| `POST` | `/auth/login` | Sign in → access + refresh cookies (rate-limited per IP + email) |
| `POST` | `/auth/refresh` | Rotate the refresh token, issue a new access token |
| `POST` | `/auth/logout` · `/auth/logout-all` | End this session · end every session |
| `GET` / `PATCH` | `/auth/me` | Current user · update name, phone, age, gender |
| `POST` | `/auth/change-password` | Change password (signs out other devices) |
| `PUT` / `DELETE` | `/auth/me/avatar` | Upload (raw JPEG/PNG/WebP ≤ 300 kB) · remove profile picture |

**Appointments & payments** (rows scoped to the caller's role)

| Method | Endpoint | Who | Description |
|---|---|---|---|
| `GET` | `/appointments` | any | `when=upcoming\|past\|all, status, doctor (admin), page, limit` |
| `POST` | `/appointments` | patient | Book `{ doctorId, start, reason }` → `pending_payment`, slot held 5 min |
| `GET` | `/appointments/:id` | owner | Booking + payment + `serverTime` for the countdown |
| `POST` | `/appointments/:id/pay` | patient | `{ method: card\|bkash\|nagad, … }` → `confirmed` + receipt |
| `POST` | `/appointments/:id/cancel` | owner | Cancel; refunds a paid booking |
| `POST` | `/appointments/:id/complete` | doctor/admin | Mark a started visit completed |
| `GET` | `/payments` | any | Payments scoped like appointments |

**Doctor workspace**

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/me/doctor` · `/me/doctor/overview` | Own profile & caseload · upcoming, completed, revenue this month |
| `PUT` | `/me/doctor/availability` | Weekly schedule `{ days, start, end, slotMinutes }` |
| `GET` / `POST` | `/doctors/:id/patients` | Own patient list (admin: any doctor) |
| `DELETE` | `/doctors/:id/patients/:patientId` | Remove from own list |
| `GET` / `PATCH` | `/patients/:id` | Read / edit a record in own list (admin: any; only admins reassign) |

**Administration**

| Method | Endpoint | Description |
|---|---|---|
| `GET` / `POST` | `/doctors` | List (with patient counts, login + photo) · create (optional initial `password` creates the login) |
| `GET` / `PATCH` / `DELETE` | `/doctors/:id` | Detail · update (fee, bio, schedule…) · delete (cascade confirmed by `?cascade=true`) |
| `PUT` | `/doctors/:id/account` | Create or reset a doctor's login (ends their sessions) |
| `GET` / `POST` | `/patients` | All patient records · create |
| `DELETE` | `/patients/:id` | Delete a record |
| `GET` | `/stats/overview` | Dashboard aggregates incl. bookings and revenue — `from, to, interval` |

<details>
<summary>Example: book and pay</summary>

```bash
curl -c jar -X POST localhost:4000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"patient@doctortracker.com","password":"Patient@12345"}'

DOCTOR=$(curl -s 'localhost:4000/api/public/doctors?search=ayesha' | jq -r '.data[0].id')
SLOT=$(curl -s "localhost:4000/api/public/doctors/$DOCTOR/slots" | jq -r '[.data.days[].slots[] | select(.available)][0].start')

curl -b jar -X POST localhost:4000/api/appointments -H 'Content-Type: application/json' \
  -d "{\"doctorId\":\"$DOCTOR\",\"start\":\"$SLOT\",\"reason\":\"Fever and cough\"}"
# → { "data": { "id": "…", "status": "pending_payment", "holdExpiresAt": "…+5 min", "fee": 800 } }

curl -b jar -X POST localhost:4000/api/appointments/<id>/pay -H 'Content-Type: application/json' \
  -d '{"method":"bkash","walletNumber":"01712345678","pin":"12345"}'
# → { "data": { "status": "confirmed", "payment": { "status": "paid", "instrument": "bKash •••• 5678", "transactionId": "TXN-…" } } }
```
</details>

## Technical decisions

### 1. Index-backed prefix search instead of `$regex /term/i` or a `$text` index

- **Case-insensitive regex (`/jo/i`)** cannot use a B-tree index efficiently — MongoDB examines every key, so cost grows with the collection.
- **A `$text` index** matches whole stemmed words only: typing `"Jo"` would not find `"John"`, which feels broken in search-as-you-type.

**What we do:** each document stores a normalized `nameLower` (kept in sync by a Mongoose plugin on save *and* update) and search runs an **anchored, case-sensitive prefix regex** (`^jo`), OR-ed with the same prefix on the lower-cased email. Anchored prefixes compile to bounded **index range scans**, and since every `$or` branch has its own index MongoDB plans `OR ← IXSCAN(nameLower_1) + IXSCAN(email_1)`. Measured with `npm run explain` on 3,000 patients: **49 documents examined in ~1–3 ms** for a 10-row page, versus all 3,000 for the naïve regex. Fuzzy/infix search would move to Atlas Search, not to a slower regex.

### 2. Aggregation strategy: one `$facet` pass, no denormalized counters

- **Dashboard** — one `$match` on the indexed `admissionDate` range feeds a single **`$facet`** (timeline via `$dateTrunc`, condition/status/gender/age breakdowns, top-10 doctors with the `$lookup` *after* `$sort + $limit`), in parallel with index-backed counts for bookings and collected revenue. Empty time buckets are filled server-side.
- **Doctor list patient counts** — instead of a `patientCount` field that must stay in sync on every write, **one** `$match { doctor: { $in: pageIds } } → $group` per page. Always correct, always cheap.

### 3. Sessions: short access token + rotating, reuse-detecting refresh token

A single long-lived JWT can't be revoked. Instead: a **15-minute JWT** (role + doctor link, verified with no DB hit) and a **7-day opaque refresh token** stored only as a **SHA-256 hash**. Every `/auth/refresh` **rotates** the refresh token; presenting an already-rotated token means a copy leaked, so the whole token **family is revoked** (theft detection). Two tabs refreshing at once get a 30-second grace (`REFRESH_RACE`) instead of a false alarm. Password changes and "sign out everywhere" bump a `tokenVersion`, ending every other session within one access-token lifetime. Both tokens live in **httpOnly, SameSite=Lax, Secure** cookies behind the frontend's same-origin proxy, plus a CSRF origin check on writes.

### 4. Payment holds that can't double-book

Booking creates a `pending_payment` appointment with `holdExpiresAt = now + 5 min` and `holdsSlot: true`. A **partial unique index** on `{ doctor, start }` *where `holdsSlot` is true* makes a second booking of the same slot fail atomically in the database (409 `SLOT_TAKEN`) — even if two patients press "Book" in the same millisecond. Payment confirms with a **conditional update** (`status = pending_payment AND holdExpiresAt > now`), so a payment that arrives a moment too late can't confirm a released slot. Lapsed holds are released **lazily** before every slot read/booking (indexed `{ status, holdExpiresAt }` update) and by a 30-second sweeper, flipping `holdsSlot` off so the slot is instantly bookable by anyone. A confirmed booking opens (or reuses) the patient's record in that doctor's list.

## Testing

```bash
npm test
```

42 integration tests over the real HTTP stack and an in-memory MongoDB: auth and validation; RBAC (patients blocked from admin routes, doctors limited to their own patients); booking (5-minute hold, same-slot conflict, off-schedule times, only the booking patient can pay, declined card keeps the hold, payment confirms and adds the patient to the doctor's list, expired hold releases the slot to someone else, refund on cancel); sessions (refresh rotation, reuse detection, sign-out-everywhere on password change, CSRF origin check); profile pictures (byte sniffing rejects non-images, cache headers); search, filters, pagination and dashboard aggregates.

## Project structure

```
src/
├─ config/        env (zod-validated), db connection, roles/statuses/constants
├─ models/        user, doctor (+ schedule), patient, appointment, payment, refreshToken, avatar
├─ validators/    zod schemas per resource
├─ middlewares/   authenticate, requireRole, requireDoctorScope, verifyOrigin, validate, rate limits, errors
├─ services/      auth, doctors, patients, slots, appointments & payments, stats, avatars
├─ controllers/   thin HTTP layer
├─ routes/        role-annotated REST route table
├─ utils/         query helpers, timezone helpers
├─ scripts/       seed + query-plan explain
├─ app.ts         Express app factory (used by server and tests)
└─ server.ts      boot, hold sweeper, graceful shutdown
tests/            API integration tests
```

## Deployment

Deployed on **Render** (free web service, Singapore — closest to the Atlas cluster in Mumbai) from `main` using [`render.yaml`](./render.yaml): build `npm ci --include=dev && npm run build`, start `npm start`, health check `/api/health`. Set `MONGODB_URI`, `JWT_SECRET` and `CLIENT_ORIGIN` (the Vercel URL) in the dashboard. Indexes are synced explicitly on boot in production.

> Free Render instances sleep after ~15 minutes idle; the first request afterwards takes up to a minute. The frontend shows a "waking the server" notice and its public pages are served from cache meanwhile.

## Visual evidence

Desktop and mobile screenshots: **[doctor-tracker-frontend → Visual evidence](https://github.com/sadatnuman/doctor-tracker-frontend#visual-evidence)**.

## Branching

`develop` receives day-to-day work; changes reach `main` (production) through reviewed pull requests.
