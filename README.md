# Doctor Tracker — API

> REST API for **Doctor Tracker**, a secure admin portal for managing doctors, their patients and caseload analytics.
> Frontend repository: [doctor-tracker-frontend](https://github.com/sadatnuman/doctor-tracker-frontend)

| | |
|---|---|
| **Live API** | _added after deployment_ — health check at `/api/health` |
| **Live app** | _added after deployment_ |
| **Demo login** | `admin@doctortracker.com` / `Admin@12345` |

---

## Description

Hospitals juggle rosters of doctors and the hundreds of patients each one is responsible for, usually across spreadsheets that can't answer simple questions like _"who is overloaded?"_ or _"how many critical admissions did we have this quarter?"_. **Doctor Tracker** gives administrators one secure place to keep the doctor roster current, follow every patient from admission to discharge, and see — at a glance — where demand is growing. This repository is the **standalone Express + MongoDB REST API** behind it: authenticated, validated, index-backed and built so that searching, filtering and paginating thousands of records stays fast.

## Tech stack

| Concern | Choice |
|---|---|
| Runtime / framework | Node.js 22, **Express 5** (native async error handling) |
| Language | TypeScript (strict) |
| Database | **MongoDB Atlas** via Mongoose 9 |
| Validation | **Zod 4** schemas for body, query and params |
| Auth | JWT (HS256) in an **httpOnly cookie**, bcrypt password hashing |
| Security | helmet, strict CORS allow-list, rate limiting, operator-injection stripping |
| Testing | Vitest + Supertest + mongodb-memory-server |

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

# 3. Create the admin account + demo data (60 doctors, 3,000 patients)
npm run seed            # or: npm run seed -- --admin   (admin account only, keeps data)

# 4. Run
npm run dev             # http://localhost:4000  (watch mode)
```

### Environment variables

See [`.env.example`](./.env.example).

| Variable | Required | Description |
|---|---|---|
| `MONGODB_URI` | ✅ | MongoDB connection string including the database name |
| `JWT_SECRET` | ✅ | ≥ 32 chars; shared with the frontend so its proxy can verify sessions |
| `JWT_EXPIRES_IN` | | Session length (default `1d`) |
| `CLIENT_ORIGIN` | | Comma-separated allowed browser origins (default `http://localhost:3000`) |
| `COOKIE_SECURE` | | `true` in production (HTTPS) |
| `PORT` / `NODE_ENV` | | Defaults `4000` / `development` |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | | Credentials created by `npm run seed` |

The server validates its environment on boot and exits with a clear message if anything is missing.

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
| `npm run seed` | Create admin + realistic demo data |
| `npm run explain` | Print the query plan of every list/search/filter query (proves index usage) |

## System architecture

```mermaid
flowchart LR
    B[Browser] -->|HTTPS, same-origin /api/*| N[Next.js on Vercel<br/>proxy.ts + rewrites]
    N -->|REST + auth cookie| A[Express API on Render]
    A -->|Mongoose, pooled| M[(MongoDB Atlas)]
```

Every request passes through the same pipeline:

`helmet → CORS → compression → JSON body (100 kB cap) → cookie parser → operator sanitizer → rate limiter → authenticate (JWT) → requireRole('admin') → zod validate → controller → service → MongoDB` — and any thrown error lands in one central error handler that returns a consistent shape.

The code is layered so each part has one job: **routes** declare endpoints and middleware, **controllers** translate HTTP ↔ service calls, **services** own all database logic, **validators** own input rules, **models** own schema + indexes.

👉 The full write-up — request lifecycle, data model, every index and the query plan it produces, aggregation design, security model and scaling notes — is in **[ARCHITECTURE.md](./ARCHITECTURE.md)**.

## API reference

All endpoints live under `/api` and return JSON. Success: `{ data, meta? }`. Error: `{ error: { code, message, details? } }`.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Liveness + DB status (public) |
| `POST` | `/auth/login` | Sign in → sets `dt_token` httpOnly cookie (public, rate-limited) |
| `POST` | `/auth/logout` | Clear the session cookie |
| `GET` | `/auth/me` | Current user |
| `GET` | `/doctors` | List doctors — `page, limit, search, specialization, hospital, from, to, sort` |
| `POST` | `/doctors` | Create a doctor (`name, specialization, hospital, phone, email`) |
| `GET` | `/doctors/:id` | Doctor profile + caseload breakdown by status and condition |
| `PATCH` | `/doctors/:id` | Update a doctor |
| `DELETE` | `/doctors/:id` | Delete (409 if they still have patients, unless `?cascade=true`) |
| `GET` | `/doctors/:id/patients` | That doctor's patients — same filters as `/patients` |
| `POST` | `/doctors/:id/patients` | Add a patient under this doctor |
| `DELETE` | `/doctors/:id/patients/:patientId` | Remove a patient from this doctor's list (404 if it isn't theirs) |
| `GET` | `/patients` | List patients — `page, limit, search, condition, status, gender, doctor, ageMin, ageMax, from, to, sort` |
| `POST` | `/patients` | Create a patient (`doctor` id in the body) |
| `GET` / `PATCH` / `DELETE` | `/patients/:id` | Read / partially update / delete a patient |
| `GET` | `/stats/overview` | Dashboard aggregates — `from, to, interval=day\|week\|month` |
| `GET` | `/meta/filters` | Options for filter dropdowns (specializations, hospitals, enums) |

Multi-value filters are comma-separated (`condition=Asthma,Diabetes`). Dates are ISO (`2026-01-31`); a bare `to` date includes the whole day. `limit` is capped at 100 and `sort` is whitelisted per resource.

<details>
<summary>Example</summary>

```bash
curl -c jar -X POST http://localhost:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@doctortracker.com","password":"Admin@12345"}'

curl -b jar 'http://localhost:4000/api/patients?condition=Asthma,Diabetes&status=Critical&from=2026-01-01&limit=5'
```

```json
{
  "data": [{ "id": "…", "name": "Ayden Terry", "age": 46, "condition": "Diabetes", "status": "Critical",
             "admissionDate": "2026-10-23T05:41:09.778Z",
             "doctor": { "id": "…", "name": "Dr. Schuyler Bogisich", "specialization": "Gastroenterology" } }],
  "meta": { "page": 1, "limit": 5, "total": 41, "totalPages": 9, "hasNextPage": true, "hasPrevPage": false }
}
```
</details>

## Technical decisions

### 1. Index-backed prefix search instead of `$regex /term/i` or a `$text` index

Search is the most-used feature and the easiest one to make slow. The usual options both have a catch:

- **Case-insensitive regex (`/jo/i`)** cannot use a B-tree index efficiently — MongoDB has to examine every key, so cost grows linearly with the collection.
- **A `$text` index** is fast, but matches whole stemmed words only: typing `"Jo"` would not find `"John"`, which feels broken in a search-as-you-type box.

**What we do:** each document stores a normalized `nameLower` copy (kept in sync by a Mongoose plugin on save *and* on update), and search runs an **anchored, case-sensitive prefix regex** (`^jo`) against it, OR-ed with the same prefix on the (already lower-cased) email. An anchored prefix compiles to a bounded **index range scan**. Because every `$or` branch has its own index, MongoDB plans it as `OR ← IXSCAN(nameLower_1) + IXSCAN(email_1)` instead of falling back to a collection scan. User input is regex-escaped first.

Measured with `npm run explain` on 3,000 patients: a search returning 10 rows examines **49 documents in ~3 ms**, versus a full collection scan of all 3,000 with the naïve regex. The trade-off — prefix-only matching ("hopper" won't find "Grace Hopper") — is the behaviour people expect from a name search, and the path to fuzzy/infix search later is Atlas Search, not a slower regex.

### 2. Aggregation strategy: one `$facet` pass, no denormalized counters

The dashboard needs totals, a time series, four breakdowns and a top-10 — naïvely ~10 queries, or worse, per-doctor counts (N+1).

- **Dashboard** — a single `$match` on the indexed `admissionDate` range feeds one **`$facet`** that computes the timeline (`$dateTrunc` by day/week/month), condition/status/gender/age (`$bucket`) breakdowns and the top-10 doctors in one pass over the data. The `$lookup` for doctor names runs **after** `$sort + $limit 10`, so it joins 10 documents, not 3,000. Totals use `estimatedDocumentCount()` (metadata, O(1)). Everything runs in parallel with `Promise.all`, and empty buckets are filled server-side so charts never show gaps.
- **Doctor list "patients" column** — instead of storing a `patientCount` on each doctor (which must be kept in sync on every create/delete/reassign and drifts the moment one write fails), the service runs **one** grouped query for the current page: `$match { doctor: { $in: pageIds } } → $group`. That's at most 100 ids against the `{ doctor, admissionDate }` index — always correct, always cheap.

The rule of thumb applied: derive aggregates from the source of truth with indexed, page-bounded queries; only denormalize when measurement says you must.

### 3. (Bonus) httpOnly JWT cookie behind a same-origin proxy

Tokens in `localStorage` are readable by any injected script. The API instead sets the JWT in an **`httpOnly`, `SameSite=Lax`, `Secure`** cookie. The frontend calls `/api/*` on its *own* origin and Next.js rewrites that to this server, so the cookie is first-party — no `SameSite=None`, no third-party-cookie blocking, and the frontend proxy can verify it before rendering a page. The API still verifies the token on every request and also accepts `Authorization: Bearer` for non-browser clients.

## Testing

```bash
npm test
```

16 integration tests spin up an in-memory MongoDB and exercise the real HTTP stack: auth (401s, generic credential errors, cookie flags, Bearer support), validation (field-level 400s, malformed ids, unknown enum values), conflicts (409 on duplicate email / deleting a doctor with patients), search + filter + pagination metadata, partial updates not resetting fields, doctor-scoped deletes, and the dashboard aggregation shape.

## Project structure

```
src/
├─ config/        env (zod-validated), db connection, shared constants
├─ models/        Mongoose schemas + indexes, name-normalization plugin
├─ validators/    zod schemas per resource (body / query / params)
├─ middlewares/   authenticate, requireRole, validate, rate limits, sanitizer, error handler
├─ services/      all database logic (auth, doctors, patients, stats, meta)
├─ controllers/   thin HTTP layer
├─ routes/        REST route table
├─ scripts/       seed + query-plan explain
├─ app.ts         Express app factory (used by server and tests)
└─ server.ts      boot + graceful shutdown
tests/            API integration tests
```

## Deployment

The API is deployed on **Render** (free web service) from the `main` branch using [`render.yaml`](./render.yaml): build `npm ci --include=dev && npm run build`, start `npm start`, health check `/api/health`. Set `MONGODB_URI`, `JWT_SECRET` and `CLIENT_ORIGIN` (the Vercel URL) in the Render dashboard, and allow Render's outbound traffic in Atlas → Network Access. In production, indexes are synced explicitly on boot (`autoIndex` is off).

> Free Render instances sleep after ~15 minutes idle; the first request afterwards takes up to a minute while it wakes. The frontend shows a "waking the server" notice during that wait.

## Visual evidence

Desktop and mobile screenshots of the full application are in the frontend repository's README: **[doctor-tracker-frontend → Visual evidence](https://github.com/sadatnuman/doctor-tracker-frontend#visual-evidence)**.

## Branching

`develop` receives day-to-day work; changes reach `main` (production) through reviewed pull requests.
